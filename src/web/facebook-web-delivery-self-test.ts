import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";

import { CHANNEL_DOWNLOAD_BRIDGE_MARKER } from "../channel/channel-download-bridge.js";
import { createChannelDownloadArtifact } from "../channel/liftoff-delivery.js";
import {
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
} from "../channel/channel-profile.js";
import type {
  BuildPlayableRequest,
  BuildPlayableResult,
} from "../service/build-playable-types.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";
import { startWebMvpServer } from "./web-mvp-server.js";
import { extractZipArchive } from "./zip-extractor.js";

const runtimeHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"base64","b":"QUJD"};
(function () {
    async function boot() {
        window.__facebookWebTest = true;
    }
    boot().catch(
        function (error) {
            console.error(error);
        }
    );
})();
</script></body></html>`;

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "facebook-web-delivery-test-"));

async function fakeBuildPlayable(
  request: BuildPlayableRequest,
): Promise<BuildPlayableResult> {
  await mkdir(path.dirname(request.outputFile), { recursive: true });
  await writeFile(request.outputFile, runtimeHtml, "utf8");
  const reportFile = request.outputFile.replace(/\.html$/i, ".report.json");
  const report = {
    schemaVersion: 3,
    status: "succeeded",
    output: {
      file: request.outputFile,
      bytes: Buffer.byteLength(runtimeHtml),
      sha256: "test-sha",
      reportFile,
    },
  };
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const now = new Date().toISOString();
  return {
    status: "succeeded",
    outputFile: request.outputFile,
    reportFile,
    outputBytes: Buffer.byteLength(runtimeHtml),
    outputSha256: "test-sha",
    startedAt: now,
    completedAt: now,
    durationMs: 1,
    report,
  };
}

const server = await startWebMvpServer({
  host: "127.0.0.1",
  port: 0,
  rootDirectory: path.join(temporaryRoot, ".packer-web"),
  projectRoot: temporaryRoot,
  buildPlayableImpl: fakeBuildPlayable,
  versionInfo: createFallbackWebVersionInfo(),
});

try {
  const inputArtifact = createChannelDownloadArtifact(runtimeHtml, {
    platform: "Facebook",
    androidStoreUrl: TEST_ANDROID_STORE_URL,
    iosStoreUrl: TEST_IOS_STORE_URL,
  });
  const uploadId = randomUUID();
  const uploadPath = server.manager.createUploadPath(uploadId);
  await writeFile(uploadPath, inputArtifact.body);
  server.manager.registerUpload(uploadId, uploadPath, inputArtifact.body.length);

  const created = server.manager.createJob(uploadId, {
    channel: {
      platform: "Facebook",
      androidStoreUrl: TEST_ANDROID_STORE_URL,
      iosStoreUrl: TEST_IOS_STORE_URL,
    },
  });

  let job = created;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = server.manager.getJob(created.id);
    assert.notEqual(current, null);
    job = current ?? job;
    if (["succeeded", "failed", "cancelled"].includes(job.status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(job.status, "succeeded", JSON.stringify(job.error));
  assert.notEqual(job.links, null);

  const downloadResponse = await fetch(`${server.url}${job.links?.html}?download=1`);
  assert.equal(downloadResponse.ok, true);
  assert.equal(downloadResponse.headers.get("content-type"), "application/zip");
  assert.match(
    downloadResponse.headers.get("content-disposition") ?? "",
    /facebook-playable\.zip/,
  );

  const downloadedZip = Buffer.from(await downloadResponse.arrayBuffer());
  const downloadedZipFile = path.join(temporaryRoot, "downloaded-facebook.zip");
  const extractedDirectory = path.join(temporaryRoot, "downloaded");
  await writeFile(downloadedZipFile, downloadedZip);
  const extraction = await extractZipArchive(downloadedZipFile, extractedDirectory);
  assert.equal(extraction.fileCount, 2);
  assert.deepEqual((await readdir(extractedDirectory)).sort(), ["index.html", "res.js"]);

  const indexHtml = await readFile(path.join(extractedDirectory, "index.html"), "utf8");
  const resourceJavaScript = await readFile(path.join(extractedDirectory, "res.js"), "utf8");
  assert.match(indexHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(indexHtml, /window\.FbPlayableAd\.onCTAClick/);
  assert.match(indexHtml, /<script src="res\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /window\.__PACK_ARCHIVE__/);
  assert.match(resourceJavaScript, /window\.__PACK_ARCHIVE__/);
  assert.match(resourceJavaScript, /window\.__facebookWebTest/);
  new Script(resourceJavaScript);

  const previewResponse = await fetch(`${server.url}${job.links?.preview}`);
  assert.equal(previewResponse.ok, true);
  assert.match(previewResponse.headers.get("content-type") ?? "", /text\/html/);
  const previewHtml = await previewResponse.text();
  assert.match(previewHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(previewHtml, /window\.__PACK_ARCHIVE__/);
  assert.doesNotMatch(previewHtml, /<script src="res\.js"><\/script>/);

  const reportResponse = await fetch(`${server.url}${job.links?.report}`);
  assert.equal(reportResponse.ok, true);
  const report = await reportResponse.json() as Record<string, unknown>;
  const channel = report.channel as Record<string, unknown>;
  const delivery = report.delivery as Record<string, unknown>;
  const entryBytes = delivery.entryBytes as Record<string, unknown>;
  assert.equal(channel.integrationStatus, "channel-delivery-ready");
  assert.equal(delivery.format, "zip-html-res-js");
  assert.equal(delivery.fileName, "facebook-playable.zip");
  assert.deepEqual(delivery.entries, ["index.html", "res.js"]);
  assert.equal(delivery.bytes, downloadedZip.length);
  assert.equal(typeof delivery.sha256, "string");
  assert.equal(typeof entryBytes["index.html"], "number");
  assert.equal(typeof entryBytes["res.js"], "number");
} finally {
  await server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Facebook Web delivery self-test passed.");
