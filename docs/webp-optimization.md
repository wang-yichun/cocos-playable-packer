# WebP 构建图片路线

WebP 路线用于把 Cocos Creator `web-mobile` 构建中的 PNG 和 JPEG 内容重新编码为 WebP，再进入 Solid Brotli 与单 HTML 打包。

该路线不修改资源引用路径。原来的 `.png`、`.jpg`、`.jpeg` 文件名保持不变，只有文件内容变为 WebP。

## 1. 为什么保留原路径

Cocos 构建中的资源路径已经写入配置、Bundle 和运行时代码。批量改扩展名需要同步修改所有引用，风险较高。

当前方案采用：

```text
逻辑路径：assets/.../sprite.png
实际内容：image/webp
```

打包器通过文件 Magic Bytes 判断真实 MIME 类型，而不是只相信扩展名。这样可以：

- 不修改 Cocos 资源映射；
- 不修改 Bundle 引用；
- 不重新生成 UUID 或 `.meta`；
- 保持 SystemJS/Cocos 加载路径不变；
- 在单 HTML 运行时使用正确的 `image/webp` Blob 类型。

因此独立导出工作区不应直接作为普通静态站点部署；该方案主要面向本项目生成的单 HTML。

## 2. 核心实现

### `sharp`

用于：

- 解码 PNG/JPEG；
- 统一转换为 RGBA 原始像素；
- 读取宽度、高度和 Alpha 信息。

### `@jsquash/webp`

提供 libwebp WASM 编码器。

当前固定编码参数：

```text
method=6
alpha_quality=100
alpha_compression=1
exact=1
lossless=0
```

质量参数分别控制两类输入：

```text
--png-webp-quality=80
--jpeg-webp-quality=80
```

独立 WebP 工具中的等价参数名为：

```text
--png-quality=80
--jpeg-quality=80
```

范围均为 1-100。

## 3. 采用候选的判定规则

WebP 并不保证每张图片都更小。项目只有在两个条件同时成立时才采用候选：

```text
WebP 原始字节数 < 原文件字节数
并且
WebP 的单文件 Brotli Q11 字节数 < 原文件的单文件 Brotli Q11 字节数
```

原因是最终交付物还会经过 Solid Brotli。某些图片虽然裸文件略小，但 Brotli 后反而没有收益，这种候选会被标记为 `no-benefit` 并保留原图。

单文件 Brotli 仅用于逐图安全筛选，最终报告中的完整 Solid Brotli 结果仍是实际交付体积的判断依据。

## 4. 批量基准

首次为项目选择 WebP 参数时，先生成独立基准目录：

```powershell
npm run webp:benchmark-build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./webp-benchmark-q80" `
  --png-quality=80 `
  --jpeg-quality=80
```

输出目录必须不存在，且不能位于输入构建目录内部。

主要输出：

```text
webp-benchmark-q80/
  web-mobile/                 # 已按收益规则选择候选的构建副本
  originals/                  # 原图
  candidates/                 # WebP 候选
  webp-benchmark-report.json
  webp-preview.html
```

`webp-preview.html` 提供原图和 WebP 候选并排预览。

报告记录：

- PNG/JPEG 数量；
- 宽度、高度和 Alpha；
- 原图、WebP 和最终采用体积；
- 单文件 Brotli Q11 大小；
- 采用与无收益数量；
- 图片子集 Solid Brotli 估算；
- SHA-256；
- 单图编码耗时。

## 5. 独立预览与应用

### 预览

```powershell
npm run webp:optimize-build -- `
  "./web-mobile" `
  --png-quality=80 `
  --jpeg-quality=80 `
  --preview `
  --report="./webp-optimization-preview.json"
```

预览会实际编码候选并生成报告，但不替换图片。

### 应用

```powershell
npm run webp:optimize-build -- `
  "./web-mobile" `
  --png-quality=80 `
  --jpeg-quality=80 `
  --confirm `
  --report="./webp-optimization-apply.json"
```

应用流程使用临时文件和备份文件执行原子替换。失败时会尝试恢复原文件。

独立应用会直接修改传入目录，因此应只对构建副本使用。日常生产更推荐 `playable:build`。

## 6. Pipeline 集成

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7-webp80.html" `
  --image-mode=webp `
  --png-webp-quality=80 `
  --jpeg-webp-quality=80 `
  --payload-encoding=html7 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

同时启用音频压缩：

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

Pipeline 会：

1. 复制干净构建到项目工作区；
2. 扫描 `.png`、`.jpg`、`.jpeg`；
3. 跳过内容已经是 WebP 的文件；
4. 生成候选；
5. 按裸文件与 Brotli 双重收益规则选择；
6. 在工作区副本内原子替换；
7. 执行可选音频优化；
8. 生成 Solid Brotli 单 HTML；
9. 执行 Payload 编码和回退解码器处理；
10. 生成统一报告。

## 7. 报告字段

独立报告：

```text
settings.pngWebpQuality
settings.jpegWebpQuality
settings.alphaQuality
settings.preserveLogicalPaths
summary.scannedImages
summary.optimizedImages
summary.wouldOptimizeImages
summary.noBenefitImages
summary.alreadyWebpImages
summary.beforeBytes
summary.afterBytes
summary.savedBytes
summary.savedPercent
summary.selectedSingleFileBrotliSavingsBytes
```

Pipeline 最终报告：

```text
imageOptimization.mode = "webp"
imageOptimization.settings.pngWebpQuality
imageOptimization.settings.jpegWebpQuality
imageOptimization.settings.alphaQuality = 100
imageOptimization.settings.preserveLogicalPaths = true
```

## 8. 与 Squoosh 路线的区别

### Squoosh

- PNG 仍然是 PNG；
- JPEG 仍然是 JPEG；
- PNG 使用调色板量化 + OxiPNG；
- JPEG 使用 MozJPEG；
- 对现有格式和传统加载环境更保守。

### WebP

- PNG/JPEG 内容统一变为 WebP；
- 通常能继续降低照片、渐变和部分透明纹理体积；
- 需要运行环境能够正常解码 WebP；
- 需要打包器按内容识别 MIME；
- 更依赖真实渠道和浏览器验证。

两条路线是互斥的，不会在同一次 Pipeline 中先 Squoosh 再 WebP，避免重复有损编码。

## 9. 参数选择建议

当前默认基准为：

```text
PNG WebP Q80
JPEG WebP Q80
Alpha Q100
```

参数不应只看总字节数。建议至少比较：

```text
Q90
Q85
Q80
Q75
```

重点观察：

- 小图标边缘；
- 文字贴图；
- 透明渐变；
- 烟雾和发光；
- 大面积颜色渐变；
- JPEG 背景和照片纹理；
- 图集边界和 Alpha 泄漏。

## 10. 自动检查

```powershell
npm run typecheck
npm run test:webp-benchmark
npm run test:webp-optimize
npm run test:image-quality-pipeline
```

测试覆盖编码器初始化、内容 MIME 检测、预览/应用模式、无收益跳过、已是 WebP 跳过、路径保持、参数解析和 Pipeline 报告。

## 11. 真实游戏验收

最终必须对生成的单 HTML 完整试玩：

- 游戏启动和所有场景正常；
- UI、图集、透明边缘和小图标正常；
- 烟雾、发光和渐变正常；
- 浏览器控制台无图片解码或 MIME 异常；
- 不同渠道容器能够解码 WebP；
- 最终 HTML 确实小于 Squoosh 或原图路线；
- 视觉收益与体积收益达到可接受平衡。
