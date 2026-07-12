import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CHANNEL_DOWNLOAD_BRIDGE_MARKER } from "./channel-download-bridge.js";
import {
  createChannelDownloadArtifact,
  createChannelHtml,
} from "./liftoff-delivery.js";
import {
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
} from "./channel-profile.js";
import { extractZipArchive } from "../web/zip-extractor.js";

const sourceHtml = `<!doctype html><html><head></head><body><script>
(function () {
    async function boot() {
        window.__liftoffTest = true;
    }
    boot().catch(
        function (error) {
            console.error(error);
        }
    );
})();
</script></body></html>`;

const liftoffConfig = {
  platform: "Liftoff" as const,
  androidStoreUrl: TEST_ANDROID_STORE_URL,
  iosStoreUrl: TEST_IOS_STORE_URL,
};

const artifact = createChannelDownloadArtifact(sourceHtml, liftoffConfig);
assert.equal(artifact.contentType, "application/zip");
assert.equal(artifact.fileName, "liftoff-playable.zip");
assert.equal(artifact.deliveryFormat, "zip-single-html");
assert.deepEqual(artifact.entries, ["index.html"]);
assert.equal(artifact.body.readUInt32LE(0), 0x04034b50);
assert.equal(artifact.sha256.length, 64);
assert.equal(
  createChannelDownloadArtifact(sourceHtml, liftoffConfig).body.equals(artifact.body),
  true,
  "Liftoff ZIP 应使用确定性元数据。",
);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "liftoff-delivery-test-"));
try {
  const zipFile = path.join(temporaryRoot, "liftoff-playable.zip");
  const outputDirectory = path.join(temporaryRoot, "extracted");
  await writeFile(zipFile, artifact.body);
  const extraction = await extractZipArchive(zipFile, outputDirectory);
  assert.equal(extraction.fileCount, 1);
  assert.deepEqual(await readdir(outputDirectory), ["index.html"]);

  const indexHtml = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  assert.match(indexHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(indexHtml, /window\.mraid\.open/);
  assert.match(indexHtml, /__PACK_DEFER_START__/);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const previewHtml = createChannelHtml(sourceHtml, {
  platform: "Preview",
  androidStoreUrl: null,
  iosStoreUrl: null,
});
assert.match(previewHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));

const previewArtifact = createChannelDownloadArtifact(sourceHtml, {
  platform: "Preview",
  androidStoreUrl: null,
  iosStoreUrl: null,
});
assert.equal(previewArtifact.contentType, "text/html; charset=utf-8");
assert.equal(previewArtifact.fileName, "game.html");
assert.equal(previewArtifact.deliveryFormat, "single-html");

console.log("Liftoff ZIP delivery self-test passed.");
