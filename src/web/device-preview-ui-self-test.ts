import assert from "node:assert/strict";
import { Script } from "node:vm";

import { createOverviewResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-overview-ui.js";

const html = createOverviewResourceAnalysisWebMvpIndexHtml();

assert.match(html, /id="devicePreviewButton"[^>]*>模拟真机预览</);
assert.match(html, /id="devicePreviewDialog"/);
assert.match(html, /iPhone SE/);
assert.match(html, /iPhone 15/);
assert.match(html, /Pixel 8/);
assert.match(html, /Galaxy S24/);
assert.match(html, /iPad mini/);
assert.match(html, /data-device-orientation="portrait"/);
assert.match(html, /data-device-orientation="landscape"/);
assert.match(html, /显示安全区域/);
assert.match(html, /devicePreviewFrame\.src = buildDevicePreviewUrl\(\)/);
assert.match(html, /window\.addEventListener\('resize'/);
assert.equal((html.match(/id="devicePreviewDialog"/g) ?? []).length, 1);
assert.equal((html.match(/id="devicePreviewButton"/g) ?? []).length, 1);

const firstScriptIndex = html.indexOf("<script>");
const dialogIndex = html.indexOf('id="devicePreviewDialog"');
assert.ok(firstScriptIndex > 0, "最终门面缺少内联脚本。");
assert.ok(dialogIndex > 0, "最终门面缺少设备预览对话框。");
assert.ok(dialogIndex < firstScriptIndex, "设备预览 DOM 必须在主脚本执行前完成解析。");

const inlineScripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
assert.ok(inlineScripts.length > 0, "最终门面缺少可检查的内联脚本。");
for (const match of inlineScripts) {
  new Script(match[1] ?? "");
}

console.log("Device preview Web UI self-test passed.");
