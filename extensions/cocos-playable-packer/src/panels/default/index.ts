import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  CreatorBuildConfiguration,
  CreatorBuildTask,
  CreatorEnvironmentInfo,
} from "../../shared/types.js";

const PACKAGE_NAME = "cocos-playable-packer";
const DEFAULT_IMAGE_QUALITY = 80;
const CONFIGURATION_STORAGE_PREFIX = "cocos-playable-packer.configuration.v1";
const template = readFileSync(path.join(__dirname, "../../../static/template/default/index.html"), "utf8");
const style = readFileSync(path.join(__dirname, "../../../static/style/default/index.css"), "utf8");

interface PanelElements {
  refreshEnvironmentButton: HTMLButtonElement;
  startBuildButton: HTMLButtonElement;
  cancelBuildButton: HTMLButtonElement;
  previewButton: HTMLButtonElement;
  outputFolderButton: HTMLButtonElement;
  importLogoButton: HTMLButtonElement;
  clearLogoButton: HTMLButtonElement;
  loadingScreenEnabled: HTMLInputElement;
  loadingLogoPreview: HTMLElement;
  loadingLogoPreviewImage: HTMLImageElement;
  loadingLogoPreviewMeta: HTMLElement;
  loadingOverlay: HTMLElement;
  loadingLogo: HTMLImageElement;
  loadingProgressFill: HTMLElement;
  loadingProgressLabel: HTMLElement;
  reportSection: HTMLElement;
  reportContent: HTMLElement;
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

interface PersistedConfiguration {
  inputDirectory: string;
  outputFile: string;
  imageMode: string;
  pngQuality: string;
  jpegQuality: string;
  tinyPngApiKey: string;
  payloadEncoding: string;
  audioEnabled: boolean;
  audioBitrateKbps: string;
  loadingScreenEnabled: boolean;
}

const selectors: Record<keyof PanelElements, string> = {
  refreshEnvironmentButton: "#refreshEnvironmentButton",
  startBuildButton: "#startBuildButton",
  cancelBuildButton: "#cancelBuildButton",
  previewButton: "#previewButton",
  outputFolderButton: "#outputFolderButton",
  importLogoButton: "#importLogoButton",
  clearLogoButton: "#clearLogoButton",
  loadingScreenEnabled: "#loadingScreenEnabled",
  loadingLogoPreview: "#loadingLogoPreview",
  loadingLogoPreviewImage: "#loadingLogoPreviewImage",
  loadingLogoPreviewMeta: "#loadingLogoPreviewMeta",
  loadingOverlay: "#loadingOverlay",
  loadingLogo: "#loadingLogo",
  loadingProgressFill: "#loadingProgressFill",
  loadingProgressLabel: "#loadingProgressLabel",
  reportSection: "#reportSection",
  reportContent: "#reportContent",
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
let lastReportTaskId = "";

function reportObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reportNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function reportBytes(value: unknown): string {
  const bytes = Math.max(0, reportNumber(value));
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function reportPercent(before: unknown, after: unknown): string {
  const source = reportNumber(before);
  if (source <= 0) return "-";
  return `${Math.max(0, (1 - reportNumber(after) / source) * 100).toFixed(2)}%`;
}

function reportDuration(value: unknown): string {
  const milliseconds = Math.max(0, Math.round(reportNumber(value)));
  return milliseconds >= 1_000 ? `${Math.round(milliseconds / 1_000)} 秒` : `${milliseconds} ms`;
}

function reportTimingLabel(key: string): string {
  const labels: Record<string, string> = {
    copy: "复制文件",
    imageOptimization: "图片处理",
    audioOptimization: "音频处理",
    packaging: "封装资源",
    payloadEncoding: "Payload 编码",
    loadingScreen: "加载页注入",
    brotliFallbackOptimization: "Brotli 兼容优化",
  };
  return labels[key] ?? key;
}

function reportCard(label: string, value: string, note = ""): string {
  return `<article class="report-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderBuildReport(elements: PanelElements, report: unknown): void {
  const root = reportObject(report);
  const input = reportObject(root.input);
  const output = reportObject(root.output);
  const image = reportObject(root.imageOptimization);
  const audio = reportObject(root.audioOptimization);
  const payload = reportObject(root.payloadEncoding);
  const timing = reportObject(root.timingMs);
  const warnings = Array.isArray(root.warnings) ? root.warnings : [];
  const totalBefore = reportNumber(input.totalBytes);
  const totalAfter = reportNumber(output.bytes);
  const timingRows = Object.entries(timing).filter(([key]) => key !== "total");
  const timingMaximum = Math.max(1, ...timingRows.map(([, value]) => reportNumber(value)));
  const audioLabel = audio.enabled === true ? `已启用 · ${audio.targetBitrateKbps ?? "-"} kbps` : "未启用";
  const html = [
    `<div class="report-hero"><div><h3>${escapeHtml(reportObject(root.project).explicitName ?? reportObject(root.project).key ?? "Playable 构建报告")}</h3><p>本次构建的实际产物与处理统计</p></div><span class="report-status-badge">构建成功</span></div>`,
    `<div class="report-kpis">${reportCard("最终 HTML", reportBytes(totalAfter), `节省 ${reportPercent(totalBefore, totalAfter)}`)}${reportCard("输入资源", reportBytes(totalBefore))}${reportCard("图片处理", reportBytes(image.afterBytes ?? image.beforeBytes), `${escapeHtml(image.mode ?? "未启用")}`)}${reportCard("音频处理", reportBytes(audio.afterBytes ?? audio.beforeBytes), audioLabel)}${reportCard("Payload", escapeHtml(payload.mode ?? "未启用"))}</div>`,
    `<div class="report-grid"><article class="report-card"><h3>体积对比</h3><div class="report-comparison"><div class="report-comparison-head"><span>最终输出</span><strong>节省 ${reportPercent(totalBefore, totalAfter)}</strong></div><div class="report-pair"><span>处理前</span><div class="report-track"><div class="report-fill-before" style="width:100%"></div></div><span>${reportBytes(totalBefore)}</span></div><div class="report-pair"><span>处理后</span><div class="report-track"><div class="report-fill-after" style="width:${totalBefore > 0 ? Math.min(100, totalAfter / totalBefore * 100) : 0}%"></div></div><span>${reportBytes(totalAfter)}</span></div></div></article><article class="report-card"><h3>处理耗时</h3><div class="report-timings">${timingRows.map(([key, value]) => `<div class="report-timing-row"><span>${escapeHtml(reportTimingLabel(key))}</span><div class="report-track"><div class="report-timing-fill" style="width:${Math.min(100, reportNumber(value) / timingMaximum * 100)}%"></div></div><span>${reportDuration(value)}</span></div>`).join("") || "<div class=\"report-empty\">没有耗时统计。</div>"}<div class="report-timing-row report-timing-total"><strong>总时间</strong><div></div><strong>${reportDuration(timing.total)}</strong></div></div></article></div>`,
    warnings.length > 0 ? `<article class="report-card report-card-wide"><h3>构建提示</h3><div class="report-warnings">${warnings.map((warning) => `<div class="report-warning-item">${escapeHtml(warning)}</div>`).join("")}</div></article>` : "",
  ].join("");
  elements.reportContent.innerHTML = html;
  elements.reportSection.hidden = false;
}

async function loadBuildReport(elements: PanelElements, task: CreatorBuildTask): Promise<void> {
  if (task.status !== "succeeded" || task.reportFile === null) {
    return;
  }
  if (lastReportTaskId === task.id) return;
  lastReportTaskId = task.id;
  try {
    renderBuildReport(elements, await Editor.Message.request<unknown>(PACKAGE_NAME, "read-build-report"));
  } catch (error) {
    elements.reportContent.innerHTML = `<div class="report-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

function setLoadingProgress(elements: PanelElements, value: number, label: string): void {
  const progress = Math.max(0, Math.min(100, value));
  elements.loadingProgressFill.style.width = `${progress}%`;
  elements.loadingProgressLabel.textContent = label;
}

interface CachedLoadingLogo {
  dataUrl: string;
  filePath: string;
  bytes: number;
  mimeType: string;
}

function renderLoadingLogoPreview(elements: PanelElements, logo: CachedLoadingLogo | null): void {
  if (logo === null) {
    elements.loadingLogo.src = "./static/icon.svg";
    elements.loadingLogoPreviewImage.src = "";
    elements.loadingLogoPreviewMeta.textContent = "";
    elements.loadingLogoPreview.hidden = true;
    return;
  }
  elements.loadingLogo.src = logo.dataUrl;
  elements.loadingLogoPreviewImage.src = logo.dataUrl;
  elements.loadingLogoPreviewMeta.textContent = `${logo.mimeType} · ${logo.bytes} B`;
  elements.loadingLogoPreview.hidden = false;
}

async function loadLoadingLogo(elements: PanelElements): Promise<CachedLoadingLogo | null> {
  try {
    const logo = await Editor.Message.request<CachedLoadingLogo | null>(PACKAGE_NAME, "query-loading-logo");
    renderLoadingLogoPreview(elements, logo);
    return logo;
  } catch {
    renderLoadingLogoPreview(elements, null);
    return null;
  }
}

async function importLoadingLogo(elements: PanelElements): Promise<void> {
  try {
    const result = await Editor.Dialog.select({ title: "选择加载页 Logo", button: "导入 Logo", type: "file", multi: false, filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    const source = result.filePaths[0];
    if (!source) return;
    await Editor.Message.request(PACKAGE_NAME, "save-loading-logo", source);
    await loadLoadingLogo(elements);
    setText(elements, "panelStatus", "加载页 Logo 已缓存到扩展目录。 ");
  } catch (error) {
    setText(elements, "panelStatus", `导入 Logo 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function clearLoadingLogo(elements: PanelElements): Promise<void> {
  try {
    await Editor.Message.request<void>(PACKAGE_NAME, "clear-loading-logo");
    renderLoadingLogoPreview(elements, null);
    setText(elements, "panelStatus", "已清空加载页 Logo 缓存。");
  } catch (error) {
    setText(elements, "panelStatus", `清空 Logo 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function configurationStorageKey(): string {
  const projectIdentity = Editor.Project.uuid || Editor.Project.path;
  return `${CONFIGURATION_STORAGE_PREFIX}:${projectIdentity}`;
}

function persistedConfigurationFrom(elements: PanelElements): PersistedConfiguration {
  return {
    inputDirectory: elements.inputDirectory.value,
    outputFile: elements.outputFile.value,
    imageMode: elements.imageMode.value,
    pngQuality: elements.pngQuality.value,
    jpegQuality: elements.jpegQuality.value,
    tinyPngApiKey: elements.tinyPngApiKey.value,
    payloadEncoding: elements.payloadEncoding.value,
    audioEnabled: elements.audioEnabled.checked,
    audioBitrateKbps: elements.audioBitrateKbps.value,
    loadingScreenEnabled: elements.loadingScreenEnabled.checked,
  };
}

function saveConfiguration(elements: PanelElements): void {
  try {
    window.localStorage.setItem(configurationStorageKey(), JSON.stringify(persistedConfigurationFrom(elements)));
  } catch {
    // Creator 的面板存储不可用时仍允许正常构建。
  }
}

function restoreConfiguration(elements: PanelElements): void {
  try {
    const raw = window.localStorage.getItem(configurationStorageKey());
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<PersistedConfiguration>;
    if (typeof saved.inputDirectory === "string") elements.inputDirectory.value = saved.inputDirectory;
    if (typeof saved.outputFile === "string") elements.outputFile.value = saved.outputFile;
    if (typeof saved.imageMode === "string") elements.imageMode.value = saved.imageMode;
    if (typeof saved.pngQuality === "string") elements.pngQuality.value = saved.pngQuality;
    if (typeof saved.jpegQuality === "string") elements.jpegQuality.value = saved.jpegQuality;
    if (typeof saved.tinyPngApiKey === "string") elements.tinyPngApiKey.value = saved.tinyPngApiKey;
    if (typeof saved.payloadEncoding === "string") elements.payloadEncoding.value = saved.payloadEncoding;
    if (typeof saved.audioEnabled === "boolean") elements.audioEnabled.checked = saved.audioEnabled;
    if (typeof saved.audioBitrateKbps === "string") elements.audioBitrateKbps.value = saved.audioBitrateKbps;
    if (typeof saved.loadingScreenEnabled === "boolean") elements.loadingScreenEnabled.checked = saved.loadingScreenEnabled;
  } catch {
    // 忽略损坏或不可用的历史配置，回退到默认值。
  }
}

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
  elements.loadingScreenEnabled.disabled = active;
  elements.importLogoButton.disabled = active;
  elements.clearLogoButton.disabled = active;
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
  elements.previewButton.disabled = task.status !== "succeeded";
  elements.outputFolderButton.disabled = task.status !== "succeeded";
  syncConfigurationState(elements, active);
  setText(elements, "taskStatus", task.status === "idle" ? "等待构建" : `${task.status}${task.stage ? ` · ${task.stage}` : ""}`);
  setText(elements, "taskLogOutput", task.logs.length === 0 ? "暂无构建日志。" : task.logs.join("\n"));
  setText(elements, "panelStatus", task.error ?? (task.status === "succeeded" ? `构建完成：${task.outputFile}` : active ? "构建任务正在运行…" : "环境检测完成。"));
  void loadBuildReport(elements, task);
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
    if (selectedDirectory) {
      elements.inputDirectory.value = selectedDirectory;
      saveConfiguration(elements);
    }
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
      saveConfiguration(elements);
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
  const qualityEnabled = imageMode === "squoosh" || imageMode === "webp";
  const tinyPngApiKey = elements.tinyPngApiKey.value.trim();
  if (imageMode === "tinypng" && tinyPngApiKey.length === 0) {
    throw new TypeError("选择 TinyPNG 时必须填写 API Key。");
  }
  return {
    inputDirectory: elements.inputDirectory.value.trim(),
    outputFile: elements.outputFile.value.trim(),
    imageMode,
    pngQuality: qualityEnabled ? imageQuality(elements.pngQuality, "PNG 质量") : DEFAULT_IMAGE_QUALITY,
    jpegQuality: qualityEnabled ? imageQuality(elements.jpegQuality, "JPG 质量") : DEFAULT_IMAGE_QUALITY,
    tinyPngApiKey,
    audioEnabled: elements.audioEnabled.checked,
    audioBitrateKbps: Number(elements.audioBitrateKbps.value) || 48,
    payloadEncoding: elements.payloadEncoding.value as CreatorBuildConfiguration["payloadEncoding"],
    loadingScreenEnabled: elements.loadingScreenEnabled.checked,
  };
}

async function startBuild(elements: PanelElements): Promise<void> {
  try {
    elements.reportSection.hidden = true;
    lastReportTaskId = "";
    saveConfiguration(elements);
    const configuration = configurationFrom(elements);
    renderTask(elements, await Editor.Message.request<CreatorBuildTask>(PACKAGE_NAME, "start-build", configuration));
  } catch (error) {
    setText(elements, "panelStatus", `启动失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function refreshTask(elements: PanelElements): Promise<void> {
  renderTask(elements, await Editor.Message.request<CreatorBuildTask>(PACKAGE_NAME, "query-build-task"));
}

async function openPreview(elements: PanelElements): Promise<void> {
  try {
    await Editor.Message.request<void>(PACKAGE_NAME, "open-preview");
    setText(elements, "panelStatus", "已在默认浏览器打开预览。");
  } catch (error) {
    setText(elements, "panelStatus", `打开预览失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function openOutputFolder(elements: PanelElements): Promise<void> {
  try {
    await Editor.Message.request<void>(PACKAGE_NAME, "open-output-folder");
    setText(elements, "panelStatus", "已打开生成的资源目录。");
  } catch (error) {
    setText(elements, "panelStatus", `打开资源目录失败：${error instanceof Error ? error.message : String(error)}`);
  }
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
    this.$.loadingOverlay.hidden = false;
    setLoadingProgress(this.$, 12, "正在加载 Cocos Playable Packer…");
    restoreConfiguration(this.$);
    bind(this.$.refreshEnvironmentButton, "click", () => void refreshEnvironment(this.$));
    bind(this.$.inputDirectoryBrowseButton, "click", () => void chooseInputDirectory(this.$));
    bind(this.$.outputFileBrowseButton, "click", () => void chooseOutputFile(this.$));
    bind(this.$.imageMode, "change", () => syncConfigurationState(this.$, false));
    bind(this.$.audioEnabled, "change", () => syncConfigurationState(this.$, false));
    for (const key of [
      "inputDirectory",
      "outputFile",
      "imageMode",
      "pngQuality",
      "jpegQuality",
      "tinyPngApiKey",
      "payloadEncoding",
      "audioEnabled",
      "audioBitrateKbps",
      "loadingScreenEnabled",
    ] as const) {
      bind(this.$[key], "change", () => saveConfiguration(this.$));
      bind(this.$[key], "input", () => saveConfiguration(this.$));
    }
    bind(this.$.startBuildButton, "click", () => void startBuild(this.$));
    bind(this.$.cancelBuildButton, "click", () => void Editor.Message.request<CreatorBuildTask>(PACKAGE_NAME, "cancel-build").then((task) => renderTask(this.$, task)));
    bind(this.$.previewButton, "click", () => void openPreview(this.$));
    bind(this.$.outputFolderButton, "click", () => void openOutputFolder(this.$));
    bind(this.$.importLogoButton, "click", () => void importLoadingLogo(this.$));
    bind(this.$.clearLogoButton, "click", () => void clearLoadingLogo(this.$));
    if (this.$.pngQuality.value.trim().length === 0) this.$.pngQuality.value = String(DEFAULT_IMAGE_QUALITY);
    if (this.$.jpegQuality.value.trim().length === 0) this.$.jpegQuality.value = String(DEFAULT_IMAGE_QUALITY);
    syncConfigurationState(this.$, false);
    void loadLoadingLogo(this.$);
    void refreshEnvironment(this.$).finally(() => {
      setLoadingProgress(this.$, 72, "正在读取构建任务…");
      void refreshTask(this.$).finally(() => {
        setLoadingProgress(this.$, 100, "加载完成");
        setTimeout(() => { this.$.loadingOverlay.hidden = true; }, 220);
      });
    });
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
