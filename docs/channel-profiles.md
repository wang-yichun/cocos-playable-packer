# 渠道 Profile 基础层

渠道 Profile 用于把同一份 Cocos Playable 构建结果映射到不同广告渠道的交付规则。

当前阶段只完成：

- 渠道枚举和结构化 Profile；
- Web 页面渠道选择；
- Android / iOS 商店地址输入；
- 渠道要求和警告展示；
- 下载报告中的 `channel` 字段；
- 服务端 URL 和渠道值校验。

当前阶段**尚未**：

- 向最终 HTML 注入 MRAID、ExitApi 或 Facebook CTA 桥；
- 延迟 Cocos 启动到 MRAID `viewable`；
- 把 Google / Facebook 输出拆成 `index.html + res.js`；
- 把 Liftoff 输出包装为 ZIP；
- 声明产物已经通过渠道官方 Validator。

因此报告中的：

```json
"integrationStatus": "profile-only"
```

表示当前输出仍是原有 Preview 产物，只是已经携带可供下一阶段使用的渠道配置和验证元数据。

## 已记录渠道

| 渠道 | 历史交付格式 | 桥接方式 | 启动策略 | 必需全局对象 |
|---|---|---|---|---|
| Preview | 单 HTML | preview | window load | 无 |
| AppLovin | 单 HTML | MRAID | MRAID viewable | `mraid` |
| Google | ZIP：`index.html + res.js` | Google ExitApi | window load | `ExitApi` |
| Facebook | ZIP：`index.html + res.js` | Facebook CTA | window load | `FbPlayableAd` |
| Liftoff | ZIP：单 `index.html` | MRAID | MRAID viewable | `mraid` |
| IronSource | 单 HTML | MRAID | MRAID viewable | `mraid` |
| Unity | 单 HTML | MRAID | MRAID viewable | `mraid` |
| Moloco | 单 HTML | 历史样本使用 Facebook CTA | window load | `FbPlayableAd` |

这些值来自已经成功交付的历史成品包分析。正式实现每个渠道前，仍需依据最新官方文档和 Validator 复核。

## 商店地址

页面允许填写：

- Android 商店地址；
- iOS 商店地址。

为了便于本地测试，页面提供“填入 Google Maps 测试链接”按钮：

```text
Android:
https://play.google.com/store/apps/details?id=com.google.android.apps.maps

 iOS:
https://apps.apple.com/app/google-maps/id585027354
```

这些链接只用于测试配置传递和后续跳转桥接，正式投放必须替换为目标游戏自己的商店地址。

服务端只接受完整的 `http` 或 `https` URL，并限制单个地址最长 2048 个字符。

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

即使使用 `raw-single-html`，渠道选择和商店地址也会保留；只有图片、音频、Brotli 和 Payload 配置会被强制切换为未压缩基线。

## 报告字段

通过 Web 服务下载的 `game.report.json` 会附加：

```json
{
  "channel": {
    "platform": "Google",
    "displayName": "Google Ads",
    "deliveryFormat": "zip-html-res-js",
    "bridge": "google-exit-api",
    "startupPolicy": "window-load",
    "analyticsAdapter": "none",
    "requiredGlobals": ["ExitApi"],
    "externalScripts": [
      "https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"
    ],
    "requiresExternalApi": true,
    "androidStoreUrl": "...",
    "iosStoreUrl": "...",
    "integrationStatus": "profile-only",
    "warnings": []
  }
}
```

当前是下载报告时动态附加渠道段，不修改底层 Pipeline 自身的报告格式。

## 测试

```powershell
npm run typecheck
npm run test:web-mvp
npm run web:mvp
```

`test:web-mvp` 会检查：

- 八个渠道 Profile；
- 非法渠道值；
- 非 HTTP(S) 商店地址；
- Web 表单和内嵌脚本语法；
- 渠道配置经过任务 API 后保持不变；
- 优化和未压缩模式都能保存渠道配置；
- 下载报告包含渠道 Profile。

## 下一阶段

建议按以下顺序实现真正的渠道产物：

1. Preview 维持当前行为；
2. AppLovin：MRAID bridge + ready/viewable 延迟启动；
3. Google：ExitApi bridge + ZIP（`index.html + res.js`）；
4. Facebook：CTA bridge + ZIP（`index.html + res.js`）；
5. Liftoff：ZIP 单 HTML；
6. IronSource / Unity 复用 MRAID 基础层；
7. Moloco 在官方规则确认后实现，默认不复制历史成品中的第三方 beacon。
