# Cocos Creator 扩展开发与 game143 验证

扩展源码位于 `extensions/cocos-playable-packer`。开发期不使用 Junction，也不修改 `game143/.git/info/exclude`。

## 编译与同步

```powershell
Set-Location "D:\Projects\Cocos\cocos-playable-packer"
npm run creator:build
robocopy "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer" "D:\Projects\Cocos\game143\extensions\cocos-playable-packer" /E /XD "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\node_modules" "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\.squoosh-cache" "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\workspaces"
```

首次测试时安装 Runtime 依赖：

```powershell
Set-Location "D:\Projects\Cocos\game143\extensions\cocos-playable-packer\runtime"
npm ci
```

之后每次源码修改只需重新编译、执行上述 `robocopy` 命令，并在 Creator 中重新加载扩展。

## Creator 验证

1. 使用 Cocos Creator 3.8.5 打开 `D:\Projects\Cocos\game143`。
2. 在扩展管理器中重新加载 **Cocos Playable Packer**。
3. 打开打包面板，确认 Packer Core 和 Web Mobile 构建状态。
4. 完成构建后，验证“浏览器预览”和“打开资源目录”按钮。

目标项目可以提交整个 `extensions/cocos-playable-packer`，也可以由用户自行决定是否忽略。扩展目录中的 `.gitignore` 只忽略 Runtime 依赖、缓存和生成文件。
