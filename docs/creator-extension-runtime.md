# Creator 插件独立 Runtime

Creator 插件加载后只会使用插件目录中的 `runtime/`，不再向上查找与 Cocos 项目并列的
Packer 仓库，也不使用 `PLAYABLE_PACKER_ROOT`。

开发仓库中执行以下命令会编译插件，并把 Core Worker 与 Pipeline 文件写进扩展目录：

```powershell
npm run creator:build
```

将完整的 `extensions/cocos-playable-packer` 目录复制到目标 Cocos 项目的
`extensions/cocos-playable-packer` 后，在 Runtime 目录安装一次依赖：

```powershell
Set-Location "<Cocos 项目>\\extensions\\cocos-playable-packer\\runtime"
npm install --omit=dev
```

然后在 Creator 扩展管理器中重新加载插件。Junction 仍可用于开发期快速映射目录，但不再是
运行时依赖，也不会参与 Core 的查找。
