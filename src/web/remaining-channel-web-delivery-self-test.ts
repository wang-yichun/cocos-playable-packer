import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CHANNEL_DOWNLOAD_BRIDGE_MARKER } from "../channel/channel-download-bridge.js";
import {
  createChannelDownloadArtifact,
  GOOGLE_EXIT_API_URL,
} from "../channel/liftoff-delivery.js";
import {
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
  type ChannelPlatform,
} from "../channel/channel-profile.js";
import type {
  BuildPlayableRequest,
  BuildPlayableResult,
} from "../service/build-playable-types.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";
import { startWebMvpServer } from "./web-mvp-server.js";
import { extractZipArchive } from "./zip-extractor.js";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "remaining-channel-web-test-"));

async function fakeBuildPlayable(
  request: BuildPlayableRequest,
): Promise<BuildPlayableResult> {
  const html = `<!doctype html><html><head></head><body><script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"base64","b":"QQ=="};
(function () {
    async function boot() {
        window.__remainingWebTest = true;
    }
    boot().catch(
        function (error) {
            console.error(error);
        }
    );
})();
</script></body></html>`;
  await mkdir(path.dirname(request.outputFile), { recursive: true });
  await writeFile(request.outputFile, html, "utf8");
  const reportFile = request.outputFile.replace(/\.html$/i, ".report.json");
  const report = {
    schemaVersion: 3,
    status: "succeeded",
    output: {
      file: request.outputFile,
      bytes: Buffer.byteLength(html),
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
    outputBytes: Buffer.byteLength(html),
    outputSha256: "test-sha",
    startedAt: now,
    completedAt: now,
    durationMs: 1,
    report,
  };
}

async function waitForJob(
  server: Awaited<ReturnType<typeof startWebMvpServer>>,
  jobId: string,
) {
  let job = server.manager.getJob(jobId);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    job = server.manager.getJob(jobId);
    assert.notEqual(job, null);
    if (job !== null && ["succeeded", "failed", "cancelled"].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`任务等待超时：${jobId}`);
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
  const inputArtifact = createChannelDownloadArtifact(
    "<!doctype html><title>Remaining channel input</title>",
    {
      platform: "Liftoff",
      androidStoreUrl: TEST_ANDROID_STORE_URL,
      iosStoreUrl: TEST_IOS_STORE_URL,
    },
  );

  const cases: Array<{
    platform: ChannelPlatform;
    fileName: string;
    contentType: RegExp;
    deliveryFormat: string;
    bridgeMarker: RegExp;
  }> = [
    {
      platform: "AppLovin",
      fileName: "applovin-playable.html",
      contentType: /text\/html/,
      deliveryFormat: "single-html",
      bridgeMarker: /window\.mraid\.open/,
    },
    {
      platform: "Google",
      fileName: "google-playable.zip",
      contentType: /application\/zip/,
      deliveryFormat: "zip-html-res-js",
      bridgeMarker: /window\.ExitApi\.exit/,
    },
    {
      platform: "IronSource",
      fileName: "ironsource-playable.html",
      contentType: /text\/html/,
      deliveryFormat: "single-html",
      bridgeMarker: /window\.mraid\.open/,
    },
    {
      platform: "Unity",
      fileName: "unity-playable.html",
      contentType: /text\/html/,
      deliveryFormat: "single-html",
      bridgeMarker: /window\.mraid\.open/,
    },
    {
      platform: "Moloco",
      fileName: "moloco-playable.html",
      contentType: /text\/html/,
      deliveryFormat: "single-html",
      bridgeMarker: /api\.onCTAClick\s*\(\s*\)/,
    },
  ];

  for (const testCase of cases) {
    // WebJobManager 会在 createJob 时消费上传记录；每个渠道用独立上传，
    // 既符合真实 API 行为，也避免测试错误复用已经消费的 uploadId。
    const caseUploadId = randomUUID();
    const caseUploadPath = server.manager.createUploadPath(caseUploadId);
    await writeFile(caseUploadPath, inputArtifact.body);
    server.manager.registerUpload(caseUploadId, caseUploadPath, inputArtifact.body.length);

    const created = server.manager.createJob(caseUploadId, {
      channel: {
        platform: testCase.platform,
        androidStoreUrl: TEST_ANDROID_STORE_URL,
        iosStoreUrl: TEST_IOS_STORE_URL,
      },
    });
    const job = await waitForJob(server, created.id);
    assert.equal(job.status, "succeeded", JSON.stringify(job.error));
    assert.notEqual(job.links, null);

    const downloadResponse = await fetch(`${server.url}${job.links?.html}?download=1`);
    assert.equal(downloadResponse.ok, true);
    assert.match(downloadResponse.headers.get("content-type") ?? "", testCase.contentType);
    assert.match(
      downloadResponse.headers.get("content-disposition") ?? "",
      new RegExp(testCase.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());

    if (testCase.platform === "Google") {
      const zipFile = path.join(temporaryRoot, `download-${created.id}.zip`);
      const extractedDirectory = path.join(temporaryRoot, `extract-${created.id}`);
      await writeFile(zipFile, downloaded);
      const extraction = await extractZipArchive(zipFile, extractedDirectory);
      assert.equal(extraction.fileCount, 2);
      assert.deepEqual((await readdir(extractedDirectory)).sort(), ["index.html", "res.js"]);
      const indexHtml = await readFile(path.join(extractedDirectory, "index.html"), "utf8");
      assert.match(indexHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
      assert.match(indexHtml, testCase.bridgeMarker);
      assert.match(indexHtml, new RegExp(GOOGLE_EXIT_API_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } else {
      const html = downloaded.toString("utf8");
      assert.match(html, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
      assert.match(html, testCase.bridgeMarker);
    }

    const previewResponse = await fetch(`${server.url}${job.links?.preview}`);
    assert.equal(previewResponse.ok, true);
    assert.match(previewResponse.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await previewResponse.text(), new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));

    const reportResponse = await fetch(`${server.url}${job.links?.report}`);
    assert.equal(reportResponse.ok, true);
    const report = await reportResponse.json() as Record<string, unknown>;
    const channel = report.channel as Record<string, unknown>;
    const delivery = report.delivery as Record<string, unknown>;
    assert.equal(channel.integrationStatus, "channel-delivery-ready");
    assert.equal(delivery.format, testCase.deliveryFormat);
    assert.equal(delivery.fileName, testCase.fileName);
    assert.equal(delivery.bytes, downloaded.length);
    assert.equal(typeof delivery.sha256, "string");
  }
} finally {
  await server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Remaining channel Web delivery self-test passed.");
