import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";

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
import { calculateCrc32 } from "./zip-extractor.js";

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

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
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

  const indexHtml = await readFile(path.join(request.inputDirectory, "index.html"), "utf8");
  assert.match(indexHtml, /Cocos test/);

  options.onEvent?.({
    type: "state",
    stage: "running",
    timestamp: new Date().toISOString(),
    elapsedMs: 1,
    message: rawMode ? "模拟未压缩单 HTML 已启动。" : "模拟 Pipeline 已启动。",
  });
  options.onEvent?.({
    type: "log",
    stream: "stdout",
    timestamp: new Date().toISOString(),
    elapsedMs: 2,
    line: rawMode ? "模拟未压缩打包日志" : "模拟打包日志",
  });

  await mkdir(path.dirname(request.outputFile), { recursive: true });
  const html = rawMode
    ? "<!doctype html><title>Raw playable test</title><script>window.__raw=true</script>"
    : "<!doctype html><title>Playable test</title><script>window.__ok=true</script>";
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
    const status = job.status;
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
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
assert.deepEqual(defaults, {
  buildMode: "optimized",
  imageMode: "webp",
  pngQuality: 80,
  jpegQuality: 80,
  audioBitrateKbps: null,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
  channel: {
    platform: "Preview",
    androidStoreUrl: null,
    iosStoreUrl: null,
  },
});
assert.throws(
  () => normalizeWebBuildConfig({ imageMode: "tinypng" }),
  /none、squoosh 或 webp/,
);
assert.equal(
  normalizeWebBuildConfig({ audioBitrateKbps: null }).audioBitrateKbps,
  null,
);
assert.equal(
  normalizeWebBuildConfig({ audioBitrateKbps: 48 }).audioBitrateKbps,
  48,
);
assert.equal(
  normalizeWebBuildConfig({ channel: { platform: "Google" } }).channel.platform,
  "Google",
);

const generatedIndexHtml = createChannelWebMvpIndexHtml();
const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(generatedIndexHtml);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);
assert.match(inlineScript, /recentLogs\.join\('\n'\)/);
assert.match(generatedIndexHtml, /仅合并单 HTML（不压缩）/);
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
  const health = await readJson(await fetch(`${server.url}/api/health`));
  assert.equal(health.status, "ok");

  const indexResponse = await fetch(`${server.url}/`);
  assert.equal(indexResponse.ok, true);
  assert.match(await indexResponse.text(), /channelPlatform/);

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
  assert.equal(typeof upload.uploadId, "string");
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
  const jobId = createdJob.id;
  assert.equal(typeof jobId, "string");

  const job = await waitForTerminalJob(server.url, jobId as string);
  assert.equal(job.status, "succeeded");
  const jobConfig = job.config as Record<string, unknown>;
  assert.equal(jobConfig.buildMode, "optimized");
  const jobChannel = jobConfig.channel as Record<string, unknown>;
  assert.equal(jobChannel.platform, "Google");
  assert.equal(jobChannel.androidStoreUrl, TEST_ANDROID_STORE_URL);
  assert.equal(typeof job.outputSha256, "string");
  assert.match((job.recentLogs as string[]).join("\n"), /模拟打包日志/);

  const htmlResponse = await fetch(`${server.url}/artifacts/${jobId}/game.html?download=1`);
  assert.equal(htmlResponse.ok, true);
  assert.match(await htmlResponse.text(), /Playable test/);
  assert.match(htmlResponse.headers.get("content-disposition") ?? "", /attachment/);

  const reportResponse = await fetch(`${server.url}/artifacts/${jobId}/report.json`);
  assert.equal(reportResponse.ok, true);
  const report = await reportResponse.json() as Record<string, unknown>;
  assert.equal(report.schemaVersion, 3);
  const reportChannel = report.channel as Record<string, unknown>;
  assert.equal(reportChannel.platform, "Google");
  assert.equal(reportChannel.deliveryFormat, "zip-html-res-js");
  assert.equal(reportChannel.integrationStatus, "profile-only");
  assert.deepEqual(reportChannel.requiredGlobals, ["ExitApi"]);

  const reportDownloadResponse = await fetch(
    `${server.url}/artifacts/${jobId}/report.json?download=1`,
  );
  assert.equal(reportDownloadResponse.ok, true);
  assert.match(reportDownloadResponse.headers.get("content-disposition") ?? "", /attachment/);

  const previewResponse = await fetch(`${server.url}/preview/${jobId}/`);
  assert.equal(previewResponse.ok, true);
  assert.match(await previewResponse.text(), /Playable test/);

  const rawUpload = await uploadZip(server.url, zip);
  const rawCreatePayload = await readJson(await fetch(`${server.url}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: rawUpload.uploadId,
      config: {
        buildMode: "raw-single-html",
        imageMode: "webp",
        audioBitrateKbps: 48,
        payloadEncoding: "html7",
        channel: {
          platform: "AppLovin",
          androidStoreUrl: TEST_ANDROID_STORE_URL,
        },
      },
    }),
  }));
  const rawCreatedJob = rawCreatePayload.job as Record<string, unknown>;
  const rawJob = await waitForTerminalJob(server.url, rawCreatedJob.id as string);
  assert.equal(rawJob.status, "succeeded");
  const rawConfig = rawJob.config as Record<string, unknown>;
  assert.equal(rawConfig.buildMode, "raw-single-html");
  assert.equal(rawConfig.imageMode, "none");
  assert.equal(rawConfig.audioBitrateKbps, null);
  assert.equal(rawConfig.payloadEncoding, "base64");
  assert.equal((rawConfig.channel as Record<string, unknown>).platform, "AppLovin");
  assert.match((rawJob.recentLogs as string[]).join("\n"), /模拟未压缩打包日志/);

  const rawHtmlResponse = await fetch(
    `${server.url}/artifacts/${String(rawCreatedJob.id)}/game.html`,
  );
  assert.equal(rawHtmlResponse.ok, true);
  assert.match(await rawHtmlResponse.text(), /Raw playable test/);

  const rawReportResponse = await fetch(
    `${server.url}/artifacts/${String(rawCreatedJob.id)}/report.json`,
  );
  const rawReport = await readJson(rawReportResponse);
  assert.equal((rawReport.channel as Record<string, unknown>).bridge, "mraid");

  const unsafeZip = createStoredZip([
    { name: "../escape.txt", data: Buffer.from("bad", "utf8") },
  ]);
  const unsafeUpload = await uploadZip(server.url, unsafeZip);
  const unsafeCreatePayload = await readJson(await fetch(`${server.url}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId: unsafeUpload.uploadId }),
  }));
  const unsafeCreatedJob = unsafeCreatePayload.job as Record<string, unknown>;
  const unsafeJob = await waitForTerminalJob(server.url, unsafeCreatedJob.id as string);
  assert.equal(unsafeJob.status, "failed");
  assert.equal((unsafeJob.error as Record<string, unknown>).code, "UNSAFE_ZIP_PATH");
} finally {
  await server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Playable Web MVP self-test passed.");
