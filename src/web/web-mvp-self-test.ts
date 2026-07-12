import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";

import { CHANNEL_DOWNLOAD_BRIDGE_MARKER } from "../channel/channel-download-bridge.js";
import {
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
} from "../channel/channel-profile.js";
import type {
  BuildPlayableRequest,
  BuildPlayableResult,
  BuildPlayableServiceOptions,
} from "../service/build-playable-types.js";
import { normalizeWebBuildConfig } from "./web-build-config.js";
import { createChannelWebMvpIndexHtml } from "./web-channel-ui.js";
import { startWebMvpServer } from "./web-mvp-server.js";
import { calculateCrc32, extractZipArchive } from "./zip-extractor.js";

interface StoredZipEntry {
  name: string;
  data: Buffer;
}

function createStoredZip(entries: readonly StoredZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc32 = calculateCrc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);

    localOffset += local.length + entry.data.length;
  }

  const localDirectory = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localDirectory.length, 16);
  return Buffer.concat([localDirectory, centralDirectory, end]);
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

function isRawSingleHtmlScript(scriptPath: string | undefined): boolean {
  return scriptPath?.replace(/\\/g, "/").endsWith("/src/web/raw-single-html-cli.ts") === true;
}

async function fakeBuildPlayable(
  request: BuildPlayableRequest,
  options: BuildPlayableServiceOptions = {},
): Promise<BuildPlayableResult> {
  const rawMode = isRawSingleHtmlScript(options.scriptPath);
  if (rawMode) {
    assert.equal(request.image.mode, "none");
    assert.equal(request.payloadEncoding, "base64");
    assert.equal(request.brotliFallback, "raw-js");
    assert.equal(request.audio, null);
  } else {
    assert.equal(request.image.mode, "webp");
    assert.equal(request.payloadEncoding, "html7");
    assert.equal(request.brotliFallback, "raw-js");
    assert.equal(request.audio, null);
  }

  assert.match(
    await readFile(path.join(request.inputDirectory, "index.html"), "utf8"),
    /Cocos test/,
  );
  options.onEvent?.({
    type: "log",
    stream: "stdout",
    timestamp: new Date().toISOString(),
    elapsedMs: 1,
    line: rawMode ? "模拟未压缩打包日志" : "模拟打包日志",
  });

  await mkdir(path.dirname(request.outputFile), { recursive: true });
  const html = rawMode
    ? "<!doctype html><title>Raw playable test</title><script>window.__raw=true</script>"
    : `<!doctype html><html><head><title>Playable test</title></head><body><script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"base64","b":"QQ=="};
(function () {
    async function boot() {
        window.__ok = true;
    }
    boot().catch(
        function (error) {
            console.error(error);
        }
    );
})();
</script></body></html>`;
  await writeFile(request.outputFile, html, "utf8");
  const outputSha256 = createHash("sha256").update(html).digest("hex");
  const reportFile = request.outputFile.replace(/\.html$/i, ".report.json");
  const report = {
    schemaVersion: rawMode ? 1 : 3,
    buildMode: rawMode ? "raw-single-html" : "optimized",
    output: {
      file: request.outputFile,
      bytes: Buffer.byteLength(html),
      sha256: outputSha256,
      reportFile,
    },
  };
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return {
    status: "succeeded",
    outputFile: request.outputFile,
    reportFile,
    outputBytes: Buffer.byteLength(html),
    outputSha256,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 3,
    report,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload;
}

async function waitForTerminalJob(baseUrl: string, jobId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = await readJson(await fetch(`${baseUrl}/api/jobs/${jobId}`));
    const job = payload.job as Record<string, unknown>;
    if (["succeeded", "failed", "cancelled"].includes(String(job.status))) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待 Web 任务完成超时。");
}

async function uploadZip(baseUrl: string, zip: Buffer): Promise<Record<string, unknown>> {
  const payload = await readJson(await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
    },
    body: bufferToArrayBuffer(zip),
  }));
  return payload.upload as Record<string, unknown>;
}

const defaults = normalizeWebBuildConfig(undefined);
assert.equal(defaults.channel.platform, "Preview");
assert.equal(normalizeWebBuildConfig({ channel: { platform: "Google" } }).channel.platform, "Google");
assert.throws(
  () => normalizeWebBuildConfig({ imageMode: "tinypng" }),
  /none、squoosh 或 webp/,
);

const generatedIndexHtml = createChannelWebMvpIndexHtml();
const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(generatedIndexHtml);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);
assert.equal(inlineScript.includes("recentLogs.join('\\n')"), true);
assert.match(generatedIndexHtml, /目标渠道/);
assert.match(generatedIndexHtml, /Google Maps 测试链接/);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "playable-web-mvp-"));
const server = await startWebMvpServer({
  host: "127.0.0.1",
  port: 0,
  rootDirectory: path.join(temporaryRoot, ".packer-web"),
  projectRoot: temporaryRoot,
  buildPlayableImpl: fakeBuildPlayable,
});

