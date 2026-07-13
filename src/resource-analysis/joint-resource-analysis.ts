import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { AssetsManifest, AssetsManifestEntry } from "./assets-manifest.js";

const FULL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FULL_UUID_SEARCH_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
const COMPRESSED_UUID_PATTERN = /^[0-9a-f]{2}[A-Za-z0-9+/]{20}$/i;
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EDITOR_ONLY_EXTENSIONS = new Set([".pac"]);

export type SourceBuildStatus = "included" | "not-in-build" | "not-assessable";
export type SourceBuildEvidence = "build-path" | "bundle-config" | "none";

export interface BuildFileRecord {
  path: string;
  extension: string;
  bytes: number;
  bundleName: string | null;
}

export interface BuildExtensionSummary {
  extension: string;
  fileCount: number;
  bytes: number;
  percentOfBuildBytes: number;
}

export interface BuildBundleSummary {
  name: string;
  fileCount: number;
  bytes: number;
  percentOfBuildBytes: number;
  mappedSourceCount: number;
  mappedSourceBytes: number;
}

export interface SourceCategorySummary {
  category: string;
  sourceCount: number;
  sourceBytes: number;
  includedCount: number;
  includedBytes: number;
  notInBuildCount: number;
  notInBuildBytes: number;
  notAssessableCount: number;
  notAssessableBytes: number;
  includedPercentByCount: number | null;
  includedPercentByBytes: number | null;
}

export interface SourceBuildMapping {
  path: string;
  extension: string;
  bytes: number;
  uuid: string | null;
  importer: string | null;
  sourceBundleName: string | null;
  status: SourceBuildStatus;
  reason: string;
  evidence: SourceBuildEvidence;
  buildBundleNames: string[];
  buildPaths: string[];
}

export interface JointResourceAnalysis {
  version: 1;
  generatedAt: string;
  projectName: string;
  buildRoot: string;
  buildFileCount: number;
  buildBytes: number;
  buildExtensions: BuildExtensionSummary[];
  buildBundles: BuildBundleSummary[];
  sourceResourceCount: number;
  sourceBytes: number;
  includedCount: number;
  includedBytes: number;
  notInBuildCount: number;
  notInBuildBytes: number;
  notAssessableCount: number;
  notAssessableBytes: number;
  assessableIncludedPercentByCount: number | null;
  assessableIncludedPercentByBytes: number | null;
  sourceCategories: SourceCategorySummary[];
  mappings: SourceBuildMapping[];
}

interface BundleConfig {
  name?: unknown;
  uuids?: unknown;
}

interface UuidEvidence {
  bundleNames: Set<string>;
  buildPaths: Set<string>;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function roundPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function nullablePercent(numerator: number, denominator: number): number | null {
  return denominator <= 0 ? null : roundPercent(numerator, denominator);
}

function buildBundleName(relativePath: string): string | null {
  const segments = normalizePath(relativePath).split("/");
  return segments[0] === "assets" && segments.length > 1
    ? segments[1] ?? null
    : null;
}

function sourceCategory(entry: Pick<AssetsManifestEntry, "path" | "extension">): string {
  const lowerPath = entry.path.toLowerCase();
  if (CODE_EXTENSIONS.has(entry.extension) || lowerPath.endsWith(".d.ts")) return "code";
  if ([".png", ".jpg", ".jpeg", ".webp", ".tga", ".bmp", ".gif"].includes(entry.extension)) return "image";
  if ([".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac"].includes(entry.extension)) return "audio";
  if ([".ttf", ".otf", ".woff", ".woff2"].includes(entry.extension)) return "font";
  if ([".fbx", ".gltf", ".glb"].includes(entry.extension)) return "model";
  if ([".scene", ".prefab", ".anim", ".mtl", ".pmtl", ".effect"].includes(entry.extension)) return "cocos";
  if (EDITOR_ONLY_EXTENSIONS.has(entry.extension)) return "editor-config";
  return "other";
}

export function normalizeCocosUuid(value: string): string | null {
  const base = value.split("@", 1)[0];
  if (base === undefined) return null;
  if (FULL_UUID_PATTERN.test(base)) return base.toLowerCase();
  if (!COMPRESSED_UUID_PATTERN.test(base)) return null;
  try {
    const leadingByte = Buffer.from(base.slice(0, 2), "hex");
    const remaining = Buffer.from(`${base.slice(2)}==`, "base64");
    const bytes = Buffer.concat([leadingByte, remaining]);
    if (bytes.length !== 16) return null;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

function validAssetsManifest(value: unknown): value is AssetsManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<AssetsManifest>;
  return record.version === 1
    && typeof record.projectName === "string"
    && typeof record.resourceCount === "number"
    && typeof record.totalBytes === "number"
    && Array.isArray(record.entries);
}

export async function readAssetsManifest(filePath: string): Promise<AssetsManifest> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!validAssetsManifest(parsed)) {
    throw new Error("assets manifest 格式无效或版本不受支持。");
  }
  return parsed;
}

