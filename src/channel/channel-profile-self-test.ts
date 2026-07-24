import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  PANGLE_PLAYABLE_SDK_URL,
  TIKTOK_PLAYABLE_SDK_URL,
} from "./bytedance-channel.js";
import {
  appendChannelReport,
  CHANNEL_PLATFORMS,
  CHANNEL_PROFILES,
  createChannelReport,
  normalizeChannelBuildConfig,
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
} from "./channel-profile.js";

assert.deepEqual(CHANNEL_PLATFORMS, [
  "Preview",
  "AppLovin",
  "Google",
  "Facebook",
  "Liftoff",
  "IronSource",
  "Unity",
  "Moloco",
  "Pangle",
  "TikTok",
]);

assert.equal(CHANNEL_PROFILES.AppLovin.bridge, "mraid");
assert.equal(CHANNEL_PROFILES.AppLovin.startupPolicy, "mraid-viewable");
assert.equal(CHANNEL_PROFILES.Google.deliveryFormat, "zip-html-res-js");
assert.deepEqual(CHANNEL_PROFILES.Google.requiredGlobals, ["ExitApi"]);
assert.match(CHANNEL_PROFILES.Google.externalScripts[0] ?? "", /exitapi\.js$/);
assert.equal(CHANNEL_PROFILES.Facebook.bridge, "facebook-cta");
assert.equal(CHANNEL_PROFILES.Facebook.deliveryFormat, "zip-html-res-js");
assert.equal(CHANNEL_PROFILES.Facebook.startupPolicy, "window-load");
assert.deepEqual(CHANNEL_PROFILES.Facebook.requiredGlobals, ["FbPlayableAd"]);
assert.equal(CHANNEL_PROFILES.Liftoff.deliveryFormat, "zip-single-html");
assert.equal(CHANNEL_PROFILES.IronSource.deliveryFormat, "single-html");
assert.equal(CHANNEL_PROFILES.IronSource.startupPolicy, "mraid-viewable");
assert.equal(CHANNEL_PROFILES.Unity.externalScripts[0], "mraid.js (host-provided)");
assert.equal(CHANNEL_PROFILES.Unity.bridge, "mraid");
assert.equal(CHANNEL_PROFILES.Moloco.deliveryFormat, "single-html");
assert.equal(CHANNEL_PROFILES.Moloco.bridge, "facebook-cta");
assert.equal(CHANNEL_PROFILES.Moloco.analyticsAdapter, "none");
assert.equal(CHANNEL_PROFILES.Pangle.bridge, "bytedance-playable-sdk");
assert.equal(CHANNEL_PROFILES.Pangle.externalScripts[0], PANGLE_PLAYABLE_SDK_URL);
assert.equal(CHANNEL_PROFILES.TikTok.bridge, "bytedance-playable-sdk");
assert.equal(CHANNEL_PROFILES.TikTok.externalScripts[0], TIKTOK_PLAYABLE_SDK_URL);

const defaults = normalizeChannelBuildConfig(undefined);
assert.deepEqual(defaults, {
  platform: "Preview",
  androidStoreUrl: null,
  iosStoreUrl: null,
});

const google = normalizeChannelBuildConfig({
  platform: "Google",
  androidStoreUrl: TEST_ANDROID_STORE_URL,
  iosStoreUrl: TEST_IOS_STORE_URL,
});
assert.equal(google.platform, "Google");
assert.equal(google.androidStoreUrl, TEST_ANDROID_STORE_URL);
assert.equal(google.iosStoreUrl, TEST_IOS_STORE_URL);

assert.throws(
  () => normalizeChannelBuildConfig({ platform: "Unknown" }),
  /channelPlatform 只支持/,
);
assert.throws(
  () => normalizeChannelBuildConfig({ platform: "Google", androidStoreUrl: "javascript:alert(1)" }),
  /只支持 http 或 https/,
);

const report = createChannelReport(google);
assert.equal(report.platform, "Google");
assert.equal(report.integrationStatus, "profile-only");
assert.equal(report.deliveryFormat, "zip-html-res-js");
assert.ok(report.warnings.some((warning) => warning.includes("index.html + res.js")));

const facebookReport = createChannelReport({
  platform: "Facebook",
  androidStoreUrl: TEST_ANDROID_STORE_URL,
  iosStoreUrl: TEST_IOS_STORE_URL,
});
assert.equal(facebookReport.bridge, "facebook-cta");
assert.equal(facebookReport.deliveryFormat, "zip-html-res-js");
assert.ok(facebookReport.warnings.some((warning) => warning.includes("index.html + res.js")));

for (const platform of ["IronSource", "Unity", "Moloco", "Pangle", "TikTok"] as const) {
  const channelReport = createChannelReport({
    platform,
    androidStoreUrl: TEST_ANDROID_STORE_URL,
    iosStoreUrl: TEST_IOS_STORE_URL,
  });
  assert.equal(channelReport.deliveryFormat, "single-html");
  assert.ok(channelReport.warnings.length > 0);
}

for (const platform of ["Pangle", "TikTok"] as const) {
  const channelReport = createChannelReport({
    platform,
    androidStoreUrl: null,
    iosStoreUrl: null,
  });
  assert.equal(
    channelReport.warnings.some((warning) => warning.includes("商店地址")),
    false,
    `${platform} CTA 由渠道 SDK 负责，不应要求本地商店地址。`,
  );
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "channel-profile-test-"));
try {
  const reportFile = path.join(temporaryRoot, "game.report.json");
  await writeFile(reportFile, `${JSON.stringify({ schemaVersion: 1, output: { bytes: 1 } })}\n`, "utf8");
  await appendChannelReport(reportFile, google);
  const augmented = JSON.parse(await readFile(reportFile, "utf8")) as {
    output?: { bytes?: unknown };
    channel?: { platform?: unknown; bridge?: unknown };
  };
  assert.equal(augmented.output?.bytes, 1);
  assert.equal(augmented.channel?.platform, "Google");
  assert.equal(augmented.channel?.bridge, "google-exit-api");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Channel profile self-test passed.");
