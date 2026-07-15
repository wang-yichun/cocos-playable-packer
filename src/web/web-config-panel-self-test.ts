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
import { createPlayableSdkDownloadZip } from "./playable-sdk-download-ui.js";

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
  tinyPngMinBytes: 4096,
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

const tinyPngDefaults = normalizeWebBuildConfig({ imageMode: "tinypng" });
assert.equal(tinyPngDefaults.tinyPngMinBytes, 4096);

const tinyPngConfig = normalizeWebBuildConfig({
  imageMode: "tinypng",
  tinyPngScope: "limit",
  tinyPngLimit: 25,
  tinyPngMinBytes: 8192,
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
  minBytes: 8192,
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
  "playableSdkDownloadField",
  "downloadPlayableSdkZipButton",
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

for (const expected of [
  /TinyPNG API/,
  /客户自己的 TINYPNG_API_KEY/,
  /默认 4 KB/,
  /游戏侧 Playable SDK vdev/,
  /下载 CocosPlayableSDK-vdev\.zip/,
  /PlayableSDK\.ts、PlayableSDKTypes\.ts 和 PlayableSDKGlobal\.d\.ts/,
  /目标渠道/,
  /跳转地址/,
  /加载界面/,
  /下载渠道合集 ZIP/,
  /应用一键推荐预设/,
  /WebP 80 \/ 音频 48 kbps \/ HTML7/,
  /FFmpeg/,
]) {
  assert.match(html, expected);
}

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);
assert.match(inlineScript, /TinyPNG 模式必须填写 TINYPNG_API_KEY/);
assert.match(inlineScript, /imageMode === 'tinypng' && tinyPngScope === 'limit'/);
assert.match(inlineScript, /groupConfigSections\(\);/);
assert.match(inlineScript, /details\.open = false/);
assert.doesNotMatch(inlineScript, /details\.open = open/);
assert.match(inlineScript, /createConfigGroup\('图片压缩', 'image'/);
assert.match(
  inlineScript,
  /createConfigGroup\('目标渠道', 'channel',[^\n]*playableSdkDownloadField/,
);
assert.match(inlineScript, /setConfigGroupState\(\s*'channel'/);
assert.match(inlineScript, /setConfigGroupState\(\s*'links'/);
assert.match(inlineScript, /setConfigGroupState\(\s*'loading'/);
assert.match(inlineScript, /persistedConfigStorageKey = 'cocos-playable-packer\.web-config\.v1'/);
assert.match(inlineScript, /const playableSdkZipBase64 =/);
assert.match(inlineScript, /new Blob\(\[bytes\], \{ type: 'application\/zip' \}\)/);
assert.match(inlineScript, /anchor\.download = "CocosPlayableSDK-vdev\.zip"/);
assert.match(inlineScript, /downloadPlayableSdkZipButton\.addEventListener/);

const zipText = createPlayableSdkDownloadZip("1.2.3").toString("utf8");
for (const expected of [
  /CocosPlayableSDK-v1\.2\.3\/PlayableSDK\.ts/,
  /CocosPlayableSDK-v1\.2\.3\/PlayableSDKTypes\.ts/,
  /CocosPlayableSDK-v1\.2\.3\/PlayableSDKGlobal\.d\.ts/,
  /Cocos Playable SDK v1\.2\.3/,
  /Generated by Cocos Playable Packer v1\.2\.3/,
  /export const PLAYABLE_SDK_VERSION = "1\.2\.3";/,
  /PlayablePlatform\.AppLovin/,
]) {
  assert.match(zipText, expected);
}

console.log("Playable Web grouped config, versioned SDK ZIP and TinyPNG self-test passed.");
