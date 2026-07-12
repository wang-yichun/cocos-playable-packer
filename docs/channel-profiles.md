# 渠道 Profile 与适配状态

渠道 Profile 用于把同一份 Cocos Playable 构建结果映射到不同广告渠道的交付规则。

当前已经完成：

- 八个渠道 Profile；
- Web 页面渠道选择；
- Android / iOS 商店地址输入与校验；
- `window.xsd_playable.download()` / `install()` 下载桥；
- Google `ExitApi.exit()`、Facebook CTA、MRAID `open()` 的宿主优先调用；
- 本地缺少宿主 API 时回退到商店地址；
- MRAID `ready` / `viewableChange` 延迟启动；
- MRAID 尺寸和音量事件转发；
- 在线试玩 MRAID 模拟器；
- Google、Facebook、Liftoff 的 ZIP 交付；
- AppLovin、IronSource、Unity Ads、Moloco 的单 HTML 交付；
- 下载报告中的渠道元数据、交付文件大小和 SHA-256。

当前仍属于发布阶段工作，而不是代码缺失：

- 各渠道官方 Validator 或投放后台验证；
- AppLovin 专用 Analytics 事件映射；
- Moloco 当前正式接口与历史兼容接口的最终确认；
- 不同广告主账户下的包体上限和审核差异。

## 渠道矩阵

| 渠道 | 交付格式 | 桥接方式 | 启动策略 | 当前实现 |
|---|---|---|---|---|
| Preview | 单 HTML | 商店链接回退 | window load | 可用 |
| AppLovin | 单 HTML | MRAID | MRAID viewable | `applovin-playable.html` |
| Google | ZIP：`index.html + res.js` | ExitApi | window load | `google-playable.zip` |
| Facebook | ZIP：`index.html + res.js` | Facebook CTA | window load | `facebook-playable.zip` |
| Liftoff | ZIP：单 `index.html` | MRAID | MRAID viewable | `liftoff-playable.zip` |
| IronSource | 单 HTML | MRAID | MRAID viewable | `ironsource-playable.html` |
| Unity Ads | 单 HTML | MRAID | MRAID viewable | `unity-playable.html` |
| Moloco | 单 HTML | 历史兼容 CTA | window load | `moloco-playable.html` |

这些 Profile 以用户提供的同一游戏多渠道历史成品为兼容基线。代码层完成不等同于渠道官方审核通过。

## 商店地址

页面允许填写：

- Android 商店地址；
- iOS 商店地址。

服务端只接受完整的 `http` 或 `https` URL，并限制单个地址最长 2048 个字符。

页面内置的 Google Maps 地址只用于快速测试配置传递和跳转；正式投放必须替换为目标游戏自己的地址。

## Web 请求结构

```json
{
  "uploadId": "...",
  "config": {
    "buildMode": "optimized",
    "imageMode": "webp",
    "pngQuality": 80,
    "jpegQuality": 80,
    "audioBitrateKbps": 48,
    "payloadEncoding": "html7",
    "brotliFallback": "raw-js",
    "channel": {
      "platform": "Google",
      "androidStoreUrl": "https://play.google.com/store/apps/details?id=...",
      "iosStoreUrl": "https://apps.apple.com/app/id..."
    }
  }
}
```

即使使用 `raw-single-html`，渠道选择和商店地址也会保留；只有图片、音频、Brotli 和 Payload 配置切换为未压缩基线。

## MRAID 运行时

MRAID 渠道会在生成的运行时中暴露：

```text
window.__runGame()
```

并通过幂等保护确保 Cocos 入口只执行一次。

正常时序：

```text
HTML 加载
→ 等待 mraid ready
→ 监听 viewableChange
→ 第一次 viewable=true
→ window.__runGame()
→ Cocos 启动
```

尺寸和音量变化会维护：

```text
window.__PLAYABLE_SCREEN_SIZE__
window.__PLAYABLE_AUDIO_VOLUME__
window.volumeAudio
window.volumeSwitch
```

完整本地模拟步骤见 [AppLovin / MRAID 生命周期适配](applovin-mraid.md)。

## ZIP 交付

### Google

```text
google-playable.zip
├─ index.html
└─ res.js
```

`index.html` 保留渠道桥、Exit API 引用和 `res.js` 引用；`res.js` 承载 Payload、解码器和 Cocos 主运行时。

### Facebook

```text
facebook-playable.zip
├─ index.html
└─ res.js
```

CTA 优先调用 `FbPlayableAd.onCTAClick()`。

### Liftoff

```text
liftoff-playable.zip
└─ index.html
```

ZIP 根目录只包含单个已注入 MRAID 生命周期的 `index.html`。

详细说明：

- [Liftoff ZIP 交付](liftoff-delivery.md)
- [Facebook ZIP 交付](facebook-delivery.md)
- [剩余渠道交付](remaining-channel-deliveries.md)

## Unity Ads 的 mraid.js 处理

正式产物不会打包本地模拟器，也不会伪造一个 `mraid.js` 文件。Unity Ads 单 HTML 依赖广告宿主提供 `mraid` 全局对象；本地在线试玩由 `/preview/` 路由中的模拟器负责。

这样可以避免把测试桩误带入正式包，同时保留缺少宿主 API 时的浏览器启动回退。

## 报告

除 Preview 外，已完成渠道的 Web 报告都会包含：

```text
channel.integrationStatus = channel-delivery-ready
delivery.format
delivery.fileName
delivery.entries
delivery.entryBytes
delivery.bytes
delivery.sha256
```

`delivery.bytes` 和 `delivery.sha256` 对应实际下载文件，而不是注入渠道代码前的基础 `game.html`。

## 测试

```powershell
npm run typecheck
npm run test:web-mvp
npm run web:mvp
```

`test:web-mvp` 会检查：

- 八个渠道 Profile；
- 商店 URL 安全校验；
- 下载桥和启动策略；
- MRAID ready / viewable、尺寸和音量；
- Google、Facebook、Liftoff ZIP 结构；
- AppLovin、IronSource、Unity Ads、Moloco 单 HTML 文件名和桥接；
- ZIP CRC、解压和内容回环；
- Web 下载响应、报告大小和 SHA-256；
- 优化和未压缩任务不回归。
