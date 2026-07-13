# Web MVP：ZIP 上传并生成 Playable 渠道包

Web MVP 是 Cocos Playable Packer 的浏览器操作界面，用于上传 Cocos Creator `web-mobile` 构建 ZIP、配置压缩参数、生成渠道包、试玩并下载最终产物。

基本流程：

```text
上传 web-mobile.zip
    ↓
服务端安全校验并解压
    ↓
选择构建模式、压缩参数和目标渠道
    ↓
生成 HTML、渠道 ZIP 与 report.json
    ↓
浏览器试玩或下载产物
```

当前界面支持：

- 优化并压缩、仅合并单 HTML 两种构建模式；
- Squoosh PNG/JPEG、WebP 图片路线；
- 可选 MP3 码率压缩；
- Base64、Base91、HTML7 Payload 编码；
- Brotli 回退解码器配置；
- Preview、AppLovin、Google、Facebook、Liftoff、IronSource、Unity、Moloco 等渠道；
- 多渠道批量生成；
- 可选加载 Logo 与进度条；
- 浏览器试玩、报告查看和产物下载。

## 1. 启动

首次克隆或更换电脑后执行：

```powershell
npm ci
npm run typecheck
```

启动 Web MVP：

```powershell
npm run web:mvp
```

默认配置：

```text
监听地址：0.0.0.0
端口：4173
数据目录：<项目根目录>/.packer-web
```

`0.0.0.0` 表示服务监听所有 IPv4 网卡，不是浏览器中应直接输入的访问地址。启动后终端会输出可用地址，例如：

```text
本机地址：http://127.0.0.1:4173
局域网地址：http://192.168.1.100:4173
监听：0.0.0.0:4173
```

本机浏览器使用“本机地址”。同一局域网内的其他电脑或手机使用终端输出的“局域网地址”。

## 2. 局域网访问

局域网设备需要同时满足：

- 与运行 Web MVP 的电脑处于同一局域网；
- 使用运行电脑的实际 IPv4 地址，而不是 `127.0.0.1` 或 `0.0.0.0`；
- Windows 防火墙允许 Node.js 或 TCP 4173 端口入站；
- 路由器、公司 Wi-Fi 或访客网络没有启用客户端隔离；
- VPN、代理软件没有阻断本地网络访问。

在运行电脑上查看 IPv4 地址：

```powershell
ipconfig
```

确认服务正在监听：

```powershell
Get-NetTCPConnection -LocalPort 4173 -State Listen
```

预期应看到 `LocalAddress` 为 `0.0.0.0` 或实际网卡地址，而不是仅有 `127.0.0.1`。

从另一台 Windows 电脑测试端口：

```powershell
Test-NetConnection 192.168.1.100 -Port 4173
```

将 `192.168.1.100` 替换为启动日志或 `ipconfig` 中显示的地址。`TcpTestSucceeded` 应为 `True`。

### Windows 防火墙

第一次启动 Node.js 网络服务时，Windows 可能弹出防火墙提示。只勾选可信的“专用网络”，不要在不受信任的公用网络中开放。

如果没有弹窗且局域网端口测试失败，可先检查 Windows 安全中心中的“允许应用通过防火墙”，确认 Node.js 在专用网络中被允许。

管理员确认允许后，也可以显式开放 TCP 4173：

```powershell
New-NetFirewallRule `
  -DisplayName "Cocos Playable Packer Web MVP" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 4173 `
  -Profile Private
```

不再需要时可删除该规则：

```powershell
Remove-NetFirewallRule `
  -DisplayName "Cocos Playable Packer Web MVP"
```

公司电脑可能受组策略管理。如果命令被拒绝，应由管理员处理，不要绕过公司安全策略。

## 3. 环境变量

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PLAYABLE_WEB_HOST` | `0.0.0.0` | HTTP 服务监听地址 |
| `PLAYABLE_WEB_PORT` | `4173` | HTTP 服务端口 |
| `PLAYABLE_WEB_ROOT` | `.packer-web` | 上传、任务和产物数据目录 |

### 仅允许本机访问

