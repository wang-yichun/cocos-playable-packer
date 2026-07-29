import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CHANNEL_DOWNLOAD_BRIDGE_MARKER } from "./channel-download-bridge.js";
import {
  createChannelDownloadArtifact,
  createFacebookEncodedAssetMapArtifact,
  createFacebookMultiFileArtifact,
} from "./liftoff-delivery.js";
import {
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
} from "./channel-profile.js";
import { HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID } from "../encoding/html-safe-7bit.js";
import { extractZipArchive } from "../web/zip-extractor.js";

const encodedPayload = "ABCΩЖ123";
const sourceHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script id="${HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID}" type="application/x-playable-payload">${encodedPayload}</script>
<script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"html7","n":8,"b":""};
(function () {
    async function boot() {
        window.__facebookTest = true;
    }
    boot().catch(
        function (error) {
            console.error(error);
        }
    );
})();
</script>
</body></html>`;

const facebookConfig = {
  platform: "Facebook" as const,
  androidStoreUrl: TEST_ANDROID_STORE_URL,
  iosStoreUrl: TEST_IOS_STORE_URL,
};

const artifact = createChannelDownloadArtifact(sourceHtml, facebookConfig);
assert.equal(artifact.contentType, "application/zip");
assert.equal(artifact.fileName, "facebook-playable.zip");
assert.equal(artifact.deliveryFormat, "zip-single-html");
assert.deepEqual(artifact.entries, ["index.html"]);
assert.equal(artifact.body.readUInt32LE(0), 0x04034b50);
assert.equal(artifact.sha256.length, 64);
assert.equal(artifact.entryBytes["index.html"], artifact.htmlBytes);
assert.equal(
  createChannelDownloadArtifact(sourceHtml, facebookConfig).body.equals(artifact.body),
  true,
  "Facebook ZIP 应使用确定性元数据。",
);

const multiFileArtifact = createFacebookMultiFileArtifact([
  { name: "index.html", content: Buffer.from(sourceHtml, "utf8") },
  {
    name: "assets/main/native/demo@73b7f.js",
    content: Buffer.from("window.open('https://example.invalid');", "utf8"),
  },
], facebookConfig);
assert.equal(multiFileArtifact.deliveryFormat, "zip-multi-file");
assert.deepEqual(multiFileArtifact.entries, ["index.html", "assets/main/native/demo_73b7f.js"]);
assert.ok(multiFileArtifact.entryBytes["assets/main/native/demo_73b7f.js"] !== undefined);

const encodedAssetMapSource = `<!doctype html><html><head></head><body><canvas id="GameCanvas"></canvas>
<script>window.__PACK_BROTLI_DECOMPRESS__=function(value){return value;};</script>
<script>window.__PACK_FILES__={"assets/main/import/demo@73b7f.cconb":{"o":0,"l":1}};window.__PACK_ARCHIVE__={"v":1,"c":"br","b":"QQ=="};window.__PACK_BOOT__={};</script>
<script>(function(){var FILES = window.__PACK_FILES__;function collapsePath(value){return value;} window.__facebookEncodedMapTest = FILES;})();</script>
</body></html>`;
const encodedAssetMapArtifact = createFacebookEncodedAssetMapArtifact(
  encodedAssetMapSource,
  facebookConfig,
);
assert.equal(encodedAssetMapArtifact.deliveryFormat, "zip-multi-file");
assert.deepEqual(encodedAssetMapArtifact.entries, [
  "index.html",
  "assets/script_1.js",
  "assets/script_2.js",
  "assets/script_3.js",
]);
assert.equal(encodedAssetMapArtifact.entries.some((entry) => entry.includes("@")), false);
assert.match(
  Buffer.from(encodedAssetMapArtifact.body).toString("latin1"),
  /assets\/script_1\.js/,
);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "facebook-delivery-test-"));
try {
  const zipFile = path.join(temporaryRoot, "facebook-playable.zip");
  const outputDirectory = path.join(temporaryRoot, "extracted");
  await writeFile(zipFile, artifact.body);
  const extraction = await extractZipArchive(zipFile, outputDirectory);
  assert.equal(extraction.fileCount, 1);
  assert.deepEqual((await readdir(outputDirectory)).sort(), ["index.html"]);

  const indexHtml = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  assert.match(indexHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(indexHtml, /window\.FbPlayableAd\.onCTAClick/);
  assert.match(indexHtml, /window\.__PLAYABLE_ADAPTER__/);
  assert.doesNotMatch(indexHtml, /mraid\.open|window\.open|location\.href/);
  assert.match(indexHtml, /window\.__PACK_ARCHIVE__/);
  assert.match(indexHtml, new RegExp(encodedPayload));
  assert.doesNotMatch(indexHtml, /<script src="res\.js"><\/script>/);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Facebook ZIP delivery self-test passed.");
