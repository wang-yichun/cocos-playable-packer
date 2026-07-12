import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";

import { CHANNEL_DOWNLOAD_BRIDGE_MARKER } from "./channel-download-bridge.js";
import {
  createChannelDownloadArtifact,
  splitFacebookHtml,
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

const split = splitFacebookHtml(sourceHtml);
assert.match(split.indexHtml, /<script src="res\.js"><\/script>/);
assert.doesNotMatch(split.indexHtml, /window\.__PACK_ARCHIVE__/);
assert.doesNotMatch(split.indexHtml, new RegExp(encodedPayload));
assert.match(split.resourceJavaScript, /window\.__PACK_ARCHIVE__/);
assert.match(split.resourceJavaScript, new RegExp(HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID));
assert.match(split.resourceJavaScript, /window\.__facebookTest/);
new Script(split.resourceJavaScript);

const artifact = createChannelDownloadArtifact(sourceHtml, facebookConfig);
assert.equal(artifact.contentType, "application/zip");
assert.equal(artifact.fileName, "facebook-playable.zip");
assert.equal(artifact.deliveryFormat, "zip-html-res-js");
assert.deepEqual(artifact.entries, ["index.html", "res.js"]);
assert.equal(artifact.body.readUInt32LE(0), 0x04034b50);
assert.equal(artifact.sha256.length, 64);
assert.equal(artifact.entryBytes["index.html"], artifact.htmlBytes);
assert.equal(typeof artifact.entryBytes["res.js"], "number");
assert.equal(
  createChannelDownloadArtifact(sourceHtml, facebookConfig).body.equals(artifact.body),
  true,
  "Facebook ZIP 应使用确定性元数据。",
);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "facebook-delivery-test-"));
try {
  const zipFile = path.join(temporaryRoot, "facebook-playable.zip");
  const outputDirectory = path.join(temporaryRoot, "extracted");
  await writeFile(zipFile, artifact.body);
  const extraction = await extractZipArchive(zipFile, outputDirectory);
  assert.equal(extraction.fileCount, 2);
  assert.deepEqual((await readdir(outputDirectory)).sort(), ["index.html", "res.js"]);

  const indexHtml = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  const resourceJavaScript = await readFile(path.join(outputDirectory, "res.js"), "utf8");
  assert.match(indexHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(indexHtml, /window\.FbPlayableAd\.onCTAClick/);
  assert.match(indexHtml, /<script src="res\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /window\.__PACK_ARCHIVE__/);
  assert.match(resourceJavaScript, /window\.__PACK_ARCHIVE__/);
  assert.match(resourceJavaScript, new RegExp(encodedPayload));
  new Script(resourceJavaScript);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Facebook ZIP delivery self-test passed.");