```powershell
$env:PLAYABLE_WEB_HOST = "127.0.0.1"
npm run web:mvp
```

### 修改端口

```powershell
$env:PLAYABLE_WEB_PORT = "5173"
npm run web:mvp
```

### 指定数据目录

```powershell
$env:PLAYABLE_WEB_ROOT = "D:\PlayablePackerData"
npm run web:mvp
```

这些环境变量只影响当前 PowerShell 会话。需要清除时执行：

```powershell
Remove-Item Env:PLAYABLE_WEB_HOST -ErrorAction SilentlyContinue
Remove-Item Env:PLAYABLE_WEB_PORT -ErrorAction SilentlyContinue
Remove-Item Env:PLAYABLE_WEB_ROOT -ErrorAction SilentlyContinue
```

## 4. 构建模式

网页提供两种构建模式。

### 优化并压缩

执行完整 Pipeline，可配置图片、音频和 Payload：

```text
图片：none / Squoosh / WebP
PNG/JPEG 质量：可配置
音频：关闭或 8-320 kbps
Payload：Base64 / Base91 / HTML7
Brotli 回退：raw-js
```

页面首次打开时使用安全默认配置：

```text
构建模式：优化并压缩
图片：WebP
PNG WebP Quality：80
JPEG WebP Quality：80
音频：关闭
Payload：HTML7
Brotli 回退：raw-js
```

点击“一键推荐预设”后使用已经通过真实游戏验证的组合：

```text
构建模式：优化并压缩
图片：WebP 80
音频：48 kbps
Payload：HTML7
Brotli 回退：raw-js
```

推荐预设启用音频压缩，因此运行环境必须能够执行 FFmpeg。

### 仅合并单 HTML（不压缩）

该模式直接复用项目现有的 `pack:raw` 单 HTML 打包逻辑：

```text
图片压缩：关闭
音频压缩：关闭
Solid Brotli：关闭
Base64/Base91/HTML7 Payload：不使用
```

它仍会完成：

- Cocos Creator `web-mobile` 文件内嵌；
- SystemJS/Cocos Bundle 兼容处理；
- 单 HTML 输出；
- SHA-256 与报告生成；
- 在线试玩和文件下载。

该模式主要用于兼容基线、竞品对照、压缩问题排查以及不需要极限体积优化的场景。

选择该模式后，图片质量、音频码率和 Payload 控件会自动禁用。服务端也会把这些参数规范化为“不处理”，避免绕过网页控件提交冲突配置。

## 5. FFmpeg 与 Web MVP

FFmpeg 是外部程序，不会由 `npm ci` 或 `npm install` 自动安装。

以下情况不需要 FFmpeg：

- 使用“仅合并单 HTML（不压缩）”；
- 优化模式中关闭音频压缩；
- 只执行图片优化、Brotli 打包和 Payload 编码。

启用音频压缩后，启动 Web MVP 的 Node.js 进程必须能从 Windows `Path` 中找到 `ffmpeg`。

公司电脑已验证安装命令：

```powershell
choco install ffmpeg
```

当前公司环境中 `winget install` 无法使用，原因尚未定位，因此不要将 Winget 作为公司电脑的默认安装方式。

启动服务前建议验证：

```powershell
where.exe ffmpeg
ffmpeg -version
ffmpeg -encoders | Select-String libmp3lame
```

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

完整安装与排查步骤见 [FFmpeg 安装说明](ffmpeg-installation.md)。

## 6. 基本使用流程

1. 使用 Cocos Creator 3.8.x 构建 `web-mobile`；
2. 将构建目录压缩为 ZIP；
3. 执行 `npm run web:mvp`；
4. 浏览器打开终端输出的地址；
5. 上传 ZIP；
6. 配置构建模式、图片、音频、Payload、Brotli 回退和目标渠道；
7. 创建任务并等待完成；
8. 先在浏览器中试玩；
9. 下载 HTML、渠道 ZIP 或报告；
10. 在真实广告渠道或 Validator 中继续验证。

ZIP 根目录本身，或唯一一级子目录中必须存在 `index.html`。因此可以直接压缩 `web-mobile` 中的内容，也可以让 `web-mobile` 位于 ZIP 的第一层目录。

