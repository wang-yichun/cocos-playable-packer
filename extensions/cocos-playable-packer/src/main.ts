import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
const DEFAULT_IMAGE_QUALITY = 80;
const execFileAsync = promisify(execFile);
const extensionRequire = createRequire(__filename);
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
    process.env.PLAYABLE_PACKER_RUNTIME_ROOT,
    path.join(realExtensionRoot, "runtime"),
    path.join(extensionRoot, "runtime"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of [...new Set(candidates.map((value) => path.resolve(value)))]) {
    const worker = path.join(candidate, "dist", "creator-worker", "playable-build-worker.js");
    const core = path.join(candidate, "dist", "core", "index.js");
    if (await exists(worker) && await exists(core)) return candidate;
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
  const coreSource = packerRoot === null ? null : path.join(packerRoot, "dist", "core", "index.js");
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

function normalizedImageQuality(value: number | undefined, label: string): number {
  const quality = value ?? DEFAULT_IMAGE_QUALITY;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new TypeError(`${label}必须是 1–100 的整数。`);
  }
  return quality;
}

function normalizeBuildConfiguration(configuration: CreatorBuildConfiguration): CreatorBuildConfiguration {
  const tinyPngApiKey = configuration.tinyPngApiKey?.trim() ?? "";
  if (configuration.imageMode === "tinypng" && tinyPngApiKey.length === 0) {
    throw new TypeError("选择 TinyPNG 时必须填写 API Key。");
  }
  return {
    ...configuration,
    pngQuality: normalizedImageQuality(configuration.pngQuality, "PNG 质量"),
    jpegQuality: normalizedImageQuality(configuration.jpegQuality, "JPG 质量"),
    tinyPngApiKey,
  };
}

async function startBuild(configuration: CreatorBuildConfiguration): Promise<CreatorBuildTask> {
  const normalizedConfiguration = normalizeBuildConfiguration(configuration);
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
    configuration: normalizedConfiguration,
  });
}

async function openInDefaultBrowser(filePath: string): Promise<void> {
  const target = path.resolve(filePath);
  if (!(await exists(target))) throw new Error(`预览文件不存在：${target}`);
  const url = pathToFileURL(target).href;
  if (process.platform === "win32") {
    await execFileAsync("cmd.exe", ["/d", "/c", "start", "", url], {
      windowsHide: true,
      timeout: 5_000,
    });
    return;
  }
  if (process.platform === "darwin") {
    await execFileAsync("open", [url], { timeout: 5_000 });
    return;
  }
  await execFileAsync("xdg-open", [url], { timeout: 5_000 });
}

async function openInFileManager(directoryPath: string): Promise<void> {
  const target = path.resolve(directoryPath);
  if (!(await exists(target))) throw new Error(`资源目录不存在：${target}`);
  if (process.platform === "win32") {
    // 使用 Creator 官方内置扩展所使用的 Electron shell API。
    const electronShell = extensionRequire("electron").shell as {
      showItemInFolder(fullPath: string): void;
    };
    electronShell.showItemInFolder(target);
    return;
  }
  if (process.platform === "darwin") {
    await execFileAsync("open", [target], { timeout: 5_000 });
    return;
  }
  await execFileAsync("xdg-open", [target], { timeout: 5_000 });
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
  async openPreview(): Promise<void> {
    const task = taskManager.current();
    if (task.status !== "succeeded") throw new Error("请先完成一次构建，再打开浏览器预览。");
    await openInDefaultBrowser(task.outputFile);
    appendLog(`已在默认浏览器打开预览：${task.outputFile}`);
  },
  async openOutputFolder(): Promise<void> {
    const task = taskManager.current();
    if (task.status !== "succeeded") throw new Error("请先完成一次构建，再打开资源目录。");
    const directory = path.dirname(path.resolve(task.outputFile));
    await openInFileManager(directory);
    appendLog(`已打开生成的资源目录：${directory}`);
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
