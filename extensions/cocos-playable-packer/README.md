# Cocos Playable Packer Creator Extension

这是面向 Cocos Creator 3.8.x 的项目级扩展壳层。

当前阶段提供：

- Creator 菜单和可停靠面板；
- 当前项目路径、UUID 和临时目录识别；
- `build/web-mobile` 构建目录检测；
- Node.js 运行环境检测；
- Packer 仓库和 Core 源码连接检测；
- 开发日志显示。

当前阶段不会执行图片、音频、Brotli、Payload 或渠道打包，也不会修改 Cocos 游戏工程资源。

插件源码由仓库根目录的 TypeScript 依赖编译：

```powershell
npm run creator:build
```

开发时通过仓库根目录命令链接到 Cocos 项目：

```powershell
npm run creator:link -- `
  "D:\Projects\Cocos\game143"
```

Windows 下会创建目录 Junction，并在游戏仓库本地 `.git/info/exclude` 中加入：

```text
/extensions/cocos-playable-packer/
```

该排除项不会提交到游戏仓库，避免插件链接污染 `git status`。

检查链接：

```powershell
npm run creator:link:status -- `
  "D:\Projects\Cocos\game143"
```

取消链接：

```powershell
npm run creator:unlink -- `
  "D:\Projects\Cocos\game143"
```

取消链接时只删除 Junction，并清理脚本自己添加的本地 Git 排除块；已有的用户排除规则会保留。
