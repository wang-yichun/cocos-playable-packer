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
const mainSource = await readFile(path.join(extensionRoot, "src", "main.ts"), "utf8");
const panelSource = await readFile(
  path.join(extensionRoot, "src", "panels", "default", "index.ts"),
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

const contributions = packageJson.contributions as Record<string, unknown>;
const menus = contributions.menu as Array<Record<string, unknown>>;
assert.equal(menus[0]?.path, "i18n:menu.develop/Cocos Playable Packer");
assert.equal(menus[0]?.message, "open-panel");
const messages = contributions.messages as Record<string, { methods?: string[] }>;
assert.deepEqual(messages["open-panel"]?.methods, ["openPanel"]);
assert.deepEqual(messages["query-environment"]?.methods, ["queryEnvironment"]);

assert.match(mainSource, /Editor\.Project\.path/);
assert.match(mainSource, /build["'], ["']web-mobile/);
assert.match(mainSource, /PLAYABLE_PACKER_ROOT/);
assert.match(mainSource, /PLAYABLE_PACKER_NODE/);
assert.match(mainSource, /MINIMUM_EXTERNAL_NODE_MAJOR = 22/);
assert.match(mainSource, /where\.exe/);
assert.match(mainSource, /realpath\(extensionRoot\)/);
assert.match(panelSource, /Editor\.Message\.request<CreatorEnvironmentInfo>/);
assert.match(panelSource, /externalNodeSupported/);
assert.match(panelSource, /query-environment/);
assert.match(template, /id="projectCheck"/);
assert.match(template, /id="buildCheck"/);
assert.match(template, /id="packerCheck"/);
assert.match(template, /id="nodeCheck"/);
assert.match(template, /id="externalNodeExecutable"/);
assert.match(template, /当前阶段只验证插件加载/);
assert.match(style, /\.status-grid/);
assert.match(linkScript, /process\.platform === "win32" \? "junction" : "dir"/);
assert.match(linkScript, /\.git["'], ["']info["'], ["']exclude/);
assert.match(linkScript, /\/extensions\/cocos-playable-packer/);
assert.match(linkScript, /普通目录，拒绝覆盖/);
assert.match(linkScript, /普通目录，拒绝删除/);

console.log("Creator extension shell self-test passed.");
