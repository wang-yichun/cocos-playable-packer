# Cocos Playable Packer

用于将 Cocos Creator 3.8.x `web-mobile` 构建产物优化并打包为离线 Playable 渠道包。

当前生产流程支持：

- 图片处理：`none`、TinyPNG、Squoosh PNG/JPEG、WebP；
- 音频处理：可选 MP3 码率压缩；
- 资源归档：Solid Brotli；
- Payload 编码：Base64、Safe Base91、HTML-safe 7-bit；
- Brotli 回退解码器：原始 JavaScript 或 gzip-packed JavaScript；
- Preview、AppLovin、Google、Facebook、Liftoff、IronSource、Unity、Moloco 等渠道交付；
- Web MVP：ZIP 上传、参数配置、浏览器试玩、渠道包下载和局域网访问；
- 工作区隔离、SHA-256 校验、JSON 报告和失败保护。

项目默认环境：Windows 11、PowerShell、Node.js 22、TypeScript。

## 1. 安装与检查

首次克隆或更换电脑后执行：

```powershell
npm ci
npm run typecheck
```

如果 `package-lock.json` 与 `package.json` 不一致，再执行：

```powershell
npm install
npm run typecheck
```

不要全局安装 `tsx`，项目使用 `devDependencies` 中的本地版本。

### FFmpeg（仅音频压缩需要）

FFmpeg 是外部程序，不属于 npm 依赖。`npm ci` 和 `npm install` 不会安装 FFmpeg。

以下功能必须能够执行 `ffmpeg`：

- `audio:benchmark`；
- `audio:optimize` 的实际转码；
- `playable:build` 并传入 `--audio-bitrate=N`；
- Web MVP 主动启用音频压缩。

不传 `--audio-bitrate`、Web MVP 保持音频压缩关闭、只处理图片或打包 HTML 时，不需要 FFmpeg。

公司电脑已验证可使用 Chocolatey 安装：

```powershell
choco install ffmpeg
```

当前公司环境中 `winget install` 无法使用，原因尚未定位，因此不要将 Winget 作为公司电脑的默认安装方式。未安装 Chocolatey 时可改用手动安装。

安装完成后，关闭并重新打开 PowerShell、VS Code 终端和已经启动的 Web MVP 服务。

安装后验证：

```powershell
where.exe ffmpeg
Get-Command ffmpeg -ErrorAction SilentlyContinue
ffmpeg -version
ffmpeg -encoders | Select-String libmp3lame
```

CLI 也可以通过完整路径指定可执行文件：

```text
--ffmpeg="D:\Tools\ffmpeg\bin\ffmpeg.exe"
```

出现 `spawn ffmpeg ENOENT` 表示 Node.js 找不到 `ffmpeg` 可执行文件，通常不是 npm 包缺失。

完整步骤见 [FFmpeg 安装说明](docs/ffmpeg-installation.md)。

### TinyPNG 环境变量

TinyPNG 模式需要在项目根目录创建 `.env`：

```env
TINYPNG_API_KEY=你的TinyPNG_API_Key

# 直连失败时可选
# TINYPNG_PROXY=http://127.0.0.1:7890
```

`.env`、缓存、工作区副本和构建产物不得提交到 Git。

## 2. Web MVP（浏览器界面）

### Windows 一键启动

首次使用先完成依赖安装：

```powershell
npm ci
```

然后双击项目根目录中的：

```text
start-web-mvp.cmd
```

启动器会自动检查 Node.js、npm 和项目依赖，后台启动 Web MVP，等待健康检查完成，并打开本机浏览器。关闭启动器窗口不会停止后台服务。

重复双击启动文件不会创建第二个服务；启动器会检测已有实例并重新打开浏览器。

### 停止服务

双击：

```text
stop-web-mvp.cmd
```

也可以在 PowerShell 中执行：

```powershell
npm run web:mvp:stop
```

### 桌面快捷方式

双击：

```text
install-web-mvp-shortcuts.cmd
```

会在当前用户桌面创建 Web MVP 的启动和停止快捷方式。

### 命令行控制

```powershell
npm run web:mvp:start
npm run web:mvp:status
npm run web:mvp:stop
```

只启动服务但不自动打开浏览器：

```powershell
node ./scripts/web-mvp-launcher.mjs start --no-open
```

### 前台调试方式

需要在当前终端直接查看实时日志时，可以运行：

```powershell
npm run web:mvp
```

