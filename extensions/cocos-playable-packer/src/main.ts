import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { CreatorBuildTaskManager } from "./services/task-manager.js";
import type {
  CreatorBuildConfiguration,
  CreatorBuildTask,
  CreatorEnvironmentInfo,
  CreatorRuntimeInfo,
} from "./shared/types.js";

const PACKAGE_NAME = "cocos-playable-packer";
const MAX_LOG_LINES = 100;
const MINIMUM_EXTERNAL_NODE_MAJOR = 22;
const execFileAsync = promisify(execFile);
const logs: string[] = [];
const taskManager = new CreatorBuildTaskManager();

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

async function detectPackerRoot(extensionRoot: string, realExtensionRoot: string): Promise<string | null> {
  const candidates = [
    process.env.PLAYABLE_PACKER_ROOT,
    path.resolve(realExtensionRoot, "..", ".."),
    path.resolve(extensionRoot, "..", ".."),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of [...new Set(candidates.map((value) => path.resolve(value)))]) {
    if (await packageNameAt(candidate) === "cocos-playable-packer") return candidate;
  }
  return null;
}

function externalNodeMajor(version: string): number | null {
  const match = /^v?(\d+)/i.exec(version.trim());
  if (match?.[1] === undefined) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

async function commandOutput(command: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(command, [...args], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function resolveExternalNodeExecutable(command: string): Promise<string> {
  if (path.isAbsolute(command)) return path.resolve(command);
  try {
    const output = process.platform === "win32"
      ? await commandOutput("where.exe", [command])
      : await commandOutput("which", [command]);
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first === undefined ? command : path.resolve(first);
  } catch {
    return command;
  }
}

async function detectExternalNode(): Promise<CreatorRuntimeInfo> {
  const command = process.env.PLAYABLE_PACKER_NODE?.trim() || "node";
  try {
    const version = (await commandOutput(command, ["--version"])).split(/\r?\n/)[0]?.trim() || "unknown";
    const major = externalNodeMajor(version);
    const executable = await resolveExternalNodeExecutable(command);
    const supported = major !== null && major >= MINIMUM_EXTERNAL_NODE_MAJOR;
    appendLog(supported
      ? `已找到外部 Node.js：${version} (${executable})`
      : `外部 Node.js 版本低于要求：${version}，需要 Node.js ${MINIMUM_EXTERNAL_NODE_MAJOR}+。`);
    return {
      hostNodeVersion: process.version,
      hostExecutable: process.execPath,
      platform: process.platform,
      architecture: process.arch,
      externalNodeAvailable: true,
      externalNodeSupported: supported,
      externalNodeVersion: version,
      externalNodeExecutable: executable,
      externalNodeError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`未找到可用的外部 Node.js：${message}`);
    return {
      hostNodeVersion: process.version,
      hostExecutable: process.execPath,
      platform: process.platform,
      architecture: process.arch,
      externalNodeAvailable: false,
      externalNodeSupported: false,
      externalNodeVersion: null,
      externalNodeExecutable: null,
      externalNodeError: message,
    };
  }
}

async function queryEnvironment(): Promise<CreatorEnvironmentInfo> {
  const extensionRoot = path.resolve(__dirname, "..");
  const realExtensionRoot = await realpath(extensionRoot).catch(() => extensionRoot);
  const packerRoot = await detectPackerRoot(extensionRoot, realExtensionRoot);
  const projectPath = path.resolve(Editor.Project.path);
  const webMobileDirectory = path.join(projectPath, "build", "web-mobile");
  const defaultOutputDirectory = path.join(projectPath, "build", "playable");
  const coreSource = packerRoot === null ? null : path.join(packerRoot, "src", "core", "index.ts");
  const runtime = await detectExternalNode();
  const checks = {
    projectDirectoryExists: await exists(projectPath),
    assetsDirectoryExists: await exists(path.join(projectPath, "assets")),
    projectPackageExists: await exists(path.join(projectPath, "package.json")),
    webMobileDirectoryExists: await exists(webMobileDirectory),
    packerRootDetected: packerRoot !== null,
    coreSourceExists: coreSource !== null && await exists(coreSource),
  };
  appendLog(checks.webMobileDirectoryExists
    ? `已找到 Web Mobile 构建目录：${webMobileDirectory}`
    : `尚未找到 Web Mobile 构建目录：${webMobileDirectory}`);
  return {
    checkedAt: timestamp(),
    extensionVersion: await extensionVersion(extensionRoot),
    project: { name: Editor.Project.name, path: projectPath, tmpDir: Editor.Project.tmpDir, uuid: Editor.Project.uuid },
    runtime,
    paths: { extensionRoot, realExtensionRoot, packerRoot, webMobileDirectory, defaultOutputDirectory },
    checks,
    logs: [...logs],
  };
}

async function startBuild(configuration: CreatorBuildConfiguration): Promise<CreatorBuildTask> {
  const environment = await queryEnvironment();
  if (!environment.checks.webMobileDirectoryExists) throw new Error("未找到 Web Mobile 构建目录。");
  if (environment.paths.packerRoot === null) throw new Error("未检测到 Packer Core 根目录。");
  if (!environment.runtime.externalNodeSupported || environment.runtime.externalNodeExecutable === null) {
    throw new Error("未检测到可用的外部 Node.js 22+。");
  }
  const tempRoot = path.join(Editor.Project.tmpDir, PACKAGE_NAME, "worker");
  await mkdir(tempRoot, { recursive: true });
  return taskManager.start({
    packageRoot: environment.paths.packerRoot,
    tempRoot,
    nodeExecutable: environment.runtime.externalNodeExecutable,
    projectName: environment.project.name,
    configuration,
  });
}

export const methods = {
  async openPanel(): Promise<void> {
    appendLog("正在打开 Cocos Playable Packer 面板。");
    await Editor.Panel.open(PACKAGE_NAME);
  },
  queryEnvironment,
  startBuild,
  queryBuildTask(): CreatorBuildTask {
    return taskManager.current();
  },
  cancelBuild(): CreatorBuildTask {
    return taskManager.cancel();
  },
};

export function load(): void {
  appendLog(`扩展已加载：${Editor.Project.name}`);
  console.log(`[${PACKAGE_NAME}] extension loaded for ${Editor.Project.path}`);
}

export function unload(): void {
  appendLog("扩展已卸载；正在运行的外部 Worker 不会因面板关闭而停止。");
  console.log(`[${PACKAGE_NAME}] extension unloaded`);
}