try {
  assert.equal((await readJson(await fetch(`${server.url}/api/health`))).status, "ok");

  const zip = createStoredZip([
    {
      name: "web-mobile/index.html",
      data: Buffer.from("<!doctype html><title>Cocos test</title>", "utf8"),
    },
    {
      name: "web-mobile/assets/test.txt",
      data: Buffer.from("asset", "utf8"),
    },
  ]);

  const upload = await uploadZip(server.url, zip);
  const createPayload = await readJson(await fetch(`${server.url}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: upload.uploadId,
      config: {
        channel: {
          platform: "Google",
          androidStoreUrl: TEST_ANDROID_STORE_URL,
          iosStoreUrl: TEST_IOS_STORE_URL,
        },
      },
    }),
  }));
  const createdJob = createPayload.job as Record<string, unknown>;
  const jobId = String(createdJob.id);
  const job = await waitForTerminalJob(server.url, jobId);
  assert.equal(job.status, "succeeded");
  assert.equal(
    ((job.config as Record<string, unknown>).channel as Record<string, unknown>).platform,
    "Google",
  );

  const htmlResponse = await fetch(`${server.url}/artifacts/${jobId}/game.html?download=1`);
  assert.equal(htmlResponse.ok, true);
  assert.match(htmlResponse.headers.get("content-type") ?? "", /application\/zip/);
  assert.match(htmlResponse.headers.get("content-disposition") ?? "", /google-playable\.zip/);
  const googleZip = Buffer.from(await htmlResponse.arrayBuffer());
  const googleZipFile = path.join(temporaryRoot, "google-playable.zip");
  const googleOutput = path.join(temporaryRoot, "google-output");
  await writeFile(googleZipFile, googleZip);
  const googleExtraction = await extractZipArchive(googleZipFile, googleOutput);
  assert.equal(googleExtraction.fileCount, 2);
  assert.deepEqual((await readdir(googleOutput)).sort(), ["index.html", "res.js"]);
  const servedIndex = await readFile(path.join(googleOutput, "index.html"), "utf8");
  const servedResource = await readFile(path.join(googleOutput, "res.js"), "utf8");
  assert.match(servedIndex, /Playable test/);
  assert.match(servedIndex, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
  assert.match(servedIndex, /window\.ExitApi\.exit/);
  assert.match(servedIndex, /com\.google\.android\.apps\.maps/);
  assert.match(servedResource, /window\.__PACK_ARCHIVE__/);

  const reportResponse = await fetch(`${server.url}/artifacts/${jobId}/report.json`);
  const report = await readJson(reportResponse);
  assert.equal(report.schemaVersion, 3);
  const reportChannel = report.channel as Record<string, unknown>;
  assert.equal(reportChannel.platform, "Google");
  assert.equal(reportChannel.deliveryFormat, "zip-html-res-js");
  assert.equal(reportChannel.integrationStatus, "channel-delivery-ready");
  assert.deepEqual(reportChannel.requiredGlobals, ["ExitApi"]);
  const reportDelivery = report.delivery as Record<string, unknown>;
  assert.equal(reportDelivery.fileName, "google-playable.zip");
  assert.deepEqual(reportDelivery.entries, ["index.html", "res.js"]);
  assert.equal(reportDelivery.bytes, googleZip.length);

  const previewResponse = await fetch(`${server.url}/preview/${jobId}/`);
  assert.equal(previewResponse.ok, true);
  assert.match(await previewResponse.text(), new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));

  const rawUpload = await uploadZip(server.url, zip);
  const rawCreatePayload = await readJson(await fetch(`${server.url}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: rawUpload.uploadId,
      config: {
        buildMode: "raw-single-html",
        channel: {
          platform: "AppLovin",
          androidStoreUrl: TEST_ANDROID_STORE_URL,
        },
      },
    }),
  }));
  const rawJobId = String((rawCreatePayload.job as Record<string, unknown>).id);
  const rawJob = await waitForTerminalJob(server.url, rawJobId);
  assert.equal(rawJob.status, "succeeded");
  const rawConfig = rawJob.config as Record<string, unknown>;
  assert.equal(rawConfig.buildMode, "raw-single-html");
  assert.equal(rawConfig.imageMode, "none");
  assert.equal((rawConfig.channel as Record<string, unknown>).platform, "AppLovin");

  const rawHtmlResponse = await fetch(`${server.url}/artifacts/${rawJobId}/game.html`);
  const rawHtml = await rawHtmlResponse.text();
  assert.match(rawHtml, /Raw playable test/);
  assert.match(rawHtml, /window\.mraid\.open/);

  const unsafeZip = createStoredZip([
    { name: "../escape.txt", data: Buffer.from("bad", "utf8") },
  ]);
  const unsafeUpload = await uploadZip(server.url, unsafeZip);
  const unsafeCreatePayload = await readJson(await fetch(`${server.url}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId: unsafeUpload.uploadId }),
  }));
  const unsafeJob = await waitForTerminalJob(
    server.url,
    String((unsafeCreatePayload.job as Record<string, unknown>).id),
  );
  assert.equal(unsafeJob.status, "failed");
  assert.equal((unsafeJob.error as Record<string, unknown>).code, "UNSAFE_ZIP_PATH");
} finally {
  await server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Playable Web MVP self-test passed.");
