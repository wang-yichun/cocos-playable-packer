import assert from "node:assert/strict";
import path from "node:path";

import {
  PLAYABLE_CORE_API_VERSION,
  createPlayableBuildArguments,
  createPlayableBuildServiceOptions,
  getPlayableBuildReportPath,
  normalizePlayableBuildRequest,
  playableCoreApi,
  resolvePlayableRuntimeContext,
  runPlayableBuild,
} from "./index.js";

assert.equal(PLAYABLE_CORE_API_VERSION, 1);
assert.equal(playableCoreApi.version, PLAYABLE_CORE_API_VERSION);
assert.ok(Object.isFrozen(playableCoreApi));
assert.equal(playableCoreApi.build, runPlayableBuild);
assert.equal(playableCoreApi.normalizeRequest, normalizePlayableBuildRequest);
assert.equal(playableCoreApi.createArguments, createPlayableBuildArguments);
assert.equal(playableCoreApi.reportPathForOutput, getPlayableBuildReportPath);
assert.equal(playableCoreApi.resolveRuntime, resolvePlayableRuntimeContext);
assert.equal(playableCoreApi.createServiceOptions, createPlayableBuildServiceOptions);

const normalized = playableCoreApi.normalizeRequest({
  inputDirectory: "./web-mobile",
  outputFile: "./dist/core-api.html",
  image: { mode: "squoosh", pngQuality: 76, jpegQuality: 84 },
  payloadEncoding: "html7",
});
assert.equal(normalized.inputDirectory, path.resolve("./web-mobile"));
assert.equal(normalized.outputFile, path.resolve("./dist/core-api.html"));
assert.equal(normalized.image.mode, "squoosh");
assert.equal(normalized.payloadEncoding, "html7");
assert.equal(normalized.audio, null);

const argumentsList = playableCoreApi.createArguments(normalized);
assert.deepEqual(argumentsList.slice(0, 5), [
  path.resolve("./web-mobile"),
  path.resolve("./dist/core-api.html"),
  "--image-mode=squoosh",
  "--payload-encoding=html7",
  "--brotli-fallback=raw-js",
]);
assert.ok(argumentsList.includes("--png-quality=76"));
assert.ok(argumentsList.includes("--jpeg-quality=84"));

assert.equal(
  playableCoreApi.reportPathForOutput(path.resolve("./dist/CORE-API.HTML")),
  path.resolve("./dist/CORE-API.report.json"),
);

console.log("Playable core API self-test passed.");
