import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startEnhancedResourceAnalysisWebMvpServer } from "./resource-analysis-enhanced-web-server.js";
import { calculateCrc32 } from "./zip-extractor.js";

function createStoredZip(entries: readonly { name: string; data: Buffer }[]): Buffer {
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
  const copy = new Uint8Array(buffer.length);
  copy.set(buffer);
  return copy.buffer;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as Record<string, unknown>;
  assert.equal(response.ok, true, JSON.stringify(value));
  return value;
}

const root = await mkdtemp(path.join(os.tmpdir(), "enhanced-resource-web-"));
const server = await startEnhancedResourceAnalysisWebMvpServer({
  host: "127.0.0.1",
  port: 0,
  rootDirectory: path.join(root, ".packer-web"),
  projectRoot: root,
});
try {
  const page = await (await fetch(server.url)).text();
  assert.match(page, /图片与音频优化估算/);
  assert.match(page, /压缩收益明细/);
  assert.match(page, /data-analysis-subtab/);
  assert.match(page, /Playable Payload 编码体积/);
  assert.match(page, /id="analysisPayloadEncoding" type="checkbox"/);
  assert.match(page, /分析时间会明显延长/);
  assert.match(page, /最终单 HTML（/);
  assert.match(page, /下载 HTML 报告/);

  const zip = createStoredZip([
    { name: "web-mobile/index.html", data: Buffer.from("<!doctype html><title>test</title>") },
    { name: "web-mobile/assets/main/config.json", data: Buffer.from('{"name":"main","uuids":[]}') },
  ]);
  const created = await readJson(await fetch(`${server.url}/api/resource-analysis/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/zip", "Content-Length": String(zip.length) },
    body: bufferToArrayBuffer(zip),
  }));
  const job = created.job as Record<string, unknown>;
  const jobId = String(job.id);

  const cmdResponse = await fetch(`${server.url}/api/resource-analysis/jobs/${jobId}/assets-manifest.cmd?measurePayloadEncoding=1`);
  assert.equal(cmdResponse.ok, true);
  assert.match(await cmdResponse.text(), /measurePayloadEncoding=1/);

  const started = await readJson(await fetch(`${server.url}/api/resource-analysis/jobs/${jobId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requireManifest: false, measurePayloadEncoding: false }),
  }));
  assert.equal((started.job as Record<string, unknown>).measurePayloadEncoding, false);

  let completed: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = (await readJson(await fetch(`${server.url}/api/resource-analysis/jobs/${jobId}`))).job as Record<string, unknown>;
    if (current.status === "succeeded" || current.status === "failed") {
      completed = current;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert(completed !== null);
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  assert.equal(completed.measurePayloadEncoding, false);
  const links = completed.links as Record<string, unknown>;
  const reportJson = await readJson(await fetch(`${server.url}${String(links.report)}`));
  const payload = reportJson.payloadEncoding as Record<string, unknown>;
  assert.equal(payload.status, "unavailable");
  assert.match(JSON.stringify(payload.warnings), /未启用 Playable Payload 编码体积测量/);

  const htmlResponse = await fetch(`${server.url}${String(links.htmlReport)}`);
  assert.equal(htmlResponse.ok, true);
  assert.match(htmlResponse.headers.get("content-type") ?? "", /text\/html/);
  const reportHtml = await htmlResponse.text();
  assert.match(reportHtml, /Cocos 构建资源体检报告/);
  assert.match(reportHtml, /data-report-tab="overview"/);
  assert.match(reportHtml, /压缩收益明细/);
  assert.match(reportHtml, /Playable Payload 编码体积/);
  assert.match(reportHtml, /未启用 Playable Payload 编码体积测量/);
  assert.match(reportHtml, /报告不会自动修改或选择打包配置/);
  assert.doesNotMatch(reportHtml, /<script[^>]+src=/i);
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}

console.log("enhanced resource analysis Web self-test passed");
