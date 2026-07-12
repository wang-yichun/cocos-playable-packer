# 构建图片优化模式

项目提供四个互斥的构建图片处理模式：

- `none`：不修改 Cocos Creator 构建图片；
- `tinypng`：通过 TinyPNG API 压缩构建产物；
- `squoosh`：本地处理 PNG 与 JPEG；
- `webp`：将 PNG/JPEG 内容编码为 WebP，同时保留原逻辑路径。

正式参数：

```text
--image-mode=<none|tinypng|squoosh|webp>
```

旧参数 `--mode` 仍作为兼容别名，但新命令和文档不再使用。

## 1. 技术路线概况

| 模式 | PNG | JPEG | 核心实现 |
| --- | --- | --- | --- |
| `none` | 原样保留 | 原样保留 | 文件复制与校验 |
| `tinypng` | TinyPNG API | TinyPNG API | `tinify` |
| `squoosh` | Sharp 调色板量化，再经 OxiPNG 无损优化 | MozJPEG 重新编码 | `sharp`、`@jsquash/oxipng`、`@jsquash/jpeg` |
| `webp` | 有损 WebP，Alpha 质量固定 100 | 有损 WebP | `sharp`、`@jsquash/webp` |

这里的“Squoosh”指本地采用 Squoosh 同类编解码组件的生产路线，不依赖 `squoosh.app` 网站。

## 2. 推荐入口

日常生产使用 Pipeline：

```powershell
npm run playable:build -- `
  "<Cocos web-mobile 构建目录>" `
  "./dist/game.html" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80
```

Pipeline 会先复制输入构建，再在工作区副本中处理图片，不修改原始 Cocos 构建目录。

分阶段排查时使用独立入口：

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --preview
```

## 3. 无图片处理

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-none.html" `
  --image-mode=none
```

该模式仍会执行工作区复制、Brotli 打包、Payload 编码和报告生成。

## 4. TinyPNG 模式

TinyPNG 只处理 Cocos 构建产物，不包含旧的源图预览、应用计划、恢复和发布前替换流程。

为避免误用 API 配额，必须明确指定 `--all` 或 `--limit=N`：

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-tinypng.html" `
  --image-mode=tinypng `
  --all
```

限量处理：

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=tinypng `
  --limit=5
```

最小文件体积可通过以下参数覆盖：

```text
--min-bytes=4096
```

TinyPNG 构建缓存：

```text
.tinypng-cache/build-images/
```

## 5. Squoosh PNG 路线

PNG 处理分为两层：

1. `sharp` 执行调色板量化，降低颜色表示成本；
2. `@jsquash/oxipng` 对量化结果做无损 PNG 重排与压缩。

生产命令：

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-squoosh.html" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --colours=256 `
  --effort=10 `
  --dither=0.5 `
  --oxipng-level=3
```

参数含义：

```text
--png-quality=80    PNG 调色板量化质量，范围 0-100
--colours=256       最大调色板颜色数，范围 2-256
--effort=10         量化搜索强度，范围 1-10
--dither=0.5        抖动强度，范围 0-1
--oxipng-level=3    OxiPNG 无损优化等级，范围 1-6
```

`--oxipng-level` 不改变画质，只影响无损压缩搜索强度和耗时。

Squoosh PNG 生产流程要求：

```text
--min-bytes=0
```

Pipeline 已使用该安全值。独立命令传入其他值会拒绝执行。

## 6. Squoosh JPEG 路线

JPEG 使用 `@jsquash/jpeg` 提供的 MozJPEG 编码器。

```text
--jpeg-quality=80
```

范围为 1-100。生产流程会：

- 递归扫描 `.jpg` 和 `.jpeg`；
- 按 SHA-256 去重并缓存；
- 校验格式、宽度和高度；
- 保留原扩展名和引用路径；
- 防止对已应用输出再次有损压缩；
- 只在达到最低收益时替换。

默认最低收益策略：

```text
至少减少 128 B
并且至少减少 1%
```

独立 JPEG 命令：

```powershell
npm run squoosh:optimize-build-jpegs -- `
  "./web-mobile" `
  --quality=80 `
  --confirm
```

## 7. WebP 路线

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-webp.html" `
  --image-mode=webp `
  --png-webp-quality=80 `
  --jpeg-webp-quality=80
```

编码参数：

```text
libwebp method=6
alpha_quality=100
alpha_compression=1
exact=1
lossless=0
```

WebP 候选只有在以下两项都成立时才写入工作副本：

1. WebP 文件本身小于原图；
2. WebP 单文件 Brotli Q11 大小也小于原图的 Brotli Q11 大小。

生产流程不会把路径从 `.png` 或 `.jpg` 改成 `.webp`。文件内容会变为 WebP，打包器通过 Magic Bytes 识别 MIME 类型，因此不需要修改 Cocos 资源引用。

独立 WebP 预览：

```powershell
npm run webp:optimize-build -- `
  "./web-mobile" `
  --png-quality=80 `
  --jpeg-quality=80 `
  --preview `
  --report="./webp-optimization-preview.json"
```

独立 WebP 应用：

```powershell
npm run webp:optimize-build -- `
  "./web-mobile" `
  --png-quality=80 `
  --jpeg-quality=80 `
  --confirm `
  --report="./webp-optimization-apply.json"
```

批量视觉基准、原图/候选预览和构建副本说明见 [WebP 路线说明](webp-optimization.md)。

## 8. 防止二次有损压缩

Squoosh PNG/JPEG 流程会记录源文件与已应用输出的哈希。检测到混合状态、历史质量配置输出或未知内容时，会停止而不是继续有损编码。

最稳妥的生产输入始终是 Cocos Creator 重新生成的干净 `web-mobile` 构建。

`playable:build` 在工作区副本中处理资源，可以降低误修改输入构建的风险，但不能把已经压缩过的输入自动还原为原图。

## 9. 缓存

```text
.squoosh-cache/build-pngs/<profile>/
.squoosh-cache/build-jpegs/<profile>/
.tinypng-cache/build-images/
```

这些目录按文件内容哈希复用，只保存在本地，并由 `.gitignore` 排除。

WebP 当前采用工作区内即时编码和 JSON 报告，不使用上述 Squoosh 缓存格式。

## 10. 验收重点

图片路线变更后应完整试玩并检查：

- 所有场景和 UI 是否正常；
- 图集、小图标和文字是否清晰；
- 透明边缘是否出现黑边、白边或锯齿；
- 烟雾、发光、渐变和半透明效果是否异常；
- JPEG 背景或照片类纹理是否出现明显色带和块状失真；
- 浏览器控制台是否出现 MIME、解码或资源加载异常；
- 最终 HTML 是否确实减小。
