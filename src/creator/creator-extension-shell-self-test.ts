import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();
const extensionRoot = path.join(
  repositoryRoot,
  "extensions",
  "cocos-playable-packer",
);

const packageJson = JSON.parse(
  await readFile(path.join(extensionRoot, "package.json"), "utf8"),
) as Record<string, unknown>;
const tsconfig = JSON.parse(
  await readFile(path.join(extensionRoot, "tsconfig.json"), "utf8"),
) as { compilerOptions?: Record<string, unknown> };
const editorTypes = await readFile(
  path.join(extensionRoot, "src", "editor.d.ts"),
  "utf8",
);
const sharedTypes = await readFile(
  path.join(extensionRoot, "src", "shared", "types.ts"),
  "utf8",
);
const mainSource = await readFile(path.join(extensionRoot, "src", "main.ts"), "utf8");
const panelSource = await readFile(
  path.join(extensionRoot, "src", "panels", "default", "index.ts"),
  "utf8",
);
const workerClientSource = await readFile(
  path.join(extensionRoot, "src", "services", "build-worker-client.ts"),
  "utf8",
);
const playableWorkerSource = await readFile(
  path.join(repositoryRoot, "src", "creator-worker", "playable-build-worker.ts"),
  "utf8",
);
const template = await readFile(
  path.join(extensionRoot, "static", "template", "default", "index.html"),
  "utf8",
);
const style = await readFile(
  path.join(extensionRoot, "static", "style", "default", "index.css"),
  "utf8",
);
const linkScript = await readFile(
  path.join(repositoryRoot, "scripts", "creator-extension-link.mjs"),
  "utf8",
);

assert.equal(packageJson.package_version, 2);
assert.equal(packageJson.name, "cocos-playable-packer");
assert.equal(packageJson.editor, ">=3.8.0 <3.9.0");
assert.equal(packageJson.main, "./dist/main.js");
assert.equal(packageJson.type, "commonjs");
assert.equal(tsconfig.compilerOptions?.module, "Node16");
assert.equal(tsconfig.compilerOptions?.moduleResolution, "Node16");

const panels = packageJson.panels as Record<string, Record<string, unknown>>;
assert.equal(panels.default?.main, "./dist/panels/default");
assert.equal(panels.default?.type, "dockable");
assert.deepEqual(panels.default?.size, {
  "min-width": 460,
  "min-height": 600,
  width: 720,
  height: 820,
});

const contributions = packageJson.contributions as Record<string, unknown>;
const menus = contributions.menu as Array<Record<string, unknown>>;
assert.equal(menus[0]?.path, "i18n:menu.extension/Cocos Playable Packer");
assert.equal(menus[0]?.message, "open-panel");
const messages = contributions.messages as Record<string, { methods?: string[] }>;
assert.deepEqual(messages["open-panel"]?.methods, ["openPanel"]);
assert.deepEqual(messages["query-environment"]?.methods, ["queryEnvironment"]);
assert.deepEqual(messages["start-build"]?.methods, ["startBuild"]);
assert.deepEqual(messages["query-build-task"]?.methods, ["queryBuildTask"]);
assert.deepEqual(messages["cancel-build"]?.methods, ["cancelBuild"]);

