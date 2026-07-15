# 通用 Playable SDK 门面基础设计

## 目标

`cocos-playable-packer` 需要一套中立的游戏侧门面，使 Cocos 项目不再直接依赖：

- 公司内部 Playable 运行时；
- `xsd_playable`、`AnalyticsIns`、`GameConfs` 等定制全局对象；
- MRAID、Google Exit API、Facebook CTA 等具体渠道接口。

游戏只调用稳定的 `PlayableSDK`。打包器根据目标渠道，在最终 HTML 中注入对应的运行时实现。

## 游戏侧门面

仓库源文件：

- `src/sdk/playable-sdk.ts`
- `src/sdk/playable-sdk-types.ts`
- `src/sdk/playable-runtime-global.d.ts`

网站“目标渠道”区域提供一个版本化 ZIP：

```text
CocosPlayableSDK-v<网站版本>.zip
└─ CocosPlayableSDK-v<网站版本>/
   ├─ PlayableSDK.ts
   ├─ PlayableSDKTypes.ts
   └─ PlayableSDKGlobal.d.ts
```

解压后可以把整个文件夹复制到 Cocos 项目的脚本目录。游戏逻辑通常只导入 `PlayableSDK.ts`。

ZIP 内容在网站生成页面时从仓库 SDK 源码动态构建，不维护第二份手写副本。

## 版本规则

SDK 版本以 `package.json` 的应用版本为基准：

```ts
export const PLAYABLE_SDK_VERSION = "0.2.0";
```

游戏侧也可以通过门面读取：

```ts
console.log(PlayableSDK.version);
```

版本必须满足以下一致性：

- 网站页脚显示 `Cocos Playable Packer v0.2.0`；
- 下载按钮显示 `CocosPlayableSDK-v0.2.0.zip`；
- ZIP 内文件夹名包含 `v0.2.0`；
- 三个 SDK 文件头包含 `Cocos Playable SDK v0.2.0`；
- `PLAYABLE_SDK_VERSION` 为 `0.2.0`。

`npm run test:playable-sdk` 会检查仓库 SDK 版本常量与 `package.json.version` 一致。网站生成 ZIP 时使用页面实际的 `appVersion` 写入文件头、版本常量、ZIP 名和文件夹名，因此开发页面显示 `dev` 时下载包也对应 `dev`。

## 基础调用

```ts
import PlayableSDK, {
  PlayablePlatform,
} from "./CocosPlayableSDK-v0.2.0/PlayableSDK";

PlayableSDK.setLoadingProgress(0.5);
PlayableSDK.ready();
PlayableSDK.interacted();
PlayableSDK.track("level_complete", { level: 1 });
PlayableSDK.openStore();
PlayableSDK.end({ result: "completed", score: 100 });
```

加载进度契约使用 `0` 到 `1` 的比例值。门面会把有限数值限制在这个范围内。

## 渠道字符串枚举

已知渠道通过字符串枚举提供，便于游戏逻辑执行少量渠道差异处理：

```ts
if (PlayableSDK.platform === PlayablePlatform.AppLovin) {
  // AppLovin 专用游戏逻辑。
}
```

当前枚举包括：

- `Unknown`
- `Preview`
- `AppLovin`
- `Google`
- `Facebook`
- `Liftoff`
- `IronSource`
- `Unity`
- `Moloco`

`PlayableSDK.platform` 返回归一化后的 `PlayablePlatform`。尚未加入枚举的新渠道返回 `PlayablePlatform.Unknown`，原始字符串仍可通过 `PlayableSDK.platformName` 读取：

```ts
if (PlayableSDK.platform === PlayablePlatform.Unknown) {
  console.warn("未识别渠道：", PlayableSDK.platformName);
}
```

渠道差异代码应保持少量且明确。CTA、生命周期、音量、尺寸和渠道 SDK 调用仍由打包器适配层处理，不应重新散落到游戏业务代码中。

## 中立运行时

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

游戏代码不得直接调用 `mraid`、`ExitApi`、`FbPlayableAd`。

## 降级策略

没有注入 `window.__COCOS_PLAYABLE__` 时：

- `ready`、`openStore`、`end`、`interacted`、`track` 安全降级为 no-op；
- `getConfig` 返回调用方提供的 fallback；
- 原始平台名优先读取运行时，其次读取现有 `window.__PLATFORM`，最后返回 `Preview`；
- 平台枚举无法识别原始字符串时返回 `Unknown`。

这样同一份 Cocos 项目代码可以继续在编辑器、本地 Web Mobile 和最终 Playable HTML 中运行。

## 门面源码注释

`PlayableSDK.ts` 的类注释和公开方法注释均带有 `@example`，覆盖：

- SDK 版本读取；
- 基础生命周期；
- 加载进度；
- CTA 跳转；
- 游戏结束；
- 事件发送；
- 配置读取；
- 已知渠道枚举判断；
- 未知渠道诊断。

## 旧接口迁移原则

`xsd_playable` 当前仍被已验证的渠道下载桥使用，本阶段不直接删除。

后续迁移顺序：

1. 渠道桥先创建 `window.__COCOS_PLAYABLE__`；
2. 对老项目按需提供独立 legacy adapter，把 `xsd_playable` 调用转发到新运行时；
3. 新项目只使用 `PlayableSDK`；
4. 完成真实项目和各渠道验证后，默认构建停止注入 `xsd_playable`；
5. 公司内部埋点对象和字段不进入商业发行代码。

## 当前阶段不包含

- 不修改现有已验证渠道行为；
- 不删除 `pack-compressed.ts` 或渠道桥中的旧兼容桩；
- 不复制原公司 `PlayableSDK.ts` 的实现；
- 不定义任何公司专用埋点协议；
- 不承诺渠道审核结果。
