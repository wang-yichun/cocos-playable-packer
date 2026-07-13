# 生成文件清理

项目提供安全的生成文件清理命令，用于删除本地测试产物、缓存、报告和 Web MVP 数据，同时保留源码、配置、依赖和本地密钥。

## 预览清理范围

```powershell
npm run clean:generated
```

该命令只列出将要删除的路径和预计体积，不会实际删除文件。

## 执行清理

```powershell
npm run clean:generated:apply
```

也可以直接双击项目根目录中的：

```text
clean-generated.cmd
```

双击入口会先显示预览，然后要求确认。

## 删除内容

根目录生成目录：

```text
.packer-web/
.tinypng-cache/
.squoosh-cache/
dist/
web-mobile/
```

根目录已知分析报告：

```text
scan-report.json
compression-report.json
entry-report.json
module-report.json
resource-optimization-report.json
solid-compression-report.json
encoding-report.json
webp-benchmark-report.json
audio-analysis-report.json
audio-benchmark-report.json
```

根目录下的 `*.log` 文件也会删除。

每个 workspace 中删除：

```text
workspaces/*/runs/
workspaces/*/reports/
workspaces/*/preview/
workspaces/*/backups/
workspaces/*/manifests/applications/
workspaces/*/manifests/restores/
workspaces/*/manifests/latest-application.json
workspaces/*/manifests/latest-restore.json
```

## 明确保留

清理器不会删除：

```text
.env
.env.example
node_modules/
package.json
package-lock.json
src/
scripts/
docs/
configs/
工作区配置文件
```

`.env` 中可能保存 TinyPNG API Key，因此清理器不会调用 `git clean -fdX`，也不会使用通配规则删除所有 ignored 文件。

## Web MVP

正式清理前，命令会调用现有的一键启动器停止由启动器管理的 Web MVP 进程，然后再删除 `.packer-web/`。

如果 Web MVP 是在终端中通过 `npm run web:mvp` 手动启动的，请先在该终端按 `Ctrl+C`，然后执行清理。

## 自动测试

```powershell
npm run test:clean-generated
```

测试会在系统临时目录创建模拟项目，验证：

- 生成目录和报告会被删除；
- `.env`、`.env.example`、`node_modules`、配置和 workspace 配置会被保留；
- 清理器拒绝删除项目根目录或项目外路径。
