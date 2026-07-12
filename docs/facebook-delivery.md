# Facebook ZIP 交付

Facebook Profile 使用 `FbPlayableAd.onCTAClick()` 作为宿主 CTA，并将最终产物交付为两个根目录文件。

## 输出结构

```text
facebook-playable.zip
├─ index.html
└─ res.js
```

`index.html` 保留：

- 页面结构与样式；
- 渠道配置；
- `window.xsd_playable` 下载桥；
- `FbPlayableAd.onCTAClick()` 宿主调用；
- `res.js` 引用。

`res.js` 承载：

- Brotli 归档描述；
- Base64、Base91 或 HTML7 Payload；
- Payload 解码器；
- Cocos 单 HTML 原有主运行时；
- 游戏启动入口。

HTML7 模式下，`res.js` 会先恢复原来的 `application/x-playable-payload` DOM 节点，再执行主运行时，因此现有 HTML7 解码器无需改写。

## 启动与 CTA

Facebook 使用普通 `window-load` 路线，不等待 MRAID：

```text
index.html
→ 加载 res.js
→ 执行原有 Cocos 启动流程
```

游戏调用：

```js
window.xsd_playable.download();
```

宿主存在时优先执行：

```js
window.FbPlayableAd.onCTAClick();
```

本地浏览器没有 `FbPlayableAd` 时，回退到页面配置的 Android 或 iOS 商店地址。

## ZIP 生成

ZIP 使用项目内置实现，不新增依赖：

- 根目录固定为 `index.html` 和 `res.js`；
- UTF-8 文件名；
- 每个条目独立选择 Deflate level 9 或 Store；
- 写入 CRC32、压缩前后大小和中央目录；
- 使用固定 ZIP 时间戳，使相同输入得到稳定 SHA-256。

## 下载报告

Facebook 的 `game.report.json` 会包含：

```json
{
  "channel": {
    "platform": "Facebook",
    "deliveryFormat": "zip-html-res-js",
    "bridge": "facebook-cta",
    "startupPolicy": "window-load",
    "integrationStatus": "channel-delivery-ready"
  },
  "delivery": {
    "format": "zip-html-res-js",
    "fileName": "facebook-playable.zip",
    "mediaType": "application/zip",
    "entries": ["index.html", "res.js"],
    "entryBytes": {
      "index.html": 0,
      "res.js": 0
    },
    "bytes": 0,
    "sha256": "...",
    "htmlBytes": 0,
    "generatedOnDownload": true
  }
}
```

## 本地验证

```powershell
npm run typecheck
npm run test:web-mvp
npm run web:mvp
```

打开：

```text
http://127.0.0.1:4173
```

建议配置：

```text
目标渠道：Facebook
构建模式：优化并压缩
图片：WebP 80
音频：48 kbps
Payload：HTML7
```

验证步骤：

1. 点击“在线试玩”，确认游戏无需 MRAID 操作即可启动；
2. 完整试玩场景、UI、图集、音频和物理；
3. 验证游戏内下载按钮可以跳转；
4. 点击“下载 Facebook ZIP”；
5. 解压后确认根目录只有 `index.html` 和 `res.js`；
6. 使用本地 HTTP 服务打开解压目录；
7. 确认 `res.js` 成功加载，游戏可以完整运行；
8. 下载报告并检查 `channel`、`delivery`、大小和 SHA-256；
9. 检查浏览器控制台没有异常。

推荐使用 HTTP 服务验证两个文件，避免不同浏览器对 `file://` 外部脚本加载策略的差异：

```powershell
npx http-server "./facebook-test" -p 8080 -c-1
```

然后打开：

```text
http://127.0.0.1:8080/index.html
```

## 当前边界

当前实现以用户提供的历史 Facebook 成品结构作为兼容基线。公开检索未找到可稳定访问并直接引用的最新 Meta Playable 技术规范，因此本地测试通过不等同于 Meta 官方 Validator 通过。

正式投放前仍需确认：

- 当前 ZIP 和包体上限；
- 根目录文件规则；
- `FbPlayableAd.onCTAClick()` 宿主行为；
- 外部网络请求限制；
- 音频自动播放要求；
- Meta 官方 Validator 或投放后台结果。