assert.match(editorTypes, /namespace Dialog/);
assert.match(editorTypes, /function select\(options\?: SelectDialogOptions\)/);
assert.match(editorTypes, /function save\(options\?: SelectDialogOptions\)/);
assert.match(sharedTypes, /pngQuality\?: number/);
assert.match(sharedTypes, /jpegQuality\?: number/);
assert.match(sharedTypes, /tinyPngApiKey\?: string/);
assert.match(mainSource, /Editor\.Project\.path/);
assert.match(mainSource, /build["'], ["']web-mobile/);
assert.match(mainSource, /PLAYABLE_PACKER_RUNTIME_ROOT/);
assert.match(mainSource, /path\.join\(realExtensionRoot, "runtime"\)/);
assert.match(mainSource, /dist", "creator-worker", "playable-build-worker\.js/);
assert.match(mainSource, /PLAYABLE_PACKER_NODE/);
assert.match(mainSource, /MINIMUM_EXTERNAL_NODE_MAJOR = 22/);
assert.match(mainSource, /DEFAULT_IMAGE_QUALITY = 80/);
assert.match(mainSource, /选择 TinyPNG 时必须填写 API Key/);
assert.match(mainSource, /where\.exe/);
assert.match(mainSource, /realpath\(extensionRoot\)/);
assert.match(mainSource, /startBuild/);
assert.match(mainSource, /queryBuildTask/);
assert.match(mainSource, /cancelBuild/);
assert.match(panelSource, /Editor\.Message\.request<CreatorEnvironmentInfo>/);
assert.match(panelSource, /Editor\.Dialog\.select/);
assert.match(panelSource, /Editor\.Dialog\.save/);
assert.match(panelSource, /type: "directory"/);
assert.match(panelSource, /extensions: \["html"\]/);
assert.match(panelSource, /const qualityEnabled = imageMode === "squoosh" \|\| imageMode === "webp"/);
assert.match(panelSource, /imageMode === "tinypng"/);
assert.match(panelSource, /elements\.qualitySettings\.hidden = !qualityEnabled/);
assert.match(panelSource, /elements\.tinyPngSettings\.hidden = !tinyPngEnabled/);
assert.match(panelSource, /pngQuality: qualityEnabled \? imageQuality/);
assert.match(panelSource, /jpegQuality: qualityEnabled \? imageQuality/);
assert.match(panelSource, /tinyPngApiKey/);
assert.match(panelSource, /externalNodeSupported/);
assert.match(panelSource, /query-environment/);
assert.match(panelSource, /query-build-task/);
assert.match(panelSource, /start-build/);
assert.match(panelSource, /cancel-build/);
assert.match(panelSource, /\$: selectors/);
assert.match(panelSource, /ready\(this: PanelContext\)/);
assert.match(panelSource, /this\.\$\.inputDirectoryBrowseButton/);
assert.match(panelSource, /this\.\$\.outputFileBrowseButton/);
assert.match(panelSource, /elements\.externalNodeErrorRow\.hidden = info\.runtime\.externalNodeError === null/);
assert.match(panelSource, /info\.runtime\.externalNodeError \?\? ""/);
assert.match(panelSource, /setInterval\(\(\) => void refreshTask\(this\.\$\), 750\)/);
assert.doesNotMatch(panelSource, /document\.getElementById/);
assert.match(workerClientSource, /pngQuality: configuration\.pngQuality \?\? 80/);
assert.match(workerClientSource, /jpegQuality: configuration\.jpegQuality \?\? 80/);
assert.match(workerClientSource, /configuration\.imageMode === "squoosh" \|\| configuration\.imageMode === "webp"/);
assert.match(workerClientSource, /TINYPNG_API_KEY: tinyPngApiKey/);
assert.match(workerClientSource, /env: workerEnvironment/);
const serializedRequestStart = workerClientSource.indexOf("await writeFile(requestFile");
const serializedRequestEnd = workerClientSource.indexOf("const child = spawn", serializedRequestStart);
assert.ok(serializedRequestStart >= 0 && serializedRequestEnd > serializedRequestStart);
assert.doesNotMatch(workerClientSource.slice(serializedRequestStart, serializedRequestEnd), /tinyPngApiKey|TINYPNG_API_KEY/);
assert.match(playableWorkerSource, /environment: \{[\s\S]*\.\.\.process\.env,[\s\S]*\.\.\.request\.environment/);
assert.match(template, /id="projectCheck"/);
assert.match(template, /id="buildCheck"/);
assert.match(template, /id="packerCheck"/);
assert.match(template, /id="nodeCheck"/);
assert.match(template, /id="externalNodeExecutable"/);
assert.match(template, /id="externalNodeErrorRow" hidden/);
assert.doesNotMatch(template, /id="externalNodeError">-/);
assert.match(template, /id="inputDirectoryBrowseButton"/);
assert.match(template, /id="outputFileBrowseButton"/);
assert.match(template, /id="qualitySettings"/);
assert.match(template, /id="pngQuality"[^>]*value="80"/);
assert.match(template, /id="jpegQuality"[^>]*value="80"/);
assert.match(template, /id="tinyPngSettings"[^>]*hidden/);
assert.match(template, /id="tinyPngApiKey"[^>]*type="password"/);
assert.match(template, /仅用于当前构建任务，不写入请求文件、日志或构建报告/);
assert.match(template, /id="startBuildButton" class="button button--primary action-button"/);
assert.match(template, /id="cancelBuildButton" class="button button--danger action-button"/);
assert.match(template, /id="taskLogOutput"/);
assert.match(template, /class="config-grid"/);
assert.match(template, /Squoosh（推荐）/);
assert.match(template, /WebP 在部分旧设备或渠道 WebView 中可能存在兼容性问题/);
assert.match(template, /推荐配置默认关闭/);
assert.match(template, /关闭面板不会终止正在运行的任务/);
assert.match(style, /:host\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/);
assert.match(style, /\.shell\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/);
assert.match(style, /\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;/);
assert.match(style, /scrollbar-gutter:\s*stable/);
assert.match(style, /\.shell::-webkit-scrollbar/);
assert.match(style, /overflow-wrap:\s*anywhere/);
assert.match(style, /\.status-grid/);
assert.match(style, /\.config-grid/);
assert.match(style, /\.path-picker/);
assert.match(style, /\.button--primary/);
assert.match(style, /\.button--danger/);
assert.match(linkScript, /process\.platform === "win32" \? "junction" : "dir"/);
assert.ok(
  linkScript.includes(
    'const GIT_EXCLUDE_MARKER = "# cocos-playable-packer managed Creator extension link";',
  ),
);
assert.ok(
  linkScript.includes(
    'const GIT_EXCLUDE_PATTERN = "/extensions/cocos-playable-packer";',
  ),
);
assert.ok(linkScript.includes("async function localGitExcludeFile"));
assert.ok(linkScript.includes('path.join(gitDirectory, "info", "exclude")'));
assert.match(linkScript, /普通目录，拒绝覆盖/);
assert.match(linkScript, /普通目录，拒绝删除/);

console.log("Creator extension shell self-test passed.");
