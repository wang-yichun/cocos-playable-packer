# TinyPNG 构建图片优化

默认只对原图大小不低于 `4096 B` 的新图片调用 TinyPNG。

已有缓存优先于尺寸阈值：

- 当前文件命中 `compressedSha256`：识别为已压缩输出；
- 当前文件命中 `sourceSha256` 压缩缓存：直接缓存替换；
- 当前文件命中 `no-benefit`：负缓存跳过；
- 只有未命中缓存的新图片才检查 `--min-bytes`。

## 限量处理

```powershell
npm run tinypng:build -- -- `
  "./web-mobile" `
  --limit=5
```

## 全量处理

默认最小原图大小为 `4096 B`：

```powershell
npm run tinypng:build -- -- `
  "./web-mobile" `
  --all
```

## 调整最小原图尺寸

```powershell
npm run tinypng:build -- -- `
  "./web-mobile" `
  --all `
  --min-bytes=2048
```

## 强制处理所有尺寸的新图片

```powershell
npm run tinypng:build -- -- `
  "./web-mobile" `
  --all `
  --min-bytes=0
```

## 缓存位置

```text
.tinypng-cache/build-images/
├─ index.json
├─ files/
└─ reports/
   ├─ latest.json
   └─ report-<timestamp>.json
```

尺寸策略跳过只写入运行报告，不写入 `no-benefit` 负缓存。以后降低阈值时，这些图片仍可正常进入 TinyPNG。

该优化器独立于单 HTML 打包逻辑，不会调用或修改 `src/pack-compressed.ts`。
