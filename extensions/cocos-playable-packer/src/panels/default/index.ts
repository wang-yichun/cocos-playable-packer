import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  CreatorBuildConfiguration,
  CreatorBuildTask,
  CreatorEnvironmentInfo,
} from "../../shared/types.js";

const PACKAGE_NAME = "cocos-playable-packer";
const DEFAULT_IMAGE_QUALITY = 80;
const template = readFileSync(path.join(__dirname, "../../../static/template/default/index.html"), "utf8");
const style = readFileSync(path.join(__dirname, "../../../static/style/default/index.css"), "utf8");

interface PanelElements {
  refreshEnvironmentButton: HTMLButtonElement;
  startBuildButton: HTMLButtonElement;
  cancelBuildButton: HTMLButtonElement;
  inputDirectoryBrowseButton: HTMLButtonElement;
  outputFileBrowseButton: HTMLButtonElement;
  panelStatus: HTMLElement;
  taskStatus: HTMLElement;
  taskLogOutput: HTMLElement;
  inputDirectory: HTMLInputElement;
  outputFile: HTMLInputElement;
  imageMode: HTMLSelectElement;
  qualitySettings: HTMLElement;
  pngQuality: HTMLInputElement;
  jpegQuality: HTMLInputElement;
  tinyPngSettings: HTMLElement;
  tinyPngApiKey: HTMLInputElement;
  payloadEncoding: HTMLSelectElement;
  audioEnabled: HTMLInputElement;
  audioBitrateKbps: HTMLInputElement;
  audioSettings: HTMLElement;
  webpWarning: HTMLElement;
  audioWarning: HTMLElement;
  extensionVersion: HTMLElement;
  projectName: HTMLElement;
  projectPath: HTMLElement;
  projectUuid: HTMLElement;
  hostNodeVersion: HTMLElement;
  hostExecutable: HTMLElement;
  externalNodeVersion: HTMLElement;
  externalNodeExecutable: HTMLElement;
  externalNodeErrorRow: HTMLElement;
  externalNodeError: HTMLElement;
  extensionRoot: HTMLElement;
  realExtensionRoot: HTMLElement;
  packerRoot: HTMLElement;
  webMobileDirectory: HTMLElement;
  defaultOutputDirectory: HTMLElement;
  checkedAt: HTMLElement;
  logOutput: HTMLElement;
  projectCheck: HTMLElement;
  buildCheck: HTMLElement;
  packerCheck: HTMLElement;
  nodeCheck: HTMLElement;
}

interface PanelContext { $: PanelElements }

