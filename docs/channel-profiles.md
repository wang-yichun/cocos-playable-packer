# 渠道 Profile 与适配状态

渠道 Profile 用于把同一份 Cocos Playable 构建结果映射到不同广告渠道的交付规则。

当前已经完成：

- 渠道枚举和结构化 Profile；
- Web 页面渠道选择；
- Android / iOS 商店地址输入与校验；
- `window.xsd_playable.download()` / `install()` 下载桥；
- Google `ExitApi.exit()`、Facebook CTA、MRAID `open()` 的宿主优先调用；
- 本地缺少宿主 API 时回退到商店地址；
- AppLovin 等 MRAID 渠道的 `ready` / `viewableChange` 延迟启动；
- MRAID 尺寸和音量事件转发；
- 在线试玩 MRAID 模拟器；
- 下载报告中的渠道元数据。

当前尚未完成：

- Google / Facebook 的 `index.html + res.js` ZIP 输出；
- Liftoff ZIP 包装；
- AppLovin 专用 Analytics 事件映射；
- 各渠道官方 Validator 自动化；
- Moloco 最新官方接口复核。

## 渠道矩阵

| 渠道 | 历史交付格式 | 桥接方式 | 启动策略 | 当前状态 |
|---|---|---|---|---|
| Preview | 单 HTML | 商店链接回退 | window load | 可用 |
| AppLovin | 单 HTML | MRAID | MRAID viewable | 生命周期已接入，待官方 Validator |
| Google | ZIP：`index.html + res.js` | ExitApi | window load | 下载桥可用，ZIP 输出待实现 |
| Facebook | ZIP：`index.html + res.js` | Facebook CTA | window load | 下载桥可用，ZIP 输出待实现 |
| Liftoff | ZIP：单 `index.html` | MRAID | MRAID viewable | 生命周期已接入，ZIP 输出待实现 |
| IronSource | 单 HTML | MRAID | MRAID viewable | 生命周期已接入，待官方 Validator |
| Unity | 单 HTML | MRAID | MRAID viewable | 生命周期已接入，`mraid.js` 规则待确认 |
| Moloco | 单 HTML | 历史样本使用 Facebook CTA | window load | 下载桥可用，官方接口待复核 |

这些 Profile 来源于用户提供的同一游戏、多渠道最终成品包。正式投放前仍应结合渠道最新官方文档和 Validator。

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
      "platform": "AppLovin",
      "androidStoreUrl": "https://play.google.com/store/apps/details?id=...",
      "iosStoreUrl": "https://apps.apple.com/app/id..."
    }
  }
}
```

即使使用 `raw-single-html`，渠道选择和商店地址也会保留；只有图片、音频、Brotli 和 Payload 配置会切换为未压缩基线。

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

完整本地模拟和验收步骤见 [AppLovin / MRAID 生命周期适配](applovin-mraid.md)。

## 报告

Web 服务下载的 `game.report.json` 会附加渠道配置、预期交付格式、桥接方式、宿主全局对象和警告信息。

当前报告中的 `integrationStatus` 仍以下载桥阶段为粒度；MRAID 生命周期的详细状态以 Profile 警告和本页说明为准。后续渠道交付容器落地时会进一步细化该字段。

## 测试

```powershell
npm run typecheck
npm run test:web-mvp
npm run web:mvp
```

`test:web-mvp` 会检查：

- 八个渠道 Profile；
- 商店 URL 安全校验；
- 渠道配置经过任务 API 后保持不变；
- 下载桥注入；
- MRAID ready / viewable 延迟启动；
- 运行时只启动一次；
- MRAID 尺寸和音量转发；
- 优化和未压缩任务不回归。
