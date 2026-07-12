import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PlayableBuildServiceError,
  buildPlayable,
  createBuildPlayableArguments,
  normalizeBuildPlayableRequest,
  reportPathForOutput,
  type PlayableBuildServiceEvent,
} from "./index.js";

function expectServiceError(callback: () => unknown, pattern: RegExp): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof PlayableBuildServiceError);
    assert.equal(error.code, "INVALID_REQUEST");
    assert.match(error.message, pattern);
    return true;
  });
}

const defaults = normalizeBuildPlayableRequest({
  inputDirectory: "./web-mobile",
  outputFile: "./dist/game.html",
  image: { mode: "none" },
});
assert.equal(defaults.inputDirectory, path.resolve("./web-mobile"));
assert.equal(defaults.outputFile, path.resolve("./dist/game.html"));
assert.equal(defaults.payloadEncoding, "base64");
assert.equal(defaults.brotliFallback, "raw-js");
assert.equal(defaults.audio, null);
assert.equal(defaults.keepWorkspace, false);

const squooshArgs = createBuildPlayableArguments({
  inputDirectory: "./web-mobile",
  outputFile: "./dist/game.html",
  image: {
    mode: "squoosh",
    pngQuality: 72,
    jpegQuality: 85,
    colours: 192,
    effort: 9,
    dither: 0.25,
    oxipngLevel: 4,
  },
  audio: {
    bitrateKbps: 48,
    ffmpegPath: "C:/Tools/ffmpeg.exe",
  },
  payloadEncoding: "html7",
  brotliFallback: "gzip-packed-js",
  projectName: "game141",
  keepWorkspace: true,
});
assert.deepEqual(squooshArgs.slice(2, 5), [
  "--image-mode=squoosh",
  "--payload-encoding=html7",
  "--brotli-fallback=gzip-packed-js",
]);
for (const expected of [
  "--project=game141",
  "--keep-workspace",
  "--png-quality=72",
  "--jpeg-quality=85",
  "--colours=192",
  "--effort=9",
  "--dither=0.25",
  "--oxipng-level=4",
  "--min-bytes=0",
  "--audio-bitrate=48",
  "--ffmpeg=C:/Tools/ffmpeg.exe",
]) {
  assert.ok(squooshArgs.includes(expected), `缺少参数：${expected}`);
}

const tinyPngArgs = createBuildPlayableArguments({
  inputDirectory: "./web-mobile",
  outputFile: "./dist/game.html",
  image: {
    mode: "tinypng",
    scope: { type: "limit", limit: 25 },
    minBytes: 4096,
  },
});
assert.ok(tinyPngArgs.includes("--limit=25"));
assert.ok(tinyPngArgs.includes("--min-bytes=4096"));

const webpArgs = createBuildPlayableArguments({
  inputDirectory: "./web-mobile",
  outputFile: "./dist/game.html",
  image: { mode: "webp", pngQuality: 76, jpegQuality: 82 },
});
assert.ok(webpArgs.includes("--png-webp-quality=76"));
assert.ok(webpArgs.includes("--jpeg-webp-quality=82"));
assert.equal(webpArgs.some((argument) => argument.startsWith("--png-quality=")), false);

expectServiceError(
  () => normalizeBuildPlayableRequest({
    inputDirectory: "./web-mobile",
    outputFile: "./dist/game.zip",
    image: { mode: "none" },
  }),
  /必须是 \.html/,
);
expectServiceError(
  () => normalizeBuildPlayableRequest({
    inputDirectory: "./web-mobile",
    outputFile: "./dist/game.html",
    image: { mode: "squoosh", jpegQuality: 0 },
  }),
  /1 到 100/,
);
expectServiceError(
  () => normalizeBuildPlayableRequest({
    inputDirectory: "./web-mobile",
    outputFile: "./dist/game.html",
    image: { mode: "webp", pngQuality: 101 },
  }),
  /1 到 100/,
);
expectServiceError(
  () => normalizeBuildPlayableRequest({
    inputDirectory: "./web-mobile",
    outputFile: "./dist/game.html",
    image: { mode: "none" },
    audio: { bitrateKbps: 7 },
  }),
  /8 到 320/,
);
expectServiceError(
  () => normalizeBuildPlayableRequest({
    inputDirectory: "./web-mobile",
    outputFile: "./dist/game.html",
    image: { mode: "tinypng" } as never,
  }),
  /必须提供 scope/,
);
expectServiceError(
  () => normalizeBuildPlayableRequest({
    inputDirectory: "./web-mobile",
    outputFile: "./dist/game.html",
    image: { mode: "none" },
    payloadEncoding: "unknown" as never,
  }),
  /无效 Payload 编码/,
);

assert.equal(
  reportPathForOutput(path.resolve("./dist/GAME.HTML")),
  path.resolve("./dist/GAME.report.json"),
);

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "playable-service-test-"));
try {
  const inputDirectory = path.join(temporaryRoot, "web-mobile");
  const outputFile = path.join(temporaryRoot, "dist", "game.html");
  const mockScript = path.join(temporaryRoot, "mock-pipeline.mjs");
  await mkdir(inputDirectory, { recursive: true });
  await writeFile(
    mockScript,
    [
      'import { mkdir, writeFile } from "node:fs/promises";',
      'import path from "node:path";',
      'const inputDirectory = process.argv[2];',
      'const outputFile = process.argv[3];',
      'if (!inputDirectory || !outputFile) throw new Error("missing paths");',
      'await mkdir(path.dirname(outputFile), { recursive: true });',
      'const html = "<html><body>mock playable</body></html>";',
      'await writeFile(outputFile, html, "utf8");',
      'const reportFile = outputFile.replace(/\\.html$/i, ".report.json");',
      'await writeFile(reportFile, JSON.stringify({ output: { sha256: "' + "0".repeat(64) + '" } }), "utf8");',
      'console.log("mock pipeline completed");',
    ].join("\n"),
    "utf8",
  );

  const events: PlayableBuildServiceEvent[] = [];
  const result = await buildPlayable(
    {
      inputDirectory,
      outputFile,
      image: { mode: "none" },
    },
    {
      projectRoot: temporaryRoot,
      scriptPath: mockScript,
      onEvent(event) {
        events.push(event);
      },
    },
  );
  assert.equal(result.outputFile, outputFile);
  assert.ok(result.outputBytes > 0);
  assert.equal(result.outputSha256, "0".repeat(64));
  assert.ok(events.some((event) => event.type === "state" && event.stage === "running"));
  assert.ok(events.some((event) => event.type === "state" && event.stage === "succeeded"));
  assert.ok(
    events.some(
      (event) => event.type === "log" && event.line === "mock pipeline completed",
    ),
  );

  const slowScript = path.join(temporaryRoot, "slow-pipeline.mjs");
  await writeFile(
    slowScript,
    'await new Promise((resolve) => setTimeout(resolve, 10_000));\n',
    "utf8",
  );
  const controller = new AbortController();
  const cancelled = buildPlayable(
    {
      inputDirectory,
      outputFile: path.join(temporaryRoot, "dist", "cancelled.html"),
      image: { mode: "none" },
    },
    {
      projectRoot: temporaryRoot,
      scriptPath: slowScript,
      signal: controller.signal,
    },
  );
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(cancelled, (error: unknown) => {
    assert.ok(error instanceof PlayableBuildServiceError);
    assert.equal(error.code, "ABORTED");
    return true;
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Playable build service self-test passed.");
