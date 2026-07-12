# 技术概况

本文说明 Cocos Playable Packer 的生产 Pipeline、关键模块、核心依赖和常用命令之间的关系。

## 1. 总体流程

```text
Cocos Creator web-mobile 构建
        ↓
输入目录校验与统计
        ↓
复制到 workspaces/<project>/runs/<timestamp>/web-mobile
        ↓
图片优化：none / TinyPNG / Squoosh / WebP
        ↓
可选 MP3 码率优化
        ↓
扫描文件、脚本和 SystemJS 模块
        ↓
生成虚拟文件归档
        ↓
Solid Brotli Q11
        ↓
Payload：Base64 / Safe Base91 / HTML-safe 7-bit
        ↓
内嵌 Brotli 解码与 Cocos 启动运行时
        ↓
可选 gzip-packed JavaScript 回退解码器
        ↓
单 HTML + JSON 报告 + SHA-256
```

`playable:build` 是生产入口。独立命令用于分析、基准、参数选择和问题定位。

## 2. 工作区隔离

Pipeline 不直接修改输入的 Cocos 构建目录，而是先复制到：

```text
workspaces/<project>/runs/<timestamp>/web-mobile/
```

项目名可以显式指定：

```text
--project=game141
```

不指定时，工具会根据输入路径生成稳定项目键。

默认成功后可清理本次副本；需要保留排查现场时使用：

```text
--keep-workspace
```

工作区隔离的目的：

- 防止压缩器修改原始构建；
- 允许不同参数独立运行；
- 保存阶段报告和失败上下文；
- 便于对比 Squoosh、WebP、TinyPNG 和无图片压缩路线。

## 3. 图片层

### `none`

只复制和统计，不修改图片。

### TinyPNG

核心 npm 包：

```text
tinify
```

特点：

- 调用 TinyPNG API；
- 使用本地内容哈希缓存；
- 需要显式 `--all` 或 `--limit=N`；
- 需要 `.env` 中的 API Key。

### Squoosh PNG

核心实现：

```text
sharp
@jsquash/oxipng
```

处理过程：

```text
PNG 解码
  → Sharp 调色板量化
  → OxiPNG 无损优化
  → 尺寸/格式/SHA 校验
  → 缓存与安全应用
```

OxiPNG 只做无损优化；主要有损变化来自调色板量化。

### Squoosh JPEG

核心实现：

```text
@jsquash/jpeg
```

使用 MozJPEG 重新编码，保留 `.jpg`/`.jpeg` 路径，并设置最低体积收益门槛，防止为了极小收益引入额外有损编码。

### WebP

核心实现：

```text
sharp
@jsquash/webp
```

`sharp` 负责解码为 RGBA 像素，`@jsquash/webp` 的 libwebp WASM 编码器负责输出候选。

为了兼容 Cocos 构建引用，逻辑路径不变；打包器按文件 Magic Bytes 识别真实 MIME 类型。

详见：

- [图片优化说明](image-optimization.md)
- [WebP 路线说明](webp-optimization.md)

## 4. 音频层

核心 npm 包：

```text
music-metadata
```

外部工具：

```text
FFmpeg / libmp3lame
```

`music-metadata` 负责分析格式、时长、码率、采样率和声道。FFmpeg 负责生成 MP3 候选和生产转码。

生产优化器当前只处理 MP3，并遵循：

- 仅压缩源码率高于目标值的文件；
- 保持声道数；
- 移除元数据和封面流；
- 校验输出码率和声道；
- 输出不变小则保留原文件；
- 原子替换和 SHA-256 记录。

详见 [音频优化说明](audio-optimization.md)。

## 5. JavaScript 与 Cocos/SystemJS 处理

核心 npm 包：

```text
acorn
acorn-walk
```

用于解析和遍历 JavaScript 语法结构，识别构建脚本与 SystemJS 模块。打包阶段需要处理 Cocos Creator 构建中常见的：

- 匿名 `System.register`；
- Cocos Bundle 模块；
- prerequisite-imports；
- Bullet 等运行时模块；
- 普通脚本和启动入口。

此层的目标是把多文件 Web Mobile 构建重建为可在单 HTML 内启动的虚拟文件与模块环境，而不是简单地把所有 JavaScript 字符串拼接在一起。

## 6. HTML 处理

核心 npm 包：

```text
cheerio
```

用于部分 HTML 结构读取和处理。最终运行时还会内嵌：

- 资源归档 Payload；
- 解码逻辑；
- 虚拟文件读取逻辑；
- Blob URL 与 MIME 映射；
- Cocos 启动脚本；
- Brotli 原生/回退路径。

## 7. Solid Brotli

构建归档使用 Node.js 内置模块：

```text
node:zlib
```

