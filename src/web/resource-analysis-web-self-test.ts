import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AssetsManifest } from "../resource-analysis/assets-manifest.js";
import { calculateCrc32 } from "./zip-extractor.js";
import { startResourceAnalysisWebMvpServer } from "./resource-analysis-web-server.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";

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

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload;
}

async function createAnalysisJob(baseUrl: string, zip: Buffer): Promise<Record<string, unknown>> {
  const payload = await readJson(await fetch(`${baseUrl}/api/resource-analysis/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
    },
    body: bufferToArrayBuffer(zip),
  }));
  return payload.job as Record<string, unknown>;
}

async function waitForTerminalJob(baseUrl: string, jobId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = await readJson(await fetch(`${baseUrl}/api/resource-analysis/jobs/${jobId}`));
    const job = payload.job as Record<string, unknown>;
    if (["succeeded", "failed"].includes(String(job.status))) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待资源体检任务完成超时。");
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "resource-analysis-web-"));
const server = await startResourceAnalysisWebMvpServer({
  host: "127.0.0.1",
  port: 0,
  rootDirectory: path.join(temporaryRoot, ".packer-web"),
  projectRoot: temporaryRoot,
  versionInfo: createFallbackWebVersionInfo(),
});

try {
  const page = await (await fetch(server.url)).text();
  assert.match(page, /资源体检/);
  assert.match(page, /downloadManifestCmdButton/);

  const sourceUuid = "12345678-1234-1234-1234-123456789abc";
  const zip = createStoredZip([
    {
      name: "web-mobile/index.html",
      data: Buffer.from("<!doctype html><title>Cocos test</title>", "utf8"),
    },
    {
      name: "web-mobile/assets/main/config.json",
      data: Buffer.from(JSON.stringify({ name: "main", uuids: [sourceUuid] }), "utf8"),
    },
    {
      name: "web-mobile/assets/main/native/12/12345678-1234-1234-1234-123456789abc.png",
      data: Buffer.from([1, 2, 3, 4]),
    },
  ]);

  const jointCreated = await createAnalysisJob(server.url, zip);
  const jointId = String(jointCreated.id);
  const links = jointCreated.links as Record<string, unknown>;
  const cmdResponse = await fetch(`${server.url}${String(links.manifestCmd)}`);
  assert.equal(cmdResponse.ok, true);
  assert.match(await cmdResponse.text(), /upload-assets-manifest\.cmd|工程资源扫描/);

  const manifest: AssetsManifest = {
    version: 1,
    generatedAt: new Date(0).toISOString(),
    projectName: "fixture",
    assetsRoot: "assets",
    resourceCount: 2,
    totalBytes: 14,
    metaCount: 2,
    missingMetaCount: 0,
    entries: [
      {
        path: "assets/ui/button.png",
        extension: ".png",
        bytes: 4,
        sha256: "a".repeat(64),
        modifiedAt: new Date(0).toISOString(),
        metaPath: "assets/ui/button.png.meta",
        uuid: sourceUuid,
        importer: "image",
        bundleName: "main",
      },
      {
        path: "assets/scripts/main.ts",
        extension: ".ts",
        bytes: 10,
        sha256: "b".repeat(64),
        modifiedAt: new Date(0).toISOString(),
        metaPath: "assets/scripts/main.ts.meta",
        uuid: "22345678-1234-1234-1234-123456789abc",
        importer: "typescript",
        bundleName: null,
      },
    ],
  };

  await readJson(await fetch(`${server.url}/api/resource-analysis/jobs/${jointId}/manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(manifest),
  }));
  await readJson(await fetch(`${server.url}/api/resource-analysis/jobs/${jointId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ requireManifest: true }),
  }));

  const jointJob = await waitForTerminalJob(server.url, jointId);
  assert.equal(jointJob.status, "succeeded", JSON.stringify(jointJob));
  assert.equal(jointJob.mode, "joint");
  const jointReport = await readJson(await fetch(`${server.url}${String(links.report)}`));
  assert.equal(jointReport.includedCount, 1);
  assert.equal(jointReport.notAssessableCount, 1);
  assert.equal(jointReport.assessableIncludedPercentByCount, 100);

  const basicCreated = await createAnalysisJob(server.url, zip);
  const basicId = String(basicCreated.id);
  await readJson(await fetch(`${server.url}/api/resource-analysis/jobs/${basicId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ requireManifest: false }),
  }));
  const basicJob = await waitForTerminalJob(server.url, basicId);
  assert.equal(basicJob.status, "succeeded", JSON.stringify(basicJob));
  assert.equal(basicJob.mode, "build-only");
  const basicLinks = basicCreated.links as Record<string, unknown>;
  const basicReport = await readJson(await fetch(`${server.url}${String(basicLinks.report)}`));
  assert.equal(basicReport.buildFileCount, 3);
  assert.equal(basicReport.sourceResourceCount, 0);
} finally {
  await server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("resource analysis Web API self-test passed");
