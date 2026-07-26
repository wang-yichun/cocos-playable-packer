import { readFileSync } from "node:fs";
import path from "node:path";

import type { CreatorEnvironmentInfo } from "../../shared/types.js";

const PACKAGE_NAME = "cocos-playable-packer";
const template = readFileSync(
  path.join(__dirname, "../../../static/template/default/index.html"),
  "utf8",
);
const style = readFileSync(
  path.join(__dirname, "../../../static/style/default/index.css"),
  "utf8",
);

interface PanelElements {
  refreshEnvironmentButton: HTMLButtonElement;
  panelStatus: HTMLElement;
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

interface PanelContext {
  $: PanelElements;
}

const selectors: Record<keyof PanelElements, string> = {
  refreshEnvironmentButton: "#refreshEnvironmentButton",
  panelStatus: "#panelStatus",
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

let refreshButton: HTMLButtonElement | null = null;
let refreshHandler: (() => void) | null = null;

function requireMappedElement<K extends keyof PanelElements>(
  elements: PanelElements,
  key: K,
): PanelElements[K] {
  const element = (elements as Partial<PanelElements>)[key];
  if (element === undefined || element === null) {
    throw new Error(`面板缺少映射元素：${key} (${selectors[key]})`);
  }
  return element as PanelElements[K];
}

function setText<K extends keyof PanelElements>(
  elements: PanelElements,
  key: K,
  value: string,
): void {
  requireMappedElement(elements, key).textContent = value;
}

function setCheck(
  elements: PanelElements,
  key: "projectCheck" | "buildCheck" | "packerCheck" | "nodeCheck",
  passed: boolean,
  passedText: string,
  failedText: string,
): void {
  const element = requireMappedElement(elements, key);
  element.textContent = passed ? passedText : failedText;
  element.classList.toggle("status-ok", passed);
  element.classList.toggle("status-warning", !passed);
}

function renderEnvironment(elements: PanelElements, info: CreatorEnvironmentInfo): void {
  setText(elements, "extensionVersion", info.extensionVersion);
  setText(elements, "projectName", info.project.name);
  setText(elements, "projectPath", info.project.path);
  setText(elements, "projectUuid", info.project.uuid);
  setText(
    elements,
    "hostNodeVersion",
    `${info.runtime.hostNodeVersion} · ${info.runtime.platform}/${info.runtime.architecture}`,
  );
  setText(elements, "hostExecutable", info.runtime.hostExecutable);
  setText(elements, "externalNodeVersion", info.runtime.externalNodeVersion ?? "未检测到");
  setText(elements, "externalNodeExecutable", info.runtime.externalNodeExecutable ?? "未检测到");

  const externalNodeError = info.runtime.externalNodeError;
  const externalNodeErrorRow = requireMappedElement(elements, "externalNodeErrorRow");
  externalNodeErrorRow.hidden = externalNodeError === null;
  setText(elements, "externalNodeError", externalNodeError ?? "");

  setText(elements, "extensionRoot", info.paths.extensionRoot);
  setText(elements, "realExtensionRoot", info.paths.realExtensionRoot);
  setText(elements, "packerRoot", info.paths.packerRoot ?? "未检测到");
  setText(elements, "webMobileDirectory", info.paths.webMobileDirectory);
  setText(elements, "defaultOutputDirectory", info.paths.defaultOutputDirectory);
  setText(elements, "checkedAt", new Date(info.checkedAt).toLocaleString());
  setText(elements, "logOutput", info.logs.length === 0 ? "暂无日志。" : info.logs.join("\n"));

  setCheck(
    elements,
    "projectCheck",
    info.checks.projectDirectoryExists
      && info.checks.assetsDirectoryExists
      && info.checks.projectPackageExists,
    "项目结构正常",
    "项目结构不完整",
  );
  setCheck(
    elements,
    "buildCheck",
    info.checks.webMobileDirectoryExists,
    "已找到 Web Mobile 构建",
    "尚未构建 Web Mobile",
  );
  setCheck(
    elements,
    "packerCheck",
    info.checks.packerRootDetected && info.checks.coreSourceExists,
    "已连接 Packer Core",
    "未连接 Packer Core",
  );
  setCheck(
    elements,
    "nodeCheck",
    info.runtime.externalNodeSupported,
    "外部 Node.js 22+ 可用",
    info.runtime.externalNodeAvailable ? "外部 Node.js 版本过低" : "未找到外部 Node.js",
  );
}

async function refreshEnvironment(elements: PanelElements): Promise<void> {
  const button = requireMappedElement(elements, "refreshEnvironmentButton");
  button.disabled = true;
  button.textContent = "检测中…";
  setText(elements, "panelStatus", "正在读取 Creator 项目与运行环境…");

  try {
    const info = await Editor.Message.request<CreatorEnvironmentInfo>(
      PACKAGE_NAME,
      "query-environment",
    );
    renderEnvironment(elements, info);
    setText(elements, "panelStatus", "环境检测完成。当前阶段只验证插件壳层，不会启动压缩任务。");
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    setText(elements, "panelStatus", `环境检测失败：${message}`);
    setText(elements, "logOutput", message);
  } finally {
    button.disabled = false;
    button.textContent = "重新检测";
  }
}

module.exports = Editor.Panel.define({
  listeners: {
    show(): void {
      console.log(`[${PACKAGE_NAME}] panel shown`);
    },
    hide(): void {
      console.log(`[${PACKAGE_NAME}] panel hidden`);
    },
  },
  template,
  style,
  $: selectors,
  methods: {},
  ready(this: PanelContext): void {
    for (const key of Object.keys(selectors) as Array<keyof PanelElements>) {
      requireMappedElement(this.$, key);
    }

    refreshButton = this.$.refreshEnvironmentButton;
    refreshHandler = () => {
      void refreshEnvironment(this.$);
    };
    refreshButton.addEventListener("click", refreshHandler);
    void refreshEnvironment(this.$);
  },
  beforeClose(): void {},
  close(): void {
    if (refreshButton !== null && refreshHandler !== null) {
      refreshButton.removeEventListener("click", refreshHandler);
    }
    refreshButton = null;
    refreshHandler = null;
  },
});
