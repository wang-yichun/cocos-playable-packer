import assert from "node:assert/strict";
import path from "node:path";

import {
  inspectJpeg,
  isJpegFileName,
  parseJpegOptimizerArguments,
} from "./optimize-build-jpegs.js";

assert.equal(isJpegFileName("texture.jpg"), true);
assert.equal(isJpegFileName("texture.JPEG"), true);
assert.equal(isJpegFileName("texture.png"), false);
assert.equal(isJpegFileName("texture.jpg.meta"), false);

const defaultOptions = parseJpegOptimizerArguments([
  "--",
  "./web-mobile",
]);
assert.equal(defaultOptions.buildDirectory, path.resolve("./web-mobile"));
assert.equal(defaultOptions.quality, 80);
assert.equal(defaultOptions.confirm, false);

const confirmedOptions = parseJpegOptimizerArguments([
  "./web-mobile",
  "--quality=72",
  "--confirm",
]);
assert.equal(confirmedOptions.quality, 72);
assert.equal(confirmedOptions.confirm, true);

assert.throws(
  () => parseJpegOptimizerArguments(["./web-mobile", "--quality=0"]),
  /1 到 100/,
);
assert.throws(
  () => parseJpegOptimizerArguments(["./web-mobile", "extra"]),
  /只允许传入一个构建目录/,
);

const syntheticJpeg = Buffer.from([
  0xff, 0xd8,
  0xff, 0xc0,
  0x00, 0x11,
  0x08,
  0x01, 0xe0,
  0x02, 0x80,
  0x03,
  0x01, 0x11, 0x00,
  0x02, 0x11, 0x00,
  0x03, 0x11, 0x00,
  0xff, 0xd9,
]);
assert.deepEqual(inspectJpeg(syntheticJpeg), {
  width: 640,
  height: 480,
});
assert.throws(
  () => inspectJpeg(Buffer.from("not-jpeg")),
  /不是有效的 JPEG/,
);

console.log("Squoosh JPEG optimizer self-test passed.");
