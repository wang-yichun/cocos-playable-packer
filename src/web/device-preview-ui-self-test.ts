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

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
new Script(inlineScriptMatch?.[1] ?? "");

console.log("Device preview Web UI self-test passed.");
