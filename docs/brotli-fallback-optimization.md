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

## 真实游戏验证结果

在当前 14.06 MB 解压后归档样本中：

```text
原始回退脚本：155,296 B
gzip 数据：      67,736 B
Base64 + Loader：91,564 B
HTML 减少：      63,732 B
最终 HTML：       4,627,982 B
最终减少：        1.36%
```

Chrome/Edge 实测：

```text
回退解码器展开：7.00 ms
Brotli 解压：    99.00 ms
游戏完整试玩：   正常
```

原始 JavaScript 回退版本的 Brotli 解压约为 95.80 ms，因此 gzip-packed JS 增加的主要成本是一次约 7 ms 的 gzip 展开，整体仍与原方案处于同一性能档位。

浏览器运行后可读取：

```js
window.__PACK_BROTLI_FALLBACK_METRICS__
```

## Pipeline 接入方式

`playable:build` 现在支持显式参数：

```text
--brotli-fallback=raw-js
--brotli-fallback=gzip-packed-js
```

默认仍为：

```text
raw-js
```

这样不会在未验证的渠道环境中改变现有兼容性行为。

### Base64

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-base64-gzip-fallback.html" `
  --image-mode=squoosh `
  --payload-encoding=base64 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

### Base91

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-base91-gzip-fallback.html" `
  --image-mode=squoosh `
  --payload-encoding=base91 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

### HTML7

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7-gzip-fallback.html" `
  --image-mode=squoosh `
  --payload-encoding=html7 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

最终 `.report.json` 会增加：

```text
brotliFallback.mode
brotliFallback.rawDecoderBytes
brotliFallback.gzipDecoderBytes
brotliFallback.loaderBytes
brotliFallback.savedBytes
brotliFallback.roundTrip
```

原有独立后处理命令仍保留，便于比较既有 HTML：

```powershell
npm run brotli:fallback:optimize -- `
  "./dist/game-base64.html" `
  "./dist/game-base64-gzip-fallback.html"
```

## 兼容性约束

`gzip-packed-js` 要求浏览器支持：

```text
DecompressionStream('gzip')
```

因此当前仍采用显式开关，不替换默认 `raw-js`。正式渠道发布前应在目标 Android WebView、广告容器或 WKWebView 中验证。

## 自动化测试

```powershell
npm run typecheck
npm run test:brotli-fallback
npm run test:brotli-fallback-pipeline
```

测试覆盖：

- 读取实际 `brotli-compress/js.mjs`；
- gzip 压缩与回环；
- HTML script 定位和替换；
- 浏览器式 `DecompressionStream('gzip')` 展开；
- 原有 Brotli JavaScript 解码器初始化；
- Brotli 测试数据完整解压；
- SHA/输出报告和原子替换；
- 重复优化和无目标脚本的错误保护；
- Pipeline 参数默认值、显式模式和非法参数；
- Base64、Base91、HTML7 参数透传；
- 最终报告合并与输出信息覆盖。

## 其它候选

### tiny-brotli-dec-wasm

解码专用、无运行依赖，许可证为 MIT 或 Apache-2.0。上游说明其 gzip 后的发布文件合计约 70.6 KiB。

但单 HTML 仍需要内嵌 WASM、初始化代码和文本编码。若直接 Base64 嵌入原始 WASM，未必比当前 91.6 KB 的 gzip-packed JS 更小；如果再次 gzip 包装 WASM，同样依赖 `DecompressionStream('gzip')`。

鉴于当前方案已在真实游戏中达到 7 ms 展开和 99 ms Brotli 解压，WASM 替换暂不具备足够明确的净收益。

### brotli-dec-wasm

解码专用且性能较高，但上游标称约 200 KB，直接内嵌对当前方案没有体积优势。

### brotli-wasm

包含压缩和解压，功能范围超过浏览器运行时只需要解压的需求，不作为首选体积方案。

## 合并标准

只有同时满足以下条件，才考虑将 `gzip-packed-js` 改为正式默认模式：

- Base64、Base91、HTML7 均通过真实游戏完整试玩；
- Chrome/Edge 中正常回退；
- 目标 Android WebView 或渠道容器支持 gzip `DecompressionStream`；
- 解码器展开和 Brotli 解压总耗时可接受；
- 控制台无异常；
- 最终 HTML 净减少达到预期。
