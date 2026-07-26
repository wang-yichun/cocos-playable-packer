# Cocos Creator 插件开发与 game143 验证

## 当前范围

`extensions/cocos-playable-packer` 是 Creator 3.8.x 插件壳层。当前只验证插件识别、菜单、面板、消息通信、项目路径和运行环境，不执行真实 Playable 压缩。

`game143` 当前默认分支为 `develop`，项目配置使用 Cocos Creator 3.8.5。

## 首次准备

在 Packer 仓库执行：

```powershell
git switch agent/creator-extension-shell
npm run creator:build
npm run test:creator-extension
```

确认 `game143` 已克隆并位于 `develop`：

```powershell
Set-Location "D:\Projects\Cocos\game143"

git switch develop
git pull

Test-Path ".\assets"
Test-Path ".\package.json"
```

两项都应输出 `True`。

## 建立开发链接

```powershell
Set-Location "D:\Projects\Cocos\cocos-playable-packer"

npm run creator:link -- `
  "D:\Projects\Cocos\game143"
```

Windows 下会创建目录 Junction：

```text
D:\Projects\Cocos\game143\extensions\cocos-playable-packer
  -> D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer
```

脚本还会在 `game143/.git/info/exclude` 中加入本地排除：

```text
/extensions/cocos-playable-packer/
```

该文件不会提交到仓库。脚本不会修改 `game143/.gitignore`。

检查状态：

```powershell
npm run creator:link:status -- `
  "D:\Projects\Cocos\game143"

Set-Location "D:\Projects\Cocos\game143"
git status --short
```

链接状态应显示：

```text
状态：存在
本地 Git 排除：已启用
```

`git status --short` 不应因为插件 Junction 出现新的未跟踪文件。

## Creator 内验证

1. 使用 Cocos Creator 3.8.5 打开 `D:\Projects\Cocos\game143`。
2. 打开 **扩展 → 扩展管理器**。
3. 选择项目扩展，找到 **Cocos Playable Packer**。
4. 启用或重新加载插件。
5. 从 **开发者 → Cocos Playable Packer → 打开打包面板** 打开面板。
6. 检查面板中的项目名称、项目路径、Node.js、插件路径和 Packer 仓库路径。
7. 若 `game143/build/web-mobile` 已存在，应显示“已找到 Web Mobile 构建”；否则显示“尚未构建 Web Mobile”。

Creator 会从项目的 `extensions` 目录加载项目扩展；修改插件后需要在扩展管理器中重新载入。本项目统一使用可脚本化、可验证的 Junction 开发流程。

## 修改插件后的循环

```powershell
npm run creator:build
```

然后在 Creator 扩展管理器中点击重新加载。持续开发时可运行：

```powershell
npm run creator:watch
```

`creator:watch` 只负责重新编译，Creator 仍需手动重新加载扩展。

## 解除链接

关闭 Cocos Creator 后执行：

```powershell
Set-Location "D:\Projects\Cocos\cocos-playable-packer"

npm run creator:unlink -- `
  "D:\Projects\Cocos\game143"
```

该命令只删除 Junction，并清理由脚本添加的 `.git/info/exclude` 管理块。用户已有的本地排除规则会保留；若目标是普通目录，脚本会拒绝删除。

## 本阶段验收

- 插件出现在项目扩展列表；
- 插件可启用、重新加载和禁用；
- 开发者菜单可以打开面板；
- 面板显示 `game143` 的真实项目路径和 UUID；
- Node.js 信息能够显示；
- Junction 加载路径和真实源码路径都能显示；
- Packer 仓库与 `src/core/index.ts` 能被检测；
- `build/web-mobile` 存在与不存在两种状态都显示正确；
- `game143` 的 `git status` 不受插件 Junction 污染；
- Creator 控制台没有插件异常；
- 当前阶段没有启动压缩进程，也没有修改游戏项目资源。
