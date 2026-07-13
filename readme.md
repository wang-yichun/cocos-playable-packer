# Cocos Playable Packer

用于将 Cocos Creator 3.8.x `web-mobile` 构建产物优化并打包为离线单文件 Playable HTML。

当前生产流程支持：

- 图片处理：`none`、TinyPNG、Squoosh PNG/JPEG、WebP；
- 音频处理：可选 MP3 码率压缩；
- 资源归档：Solid Brotli；
- Payload 编码：Base64、Safe Base91、HTML-safe 7-bit；
- Brotli 回退解码器：原始 JavaScript 或 gzip-packed JavaScript；
- 工作区隔离、SHA-256 校验、JSON 报告和失败保护。

项目默认环境：Windows 11、PowerShell、Node.js 22、TypeScript。

## 1. 安装与检查

首次克隆或更换电脑后执行：

```powershell
npm ci
npm run typecheck
```

如果 `package-lock.json` 与 `package.json` 不一致，再执行：

```powershell
npm install
npm run typecheck
```

### FFmpeg（仅音频压缩需要）

FFmpeg 是外部程序，不属于 npm 依赖。`npm ci` 和 `npm install` 不会安装 FFmpeg。

以下功能必须能够执行 `ffmpeg`：

- `audio:benchmark`；
- `audio:optimize` 的实际转码；
- `playable:build` 并传入 `--audio-bitrate=N`；
- Web MVP 主动启用音频压缩。

不传 `--audio-bitrate`、Web MVP 保持音频压缩关闭、只处理图片或打包 HTML 时，不需要 FFmpeg。

公司电脑已验证可使用 Chocolatey 安装：

```powershell
choco install ffmpeg
```

当前公司环境中 `winget install` 无法使用，原因尚未定位，因此不要将 Winget 作为公司电脑的默认安装方式。未安装 Chocolatey 时可改用手动安装。

安装完成后，关闭并重新打开 PowerShell、VS Code 终端和已经启动的 Web MVP 服务。

手动安装可从 FFmpeg 官方下载页面选择 Windows 构建，解压后将 `ffmpeg\bin` 加入 Windows `Path`。

安装后验证：

```powershell
where.exe ffmpeg
Get-Command ffmpeg -ErrorAction SilentlyContinue
ffmpeg -version
ffmpeg -encoders | Select-String libmp3lame
```

也可以在 CLI 中通过完整路径指定可执行文件：

```text
--ffmpeg="D:\Tools\ffmpeg\bin\ffmpeg.exe"
```

出现以下错误时：

```text
spawn ffmpeg ENOENT
```

表示 Node.js 找不到 `ffmpeg` 可执行文件，通常不是 npm 包缺失。安装或修改 `Path` 后必须重新打开终端并重启 `npm run web:mvp`。

完整安装、验证和排查步骤见 [FFmpeg 安装说明](docs/ffmpeg-installation.md)。

### TinyPNG 环境变量

TinyPNG 模式需要在项目根目录创建 `.env`：

```env
TINYPNG_API_KEY=你的TinyPNG_API_Key

# 直连失败时可选
# TINYPNG_PROXY=http://127.0.0.1:7890
```

`.env`、缓存、工作区副本和构建产物不得提交到 Git。

## 2. 推荐：一条命令完成 Playable 构建

### Squoosh PNG/JPEG + MP3 48 kbps + HTML7

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7-squoosh80-audio48.html" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --audio-bitrate=48 `
  --payload-encoding=html7 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

### WebP Q80 + MP3 48 kbps + HTML7

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

Pipeline 会先复制输入构建，再在工作区副本中优化资源。原始 Cocos `web-mobile` 目录不会被修改。

成功后主要输出：

```text
<输出文件>.html
<输出文件>.report.json
workspaces/<project>/reports/<timestamp>.json
```

需要保留本次工作区副本时增加：

```text
--keep-workspace
```

## 3. 图片模式

| 模式 | 作用 | 主要实现 |
| --- | --- | --- |
| `none` | 不修改图片 | 仅复制和校验 |
| `tinypng` | 调用 TinyPNG API 压缩构建图片 | `tinify` |
| `squoosh` | PNG 调色板量化 + OxiPNG；JPEG 使用 MozJPEG | `sharp`、`@jsquash/oxipng`、`@jsquash/jpeg` |
| `webp` | 将 PNG/JPEG 内容编码为 WebP，保留原逻辑路径 | `sharp`、`@jsquash/webp` |

### 不压缩图片

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game.html" `
  --image-mode=none
```

### TinyPNG

为避免意外消耗 API 配额，必须显式指定 `--all` 或 `--limit=N`：

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-tinypng.html" `
  --image-mode=tinypng `
  --all
```

### Squoosh

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-squoosh.html" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80
```

PNG 还支持：

```text
--colours=256
--effort=10
--dither=0.5
--oxipng-level=3
```

`--oxipng-level` 是无损 PNG 优化等级，不是画质参数。

### WebP

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-webp.html" `
  --image-mode=webp `
  --png-webp-quality=80 `
  --jpeg-webp-quality=80
