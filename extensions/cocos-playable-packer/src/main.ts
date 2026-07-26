import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type { CreatorEnvironmentInfo } from "./shared/types.js";

const PACKAGE_NAME = "cocos-playable-packer";
const MAX_LOG_LINES = 100;
const logs: string[] = [];

function timestamp(): string {
  return new Date().toISOString();
}

function appendLog(message: string): void {
  logs.push(`[${timestamp()}] ${message}`);
  if (logs.length > MAX_LOG_LINES) {
    logs.splice(0, logs.length - MAX_LOG_LINES);
  }
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function packageNameAt(rootDirectory: string): Promise<string | null> {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(rootDirectory, "package.json"), "utf8"),
    ) as { name?: unknown };
    return typeof packageJson.name === "string" ? packageJson.name : null;
  } catch {
    return null;
  }
}

async function extensionVersion(extensionRoot: string): Promise<string> {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(extensionRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

async function detectPackerRoot(
  extensionRoot: string,
  realExtensionRoot: string,
): Promise<string | null> {
  const candidates = [
    process.env.PLAYABLE_PACKER_ROOT,
    path.resolve(realExtensionRoot, "..", ".."),
    path.resolve(extensionRoot, "..", ".."),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of [...new Set(candidates.map((value) => path.resolve(value)))]) {
    if (await packageNameAt(candidate) !== "cocos-playable-packer") {
      continue;
    }
    return candidate;
  }
  return null;
}

async function queryEnvironment(): Promise<CreatorEnvironmentInfo> {
  const extensionRoot = path.resolve(__dirname, "..");
  const realExtensionRoot = await realpath(extensionRoot).catch(() => extensionRoot);
  const packerRoot = await detectPackerRoot(extensionRoot, realExtensionRoot);
  const projectPath = path.resolve(Editor.Project.path);
  const webMobileDirectory = path.join(projectPath, "build", "web-mobile");
  const defaultOutputDirectory = path.join(projectPath, "build", "playable");
  const coreSource = packerRoot === null
    ? null
    : path.join(packerRoot, "src", "core", "index.ts");

  const checks = {
    projectDirectoryExists: await exists(projectPath),
    assetsDirectoryExists: await exists(path.join(projectPath, "assets")),
    projectPackageExists: await exists(path.join(projectPath, "package.json")),
    webMobileDirectoryExists: await exists(webMobileDirectory),
    packerRootDetected: packerRoot !== null,
    coreSourceExists: coreSource !== null && await exists(coreSource),
  };

  appendLog(
    checks.webMobileDirectoryExists
      ? `已找到 Web Mobile 构建目录：${webMobileDirectory}`
      : `尚未找到 Web Mobile 构建目录：${webMobileDirectory}`,
  );

  return {
    checkedAt: timestamp(),
    extensionVersion: await extensionVersion(extensionRoot),
    project: {
      name: Editor.Project.name,
      path: projectPath,
      tmpDir: Editor.Project.tmpDir,
      uuid: Editor.Project.uuid,
    },
    runtime: {
      nodeVersion: process.version,
      nodeExecutable: process.execPath,
      platform: process.platform,
      architecture: process.arch,
    },
    paths: {
      extensionRoot,
      realExtensionRoot,
      packerRoot,
      webMobileDirectory,
      defaultOutputDirectory,
    },
    checks,
    logs: [...logs],
  };
}

export const methods = {
  async openPanel(): Promise<void> {
    appendLog("正在打开 Cocos Playable Packer 面板。");
    await Editor.Panel.open(PACKAGE_NAME);
  },

  queryEnvironment,
};

export function load(): void {
  appendLog(`扩展已加载：${Editor.Project.name}`);
  console.log(`[${PACKAGE_NAME}] extension loaded for ${Editor.Project.path}`);
}

export function unload(): void {
  appendLog("扩展已卸载。");
  console.log(`[${PACKAGE_NAME}] extension unloaded`);
}
