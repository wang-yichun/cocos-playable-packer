# Web MVP：ZIP 上传并生成 Playable HTML

当前 Web MVP 用于验证以下业务闭环：

```text
选择构建配置
    ↓
上传 web-mobile.zip
    ↓
服务端安全校验并解压
    ↓
调用 buildPlayable()
    ↓
生成单 HTML 与 report.json
    ↓
下载或浏览器试玩
```

## 启动

```powershell
npm run web:mvp
```

默认地址：

```text
http://127.0.0.1:4173
```

可通过环境变量覆盖：

```powershell
$env:PLAYABLE_WEB_HOST = "127.0.0.1"
$env:PLAYABLE_WEB_PORT = "4173"
$env:PLAYABLE_WEB_ROOT = ".packer-web"
npm run web:mvp
```

## 基础配置面板

网页当前开放以下配置：

- 图片模式：`none`、`squoosh`、`webp`；
- PNG 质量；
- JPEG 质量；
- 音频压缩开关；
- 音频目标码率；
- Payload 编码：`base64`、`base91`、`html7`。

Brotli 回退模式在当前基础面板中固定为：

```text
raw-js
```

选择 `none` 时，PNG 和 JPEG 质量输入会自动禁用。关闭音频压缩时，音频码率输入会自动禁用。

页面会在构建前校验：

```text
WebP PNG 质量：1-100
Squoosh PNG 质量：0-100
JPEG 质量：1-100
音频码率：8-320 kbps
```

构建开始后，ZIP 选择和全部配置控件会锁定，防止任务参数在执行期间变化。

## 默认配置

页面首次打开时采用不依赖 FFmpeg 的安全默认配置：

```text
图片：WebP
PNG WebP Quality：80
JPEG WebP Quality：80
音频：关闭
Payload：HTML7
Brotli 回退：raw-js
```

## 一键推荐预设

点击“应用一键推荐预设”后，页面会切换为当前已经完成真实游戏试玩验证的组合：

```text
图片：WebP
PNG WebP Quality：80
JPEG WebP Quality：80
音频：48 kbps，保持原声道数
Payload：HTML7
Brotli 回退：raw-js
```

推荐预设会启用音频压缩，因此启动 Web MVP 的系统必须能够执行 FFmpeg。

## FFmpeg 与 Web MVP

FFmpeg 是外部程序，不会由 `npm ci` 或 `npm install` 自动安装。

Windows 推荐安装命令：

```powershell
winget install --id Gyan.FFmpeg -e --source winget
```

安装后重新打开 PowerShell 或 VS Code 终端，并验证：

```powershell
where.exe ffmpeg
ffmpeg -version
ffmpeg -encoders | Select-String libmp3lame
```

以下情况不需要 FFmpeg：

- 使用页面默认配置；
- 音频压缩开关关闭；
- `audioBitrateKbps` 为 `null`；
- 只执行图片优化、Brotli 打包和 Payload 编码。

启用音频压缩后，启动 Web MVP 的 Node.js 进程必须能从 Windows `Path` 中找到 `ffmpeg`。

典型缺失错误：

```text
无法启动 FFmpeg（ffmpeg）：spawn ffmpeg ENOENT
```

该错误表示运行 Web MVP 的进程找不到 `ffmpeg.exe`，通常不是 npm 包缺失。

如果刚安装 FFmpeg 或修改了 `Path`：

1. 在运行 `npm run web:mvp` 的窗口按 `Ctrl+C`；
2. 关闭当前 PowerShell 或 VS Code 终端；
3. 重新打开终端；
4. 确认 `ffmpeg -version` 成功；
5. 重新执行 `npm run web:mvp`。

当前 Web MVP 配置接口尚未开放自定义 `ffmpegPath`，因此启用音频压缩时应通过系统 `Path` 提供 FFmpeg。完整说明见 [FFmpeg 安装说明](ffmpeg-installation.md)。

## API

### 上传 ZIP

```http
POST /api/uploads
Content-Type: application/zip

<ZIP 二进制>
```

返回 `uploadId`。

### 创建任务

```http
POST /api/jobs
Content-Type: application/json

{
  "uploadId": "...",
  "config": {
    "imageMode": "webp",
    "pngQuality": 80,
    "jpegQuality": 80,
    "audioBitrateKbps": 48,
    "payloadEncoding": "html7",
    "brotliFallback": "raw-js"
  }
}
```

关闭音频时发送：

```json
{
  "audioBitrateKbps": null
}
```

`config` 可省略。省略后使用服务端默认配置。

当前支持：

- `imageMode`：`none`、`squoosh`、`webp`；
- `pngQuality`；
- `jpegQuality`；
- `audioBitrateKbps`：`null` 表示关闭，`8-320` 表示启用；
- `payloadEncoding`：`base64`、`base91`、`html7`；
- `brotliFallback`：`raw-js`、`gzip-packed-js`。

TinyPNG 暂未开放给网页接口，避免服务器端 API 密钥和配额在 MVP 阶段被误用。

### 查询任务

```http
GET /api/jobs/<jobId>
```

任务状态：

```text
queued
extracting
building
succeeded
failed
cancelled
```

### 取消任务

```http
POST /api/jobs/<jobId>/cancel
```

### 下载与试玩

成功任务会返回：

```text
/artifacts/<jobId>/game.html
/artifacts/<jobId>/report.json
/preview/<jobId>/
```

## ZIP 安全限制

MVP 使用项目内置 ZIP 解析器，不新增 npm 依赖。当前支持普通 Store 和 Deflate ZIP，并拒绝：

- 路径穿越；
- 绝对路径；
- Windows 设备名和异常文件名；
- 符号链接；
- 加密 ZIP；
- 分卷 ZIP；
- ZIP64；
- 不支持的压缩方法；
- 重复路径；
- 超过限制的压缩包、文件数量和解压后体积；
- CRC32 或大小校验失败的文件。

默认限制：

```text
上传 ZIP：64 MB
解压后总体积：512 MB
文件条目：5000
单文件：128 MB
路径深度：24
```

ZIP 根目录本身，或唯一一级子目录中必须存在 `index.html`。

## 当前限制

该版本只用于本地或可信内网验证，还不是公网生产服务：

- 任务和上传记录仅保存在内存中，服务重启后不能继续查询旧任务；
- 任务单并发顺序执行；
- 没有用户、团队、项目和权限系统；
- 没有对象存储、Redis 或持久化数据库；
- 试玩页面与管理页面仍是同一 Origin；
- 没有自动清理历史输出目录；
- 取消操作不能中断正在同步解压的单个 ZIP 文件，只会在解压后停止或终止 Pipeline；
- 基础面板暂未开放 TinyPNG、FFmpeg 路径和 Brotli 回退模式。

正式公网部署前，应将试玩产物放到独立域名，并增加容器资源限制、任务持久化、文件保留策略和身份认证。

## 测试

```powershell
npm run typecheck
npm run test:web-mvp
```

自测覆盖：

- 默认配置和推荐预设；
- 配置控件和任务请求结构；
- 页面内嵌脚本语法；
- ZIP 生成、上传、解压；
- 一级 `web-mobile` 目录识别；
- 任务创建与轮询；
- 服务层调用；
- HTML、报告下载；
- 在线试玩路由；
- 路径穿越 ZIP 拒绝。
