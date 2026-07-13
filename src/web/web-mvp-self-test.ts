import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  BuildPlayableRequest,
  BuildPlayableResult,
  BuildPlayableServiceOptions,
} from "../service/build-playable-types.js";
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

const observedBuilds: Array<{
  request: BuildPlayableRequest;
  tinyPngApiKey: string | undefined;
}> = [];

async function fakeBuildPlayable(
  request: BuildPlayableRequest,
  options: BuildPlayableServiceOptions = {},
): Promise<BuildPlayableResult> {
  observedBuilds.push({
    request,
    tinyPngApiKey: options.environment?.TINYPNG_API_KEY,
  });
  assert.match(
    await readFile(path.join(request.inputDirectory, "index.html"), "utf8"),
    /Cocos test/,
  );
  options.onEvent?.({
    type: "log",
    stream: "stdout",
    timestamp: new Date().toISOString(),
    elapsedMs: 1,
    line: "模拟打包日志",
  });

  await mkdir(path.dirname(request.outputFile), { recursive: true });
  const html = "<!doctype html><title>Playable test</title>";
  await writeFile(request.outputFile, html, "utf8");
  const outputSha256 = createHash("sha256").update(html).digest("hex");
  const reportFile = request.outputFile.replace(/\.html$/i, ".report.json");
  const report = {
    schemaVersion: 3,
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

async function uploadZip(baseUrl: string, zip: Buffer): Promise<string> {
  const payload = await readJson(await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
    },
    body: bufferToArrayBuffer(zip),
  }));
  return String((payload.upload as Record<string, unknown>).uploadId);
}

async function createJob(
  baseUrl: string,
  uploadId: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload = await readJson(await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, config }),
  }));
  return payload.job as Record<string, unknown>;
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

  const normalUploadId = await uploadZip(server.url, zip);
  const normalCreated = await createJob(server.url, normalUploadId, {
    imageMode: "webp",
    channel: { platform: "Preview" },
  });
  const normalJob = await waitForTerminalJob(server.url, String(normalCreated.id));
  assert.equal(normalJob.status, "succeeded");
  assert.equal(observedBuilds[0]?.request.image.mode, "webp");
  assert.equal(observedBuilds[0]?.tinyPngApiKey, undefined);

  const secret = "test-tinypng-secret-key";
  const tinyUploadId = await uploadZip(server.url, zip);
  const tinyCreated = await createJob(server.url, tinyUploadId, {
    imageMode: "tinypng",
    tinyPngApiKey: secret,
    tinyPngScope: "limit",
    tinyPngLimit: 12,
    tinyPngMinBytes: 2048,
    channel: { platform: "Preview" },
  });
  assert.equal(JSON.stringify(tinyCreated).includes(secret), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      tinyCreated.config as Record<string, unknown>,
      "tinyPngApiKey",
    ),
    false,
  );

  const tinyJob = await waitForTerminalJob(server.url, String(tinyCreated.id));
  assert.equal(tinyJob.status, "succeeded");
  assert.equal(JSON.stringify(tinyJob).includes(secret), false);
  assert.deepEqual(observedBuilds[1]?.request.image, {
    mode: "tinypng",
    scope: { type: "limit", limit: 12 },
    minBytes: 2048,
  });
  assert.equal(observedBuilds[1]?.tinyPngApiKey, secret);

  const missingKeyUploadId = await uploadZip(server.url, zip);
  const missingKeyResponse = await fetch(`${server.url}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: missingKeyUploadId,
      config: {
        imageMode: "tinypng",
        tinyPngScope: "all",
      },
    }),
  });
  assert.equal(missingKeyResponse.status, 400);
  const missingKeyPayload = await missingKeyResponse.json() as Record<string, unknown>;
  assert.match(JSON.stringify(missingKeyPayload), /TINYPNG_API_KEY/);

  const reportResponse = await fetch(`${server.url}/artifacts/${String(tinyCreated.id)}/report.json`);
  assert.equal(reportResponse.ok, true);
  assert.equal((await reportResponse.text()).includes(secret), false);
} finally {
  await server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Playable Web MVP TinyPNG isolation self-test passed.");
