import assert from "node:assert/strict";
import { Script } from "node:vm";

import { CHANNEL_PLATFORMS } from "../channel/channel-profile.js";
import {
  createWebBuildRequest,
  DEFAULT_WEB_BUILD_CONFIG,
  normalizeWebBuildConfig,
  RAW_SINGLE_HTML_WEB_BUILD_CONFIG,
  RECOMMENDED_WEB_BUILD_CONFIG,
} from "./web-build-config.js";
import { createLoadingScreenWebMvpIndexHtml } from "./loading-screen-ui.js";

const previewChannel = {
  platform: "Preview",
  platforms: ["Preview"],
  androidStoreUrl: null,
  iosStoreUrl: null,
};

const commonImageDefaults = {
  pngQuality: 80,
  jpegQuality: 80,
  tinyPngScope: "all",
  tinyPngLimit: null,
  tinyPngMinBytes: 1024,
};

assert.deepEqual(DEFAULT_WEB_BUILD_CONFIG, {
  buildMode: "optimized",
  imageMode: "webp",
  ...commonImageDefaults,
  audioBitrateKbps: null,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
  channel: previewChannel,
});

assert.deepEqual(RECOMMENDED_WEB_BUILD_CONFIG, {
  buildMode: "optimized",
  imageMode: "webp",
  ...commonImageDefaults,
  audioBitrateKbps: 48,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
  channel: previewChannel,
});

assert.deepEqual(RAW_SINGLE_HTML_WEB_BUILD_CONFIG, {
  buildMode: "raw-single-html",
  imageMode: "none",
  ...commonImageDefaults,
  audioBitrateKbps: null,
  payloadEncoding: "base64",
  brotliFallback: "raw-js",
  channel: previewChannel,
});

const normalizedRaw = normalizeWebBuildConfig({
  buildMode: "raw-single-html",
  imageMode: "tinypng",
  tinyPngScope: "limit",
  tinyPngLimit: 10,
  audioBitrateKbps: 48,
  payloadEncoding: "html7",
  brotliFallback: "gzip-packed-js",
  channel: {
    platform: "Google",
    platforms: ["Google", "Preview", "Google"],
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.google.android.apps.maps",
  },
});
assert.equal(normalizedRaw.buildMode, "raw-single-html");
assert.equal(normalizedRaw.imageMode, "none");
assert.equal(normalizedRaw.audioBitrateKbps, null);
assert.equal(normalizedRaw.payloadEncoding, "base64");
assert.equal(normalizedRaw.channel.platform, "Google");
assert.deepEqual(normalizedRaw.channel.platforms, ["Preview", "Google"]);

assert.throws(
  () => normalizeWebBuildConfig({ channel: { platforms: [] } }),
  /至少需要选择一个目标渠道/,
);
assert.throws(
  () => normalizeWebBuildConfig({ channel: { platforms: ["Unknown"] } }),
  /channel\.platforms 只支持/,
);
assert.throws(
  () => normalizeWebBuildConfig({ imageMode: "tinypng", tinyPngScope: "limit" }),
  /tinyPngLimit/,
);

const tinyPngConfig = normalizeWebBuildConfig({
  imageMode: "tinypng",
  tinyPngScope: "limit",
  tinyPngLimit: 25,
  tinyPngMinBytes: 2048,
});
const tinyPngRequest = createWebBuildRequest(
  "./web-mobile",
  "./dist/tinypng.html",
  "tinypng-test",
  tinyPngConfig,
);
assert.deepEqual(tinyPngRequest.image, {
  mode: "tinypng",
  scope: { type: "limit", limit: 25 },
  minBytes: 2048,
});

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

const html = createLoadingScreenWebMvpIndexHtml();
for (const id of [
  "recommendedPresetButton",
  "channelPlatformGroup",
  "selectAllChannelsButton",
  "previewOnlyButton",
  "androidStoreUrl",
  "iosStoreUrl",
  "testStoreUrlsButton",
  "channelSummary",
  "channelWarning",
  "previewChannelDialog",
  "previewChannelSelect",
  "startPreviewButton",
  "buildMode",
  "imageMode",
  "pngQuality",
  "jpegQuality",
  "tinyPngApiKey",
  "tinyPngScope",
  "tinyPngLimit",
  "tinyPngMinBytes",
  "audioEnabled",
  "audioBitrate",
  "payloadEncoding",
  "loadingScreenEnabled",
  "loadingLogoFile",
  "configSummary",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`));
}

const channelCheckboxTags = html.match(
  /<input\b(?=[^>]*\btype="checkbox")(?=[^>]*\bname="channelPlatform")[^>]*>/g,
) ?? [];
assert.equal(channelCheckboxTags.length, CHANNEL_PLATFORMS.length);
for (const platform of CHANNEL_PLATFORMS) {
  assert.ok(
    channelCheckboxTags.some(
      (tag) => tag.includes(`value="${platform}"`) && /\bchecked\b/.test(tag),
    ),
    `${platform} 渠道复选框缺失或未默认勾选。`,
  );
}

assert.match(html, /TinyPNG API/);
assert.match(html, /客户自己的 TINYPNG_API_KEY/);
assert.match(html, /仅用于本次构建/);
assert.match(html, /config-group/);
assert.match(html, /基础构建/);
assert.match(html, /图片压缩/);
assert.match(html, /音频压缩/);
assert.match(html, /Payload 与兼容性/);
assert.match(html, /目标渠道/);
assert.match(html, /跳转地址/);
assert.match(html, /加载界面/);
assert.match(html, /默认全选/);
assert.match(html, /下载渠道合集 ZIP/);
assert.match(html, /选择试玩渠道/);
assert.match(html, /基础资源只压缩一次/);
assert.match(html, /应用一键推荐预设/);
assert.match(html, /WebP 80 \/ 音频 48 kbps \/ HTML7/);
assert.match(html, /仅合并单 HTML（不压缩）/);
assert.match(html, /FFmpeg/);

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);
assert.match(inlineScript, /TinyPNG 模式必须填写 TINYPNG_API_KEY/);
assert.match(inlineScript, /tinyPngApiKey: tinyPngApiKey/);
assert.match(inlineScript, /groupConfigSections\(\);/);
assert.doesNotMatch(inlineScript, /queueMicrotask\(groupConfigSections\)/);
assert.match(inlineScript, /createConfigGroup\('图片压缩'/);
assert.match(inlineScript, /recommendedPresetButton\.addEventListener/);
assert.match(inlineScript, /config: config/);

console.log("Playable Web grouped config and TinyPNG self-test passed.");
