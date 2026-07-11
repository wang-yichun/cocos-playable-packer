# Brotli HTML-safe 7-bit 编码研究

## 目标

在保留 Brotli 压缩、Cocos 归档、SystemJS 处理和 JavaScript Brotli 回退的前提下，进一步降低单 HTML 中 Payload 的文本承载开销。

当前已保留两种独立实验方案：

- `encoding:base91`：Safe Base91，兼容性优先；
- `encoding:html7`：HTML-safe 7-bit，体积极限优先。

正式 `pack:br` 和 `playable:build` 仍默认输出 Base64，不会被实验命令修改。

## 设计

HTML-safe 7-bit 先把 Brotli 二进制连续打包为 7-bit 值，理论文本开销为：

```text
8 / 7 - 1 = 14.2857%
```

Payload 放在不执行的 Script Data 容器中：

```html
<script
  id="__PACK_HTML7_PAYLOAD__"
  type="application/x-playable-payload"
>...</script>
```

运行时通过 `textContent` 读取并恢复 Brotli 二进制。

以下 8 个值不会直接写进 HTML：

```text
0    NUL
9    TAB
10   LF
12   FF
13   CR
26   SUB
60   <
127  DEL
```

遇到这些值时，编码器会把它与后一个 7-bit 值组合成一个两字节 UTF-8 字符。转义码点表满足：

- 每个码点最多 U+07FF，因此 UTF-8 固定占两字节；
- 不使用控制、格式、代理、私用、未分配、分隔或组合字符；
- 编码结果对 UTF-8、NFC 和 NFKC 回环稳定；
- 原始 `<` 永远不会出现在 Payload 中，因此不会形成 `</script>`。

## 使用方法

先生成 Base64 基线：

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-squoosh.html" `
  --image-mode=squoosh `
  --project=game141
```

生成 HTML-safe 7-bit 版本：

```powershell
npm run encoding:html7 -- `
  "./dist/game-squoosh.html" `
  "./dist/game-squoosh-html7.html" `
  --iterations=3
```

同时保留 Safe Base91 对照版本：

```powershell
npm run encoding:base91 -- `
  "./dist/game-squoosh.html" `
  "./dist/game-squoosh-base91.html" `
  --iterations=3
```

生成：

```text
dist/game-squoosh-html7.html
dist/game-squoosh-html7.encoding-report.json
```

通过 HTTP 服务测试：

```powershell
npm run serve
```

不要使用 `file://` 直接打开。

## 控制台观察项

HTML7 版本会额外打印：

```text
[Playable Packer] HTML-safe 7-bit 解码完成：... MB
```

随后仍会打印 Brotli 原生或 JavaScript 回退解压日志。

需要检查：

- 游戏是否正常启动；
- 所有场景、UI、图集、音频和物理是否正常；
- 浏览器控制台是否有异常；
- HTML-safe 7-bit 解码耗时；
- Brotli 解压耗时；
- 页面到可交互的总时间；
- 最终 HTML 是否能被渠道上传、保存和再次下载后保持 SHA。

## 报告字段

JSON 报告包含：

- Brotli 二进制大小和 SHA-256；
- Base64、Base91 和 HTML7 Payload 大小；
- 三种编码的文本开销率；
- HTML7 相对 Base64 和 Base91 的节省；
- 浏览器解码器大小；
- Node 编码与解码耗时；
- UTF-8、NFC、NFKC 和二进制回环结果；
- 最终 HTML 大小、SHA-256 和节省比例。

## 当前阶段边界

本功能仍是实验性后处理命令：

- 默认 Base64 不变；
- Safe Base91 继续保留；
- 输入必须是当前工具生成的 Brotli + Base64 HTML；
- 输入和输出不能是同一路径；
- 任一安全检查或二进制回环失败都会停止生成；
- 实机和渠道验证通过后，再考虑加入 `playable:build` 的正式编码选项。
