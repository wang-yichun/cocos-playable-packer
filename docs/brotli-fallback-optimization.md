# Brotli JavaScript 回退解码器优化研究

## 目标

缩小当前单 HTML 中约 155 KB 的 `brotli-compress/js.mjs` 回退解码器，同时保持：

- Brotli Q11 归档内容不变；
- Payload 编码不变；
- 原有 JavaScript Brotli 解码实现不变；
- 浏览器原生 Brotli 优先策略不变；
- 输出仍为离线单 HTML。

## 第一阶段方案：gzip-packed JS

将已经验证过的 `brotli-compress/js 1.3.3` 解码器进行 gzip level 9 压缩，再以 Base64 嵌入 HTML。

只有浏览器原生 Brotli 不可用、真正需要回退时才执行：

```text
Base64 解码 gzip 数据
    ↓
DecompressionStream('gzip') 展开 JavaScript
    ↓
eval 初始化原有 brotli-compress 解码器
    ↓
执行 Brotli 解压
```

这不会改变资源归档算法，也不会更换实际 Brotli 解码逻辑。

## 当前自动化测量

针对项目当前安装的 `brotli-compress@1.3.3`：

```text
原始回退脚本：155,294 B
gzip 数据：      67,732 B
Base64 + Loader：91,560 B
HTML 减少：      63,734 B
```

按此前 4,691,714 B 的 Base64 HTML 估算，可减少约 1.36%。

测试环境中的解码器展开耗时约 16 ms；真实 Chrome、Android WebView 和渠道容器结果以实机报告为准。

## 兼容性约束

该研究模式要求浏览器支持：

```text
DecompressionStream('gzip')
```

因此第一阶段仅作为独立后处理和实机研究，不直接替换正式 Pipeline 默认模式。

浏览器运行后可读取：

```js
window.__PACK_BROTLI_FALLBACK_METRICS__
```

## 使用

先生成现有基线 HTML：

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-base64.html" `
  --image-mode=squoosh `
  --payload-encoding=base64 `
  --project=game141
```

再优化回退解码器：

```powershell
npm run brotli:fallback:optimize -- `
  "./dist/game-base64.html" `
  "./dist/game-base64-gzip-fallback.html"
```

输出报告：

```text
dist/game-base64-gzip-fallback.brotli-decoder-report.json
```

启动静态服务：

```powershell
npm run serve
```

比较：

```text
http://127.0.0.1:8080/game-base64.html
http://127.0.0.1:8080/game-base64-gzip-fallback.html
```

## 自动化测试

```powershell
npm run typecheck
npm run test:brotli-fallback
```

测试覆盖：

- 读取实际 `brotli-compress/js.mjs`；
- gzip 压缩与回环；
- HTML script 定位和替换；
- 浏览器式 `DecompressionStream('gzip')` 展开；
- 原有 Brotli JavaScript 解码器初始化；
- Brotli 测试数据完整解压；
- SHA/输出报告和原子替换；
- 重复优化和无目标脚本的错误保护。

## 其它候选

### tiny-brotli-dec-wasm

解码专用、无运行依赖，许可证为 MIT 或 Apache-2.0。上游说明其 gzip 后的发布文件合计约 70.6 KiB。

但单 HTML 仍需要内嵌 WASM、初始化代码和文本编码。若直接 Base64 嵌入原始 WASM，未必比当前 gzip-packed JS 更小；如果再次 gzip 包装 WASM，同样依赖 `DecompressionStream('gzip')`。

第一阶段先验证改动最小、实际解码逻辑不变的 gzip-packed JS。若实机兼容性或速度不达标，再进入 WASM 对比。

### brotli-dec-wasm

解码专用且性能较高，但上游标称约 200 KB，直接内嵌对当前 155 KB JavaScript 回退没有明确体积优势。

### brotli-wasm

包含压缩和解压，功能范围超过浏览器运行时只需要解压的需求，不作为首选体积方案。

## 合并标准

只有同时满足以下条件，才考虑集成到正式 Pipeline：

- 真实游戏完整试玩通过；
- Chrome/Edge 中正常回退；
- 目标 Android WebView 或渠道容器支持 gzip `DecompressionStream`；
- 解码器展开和 Brotli 解压总耗时可接受；
- 控制台无异常；
- 最终 HTML 净减少达到预期；
- Base64、Base91、HTML7 路线均未被破坏。
