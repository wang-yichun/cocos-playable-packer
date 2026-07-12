# 音频分析与压缩

项目的音频工具分为三个阶段：

1. `audio:analyze`：只读分析构建目录中的音频；
2. `audio:benchmark`：生成多个 MP3 码率和声道候选，并提供浏览器试听页；
3. `audio:optimize` 或 `playable:build --audio-bitrate=N`：将选定参数用于生产工作副本。

生产流程当前只转码 MP3。WAV、OGG、M4A 会进入分析报告，但不会被自动改写。

## 1. 依赖

### npm 依赖

```text
music-metadata
```

用于读取：

- 编码格式；
- 时长；
- 码率；
- 采样率；
- 声道数；
- MP3 元数据状态。

### 外部工具：FFmpeg

转码使用 FFmpeg 的 `libmp3lame`。FFmpeg 不属于 npm 依赖，项目不会通过 `npm ci` 或 `npm install` 自动下载 FFmpeg。

以下操作需要 FFmpeg：

- `audio:benchmark`；
- `audio:optimize` 的实际转码；
- `playable:build` 并传入 `--audio-bitrate=N`；
- Web MVP 主动启用音频压缩。

`audio:analyze`、未启用音频压缩的 Pipeline，以及仅执行图片和 HTML 打包的流程不需要 FFmpeg。

默认命令：

```text
ffmpeg
```

安装后应在新的 PowerShell 窗口中验证：

```powershell
where.exe ffmpeg
ffmpeg -version
ffmpeg -encoders | Select-String libmp3lame
```

如果出现：

```text
spawn ffmpeg ENOENT
```

表示 Node.js 找不到 `ffmpeg` 可执行文件，通常不是 npm 包缺失。修改 Windows `Path` 后，需要重新打开终端并重启相关命令或 Web MVP 服务。

自定义路径：

```text
--ffmpeg="D:\Tools\ffmpeg\bin\ffmpeg.exe"
```

完整 Windows 安装步骤见 [FFmpeg 安装说明](ffmpeg-installation.md)。

## 2. 只读分析

```powershell
npm run audio:analyze -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./audio-analysis-report.json"
```

分析范围：

```text
.mp3
.wav
.ogg
.m4a
```

报告包含：

- 文件大小及其占总构建体积的比例；
- 时长、码率、采样率、声道和编码格式；
- 元数据解析完整度；
- MP3 ID3v1/ID3v2 标签大小；
- 移除 ID3 后的单文件 Brotli Q11 估算；
- 基于规则的候选优化提示。

该命令不修改文件，也不调用 FFmpeg。

需要注意：报告中的单文件 Brotli 数值用于筛选候选，不等同于最终 Solid Brotli 归档的真实收益。

## 3. 转码基准与试听

```powershell
npm run audio:benchmark -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./audio-benchmark" `
  --min-bitrate=160 `
  --bitrates=128,96,64,48
```

默认参数：

```text
--min-bitrate=160
--bitrates=128,96,64,48
--ffmpeg=ffmpeg
```

只对源码率不低于 `--min-bitrate` 的 MP3 生成候选。

对于立体声源文件，基准工具会同时生成：

```text
128k-stereo.mp3
128k-mono.mp3
96k-stereo.mp3
96k-mono.mp3
...
```

输出目录包含：

```text
audio-benchmark-report.json
audio-benchmark.html
candidates/<音频名>/original.mp3
candidates/<音频名>/<码率>-<声道>.mp3
```

`audio-benchmark.html` 可直接在浏览器中逐个试听原始版本和候选版本。

报告同时记录：

- 原始字节数；
- 候选字节数；
- 单文件 Brotli Q11 大小；
- 原始和 Brotli 估算收益；
- 实际输出码率；
- 声道数；
- SHA-256；
- 转码耗时。

基准命令不会覆盖 Cocos 构建目录。

## 4. 独立生产优化

### 预览

```powershell
npm run audio:optimize -- `
  "./web-mobile" `
  --bitrate=48 `
  --preview `
  --report="./audio-optimization-preview.json"
```

预览只判断哪些 MP3 将被处理，不调用实际替换流程。

### 确认应用

```powershell
npm run audio:optimize -- `
  "./web-mobile" `
  --bitrate=48 `
  --confirm `
  --report="./audio-optimization-apply.json"
```

生产优化器会：

1. 递归扫描 `.mp3`；
2. 使用 `music-metadata` 读取源码率和声道；
3. 跳过源码率小于或等于目标码率的文件；
4. 通过 FFmpeg `libmp3lame` 按目标码率编码；
5. 使用 `-map_metadata -1` 移除元数据；
6. 使用 `-vn` 排除封面或视频流；
7. 保持原声道数；
8. 校验输出码率不高于目标值加 1 kbps；
9. 校验输出声道与输入一致；
10. 输出不变小时保留原文件；
11. 通过临时文件和备份文件原子替换；
12. 记录前后 SHA-256 和体积。

目标码率范围：

```text
8-320 kbps
```

## 5. Pipeline 集成

不传 `--audio-bitrate` 时，音频压缩关闭。

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7-audio48.html" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --audio-bitrate=48 `
  --payload-encoding=html7 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

Pipeline 在工作区副本中执行音频转码，不修改输入构建目录。

最终报告包含：

```text
audioOptimization.enabled
audioOptimization.targetBitrateKbps
audioOptimization.preserveChannels
audioOptimization.beforeBytes
audioOptimization.afterBytes
audioOptimization.savedBytes
audioOptimization.savedPercent
timingMs.audioOptimization
```

工作区运行目录还会生成独立音频优化报告。

## 6. 48 kbps 的适用范围

48 kbps 通常更适合：

- 短促 UI 音效；
- 简单环境音；
- 语音提示；
- 频谱较窄、层次较少的广告游戏背景音。

需要重点试听：

- 高频打击声是否出现沙感；
- 金属、爆炸和枪声是否变薄；
- 背景音乐的镲片、弦乐和混响尾音是否出现水声或颗粒感；
- 循环衔接点是否异常；
- 立体声空间感是否仍符合预期。

生产优化器默认保持声道，不会自动把立体声改为单声道。单声道路线应先通过 `audio:benchmark` 试听，再决定是否另行实现或手工处理。

## 7. 自动检查

```powershell
npm run typecheck
npm run test:audio-analysis
npm run test:audio-benchmark
npm run test:audio-optimize
```

自动测试覆盖参数解析、元数据读取、候选生成、码率和声道校验、体积判定、报告及替换保护。

## 8. 真实游戏验收

音频路线必须在真实浏览器游戏中验证：

- 背景音乐是否正常播放和循环；
- 所有音效是否可触发；
- 音量关系是否变化；
- 左右声道和空间感是否正常；
- 页面失焦、恢复和场景切换后音频是否正常；
- 控制台是否有解码错误；
- 最终 HTML 是否获得足够体积收益。
