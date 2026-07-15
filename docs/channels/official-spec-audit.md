# 渠道官方规范审计

审计日期：2026-07-15

适用仓库：`wang-yichun/cocos-playable-packer`

本文件用于记录各广告渠道当前公开的 Playable / HTML5 创意规范，并与仓库现有渠道实现进行对照。

本阶段只记录证据与差异，不直接修改渠道运行逻辑。任何运行时改动都应在独立分支中完成，并使用长期保留的 `game141` 验证分支进行真实构建和浏览器试玩。

## 证据等级

| 等级 | 含义 |
| --- | --- |
| A | 当前可访问的渠道官方公开文档，能够直接确认实现要求 |
| B | 当前可访问的官方文档，但产品线、投放入口或运行环境仍有歧义 |
| C | 官方资料需要账号、后台权限或客户经理提供，公开页面不足以确认 |
| D | 只有历史成功包、旧项目或第三方样例作为兼容性证据 |

## 当前实现快照

当前实现来源：

- `src/channel/channel-profile.ts`
- `src/channel/channel-download-bridge.ts`

| 渠道 | 当前交付格式 | 当前 CTA 桥 | 当前启动策略 | 审计等级 | 初步结论 |
| --- | --- | --- | --- | --- | --- |
| AppLovin | 单 HTML | `mraid.open(storeUrl)` | MRAID 可见后启动 | A | 基本方向正确；需补充 5 MB、MRAID 2.0、禁止外部请求等校验 |
| Google App Campaign | ZIP：`index.html + res.js` | `ExitApi.exit()` | `window.load` | A | 官方确认 ZIP 和 Exit API；需补充元标签、5 MB、512 文件等校验 |
| Facebook / Meta | ZIP：`index.html + res.js` | `FbPlayableAd.onCTAClick()` | `window.load` | C | 公开官方文档当前无法访问，不能仅凭历史包确认 |
| Liftoff | ZIP：根目录单 `index.html` | `mraid.open(storeUrl)` | MRAID 可见后启动 | A/B | MRAID 路线成立；官方示例更倾向 `mraid.open()` 无参数，需 Validator 验证 |
| IronSource | 单 HTML | `mraid.open(storeUrl)` | MRAID 可见后启动 | C | 官方公开站已迁移至 Unity，但未找到独立 UA Playable 规范 |
| Unity Ads | 单 HTML | `mraid.open(storeUrl)` | MRAID 可见后启动 | A | 当前核心路线与官方规范一致 |
| Moloco | 单 HTML | `FbPlayableAd.onCTAClick()` | `window.load` | A | 官方文档直接确认当前 CTA 与单 HTML 路线 |

## 关键结论

### 1. 历史成品反推仍有价值，但不能再作为最高优先级事实来源

历史成功包可以证明某种实现曾经在某个投放环境中工作，但它无法回答：

- 当前渠道是否已经更新规范；
- 历史包是否经过代理商或公司内部封装；
- 相同品牌下是否存在多条产品线；
- 某个全局对象是渠道标准还是特定容器兼容层。

后续事实优先级统一为：

1. 当前官方规范；
2. 官方模板、预览器或 Validator；
3. 真实广告后台上传验证；
4. 历史成功包；
5. 第三方样例。

### 2. 多数渠道不会提供一个需要嵌入产物的“SDK 文件”

大多数 Playable 运行环境由宿主 WebView 注入接口，例如：

- `mraid`；
- `ExitApi`；
- `FbPlayableAd`；
- `Liftoff`。

打包器的职责通常是生成符合渠道要求的 HTML / ZIP，并调用宿主接口，而不是把渠道原生 SDK 打进 HTML。

## 分渠道审计

## AppLovin

证据等级：**A**

官方资料：

- Creative specs & guidelines  
  https://support.applovin.com/en/growth/promoting-your-apps/welcome-to-applovin/creative-specs-and-guidelines
- Playable Preview  
  https://p.applov.in/

官方公开要求：

- 每个广告文件不超过 5 MB；
- 单 HTML 文件；
- 所有资源使用 Base64 或 Base122 内嵌；
- 禁止外部资源和外部网络请求；
- 同时支持横屏和竖屏；
- 广告计时从首次用户交互后开始；
- 首次点击不得直接跳转商店；
- 音频在首次交互前必须静音；
- 广告隐藏或关闭时应停止或静音；
- 支持 MRAID 2.0；
- 调用 MRAID API 前必须等待 `ready`，或确认 `mraid.getState() !== "loading"`；
- CTA 使用 `mraid.open()`。

