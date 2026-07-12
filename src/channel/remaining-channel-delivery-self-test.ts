import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";

import {
  CHANNEL_DOWNLOAD_BRIDGE_MARKER,
  CHANNEL_RUNTIME_GATE_MARKER,
} from "./channel-download-bridge.js";
import {
  CHANNEL_EXTERNAL_SCRIPT_MARKER,
  createChannelDownloadArtifact,
  GOOGLE_EXIT_API_URL,
} from "./liftoff-delivery.js";
import {
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
  type ChannelPlatform,
} from "./channel-profile.js";
import { HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID } from "../encoding/html-safe-7bit.js";
import { extractZipArchive } from "../web/zip-extractor.js";

const sourceHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script id="${HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID}" type="application/x-playable-payload">ABCΩЖ123</script>
<script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"html7","n":8,"b":""};
(function () {
    async function boot() {
        window.__remainingChannelTest = true;
    }
    boot().catch(
        function (error) {
            console.error(error);
        }
    );
})();
</script>
</body></html>`;

function config(platform: ChannelPlatform) {
  return {
    platform,
    androidStoreUrl: TEST_ANDROID_STORE_URL,
    iosStoreUrl: TEST_IOS_STORE_URL,
  };
}

const googleArtifact = createChannelDownloadArtifact(sourceHtml, config("Google"));
assert.equal(googleArtifact.contentType, "application/zip");
assert.equal(googleArtifact.fileName, "google-playable.zip");
assert.equal(googleArtifact.deliveryFormat, "zip-html-res-js");
assert.deepEqual(googleArtifact.entries, ["index.html", "res.js"]);
assert.equal(googleArtifact.sha256.length, 64);
assert.equal(
  createChannelDownloadArtifact(sourceHtml, config("Google")).body.equals(googleArtifact.body),
  true,
  "Google ZIP 应使用确定性元数据。",
);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "remaining-channel-test-"));
try {
  const zipFile = path.join(temporaryRoot, "google-playable.zip");
  const outputDirectory = path.join(temporaryRoot, "google");
  await writeFile(zipFile, googleArtifact.body);
  const extraction = await extractZipArchive(zipFile, outputDirectory);
  assert.equal(extraction.fileCount, 2);
  assert.deepEqual((await readdir(outputDirectory)).sort(), ["index.html", "res.js"]);

  const indexHtml = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  const resourceJavaScript = await readFile(path.join(outputDirectory, "res.js"), "utf8");
  assert.match(indexHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(indexHtml, new RegExp(CHANNEL_EXTERNAL_SCRIPT_MARKER));
  assert.match(indexHtml, new RegExp(GOOGLE_EXIT_API_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(indexHtml, /window\.ExitApi\.exit/);
  assert.match(indexHtml, /<script src="res\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /window\.__PACK_ARCHIVE__/);
  assert.match(resourceJavaScript, /window\.__PACK_ARCHIVE__/);
  new Script(resourceJavaScript);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const singleHtmlCases = [
  {
    platform: "AppLovin" as const,
    fileName: "applovin-playable.html",
    marker: /window\.mraid\.open/,
    runtimeGate: true,
  },
  {
    platform: "IronSource" as const,
    fileName: "ironsource-playable.html",
    marker: /window\.mraid\.open/,
    runtimeGate: true,
  },
  {
    platform: "Unity" as const,
    fileName: "unity-playable.html",
    marker: /window\.mraid\.open/,
    runtimeGate: true,
  },
  {
    platform: "Moloco" as const,
    fileName: "moloco-playable.html",
    marker: /window\.FbPlayableAd\.onCTAClick/,
    runtimeGate: false,
  },
];

for (const testCase of singleHtmlCases) {
  const artifact = createChannelDownloadArtifact(sourceHtml, config(testCase.platform));
  assert.equal(artifact.contentType, "text/html; charset=utf-8");
  assert.equal(artifact.fileName, testCase.fileName);
  assert.equal(artifact.deliveryFormat, "single-html");
  assert.deepEqual(artifact.entries, [testCase.fileName]);
  assert.equal(artifact.entryBytes[testCase.fileName], artifact.body.length);
  assert.equal(artifact.sha256.length, 64);

  const html = artifact.body.toString("utf8");
  assert.match(html, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(html, testCase.marker);
  if (testCase.runtimeGate) {
    assert.match(html, new RegExp(CHANNEL_RUNTIME_GATE_MARKER));
    assert.match(html, /window\.__runGame/);
  } else {
    assert.doesNotMatch(html, new RegExp(CHANNEL_RUNTIME_GATE_MARKER));
  }
}

const unityHtml = createChannelDownloadArtifact(sourceHtml, config("Unity")).body.toString("utf8");
assert.doesNotMatch(unityHtml, /<script[^>]+src=["']mraid\.js["']/i);
assert.match(unityHtml, /isMraidPlatform = true/);

console.log("Remaining channel delivery self-test passed.");
