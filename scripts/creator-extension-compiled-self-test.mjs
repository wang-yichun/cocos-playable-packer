import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "creator-extension-compiled-"));

function createPanelElement() {
  const classes = new Set();
  const listeners = new Map();
  return {
    textContent: "",
    disabled: false,
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

  mainModule.load();
  await mainModule.methods.openPanel();
  assert.deepEqual(openedPanels, ["cocos-playable-packer"]);

  const environment = await mainModule.methods.queryEnvironment();
  assert.equal(environment.extensionVersion, "0.1.0");
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
  assert.equal(environment.paths.packerRoot, repositoryRoot);
  assert.equal(
    environment.paths.webMobileDirectory,
    path.join(projectRoot, "build", "web-mobile"),
  );
  assert.ok(environment.logs.some((line) => line.includes("已找到外部 Node.js")));
  assert.ok(environment.logs.some((line) => line.includes("已找到 Web Mobile 构建目录")));

  globalThis.Editor.Message.request = async (packageName, message) => {
    assert.equal(packageName, "cocos-playable-packer");
    assert.equal(message, "query-environment");
    return environment;
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
  assert.match(panelDefinition?.template ?? "", /id="nodeCheck"/);
  assert.match(panelDefinition?.style ?? "", /\.status-grid/);
  assert.equal(panelDefinition?.$.refreshEnvironmentButton, "#refreshEnvironmentButton");
  assert.equal(panelDefinition?.$.panelStatus, "#panelStatus");
  assert.equal(panelDefinition?.$.projectCheck, "#projectCheck");
  assert.equal(panelDefinition?.$.nodeCheck, "#nodeCheck");

  const panelElements = Object.fromEntries(
    Object.keys(panelDefinition.$).map((key) => [key, createPanelElement()]),
  );
  panelDefinition.ready.call({ $: panelElements });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(panelElements.refreshEnvironmentButton.listenerCount("click"), 1);
  assert.equal(panelElements.refreshEnvironmentButton.disabled, false);
  assert.equal(panelElements.refreshEnvironmentButton.textContent, "重新检测");
  assert.equal(
    panelElements.panelStatus.textContent,
    "环境检测完成。当前阶段只验证插件壳层，不会启动压缩任务。",
  );
  assert.equal(panelElements.projectName.textContent, "game143");
  assert.equal(panelElements.projectUuid.textContent, "game143-test-uuid");
  assert.equal(panelElements.projectCheck.textContent, "项目结构正常");
  assert.equal(panelElements.buildCheck.textContent, "已找到 Web Mobile 构建");
  assert.equal(panelElements.packerCheck.textContent, "已连接 Packer Core");
  assert.equal(panelElements.nodeCheck.textContent, "外部 Node.js 22+ 可用");
  assert.equal(panelElements.projectCheck.classList.contains("status-ok"), true);
  assert.equal(panelElements.nodeCheck.classList.contains("status-ok"), true);

  panelDefinition.close();
  assert.equal(panelElements.refreshEnvironmentButton.listenerCount("click"), 0);
  mainModule.unload();
} finally {
  delete globalThis.Editor;
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Compiled Creator extension module self-test passed.");
