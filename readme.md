# Cocos Playable Packer

用于 Cocos Creator `web-mobile` 构建的单 HTML 打包，以及基于 TinyPNG 的源图片压缩、缓存、预览、应用和恢复。

当前示例项目配置：

```text
configs/game141-source-images.json
```

---

## 1. 环境准备

安装依赖：

```powershell
npm install
```

在项目根目录创建 `.env`：

```env
TINYPNG_API_KEY=你的TinyPNG_API_Key

# 直连失败时可启用代理
# TINYPNG_PROXY=http://127.0.0.1:7890
```

真实的 `.env` 不应提交到 Git。建议同时保留一个不含密钥的 `.env.example`。

---

## 2. npm 参数转发说明

在部分 Windows + npm 环境中，单独的脚本开关，例如 `--all`、`--confirm`，可能被 npm 吃掉。

本项目对带脚本开关的命令统一采用两个 `--`：

```text
npm run <script> -- -- <脚本参数>
```

例如：

```powershell
npm run tinypng:preview -- -- "./configs/game141-source-images.json" --all
```

正确时，npm 打印的实际执行命令末尾应保留：

```text
./configs/game141-source-images.json --all
```

---

## 3. 单 HTML 打包

压缩普通 `web-mobile` 构建：

```powershell
npm run pack:br -- "./web-mobile" "./dist/game-compressed.html"
```

A/B 测试：原图版本

```powershell
npm run pack:br -- `
  "./workspaces/game141/ab-build/original/web-mobile" `
  "./dist/game141_original_compressed.html"
```

A/B 测试：TinyPNG 版本

```powershell
npm run pack:br -- `
  "./workspaces/game141/ab-build/tinypng/web-mobile" `
  "./dist/game141_tinypng_compressed.html"
```

---

## 4. 分析源图片

```powershell
npm run analyze:source-images -- `
  "./configs/game141-source-images.json"
```

主要输出：

```text
workspaces/game141/reports/source-image-analysis.json
workspaces/game141/manifests/candidates.json
```

注意：

- `tinypng:preview` 只读取已经生成的 `candidates.json`。
- 修改 `manualReviewDirectories`、文件名规则、最小体积等配置后，必须重新运行 `analyze:source-images`。
- 修改配置后直接运行 `tinypng:preview`，不会重新扫描或重新分类工程资源。

---

## 5. TinyPNG 预览压缩

预览压缩只写入工作目录和缓存，不会修改 Cocos Creator 源资源。

输出目录：

```text
workspaces/game141/preview/
.tinypng-cache/
```

### 默认模式

未指定上限时，默认最多新增 5 次 API 请求：

```powershell
npm run tinypng:preview -- -- `
  "./configs/game141-source-images.json"
```

### 最多新增 5 次请求

```powershell
npm run tinypng:preview -- -- `
  "./configs/game141-source-images.json" `
  --limit=5
```

### 只使用缓存，不请求 TinyPNG

```powershell
npm run tinypng:preview -- -- `
  "./configs/game141-source-images.json" `
  --limit=0
```

该命令会：

- 复制已有缓存到 `preview`；
- 显示缓存命中和未命中数量；
- 不产生新的 TinyPNG API 请求。

### 压缩全部缓存未命中项

```powershell
npm run tinypng:preview -- -- `
  "./configs/game141-source-images.json" `
  --all
```

正确输出应显示：

```text
API 请求上限：不限
```

### 临时使用一个很大的上限

```powershell
npm run tinypng:preview -- -- `
  "./configs/game141-source-images.json" `
  --limit=9999
```

实际请求数量不会超过当前缓存未命中的候选数量。

---

## 6. 检查 TinyPNG 缓存

```powershell
npm run tinypng:cache-check -- `
  "./configs/game141-source-images.json"
```

重点确认：

```text
缓存记录：N
有效记录：N
无效记录：0
```

缓存以源文件 SHA-256 为键。内容未变化时，即使文件移动或重复执行，也不会再次请求 TinyPNG。

---

## 7. 生成应用计划

正式修改源图片前，先生成应用计划：

```powershell
npm run tinypng:apply-plan -- `
  "./configs/game141-source-images.json"
```

输出：

```text
workspaces/game141/manifests/apply-plan.json
```

应用计划会再次检查：

- 源文件哈希是否变化；
- TinyPNG 缓存是否存在且有效；
- 图片格式和尺寸是否保持；
- 压缩结果是否小于原图；
- 预计替换数量和节省体积。

`压缩无收益` 的文件不会被正式应用。

---

## 8. 应用压缩结果

建议先关闭 Cocos Creator，或者至少停止预览和构建，避免图片替换期间触发连续导入。

```powershell
npm run tinypng:apply -- -- `
  "./configs/game141-source-images.json" `
  --confirm
```

应用流程：

```text
最终预检
→ 备份原图
→ 写入恢复清单
→ 原子替换源图片
→ 校验替换结果
```

应用操作：

- 只替换图片文件；
- 不修改对应的 `.meta` 文件；
- 每张图片替换前都会备份；
- 发生错误时会尝试回滚本次修改；
- 可以通过 Git 状态查看被替换的源图片。

备份和应用记录位于：

```text
workspaces/game141/backups/<计划编号>/
workspaces/game141/manifests/applications/
workspaces/game141/manifests/latest-application.json
```

应用后重新打开 Cocos Creator，等待资源导入完成，再运行和构建游戏。

---

## 9. 恢复原始图片

```powershell
npm run tinypng:restore -- -- `
  "./configs/game141-source-images.json" `
  --confirm
```

恢复操作会：

- 从最近一次应用备份中恢复原始图片；
- 校验当前图片和备份图片的 SHA-256；
- 不修改 `.meta` 文件；
- 当前图片被人工修改过时拒绝覆盖；
- 生成恢复记录。

恢复记录位于：

```text
workspaces/game141/manifests/restores/
workspaces/game141/manifests/latest-restore.json
```

---

## 10. 推荐完整流程

### 第一次处理一个项目

```text
1. 配置 configs/<project>.json
2. analyze:source-images
3. tinypng:preview --limit=5
4. 游戏内检查预览资源
5. tinypng:preview --all
6. tinypng:cache-check
7. tinypng:apply-plan
8. tinypng:apply --confirm
9. 等待 Cocos Creator 重新导入
10. 运行和构建游戏
11. pack:br
12. 出现问题时 tinypng:restore --confirm
```

### 修改图片分类配置后

```text
修改配置
→ 重新运行 analyze:source-images
→ 检查新的 candidates.json
→ 再运行 tinypng:preview
```

### A/B 构建验证

```text
恢复原图
→ 构建 original/web-mobile
→ 应用 TinyPNG
→ 构建 tinypng/web-mobile
→ 分别 pack:br
→ 比较两个最终 HTML
```

当前 `game141_TriChoiceShooter` 的一次实测结果：

```text
原始单 HTML：7435 KB
TinyPNG 单 HTML：6742 KB
减少约：693 KB
降幅约：9.32%
```

两个版本均可正常运行。

---

## 11. 生成目录建议

以下内容通常不提交到 Git：

```gitignore
.env
.env.*
!.env.example

.tinypng-cache/
workspaces/*/preview/
workspaces/*/backups/
workspaces/*/manifests/applications/
workspaces/*/manifests/restores/
workspaces/*/manifests/latest-application.json
workspaces/*/manifests/latest-restore.json
```

分析报告、候选清单和应用计划是否提交，可以根据项目协作方式决定。