主要压缩参数为 Brotli Quality 11。Solid Brotli 会把多个文件作为一个整体归档压缩，从而利用不同资源之间的重复文本、JSON、JavaScript 和二进制模式。

`pack:br` 是只执行 Brotli 单 HTML 打包的入口：

```powershell
npm run pack:br -- `
  "./web-mobile" `
  "./dist/game-compressed.html"
```

未压缩诊断版本：

```powershell
npm run pack:raw -- `
  "./web-mobile" `
  "./dist/game-uncompressed.html"
```

## 8. Payload 编码

Brotli 输出是任意二进制，嵌入 HTML 前需要转换为文本表示。

### Base64

```text
--payload-encoding=base64
```

默认路线，兼容性最高，但文本膨胀约为三分之一。

### Safe Base91

```text
--payload-encoding=base91
```

使用更高密度的安全可打印字符集合，在当前样本中小于 Base64。

### HTML-safe 7-bit

```text
--payload-encoding=html7
```

使用为 HTML 内嵌约束设计的 7-bit 编码。当前样本体积优于 Base64 和 Base91，但渠道兼容性仍需单独验证。

独立后处理命令：

```powershell
npm run encoding:base91 -- `
  "./dist/game-base64.html" `
  "./dist/game-base91.html"

npm run encoding:html7 -- `
  "./dist/game-base64.html" `
  "./dist/game-html7.html"
```

## 9. 浏览器 Brotli 解码

核心 npm 包：

```text
brotli-compress
```

运行时优先尝试浏览器原生 Brotli 能力；不可用时切换到内嵌 JavaScript 解码器。

回退脚本存储模式：

```text
--brotli-fallback=raw-js
--brotli-fallback=gzip-packed-js
```

### `raw-js`

直接内嵌 JavaScript Brotli 解码器。默认启用，兼容性最高。

### `gzip-packed-js`

先把回退 JavaScript 使用 gzip 压缩，再以文本形式内嵌。真正需要回退时通过：

```text
DecompressionStream('gzip')
```

展开脚本并初始化原有解码器。

该模式只优化回退解码器的存储，不改变资源归档的 Brotli 算法。

## 10. 报告与完整性

生产流程会生成与 HTML 同名的报告：

```text
game.html
game.report.json
```

报告覆盖：

- 输入文件数和体积；
- 图片、音频优化前后体积；
- 使用的图片质量与音频码率；
- Payload 编码；
- Brotli 回退模式；
- 输出 HTML 字节数；
- SHA-256；
- 各阶段耗时；
- 项目工作区报告路径。

各独立工具也会生成专用 JSON 报告，部分基准命令同时生成 HTML 预览或试听页。

## 11. 命令分层

### 生产命令

```text
playable:build
```

完成工作区复制、资源优化、打包、编码、回退处理和报告。

### 独立打包

```text
pack:raw
pack:br
```

用于定位单 HTML 运行时或 Brotli 打包问题。

### 图片工具

```text
images:optimize
tinypng:build
squoosh:benchmark-png
squoosh:benchmark-build-pngs
squoosh:apply-build-pngs
squoosh:benchmark-build-jpegs
squoosh:apply-build-jpegs
squoosh:optimize-build-jpegs
webp:benchmark-build
webp:optimize-build
```

### 音频工具

```text
audio:analyze
audio:benchmark
audio:optimize
```

### 编码和回退工具

```text
analyze:encoding
encoding:base91
encoding:html7
brotli:fallback:optimize
```

### 验证工具

```text
typecheck
test:audio-analysis
test:audio-benchmark
test:audio-optimize
test:webp-benchmark
test:webp-optimize
test:squoosh-jpeg
test:image-quality-pipeline
test:brotli-fallback
test:brotli-fallback-pipeline
```

## 12. 推荐生产配置

当前已验证的高压缩组合示例：

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7-webp80-audio48.html" `
  --image-mode=webp `
  --png-webp-quality=80 `
  --jpeg-webp-quality=80 `
  --audio-bitrate=48 `
  --payload-encoding=html7 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

这不是所有项目的固定最优参数。图片质量、音频码率、WebP 支持和回退解码能力必须结合目标素材与渠道环境验证。

## 13. 依赖边界

### npm 管理

```text
@jsquash/jpeg
@jsquash/oxipng
@jsquash/webp
acorn
acorn-walk
brotli-compress
cheerio
music-metadata
sharp
tinify
tsx
typescript
```

### Node.js 内置

```text
crypto
fs
path
zlib
child_process
perf_hooks
```

### 用户环境提供

```text
Node.js 22
npm
FFmpeg（仅音频转码需要）
TinyPNG API Key（仅 TinyPNG 模式需要）
浏览器或目标渠道容器
```

不要建议全局安装 `tsx`。项目通过本地 `devDependencies` 执行 TypeScript 脚本。
