# Google、IronSource、Unity Ads、Moloco 交付

本页记录一次性完成的剩余渠道交付实现和本地验收方式。

## Google Ads

输出：

```text
google-playable.zip
├─ index.html
└─ res.js
```

`index.html` 包含：

- Google 渠道配置；
- `window.xsd_playable.download()`；
- `ExitApi.exit()` 优先调用；
- Exit API 外部脚本引用；
- `res.js` 引用。

`res.js` 包含 Payload、解码器和 Cocos 主运行时。

本地缺少 `ExitApi` 时，下载桥回退到配置的商店地址。在线试玩不会加载外部 Exit API，只验证完整单 HTML 和回退路径。

## IronSource

输出：

```text
ironsource-playable.html
```

运行时：

```text
mraid ready
→ viewable=true
→ window.__runGame()
→ mraid.open(storeUrl)
```

在线试玩使用 MRAID 模拟器。正式下载文件不主动创建模拟器面板。

## Unity Ads

输出：

```text
unity-playable.html
```

Unity Ads 路线复用 MRAID 生命周期，但不把本地模拟器或伪造的 `mraid.js` 文件打入正式产物。正式宿主需要提供 `mraid` 全局对象。

没有宿主 API 的普通浏览器会走启动和商店地址回退，便于本地烟雾测试。

## Moloco

输出：

```text
moloco-playable.html
```

当前实现按用户提供的历史成品兼容基线使用：

```js
window.FbPlayableAd.onCTAClick();
```

宿主对象不存在时回退到配置的商店地址。历史成品中的第三方 beacon 不会复制到默认产物。

## 统一报告

四个渠道的 Web 报告都会包含：

```text
channel.integrationStatus = channel-delivery-ready
delivery.format
delivery.fileName
delivery.entries
delivery.entryBytes
delivery.bytes
delivery.sha256
```

## 本地测试

```powershell
npm run typecheck
npm run test:web-mvp
npm run web:mvp
```

打开：

```text
http://127.0.0.1:4173
```

建议统一使用：

```text
图片：WebP 80
音频：48 kbps
Payload：HTML7
```

### Google

1. 选择 Google Ads；
2. 构建并点击在线试玩；
3. 完整试玩，确认游戏和商店链接回退；
4. 下载 `google-playable.zip`；
5. 解压确认只有 `index.html` 和 `res.js`；
6. 使用 HTTP 服务打开解压目录；
7. 检查控制台。

```powershell
Expand-Archive `
  "./google-playable.zip" `
  "./google-test"

npx http-server `
  "./google-test" `
  -p 8080 `
  -c-1
```

### IronSource / Unity Ads

1. 选择对应渠道；
2. 在线试玩初始等待 MRAID；
3. 点击“Ready + 可见”；
4. 完整试玩；
5. 测试下载跳转；
6. 下载对应单 HTML；
7. 普通浏览器打开，确认缺少真实 MRAID 时能够回退启动；
8. 检查控制台。

### Moloco

1. 选择 Moloco；
2. 在线试玩应直接启动；
3. 完整试玩；
4. 测试 CTA 回退；
5. 下载 `moloco-playable.html`；
6. 本地打开并检查控制台。

## 发布边界

本轮完成的是项目内的交付结构、宿主桥接、启动策略、报告和自动化测试。公开检索没有找到四个渠道都可稳定访问、可直接引用的最新技术规范页面，因此正式上线前仍需在目标渠道后台或 Validator 中复核：

- 包体大小限制；
- ZIP 根目录规则；
- 外部脚本和网络请求限制；
- 宿主 API 的实际对象名与调用时机；
- 音频自动播放规则；
- 审核账户或地区差异。