该方式会占用当前终端，按 `Ctrl+C` 停止。不要再使用一键停止脚本结束并非由启动器管理的前台实例。

默认监听：

```text
0.0.0.0:4173
```

启动日志会输出可直接访问的地址，例如：

```text
本机地址：http://127.0.0.1:4173
局域网地址：http://192.168.1.100:4173
监听：0.0.0.0:4173
```

本机浏览器使用“本机地址”。同一局域网内的其他电脑或手机使用终端输出的“局域网地址”。`0.0.0.0` 是监听配置，不是浏览器访问地址。

局域网访问还需要 Windows 防火墙允许 Node.js 或 TCP 4173 端口，并且公司 Wi-Fi、访客网络或路由器没有启用客户端隔离。

仅允许本机访问：

```powershell
$env:PLAYABLE_WEB_HOST = "127.0.0.1"
npm run web:mvp:start
```

修改端口：

```powershell
$env:PLAYABLE_WEB_PORT = "5173"
npm run web:mvp:start
```

Web MVP 没有登录鉴权，只应在可信局域网中运行，不要通过端口转发暴露到公网。

一键启动器的 PID、日志、重复启动保护和桌面快捷方式说明见 [Web MVP 一键启动说明](docs/web-mvp-one-click-launcher.md)。完整的构建、局域网、防火墙、API 和排查说明见 [Web MVP 使用说明](docs/web-mvp.md)。

## 3. 推荐：一条命令完成 Playable 构建

### Squoosh PNG/JPEG + MP3 48 kbps + HTML7

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7-squoosh80-audio48.html" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --audio-bitrate=48 `
  --payload-encoding=html7 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

### WebP Q80 + MP3 48 kbps + HTML7

```powershell
npm run playable:build -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  "./dist/game-html7-webp80-audio48.html" `
  --image-mode=webp `
  --png-webp-quality=80 `
  --jpeg-webp-quality=80 `
  --audio-bitrate=48 `
  --payload-encoding=html7 `
  --brotli-fallback=gzip-packed-js `
  --project=game141
```

Pipeline 会先复制输入构建，再在工作区副本中优化资源。原始 Cocos `web-mobile` 目录不会被修改。

主要输出：

```text
<输出文件>.html
<输出文件>.report.json
workspaces/<project>/reports/<timestamp>.json
```

需要保留工作区副本时增加：

```text
--keep-workspace
```

## 4. 图片模式

| 模式 | 作用 | 主要实现 |
| --- | --- | --- |
| `none` | 不修改图片 | 仅复制和校验 |
| `tinypng` | 调用 TinyPNG API 压缩构建图片 | `tinify` |
| `squoosh` | PNG 调色板量化 + OxiPNG；JPEG 使用 MozJPEG | `sharp`、`@jsquash/oxipng`、`@jsquash/jpeg` |
| `webp` | 将 PNG/JPEG 内容编码为 WebP，保留原逻辑路径 | `sharp`、`@jsquash/webp` |

### 不压缩图片

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game.html" `
  --image-mode=none
```

### TinyPNG

为避免意外消耗 API 配额，必须显式指定 `--all` 或 `--limit=N`：

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-tinypng.html" `
  --image-mode=tinypng `
  --all
```

### Squoosh

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-squoosh.html" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80
```

PNG 还支持：

```text
--colours=256
--effort=10
--dither=0.5
--oxipng-level=3
```

`--oxipng-level` 是无损 PNG 优化等级，不是画质参数。

### WebP

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-webp.html" `
  --image-mode=webp `
  --png-webp-quality=80 `
  --jpeg-webp-quality=80
```

WebP 模式只在候选文件同时满足以下条件时替换内容：

- WebP 原始字节数更小；
- WebP 经 Brotli Q11 后仍更小。

文件引用路径和扩展名保持不变，打包器按文件内容识别真实 MIME 类型。

详见 [图片优化说明](docs/image-optimization.md) 和 [WebP 路线说明](docs/webp-optimization.md)。

## 5. 音频压缩

Pipeline 的音频压缩是可选项。不传 `--audio-bitrate` 时完全关闭。

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game-audio48.html" `
  --image-mode=none `
  --audio-bitrate=48
```

当前生产优化器：

- 只扫描 `.mp3`；
- 只处理源码率高于目标码率的文件；
- 使用 FFmpeg `libmp3lame`；
- 保持原声道数；
- 移除元数据和封面流；
- 校验输出码率、声道、体积和 SHA-256；
- 输出不变小则保留原文件。

