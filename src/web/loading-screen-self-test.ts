import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";

import type {
  BuildPlayableRequest,
  BuildPlayableResult,
  BuildPlayableServiceOptions,
} from "../service/build-playable-types.js";
import {
  applyLoadingScreenToArtifact,
  injectLoadingScreen,
  LOADING_SCREEN_MARKER,
  MAX_LOADING_LOGO_BYTES,
  normalizeLoadingScreenConfig,
} from "./loading-screen.js";
import { createLoadingScreenWebMvpIndexHtml } from "./loading-screen-ui.js";
import { startLoadingScreenWebMvpServer } from "./loading-screen-web-server.js";
import { calculateCrc32 } from "./zip-extractor.js";

const logoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const normalized = normalizeLoadingScreenConfig({ enabled: true, logoDataUrl });
assert.notEqual(normalized, undefined);
assert.equal(normalized?.enabled, true);
assert.equal(normalized?.logoMimeType, "image/png");
assert.ok((normalized?.logoBytes ?? 0) > 0);
assert.deepEqual(normalizeLoadingScreenConfig({ enabled: false, logoDataUrl: "bad" }), {
  enabled: false,
  logoDataUrl: null,
  logoBytes: 0,
  logoMimeType: null,
});
assert.throws(
  () => normalizeLoadingScreenConfig({ enabled: true, logoDataUrl: "data:image/png;base64,QQ==" }),
  /文件内容与 MIME 类型不匹配/,
);
const oversizedPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(MAX_LOADING_LOGO_BYTES),
]);
assert.throws(
  () => normalizeLoadingScreenConfig({
    enabled: true,
    logoDataUrl: `data:image/png;base64,${oversizedPng.toString("base64")}`,
  }),
  /不能超过/,
);

