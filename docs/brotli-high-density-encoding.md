# Brotli 高密度文本编码研究

## 目标

当前正式方案将 Brotli 二进制通过 Base64 放入单 HTML。

本阶段只研究文本承载层，不改变：

- Brotli 压缩算法；
- Cocos 资源归档格式；
- SystemJS 和 Bundle 处理；
- Brotli 原生解码和 JavaScript 回退逻辑。

首个候选为 Safe Base91。

## 为什么先测试 Safe Base91

Safe Base91 只使用单字节可打印 ASCII，并排除：

- `"`：避免 JSON 和 JavaScript 双引号字符串转义；
- `\`：避免反斜杠转义；
- `<`：避免在 `<script>` 中形成 `</script>` 或触发 HTML 脚本解析状态切换。

它不能达到理论 7-bit 的 `8 / 7` 开销，但比 Base64 更密集，同时比控制字符型 7-bit 和 Base122 更适合商业版本的第一轮实机验证。

实现为项目自有 TypeScript 代码，没有增加第三方运行依赖。

## 当前阶段的安全边界

本功能是独立后处理命令：

- 不修改 `pack:br` 的默认 Base64 输出；
- 不修改 `playable:build` 的正式流程；
- 输入必须是当前项目生成的 Brotli + Base64 HTML；
- 生成单独的 Base91 HTML 和 JSON 报告；
- 只有实际浏览器和渠道验证通过后，才考虑加入正式构建参数。

## 使用方法

先生成当前 Base64 基线：

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-squoosh.html" `
  --image-mode=squoosh `
  --project=game141
```

再转换为 Safe Base91：

```powershell
npm run encoding:base91 -- `
  "./dist/game-squoosh.html" `
  "./dist/game-squoosh-base91.html" `
  --iterations=3
```

生成：

```text
dist/game-squoosh-base91.html
dist/game-squoosh-base91.encoding-report.json
```

随后启动 HTTP 服务：

```powershell
npm run serve
```

不要使用 `file://` 直接打开。

## 控制台观察项

Base91 版会额外打印：

```text
[Playable Packer] Safe Base91 解码完成：... MB，... ms
```

随后仍会打印 Brotli 解压方式和解压耗时。

需要分别记录：

- Safe Base91 文本解码耗时；
- Brotli 解压耗时；
- 从加载页面到游戏可交互的总时间；
- 浏览器控制台异常；
- 完整试玩结果。

## JSON 报告

报告包含：

- 输入 HTML 大小和 SHA-256；
- Brotli 二进制大小和 SHA-256；
- Base64 和 Base91 的字符数、嵌入字节数和开销；
- Payload 减少字节数和百分比；
- 实际注入浏览器解码器大小；
- Node 端编码和解码耗时；
- Base91 回环校验结果；
- 输出 HTML 大小、SHA-256 和最终减少体积。

## 失败保护

命令会在以下情况停止：

- 输入不是当前 Brotli HTML；
- 输入已经使用其他文本编码；
- 找不到归档 JSON；
- 找不到当前 Base64 浏览器解码函数；
- 找不到 Base64 Payload 解码调用；
- Base91 编解码回环不一致；
- 输入和输出路径相同。

如果打包器运行模板以后发生变化，后处理命令会明确失败，而不是生成结构不确定的 HTML。

## 后续判断标准

只有同时满足以下条件，才将 Safe Base91 接入 `playable:build`：

1. 最终 HTML 体积有稳定收益；
2. Base91 解码耗时可接受；
3. Chrome、Edge、Android WebView 和 WKWebView 验证通过；
4. 目标广告渠道上传后文件未被二次改写；
5. 游戏所有场景、UI、图集、音频和物理逻辑正常；
6. 默认 Base64 仍作为最高兼容模式保留。