详见 [音频优化说明](docs/audio-optimization.md) 和 [FFmpeg 安装说明](docs/ffmpeg-installation.md)。

## 6. Payload 编码

```text
--payload-encoding=base64
--payload-encoding=base91
--payload-encoding=html7
```

- `base64`：默认模式，兼容性最高；
- `base91`：更高密度的可打印 ASCII；
- `html7`：HTML-safe 7-bit 路线，当前体积最小，但仍应按渠道验证。

未指定时默认为 `base64`。

## 7. Brotli 回退解码器

```text
--brotli-fallback=raw-js
--brotli-fallback=gzip-packed-js
```

- `raw-js`：默认模式，兼容性最高；
- `gzip-packed-js`：将 JavaScript Brotli 解码器再次 gzip 压缩，运行时通过 `DecompressionStream('gzip')` 展开，可进一步减小 HTML。

目标广告容器或 WebView 未验证前，不应假设其支持 `gzip-packed-js`。

## 8. 独立分析与优化命令

### 构建资源分析

```powershell
npm run analyze -- `
  "./web-mobile" `
  "./compression-report.json"
```

### 图片独立入口

```powershell
npm run images:optimize -- `
  "./web-mobile" `
  --image-mode=squoosh `
  --png-quality=80 `
  --jpeg-quality=80 `
  --preview
```

### 音频分析

```powershell
npm run audio:analyze -- `
  "./web-mobile" `
  "./audio-analysis-report.json"
```

### 音频转码基准与试听页

```powershell
npm run audio:benchmark -- `
  "./web-mobile" `
  "./audio-benchmark" `
  --min-bitrate=160 `
  --bitrates=128,96,64,48
```

### WebP 批量基准与预览页

```powershell
npm run webp:benchmark-build -- `
  "./web-mobile" `
  "./webp-benchmark" `
  --png-quality=80 `
  --jpeg-quality=80
```

### 仅执行 Brotli 单 HTML 打包

```powershell
npm run pack:br -- `
  "./web-mobile" `
  "./dist/game-compressed.html"
```

## 9. 技术组成

| 组件 | 用途 |
| --- | --- |
| Node.js `zlib` | Solid Brotli Q11、gzip-packed 回退脚本 |
| `brotli-compress` | 浏览器 JavaScript Brotli 回退解码器 |
| `sharp` | 图片解码、像素读取和 PNG 调色板量化 |
| `@jsquash/oxipng` | PNG 无损重排与压缩 |
| `@jsquash/jpeg` | MozJPEG 编码 |
| `@jsquash/webp` | libwebp WASM 编码 |
| `tinify` | TinyPNG API 客户端 |
| `music-metadata` | 音频格式、码率、时长、采样率和声道分析 |
| FFmpeg / `libmp3lame` | MP3 候选生成与生产转码 |
| `acorn`、`acorn-walk` | JavaScript 与 SystemJS 模块结构分析 |
| `cheerio` | HTML 结构处理 |
| `tsx`、TypeScript | TypeScript 命令执行和静态检查 |

更完整的分层说明见 [技术概况](docs/technical-overview.md)。

## 10. 缓存与生成目录

以下内容保持本地化，不提交到 Git：

```text
node_modules/
dist/
web-mobile/
.squoosh-cache/
.tinypng-cache/
workspaces/*/runs/
workspaces/*/reports/
workspaces/*/preview/
workspaces/*/backups/
.env
.env.*
```

`.env.example` 可以提交。

## 11. 自动检查

```powershell
npm run typecheck
npm run test:web-mvp-network
npm run test:web-mvp
npm run test:audio-analysis
npm run test:audio-benchmark
npm run test:audio-optimize
npm run test:webp-benchmark
npm run test:webp-optimize
npm run test:squoosh-jpeg
npm run test:image-quality-pipeline
npm run test:brotli-fallback
npm run test:brotli-fallback-pipeline
```

## 12. 浏览器验收

自动检查不能替代真实游戏验证。发布前至少确认：

- 游戏正常启动，所有场景可进入；
- UI、图集、字体、小图标和透明边缘正常；
- 烟雾、发光、渐变和照片类纹理无明显劣化；
- 音效、背景音乐和声道表现正常；
- Bullet 物理及游戏逻辑正常；
- 浏览器控制台无新增异常；
- Brotli 解压耗时可接受；
- 最终 HTML 满足渠道体积限制。