const sourceHtml = "<!doctype html><html><head><title>Test</title></head><body><canvas></canvas></body></html>";
const injectedHtml = injectLoadingScreen(sourceHtml, normalized!);
assert.match(injectedHtml, new RegExp(LOADING_SCREEN_MARKER));
assert.match(injectedHtml, /#171717/);
assert.match(injectedHtml, /linear-gradient\(90deg,#3dc5de,#5ff8ff\)/);
assert.match(injectedHtml, /window\.__CPP_LOADING_SCREEN__/);
assert.match(injectedHtml, /WebGLRenderingContext/);
assert.match(injectedHtml, new RegExp(logoDataUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.throws(() => injectLoadingScreen(injectedHtml, normalized!), /已包含/);
const runtimeMatch = new RegExp(`<script ${LOADING_SCREEN_MARKER}="runtime">([\\s\\S]*?)<\\/script>`).exec(injectedHtml);
assert.notEqual(runtimeMatch, null);
new Script(runtimeMatch?.[1] ?? "");
const rawStyleless = injectLoadingScreen("<!doctype html><title>Raw</title>", normalized!);
assert.match(rawStyleless, /cpp-loading-screen/);
assert.match(rawStyleless, /<style/);

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

async function fakeBuildPlayable(
  request: BuildPlayableRequest,
  _options: BuildPlayableServiceOptions = {},
): Promise<BuildPlayableResult> {
  await mkdir(path.dirname(request.outputFile), { recursive: true });
  const html = `<!doctype html><html><head><title>Playable</title></head><body><canvas id="GameCanvas"></canvas><script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"base64","b":"QQ=="};
(function(){async function boot(){window.__loadingTest=true;}boot().catch(console.error);})();
</script></body></html>`;
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
    durationMs: 1,
    report,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload;
}

async function waitForJob(baseUrl: string, jobId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = await readJson(await fetch(`${baseUrl}/api/jobs/${jobId}`));
    const job = payload.job as Record<string, unknown>;
    if (["succeeded", "failed", "cancelled"].includes(String(job.status))) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待加载界面 Web 任务完成超时。");
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "playable-loading-screen-"));
try {
  const outputFile = path.join(temporaryRoot, "direct", "game.html");
  const reportFile = outputFile.replace(/\.html$/, ".report.json");
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, sourceHtml, "utf8");
  await writeFile(reportFile, JSON.stringify({ output: { bytes: Buffer.byteLength(sourceHtml), sha256: "old" } }), "utf8");
  const applied = await applyLoadingScreenToArtifact(outputFile, reportFile, normalized!);
  assert.equal(applied.injected, true);
  assert.ok(applied.addedBytes > normalized!.logoBytes);
  assert.equal(applied.outputSha256.length, 64);
  const directReport = JSON.parse(await readFile(reportFile, "utf8")) as Record<string, unknown>;
  assert.equal((directReport.loadingScreen as Record<string, unknown>).enabled, true);
  assert.equal(((directReport.output as Record<string, unknown>).sha256), applied.outputSha256);

  const generatedIndexHtml = createLoadingScreenWebMvpIndexHtml();
  for (const id of [
    "loadingScreenEnabled",
    "loadingLogoFile",
    "clearLoadingLogoButton",
    "loadingLogoPreview",
    "loadingLogoImage",
    "loadingLogoMeta",
    "loadingScreenSummary",
  ]) {
    assert.match(generatedIndexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(generatedIndexHtml, /关闭“启用插屏”/);
  assert.match(generatedIndexHtml, /config\.loadingScreen = readLoadingScreenConfig\(\)/);
  const uiScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(generatedIndexHtml);
  assert.notEqual(uiScriptMatch, null);
  new Script(uiScriptMatch?.[1] ?? "");

  const server = await startLoadingScreenWebMvpServer({
    host: "127.0.0.1",
    port: 0,
    rootDirectory: path.join(temporaryRoot, ".packer-web"),
    projectRoot: temporaryRoot,
    buildPlayableImpl: fakeBuildPlayable,
  });
  try {
    const rootHtml = await (await fetch(server.url)).text();
    assert.match(rootHtml, /loadingLogoFile/);

    const zip = createStoredZip([
      { name: "web-mobile/index.html", data: Buffer.from("<!doctype html><title>Cocos test</title>") },
      { name: "web-mobile/assets/test.txt", data: Buffer.from("asset") },
    ]);
    const upload = await readJson(await fetch(`${server.url}/api/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(zip.length),
      },
      body: bufferToArrayBuffer(zip),
    }));
    const receipt = upload.upload as Record<string, unknown>;
    const created = await readJson(await fetch(`${server.url}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: receipt.uploadId,
        config: {
          channel: { platform: "Preview", platforms: ["Preview"] },
          loadingScreen: { enabled: true, logoDataUrl },
        },
      }),
    }));
    const createdJob = created.job as Record<string, unknown>;
    const jobId = String(createdJob.id);
    const job = await waitForJob(server.url, jobId);
    assert.equal(job.status, "succeeded");
    const publicLoading = ((job.config as Record<string, unknown>).loadingScreen) as Record<string, unknown>;
    assert.equal(publicLoading.enabled, true);
    assert.equal(publicLoading.logoMimeType, "image/png");
    assert.equal("logoDataUrl" in publicLoading, false);
    assert.equal(String(job.outputSha256).length, 64);

    const preview = await (await fetch(`${server.url}/preview/${jobId}/?channel=Preview`)).text();
    assert.match(preview, new RegExp(LOADING_SCREEN_MARKER));
    assert.match(preview, /cpp-loading-progress-fill/);
    assert.match(preview, /data:image\/png;base64/);

    const report = await readJson(await fetch(`${server.url}/artifacts/${jobId}/report.json`));
    const loadingReport = report.loadingScreen as Record<string, unknown>;
    assert.equal(loadingReport.enabled, true);
    assert.equal(loadingReport.logoMimeType, "image/png");
    assert.ok(Number(loadingReport.htmlAddedBytes) > 0);
  } finally {
    await server.close();
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Playable loading screen self-test passed.");
