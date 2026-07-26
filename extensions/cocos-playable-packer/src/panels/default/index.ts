import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  CreatorBuildConfiguration,
  CreatorBuildTask,
  CreatorEnvironmentInfo,
} from "../../shared/types.js";

const PACKAGE_NAME = "cocos-playable-packer";
const template = readFileSync(path.join(__dirname, "../../../static/template/default/index.html"), "utf8");
const style = readFileSync(path.join(__dirname, "../../../static/style/default/index.css"), "utf8");

interface PanelElements {
  refreshEnvironmentButton: HTMLButtonElement;
  startBuildButton: HTMLButtonElement;
  cancelBuildButton: HTMLButtonElement;
  panelStatus: HTMLElement;
  taskStatus: HTMLElement;
  taskLogOutput: HTMLElement;
  inputDirectory: HTMLInputElement;
  outputFile: HTMLInputElement;
  imageMode: HTMLSelectElement;
  payloadEncoding: HTMLSelectElement;
  audioEnabled: HTMLInputElement;
  audioBitrateKbps: HTMLInputElement;
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
  refreshEnvironmentButton: "#refreshEnvironmentButton", startBuildButton: "#startBuildButton", cancelBuildButton: "#cancelBuildButton",
  panelStatus: "#panelStatus", taskStatus: "#taskStatus", taskLogOutput: "#taskLogOutput", inputDirectory: "#inputDirectory", outputFile: "#outputFile",
  imageMode: "#imageMode", payloadEncoding: "#payloadEncoding", audioEnabled: "#audioEnabled", audioBitrateKbps: "#audioBitrateKbps",
  extensionVersion: "#extensionVersion", projectName: "#projectName", projectPath: "#projectPath", projectUuid: "#projectUuid",
  hostNodeVersion: "#hostNodeVersion", hostExecutable: "#hostExecutable", externalNodeVersion: "#externalNodeVersion",
  externalNodeExecutable: "#externalNodeExecutable", externalNodeErrorRow: "#externalNodeErrorRow", externalNodeError: "#externalNodeError",
  extensionRoot: "#extensionRoot", realExtensionRoot: "#realExtensionRoot", packerRoot: "#packerRoot", webMobileDirectory: "#webMobileDirectory",
  defaultOutputDirectory: "#defaultOutputDirectory", checkedAt: "#checkedAt", logOutput: "#logOutput",
  projectCheck: "#projectCheck", buildCheck: "#buildCheck", packerCheck: "#packerCheck", nodeCheck: "#nodeCheck",
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
  for (const control of [elements.inputDirectory, elements.outputFile, elements.imageMode, elements.payloadEncoding, elements.audioEnabled, elements.audioBitrateKbps]) {
    control.disabled = active;
  }
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

function configurationFrom(elements: PanelElements): CreatorBuildConfiguration {
  return {
    inputDirectory: elements.inputDirectory.value.trim(),
    outputFile: elements.outputFile.value.trim(),
    imageMode: elements.imageMode.value as CreatorBuildConfiguration["imageMode"],
    audioEnabled: elements.audioEnabled.checked,
    audioBitrateKbps: Number(elements.audioBitrateKbps.value) || 48,
    payloadEncoding: elements.payloadEncoding.value as CreatorBuildConfiguration["payloadEncoding"],
  };
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
    bind(this.$.startBuildButton, "click", () => void Editor.Message.request<CreatorBuildTask>(PACKAGE_NAME, "start-build", configurationFrom(this.$)).then((task) => renderTask(this.$, task)).catch((error) => setText(this.$, "panelStatus", `启动失败：${String(error)}`)));
    bind(this.$.cancelBuildButton, "click", () => void Editor.Message.request<CreatorBuildTask>(PACKAGE_NAME, "cancel-build").then((task) => renderTask(this.$, task)));
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
