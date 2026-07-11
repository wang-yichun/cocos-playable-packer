# Squoosh JPEG 构建图片优化

## 问题

此前生产 Squoosh 流程只处理 PNG：

- 统一入口仅扫描 `.png`；
- 批量基准脚本为 `benchmark-build-pngs.ts`；
- 应用脚本为 `apply-build-png-cache.ts`；
- `.jpg` 和 `.jpeg` 不会进入 Squoosh 缓存、压缩或写回流程。

仓库原有 `squoosh:test-one` 已经具备 `@jsquash/jpeg` 的 MozJPEG 编解码能力，但仅用于单图冒烟测试。

## 新流程

`images:optimize --mode=squoosh` 和 `playable:build --image-mode=squoosh` 现在按顺序执行：

1. 原有 PNG quantization + OxiPNG 流程；
2. JPEG MozJPEG 基准与缓存；
3. 按最低收益策略应用 JPG/JPEG 缓存；
4. 继续 Brotli、Payload 编码和回退解码器处理。

PNG 流程及其缓存格式保持不变。

JPEG 流程会：

- 递归扫描 `.jpg` 和 `.jpeg`；
- 按 SHA-256 去重，同内容只编码一次；
- 使用 MozJPEG 重新编码；
- 校验压缩前后格式、宽度和高度；
- 保留原文件扩展名和引用路径；
- 缓存压缩成功和无收益结果；
- 识别已应用的同质量输出，避免重复有损压缩；
- 检测其他 JPEG 质量配置的历史输出并拒绝二次压缩；
- 检测 TinyPNG 缓存输出并要求重新生成干净构建；
- 应用前备份文件，写入失败时回滚已替换文件；
- 生成基准报告和应用清单。

## 有损压缩最低收益策略

JPEG 重新编码是有损操作。即使输出只小几个字节，也不应为了无意义的体积收益替换原图。

默认只有同时满足以下条件才应用 MozJPEG 输出：

```text
至少减少 128 B
至少减少 1%
```

例如一张 `10,400 B` 的图片只减少 `22 B（0.21%）` 时，会保留原图。

独立 JPEG 命令可覆盖门槛：

```text
--min-savings-bytes=128
--min-savings-percent=1
```

## PNG 与 JPEG 质量参数

正式参数：

```text
--png-quality=80
--jpeg-quality=80
```

范围：

```text
PNG：0 到 100
JPEG：1 到 100
```

PNG 参数控制 Sharp 调色板量化质量。JPEG 参数控制 MozJPEG 的亮度与色度质量。

旧参数仍可使用：

```text
--quality=80
```

它是 `--png-quality=80` 的兼容别名，执行时会输出弃用警告。`--quality` 与 `--png-quality` 不能同时指定。

PNG 还可单独设置：

```text
--colours=256
--effort=10
--dither=0.5
--oxipng-level=3
```

其中 `--oxipng-level` 是无损优化等级，不是画质参数。

## 统一图片预览

```powershell
npm run images:optimize -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --preview
```

预览会建立 PNG/JPEG 缓存、基准报告和应用计划，但不会替换构建目录中的图片。

JPEG 基准报告：

```text
.squoosh-cache/build-jpegs/q80/reports/latest.json
```

JPEG 应用计划：

```text
.squoosh-cache/build-jpegs/q80/manifests/latest.json
```

## 统一图片应用

必须使用干净的 Cocos Creator `web-mobile` 构建目录：

```powershell
npm run images:optimize -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80
```

JPEG 备份目录：

```text
.squoosh-cache/build-jpegs/q80/backups/<时间戳>/
```

## 正式 Playable Pipeline

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7.html" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --payload-encoding=html7 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

Pipeline 会在工作区副本中依次处理 PNG 和 JPEG，不会修改输入构建目录。最终 `.report.json` 的 `imageOptimization.settings` 会记录：

```json
{
  "pngQuality": 80,
  "jpegQuality": 80
}
```

## 独立运行 JPEG

预览：

```powershell
npm run squoosh:optimize-build-jpegs -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --quality=80
```

确认应用：

```powershell
npm run squoosh:optimize-build-jpegs -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --quality=80 `
  --confirm
```

自定义最低收益：

```powershell
npm run squoosh:optimize-build-jpegs -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --quality=80 `
  --min-savings-bytes=256 `
  --min-savings-percent=2 `
  --confirm
```

## 自动检查

```powershell
npm run typecheck
npm run test:squoosh-jpeg
npm run test:image-quality-pipeline
```

## 真实游戏验收

应用或 Pipeline 完成后重点检查：

- JPG/JPEG 扫描数量是否与构建目录一致；
- 输出文件是否仍为原来的 `.jpg` 或 `.jpeg` 路径；
- 游戏是否正常启动；
- 所有场景是否可进入；
- 背景、照片类纹理和大面积渐变是否出现色带或块状失真；
- UI、图集、透明 PNG 是否不受影响；
- 浏览器控制台是否无新增异常；
- 最终 Brotli HTML 是否进一步减小；
- 最终报告中的 PNG/JPEG 质量是否与命令一致。

功能通过真实游戏验证前，不合并到 `master`。
