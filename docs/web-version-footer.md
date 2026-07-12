# Web 版本与版权页脚

Web MVP 页面底部显示简洁版本信息，并提供可展开的“版本与许可”面板。

## 常驻页脚

页面默认显示：

```text
Cocos Playable Packer v0.1.0 · Build <短 SHA> · Node.js <实际版本>
© 2026 wang-yichun. All rights reserved.
```

页脚使用普通文档流布局，不固定悬浮，因此不会遮挡构建日志、下载按钮或在线试玩入口。

## 版本与许可面板

展开后显示：

- 应用版本；
- 完整 Git Commit SHA；
- Git 提交时间；
- 页面信息生成时间；
- Node.js 实际运行版本；
- FFmpeg 检测结果；
- TypeScript、Sharp、JSquash WebP/JPEG/OxiPNG、Brotli 解码组件版本；
- 版权、第三方许可证和非官方项目声明。

## 信息来源

版本信息在 Web 服务启动时自动收集：

```text
package.json / node_modules package.json
    → 应用和核心 npm 组件版本

git rev-parse HEAD
    → 完整及短 Git SHA

git show -s --format=%cI HEAD
    → Git 提交时间

process.version
    → Node.js 实际版本

ffmpeg -version
    → FFmpeg 实际版本
```

缺少 Git 仓库、依赖目录或 FFmpeg 时，页面会显示 `unknown`、声明版本或“未检测到”，不会阻止 Web 服务启动。

## 版权文字

当前署名固定为：

```text
© 2026 wang-yichun. All rights reserved.
```

年份按 Web 服务启动时的 UTC 年份生成。第三方组件继续遵循各自许可证。

详细面板还包含：

```text
本工具为独立开发项目，与 Cocos 官方无隶属或授权关系。
Cocos Creator 及相关名称归其各自权利人所有。
```

## 验证

```powershell
npm run typecheck
npm run test:web-mvp
npm run web:mvp
```

打开：

```text
http://127.0.0.1:4173
```

检查页面底部版本号、短 SHA、Node.js 版本和版权信息，并展开“版本与许可”确认详细版本。FFmpeg 未安装时应显示“未检测到”，而不是导致服务启动失败。
