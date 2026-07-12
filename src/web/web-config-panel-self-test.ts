import assert from "node:assert/strict";
import { Script } from "node:vm";

import {
  DEFAULT_WEB_BUILD_CONFIG,
  RECOMMENDED_WEB_BUILD_CONFIG,
} from "./web-build-config.js";
import { createWebMvpIndexHtml } from "./web-ui.js";

assert.deepEqual(DEFAULT_WEB_BUILD_CONFIG, {
  imageMode: "webp",
  pngQuality: 80,
  jpegQuality: 80,
  audioBitrateKbps: null,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
});

assert.deepEqual(RECOMMENDED_WEB_BUILD_CONFIG, {
  imageMode: "webp",
  pngQuality: 80,
  jpegQuality: 80,
  audioBitrateKbps: 48,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
});

const html = createWebMvpIndexHtml();
for (const id of [
  "recommendedPresetButton",
  "imageMode",
  "pngQuality",
  "jpegQuality",
  "audioEnabled",
  "audioBitrate",
  "payloadEncoding",
  "configSummary",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`));
}

assert.match(html, /应用一键推荐预设/);
assert.match(html, /WebP 80 \/ 音频 48 kbps \/ HTML7/);
assert.match(html, /FFmpeg/);

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);

assert.match(inlineScript, /const defaultConfig = .*"audioBitrateKbps":null/);
assert.match(inlineScript, /const recommendedConfig = .*"audioBitrateKbps":48/);
assert.match(inlineScript, /config: config/);
assert.match(inlineScript, /audioBitrateKbps: audioBitrateKbps/);
assert.match(inlineScript, /recommendedPresetButton\.addEventListener/);

console.log("Playable Web config panel self-test passed.");
