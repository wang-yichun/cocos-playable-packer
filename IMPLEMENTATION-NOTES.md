# TinyPNG 构建图片优化器（第一阶段）

新增独立命令：

```powershell
npm run tinypng:build -- -- `
  "./web-mobile" `
  --limit=5
```

全量处理：

```powershell
npm run tinypng:build -- -- `
  "./web-mobile" `
  --all
```

缓存位置：

```text
.tinypng-cache/build-images/
├─ index.json
├─ files/
└─ reports/
   ├─ latest.json
   └─ report-<timestamp>.json
```

本阶段不会调用或修改 `src/pack-compressed.ts`。
