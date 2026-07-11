# Squoosh JPEG 构建图片优化

## 问题

此前生产 Squoosh 流程只处理 PNG：

- 统一入口仅扫描 `.png`；
- 批量基准脚本为 `benchmark-build-pngs.ts`；
- 应用脚本为 `apply-build-png-cache.ts`；
- `.jpg` 和 `.jpeg` 不会进入 Squoosh 缓存、压缩或写回流程。

仓库原有 `squoosh:test-one` 已经具备 `@jsquash/jpeg` 的 MozJPEG 编解码能力，但仅用于单图冒烟测试。

## 新流程

`images:optimize --mode=squoosh` 现在按顺序执行：

1. 原有 PNG quantization + OxiPNG 流程；
2. 新增 JPG/JPEG MozJPEG 流程。

PNG 流程及其缓存格式保持不变。

JPEG 流程会：

- 递归扫描 `.jpg` 和 `.jpeg`；
- 按 SHA-256 去重，同内容只编码一次；
- 使用 MozJPEG 重新编码；
- 校验压缩前后格式、宽度和高度；
- 仅当输出更小时才替换；
- 保留原文件扩展名和引用路径；
- 缓存压缩成功和无收益结果；
- 识别已应用的同质量输出，避免重复有损压缩；
- 检测其他 JPEG 质量配置的历史输出并拒绝二次压缩；
- 检测 TinyPNG 缓存输出并要求重新生成干净构建；
- 应用前备份文件，写入失败时回滚已替换文件；
- 生成 JSON 报告。

## 参数

默认 JPEG 质量：

```text
80
```

统一构建命令可以使用：

```text
--jpeg-quality=80
```

范围为 `1` 到 `100`。

PNG 原有 `--quality` 参数与 JPEG 的 `--jpeg-quality` 相互独立。

## 预览

```powershell
npm run images:optimize -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --mode=squoosh `
  --jpeg-quality=80 `
  --preview
```

预览会建立 PNG/JPEG 缓存和报告，但不会替换构建目录中的图片。

JPEG 报告：

```text
.squoosh-cache/build-jpegs/q80/reports/latest.json
```

## 应用

必须使用干净的 Cocos Creator `web-mobile` 构建目录：

```powershell
npm run images:optimize -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --mode=squoosh `
  --jpeg-quality=80
```

JPEG 备份目录：

```text
.squoosh-cache/build-jpegs/q80/backups/<时间戳>/
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

## 自动检查

```powershell
npm run typecheck
npm run test:squoosh-jpeg
```

## 真实游戏验收

应用后重点检查：

- JPG/JPEG 扫描数量是否与构建目录一致；
- 输出文件是否仍为原来的 `.jpg` 或 `.jpeg` 路径；
- 游戏是否正常启动；
- 所有场景是否可进入；
- 背景、照片类纹理和大面积渐变是否出现色带或块状失真；
- UI、图集、透明 PNG 是否不受影响；
- 浏览器控制台是否无新增异常；
- 最终 Brotli HTML 是否进一步减小。

功能通过真实游戏验证前，不合并到 `master`。