async function walkBuildFiles(root: string, current: string, output: BuildFileRecord[]): Promise<void> {
  const items = await readdir(current, { withFileTypes: true });
  for (const item of items) {
    const absolutePath = path.join(current, item.name);
    if (item.isDirectory()) {
      await walkBuildFiles(root, absolutePath, output);
      continue;
    }
    if (!item.isFile()) continue;
    const fileStat = await stat(absolutePath);
    const relativePath = normalizePath(path.relative(root, absolutePath));
    output.push({
      path: relativePath,
      extension: path.extname(relativePath).toLowerCase() || "[none]",
      bytes: fileStat.size,
      bundleName: buildBundleName(relativePath),
    });
  }
}

function uuidEvidence(map: Map<string, UuidEvidence>, uuid: string): UuidEvidence {
  let evidence = map.get(uuid);
  if (evidence === undefined) {
    evidence = { bundleNames: new Set<string>(), buildPaths: new Set<string>() };
    map.set(uuid, evidence);
  }
  return evidence;
}

async function collectBuildUuidEvidence(
  buildRoot: string,
  files: readonly BuildFileRecord[],
): Promise<Map<string, UuidEvidence>> {
  const evidenceMap = new Map<string, UuidEvidence>();
  for (const file of files) {
    for (const match of file.path.matchAll(FULL_UUID_SEARCH_PATTERN)) {
      const uuid = match[0]?.toLowerCase();
      if (uuid === undefined) continue;
      const evidence = uuidEvidence(evidenceMap, uuid);
      evidence.buildPaths.add(file.path);
      if (file.bundleName !== null) evidence.bundleNames.add(file.bundleName);
    }
    if (!file.path.endsWith("/config.json") || !file.path.includes("assets/")) continue;
    const configPath = path.join(buildRoot, ...file.path.split("/"));
    let config: BundleConfig;
    try {
      config = JSON.parse(await readFile(configPath, "utf8")) as BundleConfig;
    } catch {
      continue;
    }
    const configBundle = typeof config.name === "string" && config.name.length > 0
      ? config.name
      : file.bundleName;
    if (!Array.isArray(config.uuids)) continue;
    for (const candidate of config.uuids) {
      if (typeof candidate !== "string") continue;
      const uuid = normalizeCocosUuid(candidate);
      if (uuid === null) continue;
      const evidence = uuidEvidence(evidenceMap, uuid);
      if (configBundle !== null) evidence.bundleNames.add(configBundle);
    }
  }
  return evidenceMap;
}

