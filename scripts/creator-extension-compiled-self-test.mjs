import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptFile), "..");
const extensionRoot = path.join(
  repositoryRoot,
  "extensions",
  "cocos-playable-packer",
);
const require = createRequire(import.meta.url);
const expectedExtensionVersion = JSON.parse(
  await readFile(path.join(extensionRoot, "package.json"), "utf8"),
).version;
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "creator-extension-compiled-"));

function createPanelElement() {
  const classes = new Set();
  const listeners = new Map();
  return {
    textContent: "",
    innerHTML: "",
    src: "",
    disabled: false,
    hidden: false,
    style: {},
    value: "",
    checked: false,
    classList: {
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(type, listener) {
      const values = listeners.get(type) ?? new Set();
      values.add(listener);
      listeners.set(type, values);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
}

function idleTask(projectRoot) {
  return {
    id: null,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    inputDirectory: path.join(projectRoot, "build", "web-mobile"),
    outputFile: path.join(projectRoot, "build", "playable", "game.html"),
    reportFile: null,
    stage: null,
    progress: null,
    error: null,
    logs: [],
  };
}

try {
  const projectRoot = path.join(temporaryRoot, "game143");
  const projectTmpDir = path.join(temporaryRoot, "creator-temp");
  await mkdir(path.join(projectRoot, "assets"), { recursive: true });
  await mkdir(path.join(projectRoot, "build", "web-mobile"), { recursive: true });
  await mkdir(projectTmpDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    `${JSON.stringify({ name: "game143", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );

  const openedPanels = [];
  let panelDefinition = null;
  globalThis.Editor = {
    Project: {
      name: "game143",
      path: projectRoot,
      tmpDir: projectTmpDir,
      uuid: "game143-test-uuid",
    },
    Panel: {
      async open(name) {
        openedPanels.push(name);
      },
      define(definition) {
        panelDefinition = definition;
        return definition;
      },
    },
    Message: {
      async request() {
        throw new Error("panel message handler has not been installed");
      },
    },
  };

  const mainModulePath = path.join(extensionRoot, "dist", "main.js");
  delete require.cache[require.resolve(mainModulePath)];
  const mainModule = require(mainModulePath);
  assert.equal(typeof mainModule.load, "function");
  assert.equal(typeof mainModule.unload, "function");
  assert.equal(typeof mainModule.methods?.openPanel, "function");
  assert.equal(typeof mainModule.methods?.queryEnvironment, "function");
  assert.equal(typeof mainModule.methods?.queryBuildTask, "function");
  assert.equal(typeof mainModule.methods?.startBuild, "function");
assert.equal(typeof mainModule.methods?.cancelBuild, "function");
assert.equal(typeof mainModule.methods?.openPreview, "function");
assert.equal(typeof mainModule.methods?.openOutputFolder, "function");
assert.equal(typeof mainModule.methods?.readBuildReport, "function");
assert.equal(typeof mainModule.methods?.queryLoadingLogo, "function");
assert.equal(typeof mainModule.methods?.saveLoadingLogo, "function");
assert.equal(typeof mainModule.methods?.clearLoadingLogo, "function");
assert.equal(typeof mainModule.methods?.clearAllCaches, "function");

  mainModule.load();
  await mainModule.methods.openPanel();
  assert.deepEqual(openedPanels, ["cocos-playable-packer"]);

  const environment = await mainModule.methods.queryEnvironment();
  assert.equal(environment.extensionVersion, expectedExtensionVersion);
  assert.equal(environment.project.name, "game143");
  assert.equal(environment.project.path, path.resolve(projectRoot));
  assert.equal(environment.project.tmpDir, projectTmpDir);
  assert.equal(environment.project.uuid, "game143-test-uuid");
  assert.equal(environment.runtime.hostNodeVersion, process.version);
  assert.equal(environment.runtime.hostExecutable, process.execPath);
  assert.equal(environment.runtime.externalNodeAvailable, true);
  assert.equal(environment.runtime.externalNodeSupported, true);
  assert.match(environment.runtime.externalNodeVersion, /^v?\d+/);
  assert.equal(typeof environment.runtime.externalNodeExecutable, "string");
  assert.equal(environment.runtime.externalNodeError, null);
  assert.equal(environment.checks.projectDirectoryExists, true);
  assert.equal(environment.checks.assetsDirectoryExists, true);
  assert.equal(environment.checks.projectPackageExists, true);
  assert.equal(environment.checks.webMobileDirectoryExists, true);
  assert.equal(environment.checks.packerRootDetected, true);
  assert.equal(environment.checks.coreSourceExists, true);
  assert.equal(environment.paths.packerRoot, path.join(extensionRoot, "runtime"));
  assert.equal(
    environment.paths.webMobileDirectory,
    path.join(projectRoot, "build", "web-mobile"),
  );
  assert.ok(environment.logs.some((line) => line.includes("已找到外部 Node.js")));
  assert.ok(environment.logs.some((line) => line.includes("已找到 Web Mobile 构建目录")));

  let panelEnvironment = environment;
  let panelTask = idleTask(projectRoot);
  const requestedMessages = [];
  globalThis.Editor.Message.request = async (packageName, message, configuration) => {
    assert.equal(packageName, "cocos-playable-packer");
    requestedMessages.push(message);
    switch (message) {
      case "query-environment":
        return panelEnvironment;
      case "query-build-task":
        return panelTask;
      case "query-loading-logo":
        return {
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          filePath: path.join(extensionRoot, "static", "assets", "loading-logo.png"),
          bytes: 8,
          mimeType: "image/png",
        };
      case "read-build-report":
        return {};
      case "clear-loading-logo":
        return undefined;
      case "start-build":
        assert.equal(configuration.inputDirectory, path.join(projectRoot, "build", "web-mobile"));
        assert.equal(configuration.outputFile, path.join(projectRoot, "build", "playable", "game.html"));
        assert.equal(configuration.imageMode, "squoosh");
        assert.equal(configuration.payloadEncoding, "html7");
        assert.equal(configuration.loadingScreenEnabled, true);
        panelTask = {
          ...panelTask,
          id: "creator-task-test",
          status: "running",
          startedAt: new Date().toISOString(),
          stage: "running",
          logs: ["Worker 已启动"],
        };
        return panelTask;
      case "cancel-build":
        panelTask = {
          ...panelTask,
          status: "cancelled",
          finishedAt: new Date().toISOString(),
          stage: "cancelled",
          logs: [...panelTask.logs, "任务已取消"],
        };
        return panelTask;
      default:
        throw new Error(`unexpected panel message: ${message}`);
    }
  };

  const panelModulePath = path.join(
    extensionRoot,
    "dist",
    "panels",
    "default",
    "index.js",
  );
  delete require.cache[require.resolve(panelModulePath)];
  const returnedDefinition = require(panelModulePath);
  assert.equal(returnedDefinition, panelDefinition);
  assert.equal(typeof panelDefinition?.ready, "function");
  assert.equal(typeof panelDefinition?.close, "function");
  assert.match(panelDefinition?.template ?? "", /Cocos Playable Packer/);
  assert.match(panelDefinition?.template ?? "", /id="refreshEnvironmentButton"/);
  assert.match(panelDefinition?.template ?? "", /id="startBuildButton"/);
  assert.match(panelDefinition?.template ?? "", /id="cancelBuildButton"/);
  assert.match(panelDefinition?.template ?? "", /id="previewButton"/);
  assert.match(panelDefinition?.template ?? "", /id="outputFolderButton"/);
  assert.match(panelDefinition?.template ?? "", /id="taskStatus"/);
  assert.match(panelDefinition?.template ?? "", /id="nodeCheck"/);
  assert.match(panelDefinition?.template ?? "", /id="externalNodeErrorRow" hidden/);
  assert.match(panelDefinition?.style ?? "", /\.status-grid/);
  assert.equal(panelDefinition?.$.refreshEnvironmentButton, "#refreshEnvironmentButton");
  assert.equal(panelDefinition?.$.startBuildButton, "#startBuildButton");
  assert.equal(panelDefinition?.$.cancelBuildButton, "#cancelBuildButton");
  assert.equal(panelDefinition?.$.previewButton, "#previewButton");
  assert.equal(panelDefinition?.$.outputFolderButton, "#outputFolderButton");
  assert.equal(panelDefinition?.$.panelStatus, "#panelStatus");
  assert.equal(panelDefinition?.$.projectCheck, "#projectCheck");
  assert.equal(panelDefinition?.$.nodeCheck, "#nodeCheck");
  assert.equal(panelDefinition?.$.externalNodeErrorRow, "#externalNodeErrorRow");
  assert.equal(panelDefinition?.$.clearAllCachesButton, "#clearAllCachesButton");

  const panelElements = Object.fromEntries(
    Object.keys(panelDefinition.$).map((key) => [key, createPanelElement()]),
  );
  panelElements.imageMode.value = "squoosh";
  panelElements.payloadEncoding.value = "html7";
  panelElements.audioBitrateKbps.value = "48";
  panelElements.loadingScreenEnabled.checked = true;

  panelDefinition.ready.call({ $: panelElements });
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(requestedMessages.includes("query-environment"));
  assert.ok(requestedMessages.includes("query-build-task"));
  assert.equal(panelElements.refreshEnvironmentButton.listenerCount("click"), 1);
  assert.equal(panelElements.startBuildButton.listenerCount("click"), 1);
  assert.equal(panelElements.cancelBuildButton.listenerCount("click"), 1);
  assert.equal(panelElements.refreshEnvironmentButton.disabled, false);
  assert.equal(panelElements.projectName.textContent, "game143");
  assert.equal(panelElements.projectUuid.textContent, "game143-test-uuid");
  assert.equal(panelElements.projectCheck.textContent, "项目结构正常");
  assert.equal(panelElements.buildCheck.textContent, "已找到 Web Mobile 构建");
  assert.equal(panelElements.packerCheck.textContent, "已连接 Packer Core");
  assert.equal(panelElements.nodeCheck.textContent, "外部 Node.js 22+ 可用");
  assert.equal(panelElements.projectCheck.classList.contains("status-ok"), true);
  assert.equal(panelElements.nodeCheck.classList.contains("status-ok"), true);
  assert.equal(panelElements.externalNodeErrorRow.hidden, true);
  assert.equal(panelElements.externalNodeError.textContent, "");
  assert.equal(panelElements.inputDirectory.value, path.join(projectRoot, "build", "web-mobile"));
  assert.equal(panelElements.outputFile.value, path.join(projectRoot, "build", "playable", "game.html"));
  assert.equal(panelElements.taskStatus.textContent, "等待构建");
  assert.equal(panelElements.startBuildButton.disabled, false);
  assert.equal(panelElements.cancelBuildButton.disabled, true);
  assert.equal(panelElements.previewButton.disabled, true);
  assert.equal(panelElements.outputFolderButton.disabled, true);
  assert.equal(panelElements.loadingLogoPreview.hidden, false);
  assert.equal(panelElements.loadingLogoPreviewImage.src, "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(panelElements.loadingLogoPreviewMeta.textContent, "image/png · 8 B");

  panelElements.clearLogoButton.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(requestedMessages.includes("clear-loading-logo"));
  assert.equal(panelElements.loadingLogoPreview.hidden, true);
  assert.equal(panelElements.loadingLogoPreviewImage.src, "");

  panelElements.startBuildButton.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(requestedMessages.includes("start-build"));
  assert.equal(panelElements.taskStatus.textContent, "running · running");
  assert.equal(panelElements.startBuildButton.disabled, true);
  assert.equal(panelElements.cancelBuildButton.disabled, false);
  assert.equal(panelElements.inputDirectory.disabled, true);
  assert.match(panelElements.taskLogOutput.textContent, /Worker 已启动/);

  panelElements.cancelBuildButton.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(requestedMessages.includes("cancel-build"));
  assert.equal(panelElements.taskStatus.textContent, "cancelled · cancelled");
  assert.equal(panelElements.startBuildButton.disabled, false);
  assert.equal(panelElements.cancelBuildButton.disabled, true);
  assert.equal(panelElements.previewButton.disabled, true);
  assert.equal(panelElements.outputFolderButton.disabled, true);
  assert.match(panelElements.taskLogOutput.textContent, /任务已取消/);

  panelEnvironment = {
    ...environment,
    runtime: {
      ...environment.runtime,
      externalNodeAvailable: false,
      externalNodeSupported: false,
      externalNodeVersion: null,
      externalNodeExecutable: null,
      externalNodeError: "where.exe node 执行失败",
    },
  };
  panelElements.refreshEnvironmentButton.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(panelElements.nodeCheck.textContent, "未找到外部 Node.js");
  assert.equal(panelElements.externalNodeErrorRow.hidden, false);
  assert.equal(panelElements.externalNodeError.textContent, "where.exe node 执行失败");

  panelDefinition.close();
  assert.equal(panelElements.refreshEnvironmentButton.listenerCount("click"), 0);
  assert.equal(panelElements.startBuildButton.listenerCount("click"), 0);
  assert.equal(panelElements.cancelBuildButton.listenerCount("click"), 0);
  mainModule.unload();
} finally {
  delete globalThis.Editor;
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Compiled Creator extension module self-test passed.");
