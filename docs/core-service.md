# Playable 构建服务接口

`src/service/build-playable-service.ts` 是 CLI、网页 Worker、Cocos Creator 扩展和未来桌面应用共用的程序化入口。

当前阶段采用稳定适配策略：服务层接收结构化参数，启动已经通过真实游戏验证的 `playable:build` Pipeline，并将日志、状态、取消信号和最终报告转换为稳定的 TypeScript API。底层 Pipeline 的压缩实现和现有 npm 命令保持不变。

## 基本调用

```ts
import { buildPlayable } from "../src/service/index.js";

const controller = new AbortController();

const result = await buildPlayable(
  {
    inputDirectory: "D:/Projects/Game/build/web-mobile",
    outputFile: "D:/Outputs/game.html",
    image: {
      mode: "webp",
      pngQuality: 80,
      jpegQuality: 80,
    },
    audio: {
      bitrateKbps: 48,
      ffmpegPath: "ffmpeg",
    },
    payloadEncoding: "html7",
    brotliFallback: "raw-js",
  },
  {
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "log") {
        console.log(`[${event.stream}] ${event.line}`);
        return;
      }
      console.log(`[${event.stage}] ${event.message}`);
    },
  },
);

console.log(result.outputFile);
console.log(result.outputBytes);
console.log(result.outputSha256);
```

## 服务职责

- 将结构化配置转换为现有 Pipeline 参数；
- 在执行前验证目录、输出扩展名和参数范围；
- 通过事件回调输出状态和逐行日志；
- 支持 `AbortSignal` 取消，并在 Windows 上终止子进程树；
- 读取最终 HTML 和 `.report.json`；
- 返回结构化结果；
- 使用稳定错误码区分参数、启动、执行、取消、输出和报告错误。

## 当前边界

服务层目前仍将经过验证的 TypeScript Pipeline 作为隔离子进程运行。这样可以避免第一轮服务化同时改写图片、音频、Payload 和 Brotli 各级流程。后续可逐步把各级 Pipeline 改造成直接函数调用，而网页 Worker 使用的 `buildPlayable()` 接口不需要改变。
