# Creator 插件独立 Runtime

Creator 插件只使用自身目录中的 `runtime/`，不依赖与项目并列的 Packer 仓库，也不使用 Junction。

在源码仓库编译后，将完整插件目录复制到目标项目：

```powershell
Set-Location "D:\Projects\Cocos\cocos-playable-packer"
npm run creator:build
robocopy "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer" "D:\Projects\Cocos\game143\extensions\cocos-playable-packer" /E /XD "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\node_modules" "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\.squoosh-cache" "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\workspaces"
```

首次复制后，在目标项目的 Runtime 目录安装一次依赖：

```powershell
Set-Location "D:\Projects\Cocos\game143\extensions\cocos-playable-packer\runtime"
npm ci
```

后续每次源码变更重新编译并复制，然后在 Creator 扩展管理器中重新加载插件即可。