与当前实现对照：

- 单 HTML：符合；
- MRAID ready 处理：符合；
- CTA：方向符合；
- 当前额外等待 `viewableChange` 后启动，官方页面未把它列为硬性要求，但属于保守策略，需在 AppLovin Preview 中确认不会挂起；
- 当前报告尚未结构化记录 5 MB、MRAID 2.0、双方向、禁止外部请求等限制。

后续动作：

1. 在独立代码分支增加 AppLovin 构建前校验；
2. 使用 AppLovin Playable Preview 验证 ready、可见性、音频和 CTA；
3. 确认 Base122 是否只是允许格式，而不是必须优先使用的格式。

## Google App Campaign Playable

证据等级：**A**

官方资料：

- About HTML5/Playable ads for App campaigns  
  https://support.google.com/google-ads/answer/9981650
- Fix issues with HTML5 assets for App campaigns  
  https://support.google.com/google-ads/answer/12771973
- Google Ads HTML5 Validator  
  https://h5validator.appspot.com/

注意：普通 Uploaded Display Ads 与 App Campaign Playable 不是同一套规则。普通展示广告帮助页明确说明其部分规则不适用于 App Campaign HTML5，因此审计时以 App Campaign 专用文档为准。

官方公开要求：

- 上传 ZIP；
- ZIP 最大 5 MB；错误处理页进一步说明 320×480 / 480×320 资源可到约 5.2 MB，但正式配置应继续以 5 MB 安全上限为准；
- ZIP 内最多 512 个文件；
- 推荐使用 `ad.orientation` 元标签；
- 支持 `portrait`、`landscape` 或两者；
- 也接受 320×480 和 480×320 的 `ad.size`；
- 必须响应式适配全屏尺寸；
- 非 ASCII 内容使用 UTF-8；
- 音频必须在用户交互后开启；
- 自定义非 Google Web Designer 创意可在 `<head>` 中以字面量脚本标签引用 `exitapi.js`；
- CTA 调用 `ExitApi.exit()`；
- 所有本地资源必须通过 ZIP 内相对路径引用；
- 禁止未批准的外部引用；
- 必须包含 `DOCTYPE`、`html`、`body` 和方向或尺寸元标签。

与当前实现对照：

- ZIP：符合；
- `index.html + res.js`：属于允许的 HTML / JS 文件类型；
- `exitapi.js + ExitApi.exit()`：官方直接确认；
- 当前代码中的 Google Exit API 不是单纯从历史包猜测出来的方案；
- 当前仍需确认生成结果是否始终包含正确的 `ad.orientation` 或 `ad.size`；
- 当前报告尚未自动检查 5 MB、512 文件、文件名字符和禁止外部引用。

后续动作：

1. 增加 Google App Campaign 专用结构校验；
2. 保证 Exit API 以字面量 `<script>` 标签位于 `<head>`；
3. 对生成 ZIP 运行 Google HTML5 Validator；
4. 使用真实 Google Ads App Campaign 上传结果作为最终证据。

## Facebook / Meta

证据等级：**C**

尝试访问：

- https://developers.facebook.com/docs/audience-network/guides/playable-ads/
- Meta Business Help Center 中的 Playable / Audience Network 资料

审计结果：

- 当前公开入口会要求登录、跳转或返回无法读取的页面；
- 本次审计未取得能够公开引用的最新 Meta Playable 技术规范；
- 当前 `FbPlayableAd.onCTAClick()` 和 ZIP 交付格式仍主要来自历史实现证据；
- Moloco 官方同样使用 `FbPlayableAd.onCTAClick()`，但这只能证明 Moloco 的要求，不能反向证明 Meta 当前规范。

后续动作：

1. 从有权限的 Meta 广告后台、Audience Network 资料库或客户经理处取得当前规范；
2. 保存官方模板、Validator 截图或下载文件的版本和日期；
3. 在获得官方证据前，不将当前 Facebook Profile 标记为“官方已确认”。

## Liftoff

证据等级：**A/B**

当前官方资料：

