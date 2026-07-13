import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeCocosUuid,
  type JointResourceAnalysis,
  type SourceBuildMapping,
} from "./joint-resource-analysis.js";
import type {
  OptimizationCategory,
  ResourceOptimizationCandidate,
  ResourceOptimizationCategorySummary,
  ResourceOptimizationReport,
} from "./resource-optimization-estimates.js";

interface BundleConfig {
  name?: unknown;
  uuids?: unknown;
  versions?: {
    native?: unknown;
  };
}

interface NativeVersionEvidence {
  uuid: string;
  bundleName: string | null;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percent(part: number, total: number): number {
  return total > 0 ? round(part / total * 100) : 0;
}

async function walkFiles(root: string, current: string, output: string[]): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(root, absolutePath, output);
    } else if (entry.isFile()) {
      output.push(normalizePath(path.relative(root, absolutePath)));
    }
  }
}

function resolveConfigUuid(reference: unknown, uuids: readonly string[]): string | null {
  if (typeof reference === "number" && Number.isInteger(reference)) {
    return uuids[reference] ?? null;
  }
  if (typeof reference !== "string") return null;
  if (/^\d+$/.test(reference)) {
    const indexed = uuids[Number(reference)];
    if (indexed !== undefined) return indexed;
  }
  return normalizeCocosUuid(reference);
}

function decodeConfigUuids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((candidate) => {
    if (typeof candidate !== "string") return "";
    return normalizeCocosUuid(candidate) ?? "";
  });
}

async function collectNativeVersionEvidence(
  buildRoot: string,
  files: readonly string[],
): Promise<Map<string, NativeVersionEvidence[]>> {
  const output = new Map<string, NativeVersionEvidence[]>();
  for (const relativePath of files) {
    if (!relativePath.endsWith("/config.json") || !relativePath.startsWith("assets/")) continue;
    let config: BundleConfig;
    try {
      config = JSON.parse(await readFile(path.join(buildRoot, ...relativePath.split("/")), "utf8")) as BundleConfig;
    } catch {
      continue;
    }
    const uuids = decodeConfigUuids(config.uuids);
    const nativeVersions = config.versions?.native;
    if (!Array.isArray(nativeVersions)) continue;
    const bundleName = typeof config.name === "string" && config.name.length > 0
      ? config.name
      : relativePath.split("/")[1] ?? null;
    for (let index = 0; index + 1 < nativeVersions.length; index += 2) {
      const uuid = resolveConfigUuid(nativeVersions[index], uuids);
      const version = nativeVersions[index + 1];
      if (uuid === null || typeof version !== "string" || version.length === 0) continue;
      const current = output.get(version) ?? [];
      current.push({ uuid, bundleName });
      output.set(version, current);
    }
  }
  return output;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

export async function enrichGeneratedNativeSourceMappings(
  buildDirectory: string,
  joint: JointResourceAnalysis,
): Promise<number> {
  const buildRoot = path.resolve(buildDirectory);
  const files: string[] = [];
  await walkFiles(buildRoot, buildRoot, files);
  const evidence = await collectNativeVersionEvidence(buildRoot, files);
  if (evidence.size === 0) return 0;

  const mappingsByUuid = new Map<string, SourceBuildMapping[]>();
  for (const mapping of joint.mappings) {
    if (mapping.uuid === null) continue;
    const key = mapping.uuid.toLowerCase();
    const current = mappingsByUuid.get(key) ?? [];
    current.push(mapping);
    mappingsByUuid.set(key, current);
  }

  let matchedPathCount = 0;
  for (const relativePath of files) {
    const stem = path.basename(relativePath, path.extname(relativePath));
    const candidates = evidence.get(stem);
    if (candidates === undefined) continue;
    for (const candidate of candidates) {
      const mappings = mappingsByUuid.get(candidate.uuid.toLowerCase()) ?? [];
      for (const mapping of mappings) {
        const previousLength = mapping.buildPaths.length;
        addUnique(mapping.buildPaths, relativePath);
        if (candidate.bundleName !== null) addUnique(mapping.buildBundleNames, candidate.bundleName);
        mapping.buildPaths.sort();
        mapping.buildBundleNames.sort();
        if (mapping.buildPaths.length > previousLength) matchedPathCount += 1;
        if (mapping.status === "included") {
          mapping.evidence = "build-path";
          mapping.reason = "通过 Bundle native 版本映射找到对应构建文件。";
        }
      }
    }
  }
  return matchedPathCount;
}

function sourcePathsByBuildPath(joint: JointResourceAnalysis): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const mapping of joint.mappings) {
    for (const buildPath of mapping.buildPaths) {
      const current = output.get(buildPath) ?? [];
      addUnique(current, mapping.path);
      current.sort();
      output.set(buildPath, current);
    }
  }
  return output;
}

