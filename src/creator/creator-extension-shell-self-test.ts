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
const shortcuts = contributions.shortcuts as Array<Record<string, unknown>>;
assert.equal(shortcuts[0]?.message, "open-panel");
assert.equal(shortcuts[0]?.win, "alt+f3");
assert.equal(shortcuts[0]?.mac, "cmd+f3");
const messages = contributions.messages as Record<string, { methods?: string[] }>;
assert.deepEqual(messages["open-panel"]?.methods, ["openPanel"]);
assert.deepEqual(messages["query-environment"]?.methods, ["queryEnvironment"]);
assert.deepEqual(messages["start-build"]?.methods, ["startBuild"]);
assert.deepEqual(messages["query-build-task"]?.methods, ["queryBuildTask"]);
assert.deepEqual(messages["cancel-build"]?.methods, ["cancelBuild"]);
assert.deepEqual(messages["open-preview"]?.methods, ["openPreview"]);
assert.deepEqual(messages["open-output-folder"]?.methods, ["openOutputFolder"]);
assert.deepEqual(messages["read-build-report"]?.methods, ["readBuildReport"]);
assert.deepEqual(messages["query-loading-logo"]?.methods, ["queryLoadingLogo"]);
assert.deepEqual(messages["save-loading-logo"]?.methods, ["saveLoadingLogo"]);
assert.deepEqual(messages["clear-loading-logo"]?.methods, ["clearLoadingLogo"]);
assert.match(mainSource, /electronShell\.showItemInFolder\(target\)/);

