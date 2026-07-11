# Playable Pipeline Payload 编码

## 目标

`playable:build` 现在统一支持三种 Brotli Payload 文本编码：

```text
base64
base91
html7
```

图片压缩、Brotli 压缩、单 HTML 打包和 Payload 编码由同一条命令完成。

## 参数

```text
--payload-encoding=<base64|base91|html7>
```

未指定时默认使用：

```text
base64
```

### base64

兼容性最高，作为默认模式。

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-base64.html" `
  --image-mode=squoosh `
  --payload-encoding=base64 `
  --project=game141
```

### base91

使用 Safe Base91 可打印 ASCII 编码。相比 Base64 通常可减少约 7% 的最终 HTML 体积。

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-base91.html" `
  --image-mode=squoosh `
  --payload-encoding=base91 `
  --project=game141
```

### html7

使用 HTML-safe 7-bit / Base122 风格编码。相比 Base64 通常可减少约 13% 的最终 HTML 体积。

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7.html" `
  --image-mode=squoosh `
  --payload-encoding=html7 `
  --project=game141
```

HTML7 是极限模式。它已经通过本地浏览器完整试玩验证，但正式投放前仍应在目标渠道验证：

- 上传后文件是否被重新编码；
- HTML 是否被格式化或清洗；
- 下载后的 SHA-256 是否保持一致；
- Android WebView、WKWebView 和广告渠道容器是否正常运行。

## 流程

```text
复制 Cocos 构建目录
    ↓
图片压缩
    ↓
Brotli + Base64 基线打包
    ↓
按 payload-encoding 选择：
    base64：直接使用基线
    base91：转换为 Safe Base91
    html7：转换为 HTML-safe 7-bit
    ↓
完整性校验
    ↓
原子替换最终 HTML 和报告
    ↓
成功后清理临时文件和工作区
```

无论选择哪种模式，Brotli 二进制内容保持一致。

## 报告

最终报告仍生成在输出 HTML 旁边：

```text
dist/game-html7.report.json
```

报告版本升级为：

```json
{
  "schemaVersion": 2
}
```

新增：

```text
payloadEncoding.mode
payloadEncoding.base64HtmlBytes
payloadEncoding.outputHtmlBytes
payloadEncoding.savedBytes
payloadEncoding.savedPercent
payloadEncoding.details

timingMs.payloadEncoding
```

`details` 中会保留 Base91 或 HTML7 的 Payload 大小、Brotli SHA-256、编码耗时、解码耗时和回环校验结果，但不会保留已删除临时文件的路径。

## 失败保护

Pipeline 会先生成临时 HTML，再同时替换最终 HTML 和最终报告。

如果图片压缩、Brotli 打包、Payload 编码、完整性检查或文件替换失败：

- 不覆盖已有成功 HTML；
- 不覆盖已有成功报告；
- 保留本次工作区；
- 在工作区写入 `failure.json`；
- 清理输出目录中的临时 HTML 和临时报告。

## 独立研究命令

独立后处理命令继续保留，便于基准测试和算法研究：

```powershell
npm run encoding:base91 -- `
  "./dist/game-base64.html" `
  "./dist/game-base91.html" `
  --iterations=3
```

```powershell
npm run encoding:html7 -- `
  "./dist/game-base64.html" `
  "./dist/game-html7.html" `
  --iterations=3
```

日常生产构建优先使用统一的 `playable:build`。
