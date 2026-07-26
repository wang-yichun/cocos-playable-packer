# Cocos Playable Packer Creator Extension

这是面向 Cocos Creator 3.8.x 的项目级扩展。

## 开发测试

```powershell
Set-Location "D:\Projects\Cocos\cocos-playable-packer"
npm run creator:build
robocopy "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer" "D:\Projects\Cocos\game143\extensions\cocos-playable-packer" /E /XD "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\node_modules" "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\.squoosh-cache" "D:\Projects\Cocos\cocos-playable-packer\extensions\cocos-playable-packer\runtime\workspaces"
```

首次测试时，在目标项目的 Runtime 目录安装一次依赖：

```powershell
Set-Location "D:\Projects\Cocos\game143\extensions\cocos-playable-packer\runtime"
npm ci
```

复制命令会保留测试项目中的 `runtime/node_modules` 和生成缓存。复制完成后，在 Creator 扩展管理器中重新加载插件。