- Interactive Ad Integration  
  https://docs.liftoff.io/liftoff_creatives/liftoff_creatives/interactive_api_integration

历史官方产品线资料：

- Creative Verifier  
  https://support.vungle.com/hc/en-us/articles/4908908675355-Test-Your-Playable-Asset-With-Our-Creative-Verifier

当前 Interactive Ad Integration 要求：

- 接受单 HTML，或包含全部资源的 ZIP；
- ZIP 根目录若只有一个 HTML，可使用任意文件名；若有多个 HTML，则必须有 `index.html`；
- 文件名只使用 ASCII，并区分大小写；
- 资源使用相对路径；
- 音频只能由用户交互触发；
- MRAID 加载中时等待 `ready`；
- 初始化后同时检查当前可见状态，并监听 `viewableChange`；
- CTA 使用 `window.Liftoff.open()`，或直接使用 MRAID；
- 官方 MRAID 示例调用 `mraid.open()`，并说明目标 URL 由 Liftoff 注入；
- 禁止 `iframe`；
- HTML 建议不超过 5 MB；
- CTA 必须来自明确的用户交互；
- 不应在创意内绘制关闭按钮。

与当前实现对照：

- MRAID ready / viewable 路线：总体符合；
- ZIP 根目录单 `index.html`：属于官方接受形式；
- 当前调用 `mraid.open(storeUrl)`，而最新 Liftoff 示例调用无参数 `mraid.open()`；
- 当前应该避免在尚未确认前直接删除商店 URL 参数，因为 MRAID 标准通常允许 URL，而 Liftoff 宿主可能会拦截或覆盖目标；
- 需要用 Liftoff 实际预览或账户侧 Validator 确认最佳调用形式。

产品线差异：

旧 Vungle / Liftoff Direct 的 Adaptive Creative Verifier 会检查：

- `index.html`；
- `parent.postMessage('download', '*')`。

这表明 Liftoff 历史上至少存在另一套 Adaptive Creative 协议。它不应与当前公开的 Interactive Ad Integration MRAID 规范混为一谈。后续如需兼容 Direct / Adaptive Creative，应建立独立 Profile，而不是把两套协议硬塞进同一个 `Liftoff` 分支。

后续动作：

1. 明确工具当前目标是 Liftoff Interactive Ad Integration，还是还要支持旧 Direct / Adaptive Creative；
2. 用账号内预览确认 `mraid.open()` 与 `mraid.open(url)`；
3. 如需支持旧 Adaptive Creative，新增独立渠道 Profile 和 `parent.postMessage` 适配器。

## IronSource

证据等级：**C**

官方入口：

- https://developers.is.com/ 当前重定向到 Unity Grow 文档；
- https://docs.unity.com/en-us/grow/is-ads 当前主要提供 ironSource Ads 变现 SDK 文档。

审计结果：

- 当前公开页面没有给出独立的 ironSource 用户获取 Playable 创意交付规范；
- 不能因为 ironSource 文档归入 Unity，就直接假设 Unity Ads User Acquisition 的全部 Playable 规则自动适用于 ironSource Ads；
- 当前单 HTML + MRAID 路线仍需通过 ironSource 账户内资料、客户经理或真实上传验证。

后续动作：

1. 从 ironSource Ads 后台或客户经理取得当前创意规范；
2. 确认单 HTML、最大体积、MRAID 版本、启动时机和 CTA 参数；
3. 在得到官方证据前保持当前兼容实现，但标记为未完成官方确认。

## Unity Ads

证据等级：**A**

官方资料：

- Playable asset specifications  
  https://docs.unity.com/en-us/grow/acquire/creatives/playable/specifications
- Playable ad best practices  
  https://docs.unity.com/en-us/grow/acquire/creatives/playable/best-practices
- Ad Testing app  
  https://docs.unity.com/en-us/grow/acquire/creatives/creative-packs/test
- IAB MRAID  
  https://www.iab.com/guidelines/mraid/

官方公开要求：

- 单一 `index.html`，不得链接其他文件或文件夹；
- 全部资源内联并压缩；
- 小于 5 MB；
- MRAID 3.0；
- 支持横屏和竖屏；
- 不依赖 XHR 网络请求；
- 不得自动跳转商店；
- CTA 使用 `mraid.open(url)`；
- 等待 `viewableChange` 后再启动 Playable；
- `mraid` 由 Unity Ads WebView 注入；
- 官方建议使用 Ad Testing app 在真实移动端预览。

