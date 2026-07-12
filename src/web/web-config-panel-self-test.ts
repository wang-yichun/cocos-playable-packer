import assert from "node:assert/strict";
import { Script } from "node:vm";

import {
  createWebBuildRequest,
  DEFAULT_WEB_BUILD_CONFIG,
  normalizeWebBuildConfig,
  RAW_SINGLE_HTML_WEB_BUILD_CONFIG,
  RECOMMENDED_WEB_BUILD_CONFIG,
} from "./web-build-config.js";
import { createChannelWebMvpIndexHtml } from "./web-channel-ui.js";

const previewChannel = {
  platform: "Preview",
  androidStoreUrl: null,
  iosStoreUrl: null,
};

assert.deepEqual(DEFAULT_WEB_BUILD_CONFIG, {
  buildMode: "optimized",
  imageMode: "webp",
  pngQuality: 80,
  jpegQuality: 80,
  audioBitrateKbps: null,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
  channel: previewChannel,
});

assert.deepEqual(RECOMMENDED_WEB_BUILD_CONFIG, {
  buildMode: "optimized",
  imageMode: "webp",
  pngQuality: 80,
  jpegQuality: 80,
  audioBitrateKbps: 48,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
  channel: previewChannel,
});

assert.deepEqual(RAW_SINGLE_HTML_WEB_BUILD_CONFIG, {
  buildMode: "raw-single-html",
  imageMode: "none",
  pngQuality: 80,
  jpegQuality: 80,
  audioBitrateKbps: null,
  payloadEncoding: "base64",
  brotliFallback: "raw-js",
  channel: previewChannel,
});

const normalizedRaw = normalizeWebBuildConfig({
  buildMode: "raw-single-html",
  imageMode: "webp",
  pngQuality: 1,
  jpegQuality: 1,
  audioBitrateKbps: 48,
  payloadEncoding: "html7",
  brotliFallback: "gzip-packed-js",
  channel: {
    platform: "Google",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.google.android.apps.maps",
  },
});
assert.equal(normalizedRaw.buildMode, "raw-single-html");
assert.equal(normalizedRaw.imageMode, "none");
assert.equal(normalizedRaw.audioBitrateKbps, null);
assert.equal(normalizedRaw.payloadEncoding, "base64");
assert.equal(normalizedRaw.channel.platform, "Google");

const rawRequest = createWebBuildRequest(
  "./web-mobile",
  "./dist/raw.html",
  "raw-test",
  normalizedRaw,
);
assert.deepEqual(rawRequest.image, { mode: "none" });
assert.equal(rawRequest.audio, null);
assert.equal(rawRequest.payloadEncoding, "base64");
assert.equal(rawRequest.brotliFallback, "raw-js");

const html = createChannelWebMvpIndexHtml();
for (const id of [
  "recommendedPresetButton",
  "channelPlatform",
  "androidStoreUrl",
  "iosStoreUrl",
  "testStoreUrlsButton",
  "channelSummary",
  "channelWarning",
  "buildMode",
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
assert.match(html, /填入 Google Maps 测试链接/);
assert.match(html, /WebP 80 \/ 音频 48 kbps \/ HTML7/);
assert.match(html, /仅合并单 HTML（不压缩）/);
assert.match(html, /不执行图片压缩、音频压缩、Brotli 压缩或 Payload 编码/);
assert.match(html, /FFmpeg/);
assert.match(html, /zip-html-res-js/);

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);

assert.match(inlineScript, /const defaultConfig = .*"buildMode":"optimized"/);
assert.match(inlineScript, /const recommendedConfig = .*"audioBitrateKbps":48/);
assert.match(inlineScript, /buildMode: 'raw-single-html'/);
assert.match(inlineScript, /channel: channel/);
assert.match(inlineScript, /channelPlatformInput\.addEventListener/);
assert.match(inlineScript, /testStoreUrlsButton\.addEventListener/);
assert.match(inlineScript, /config: config/);
assert.match(inlineScript, /audioBitrateKbps: audioBitrateKbps/);
assert.match(inlineScript, /recommendedPresetButton\.addEventListener/);
assert.match(inlineScript, /buildModeInput\.addEventListener/);

console.log("Playable Web config panel self-test passed.");