const selectors: Record<keyof PanelElements, string> = {
  refreshEnvironmentButton: "#refreshEnvironmentButton",
  startBuildButton: "#startBuildButton",
  cancelBuildButton: "#cancelBuildButton",
  inputDirectoryBrowseButton: "#inputDirectoryBrowseButton",
  outputFileBrowseButton: "#outputFileBrowseButton",
  panelStatus: "#panelStatus",
  taskStatus: "#taskStatus",
  taskLogOutput: "#taskLogOutput",
  inputDirectory: "#inputDirectory",
  outputFile: "#outputFile",
  imageMode: "#imageMode",
  qualitySettings: "#qualitySettings",
  pngQuality: "#pngQuality",
  jpegQuality: "#jpegQuality",
  tinyPngSettings: "#tinyPngSettings",
  tinyPngApiKey: "#tinyPngApiKey",
  payloadEncoding: "#payloadEncoding",
  audioEnabled: "#audioEnabled",
  audioBitrateKbps: "#audioBitrateKbps",
  audioSettings: "#audioSettings",
  webpWarning: "#webpWarning",
  audioWarning: "#audioWarning",
  extensionVersion: "#extensionVersion",
  projectName: "#projectName",
  projectPath: "#projectPath",
  projectUuid: "#projectUuid",
  hostNodeVersion: "#hostNodeVersion",
  hostExecutable: "#hostExecutable",
  externalNodeVersion: "#externalNodeVersion",
  externalNodeExecutable: "#externalNodeExecutable",
  externalNodeErrorRow: "#externalNodeErrorRow",
  externalNodeError: "#externalNodeError",
  extensionRoot: "#extensionRoot",
  realExtensionRoot: "#realExtensionRoot",
  packerRoot: "#packerRoot",
  webMobileDirectory: "#webMobileDirectory",
  defaultOutputDirectory: "#defaultOutputDirectory",
  checkedAt: "#checkedAt",
  logOutput: "#logOutput",
  projectCheck: "#projectCheck",
  buildCheck: "#buildCheck",
  packerCheck: "#packerCheck",
  nodeCheck: "#nodeCheck",
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let handlers: Array<readonly [HTMLElement, string, EventListener]> = [];

function setText(elements: PanelElements, key: keyof PanelElements, value: string): void {
  elements[key].textContent = value;
}

function setCheck(element: HTMLElement, passed: boolean, ok: string, failed: string): void {
  element.textContent = passed ? ok : failed;
  element.classList.toggle("status-ok", passed);
  element.classList.toggle("status-warning", !passed);
}

function syncConfigurationState(elements: PanelElements, active: boolean): void {
  const imageMode = elements.imageMode.value;
  const qualityEnabled = imageMode === "squoosh" || imageMode === "webp";
  const tinyPngEnabled = imageMode === "tinypng";

  elements.inputDirectory.disabled = active;
  elements.outputFile.disabled = active;
  elements.inputDirectoryBrowseButton.disabled = active;
  elements.outputFileBrowseButton.disabled = active;
  elements.imageMode.disabled = active;
  elements.payloadEncoding.disabled = active;
  elements.qualitySettings.hidden = !qualityEnabled;
  elements.pngQuality.disabled = active || !qualityEnabled;
  elements.jpegQuality.disabled = active || !qualityEnabled;
  elements.tinyPngSettings.hidden = !tinyPngEnabled;
  elements.tinyPngApiKey.disabled = active || !tinyPngEnabled;
  elements.audioEnabled.disabled = active;
  elements.audioBitrateKbps.disabled = active || !elements.audioEnabled.checked;
  elements.audioSettings.classList.toggle("config-card--muted", !elements.audioEnabled.checked);
  elements.webpWarning.hidden = imageMode !== "webp";
  elements.audioWarning.hidden = !elements.audioEnabled.checked;
}

function renderEnvironment(elements: PanelElements, info: CreatorEnvironmentInfo): void {
  setText(elements, "extensionVersion", info.extensionVersion);
  setText(elements, "projectName", info.project.name);
  setText(elements, "projectPath", info.project.path);
  setText(elements, "projectUuid", info.project.uuid);
  setText(elements, "hostNodeVersion", `${info.runtime.hostNodeVersion} · ${info.runtime.platform}/${info.runtime.architecture}`);
  setText(elements, "hostExecutable", info.runtime.hostExecutable);
  setText(elements, "externalNodeVersion", info.runtime.externalNodeVersion ?? "未检测到");
  setText(elements, "externalNodeExecutable", info.runtime.externalNodeExecutable ?? "未检测到");
  elements.externalNodeErrorRow.hidden = info.runtime.externalNodeError === null;
  setText(elements, "externalNodeError", info.runtime.externalNodeError ?? "");
  setText(elements, "extensionRoot", info.paths.extensionRoot);
  setText(elements, "realExtensionRoot", info.paths.realExtensionRoot);
  setText(elements, "packerRoot", info.paths.packerRoot ?? "未检测到");
  setText(elements, "webMobileDirectory", info.paths.webMobileDirectory);
  setText(elements, "defaultOutputDirectory", info.paths.defaultOutputDirectory);
  setText(elements, "checkedAt", new Date(info.checkedAt).toLocaleString());
  setText(elements, "logOutput", info.logs.length === 0 ? "暂无日志。" : info.logs.join("\n"));
  if (elements.inputDirectory.value.trim().length === 0) elements.inputDirectory.value = info.paths.webMobileDirectory;
  if (elements.outputFile.value.trim().length === 0) elements.outputFile.value = path.join(info.paths.defaultOutputDirectory, "game.html");
  setCheck(elements.projectCheck, info.checks.projectDirectoryExists && info.checks.assetsDirectoryExists && info.checks.projectPackageExists, "项目结构正常", "项目结构不完整");
  setCheck(elements.buildCheck, info.checks.webMobileDirectoryExists, "已找到 Web Mobile 构建", "尚未构建 Web Mobile");
  setCheck(elements.packerCheck, info.checks.packerRootDetected && info.checks.coreSourceExists, "已连接 Packer Core", "未连接 Packer Core");
  setCheck(elements.nodeCheck, info.runtime.externalNodeSupported, "外部 Node.js 22+ 可用", info.runtime.externalNodeAvailable ? "外部 Node.js 版本过低" : "未找到外部 Node.js");
}

function renderTask(elements: PanelElements, task: CreatorBuildTask): void {
  const active = task.status === "starting" || task.status === "running";
  elements.startBuildButton.disabled = active;
  elements.cancelBuildButton.disabled = !active;
  syncConfigurationState(elements, active);
  setText(elements, "taskStatus", task.status === "idle" ? "等待构建" : `${task.status}${task.stage ? ` · ${task.stage}` : ""}`);
  setText(elements, "taskLogOutput", task.logs.length === 0 ? "暂无构建日志。" : task.logs.join("\n"));
  setText(elements, "panelStatus", task.error ?? (task.status === "succeeded" ? `构建完成：${task.outputFile}` : active ? "构建任务正在运行…" : "环境检测完成。"));
}

async function refreshEnvironment(elements: PanelElements): Promise<void> {
  elements.refreshEnvironmentButton.disabled = true;
  try {
    renderEnvironment(elements, await Editor.Message.request<CreatorEnvironmentInfo>(PACKAGE_NAME, "query-environment"));
  } catch (error) {
    setText(elements, "panelStatus", `环境检测失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    elements.refreshEnvironmentButton.disabled = false;
  }
}

async function chooseInputDirectory(elements: PanelElements): Promise<void> {
  try {
    const result = await Editor.Dialog.select({
      title: "选择 Web Mobile 构建目录",
      button: "选择目录",
      path: elements.inputDirectory.value.trim() || Editor.Project.path,
      type: "directory",
      multi: false,
    });
    const selectedDirectory = result.filePaths[0];
    if (selectedDirectory) elements.inputDirectory.value = selectedDirectory;
  } catch (error) {
    setText(elements, "panelStatus", `打开目录选择器失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function chooseOutputFile(elements: PanelElements): Promise<void> {
  try {
    const defaultFile = elements.outputFile.value.trim() || path.join(Editor.Project.path, "build", "playable", "game.html");
    const result = await Editor.Dialog.save({
      title: "选择 Playable HTML 输出文件",
      button: "保存",
      path: defaultFile,
      filters: [{ name: "HTML 文件", extensions: ["html"] }],
    });
    if (result.filePath) {
      elements.outputFile.value = result.filePath.toLowerCase().endsWith(".html") ? result.filePath : `${result.filePath}.html`;
    }
  } catch (error) {
    setText(elements, "panelStatus", `打开输出文件选择器失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function imageQuality(input: HTMLInputElement, label: string): number {
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new TypeError(`${label}必须是 1–100 的整数。`);
  }
  return value;
}

function configurationFrom(elements: PanelElements): CreatorBuildConfiguration {
  const imageMode = elements.imageMode.value as CreatorBuildConfiguration["imageMode"];
  const tinyPngApiKey = elements.tinyPngApiKey.value.trim();
  if (imageMode === "tinypng" && tinyPngApiKey.length === 0) {
    throw new TypeError("选择 TinyPNG 时必须填写 API Key。");
  }
  return {
    inputDirectory: elements.inputDirectory.value.trim(),
    outputFile: elements.outputFile.value.trim(),
    imageMode,
    pngQuality: imageQuality(elements.pngQuality, "PNG 质量"),
    jpegQuality: imageQuality(elements.jpegQuality, "JPG 质量"),
    tinyPngApiKey,
    audioEnabled: elements.audioEnabled.checked,
    audioBitrateKbps: Number(elements.audioBitrateKbps.value) || 48,
    payloadEncoding: elements.payloadEncoding.value as CreatorBuildConfiguration["payloadEncoding"],
  };
}

async function startBuild(elements: PanelElements): Promise<void> {
  try {
    const configuration = configurationFrom(elements);
    renderTask(elements, await Editor.Message.request<CreatorBuildTask>(PACKAGE_NAME, "start-build", configuration));
  } catch (error) {
    setText(elements, "panelStatus", `启动失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function refreshTask(elements: PanelElements): Promise<void> {
  renderTask(elements, await Editor.Message.request<CreatorBuildTask>(PACKAGE_NAME, "query-build-task"));
}

function bind(element: HTMLElement, event: string, listener: EventListener): void {
  element.addEventListener(event, listener);
  handlers.push([element, event, listener]);
}

module.exports = Editor.Panel.define({
  template,
  style,
  $: selectors,
  methods: {},
  ready(this: PanelContext): void {
    bind(this.$.refreshEnvironmentButton, "click", () => void refreshEnvironment(this.$));
    bind(this.$.inputDirectoryBrowseButton, "click", () => void chooseInputDirectory(this.$));
    bind(this.$.outputFileBrowseButton, "click", () => void chooseOutputFile(this.$));
    bind(this.$.imageMode, "change", () => syncConfigurationState(this.$, false));
    bind(this.$.audioEnabled, "change", () => syncConfigurationState(this.$, false));
    bind(this.$.startBuildButton, "click", () => void startBuild(this.$));
    bind(this.$.cancelBuildButton, "click", () => void Editor.Message.request<CreatorBuildTask>(PACKAGE_NAME, "cancel-build").then((task) => renderTask(this.$, task)));
    if (this.$.pngQuality.value.trim().length === 0) this.$.pngQuality.value = String(DEFAULT_IMAGE_QUALITY);
    if (this.$.jpegQuality.value.trim().length === 0) this.$.jpegQuality.value = String(DEFAULT_IMAGE_QUALITY);
    syncConfigurationState(this.$, false);
    void refreshEnvironment(this.$);
    void refreshTask(this.$);
    pollTimer = setInterval(() => void refreshTask(this.$), 750);
  },
  beforeClose(): void {},
  close(): void {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
    for (const [element, event, listener] of handlers) element.removeEventListener(event, listener);
    handlers = [];
  },
});
