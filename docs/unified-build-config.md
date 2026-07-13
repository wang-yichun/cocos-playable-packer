# 统一构建配置

`playable:build` 支持通过 `playable.config.json` 保存常用构建参数，同时继续兼容原有命令行用法。

## 基本用法

复制示例文件：

```powershell
Copy-Item ".\playable.config.example.json" ".\playable.config.json"
```

按项目修改路径和参数后执行：

```powershell
npm run playable:build -- `
  --config=".\playable.config.json"
```

也支持空格形式：

```powershell
npm run playable:build -- `
  --config ".\playable.config.json"
```

配置文件中的相对路径以配置文件所在目录为基准，而不是以当前 PowerShell 目录为基准。

## 命令行覆盖

命令行参数优先于配置文件。例如临时降低 PNG 质量并改用 Base64：

```powershell
npm run playable:build -- `
  --config=".\playable.config.json" `
  --png-quality=70 `
  --payload-encoding=base64
```

也可以同时覆盖输入目录和输出文件：

```powershell
npm run playable:build -- `
  --config=".\playable.config.json" `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  ".\dist\game-test.html"
```

未指定 `--config` 时，原有命令保持不变。

## 配置结构

```json
{
  "schemaVersion": 1,
  "input": "./web-mobile",
  "output": "./dist/game.html",
  "image": {
    "mode": "webp",
    "pngWebpQuality": 80,
    "jpegWebpQuality": 80
  },
  "audio": {
    "bitrate": 48,
    "ffmpeg": "ffmpeg"
  },
  "compression": {
    "payloadEncoding": "html7",
    "brotliFallback": "raw-js"
  },
  "workspace": {
    "keep": false
  }
}
```

## 字段说明

### 根字段

- `schemaVersion`：当前只支持 `1`；
- `input`：Cocos Creator `web-mobile` 构建目录；
- `output`：输出 HTML 文件；
- `image`：图片处理设置；
- `audio`：音频处理设置；
- `compression`：Payload 和 Brotli 回退设置；
- `workspace.keep`：是否保留构建工作区；
- `extraArgs`：尚未进入正式配置模型的兼容参数。

### 图片

`image.mode` 支持：

```text
none
tinypng
squoosh
webp
```

Squoosh 模式可使用：

```json
{
  "image": {
    "mode": "squoosh",
    "pngQuality": 80,
    "jpegQuality": 80
  }
}
```

WebP 模式可使用：

```json
{
  "image": {
    "mode": "webp",
    "pngWebpQuality": 80,
    "jpegWebpQuality": 80
  }
}
```

配置校验会拒绝模式与质量字段不匹配的组合。

### 音频

不填写 `audio.bitrate` 时，不启用音频压缩。

```json
{
  "audio": {
    "bitrate": 48,
    "ffmpeg": "ffmpeg"
  }
}
```

公司电脑推荐通过 Chocolatey 安装 FFmpeg：

```powershell
choco install ffmpeg
```

### 压缩与编码

`compression.payloadEncoding` 支持：

```text
base64
base91
html7
```

`compression.brotliFallback` 支持：

```text
raw-js
gzip-packed-js
```

### 兼容参数

尚未纳入结构化字段的既有参数可以暂时放入 `extraArgs`：

```json
{
  "extraArgs": [
    "--project=game141",
    "--colours=256",
    "--effort=10"
  ]
}
```

`extraArgs` 中的每一项必须以 `--` 开头，且不能再次包含 `--config`。建议优先使用正式结构化字段，避免在 `extraArgs` 中重复设置相同参数。

## 配置帮助

```powershell
npm run playable:build -- --config-help
```

## 自测试

```powershell
npm run typecheck
npm run test:build-config
npm run test:image-quality-pipeline
```