assert.match(editorTypes, /namespace Dialog/);
assert.match(editorTypes, /function select\(options\?: SelectDialogOptions\)/);
assert.match(editorTypes, /function save\(options\?: SelectDialogOptions\)/);
assert.match(sharedTypes, /pngQuality\?: number/);
assert.match(sharedTypes, /jpegQuality\?: number/);
assert.match(sharedTypes, /tinyPngApiKey\?: string/);
assert.match(sharedTypes, /loadingScreenEnabled: boolean/);
assert.match(sharedTypes, /type CreatorChannel = "Facebook" \| "Google" \| "AppLovin"/);
assert.match(sharedTypes, /type CreatorFacebookArtifactFormat = "single-html" \| "zip"/);
assert.match(sharedTypes, /type CreatorGoogleOrientation = "portrait" \| "landscape" \| "portrait,landscape"/);
assert.match(sharedTypes, /type CreatorGoogleArtifactFormat = "single-html" \| "zip"/);
assert.match(mainSource, /Editor\.Project\.path/);
assert.match(mainSource, /build["'], ["']web-mobile/);
assert.match(mainSource, /PLAYABLE_PACKER_RUNTIME_ROOT/);
assert.match(mainSource, /path\.join\(realExtensionRoot, "runtime"\)/);
assert.match(mainSource, /dist", "creator-worker", "playable-build-worker\.js/);
assert.match(mainSource, /PLAYABLE_PACKER_NODE/);
assert.match(mainSource, /MINIMUM_EXTERNAL_NODE_MAJOR = 22/);
assert.match(mainSource, /DEFAULT_IMAGE_QUALITY = 80/);
assert.match(mainSource, /Meta \/ Facebook 产物格式只支持单 HTML 或 ZIP/);
assert.match(mainSource, /选择 TinyPNG 时必须填写 API Key/);
assert.match(mainSource, /where\.exe/);
assert.match(mainSource, /realpath\(extensionRoot\)/);
assert.match(mainSource, /startBuild/);
assert.match(mainSource, /queryBuildTask/);
assert.match(mainSource, /cancelBuild/);
assert.match(mainSource, /readBuildReport/);
assert.match(mainSource, /queryLoadingLogo/);
assert.match(mainSource, /saveLoadingLogo/);
assert.match(mainSource, /clearLoadingLogo/);
assert.match(mainSource, /clearAllCaches/);
assert.match(mainSource, /Editor\.Project\.tmpDir, PACKAGE_NAME/);
assert.match(mainSource, /static\/assets/);
assert.match(mainSource, /loadingLogoDataUrl: loadingLogo\.dataUrl/);
assert.match(panelSource, /Editor\.Message\.request<CreatorEnvironmentInfo>/);
assert.match(panelSource, /Editor\.Dialog\.select/);
assert.match(panelSource, /Editor\.Dialog\.save/);
assert.match(panelSource, /type: "directory"/);
assert.match(panelSource, /extensions: \["html"\]/);
assert.match(panelSource, /const qualityEnabled = imageMode === "squoosh" \|\| imageMode === "webp"/);
assert.match(panelSource, /imageMode === "tinypng"/);
assert.match(panelSource, /elements\.qualitySettings\.hidden = !qualityEnabled/);
assert.match(panelSource, /elements\.tinyPngSettings\.hidden = !tinyPngEnabled/);
assert.match(panelSource, /window\.localStorage\.setItem/);
assert.match(panelSource, /window\.localStorage\.getItem/);
assert.match(panelSource, /restoreConfiguration\(this\.\$\)/);
assert.match(panelSource, /pngQuality: qualityEnabled \? imageQuality/);
assert.match(panelSource, /jpegQuality: qualityEnabled \? imageQuality/);
assert.match(panelSource, /tinyPngApiKey/);
assert.match(panelSource, /externalNodeSupported/);
assert.match(panelSource, /query-environment/);
assert.match(panelSource, /query-build-task/);
assert.match(panelSource, /start-build/);
assert.match(panelSource, /cancel-build/);
assert.match(panelSource, /open-preview/);
assert.match(panelSource, /open-output-folder/);
assert.match(panelSource, /read-build-report/);
assert.match(panelSource, /query-loading-logo/);
assert.match(panelSource, /save-loading-logo/);
assert.match(panelSource, /clear-loading-logo/);
assert.match(panelSource, /clear-all-caches/);
assert.match(panelSource, /清理全部缓存并恢复默认配置/);
assert.match(panelSource, /window\.confirm/);
assert.match(panelSource, /restoreDefaultConfiguration/);
assert.match(panelSource, /loadingScreenEnabled: elements\.loadingScreenEnabled\.checked/);
assert.match(panelSource, /elements\.googleChannelEnabled\.checked \? \["Google" as const\] : \[\]/);
assert.match(panelSource, /elements\.appLovinChannelEnabled\.checked \? \["AppLovin" as const\] : \[\]/);
assert.match(panelSource, /bind\(this\.\$\.appLovinChannelEnabled, "change", \(\) => syncConfigurationState/);
assert.match(panelSource, /androidStoreUrl: elements\.androidStoreUrl\.value\.trim\(\) \|\| null/);
assert.match(panelSource, /DEFAULT_ANDROID_STORE_URL/);
assert.match(panelSource, /facebookArtifactFormat: elements\.facebookArtifactFormat\.value/);
assert.match(panelSource, /googleOrientation: elements\.googleOrientation\.value/);
assert.match(panelSource, /googleArtifactFormat: elements\.googleArtifactFormat\.value/);
assert.match(panelSource, /renderLoadingLogoPreview/);
assert.match(panelSource, /renderBuildReport/);
assert.match(panelSource, /loadingProgressFill/);
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
assert.match(workerClientSource, /loadingScreen: \{[\s\S]*enabled: configuration\.loadingScreenEnabled/);
assert.match(workerClientSource, /facebookArtifactFormat: configuration\.facebookArtifactFormat/);
assert.match(workerClientSource, /googleOrientation: configuration\.googleOrientation/);
assert.match(workerClientSource, /googleArtifactFormat: configuration\.googleArtifactFormat/);
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
assert.match(template, /id="facebookChannelEnabled"/);
assert.match(template, /id="facebookArtifactFormat"/);
assert.match(template, /id="googleChannelEnabled"/);
assert.match(template, /id="googleOrientation"/);
assert.match(template, /id="googleArtifactFormat"/);
assert.match(template, /id="appLovinChannelEnabled"/);
assert.match(template, /https:\/\/p\.applov\.in\/playablePreview\?create=1/);
assert.match(template, /id="androidStoreUrl"/);
assert.match(template, /id="iosStoreUrl"/);
assert.match(template, /id="defaultStoreUrlsWarning"/);
const panelStyle = await readFile("extensions/cocos-playable-packer/static/style/default/index.css", "utf8");
assert.match(panelStyle, /\.channel-option-actions\s*\{[\s\S]*?justify-items:\s*end/);
assert.doesNotMatch(template, /id="facebookChannelEnabled"[^>]*\bchecked\b/);
assert.doesNotMatch(template, /id="googleChannelEnabled"[^>]*\bchecked\b/);
assert.doesNotMatch(template, /id="appLovinChannelEnabled"[^>]*\bchecked\b/);
assert.match(template, /<option value="zip" selected>ZIP（facebook-playable\.zip）<\/option>/);
assert.match(template, /<option value="zip" selected>ZIP（google-playable\.zip）<\/option>/);
assert.match(template, /id="facebookChannelDetails"[^>]*hidden/);
assert.match(template, /id="googleChannelDetails"[^>]*hidden/);
assert.match(template, /href="https:\/\/ads\.google\.com\/home\/"/);
assert.match(template, /value="single-html"/);
assert.match(template, /value="zip"/);
assert.match(template, /仅用于当前构建任务，不写入请求文件、日志或构建报告/);
assert.match(template, /id="startBuildButton" class="button button--primary action-button"/);
assert.match(template, /id="cancelBuildButton" class="button button--danger action-button"/);
assert.match(template, /id="previewButton" class="button button--ghost action-button"/);
assert.match(template, /id="outputFolderButton" class="button button--ghost action-button"/);
assert.doesNotMatch(template, /id="reportButton"/);
assert.match(template, /id="importLogoButton"/);
assert.match(template, /id="clearLogoButton"/);
assert.match(template, /id="loadingScreenEnabled"/);
assert.match(template, /id="loadingScreenEnabled"[^>]*checked/);
assert.match(template, /id="loadingLogoPreview"/);
assert.match(template, /id="loadingLogoPreviewImage"/);
assert.match(template, /config-index">05/);
assert.match(template, /id="loadingOverlay"/);
assert.match(template, /id="loadingProgressFill"/);
assert.match(template, /id="reportSection"/);
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
assert.match(style, /\.config-card--summary\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
assert.match(style, /\.path-picker/);
assert.match(style, /\.button--primary/);
assert.match(style, /\.button--danger/);
assert.match(style, /\.loading-logo-preview/);
console.log("Creator extension shell self-test passed.");
