import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CHANNEL_DOWNLOAD_BRIDGE_MARKER } from "./channel-download-bridge.js";
import { CHANNEL_PLATFORMS } from "./channel-profile.js";
import {
  createMultiChannelDownloadArtifact,
  selectedChannelPlatforms,
} from "./multi-channel-delivery.js";
import { extractZipArchive } from "../web/zip-extractor.js";

const sourceHtml = `<!doctype html><html><head></head><body><script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"base64","b":"QQ=="};
(function () {
  async function boot() {
    window.__multiChannelTest = true;
  }
  boot().catch(function (error) { console.error(error); });
})();
</script></body></html>`;

const config = {
  platform: "Preview" as const,
  platforms: [...CHANNEL_PLATFORMS],
  androidStoreUrl: "https://play.google.com/store/apps/details?id=com.google.android.apps.maps",
  iosStoreUrl: "https://apps.apple.com/app/google-maps/id585027354",
};

assert.deepEqual(selectedChannelPlatforms(config), CHANNEL_PLATFORMS);

const bundle = createMultiChannelDownloadArtifact(sourceHtml, config);
assert.equal(bundle.contentType, "application/zip");
assert.equal(bundle.fileName, "playable-channel-bundle.zip");
assert.equal(bundle.body.readUInt32LE(0), 0x04034b50);
assert.equal(bundle.sha256.length, 64);
assert.equal(bundle.channelArtifacts.length, CHANNEL_PLATFORMS.length);
assert.equal(bundle.entries.length, CHANNEL_PLATFORMS.length + 1);
assert.ok(bundle.entries.includes("manifest.json"));
assert.ok(bundle.entries.includes("channels/preview/game.html"));
assert.ok(bundle.entries.includes("channels/google/google-playable.zip"));
assert.ok(bundle.entries.includes("channels/facebook/facebook-playable.zip"));
assert.ok(bundle.entries.includes("channels/liftoff/liftoff-playable.zip"));
assert.ok(bundle.entries.includes("channels/ironsource/ironsource-playable.html"));
assert.ok(bundle.entries.includes("channels/unity/unity-playable.html"));
assert.ok(bundle.entries.includes("channels/moloco/moloco-playable.html"));
assert.equal(
  createMultiChannelDownloadArtifact(sourceHtml, config).body.equals(bundle.body),
  true,
  "相同基础 HTML 和渠道配置应生成确定性合集 ZIP。",
);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "multi-channel-delivery-test-"));
try {
  const zipFile = path.join(temporaryRoot, "playable-channel-bundle.zip");
  const outputDirectory = path.join(temporaryRoot, "extracted");
  await writeFile(zipFile, bundle.body);
  const extraction = await extractZipArchive(zipFile, outputDirectory);
  assert.equal(extraction.fileCount, CHANNEL_PLATFORMS.length + 1);

  const manifest = JSON.parse(
    await readFile(path.join(outputDirectory, "manifest.json"), "utf8"),
  ) as {
    selectedPlatforms?: unknown;
    baseBuild?: { executions?: unknown };
    reuse?: { channelSpecificStage?: unknown };
    deliveries?: unknown[];
  };
  assert.deepEqual(manifest.selectedPlatforms, CHANNEL_PLATFORMS);
  assert.equal(manifest.baseBuild?.executions, 1);
  assert.equal(manifest.reuse?.channelSpecificStage, "deliveryPackaging");
  assert.equal(manifest.deliveries?.length, CHANNEL_PLATFORMS.length);

  const appLovinHtml = await readFile(
    path.join(outputDirectory, "channels", "applovin", "applovin-playable.html"),
    "utf8",
  );
  assert.match(appLovinHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(appLovinHtml, /window\.mraid\.open/);

  const googleZip = await readFile(
    path.join(outputDirectory, "channels", "google", "google-playable.zip"),
  );
  assert.equal(googleZip.readUInt32LE(0), 0x04034b50);

  const previewInfo = await stat(
    path.join(outputDirectory, "channels", "preview", "game.html"),
  );
  assert.equal(previewInfo.isFile(), true);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Multi-channel delivery bundle self-test passed.");
