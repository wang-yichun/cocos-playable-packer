# FFmpeg 安装与排查（Windows）

FFmpeg 是本项目的外部音频转码工具，不属于 npm 依赖。执行 `npm ci` 或 `npm install` 不会安装 FFmpeg。

FFmpeg 官方只发布源代码，并在下载页面列出可直接使用的 Windows 编译版本：

https://ffmpeg.org/download.html

## 1. 什么时候必须安装

以下功能会实际启动 FFmpeg，因此必须保证系统能够执行 `ffmpeg`：

- `npm run audio:benchmark`；
- `npm run audio:optimize` 的实际转码流程；
- `npm run playable:build` 并传入 `--audio-bitrate=N`；
- Web MVP 创建任务时将 `audioBitrateKbps` 设置为 `8-320`。

以下场景不需要 FFmpeg：

- `npm run audio:analyze`；
- 不传 `--audio-bitrate` 的 Playable 构建；
- Web MVP 保持音频压缩关闭；
- 只执行图片压缩、Brotli 打包或 Payload 编码。

## 2. 推荐：使用 Winget 自动安装

Windows 11 或已安装 Windows Package Manager 的系统，推荐直接在 PowerShell 中执行：

```powershell
winget install --id Gyan.FFmpeg -e --source winget
```

参数含义：

- `--id Gyan.FFmpeg`：指定 FFmpeg 软件包 ID；
- `-e`：要求软件包 ID 精确匹配；
- `--source winget`：明确使用 Winget 公共软件源。

安装完成后，关闭并重新打开 PowerShell、VS Code 终端以及已经启动的 Web MVP 服务，然后执行后文的验证命令。

已经安装过 FFmpeg 时，可以通过以下命令检查并升级：

```powershell
winget upgrade --id Gyan.FFmpeg -e --source winget
```

如果系统无法识别 `winget`，先确认 Windows Package Manager 是否可用：

```powershell
winget --version
```

如果软件源异常，可尝试：

```powershell
winget source update
winget search --id Gyan.FFmpeg -e --source winget
```

## 3. 备用：Windows 手动安装

1. 打开 FFmpeg 官方下载页面：

   https://ffmpeg.org/download.html

2. 在 `Windows EXE Files` 下选择页面列出的 Windows 构建提供方，例如 gyan.dev 或 BtbN。

3. 下载包含 `ffmpeg.exe` 的 64 位构建。该构建还必须包含 MP3 编码器 `libmp3lame`。

4. 解压到固定目录，例如：

   ```text
   D:\Tools\ffmpeg
   ```

5. 确认以下文件存在：

   ```text
   D:\Tools\ffmpeg\bin\ffmpeg.exe
   ```

6. 将下面的 `bin` 目录加入当前用户或系统的 `Path` 环境变量：

   ```text
   D:\Tools\ffmpeg\bin
   ```

7. 关闭并重新打开 PowerShell、VS Code 终端以及正在运行的 Web MVP 服务。

Windows 图形界面中的常见入口：

```text
设置
→ 系统
→ 系统信息 / 关于
→ 高级系统设置
→ 环境变量
→ 用户变量或系统变量中的 Path
→ 新建
```

## 4. 安装验证

在新的 PowerShell 窗口中执行：

```powershell
where.exe ffmpeg
Get-Command ffmpeg -ErrorAction SilentlyContinue
ffmpeg -version
ffmpeg -encoders | Select-String libmp3lame
```

预期结果：

- `where.exe ffmpeg` 能输出 `ffmpeg.exe` 的完整路径；
- `ffmpeg -version` 能输出版本信息；
- 编码器列表中能找到 `libmp3lame`。

只要 `ffmpeg -version` 失败，项目中的音频转码也会失败。

## 5. CLI 使用完整路径

不想修改系统 `Path` 时，可以在支持 `--ffmpeg` 的 CLI 命令中直接指定可执行文件：

```powershell
npm run playable:build -- `
  "<web-mobile目录>" `
  "./dist/game.html" `
  --image-mode=webp `
  --audio-bitrate=48 `
  --ffmpeg="D:\Tools\ffmpeg\bin\ffmpeg.exe"
```

音频独立命令也支持同样的参数形式：

```powershell
npm run audio:optimize -- `
  "./web-mobile" `
  --bitrate=48 `
  --ffmpeg="D:\Tools\ffmpeg\bin\ffmpeg.exe" `
  --confirm
```

当前 Web MVP 页面尚未提供 FFmpeg 路径输入框。Web MVP 启用音频压缩时，启动服务的进程必须能通过 `Path` 找到 `ffmpeg`。

## 6. `spawn ffmpeg ENOENT`

典型错误：

```text
无法启动 FFmpeg（ffmpeg）：spawn ffmpeg ENOENT
```

`ENOENT` 表示 Node.js 找不到 `ffmpeg` 可执行文件，通常不是 npm 包缺失。

依次检查：

```powershell
where.exe ffmpeg
ffmpeg -version
```

如果刚刚通过 Winget 安装 FFmpeg，或刚刚修改过 `Path`：

1. 停止当前服务；
2. 关闭当前 PowerShell 或 VS Code 终端；
3. 重新打开终端；
4. 再次验证 `ffmpeg -version`；
5. 重新执行 `npm run web:mvp` 或相关构建命令。

## 7. 找不到 `libmp3lame`

如果 `ffmpeg` 可以启动，但日志提示 MP3 编码器不存在，请执行：

```powershell
ffmpeg -encoders | Select-String libmp3lame
```

没有结果时，应更换为包含 `libmp3lame` 的 Windows 构建。仅有 `ffmpeg.exe` 并不一定代表该构建包含项目需要的全部编码器。

## 8. 新电脑检查清单

```powershell
node --version
npm --version
npm ci
npm run typecheck
winget install --id Gyan.FFmpeg -e --source winget
where.exe ffmpeg
ffmpeg -version
ffmpeg -encoders | Select-String libmp3lame
```

不使用音频压缩时，FFmpeg 安装和最后三项检查可以跳过。
