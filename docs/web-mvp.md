# Web MVP：ZIP 上传并生成 Playable HTML

当前 Web MVP 用于验证最小业务闭环：

```text
上传 web-mobile.zip
    ↓
服务端安全校验并解压
    ↓
选择优化压缩或仅合并单 HTML
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

## 构建模式

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

该模式的结果通常在 20 MB 左右，具体取决于原始构建大小。它主要用于：

- 兼容基线；
- 与只支持单 HTML 合并的竞品插件对照；
- 排查资源压缩是否导致运行差异；
- 不需要极限体积优化的场景。

选择该模式后，图片质量、音频码率和 Payload 控件会自动禁用。服务端也会把这些参数规范化为“不处理”，避免绕过网页控件提交冲突配置。

## FFmpeg 与 Web MVP

FFmpeg 是外部程序，不会由 `npm ci` 或 `npm install` 自动安装。

以下情况不需要 FFmpeg：

- 使用“仅合并单 HTML（不压缩）”；
- 优化模式中关闭音频压缩；
- 只执行图片优化、Brotli 打包和 Payload 编码。

启用音频压缩后，启动 Web MVP 的 Node.js 进程必须能从 Windows `Path` 中找到 `ffmpeg`。

推荐安装：

```powershell
winget install --id Gyan.FFmpeg -e --source winget
```

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

## API

### 上传 ZIP

```http
POST /api/uploads
Content-Type: application/zip

<ZIP 二进制>
```

返回 `uploadId`。

### 创建优化任务

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

### 创建仅合并单 HTML 任务

```http
POST /api/jobs
Content-Type: application/json

{
  "uploadId": "...",
  "config": {
    "buildMode": "raw-single-html"
  }
}
```

`config` 可省略。当前支持：

- `buildMode`：`optimized`、`raw-single-html`；
- `imageMode`：`none`、`squoosh`、`webp`；
- `pngQuality`；
- `jpegQuality`；
- `audioBitrateKbps`：`null` 表示关闭，传入 `8-320` 表示开启；
- `payloadEncoding`：`base64`、`base91`、`html7`；
- `brotliFallback`：当前网页固定使用 `raw-js`。

当 `buildMode` 为 `raw-single-html` 时，服务端会忽略其他优化字段，并规范化为：

```json
{
  "buildMode": "raw-single-html",
  "imageMode": "none",
  "pngQuality": 80,
  "jpegQuality": 80,
  "audioBitrateKbps": null,
  "payloadEncoding": "base64",
  "brotliFallback": "raw-js"
}
```

其中 `payloadEncoding` 在未压缩模式中不会实际参与输出，只作为统一配置模型的占位值。

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

未压缩模式的报告包含：

```text
buildMode: raw-single-html
processing.imageOptimization: false
processing.audioOptimization: false
processing.brotliCompression: false
processing.payloadEncoding: null
output.bytes
output.sha256
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
- 取消操作不能中断正在同步解压的单个 ZIP 文件，只会在解压后停止或终止 Pipeline。

正式公网部署前，应将试玩产物放到独立域名，并增加容器资源限制、任务持久化、文件保留策略和身份认证。

## 测试

```powershell
npm run typecheck
npm run test:web-mvp
```

自测覆盖：

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
