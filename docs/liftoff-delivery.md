# Liftoff ZIP 交付

Liftoff Profile 复用现有 MRAID 生命周期，并将最终交付文件包装为根目录单 `index.html` 的 ZIP。

## 输出结构

选择 Liftoff 后，网页下载按钮返回：

```text
liftoff-playable.zip
└─ index.html
```

ZIP 中不包含额外目录、资源文件或本地模拟器脚本。所有游戏资源、渠道桥和 MRAID 生命周期代码仍内嵌在 `index.html` 中。

## 运行时行为

`index.html` 会：

1. 等待 MRAID `ready`；
2. 监听 `viewableChange`；
3. 首次可见时调用幂等的 `window.__runGame()`；
4. 转发尺寸和音量变化；
5. 下载按钮优先调用 `mraid.open(storeUrl)`；
6. 本地没有 MRAID 宿主时回退到配置的商店地址。

本地“在线试玩”仍直接加载 HTML，并在 `/preview/` 路由中启用 MRAID 模拟器。下载得到的 ZIP 不会主动创建模拟器面板。

## ZIP 生成

ZIP 使用项目内置实现，不新增 npm 依赖：

- 文件名固定为 `index.html`；
- UTF-8 文件名标记；
- Deflate level 9；
- 当 Deflate 无收益时自动改用 Store；
- CRC32、压缩前后大小和中央目录均写入标准 ZIP 结构；
- 使用固定 ZIP 时间戳，使相同输入得到稳定的 ZIP SHA-256。

## 下载报告

Liftoff 的 `game.report.json` 会增加：

```json
{
  "channel": {
    "platform": "Liftoff",
    "deliveryFormat": "zip-single-html",
    "bridge": "mraid",
    "startupPolicy": "mraid-viewable",
    "integrationStatus": "channel-delivery-ready"
  },
  "delivery": {
    "format": "zip-single-html",
    "fileName": "liftoff-playable.zip",
    "mediaType": "application/zip",
    "entries": ["index.html"],
    "bytes": 0,
    "sha256": "...",
    "htmlBytes": 0,
    "generatedOnDownload": true
  }
}
```

`delivery.bytes` 和 `delivery.sha256` 对应实际下载 ZIP。ZIP 在下载时由已注入渠道桥的 HTML 生成。

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
目标渠道：Liftoff
构建模式：优化并压缩
图片：WebP 80
音频：48 kbps
Payload：HTML7
```

验证步骤：

1. 点击“在线试玩”，使用右上角 MRAID 模拟器启动游戏；
2. 验证场景、UI、图集、音频和物理；
3. 验证游戏下载按钮可以跳转；
4. 点击“下载 Liftoff ZIP”；
5. 解压 ZIP，确认根目录只存在 `index.html`；
6. 本地打开 `index.html`，确认没有 MRAID 时可以回退启动；
7. 下载报告，确认 `integrationStatus` 和 `delivery` 字段；
8. 检查浏览器控制台没有异常。

## 当前边界

当前实现以用户提供的历史 Liftoff 成品结构作为兼容基线。公开检索未找到可直接引用的最新 Liftoff Playable ZIP 规范，因此本地测试通过不等同于渠道官方 Validator 通过。

正式投放前仍需确认：

- 当前包体上限；
- ZIP 根目录规则；
- MRAID 版本和宿主实现；
- 外部网络请求限制；
- 音频自动播放要求；
- 商店跳转和 CTA 规则；
- Liftoff 官方 Validator 结果。
