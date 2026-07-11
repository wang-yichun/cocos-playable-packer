# 构建图片优化模式

项目保留三个互斥的构建图片处理模式：

- `none`：不修改 Cocos Creator 构建图片；
- `tinypng`：使用现有 TinyPNG 构建缓存/API 流程；
- `squoosh`：使用本地 Sharp 调色板量化和 OxiPNG。

现有实验及诊断命令全部保留，统一入口只负责生产流程编排。

## 安装统一命令

```powershell
npm pkg set `
  "scripts.images:optimize=tsx src/images/optimize-build-images.ts"
```

## 无图片压缩

```powershell
npm run images:optimize -- -- `
  "./web-mobile" `
  --mode=none
```

该模式只校验构建目录，不修改图片。

## TinyPNG

为避免误用 API 配额，必须明确指定 `--all` 或 `--limit=N`。

```powershell
npm run images:optimize -- -- `
  "./web-mobile" `
  --mode=tinypng `
  --all
```

限量处理：

```powershell
npm run images:optimize -- -- `
  "./web-mobile" `
  --mode=tinypng `
  --limit=5
```

默认沿用 TinyPNG 构建工具的最小体积策略。也可覆盖：

```powershell
npm run images:optimize -- -- `
  "./web-mobile" `
  --mode=tinypng `
  --all `
  --min-bytes=4096
```

## Squoosh 本地模式

```powershell
npm run images:optimize -- -- `
  "./web-mobile" `
  --mode=squoosh
```

默认行为：

1. 检查现有完整 Squoosh 报告能否覆盖当前构建；
2. 已有缓存时跳过重复编码；
3. 新构建或图片变化时运行全量 PNG 本地压缩；
4. 默认 `--min-bytes=0`；
5. 生成备份并将缓存结果应用到构建目录。

只预检、不替换：

```powershell
npm run images:optimize -- -- `
  "./web-mobile" `
  --mode=squoosh `
  --preview
```

高级参数：

```powershell
npm run images:optimize -- -- `
  "./web-mobile" `
  --mode=squoosh `
  --quality=80 `
  --colours=256 `
  --effort=10 `
  --dither=0.5 `
  --oxipng-level=3 `
  --min-bytes=0
```

## 防止二次有损压缩

统一入口会将当前 PNG 分为：

- 报告中的原图；
- 报告中的已应用 Squoosh 输出；
- 新增或未知内容。

如果同一构建目录同时包含已应用输出和新增/未知 PNG，命令会停止，不会再次量化已有输出。此时应先在 Cocos Creator 中重新生成干净的 `web-mobile` 构建。

`apply-build-png-cache.ts` 还会校验当前 PNG 路径集合与报告完全一致，防止旧报告漏处理新资源。

## 打包

图片模式执行成功后，继续使用现有 Brotli 打包流程：

```powershell
npm run pack:br -- -- `
  "./web-mobile" `
  "./dist/game-compressed.html"
```

## 缓存与备份

Squoosh 缓存：

```text
.squoosh-cache/build-pngs/<profile>/
```

应用前备份：

```text
.squoosh-cache/build-pngs/<profile>/backups/<timestamp>/
```

TinyPNG 缓存保持原位置：

```text
.tinypng-cache/build-images/
```
