import assert from "node:assert/strict";

import {
  addImageQualitySettings,
  parseImageQualityPipelineArguments,
} from "./build-playable-image-quality-cli.js";

function expectThrow(callback: () => unknown, pattern: RegExp): void {
  assert.throws(callback, pattern);
}

const defaults = parseImageQualityPipelineArguments([
  "./web-mobile",
  "./dist/game.html",
  "--image-mode=squoosh",
]);
assert.equal(defaults.pngQuality, 80);
assert.equal(defaults.jpegQuality, 80);
assert.equal(defaults.usedLegacyPngQuality, false);
assert.equal(defaults.passthroughArgs.includes("--quality=80"), false);

const explicit = parseImageQualityPipelineArguments([
  "./web-mobile",
  "./dist/game.html",
  "--image-mode=squoosh",
  "--png-quality=72",
  "--jpeg-quality=85",
  "--audio-bitrate=48",
  "--payload-encoding=html7",
]);
assert.equal(explicit.pngQuality, 72);
assert.equal(explicit.jpegQuality, 85);
assert.equal(explicit.passthroughArgs.includes("--quality=72"), true);
assert.equal(
  explicit.passthroughArgs.some((argument) => argument.startsWith("--png-quality=")),
  false,
);
assert.equal(
  explicit.passthroughArgs.some((argument) => argument.startsWith("--jpeg-quality=")),
  false,
);
assert.equal(explicit.passthroughArgs.includes("--payload-encoding=html7"), true);
assert.equal(explicit.passthroughArgs.includes("--audio-bitrate=48"), true);

const legacy = parseImageQualityPipelineArguments([
  "./web-mobile",
  "./dist/game.html",
  "--image-mode=squoosh",
  "--quality=73",
]);
assert.equal(legacy.pngQuality, 73);
assert.equal(legacy.usedLegacyPngQuality, true);
assert.equal(legacy.passthroughArgs.includes("--quality=73"), true);

expectThrow(
  () => parseImageQualityPipelineArguments([
    "./web-mobile",
    "./dist/game.html",
    "--image-mode=squoosh",
    "--png-quality=70",
    "--quality=71",
  ]),
  /只能指定一个/,
);

expectThrow(
  () => parseImageQualityPipelineArguments([
    "./web-mobile",
    "./dist/game.html",
    "--image-mode=none",
    "--jpeg-quality=80",
  ]),
  /只适用于 Squoosh/,
);

expectThrow(
  () => parseImageQualityPipelineArguments([
    "./web-mobile",
    "./dist/game.html",
    "--image-mode=squoosh",
    "--jpeg-quality=0",
  ]),
  /1 到 100/,
);

const report = addImageQualitySettings(
  {
    imageOptimization: {
      mode: "squoosh",
      savedBytes: 123,
    },
  },
  76,
  84,
);
const imageOptimization = report.imageOptimization as Record<string, unknown>;
assert.equal(imageOptimization.mode, "squoosh");
assert.equal(imageOptimization.savedBytes, 123);
assert.deepEqual(imageOptimization.settings, {
  pngQuality: 76,
  jpegQuality: 84,
});

console.log("Playable image quality pipeline self-test passed.");
