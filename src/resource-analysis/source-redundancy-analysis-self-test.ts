import assert from "node:assert/strict";

import type { AssetsManifest } from "./assets-manifest.js";
import type { JointResourceAnalysis } from "./joint-resource-analysis.js";
import { createRedundancyResourceAnalysisHtmlReport } from "./resource-analysis-redundancy-report.js";
import type { ResourceOptimizationReport } from "./resource-optimization-estimates.js";
import { analyzeSourceRedundancy } from "./source-redundancy-analysis.js";

const manifest: AssetsManifest = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  projectName: "fixture",
  assetsRoot: "assets",
  resourceCount: 5,
  totalBytes: 5_000,
  metaCount: 5,
  missingMetaCount: 0,
  entries: [
    { path: "assets/a.png", extension: ".png", bytes: 1_000, sha256: "same-a", modifiedAt: new Date(0).toISOString(), metaPath: "assets/a.png.meta", uuid: "a", importer: "image", bundleName: "main" },
    { path: "assets/b.png", extension: ".png", bytes: 1_000, sha256: "same-a", modifiedAt: new Date(0).toISOString(), metaPath: "assets/b.png.meta", uuid: "b", importer: "image", bundleName: "main" },
    { path: "assets/c.json", extension: ".json", bytes: 500, sha256: "same-b", modifiedAt: new Date(0).toISOString(), metaPath: "assets/c.json.meta", uuid: "c", importer: "json", bundleName: "main" },
    { path: "assets/d.json", extension: ".json", bytes: 500, sha256: "same-b", modifiedAt: new Date(0).toISOString(), metaPath: "assets/d.json.meta", uuid: "d", importer: "json", bundleName: "main" },
    { path: "assets/unique.bin", extension: ".bin", bytes: 2_000, sha256: "unique", modifiedAt: new Date(0).toISOString(), metaPath: "assets/unique.bin.meta", uuid: "e", importer: "binary", bundleName: "main" },
  ],
};

const mapping = (path: string, status: "included" | "not-in-build" | "not-assessable", buildPaths: string[] = []) => ({
  path,
  extension: path.endsWith(".png") ? ".png" : ".json",
  bytes: path.endsWith(".png") ? 1_000 : 500,
  uuid: path,
  importer: null,
  sourceBundleName: "main",
  status,
  reason: "fixture",
  evidence: status === "included" ? "build-path" as const : "none" as const,
  buildBundleNames: status === "included" ? ["main"] : [],
  buildPaths,
});

const joint: JointResourceAnalysis = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  projectName: "fixture",
  buildRoot: "web-mobile",
  buildFileCount: 2,
  buildBytes: 10_000,
  buildExtensions: [],
  buildBundles: [],
  sourceResourceCount: 5,
  sourceBytes: 5_000,
  includedCount: 3,
  includedBytes: 3_000,
  notInBuildCount: 2,
  notInBuildBytes: 1_000,
  notAssessableCount: 0,
  notAssessableBytes: 0,
  assessableIncludedPercentByCount: 60,
  assessableIncludedPercentByBytes: 75,
  sourceCategories: [],
  mappings: [
    mapping("assets/a.png", "included", ["assets/main/native/a.png"]),
    mapping("assets/b.png", "included", ["assets/main/native/b.png"]),
    mapping("assets/c.json", "included", ["assets/main/import/c.json"]),
    mapping("assets/d.json", "not-in-build"),
    mapping("assets/unique.bin", "not-in-build"),
  ],
};

const redundancy = analyzeSourceRedundancy(manifest, joint);
assert.equal(redundancy.duplicateGroupCount, 2);
assert.equal(redundancy.duplicateFileCount, 4);
assert.equal(redundancy.redundantProjectBytes, 1_500);
assert.equal(redundancy.allInBuildGroupCount, 1);
assert.equal(redundancy.mixedGroupCount, 1);
assert.equal(redundancy.groups[0]?.classification, "all-in-build");
assert.equal(redundancy.groups[1]?.classification, "mixed");

const optimization: ResourceOptimizationReport = {
  imageTarget: { format: "webp", quality: 80 },
  audioTarget: { format: "mp3", bitrateKbps: 48 },
  imageFileCount: 0,
  measuredImageCount: 0,
  audioFileCount: 0,
  parameterEstimatedAudioCount: 0,
  currentBytes: 0,
  estimatedAfterBytesMin: 0,
  estimatedAfterBytesMax: 0,
  estimatedSavingsBytesMin: 0,
  estimatedSavingsBytesMax: 0,
  totalBuildSavingsPercentMin: 0,
  totalBuildSavingsPercentMax: 0,
  categories: [],
  candidates: [],
  warnings: [],
};
const html = createRedundancyResourceAnalysisHtmlReport({ ...joint, optimization, redundancy });
assert.match(html, /完全重复的工程资源/);
assert.match(html, /工程理论重复字节/);
assert.match(html, /全部进入构建/);
assert.match(html, /部分进入构建/);
assert.match(html, /assets\/a\.png/);
assert.match(html, /不等同于最终 Web Mobile/);

console.log("source redundancy analysis self-test passed");
