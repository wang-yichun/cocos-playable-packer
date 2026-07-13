# Web MVP 一键启动器（Windows）

Web MVP 一键启动器用于减少每次手动打开 PowerShell、切换目录、执行 npm 命令和复制访问地址的操作。

启动器不会把 Web MVP 注册为 Windows 服务，也不会设置开机自启。它只在需要时启动一个后台 Node.js 进程，并通过本地状态文件管理该进程。

## 1. 提供的入口

项目根目录包含：

```text
start-web-mvp.cmd
stop-web-mvp.cmd
install-web-mvp-shortcuts.cmd
```

实现文件位于：

```text
scripts/web-mvp-launcher.mjs
scripts/web-mvp-launcher-lib.mjs
scripts/install-web-mvp-shortcuts.ps1
```

运行状态和日志写入：

```text
.packer-web/launcher/service.json
.packer-web/launcher/web-mvp.log
```

`.packer-web/` 已被 Git 忽略，不会提交到仓库。

## 2. 一键启动

在 Windows 资源管理器中双击：

```text
start-web-mvp.cmd
```

启动器会依次完成：

1. 检查 Node.js 和 npm；
2. 检查项目本地 `tsx`；
3. 如果 `node_modules` 不完整，自动执行 `npm ci`；
4. 检查目标端口是否已被占用；
5. 在后台执行 `npm run web:mvp`；
6. 记录后台进程 PID；
7. 轮询 `/api/health`，确认服务真正可用；
8. 输出本机地址和局域网地址；
9. 自动打开默认浏览器。

默认地址：

```text
http://127.0.0.1:4173
```

默认监听所有 IPv4 网卡，因此同一可信局域网中的设备还可以使用启动器输出的局域网地址。

启动器窗口关闭后，Web MVP 仍会在后台运行。

## 3. 重复启动

重复双击 `start-web-mvp.cmd` 不会创建第二个服务进程。

启动器会检查：

- `/api/health` 是否已经正常；
- 已记录的 PID 是否仍存活；
- 服务是否还处于启动过程。

已经运行时，启动器只会重新显示访问地址并打开浏览器。

如果端口已被其他程序占用，但该程序不是 Web MVP，启动器会停止并报告端口冲突，不会覆盖或终止其他程序。

## 4. 一键停止

双击：

```text
stop-web-mvp.cmd
```

Windows 下会使用保存的 PID 配合 `taskkill /T` 停止启动器创建的整个进程树，包括：

- 后台 `cmd.exe`；
- npm；
- Node.js Web MVP 服务。

停止完成后会删除：

```text
.packer-web/launcher/service.json
```

日志文件会保留，方便排查。

如果 Web MVP 是在终端中手动执行 `npm run web:mvp` 启动的，没有启动器状态文件，一键停止器不会猜测或强制终止该进程。此时应回到原终端按 `Ctrl+C`。

## 5. 安装桌面快捷方式

双击：

```text
install-web-mvp-shortcuts.cmd
```

会在当前用户桌面创建：

```text
Cocos Playable Packer - Start.lnk
Cocos Playable Packer - Stop.lnk
```

快捷方式始终指向当前仓库目录中的启动和停止脚本。移动或删除仓库目录后，需要重新运行快捷方式安装器。

## 6. npm 与命令行入口

除了双击 `.cmd`，也可以在 PowerShell 中执行：

```powershell
npm run web:mvp:start
npm run web:mvp:status
npm run web:mvp:stop
```

不希望自动打开浏览器时：

```powershell
node ./scripts/web-mvp-launcher.mjs start --no-open
```

也可以临时设置：

```powershell
$env:PLAYABLE_WEB_NO_OPEN = "1"
npm run web:mvp:start
```

## 7. 主机、端口和数据目录

启动器沿用 Web MVP 的环境变量：

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PLAYABLE_WEB_HOST` | `0.0.0.0` | 监听地址 |
| `PLAYABLE_WEB_PORT` | `4173` | HTTP 端口 |
| `PLAYABLE_WEB_ROOT` | `.packer-web` | Web MVP 数据目录 |
| `PLAYABLE_WEB_NO_OPEN` | 未设置 | 设置为 `1` 时不自动打开浏览器 |

PowerShell 示例：

```powershell
$env:PLAYABLE_WEB_PORT = "5173"
npm run web:mvp:start
```

从资源管理器双击 `.cmd` 时，不会继承某个已经打开的 PowerShell 窗口中的临时环境变量。需要自定义双击启动参数时，应设置 Windows 用户环境变量，或使用 PowerShell 命令行入口。

## 8. FFmpeg

FFmpeg 不是启动 Web MVP 的必要条件。

未找到 FFmpeg 时，启动器会显示警告，但仍会启动服务。此时网页中的音频压缩功能不可用，其他图片压缩、Brotli、Payload 和渠道输出功能不受影响。

公司电脑已验证安装命令：

```powershell
choco install ffmpeg
```

安装后应重新启动 Web MVP，让后台 Node.js 进程读取新的 `Path`。

## 9. 日志和故障处理

日志文件：

```text
.packer-web/launcher/web-mvp.log
```

服务在 30 秒内未通过健康检查时，启动器会：

1. 停止刚刚创建的后台进程树；
2. 删除无效 PID 状态；
3. 在启动器窗口显示最近的日志内容；
4. 保留完整日志文件。

常见问题：

### Node.js 不存在

安装 Node.js 22，并关闭后重新打开启动器。

### `npm ci` 失败

在项目根目录手动执行：

```powershell
npm ci
npm run typecheck
```

### 端口 4173 被占用

先确认是否已有 Web MVP：

```powershell
npm run web:mvp:status
```

再检查端口：

```powershell
Get-NetTCPConnection -LocalPort 4173 -State Listen
```

不要让启动器自动终止来源不明的占用进程。

### 服务已运行但停止器提示不是启动器管理

说明服务可能是通过以下命令手动启动的：

```powershell
npm run web:mvp
```

返回原终端按 `Ctrl+C`，然后再使用一键启动器启动。

## 10. 安全说明

Web MVP 目前没有登录和访问令牌。默认监听 `0.0.0.0` 时，只应在可信局域网中运行。

建议：

- 不使用时执行 `stop-web-mvp.cmd`；
- 不要进行公网端口转发；
- 不要在公共 Wi-Fi 上开放；
- 仅本机使用时设置 `PLAYABLE_WEB_HOST=127.0.0.1`。

## 11. 测试

纯逻辑自测：

```powershell
npm run test:web-mvp-launcher
```

完整检查：

```powershell
npm run typecheck
npm run test:web-mvp-launcher
npm run test:web-mvp
```

Windows 实机还应验证：

1. 双击启动；
2. 浏览器自动打开；
3. 局域网设备能够访问；
4. 重复双击不会创建第二个服务；
5. 关闭启动器窗口后服务继续运行；
6. 双击停止后端口释放；
7. 桌面快捷方式可用。
