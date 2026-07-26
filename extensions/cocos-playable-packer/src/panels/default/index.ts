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

let refreshButton: HTMLButtonElement | null = null;
let refreshHandler: (() => void) | null = null;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`面板缺少元素：#${id}`);
  }
  return element as T;
}

function setText(id: string, value: string): void {
  requiredElement(id).textContent = value;
}

function setCheck(id: string, passed: boolean, passedText: string, failedText: string): void {
  const element = requiredElement(id);
  element.textContent = passed ? passedText : failedText;
  element.classList.toggle("status-ok", passed);
  element.classList.toggle("status-warning", !passed);
}

function renderEnvironment(info: CreatorEnvironmentInfo): void {
  setText("extensionVersion", info.extensionVersion);
  setText("projectName", info.project.name);
  setText("projectPath", info.project.path);
  setText("projectUuid", info.project.uuid);
  setText("nodeVersion", `${info.runtime.nodeVersion} · ${info.runtime.platform}/${info.runtime.architecture}`);
  setText("nodeExecutable", info.runtime.nodeExecutable);
  setText("extensionRoot", info.paths.extensionRoot);
  setText("realExtensionRoot", info.paths.realExtensionRoot);
  setText("packerRoot", info.paths.packerRoot ?? "未检测到");
  setText("webMobileDirectory", info.paths.webMobileDirectory);
  setText("defaultOutputDirectory", info.paths.defaultOutputDirectory);
  setText("checkedAt", new Date(info.checkedAt).toLocaleString());
  setText("logOutput", info.logs.length === 0 ? "暂无日志。" : info.logs.join("\n"));

  setCheck(
    "projectCheck",
    info.checks.projectDirectoryExists
      && info.checks.assetsDirectoryExists
      && info.checks.projectPackageExists,
    "项目结构正常",
    "项目结构不完整",
  );
  setCheck(
    "buildCheck",
    info.checks.webMobileDirectoryExists,
    "已找到 Web Mobile 构建",
    "尚未构建 Web Mobile",
  );
  setCheck(
    "packerCheck",
    info.checks.packerRootDetected && info.checks.coreSourceExists,
    "已连接 Packer Core",
    "未连接 Packer Core",
  );
}

async function refreshEnvironment(): Promise<void> {
  if (refreshButton !== null) {
    refreshButton.disabled = true;
    refreshButton.textContent = "检测中…";
  }
  setText("panelStatus", "正在读取 Creator 项目与运行环境…");

  try {
    const info = await Editor.Message.request<CreatorEnvironmentInfo>(
      PACKAGE_NAME,
      "query-environment",
    );
    renderEnvironment(info);
    setText("panelStatus", "环境检测完成。当前阶段只验证插件壳层，不会启动压缩任务。");
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    setText("panelStatus", `环境检测失败：${message}`);
    setText("logOutput", message);
  } finally {
    if (refreshButton !== null) {
      refreshButton.disabled = false;
      refreshButton.textContent = "重新检测";
    }
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
  $: {},
  methods: {},
  ready(): void {
    refreshButton = requiredElement<HTMLButtonElement>("refreshEnvironmentButton");
    refreshHandler = () => {
      void refreshEnvironment();
    };
    refreshButton.addEventListener("click", refreshHandler);
    void refreshEnvironment();
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
