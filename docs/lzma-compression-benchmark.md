# LZMA 压缩公平基准

## 定位

该工具只用于研究：

```text
Brotli + Base64
LZMA + Base64
```

不会修改 `playable:build`，也不会向正式 Pipeline 增加 LZMA 参数。

输入必须是当前打包器生成的 Brotli + Base64 单 HTML。工具会先解压其中的 Brotli Payload，恢复唯一的原始归档字节，然后让 Brotli Q11 和 LZMA 使用完全相同的输入。

## 命令

```powershell
npm run compression:lzma -- `
  "./dist/game-base64.html" `
  "./dist/game-lzma-base64.html" `
  --iterations=3 `
  --lzma-level=9
```

参数：

```text
--iterations=1..20
--lzma-level=1..9
```

默认值：

```text
iterations = 3
lzma-level = 9
```

输出报告：

```text
./dist/game-lzma-base64.lzma-report.json
```

输入文件和输出文件不能相同。工具先写入临时 HTML 和临时报告，全部成功后再原子替换正式输出；失败不会覆盖已有成功产物。

## 公平性约束

报告中的两种算法共享：

- 同一份原始归档字节；
- 同一个原始归档 SHA-256；
- 同一个 Base64 Payload 层；
- 同一个 HTML 页面结构；
- 同一套 Cocos VFS、SystemJS、Import Map 和启动逻辑。

LZMA 不是对 Brotli 二进制再次压缩，而是对 Brotli 解压后得到的原始归档重新压缩。

## 报告内容

报告包含：

- 原始归档大小和 SHA-256；
- Brotli 与 LZMA 二进制大小和 SHA-256；
- LZMA Header、字典大小和声明的解压尺寸；
- 压缩耗时、Node 解码耗时和内存观测；
- 解码器、许可证声明、启动代码大小；
- Base64 Payload 大小；
- 最终 HTML 大小和 SHA-256；
- 解压后大小和 SHA-256；
- 二进制回环结果；
- 二进制和最终 HTML 的净节省。

Node 内存字段是操作前后快照，不等同于精确峰值。

## 浏览器指标

LZMA HTML 会暴露：

```js
window.__PACK_RUNTIME_METRICS__
```

控制台也会输出同一份 JSON，包含：

```text
Payload Base64 解码耗时
LZMA 解码耗时
归档就绪时间
System.import 耗时
页面脚本开始到游戏入口完成时间
可用时的 usedJSHeapSize 快照
```

Chrome/Edge 支持 `performance.memory` 时会记录堆内存快照；其他浏览器中对应字段为 `null`。

## 浏览器验证

不要使用 `file://`。

```powershell
npm run serve
```

分别测试：

```text
http://127.0.0.1:8080/game-base64.html
http://127.0.0.1:8080/game-lzma-base64.html
```

重点检查：

- 游戏启动和所有场景；
- UI、图集、小图标和文字；
- 透明边缘、烟雾、发光和渐变；
- Bullet 物理；
- 音频和首次交互解锁；
- 控制台异常；
- LZMA 解码耗时、启动体验和内存。

## LZMA 实现

第一阶段固定使用 LZMA-JS 2.3.2：

- MIT 许可证；
- Node 研究端使用 `lzma-c-min.js` 和 `lzma-d-min.js`；
- 浏览器最终 HTML 只嵌入 `lzma-d-min.js`；
- 最终 HTML 内保留完整 MIT 许可证声明；
- 不需要 WASM、Worker 文件或额外网络请求。

上游源码固定在 `third-party/lzma-js/`，避免 npm 解析变化影响研究复现。

只有 LZMA + Base64 完成真实浏览器试玩后，才继续研究 LZMA + Base91 和 LZMA + HTML7。