## 7. API

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
    "buildMode": "optimized",
    "imageMode": "webp",
    "pngQuality": 80,
    "jpegQuality": 80,
    "audioBitrateKbps": 48,
    "payloadEncoding": "html7",
    "brotliFallback": "raw-js"
  }
}
```

仅合并单 HTML：

```json
{
  "uploadId": "...",
  "config": {
    "buildMode": "raw-single-html"
  }
}
```

`config` 支持：

- `buildMode`：`optimized`、`raw-single-html`；
- `imageMode`：`none`、`squoosh`、`webp`；
- `pngQuality`；
- `jpegQuality`；
- `audioBitrateKbps`：`null` 表示关闭，传入 `8-320` 表示开启；
- `payloadEncoding`：`base64`、`base91`、`html7`；
- `brotliFallback`：当前网页固定使用 `raw-js`。

TinyPNG 暂未开放给网页接口，避免服务器端 API 密钥和配额在 MVP 阶段被误用。

### 查询与取消任务

```http
GET /api/jobs/<jobId>
POST /api/jobs/<jobId>/cancel
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

### 下载与试玩

成功任务会返回：

```text
/artifacts/<jobId>/game.html
/artifacts/<jobId>/report.json
/preview/<jobId>/
```

## 8. ZIP 安全限制

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

## 9. 安全说明与当前限制

当前 Web MVP 没有登录、密码或访问令牌。监听 `0.0.0.0` 后，同一网络中能够访问该端口的设备都可能上传文件、创建任务和下载产物。

因此必须遵守：

- 只在可信局域网中运行；
- 不要通过路由器端口转发暴露到公网；
- 不要在公共 Wi-Fi 中开放；
- 不使用时停止服务；
- 需要仅本机操作时设置 `PLAYABLE_WEB_HOST=127.0.0.1`。

停止服务可在运行终端按 `Ctrl+C`。

该版本仍不是公网生产服务：

- 任务和上传记录仅保存在内存中，服务重启后不能继续查询旧任务；
- 任务单并发顺序执行；
- 没有用户、团队、项目和权限系统；
- 没有对象存储、Redis 或持久化数据库；
- 试玩页面与管理页面仍是同一 Origin；
- 没有自动清理历史输出目录；
- 取消操作不能中断正在同步解压的单个 ZIP 文件，只会在解压后停止或终止 Pipeline。

正式公网部署前，应将试玩产物放到独立域名，并增加容器资源限制、任务持久化、文件保留策略和身份认证。

## 10. 常见问题

### 本机能打开，其他设备打不开

依次检查：

```powershell
Get-NetTCPConnection -LocalPort 4173 -State Listen
ipconfig
```

然后在另一台电脑执行：

```powershell
Test-NetConnection <运行电脑IPv4地址> -Port 4173
```

常见原因包括 Windows 防火墙、公司网络客户端隔离、访客 Wi-Fi、VPN 虚拟网卡或使用了错误的 IPv4 地址。

### 终端显示多个局域网地址

电脑可能同时存在有线网卡、无线网卡、VPN、虚拟机或 WSL 网卡。优先选择与访问设备处于同一网段的地址。例如手机是 `192.168.1.x`，通常应选择同为 `192.168.1.x` 的地址。

### 访问 `http://0.0.0.0:4173` 失败

`0.0.0.0` 是监听配置，不是客户端访问地址。请使用本机地址 `http://127.0.0.1:4173` 或终端输出的局域网地址。

## 11. 测试

```powershell
npm run typecheck
npm run test:web-mvp-network
npm run test:web-mvp
```

自测覆盖：

- 默认监听地址、端口校验和局域网地址枚举；
- 默认配置、推荐预设和配置校验；
- 未压缩模式参数规范化；
- 未压缩任务路由到 `pack:raw` 包装器；
- 页面内嵌脚本语法；
- ZIP 生成、上传、解压；
- 一级 `web-mobile` 目录识别；
- 优化任务和未压缩任务创建与轮询；
- HTML、报告下载；
- 在线试玩路由；
- 路径穿越 ZIP 拒绝。
