import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { JointResourceAnalysis } from "./joint-resource-analysis.js";
import {
  enrichGeneratedNativeSourceMappings,
  finalizeResourceOptimization,
} from "./resource-analysis-finalize.js";
import type { ResourceOptimizationReport } from "./resource-optimization-estimates.js";

const root = await mkdtemp(path.join(os.tmpdir(), "resource-analysis-finalize-"));
try {
  const uuid = "12345678-1234-4234-8234-123456789abc";
  await mkdir(path.join(root, "assets", "resources", "native", "ab"), { recursive: true });
  await writeFile(path.join(root, "assets", "resources", "native", "ab", "abc123def.png"), Buffer.from([1, 2, 3]));
  await writeFile(path.join(root, "assets", "resources", "config.json"), JSON.stringify({
    name: "resources",
    uuids: [uuid],
    versions: { native: [0, "abc123def"] },
  }));

  const joint: JointResourceAnalysis = {
    version: 1,
    generatedAt: new Date(0).toISOString(),
    projectName: "fixture",
    buildRoot: root,
    buildFileCount: 2,
    buildBytes: 100_000,
    buildExtensions: [],
    buildBundles: [],
    sourceResourceCount: 1,
    sourceBytes: 50_000,
    includedCount: 1,
    includedBytes: 50_000,
    notInBuildCount: 0,
    notInBuildBytes: 0,
    notAssessableCount: 0,
    notAssessableBytes: 0,
    assessableIncludedPercentByCount: 100,
    assessableIncludedPercentByBytes: 100,
    sourceCategories: [],
    mappings: [{
      path: "assets/ui/generated-source.png",
      extension: ".png",
      bytes: 50_000,
      uuid,
      importer: "image",
      sourceBundleName: null,
      status: "included",
      reason: "在构建 Bundle 配置中找到相同 UUID。",
      evidence: "bundle-config",
      buildBundleNames: ["resources"],
      buildPaths: [],
    }],
  };

  const matched = await enrichGeneratedNativeSourceMappings(root, joint);
  assert.equal(matched, 1);
  assert.deepEqual(joint.mappings[0]?.buildPaths, ["assets/resources/native/ab/abc123def.png"]);
  assert.equal(joint.mappings[0]?.evidence, "build-path");

  const baseCandidate = {
    priority: "P2" as const,
    sourcePaths: [] as string[],
    bundleName: "resources",
    extension: ".mp3",
    estimatedAfterBytesMin: 5_000,
    estimatedAfterBytesMax: 5_500,
    estimatedSavingsBytesMin: 4_500,
    estimatedSavingsBytesMax: 5_000,
    savingsPercentMin: 45,
    savingsPercentMax: 50,
    percentOfBuildBytes: 10,
    totalBuildImpactPercentMin: 4.5,
    totalBuildImpactPercentMax: 5,
    estimateKind: "parameter-estimate" as const,
    confidence: "medium" as const,
    title: "fixture",
    rationale: "fixture",
    nextAction: "fixture",
  };
  const optimization: ResourceOptimizationReport = {
    imageTarget: { format: "webp", quality: 80 },
    audioTarget: { format: "mp3", bitrateKbps: 48 },
    imageFileCount: 0,
    measuredImageCount: 0,
    audioFileCount: 2,
    parameterEstimatedAudioCount: 2,
    currentBytes: 20_000,
    estimatedAfterBytesMin: 10_000,
    estimatedAfterBytesMax: 11_000,
    estimatedSavingsBytesMin: 9_000,
    estimatedSavingsBytesMax: 10_000,
    totalBuildSavingsPercentMin: 9,
    totalBuildSavingsPercentMax: 10,
    categories: [
      {
        category: "image",
        fileCount: 0,
        candidateCount: 0,
        currentBytes: 0,
        estimatedAfterBytesMin: 0,
        estimatedAfterBytesMax: 0,
        estimatedSavingsBytesMin: 0,
        estimatedSavingsBytesMax: 0,
        savingsPercentMin: 0,
        savingsPercentMax: 0,
        totalBuildImpactPercentMin: 0,
        totalBuildImpactPercentMax: 0,
      },
      {
        category: "audio",
        fileCount: 2,
        candidateCount: 2,
        currentBytes: 20_000,
        estimatedAfterBytesMin: 10_000,
        estimatedAfterBytesMax: 11_000,
        estimatedSavingsBytesMin: 9_000,
        estimatedSavingsBytesMax: 10_000,
        savingsPercentMin: 45,
        savingsPercentMax: 50,
        totalBuildImpactPercentMin: 9,
        totalBuildImpactPercentMax: 10,
      },
    ],
    candidates: [
      {
        ...baseCandidate,
        id: "audio:low.mp3",
        category: "audio",
        buildPath: "assets/resources/native/low.mp3",
        currentBytes: 10_000,
        metadata: { currentBitrateKbps: 32 },
      },
      {
        ...baseCandidate,
        id: "audio:high.mp3",
        category: "audio",
        buildPath: "assets/resources/native/high.mp3",
        currentBytes: 10_000,
        metadata: { currentBitrateKbps: 192 },
      },
    ],
    warnings: ["图片尺寸为临时 WebP 80 实测值；音频尺寸为 48 kbps 参数估算，最终结果仍以实际编码和浏览器试玩为准。"],
  };

  const finalized = finalizeResourceOptimization(joint, optimization);
  assert.equal(finalized.parameterEstimatedAudioCount, 1);
  assert.equal(finalized.candidates.length, 1);
  assert.equal(finalized.candidates[0]?.id, "audio:high.mp3");
  assert.equal(finalized.categories.find((item) => item.category === "audio")?.candidateCount, 1);
  assert(finalized.warnings.some((warning) => warning.includes("不等同于最终 Brotli Payload")));

  const atlasJoint: JointResourceAnalysis = {
    ...joint,
    buildBytes: 1_000_000,
    mappings: [
      {
        path: "assets/ui/atlas/button.png",
        extension: ".png",
        bytes: 80_000,
        uuid: "22345678-1234-4234-8234-123456789abc",
        importer: "image",
        sourceBundleName: null,
        status: "included",
        reason: "在构建 Bundle 配置中找到相同 UUID。",
        evidence: "bundle-config",
        buildBundleNames: ["resources"],
        buildPaths: [],
      },
      {
        path: "assets/ui/atlas/icon.png",
        extension: ".png",
        bytes: 40_000,
        uuid: "32345678-1234-4234-8234-123456789abc",
        importer: "image",
        sourceBundleName: null,
        status: "included",
        reason: "在构建 Bundle 配置中找到相同 UUID。",
        evidence: "bundle-config",
        buildBundleNames: ["resources"],
        buildPaths: [],
      },
    ],
  };
  const atlasOptimization: ResourceOptimizationReport = {
    imageTarget: { format: "webp", quality: 80 },
    audioTarget: { format: "mp3", bitrateKbps: 48 },
    imageFileCount: 1,
    measuredImageCount: 1,
    audioFileCount: 0,
    parameterEstimatedAudioCount: 0,
    currentBytes: 500_000,
    estimatedAfterBytesMin: 100_000,
    estimatedAfterBytesMax: 100_000,
    estimatedSavingsBytesMin: 400_000,
    estimatedSavingsBytesMax: 400_000,
    totalBuildSavingsPercentMin: 40,
    totalBuildSavingsPercentMax: 40,
    categories: [
      {
        category: "image",
        fileCount: 1,
        candidateCount: 1,
        currentBytes: 500_000,
        estimatedAfterBytesMin: 100_000,
        estimatedAfterBytesMax: 100_000,
        estimatedSavingsBytesMin: 400_000,
        estimatedSavingsBytesMax: 400_000,
        savingsPercentMin: 80,
        savingsPercentMax: 80,
        totalBuildImpactPercentMin: 40,
        totalBuildImpactPercentMax: 40,
      },
      {
        category: "audio",
        fileCount: 0,
        candidateCount: 0,
        currentBytes: 0,
        estimatedAfterBytesMin: 0,
        estimatedAfterBytesMax: 0,
        estimatedSavingsBytesMin: 0,
        estimatedSavingsBytesMax: 0,
        savingsPercentMin: 0,
        savingsPercentMax: 0,
        totalBuildImpactPercentMin: 0,
        totalBuildImpactPercentMax: 0,
      },
    ],
    candidates: [{
      id: "image:assets/resources/native/ab/abc123def.png",
      category: "image",
      priority: "P0",
      buildPath: "assets/resources/native/ab/abc123def.png",
      sourcePaths: [],
      bundleName: "resources",
      extension: ".png",
      currentBytes: 500_000,
      estimatedAfterBytesMin: 100_000,
      estimatedAfterBytesMax: 100_000,
      estimatedSavingsBytesMin: 400_000,
      estimatedSavingsBytesMax: 400_000,
      savingsPercentMin: 80,
      savingsPercentMax: 80,
      percentOfBuildBytes: 50,
      totalBuildImpactPercentMin: 40,
      totalBuildImpactPercentMax: 40,
      estimateKind: "measured",
      confidence: "high",
      title: "fixture atlas",
      rationale: "fixture",
      nextAction: "fixture",
      metadata: {},
    }],
    warnings: [],
  };
  const atlasFinalized = finalizeResourceOptimization(atlasJoint, atlasOptimization);
  const atlasCandidate = atlasFinalized.candidates[0];
  assert.equal(atlasCandidate?.metadata.sourcePathRelation, "generated-group");
  assert.equal(atlasCandidate?.metadata.generatedResourceKind, "probable-atlas-page");
  assert.equal(atlasCandidate?.metadata.generatedSourceGroupCount, 2);
  assert.deepEqual(atlasCandidate?.sourcePaths, ["assets/ui/atlas/button.png", "assets/ui/atlas/icon.png"]);
  assert.match(atlasCandidate?.rationale ?? "", /疑似合图页/);
  assert(atlasFinalized.warnings.some((warning) => warning.includes("不能保证合图页与源图是一对一关系")));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("resource analysis finalize self-test passed");
