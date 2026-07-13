function json(value: string): string {
  return JSON.stringify(value);
}

export function createAssetsManifestUploaderModule(
  manifestUploadUrl: string,
  startUrl: string,
  uploadToken: string,
): string {
  return `import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const manifestUploadUrl = ${json(manifestUploadUrl)};
const startUrl = ${json(startUrl)};
const uploadToken = ${json(uploadToken)};

function normalizePath(value) {
  return value.replace(/\\\\/g, "/");
}

function stringField(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function userDataRecord(value) {
  const userData = value.userData;
  return typeof userData === "object" && userData !== null && !Array.isArray(userData)
    ? userData
    : null;
}

async function readMetaRecord(metaPath) {
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

async function readDirectoryBundleName(directoryPath) {
  const record = await readMetaRecord(directoryPath + ".meta");
  if (record === null) return null;
  const userData = userDataRecord(record);
  if (userData === null) return null;
  const configured = stringField(userData.bundleName) ?? stringField(userData.bundle);
  if (configured !== null) return configured;
  return userData.isBundle === true ? path.basename(directoryPath) : null;
}

async function walk(root, current, inheritedBundleName, output) {
  const relativeDirectory = normalizePath(path.relative(root, current));
  let currentBundleName = inheritedBundleName;
  if (relativeDirectory.length > 0) {
    currentBundleName = await readDirectoryBundleName(current)
      ?? (relativeDirectory === "resources" ? "resources" : inheritedBundleName);
  }
  for (const item of await readdir(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, item.name);
    if (item.isDirectory()) {
      await walk(root, absolutePath, currentBundleName, output);
    } else if (item.isFile() && !item.name.endsWith(".meta")) {
      output.push({ relativePath: normalizePath(path.relative(root, absolutePath)), bundleName: currentBundleName });
    }
  }
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function createManifest(projectRoot) {
  const assetsRoot = path.join(projectRoot, "assets");
  const assetsInfo = await stat(assetsRoot).catch(() => null);
  if (!assetsInfo?.isDirectory()) {
    throw new Error("未找到 assets 目录。请把 CMD 放到 Cocos Creator 项目根目录后重新运行。");
  }
  const discovered = [];
  await walk(assetsRoot, assetsRoot, null, discovered);
  discovered.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const entries = [];
  let totalBytes = 0;
  let metaCount = 0;
  for (let index = 0; index < discovered.length; index += 1) {
    const item = discovered[index];
    const absolutePath = path.join(assetsRoot, item.relativePath);
    const info = await stat(absolutePath);
    const metaPath = absolutePath + ".meta";
    const meta = await readMetaRecord(metaPath);
    if (meta !== null) metaCount += 1;
    const userData = meta === null ? null : userDataRecord(meta);
    totalBytes += info.size;
    entries.push({
      path: normalizePath(path.posix.join("assets", item.relativePath)),
      extension: path.extname(item.relativePath).toLowerCase() || "[none]",
      bytes: info.size,
      sha256: await sha256File(absolutePath),
      modifiedAt: info.mtime.toISOString(),
      metaPath: meta === null ? null : normalizePath(path.posix.join("assets", item.relativePath + ".meta")),
      uuid: meta === null ? null : stringField(meta.uuid),
      importer: meta === null ? null : stringField(meta.importer),
      bundleName: meta === null
        ? item.bundleName
        : (userData === null ? null : stringField(userData.bundleName) ?? stringField(userData.bundle)) ?? item.bundleName,
    });
    if ((index + 1) % 100 === 0 || index + 1 === discovered.length) {
      console.log("已扫描 " + (index + 1) + " / " + discovered.length);
    }
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectName: path.basename(projectRoot),
    assetsRoot: "assets",
    resourceCount: entries.length,
    totalBytes,
    metaCount,
    missingMetaCount: entries.length - metaCount,
    entries,
  };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error("请求失败 " + response.status + ": " + text);
  return text.length === 0 ? null : JSON.parse(text);
}

console.log("Cocos Playable Packer - 工程资源清单上传");
console.log("项目目录：" + process.cwd());
const manifest = await createManifest(process.cwd());
console.log("资源数量：" + manifest.resourceCount);
console.log("资源总大小：" + manifest.totalBytes + " B");
console.log("正在上传资源清单……");
await postJson(manifestUploadUrl, manifest, { "x-analysis-upload-token": uploadToken });
await postJson(startUrl, { requireManifest: true });
console.log("上传成功，完整资源体检已经开始。请返回浏览器查看结果。");
`;
}

export function createAssetsManifestUploaderCmd(moduleUrl: string, fileStem: string): string {
  const safeStem = fileStem.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `@echo off\r
setlocal\r
chcp 65001 >nul\r
cd /d "%~dp0"\r
set "SCANNER=%TEMP%\\${safeStem}.mjs"\r
echo Cocos Playable Packer - 工程资源扫描\r
echo.\r
where node >nul 2>nul\r
if errorlevel 1 (\r
  echo [错误] 未找到 Node.js。请安装 Node.js 20 或更高版本。\r
  pause\r
  exit /b 1\r
)\r
echo 正在下载临时扫描器……\r
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '${moduleUrl}' -OutFile '%SCANNER%'"\r
if errorlevel 1 (\r
  echo [错误] 无法下载扫描器，请确认 Cocos Playable Packer Web UI 仍在运行。\r
  pause\r
  exit /b 1\r
)\r
node "%SCANNER%"\r
set "EXIT_CODE=%ERRORLEVEL%"\r
del /q "%SCANNER%" >nul 2>nul\r
if not "%EXIT_CODE%"=="0" (\r
  echo.\r
  echo [错误] 资源清单生成或上传失败。\r
)\r
echo.\r
pause\r
exit /b %EXIT_CODE%\r
`;
}
