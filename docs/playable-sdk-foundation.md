# 通用 Playable SDK 门面基础设计

## 目标

`cocos-playable-packer` 需要一套中立的游戏侧门面，使 Cocos 项目不再直接依赖：

- 公司内部 Playable 运行时；
- `xsd_playable`、`AnalyticsIns`、`GameConfs` 等定制全局对象；
- MRAID、Google Exit API、Facebook CTA 等具体渠道接口。

游戏只调用稳定的 `PlayableSDK`。打包器根据目标渠道，在最终 HTML 中注入对应的运行时实现。

## 分层

### 游戏侧门面

文件：

- `src/sdk/playable-sdk.ts`
- `src/sdk/playable-sdk-types.ts`
- `src/sdk/playable-runtime-global.d.ts`

游戏侧稳定入口：

```ts
import { PlayableSDK } from "./PlayableSDK";

PlayableSDK.ready();
PlayableSDK.setLoadingProgress(0.5);
PlayableSDK.interacted();
PlayableSDK.track("level_complete", { level: 1 });
PlayableSDK.openStore();
PlayableSDK.end({ result: "completed", score: 100 });
```

当前加载进度契约使用 `0` 到 `1` 的比例值。门面会把有限数值限制在这个范围内。

### 中立运行时

最终 HTML 由打包器提供：

```ts
window.__COCOS_PLAYABLE__
```

运行时能力包括：

- `platform`：当前渠道名称；
- `ready()`：游戏准备完成；
- `setLoadingProgress(progress)`：加载进度；
- `interacted()`：用户首次或关键交互；
- `openStore()`：执行渠道下载跳转；
- `end(payload)`：游戏结束；
- `track(name, params)`：通用事件；
- `getConfig(key, fallback)`：读取渠道或构建配置。

游戏代码不得直接判断或调用 `mraid`、`ExitApi`、`FbPlayableAd`。

### 渠道适配层

现有 `src/channel` 已经负责渠道 Profile、下载桥、MRAID 生命周期和交付格式。后续阶段应让该层实现 `window.__COCOS_PLAYABLE__`，再由运行时内部转发到：

- MRAID；
- Google Exit API；
- Facebook CTA；
- 本地 Preview；
- 后续新增渠道适配器。

## 降级策略

没有注入 `window.__COCOS_PLAYABLE__` 时：

- `ready`、`openStore`、`end`、`interacted`、`track` 安全降级为 no-op；
- `getConfig` 返回调用方提供的 fallback；
- `platform` 优先读取运行时，其次读取现有 `window.__PLATFORM`，最后返回 `Preview`。

这样同一份 Cocos 项目代码可以继续在编辑器、本地 Web Mobile 和最终 Playable HTML 中运行。

## 旧接口迁移原则

`xsd_playable` 当前仍被已验证的渠道下载桥使用，本阶段不直接删除。

后续迁移顺序：

1. 渠道桥先创建 `window.__COCOS_PLAYABLE__`；
2. 对老项目按需提供独立的 legacy adapter，把 `xsd_playable` 调用转发到新运行时；
3. 新项目只使用 `PlayableSDK`；
4. 完成真实项目和各渠道验证后，默认构建停止注入 `xsd_playable`；
5. 公司内部埋点对象和字段不进入商业发行代码。

## 当前阶段不包含

- 不修改现有已验证渠道行为；
- 不删除 `pack-compressed.ts` 或渠道桥中的旧兼容桩；
- 不复制原公司 `PlayableSDK.ts` 的实现；
- 不定义任何公司专用埋点协议；
- 不承诺渠道审核结果。

## 后续实现建议

下一阶段建议修改 `src/channel/channel-download-bridge.ts`：

- 以 `window.__COCOS_PLAYABLE__` 作为主运行时；
- 将下载、MRAID 生命周期和平台信息接入主运行时；
- 把 `xsd_playable` 移到显式的 legacy 兼容选项；
- 添加 Preview、MRAID、Google 和 Facebook 路线的行为自测；
- 使用真实 Cocos 构建目录验证启动、CTA、音量、尺寸和生命周期。
