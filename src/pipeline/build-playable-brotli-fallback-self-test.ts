import assert from "node:assert/strict";
import path from "node:path";
import {
  createIntegratedFallbackReport,
  parseBrotliFallbackArguments,
} from "./build-playable-brotli-fallback-cli.js";

function expectThrows(callback: () => unknown, pattern: RegExp): void {
  assert.throws(callback, pattern);
}

const defaultOptions = parseBrotliFallbackArguments([
  "./web-mobile",
  "./dist/game.html",
  "--image-mode=squoosh",
  "--payload-encoding=base64",
]);
assert.equal(defaultOptions.fallbackMode, "raw-js");
assert.equal(defaultOptions.outputArgumentIndex, 1);
assert.equal(defaultOptions.outputFile, path.resolve("./dist/game.html"));
assert.deepEqual(defaultOptions.passthroughArgs, [
  "./web-mobile",
  "./dist/game.html",
  "--image-mode=squoosh",
  "--payload-encoding=base64",
]);

const gzipOptions = parseBrotliFallbackArguments([
  "--",
  "./web-mobile",
  "./dist/game.html",
  "--image-mode=squoosh",
  "--payload-encoding=html7",
  "--brotli-fallback=gzip-packed-js",
]);
assert.equal(gzipOptions.fallbackMode, "gzip-packed-js");
assert.equal(gzipOptions.outputArgumentIndex, 1);
assert.equal(
  gzipOptions.passthroughArgs.includes("--brotli-fallback=gzip-packed-js"),
  false,
);
assert.equal(
  gzipOptions.passthroughArgs.includes("--payload-encoding=html7"),
  true,
);

expectThrows(
  () => parseBrotliFallbackArguments([
    "./web-mobile",
    "./dist/game.html",
    "--brotli-fallback=wasm",
  ]),
  /无效 Brotli 回退模式/,
);
expectThrows(
  () => parseBrotliFallbackArguments([
    "./web-mobile",
    "./dist/game.html",
    "--brotli-fallback=raw-js",
    "--brotli-fallback=gzip-packed-js",
  ]),
  /只能指定一次/,
);
expectThrows(
  () => parseBrotliFallbackArguments([
    "./web-mobile",
    "--brotli-fallback=gzip-packed-js",
  ]),
  /必须提供输入目录和输出 HTML/,
);

const coreReport = {
  schemaVersion: 2,
  output: {
    file: "temporary.html",
    bytes: 4691714,
    sha256: "old-sha",
    reportFile: "temporary.report.json",
    projectReportFile: "workspaces/game/reports/run.json",
  },
  timingMs: {
    packaging: 12000,
    total: 13000,
  },
  payloadEncoding: {
    mode: "html7",
  },
};
const fallbackReport = {
  compatibility: {
    requires: "DecompressionStream('gzip')",
    keepsExistingBrotliDecoder: true,
  },
  fallback: {
    rawDecoderBytes: 155296,
    gzipDecoderBytes: 67736,
    loaderBytes: 91564,
    savedBytes: 63732,
    roundTrip: true,
  },
};
const integrated = createIntegratedFallbackReport(
  coreReport,
  fallbackReport,
  "dist/game.html",
  "dist/game.report.json",
  4627982,
  "new-sha",
  35,
  13100,
);
assert.equal(integrated.schemaVersion, 3);
assert.deepEqual(integrated.payloadEncoding, { mode: "html7" });
assert.deepEqual(integrated.brotliFallback, {
  mode: "gzip-packed-js",
  compatibility: fallbackReport.compatibility,
  ...fallbackReport.fallback,
});
assert.deepEqual(integrated.output, {
  file: "dist/game.html",
  bytes: 4627982,
  sha256: "new-sha",
  reportFile: "dist/game.report.json",
  projectReportFile: "workspaces/game/reports/run.json",
});
assert.deepEqual(integrated.timingMs, {
  packaging: 12000,
  total: 13100,
  brotliFallbackOptimization: 35,
});

console.log("Brotli fallback pipeline self-test passed.");
