# Web MVP：ZIP 上传并生成 Playable HTML

当前 Web MVP 用于验证最小业务闭环：

```text
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

## 默认构建参数

```text
图片：WebP
PNG WebP Quality：80
JPEG WebP Quality：80
音频：48 kbps
Payload：HTML7
Brotli 回退：raw-js
```

网页暂时不展示配置面板，但创建任务接口已经接受 `config` 对象，后续可以在不修改上传流程的情况下加入参数控件。

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

`config` 可省略。当前支持：

- `imageMode`：`none`、`squoosh`、`webp`；
- `pngQuality`；
- `jpegQuality`；
- `audioBitrateKbps`，传 `null` 可关闭音频压缩；
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
- 取消操作不能中断正在同步解压的单个 ZIP 文件，只会在解压后停止或终止 Pipeline。

正式公网部署前，应将试玩产物放到独立域名，并增加容器资源限制、任务持久化、文件保留策略和身份认证。

## 测试

```powershell
npm run typecheck
npm run test:web-mvp
```

自测覆盖：

- 默认配置和配置校验；
- ZIP 生成、上传、解压；
- 一级 `web-mobile` 目录识别；
- 任务创建与轮询；
- 服务层调用；
- HTML、报告下载；
- 在线试玩路由；
- 路径穿越 ZIP 拒绝。