function isAudioCandidateAboveTarget(
  candidate: ResourceOptimizationCandidate,
  targetBitrateKbps: number,
): boolean {
  if (candidate.category !== "audio") return true;
  const sourceBitrate = candidate.metadata.currentBitrateKbps;
  return typeof sourceBitrate === "number"
    && Number.isFinite(sourceBitrate)
    && sourceBitrate > targetBitrateKbps;
}

function summarizeCategory(
  category: OptimizationCategory,
  original: ResourceOptimizationCategorySummary,
  candidates: readonly ResourceOptimizationCandidate[],
  buildBytes: number,
): ResourceOptimizationCategorySummary {
  const matching = candidates.filter((candidate) => candidate.category === category);
  const savingsMin = matching.reduce((sum, candidate) => sum + candidate.estimatedSavingsBytesMin, 0);
  const savingsMax = matching.reduce((sum, candidate) => sum + candidate.estimatedSavingsBytesMax, 0);
  return {
    ...original,
    candidateCount: matching.length,
    estimatedAfterBytesMin: Math.max(0, original.currentBytes - savingsMax),
    estimatedAfterBytesMax: Math.max(0, original.currentBytes - savingsMin),
    estimatedSavingsBytesMin: savingsMin,
    estimatedSavingsBytesMax: savingsMax,
    savingsPercentMin: percent(savingsMin, original.currentBytes),
    savingsPercentMax: percent(savingsMax, original.currentBytes),
    totalBuildImpactPercentMin: percent(savingsMin, buildBytes),
    totalBuildImpactPercentMax: percent(savingsMax, buildBytes),
  };
}

export function finalizeResourceOptimization(
  joint: JointResourceAnalysis,
  optimization: ResourceOptimizationReport,
): ResourceOptimizationReport {
  const pathSources = sourcePathsByBuildPath(joint);
  const candidates = optimization.candidates
    .filter((candidate) => isAudioCandidateAboveTarget(candidate, optimization.audioTarget.bitrateKbps))
    .map((candidate) => ({
      ...candidate,
      sourcePaths: candidate.sourcePaths.length > 0
        ? candidate.sourcePaths
        : [...(pathSources.get(candidate.buildPath) ?? [])],
    }));

  const categories = optimization.categories.map((category) => summarizeCategory(
    category.category,
    category,
    candidates,
    joint.buildBytes,
  ));
  const currentBytes = categories.reduce((sum, category) => sum + category.currentBytes, 0);
  const savingsMin = categories.reduce((sum, category) => sum + category.estimatedSavingsBytesMin, 0);
  const savingsMax = categories.reduce((sum, category) => sum + category.estimatedSavingsBytesMax, 0);
  const warnings = optimization.warnings.filter((warning) => !warning.includes("音频尺寸为"));
  warnings.push("音频候选仅包含源码率高于目标码率的文件；源文件已经等于或低于目标码率时不会重复转码。");
  warnings.push("本报告中的体积变化针对解压后的 Web Mobile 构建目录，不等同于最终 Brotli Payload 或单 HTML 的降幅；最终交付体积必须通过真实打包测量。");

  return {
    ...optimization,
    parameterEstimatedAudioCount: candidates.filter((candidate) => candidate.category === "audio").length,
    currentBytes,
    estimatedAfterBytesMin: Math.max(0, currentBytes - savingsMax),
    estimatedAfterBytesMax: Math.max(0, currentBytes - savingsMin),
    estimatedSavingsBytesMin: savingsMin,
    estimatedSavingsBytesMax: savingsMax,
    totalBuildSavingsPercentMin: percent(savingsMin, joint.buildBytes),
    totalBuildSavingsPercentMax: percent(savingsMax, joint.buildBytes),
    categories,
    candidates,
    warnings,
  };
}
