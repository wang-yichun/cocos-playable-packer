# 构建图片优化模式

项目提供三个互斥的构建图片压缩模式：

- `none`：不修改 Cocos Creator 构建图片；
- `tinypng`：使用 TinyPNG API 压缩构建产物中的图片；
- `squoosh`：使用本地 Sharp 调色板量化和 OxiPNG。

正式参数名为：

```text
--image-mode=<none|tinypng|squoosh>
```

旧参数 `--mode` 暂时保留为兼容别名，新命令和文档不再使用它。

## 推荐入口

日常生产建议使用一条命令完成工作副本创建、图片优化和 Brotli 单 HTML 打包：

```powershell
npm run playable:build -- `
  "<Cocos web-mobile 构建目录>" `
  "./dist/game.html" `
  --image-mode=squoosh
```

分阶段排查问题时，仍可独立运行 `images:optimize` 和 `pack:br`。

## 无图片压缩

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=none
```

该模式只校验构建目录，不修改图片。

## TinyPNG

TinyPNG 只处理 Cocos 构建产物，不再包含旧的源图预览、应用计划、恢复和发布前替换流程。

为避免误用 API 配额，必须明确指定 `--all` 或 `--limit=N`。

```powershell
npm run images:optimize -- `
  "./web-mobile" `
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

也可覆盖最小文件体积：

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=tinypng `
  --all `
  --min-bytes=4096
```

## Squoosh 本地模式

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=squoosh
```

默认行为：

1. 检查现有完整 Squoosh 报告能否覆盖当前构建；
2. 已有缓存时跳过重复编码；
3. 新构建或图片变化时运行全量 PNG 本地压缩；
4. 默认 `--min-bytes=0`；
5. 生成备份并将缓存结果应用到工作副本。

只预检、不替换：

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=squoosh `
  --preview
```

高级参数：

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=squoosh `
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

如果同一构建目录同时包含已应用输出和新增或未知 PNG，命令会停止，不会再次量化已有输出。

`playable:build` 默认先复制干净构建到项目工作区，再对副本进行图片压缩，因此日常流程不会修改原始 Cocos 构建目录。

## 缓存

Squoosh 缓存：

```text
.squoosh-cache/build-pngs/<profile>/
```

TinyPNG 构建缓存：

```text
.tinypng-cache/build-images/
```

两个缓存目录都只保存在本地，并由 `.gitignore` 排除。缓存按文件 SHA 共享，不按项目重复保存。