```

WebP 模式只在候选文件同时满足以下条件时替换内容：

- WebP 原始字节数更小；
- WebP 经 Brotli Q11 后仍更小。

文件引用路径和扩展名保持不变，打包器按文件内容识别真实 MIME 类型。

详见 [图片优化说明](docs/image-optimization.md) 和 [WebP 路线说明](docs/webp-optimization.md)。

## 4. 音频压缩

Pipeline 的音频压缩是可选项。不传 `--audio-bitrate` 时完全关闭。

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-audio48.html" `
  --image-mode=none `
  --audio-bitrate=48
```

当前生产优化器：

- 只扫描 `.mp3`；
- 只处理源码率高于目标码率的文件；
- 使用 FFmpeg `libmp3lame`；
- 保持原声道数；
- 移除元数据和封面流；
- 校验输出码率、声道、体积和 SHA-256；
- 输出不变小则保留原文件。

详见 [音频优化说明](docs/audio-optimization.md) 和 [FFmpeg 安装说明](docs/ffmpeg-installation.md)。

## 5. Payload 编码

```text
--payload-encoding=base64
--payload-encoding=base91
--payload-encoding=html7
```

- `base64`：默认模式，兼容性最高；
- `base91`：更高密度的可打印 ASCII；
- `html7`：HTML-safe 7-bit 路线，当前体积最小，但仍应按渠道验证。

未指定时默认为 `base64`。

## 6. Brotli 回退解码器

```text
--brotli-fallback=raw-js
--brotli-fallback=gzip-packed-js
```

- `raw-js`：默认模式，兼容性最高；
- `gzip-packed-js`：将 JavaScript Brotli 解码器再次 gzip 压缩，运行时通过 `DecompressionStream('gzip')` 展开，可进一步减小 HTML。

目标广告容器或 WebView 未验证前，不应假设其支持 `gzip-packed-js`。

## 7. 独立分析与优化命令

### 构建资源分析

```powershell
npm run analyze -- `
  "./web-mobile" `
  "./compression-report.json"
```

### 图片独立入口

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --preview
```

### 音频分析

```powershell
npm run audio:analyze -- `
  "./web-mobile" `
  "./audio-analysis-report.json"
```

### 音频转码基准与试听页

```powershell
npm run audio:benchmark -- `
  "./web-mobile" `
  "./audio-benchmark" `
  --min-bitrate=160 `
  --bitrates=128,96,64,48
```

### WebP 批量基准与预览页

```powershell
npm run webp:benchmark-build -- `
  "./web-mobile" `
  "./webp-benchmark" `
  --png-quality=80 `
  --jpeg-quality=80
```

### 仅执行 Brotli 单 HTML 打包

```powershell
npm run pack:br -- `
  "./web-mobile" `
  "./dist/game-compressed.html"
```

## 8. 技术组成

| 组件 | 用途 |
| --- | --- |
| Node.js `zlib` | Solid Brotli Q11、gzip-packed 回退脚本 |
| `brotli-compress` | 浏览器 JavaScript Brotli 回退解码器 |
| `sharp` | 图片解码、像素读取和 PNG 调色板量化 |
| `@jsquash/oxipng` | PNG 无损重排与压缩 |
| `@jsquash/jpeg` | MozJPEG 编码 |
| `@jsquash/webp` | libwebp WASM 编码 |
| `tinify` | TinyPNG API 客户端 |
| `music-metadata` | 音频格式、码率、时长、采样率和声道分析 |
| FFmpeg / `libmp3lame` | MP3 候选生成与生产转码 |
| `acorn`、`acorn-walk` | JavaScript 与 SystemJS 模块结构分析 |
| `cheerio` | HTML 结构处理 |
| `tsx`、TypeScript | TypeScript 命令执行和静态检查 |

更完整的分层说明见 [技术概况](docs/technical-overview.md)。

## 9. 缓存与生成目录

以下内容保持本地化，不提交到 Git：

```text
node_modules/
dist/
web-mobile/
.squoosh-cache/
.tinypng-cache/
workspaces/*/runs/
workspaces/*/reports/
workspaces/*/preview/
workspaces/*/backups/
.env
.env.*
```

`.env.example` 可以提交。

## 10. 自动检查

```powershell
npm run typecheck
npm run test:audio-analysis
npm run test:audio-benchmark
npm run test:audio-optimize
npm run test:webp-benchmark
npm run test:webp-optimize
npm run test:squoosh-jpeg
npm run test:image-quality-pipeline
npm run test:brotli-fallback
npm run test:brotli-fallback-pipeline
```

## 11. 浏览器验收

自动检查不能替代真实游戏验证。发布前至少确认：

- 游戏正常启动，所有场景可进入；
- UI、图集、字体、小图标和透明边缘正常；
- 烟雾、发光、渐变和照片类纹理无明显劣化；
- 音效、背景音乐和声道表现正常；
- Bullet 物理及游戏逻辑正常；
- 浏览器控制台无新增异常；
- Brotli 解压耗时可接受；
- 最终 HTML 满足渠道体积限制。
