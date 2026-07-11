import assert from "node:assert/strict";
import path from "node:path";

import {
  hasMeaningfulJpegSavings,
  parseJpegApplyArguments,
} from "./apply-build-jpeg-cache.js";
import { parseJpegPipelineArguments } from "./optimize-build-jpegs-cli.js";

const applyDefaults = parseJpegApplyArguments([
  "./web-mobile",
  "--report=./latest.json",
]);
assert.equal(applyDefaults.confirm, false);
assert.equal(applyDefaults.minimumSavingsBytes, 128);
assert.equal(applyDefaults.minimumSavingsPercent, 1);
assert.equal(applyDefaults.buildDirectory, path.resolve("./web-mobile"));
assert.equal(applyDefaults.reportPath, path.resolve("./latest.json"));

const applyCustom = parseJpegApplyArguments([
  "--",
  "./web-mobile",
  "--report=./latest.json",
  "--min-savings-bytes=256",
  "--min-savings-percent=2.5",
  "--confirm",
]);
assert.equal(applyCustom.confirm, true);
assert.equal(applyCustom.minimumSavingsBytes, 256);
assert.equal(applyCustom.minimumSavingsPercent, 2.5);

assert.equal(
  hasMeaningfulJpegSavings(22, 0.2115, 128, 1),
  false,
  "22 B / 0.21% 的收益不应触发有损替换",
);
assert.equal(
  hasMeaningfulJpegSavings(127, 20, 128, 1),
  false,
  "未达到最低绝对收益时应保留原图",
);
assert.equal(
  hasMeaningfulJpegSavings(1024, 0.5, 128, 1),
  false,
  "未达到最低相对收益时应保留原图",
);
assert.equal(
  hasMeaningfulJpegSavings(128, 1, 128, 1),
  true,
  "同时达到两个门槛时应允许替换",
);

const pipelineDefaults = parseJpegPipelineArguments(["./web-mobile"]);
assert.equal(pipelineDefaults.quality, 80);
assert.equal(pipelineDefaults.confirm, false);
assert.equal(pipelineDefaults.minimumSavingsBytes, 128);
assert.equal(pipelineDefaults.minimumSavingsPercent, 1);

const pipelineCustom = parseJpegPipelineArguments([
  "./web-mobile",
  "--quality=85",
  "--min-savings-bytes=512",
  "--min-savings-percent=3",
  "--confirm",
]);
assert.equal(pipelineCustom.quality, 85);
assert.equal(pipelineCustom.confirm, true);
assert.equal(pipelineCustom.minimumSavingsBytes, 512);
assert.equal(pipelineCustom.minimumSavingsPercent, 3);

console.log("Squoosh JPEG savings policy self-test passed.");