function classifySourceEntry(
  entry: AssetsManifestEntry,
  evidenceMap: ReadonlyMap<string, UuidEvidence>,
): SourceBuildMapping {
  const category = sourceCategory(entry);
  if (category === "code") {
    return {
      path: entry.path,
      extension: entry.extension,
      bytes: entry.bytes,
      uuid: entry.uuid,
      importer: entry.importer,
      sourceBundleName: entry.bundleName,
      status: "not-assessable",
      reason: "脚本会被编译并合并，不能仅通过构建资源 UUID 判断是否进入本次构建。",
      evidence: "none",
      buildBundleNames: [],
      buildPaths: [],
    };
  }
  if (category === "editor-config") {
    return {
      path: entry.path,
      extension: entry.extension,
      bytes: entry.bytes,
      uuid: entry.uuid,
      importer: entry.importer,
      sourceBundleName: entry.bundleName,
      status: "not-assessable",
      reason: "该文件属于编辑器配置，通常不会以独立运行时资源进入构建。",
      evidence: "none",
      buildBundleNames: [],
      buildPaths: [],
    };
  }
  if (entry.uuid === null || !FULL_UUID_PATTERN.test(entry.uuid)) {
    return {
      path: entry.path,
      extension: entry.extension,
      bytes: entry.bytes,
      uuid: entry.uuid,
      importer: entry.importer,
      sourceBundleName: entry.bundleName,
      status: "not-assessable",
      reason: "缺少可用于构建映射的有效 UUID。",
      evidence: "none",
      buildBundleNames: [],
      buildPaths: [],
    };
  }
  const evidence = evidenceMap.get(entry.uuid.toLowerCase());
  if (evidence === undefined) {
    return {
      path: entry.path,
      extension: entry.extension,
      bytes: entry.bytes,
      uuid: entry.uuid,
      importer: entry.importer,
      sourceBundleName: entry.bundleName,
      status: "not-in-build",
      reason: "未在本次 Web Mobile 构建的 Bundle 配置或构建文件路径中找到该 UUID。",
      evidence: "none",
      buildBundleNames: [],
      buildPaths: [],
    };
  }
  const buildPaths = [...evidence.buildPaths].sort();
  return {
    path: entry.path,
    extension: entry.extension,
    bytes: entry.bytes,
    uuid: entry.uuid,
    importer: entry.importer,
    sourceBundleName: entry.bundleName,
    status: "included",
    reason: buildPaths.length > 0
      ? "在构建文件路径中找到相同 UUID。"
      : "在构建 Bundle 配置中找到相同 UUID。",
    evidence: buildPaths.length > 0 ? "build-path" : "bundle-config",
    buildBundleNames: [...evidence.bundleNames].sort(),
    buildPaths,
  };
}

function summarizeExtensions(files: readonly BuildFileRecord[], totalBytes: number): BuildExtensionSummary[] {
  const summaries = new Map<string, { fileCount: number; bytes: number }>();
  for (const file of files) {
    const current = summaries.get(file.extension) ?? { fileCount: 0, bytes: 0 };
    current.fileCount += 1;
    current.bytes += file.bytes;
    summaries.set(file.extension, current);
  }
  return [...summaries.entries()]
    .map(([extension, value]) => ({
      extension,
      fileCount: value.fileCount,
      bytes: value.bytes,
      percentOfBuildBytes: roundPercent(value.bytes, totalBytes),
    }))
    .sort((left, right) => right.bytes - left.bytes || left.extension.localeCompare(right.extension));
}

function summarizeCategories(mappings: readonly SourceBuildMapping[]): SourceCategorySummary[] {
  const summaries = new Map<string, SourceCategorySummary>();
  for (const mapping of mappings) {
    const category = sourceCategory(mapping);
    const summary = summaries.get(category) ?? {
      category,
      sourceCount: 0,
      sourceBytes: 0,
      includedCount: 0,
      includedBytes: 0,
      notInBuildCount: 0,
      notInBuildBytes: 0,
      notAssessableCount: 0,
      notAssessableBytes: 0,
      includedPercentByCount: null,
      includedPercentByBytes: null,
    };
    summary.sourceCount += 1;
    summary.sourceBytes += mapping.bytes;
    if (mapping.status === "included") {
      summary.includedCount += 1;
      summary.includedBytes += mapping.bytes;
    } else if (mapping.status === "not-in-build") {
      summary.notInBuildCount += 1;
      summary.notInBuildBytes += mapping.bytes;
    } else {
      summary.notAssessableCount += 1;
      summary.notAssessableBytes += mapping.bytes;
    }
    summaries.set(category, summary);
  }
  for (const summary of summaries.values()) {
    summary.includedPercentByCount = nullablePercent(
      summary.includedCount,
      summary.includedCount + summary.notInBuildCount,
    );
    summary.includedPercentByBytes = nullablePercent(
      summary.includedBytes,
      summary.includedBytes + summary.notInBuildBytes,
    );
  }
  return [...summaries.values()].sort((left, right) => right.sourceBytes - left.sourceBytes);
}

