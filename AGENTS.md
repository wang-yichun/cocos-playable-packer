# Creator 插件交付约定

当改动 `extensions/cocos-playable-packer`、`src/creator-worker` 或其发布运行时依赖后：

1. 运行相关 TypeScript 和 Creator 插件自测。
2. 使用 `package-creator-extension.cmd` 对应的发布脚本打包最新扩展：
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-creator-extension.ps1`
3. 不要直接从工作目录复制扩展；必须将生成的 `release/cocos-playable-packer-v<version>.zip` 解压安装到 `CocosDemo/extensions/cocos-playable-packer`。
4. 安装后核对 Demo 目录中的 `dist/main.js`、`dist/panels/default/index.js` 和 `runtime/dist/creator-worker/playable-build-worker.js`；随后通知用户可在 Cocos Creator 中重新加载扩展测试。

发布脚本已自动执行第 3 步；保留该约定是为了确保 CocosDemo 测试的是与用户收到的发布 ZIP 完全相同的文件。
