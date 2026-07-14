import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { JointResourceAnalysis } from "./joint-resource-analysis.js";
import { analyzeManualAttention } from "./manual-attention-analysis.js";
import type { ResourceOptimizationReport } from "./resource-optimization-estimates.js";

const root = await mkdtemp(path.join(os.tmpdir(), "manual-attention-test-"));
try {
  await mkdir(path.join(root, "assets", "main", "native"), { recursive: true });
  await mkdir(path.join(root, "assets", "main"), { recursive: true });
  await writeFile(path.join(root, "assets", "main", "index.js"), Buffer.alloc(3_500_000));
  await writeFile(path.join(root, "assets", "main", "config.json"), Buffer.alloc(1_500_000));
  await writeFile(path.join(root, "assets", "main", "native", "hero.bin"), Buffer.alloc(300_000));
  await writeFile(path.join(root, "index.html"), "<!doctype html>");

  const joint: JointResourceAnalysis = {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectName: "attention-test",
    buildRoot: "web-mobile",
    buildFileCount: 4,
    buildBytes: 10 * 1024 * 1024,
    buildExtensions: [],
    buildBundles: [],
    sourceResourceCount: 3,
    sourceBytes: 5_000_000,
    includedCount: 3,
    includedBytes: 5_000_000,
    notInBuildCount: 0,
    notInBuildBytes: 0,
    notAssessableCount: 0,
    notAssessableBytes: 0,
    assessableIncludedPercentByCount: 100,
    assessableIncludedPercentByBytes: 100,
    sourceCategories: [],
    mappings: [
      {
        path: "assets/Main.scene",
        extension: ".scene",
        bytes: 3_500_000,
        uuid: "11111111-1111-4111-8111-111111111111",
        importer: "scene",
        sourceBundleName: "main",
        status: "included",
        reason: "fixture",
        evidence: "bundle-config",
        buildBundleNames: ["main"],
        buildPaths: [],
      },
      {
        path: "assets/hero.fbx",
        extension: ".fbx",
        bytes: 800_000,
        uuid: "22222222-2222-4222-8222-222222222222",
        importer: "fbx",
        sourceBundleName: "main",
        status: "included",
        reason: "fixture",
        evidence: "build-path",
        buildBundleNames: ["main"],
        buildPaths: ["assets/main/native/hero.bin"],
      },
      {
        path: "assets/small.prefab",
        extension: ".prefab",
        bytes: 50_000,
        uuid: "33333333-3333-4333-8333-333333333333",
        importer: "prefab",
        sourceBundleName: "main",
        status: "included",
        reason: "fixture",
        evidence: "bundle-config",
        buildBundleNames: ["main"],
        buildPaths: [],
      },
    ],
  };

  const optimization: ResourceOptimizationReport = {
    imageTarget: { format: "webp", quality: 80 },
    audioTarget: { format: "mp3", bitrateKbps: 48 },
    imageFileCount: 1,
    measuredImageCount: 1,
    audioFileCount: 1,
    parameterEstimatedAudioCount: 1,
    currentBytes: 1_000_000,
    estimatedAfterBytesMin: 500_000,
    estimatedAfterBytesMax: 550_000,
    estimatedSavingsBytesMin: 450_000,
    estimatedSavingsBytesMax: 500_000,
    totalBuildSavingsPercentMin: 4.5,
    totalBuildSavingsPercentMax: 5,
    categories: [],
    candidates: [
      {
        id: "image:test",
        category: "image",
        priority: "P1",
        buildPath: "assets/main/native/large.png",
        sourcePaths: ["assets/large.png"],
        bundleName: "main",
        extension: ".png",
        currentBytes: 700_000,
        estimatedAfterBytesMin: 200_000,
        estimatedAfterBytesMax: 200_000,
        estimatedSavingsBytesMin: 500_000,
        estimatedSavingsBytesMax: 500_000,
        savingsPercentMin: 71.43,
        savingsPercentMax: 71.43,
        percentOfBuildBytes: 6.67,
        totalBuildImpactPercentMin: 4.77,
        totalBuildImpactPercentMax: 4.77,
        estimateKind: "measured",
        confidence: "high",
        title: "fixture",
        rationale: "fixture",
        nextAction: "fixture",
        metadata: { width: 4096, height: 4096, hasAlpha: true },
      },
      {
        id: "audio:test",
        category: "audio",
        priority: "P2",
        buildPath: "assets/main/native/music.mp3",
        sourcePaths: ["assets/music.mp3"],
        bundleName: "main",
        extension: ".mp3",
        currentBytes: 300_000,
        estimatedAfterBytesMin: 250_000,
        estimatedAfterBytesMax: 260_000,
        estimatedSavingsBytesMin: 40_000,
        estimatedSavingsBytesMax: 50_000,
        savingsPercentMin: 13.33,
        savingsPercentMax: 16.67,
        percentOfBuildBytes: 2.86,
        totalBuildImpactPercentMin: 0.38,
        totalBuildImpactPercentMax: 0.48,
        estimateKind: "parameter-estimate",
        confidence: "medium",
        title: "fixture",
        rationale: "fixture",
        nextAction: "fixture",
        metadata: { durationSeconds: 75, currentBitrateKbps: 64, sampleRateHz: 44100, channels: 2 },
      },
    ],
    warnings: [],
  };

  const report = await analyzeManualAttention(root, joint, optimization);
  assert.equal(report.itemCount, 6);
  assert.equal(report.highCount, 4);
  assert.equal(report.mediumCount, 2);
  assert.deepEqual(
    report.items.map((item) => item.category),
    ["large-scene", "large-build-script", "oversized-image", "long-audio", "large-build-json", "large-model"],
  );
  assert.equal(report.items[0]?.sizeBasis, "source");
  assert.equal(report.items[1]?.sizeBasis, "build");
  assert.equal(report.items.some((item) => item.sourcePaths.includes("assets/small.prefab")), false);
  assert.match(report.items[0]?.nextAction ?? "", /重新构建并试玩/);
  const model = report.items.find((item) => item.category === "large-model");
  assert.equal(model?.metadata.mappedBuildBytes, 300_000);
  assert.equal(report.largestBuildFiles[0]?.path, "assets/main/index.js");
  assert.equal(report.largestBuildFiles[0]?.bytes, 3_500_000);
  assert.equal(report.largestBuildFiles.some((item) => item.path === "assets/main/native/hero.bin"), true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("manual attention analysis self-test passed");
