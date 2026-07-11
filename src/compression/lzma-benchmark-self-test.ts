import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { brotliCompressSync } from "node:zlib";

import {
  parseArguments,
  runBenchmark,
} from "./lzma-benchmark.js";
import { decompressLzma } from "./lzma-js-adapter.js";
import { extractPackedArchive } from "./packed-html.js";

function createFixtureHtml(rawArchive: Buffer): string {
  const compressed = brotliCompressSync(rawArchive);
  const archive = {
    v: 1,
    c: "br",
    u: rawArchive.byteLength,
    b: compressed.toString("base64"),
  };

  return `<!DOCTYPE html>
<html>
<head></head>
<body>
<script>
/* brotli-compress/js 1.3.3 fallback; Apache-2.0, Google Brotli decoder MIT. */
window.__PACK_BROTLI_DECOMPRESS__=function(bytes){return bytes;};
</script>
<script>
window.__PACK_FILES__={"fixture.bin":{"m":"application/octet-stream","o":0,"l":${rawArchive.byteLength}}};
window.__PACK_ARCHIVE__=${JSON.stringify(archive)};
window.__PACK_BOOT__={"base":"https://playable.local/","runtime":[],"modules":[],"plainScripts":[],"entry":"fixture","importMap":{"imports":{}}};
</script>
<script>
(function () {
    'use strict';
    var ARCHIVE = window.__PACK_ARCHIVE__;
    var BOOT = window.__PACK_BOOT__;
    var archiveBytes = null;

    function decodeBase64(base64) {
        var binary = atob(base64);
        var bytes = new Uint8Array(binary.length);
        for (var index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    async function decompressBrotli(compressedBytes) {
        return compressedBytes;
    }

    async function initializeArchive() {
        archiveBytes = await decompressBrotli(decodeBase64(ARCHIVE.b));
    }

    async function boot() {
        await initializeArchive();
        await System.import(
            BOOT.entry
        );
    }

    void boot();
})();
</script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const defaults = parseArguments(["input.html", "output.html"]);
  assert.equal(defaults.iterations, 3);
  assert.equal(defaults.lzmaLevel, 9);
  assert.throws(
    () => parseArguments(["input.html", "output.html", "--iterations=0"]),
    /--iterations/,
  );
  assert.throws(
    () => parseArguments(["same.html", "same.html"]),
    /不能是同一个文件/,
  );

  const parsed = parseArguments([
    "--",
    "input.html",
    "output.html",
    "--iterations=2",
    "--lzma-level=7",
  ]);
  assert.equal(parsed.iterations, 2);
  assert.equal(parsed.lzmaLevel, 7);

  const directory = await mkdtemp(path.join(os.tmpdir(), "lzma-benchmark-test-"));
  try {
    const inputFile = path.join(directory, "input.html");
    const outputFile = path.join(directory, "output.html");
    const rawArchive = Buffer.concat([
      Buffer.from("fixture-data-".repeat(4096), "utf8"),
      Buffer.from(Array.from({ length: 1024 }, (_, index) => index & 0xff)),
    ]);

    await writeFile(inputFile, createFixtureHtml(rawArchive), "utf8");
    const result = await runBenchmark({
      inputFile,
      outputFile,
      iterations: 2,
      lzmaLevel: 9,
    });

    const outputHtml = await readFile(outputFile, "utf8");
    assert.match(outputHtml, /"c":"lzma"/);
    assert.match(outputHtml, /"e":"base64"/);
    assert.match(outputHtml, /__PACK_LZMA_DECOMPRESS__/);
    assert.match(outputHtml, /__PACK_RUNTIME_METRICS__/);
    assert.doesNotMatch(outputHtml, /brotli-compress\/js 1\.3\.3 fallback/);
    assert.doesNotMatch(outputHtml, /async function decompressBrotli/);

    const archive = extractPackedArchive(outputHtml).archive;
    const decoded = decompressLzma(Buffer.from(archive.b, "base64"));
    assert.equal(Buffer.compare(decoded, rawArchive), 0);

    const browserContext: Record<string, unknown> = {
      Array,
      Promise,
      setImmediate,
      setTimeout,
      TextEncoder,
      Uint8Array,
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console: {
        log: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      performance: {
        now: (() => {
          let current = 0;
          return () => {
            current += 1;
            return current;
          };
        })(),
      },
      System: {
        import: async () => {
          browserContext.__IMPORTED__ = true;
        },
      },
    };
    browserContext.window = browserContext;
    browserContext.globalThis = browserContext;

    for (const match of outputHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      vm.runInNewContext(match[1] ?? "", browserContext);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(browserContext.__IMPORTED__, true);
    const runtimeMetrics = browserContext.__PACK_RUNTIME_METRICS__ as {
      algorithm?: string;
      archiveDecodeDurationMs?: number;
      pageToGameStartMs?: number;
    };
    assert.equal(runtimeMetrics.algorithm, "lzma");
    assert.equal(typeof runtimeMetrics.archiveDecodeDurationMs, "number");
    assert.equal(typeof runtimeMetrics.pageToGameStartMs, "number");
    assert.equal(
      (browserContext.__PACK_ARCHIVE__ as { b?: string }).b,
      "",
    );

    const report = JSON.parse(await readFile(result.reportFile, "utf8")) as {
      archive: { sha256: string };
      brotli: { roundTrip: boolean };
      lzma: { roundTrip: boolean; finalHtmlBytes: number };
    };
    assert.equal(report.brotli.roundTrip, true);
    assert.equal(report.lzma.roundTrip, true);
    assert.equal(report.lzma.finalHtmlBytes, Buffer.byteLength(outputHtml));
    assert.equal(report.archive.sha256.length, 64);

    const protectedOutput = path.join(directory, "protected.html");
    await writeFile(protectedOutput, "known-good", "utf8");
    const invalidInput = path.join(directory, "invalid.html");
    await writeFile(invalidInput, "<html></html>", "utf8");

    await assert.rejects(
      runBenchmark({
        inputFile: invalidInput,
        outputFile: protectedOutput,
        iterations: 1,
        lzmaLevel: 1,
      }),
    );
    assert.equal(await readFile(protectedOutput, "utf8"), "known-good");

    console.log("LZMA benchmark self-test passed.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
