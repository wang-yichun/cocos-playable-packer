import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import type { AssetsManifest } from "./assets-manifest.js";
import { analyzeJointResources } from "./joint-resource-analysis.js";
import { createResourceAnalysisHtmlReport } from "./resource-analysis-report.js";
import {
  analyzeResourceOptimization,
  estimateAudioTargetBytes,
} from "./resource-optimization-estimates.js";

const root = await mkdtemp(path.join(os.tmpdir(), "resource-optimization-test-"));
try {
  const uuid = "12345678-1234-4234-8234-123456789abc";
  const nativeDirectory = path.join(root, "assets", "main", "native", "12");
  await mkdir(nativeDirectory, { recursive: true });

  const width = 512;
  const height = 512;
  const pixels = Buffer.alloc(width * height * 4);
  let state = 0x12345678;
  for (let index = 0; index < pixels.length; index += 4) {
    state = (state * 1664525 + 1013904223) >>> 0;
    pixels[index] = state & 0xff;
    pixels[index + 1] = (state >>> 8) & 0xff;
    pixels[index + 2] = (state >>> 16) & 0xff;
    pixels[index + 3] = 255;
  }
  const imagePath = path.join(nativeDirectory, `${uuid}.png`);
  await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(imagePath);

  const imageBytes = (await stat(imagePath)).size;
  const manifest: AssetsManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectName: "optimization-test",
    assetsRoot: "assets",
    resourceCount: 1,
    totalBytes: imageBytes,
    metaCount: 1,
    missingMetaCount: 0,
    entries: [{
      path: "assets/ui/noise.png",
      extension: ".png",
      bytes: imageBytes,
      sha256: "0".repeat(64),
      modifiedAt: new Date().toISOString(),
      metaPath: "assets/ui/noise.png.meta",
      uuid,
      importer: "image",
      bundleName: "main",
    }],
  };

  const joint = await analyzeJointResources(root, manifest);
  const optimization = await analyzeResourceOptimization(root, joint);
  assert.equal(optimization.imageFileCount, 1);
  assert.equal(optimization.measuredImageCount, 1);
  assert.equal(optimization.candidates.length, 1);
  const candidate = optimization.candidates[0];
  assert(candidate !== undefined);
  assert.equal(candidate.estimateKind, "measured");
  assert.equal(candidate.sourcePaths[0], "assets/ui/noise.png");
  assert(candidate.estimatedSavingsBytesMax > 1024);
  assert.equal(estimateAudioTargetBytes(10, 48), 60_000);

  const html = createResourceAnalysisHtmlReport({ ...joint, optimization });
  assert.match(html, /Cocos 构建资源体检报告/);
  assert.match(html, /assets\/ui\/noise\.png/);
  assert.match(html, /实测/);
  assert.match(html, /WebP 80/);
  assert.doesNotMatch(html, /<script\b/i);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("resource optimization and HTML report self-test passed");
