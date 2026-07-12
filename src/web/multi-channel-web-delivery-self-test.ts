import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CHANNEL_DOWNLOAD_BRIDGE_MARKER } from "../channel/channel-download-bridge.js";
import { createChannelDownloadArtifact } from "../channel/liftoff-delivery.js";
import type {
  BuildPlayableRequest,
  BuildPlayableResult,
} from "../service/build-playable-types.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";
import { startWebMvpServer } from "./web-mvp-server.js";
import { extractZipArchive } from "./zip-extractor.js";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "multi-channel-web-test-"));

async function fakeBuildPlayable(
  request: BuildPlayableRequest,
): Promise<BuildPlayableResult> {
  const html = `<!doctype html><html><head></head><body><script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"base64","b":"QQ=="};
(function () {
  async function boot() { window.__multiChannelWebTest = true; }
  boot().catch(function (error) { console.error(error); });
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
      sha256: "base-test-sha",
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
    outputSha256: "base-test-sha",
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = server.manager.getJob(jobId);
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
    "<!doctype html><title>Multi-channel input</title>",
    {
      platform: "Liftoff",
      androidStoreUrl: null,
      iosStoreUrl: null,
    },
  );
  const uploadId = randomUUID();
  const uploadPath = server.manager.createUploadPath(uploadId);
  await writeFile(uploadPath, inputArtifact.body);
  server.manager.registerUpload(uploadId, uploadPath, inputArtifact.body.length);

  const created = server.manager.createJob(uploadId, {
    channel: {
      platform: "Preview",
      platforms: ["Preview", "Google", "IronSource"],
      androidStoreUrl: "https://play.google.com/store/apps/details?id=com.google.android.apps.maps",
      iosStoreUrl: "https://apps.apple.com/app/google-maps/id585027354",
    },
  });
  const job = await waitForJob(server, created.id);
  assert.equal(job.status, "succeeded", JSON.stringify(job.error));
  assert.deepEqual(job.config.channel.platforms, ["Preview", "Google", "IronSource"]);
  assert.notEqual(job.links, null);

  const bundleResponse = await fetch(`${server.url}${job.links?.html}?download=1&bundle=1`);
  assert.equal(bundleResponse.ok, true);
  assert.match(bundleResponse.headers.get("content-type") ?? "", /application\/zip/);
  assert.match(
    bundleResponse.headers.get("content-disposition") ?? "",
    /playable-channel-bundle\.zip/,
  );
  const bundleBytes = Buffer.from(await bundleResponse.arrayBuffer());
  const bundleFile = path.join(temporaryRoot, "playable-channel-bundle.zip");
  const bundleDirectory = path.join(temporaryRoot, "bundle");
  await writeFile(bundleFile, bundleBytes);
  const extraction = await extractZipArchive(bundleFile, bundleDirectory);
  assert.equal(extraction.fileCount, 4);
  assert.equal(
    (await readFile(path.join(bundleDirectory, "channels", "preview", "game.html"), "utf8"))
      .includes(CHANNEL_DOWNLOAD_BRIDGE_MARKER),
    true,
  );
  assert.equal(
    (await readFile(path.join(bundleDirectory, "channels", "google", "google-playable.zip")))
      .readUInt32LE(0),
    0x04034b50,
  );
  assert.match(
    await readFile(
      path.join(bundleDirectory, "channels", "ironsource", "ironsource-playable.html"),
      "utf8",
    ),
    /window\.mraid\.open/,
  );

  const reportResponse = await fetch(`${server.url}${job.links?.report}?download=1&bundle=1`);
  assert.equal(reportResponse.ok, true);
  assert.match(
    reportResponse.headers.get("content-disposition") ?? "",
    /playable-channel-report\.json/,
  );
  const report = await reportResponse.json() as Record<string, unknown>;
  const channels = report.channels as unknown[];
  const deliveries = report.deliveries as unknown[];
  const bundle = report.bundle as Record<string, unknown>;
  const reuse = report.reuse as Record<string, unknown>;
  assert.equal(channels.length, 3);
  assert.equal(deliveries.length, 3);
  assert.equal(bundle.fileName, "playable-channel-bundle.zip");
  assert.equal(bundle.bytes, bundleBytes.length);
  assert.equal(reuse.baseBuildExecutions, 1);
  assert.equal(reuse.selectedChannelCount, 3);
  assert.equal(report.channel, undefined);
  assert.equal(report.delivery, undefined);

  const googlePreview = await fetch(`${server.url}${job.links?.preview}?channel=Google`);
  assert.equal(googlePreview.ok, true);
  const googleHtml = await googlePreview.text();
  assert.match(googleHtml, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(googleHtml, /window\.ExitApi\.exit/);

  const ironSourcePreview = await fetch(`${server.url}${job.links?.preview}?channel=IronSource`);
  assert.equal(ironSourcePreview.ok, true);
  assert.match(await ironSourcePreview.text(), /window\.__runGame/);

  const unselectedPreview = await fetch(`${server.url}${job.links?.preview}?channel=Facebook`);
  assert.equal(unselectedPreview.status, 400);
} finally {
  await server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Multi-channel Web delivery self-test passed.");
