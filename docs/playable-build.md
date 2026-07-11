# Playable 一键构建

`playable:build` 用于从干净的 Cocos Creator Web Mobile 构建生成最终单 HTML。

流程：

1. 验证输入目录和 `index.html`；
2. 将构建复制到项目隔离的临时工作区；
3. 按图片压缩模式处理工作副本；
4. 执行 Brotli 单 HTML 打包；
5. 校验输出文件并原子替换目标 HTML；
6. 生成输出报告和项目历史报告；
7. 成功时清理临时副本，失败时保留现场。

## Squoosh

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-squoosh.html" `
  --image-mode=squoosh
```

## TinyPNG

TinyPNG 必须明确指定 API 使用范围：

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-tinypng.html" `
  --image-mode=tinypng `
  --all
```

限量处理：

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-tinypng-preview.html" `
  --image-mode=tinypng `
  --limit=20
```

## 不压缩图片

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-original.html" `
  --image-mode=none
```

## 项目工作区

默认会从输入路径推断项目名称，并附加输入路径的 8 位 SHA-256 短哈希，避免不同位置的同名项目冲突：

```text
workspaces/<项目名-路径哈希>/
  runs/<时间戳>/web-mobile/
  reports/<时间戳>.json
```

也可以显式指定项目名：

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-squoosh.html" `
  --image-mode=squoosh `
  --project=game141
```

显式项目名由使用者负责保持唯一。

成功后默认删除 `runs/<时间戳>` 中的构建副本，但保留 `reports` 中的小型 JSON 报告。需要检查中间产物时使用：

```text
--keep-workspace
```

失败时无论是否传入该参数，都会保留工作区并写入：

```text
failure.json
```

## 输出报告

假设输出为：

```text
dist/game-squoosh.html
```

则同时生成：

```text
dist/game-squoosh.report.json
workspaces/<项目>/reports/<时间戳>.json
```

报告包含：

- 输入文件数与原始体积；
- 图片数量及优化前后体积；
- 图片减少大小与百分比；
- 最终 HTML 大小和 SHA-256；
- 复制、图片优化、打包和总流程耗时；
- 工作区路径和是否保留。

底层 `pack:br` 仍会打印 SystemJS、Brotli、模块数量等详细统计。

## 安全规则

- 不修改用户传入的原始 Cocos 构建目录；
- 输出 HTML 不允许位于输入目录内部；
- 最终 HTML 使用临时文件构建，成功后再替换目标文件；
- 打包失败时不会覆盖已有成功输出；
- 工作区、缓存和报告不会提交到 Git；
- Squoosh 生产模式固定要求 `minBytes=0`；
- TinyPNG 必须显式指定 `--all` 或 `--limit=N`。
