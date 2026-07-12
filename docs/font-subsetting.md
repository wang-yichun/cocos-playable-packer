# 构建字体字符子集化

## 目标

对 Cocos Creator Web Mobile 构建目录中的 `.ttf` 字体进行字符子集化，只保留游戏实际需要的字形，同时保持：

- 原 `.ttf` 路径和扩展名不变；
- Cocos UUID、Bundle 映射和加载逻辑不变；
- 输入构建目录默认不修改；
- 应用前备份；
- 防止对已经子集化的字体再次处理。

底层使用 `subset-font` 2.5.0。该库通过 HarfBuzz WASM 的 `hb-subset` 生成 SFNT 字体，许可证为 BSD-3-Clause。

## 字符源

默认读取仓库根目录：

```text
characters/
```

支持：

```text
.ts
.tsx
.js
.jsx
.json
.txt
```

TypeScript/JavaScript 文件不会简单扫描全部引号内容。工具只提取赋给以下对象的值字符串：

```text
languages
locales
translations
i18n
```

因此以下内容会保留：

```ts
win.languages = {
  en: {
    common: {
      playnow: "Play Now",
    },
  },
};
```

提取：

```text
Play Now
```

不会提取：

```text
en
common
playnow
win
languages
```

此外会自动加入数字、英文字母、常用半角标点和常用全角标点，覆盖分数、倒计时、百分比等运行时动态文本。

## 安装依赖

本功能新增 `subset-font`。首次拉取功能分支时执行：

```powershell
npm install
```

待 `package-lock.json` 更新并提交后，后续恢复使用：

```powershell
npm ci
```

## 自动检查

```powershell
npm run typecheck
npm run test:font-subset
```

测试覆盖：

- TypeScript 多语言对象值提取；
- 不提取语言代码、字段名和无关字符串；
- 参数解析和冲突检查；
- SFNT 基础结构校验；
- Unicode `cmap` format 12 字符覆盖检查。

## 预览

必须从干净的 Cocos Creator `web-mobile` 构建开始：

```powershell
npm run fonts:subset -- `
  "D:\Projects\Cocos\game141\build\web-mobile"
```

等价于：

```powershell
npm run fonts:subset -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --characters="./characters" `
  --preview
```

预览阶段：

1. 读取多语言内容；
2. 扫描全部 `.ttf`；
3. 检查每个字体实际支持的目标字符；
4. 生成字体子集；
5. 校验子集没有丢失原字体支持的目标字符；
6. 写入本地缓存和报告；
7. 不修改构建目录。

默认最低收益门槛：

```text
至少减少 128 B
并且至少减少 1%
```

## 报告

缓存目录：

```text
.font-cache/build-fonts/chars-<字符SHA前16位>/
```

最新报告：

```text
.font-cache/build-fonts/chars-<字符SHA前16位>/reports/latest.json
```

字符集合：

```text
.font-cache/build-fonts/chars-<字符SHA前16位>/characters.txt
```

报告重点字段：

```text
characters.totalCharacters
characters.extractedCharacters
characters.sourceFiles
summary.scannedFontFiles
summary.currentBytesBefore
summary.finalBytesAfter
summary.savedBytes
summary.savedPercent
files[].supportedCharacters
files[].unsupportedCharacters
```

`unsupportedCharacters` 表示目标字符集中原字体本来就不支持的字符。例如某个拉丁字体不支持中文、日文或泰文，这不属于子集化错误。

## 应用

确认报告合理后：

```powershell
npm run fonts:subset -- `
  "D:\Projects\Cocos\game141\build\web-mobile" `
  --confirm
```

应用阶段使用预览缓存，不重复执行 HarfBuzz 子集化。

备份目录：

```text
.font-cache/build-fonts/chars-<字符SHA前16位>/backups/<时间戳>/
```

发生写入错误时，会尝试恢复已经替换的字体。

## 防止二次子集化

工具记录子集字体 SHA：

- 当前构建中已经是同一字符配置的输出时，标记为 `already-applied`；
- 检测到另一套字符配置的历史输出时，拒绝继续处理，并要求重新生成干净构建。

更改 `characters` 内容后，应重新生成干净的 `web-mobile`，不要在旧子集字体上继续生成新子集。

## 真实游戏验收

应用后重点检查：

- 所有语言逐一切换；
- 中文简体和繁体；
- 日文假名与汉字；
- 韩文；
- 泰文组合字符和上下标记；
- 西欧重音字符；
- 土耳其语 `Ş/ş/ı/İ`；
- 波兰语字符；
- 俄文；
- 越南语组合后的预组字符；
- 数字、百分比、倒计时和动态分数；
- 是否出现方框、空白或字体回退变化；
- 浏览器控制台是否有字体解析错误。

独立工具通过真实游戏验证后，再接入 `playable:build` Pipeline。
