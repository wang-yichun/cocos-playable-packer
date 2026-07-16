import assert from "node:assert/strict";
import { Script } from "node:vm";

import { addDevicePreviewSimulator } from "./device-preview-ui.js";
import { createChannelWebMvpIndexHtml } from "./web-channel-ui.js";

const html = addDevicePreviewSimulator(createChannelWebMvpIndexHtml());

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

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
new Script(inlineScriptMatch?.[1] ?? "");

console.log("Device preview Web UI self-test passed.");
