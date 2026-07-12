# 多渠道批量构建与交付

Web 页面支持同时选择多个目标渠道。默认选择全部渠道，包括 Preview 本地预览。

## 核心原则

多渠道模式不是把完整压缩流程重复执行多次，而是：

```text
上传和解压一次
→ 图片优化一次
→ 音频优化一次
→ Solid Brotli 一次
→ Payload 编码一次
→ 生成一份基础 game.html
→ 按渠道派生桥接、启动策略和交付容器
```

因此，选择八个渠道时，图片压缩、音频转码和 Brotli 不会执行八遍。渠道数量主要增加的是轻量的 HTML 注入、运行时拆分、ZIP 容器和 SHA-256 计算。

## 页面行为

目标渠道使用复选框：

- 默认全选；
- 至少保留一个渠道；
- Android 和 iOS 商店地址由所有已选渠道共用；
- “全选”恢复全部渠道；
- “仅 Preview”用于快速浏览器测试。

构建完成后：

- 点击“在线试玩”先选择本次构建中的一个渠道；
- 试玩页面根据渠道注入对应桥接和启动策略；
- 点击“下载渠道合集 ZIP”下载所有已选渠道的最终交付物；
- 点击“下载报告”获得基础构建和所有渠道交付元数据。

## 合集 ZIP

默认文件名：

```text
playable-channel-bundle.zip
```

全渠道结构：

```text
playable-channel-bundle.zip
├─ manifest.json
└─ channels
   ├─ preview
   │  └─ game.html
   ├─ applovin
   │  └─ applovin-playable.html
   ├─ google
   │  └─ google-playable.zip
   ├─ facebook
   │  └─ facebook-playable.zip
   ├─ liftoff
   │  └─ liftoff-playable.zip
   ├─ ironsource
   │  └─ ironsource-playable.html
   ├─ unity
   │  └─ unity-playable.html
   └─ moloco
      └─ moloco-playable.html
```

Google、Facebook 和 Liftoff 的渠道成品本身仍是 ZIP，因此会作为完整最终文件放进外层合集 ZIP，不会在外层重新拆散。

外层 ZIP 的目的主要是统一交付和归档。由于内部 Payload 已经经过 Brotli，部分渠道文件本身也是 ZIP，外层再次压缩通常不会产生明显体积收益。

## manifest.json

合集中的 `manifest.json` 包含：

```text
基础 HTML 大小和 SHA-256
基础构建执行次数
已选渠道
各渠道在合集中的路径
各渠道交付格式
各渠道文件大小和 SHA-256
各渠道内部条目
共享处理阶段
渠道专用处理阶段
```

相同基础 HTML 和相同渠道选择会使用确定性的 ZIP 元数据，便于比较 SHA-256。

## 批量报告

批量报告文件名：

```text
playable-channel-report.json
```

在原始构建报告基础上增加：

```text
channels[]
deliveries[]
bundle
reuse
```

`reuse` 明确记录：

```text
baseBuildExecutions = 1
selectedChannelCount
sharedStages
channelSpecificStage = deliveryPackaging
```

旧的单渠道 API 仍保留：不带 `bundle=1` 的下载请求继续返回当前主渠道产物和单渠道报告。Web 页面使用批量下载参数。

## 本地验证

```powershell
npm run typecheck
npm run test:web-mvp
npm run web:mvp
```

浏览器验证重点：

1. 页面首次打开时八个渠道全部勾选；
2. 取消或重新勾选渠道后，摘要数量同步变化；
3. 不允许零渠道提交；
4. 构建日志中图片、音频和 Brotli 只执行一次；
5. 点击在线试玩后可以选择任一已勾选渠道；
6. 未勾选渠道不能通过 Preview URL 强行打开；
7. 合集 ZIP 只包含已勾选渠道和 `manifest.json`；
8. 批量报告中的渠道数量、大小和 SHA-256 与合集一致。