与当前实现对照：

- 单 HTML：符合；
- MRAID ready / viewable：符合；
- `mraid.open(storeUrl)`：符合；
- 不打包伪造 `mraid.js`：符合；
- 当前报告尚未结构化记录 MRAID 3.0、5 MB、双方向和禁止 XHR。

后续动作：

1. 增加 Unity 专用静态校验；
2. 使用 Ad Testing app 进行真机验证；
3. 检查自动 CTA 行为，确保只有显式用户动作才跳转。

## Moloco

证据等级：**A**

官方资料：

- Playable and Interactive End Card creative guide  
  https://help.moloco.com/hc/en-us/articles/24124525963799-Playable-and-Interactive-End-Card-IEC-creative-guide

文档更新时间：2026-06-11。

官方公开要求：

- HTML5 `.html` 或 `.htm`；
- 小于 5 MB；
- 同时支持横屏和竖屏；
- 禁止 `XMLHttpRequest`；
- 不得包含 `mraid.js`；
- 不得引用外部资源或发起 HTTP 请求；
- CTA 必须调用无参数的 `FbPlayableAd.onCTAClick()`；
- 所有资源以 Data URI 内嵌在单文件中；
- 禁止 JavaScript 重定向；
- 不得上传 ZIP；
- 应在 Moloco Ads Manager Preview 中实际点击 CTA，确认预览器显示动作成功。

与当前实现对照：

- 单 HTML：符合；
- `FbPlayableAd.onCTAClick()`：完全符合；
- 当前 `channel-profile.ts` 中“按历史成品兼容基线”的说明已经过时；该实现现有官方依据；
- 当前仍需增加 5 MB、XHR、外部请求、`mraid.js` 和单文件的自动校验。

后续动作：

1. 在后续代码分支中把 Moloco 来源说明更新为官方已确认；
2. 增加 Moloco 静态校验；
3. 使用 Moloco Ads Manager Preview 完成 CTA 验证。

## Preview

Preview 不是广告渠道规范，只用于：

- 浏览器启动验证；
- CTA fallback 验证；
- MRAID 生命周期模拟；
- 屏幕尺寸、音量和可见性事件调试。

Preview 通过不能代表正式渠道审核通过。

## 建议的后续开发顺序

### P0：修正文档事实和高风险差异

1. 将 Moloco Profile 的来源从“历史成品兼容”改为“官方规范已确认”；
2. 明确 Liftoff 当前目标产品线；
3. 对 Liftoff 的 `mraid.open(url)` 与无参数 `mraid.open()` 做真实预览验证；
4. 为 Facebook 和 IronSource 标记 `official-verification-pending`。

### P1：把渠道限制变成机器可读规则

建议扩展 `ChannelProfile`：

```ts
interface ChannelSpecification {
  specificationStatus:
    | "official-public"
    | "official-account-required"
    | "historical-only";
  specificationCheckedAt: string;
  maximumBytes: number | null;
  maximumFiles: number | null;
  requiredMraidVersion: "2.0" | "3.0" | null;
  allowNetworkRequests: boolean | null;
  requireSingleHtml: boolean;
  requireZip: boolean;
  requiredMetaTags: readonly string[];
  validator: string | null;
}
```

### P2：增加渠道构建前检查

优先检查：

- 输出体积；
- ZIP 文件数量；
- 外部 URL；
- XHR / fetch；
- `mraid.js`；
- 必需元标签；
- CTA API；
- 横竖屏声明；
- 文件名字符；
- 是否存在多 HTML 入口。

### P3：渠道 Validator 和真机验证

最终证据应记录：

- 官方 Validator 名称和版本；
- 验证日期；
- 上传成功或失败结果；
- 渠道后台错误文本；
- 真机系统和 WebView 环境；
- CTA、音频、方向切换和结束页行为。

## 当前阶段完成标准

本审计阶段完成不代表所有渠道已可正式投放。完成标准是：

- 当前实现来源已分类；
- 可公开获取的官方规范已记录；
- 已确认要求与未确认假设明确分离；
- 后续代码修改可以按渠道拆分，不再依赖模糊的历史经验；
- 任何无法公开确认的渠道都明确列出需要用户或渠道账号参与的验证项。
