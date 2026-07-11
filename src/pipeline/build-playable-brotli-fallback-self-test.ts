import assert from "node:assert/strict";
import path from "node:path";
import {
  createIntegratedFallbackReport,
  parseBrotliFallbackArguments,
} from "./build-playable-brotli-fallback-cli.js";

const PAYLOAD_ENCODINGS = ["base64", "base91", "html7"] as const;

type PayloadEncoding = (typeof PAYLOAD_ENCODINGS)[number];

function expectThrows(callback: () => unknown, pattern: RegExp): void {
  assert.throws(callback, pattern);
}

for (const payloadEncoding of PAYLOAD_ENCODINGS) {
  const defaultOptions = parseBrotliFallbackArguments([
    "./web-mobile",
    `./dist/game-${payloadEncoding}.html`,
    "--image-mode=squoosh",
    `--payload-encoding=${payloadEncoding}`,
  ]);

  assert.equal(defaultOptions.fallbackMode, "raw-js");
  assert.equal(defaultOptions.outputArgumentIndex, 1);
  assert.equal(
    defaultOptions.outputFile,
    path.resolve(`./dist/game-${payloadEncoding}.html`),
  );
  assert.deepEqual(defaultOptions.passthroughArgs, [
    "./web-mobile",
    `./dist/game-${payloadEncoding}.html`,
    "--image-mode=squoosh",
    `--payload-encoding=${payloadEncoding}`,
  ]);

  const gzipOptions = parseBrotliFallbackArguments([
    "--",
    "./web-mobile",
    `./dist/game-${payloadEncoding}.html`,
    "--image-mode=squoosh",
    `--payload-encoding=${payloadEncoding}`,
    "--brotli-fallback=gzip-packed-js",
  ]);

  assert.equal(gzipOptions.fallbackMode, "gzip-packed-js");
  assert.equal(gzipOptions.outputArgumentIndex, 1);
  assert.equal(
    gzipOptions.passthroughArgs.includes(
      "--brotli-fallback=gzip-packed-js",
    ),
    false,
  );
  assert.equal(
    gzipOptions.passthroughArgs.includes(
      `--payload-encoding=${payloadEncoding}`,
    ),
    true,
  );
}

expectThrows(
  () =>
    parseBrotliFallbackArguments([
      "./web-mobile",
      "./dist/game.html",
      "--brotli-fallback=wasm",
    ]),
  /无效 Brotli 回退模式/,
);
expectThrows(
  () =>
    parseBrotliFallbackArguments([
      "./web-mobile",
      "./dist/game.html",
      "--brotli-fallback=raw-js",
      "--brotli-fallback=gzip-packed-js",
    ]),
  /只能指定一次/,
);
expectThrows(
  () =>
    parseBrotliFallbackArguments([
      "./web-mobile",
      "--brotli-fallback=gzip-packed-js",
    ]),
  /必须提供输入目录和输出 HTML/,
);

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

function verifyIntegratedReport(payloadEncoding: PayloadEncoding): void {
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
      mode: payloadEncoding,
    },
  };

  const integrated = createIntegratedFallbackReport(
    coreReport,
    fallbackReport,
    `dist/game-${payloadEncoding}.html`,
    `dist/game-${payloadEncoding}.report.json`,
    4627982,
    "new-sha",
    35,
    13100,
  );

  assert.equal(integrated.schemaVersion, 3);
  assert.deepEqual(integrated.payloadEncoding, {
    mode: payloadEncoding,
  });
  assert.deepEqual(integrated.brotliFallback, {
    mode: "gzip-packed-js",
    compatibility: fallbackReport.compatibility,
    ...fallbackReport.fallback,
  });
  assert.deepEqual(integrated.output, {
    file: `dist/game-${payloadEncoding}.html`,
    bytes: 4627982,
    sha256: "new-sha",
    reportFile: `dist/game-${payloadEncoding}.report.json`,
    projectReportFile: "workspaces/game/reports/run.json",
  });
  assert.deepEqual(integrated.timingMs, {
    packaging: 12000,
    total: 13100,
    brotliFallbackOptimization: 35,
  });
}

for (const payloadEncoding of PAYLOAD_ENCODINGS) {
  verifyIntegratedReport(payloadEncoding);
}

console.log(
  "Brotli fallback pipeline self-test passed for Base64, Base91, and HTML7.",
);
