import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  resolveBuildArguments,
  validateBuildConfig,
} from "./unified-build-config.js";

function expectThrow(callback: () => unknown, pattern: RegExp): void {
  assert.throws(callback, pattern);
}

expectThrow(
  () => validateBuildConfig({ unknown: true }),
  /未知字段：unknown/,
);

expectThrow(
  () => validateBuildConfig({ image: { mode: "webp", pngQuality: 80 } }),
  /只适用于 image.mode=squoosh/,
);

expectThrow(
  () => validateBuildConfig({ compression: { payloadEncoding: "zip" } }),
  /base64, base91, html7/,
);

const directory = await mkdtemp(path.join(os.tmpdir(), "playable-config-test-"));
try {
  const configFile = path.join(directory, "playable.config.json");
  await writeFile(
    configFile,
    `${JSON.stringify({
      schemaVersion: 1,
      input: "./build/web-mobile",
      output: "./dist/game.html",
      image: {
        mode: "squoosh",
        pngQuality: 72,
        jpegQuality: 84,
      },
      audio: {
        bitrate: 48,
        ffmpeg: "ffmpeg",
      },
      compression: {
        payloadEncoding: "html7",
        brotliFallback: "raw-js",
      },
      workspace: {
        keep: true,
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const resolved = await resolveBuildArguments(["--config", configFile], directory);
  assert.equal(resolved.configFile, configFile);
  assert.deepEqual(resolved.argv.slice(0, 2), [
    path.join(directory, "build", "web-mobile"),
    path.join(directory, "dist", "game.html"),
  ]);
  assert.equal(resolved.argv.includes("--image-mode=squoosh"), true);
  assert.equal(resolved.argv.includes("--png-quality=72"), true);
  assert.equal(resolved.argv.includes("--jpeg-quality=84"), true);
  assert.equal(resolved.argv.includes("--audio-bitrate=48"), true);
  assert.equal(resolved.argv.includes("--ffmpeg=ffmpeg"), true);
  assert.equal(resolved.argv.includes("--payload-encoding=html7"), true);
  assert.equal(resolved.argv.includes("--brotli-fallback=raw-js"), true);
  assert.equal(resolved.argv.includes("--keep-workspace"), true);

  const overridden = await resolveBuildArguments([
    `--config=${configFile}`,
    "./cli-input",
    "./cli-output.html",
    "--png-quality=65",
    "--payload-encoding=base64",
  ], directory);
  assert.deepEqual(overridden.argv.slice(0, 2), [
    "./cli-input",
    "./cli-output.html",
  ]);
  assert.equal(overridden.argv.includes("--png-quality=65"), true);
  assert.equal(overridden.argv.includes("--png-quality=72"), false);
  assert.equal(overridden.argv.includes("--payload-encoding=base64"), true);
  assert.equal(overridden.argv.includes("--payload-encoding=html7"), false);

  const unchanged = await resolveBuildArguments([
    "--",
    "./web-mobile",
    "./dist/game.html",
    "--image-mode=none",
  ], directory);
  assert.deepEqual(unchanged.argv, [
    "./web-mobile",
    "./dist/game.html",
    "--image-mode=none",
  ]);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("Unified build config self-test passed.");
