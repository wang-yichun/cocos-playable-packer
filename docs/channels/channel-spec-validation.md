# 渠道产物规范校验

`channel:validate` 用于对已经生成的渠道 HTML 或 ZIP 做静态规范检查。

首版验证器不会自动接入 Playable 构建流程。先通过真实产物观察规则是否存在误报，确认稳定后再考虑将确定性错误接入 Pipeline。

## 使用方式

```powershell
npm run channel:validate -- `
  ".\dist\moloco-playable.html" `
  --platform=Moloco
```

指定报告文件：

```powershell
npm run channel:validate -- `
  ".\dist\google-playable.zip" `
  --platform=Google `
  --report=".\dist\google-channel-validation.json"
```

未指定 `--report` 时，报告默认生成在产物旁边：

```text
<产物文件>.channel-validation.json
```

支持的渠道名称：

```text
Preview
AppLovin
Google
Facebook
Liftoff
IronSource
Unity
Moloco
```

## 退出码

- 没有确定性错误：退出码 `0`；允许存在待人工验证警告。
- 存在确定性错误：退出码 `1`；报告仍会正常写入。
- 参数、文件或 ZIP 无效：退出码 `1`。

## 静态扫描边界

静态校验只能确认产物文本和包结构，不能证明某段兼容代码是否会在运行时执行。

Cocos Creator 和第三方运行库可能保留 `XMLHttpRequest` 兼容分支，即使最终单文件 Playable 的资源全部来自内嵌 Payload。因此：

- 出现 `XMLHttpRequest` 字样时输出 `XMLHTTPREQUEST_REFERENCE_PRESENT` 警告；
- 该警告不会单独导致 `valid: false`；
- 真正的违规应由渠道预览、浏览器网络面板或后续运行时网络拦截测试确认；
- 外部 URL、外部脚本和远程资源引用仍属于高置信度静态问题，可继续判为错误。

## 当前规则

### AppLovin

- 单 HTML；
- 最大 5,000,000 B；
- 要求 `mraid.open()`；
- 要求 MRAID `viewableChange` 启动门控；
- 禁止外部资源和自行打包 `mraid.js`；
- `XMLHttpRequest` 文本引用先记为静态警告；
- 首次交互前静音仍需实机确认。

### Google App Campaign

- ZIP，当前 Packer 结构为 `index.html + res.js`；
- 最大 5,000,000 B；
- 最多 512 个文件；
- 要求官方 `exitapi.js` 和 `ExitApi.exit()`；
- 缺少 `ad.orientation` 或 `ad.size` 时先记为警告；
- 仍需 Google Ads HTML5 Validator 和真实上传验证。

### Liftoff

- 当前 Packer 结构为根目录仅包含 `index.html` 的 ZIP；
- 5,000,000 B 作为建议阈值，超过时先记为警告；
- 要求 MRAID CTA 和 `viewableChange` 启动门控；
- `mraid.open(storeUrl)` 与官方无参数示例之间的差异先记为警告；
- 需要确认目标产品线不是旧 Direct Adaptive Creative 协议。

### Unity Ads

- 单 HTML；
- 最大 5,000,000 B；
- 要求 MRAID CTA 和 `viewableChange` 启动门控；
- 禁止外部资源和自行打包 `mraid.js`；
- `XMLHttpRequest` 文本引用先记为静态警告；
- 仍需 Unity Ads Ad Testing App 真机验证。

### Moloco

- 单 HTML；
- 最大 5,000,000 B；
- 要求无参数 `FbPlayableAd.onCTAClick()`；
- 禁止外部资源和自行打包 `mraid.js`；
- `XMLHttpRequest` 文本引用先记为静态警告；
- JavaScript 跳转回退当前先记为警告，后续应从 Moloco 专用产物中移除；
- 仍需 Moloco Ads Manager Preview 验证。

### Facebook 与 IronSource

公开可核验的最新独立 Playable 规范仍不完整，因此首版只检查当前兼容基线，并始终输出“官方规范待验证”警告，不将未知规则当作构建错误。

## 自测试

```powershell
npm run typecheck
npm run test:channel-spec-validation
```

完整 Web/渠道回归：

```powershell
npm run test:web-mvp
```