function summarizeBundles(
  files: readonly BuildFileRecord[],
  mappings: readonly SourceBuildMapping[],
  totalBytes: number,
): BuildBundleSummary[] {
  const summaries = new Map<string, BuildBundleSummary>();
  for (const file of files) {
    if (file.bundleName === null) continue;
    const summary = summaries.get(file.bundleName) ?? {
      name: file.bundleName,
      fileCount: 0,
      bytes: 0,
      percentOfBuildBytes: 0,
      mappedSourceCount: 0,
      mappedSourceBytes: 0,
    };
    summary.fileCount += 1;
    summary.bytes += file.bytes;
    summaries.set(file.bundleName, summary);
  }
  for (const mapping of mappings) {
    if (mapping.status !== "included") continue;
    for (const bundleName of mapping.buildBundleNames) {
      const summary = summaries.get(bundleName) ?? {
        name: bundleName,
        fileCount: 0,
        bytes: 0,
        percentOfBuildBytes: 0,
        mappedSourceCount: 0,
        mappedSourceBytes: 0,
      };
      summary.mappedSourceCount += 1;
      summary.mappedSourceBytes += mapping.bytes;
      summaries.set(bundleName, summary);
    }
  }
  for (const summary of summaries.values()) {
    summary.percentOfBuildBytes = roundPercent(summary.bytes, totalBytes);
  }
  return [...summaries.values()].sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name));
}

export async function analyzeJointResources(
  buildDirectory: string,
  manifest: AssetsManifest,
): Promise<JointResourceAnalysis> {
  const buildRoot = path.resolve(buildDirectory);
  const buildRootStat = await stat(buildRoot).catch(() => null);
  if (!buildRootStat?.isDirectory()) {
    throw new Error(`Web Mobile 构建目录不存在：${buildRoot}`);
  }
  const buildFiles: BuildFileRecord[] = [];
  await walkBuildFiles(buildRoot, buildRoot, buildFiles);
  buildFiles.sort((left, right) => left.path.localeCompare(right.path));
  const buildBytes = buildFiles.reduce((sum, file) => sum + file.bytes, 0);
  const evidenceMap = await collectBuildUuidEvidence(buildRoot, buildFiles);
  const mappings = manifest.entries
    .map((entry) => classifySourceEntry(entry, evidenceMap))
    .sort((left, right) => {
      const statusOrder: Record<SourceBuildStatus, number> = {
        "not-in-build": 0,
        included: 1,
        "not-assessable": 2,
      };
      return statusOrder[left.status] - statusOrder[right.status]
        || right.bytes - left.bytes
        || left.path.localeCompare(right.path);
    });
  let includedCount = 0;
  let includedBytes = 0;
  let notInBuildCount = 0;
  let notInBuildBytes = 0;
  let notAssessableCount = 0;
  let notAssessableBytes = 0;
  for (const mapping of mappings) {
    if (mapping.status === "included") {
      includedCount += 1;
      includedBytes += mapping.bytes;
    } else if (mapping.status === "not-in-build") {
      notInBuildCount += 1;
      notInBuildBytes += mapping.bytes;
    } else {
      notAssessableCount += 1;
      notAssessableBytes += mapping.bytes;
    }
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectName: manifest.projectName,
    buildRoot: normalizePath(buildRoot),
    buildFileCount: buildFiles.length,
    buildBytes,
    buildExtensions: summarizeExtensions(buildFiles, buildBytes),
    buildBundles: summarizeBundles(buildFiles, mappings, buildBytes),
    sourceResourceCount: manifest.resourceCount,
    sourceBytes: manifest.totalBytes,
    includedCount,
    includedBytes,
    notInBuildCount,
    notInBuildBytes,
    notAssessableCount,
    notAssessableBytes,
    assessableIncludedPercentByCount: nullablePercent(includedCount, includedCount + notInBuildCount),
    assessableIncludedPercentByBytes: nullablePercent(includedBytes, includedBytes + notInBuildBytes),
    sourceCategories: summarizeCategories(mappings),
    mappings,
  };
}
