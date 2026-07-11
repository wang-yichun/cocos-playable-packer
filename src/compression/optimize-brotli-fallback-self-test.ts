import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import {
  optimizeBrotliFallbackFile,
  optimizeBrotliFallbackHtml,
} from "./optimize-brotli-fallback.js";

const require = createRequire(import.meta.url);

async function loadActualFallbackSource(): Promise<string> {
  const packageJsonPath = require.resolve("brotli-compress/package.json");
  const modulePath = path.join(path.dirname(packageJsonPath), "js.mjs");
  const moduleSource = await readFile(modulePath, "utf8");
  const exportPattern =
    /export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+decompress\s*\}\s*;?\s*$/;
  const match = exportPattern.exec(moduleSource);
  assert.ok(match?.[1], "无法识别 brotli-compress/js.mjs 的导出。");

  return (
    "/* brotli-compress/js 1.3.3 fallback; " +
    "Apache-2.0, Google Brotli decoder MIT. */\n" +
    moduleSource.replace(
      exportPattern,
      `window.__PACK_BROTLI_DECOMPRESS__=${match[1]};`,
    )
  );
}

async function main(): Promise<void> {
  const rawFallback = await loadActualFallbackSource();
  const html = [
    "<!doctype html>",
    "<html><body>",
    `<script>${rawFallback}</script>`,
    "<script>window.afterFallback=true;</script>",
    "</body></html>",
  ].join("\n");

  const optimized = optimizeBrotliFallbackHtml(html);
  assert.ok(optimized.savedBytes > 0);
  assert.ok(optimized.gzipDecoderBytes < optimized.rawDecoderBytes);
  assert.ok(optimized.html.includes("gzip-packed Brotli fallback"));
  assert.ok(!optimized.html.includes("export{aw as decompress}"));

  const scriptMatch =
    /<script>([\s\S]*?gzip-packed Brotli fallback[\s\S]*?)<\/script>/.exec(
      optimized.html,
    );
  assert.ok(scriptMatch?.[1]);

  const context: Record<string, unknown> = {
    window: null,
    performance,
    atob,
    Blob,
    Response,
    DecompressionStream,
    TextDecoder,
    Uint8Array,
    console: { log() {}, warn() {}, error() {} },
  };
  context.window = context;
  vm.runInNewContext(scriptMatch[1], context);

  const fallback = context.__PACK_BROTLI_DECOMPRESS__;
  assert.equal(typeof fallback, "function");

  const originalBytes = new TextEncoder().encode(
    "Cocos Playable Brotli fallback round trip. ".repeat(4096),
  );
  const compressedBytes = brotliCompressSync(originalBytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: originalBytes.byteLength,
    },
  });
  const output = await (
    fallback as (input: Uint8Array) => Promise<Uint8Array>
  )(new Uint8Array(compressedBytes));
  assert.deepEqual(Array.from(output), Array.from(originalBytes));

  const metrics = context.__PACK_BROTLI_FALLBACK_METRICS__ as {
    mode: string;
    loadDurationMs: number | null;
  };
  assert.equal(metrics.mode, "gzip-packed-js");
  assert.equal(typeof metrics.loadDurationMs, "number");

  assert.throws(
    () => optimizeBrotliFallbackHtml(optimized.html),
    /已经使用 gzip-packed/,
  );
  assert.throws(
    () => optimizeBrotliFallbackHtml("<html></html>"),
    /没有找到目标脚本标记/,
  );

  const directory = await mkdtemp(
    path.join(os.tmpdir(), "brotli-fallback-test-"),
  );
  try {
    const inputFile = path.join(directory, "input.html");
    const outputFile = path.join(directory, "output.html");
    await writeFile(inputFile, html, "utf8");
    const report = await optimizeBrotliFallbackFile(inputFile, outputFile);
    const outputFileContents = await readFile(outputFile, "utf8");
    assert.equal(outputFileContents, optimized.html);
    assert.equal(report.status, "succeeded");
    assert.equal(report.mode, "gzip-packed-js");
    const reportFile = outputFile.replace(
      /\.html$/i,
      ".brotli-decoder-report.json",
    );
    const savedReport = JSON.parse(
      await readFile(reportFile, "utf8"),
    ) as { fallback: { roundTrip: boolean } };
    assert.equal(savedReport.fallback.roundTrip, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  console.log("Brotli fallback optimizer self-test passed.");
  console.log({
    rawDecoderBytes: optimized.rawDecoderBytes,
    gzipDecoderBytes: optimized.gzipDecoderBytes,
    loaderBytes: optimized.loaderBytes,
    savedBytes: optimized.savedBytes,
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
