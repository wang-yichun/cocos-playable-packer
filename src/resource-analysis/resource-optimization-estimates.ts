import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { parseFile } from "music-metadata";
import sharp from "sharp";

import type { JointResourceAnalysis, SourceBuildMapping } from "./joint-resource-analysis.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tga", ".bmp"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
const UUID_IN_NAME = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MIN_REPORTED_SAVINGS_BYTES = 1024;
const TARGET_IMAGE_QUALITY = 80;
const TARGET_AUDIO_BITRATE_KBPS = 48;

export type OptimizationEstimateKind = "measured" | "parameter-estimate";
export type OptimizationPriority = "P0" | "P1" | "P2";
export type OptimizationCategory = "image" | "audio";

export interface ResourceOptimizationCandidate {
  id: string;
  category: OptimizationCategory;
  priority: OptimizationPriority;
  buildPath: string;
  sourcePaths: string[];
  bundleName: string | null;
  extension: string;
  currentBytes: number;
  estimatedAfterBytesMin: number;
  estimatedAfterBytesMax: number;
  estimatedSavingsBytesMin: number;
  estimatedSavingsBytesMax: number;
  savingsPercentMin: number;
  savingsPercentMax: number;
  percentOfBuildBytes: number;
  totalBuildImpactPercentMin: number;
  totalBuildImpactPercentMax: number;
  estimateKind: OptimizationEstimateKind;
  confidence: "high" | "medium";
  title: string;
  rationale: string;
  nextAction: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface ResourceOptimizationCategorySummary {
  category: OptimizationCategory;
  fileCount: number;
  candidateCount: number;
  currentBytes: number;
  estimatedAfterBytesMin: number;
  estimatedAfterBytesMax: number;
  estimatedSavingsBytesMin: number;
  estimatedSavingsBytesMax: number;
  savingsPercentMin: number;
  savingsPercentMax: number;
  totalBuildImpactPercentMin: number;
  totalBuildImpactPercentMax: number;
}

export interface ResourceOptimizationReport {
  imageTarget: { format: "webp"; quality: number };
  audioTarget: { format: "mp3"; bitrateKbps: number };
  imageFileCount: number;
  measuredImageCount: number;
  audioFileCount: number;
  parameterEstimatedAudioCount: number;
  currentBytes: number;
  estimatedAfterBytesMin: number;
  estimatedAfterBytesMax: number;
  estimatedSavingsBytesMin: number;
  estimatedSavingsBytesMax: number;
  totalBuildSavingsPercentMin: number;
  totalBuildSavingsPercentMax: number;
  categories: ResourceOptimizationCategorySummary[];
  candidates: ResourceOptimizationCandidate[];
  warnings: string[];
}

interface BuildCandidateFile {
  absolutePath: string;
  path: string;
  extension: string;
  bytes: number;
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

function bundleName(relativePath: string): string | null {
  const segments = normalizePath(relativePath).split("/");
  return segments[0] === "assets" && segments.length > 1 ? segments[1] ?? null : null;
}

function priorityForImpact(maximumImpactPercent: number): OptimizationPriority {
  if (maximumImpactPercent >= 3) return "P0";
  if (maximumImpactPercent >= 1) return "P1";
  return "P2";
}

async function walkCandidateFiles(
  root: string,
  current: string,
  output: BuildCandidateFile[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkCandidateFiles(root, absolutePath, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = normalizePath(path.relative(root, absolutePath));
    const extension = path.extname(relativePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension) && !AUDIO_EXTENSIONS.has(extension)) continue;
    const info = await stat(absolutePath);
    output.push({
      absolutePath,
      path: relativePath,
      extension,
      bytes: info.size,
      bundleName: bundleName(relativePath),
    });
  }
}

function sourcePathMap(mappings: readonly SourceBuildMapping[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const mapping of mappings) {
    if (mapping.uuid === null) continue;
    const key = mapping.uuid.toLowerCase();
    const paths = map.get(key) ?? [];
    paths.push(mapping.path);
    map.set(key, paths);
  }
  return map;
}

function sourcePathsForBuildPath(buildPath: string, sources: ReadonlyMap<string, string[]>): string[] {
  const uuid = UUID_IN_NAME.exec(path.basename(buildPath))?.[0]?.toLowerCase();
  return uuid === undefined ? [] : [...(sources.get(uuid) ?? [])].sort();
}

function candidateId(category: OptimizationCategory, buildPath: string): string {
  return `${category}:${buildPath}`;
}

async function measureImageCandidate(
  file: BuildCandidateFile,
  buildBytes: number,
  sources: ReadonlyMap<string, string[]>,
): Promise<ResourceOptimizationCandidate | null> {
  try {
    const pipeline = sharp(file.absolutePath, {
      animated: false,
      failOn: "none",
      limitInputPixels: 100_000_000,
    });
    const metadata = await pipeline.metadata();
    const webp = await pipeline.webp({ quality: TARGET_IMAGE_QUALITY, effort: 4 }).toBuffer();
    const savings = Math.max(0, file.bytes - webp.byteLength);
    if (savings < MIN_REPORTED_SAVINGS_BYTES) return null;
    const impact = percent(savings, buildBytes);
    return {
      id: candidateId("image", file.path),
      category: "image",
      priority: priorityForImpact(impact),
      buildPath: file.path,
      sourcePaths: sourcePathsForBuildPath(file.path, sources),
      bundleName: file.bundleName,
      extension: file.extension,
      currentBytes: file.bytes,
      estimatedAfterBytesMin: webp.byteLength,
      estimatedAfterBytesMax: webp.byteLength,
      estimatedSavingsBytesMin: savings,
      estimatedSavingsBytesMax: savings,
      savingsPercentMin: percent(savings, file.bytes),
      savingsPercentMax: percent(savings, file.bytes),
      percentOfBuildBytes: percent(file.bytes, buildBytes),
      totalBuildImpactPercentMin: impact,
      totalBuildImpactPercentMax: impact,
      estimateKind: "measured",
      confidence: "high",
      title: `测试 WebP ${TARGET_IMAGE_QUALITY} 可减少 ${percent(savings, file.bytes).toFixed(2)}%`,
      rationale: "已在内存中实际编码为 WebP 并记录输出尺寸；没有修改构建目录中的原文件。",
      nextAction: `在真实游戏中试玩 WebP ${TARGET_IMAGE_QUALITY}，重点检查透明边缘、渐变、烟雾、发光与小字清晰度。`,
      metadata: {
        sourceFormat: metadata.format ?? file.extension.slice(1),
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        hasAlpha: metadata.hasAlpha ?? null,
        targetFormat: "webp",
        targetQuality: TARGET_IMAGE_QUALITY,
      },
    };
  } catch {
    return null;
  }
}

export function estimateAudioTargetBytes(durationSeconds: number, bitrateKbps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0) return 0;
  return Math.ceil(durationSeconds * bitrateKbps * 1000 / 8);
}

async function estimateAudioCandidate(
  file: BuildCandidateFile,
  buildBytes: number,
  sources: ReadonlyMap<string, string[]>,
): Promise<ResourceOptimizationCandidate | null> {
  try {
    const parsed = await parseFile(file.absolutePath, { duration: true });
    const duration = parsed.format.duration ?? null;
    if (duration === null || duration <= 0) return null;
    const central = estimateAudioTargetBytes(duration, TARGET_AUDIO_BITRATE_KBPS);
    const minimum = Math.max(1, Math.floor(central * 0.95));
    const maximum = Math.max(minimum, Math.ceil(central * 1.05));
    const boundedMinimum = Math.min(file.bytes, minimum);
    const boundedMaximum = Math.min(file.bytes, maximum);
    const savingsMin = Math.max(0, file.bytes - boundedMaximum);
    const savingsMax = Math.max(0, file.bytes - boundedMinimum);
    if (savingsMax < MIN_REPORTED_SAVINGS_BYTES) return null;
    const impactMin = percent(savingsMin, buildBytes);
    const impactMax = percent(savingsMax, buildBytes);
    const bitrate = parsed.format.bitrate === undefined
      ? null
      : round(parsed.format.bitrate / 1000, 2);
    return {
      id: candidateId("audio", file.path),
      category: "audio",
      priority: priorityForImpact(impactMax),
      buildPath: file.path,
      sourcePaths: sourcePathsForBuildPath(file.path, sources),
      bundleName: file.bundleName,
      extension: file.extension,
      currentBytes: file.bytes,
      estimatedAfterBytesMin: boundedMinimum,
      estimatedAfterBytesMax: boundedMaximum,
      estimatedSavingsBytesMin: savingsMin,
      estimatedSavingsBytesMax: savingsMax,
      savingsPercentMin: percent(savingsMin, file.bytes),
      savingsPercentMax: percent(savingsMax, file.bytes),
      percentOfBuildBytes: percent(file.bytes, buildBytes),
      totalBuildImpactPercentMin: impactMin,
      totalBuildImpactPercentMax: impactMax,
      estimateKind: "parameter-estimate",
      confidence: "medium",
      title: `按 ${TARGET_AUDIO_BITRATE_KBPS} kbps 估算可减少 ${percent(savingsMin, file.bytes).toFixed(2)}%–${percent(savingsMax, file.bytes).toFixed(2)}%`,
      rationale: "根据解析出的音频时长和目标码率计算，并预留约 ±5% 的封装与编码差异。",
      nextAction: `实际转码为 ${TARGET_AUDIO_BITRATE_KBPS} kbps 后试听，确认对白、音乐高频、爆炸与循环衔接没有明显劣化。`,
      metadata: {
        durationSeconds: round(duration, 3),
        currentBitrateKbps: bitrate,
        sampleRateHz: parsed.format.sampleRate ?? null,
        channels: parsed.format.numberOfChannels ?? null,
        codec: parsed.format.codec ?? null,
        targetBitrateKbps: TARGET_AUDIO_BITRATE_KBPS,
      },
    };
  } catch {
    return null;
  }
}

function summarizeCategory(
  category: OptimizationCategory,
  files: readonly BuildCandidateFile[],
  candidates: readonly ResourceOptimizationCandidate[],
  buildBytes: number,
): ResourceOptimizationCategorySummary {
  const currentBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const categoryCandidates = candidates.filter((candidate) => candidate.category === category);
  const savingsMin = categoryCandidates.reduce((sum, candidate) => sum + candidate.estimatedSavingsBytesMin, 0);
  const savingsMax = categoryCandidates.reduce((sum, candidate) => sum + candidate.estimatedSavingsBytesMax, 0);
  return {
    category,
    fileCount: files.length,
    candidateCount: categoryCandidates.length,
    currentBytes,
    estimatedAfterBytesMin: Math.max(0, currentBytes - savingsMax),
    estimatedAfterBytesMax: Math.max(0, currentBytes - savingsMin),
    estimatedSavingsBytesMin: savingsMin,
    estimatedSavingsBytesMax: savingsMax,
    savingsPercentMin: percent(savingsMin, currentBytes),
    savingsPercentMax: percent(savingsMax, currentBytes),
    totalBuildImpactPercentMin: percent(savingsMin, buildBytes),
    totalBuildImpactPercentMax: percent(savingsMax, buildBytes),
  };
}

export async function analyzeResourceOptimization(
  buildDirectory: string,
  joint: JointResourceAnalysis,
): Promise<ResourceOptimizationReport> {
  const root = path.resolve(buildDirectory);
  const files: BuildCandidateFile[] = [];
  await walkCandidateFiles(root, root, files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const sources = sourcePathMap(joint.mappings);
  const imageFiles = files.filter((file) => IMAGE_EXTENSIONS.has(file.extension));
  const audioFiles = files.filter((file) => AUDIO_EXTENSIONS.has(file.extension));
  const candidates: ResourceOptimizationCandidate[] = [];

  for (const file of imageFiles) {
    const candidate = await measureImageCandidate(file, joint.buildBytes, sources);
    if (candidate !== null) candidates.push(candidate);
  }
  for (const file of audioFiles) {
    const candidate = await estimateAudioCandidate(file, joint.buildBytes, sources);
    if (candidate !== null) candidates.push(candidate);
  }

  candidates.sort((left, right) => {
    const priorityOrder: Record<OptimizationPriority, number> = { P0: 0, P1: 1, P2: 2 };
    return priorityOrder[left.priority] - priorityOrder[right.priority]
      || right.estimatedSavingsBytesMax - left.estimatedSavingsBytesMax
      || left.buildPath.localeCompare(right.buildPath);
  });

  const categories = [
    summarizeCategory("image", imageFiles, candidates, joint.buildBytes),
    summarizeCategory("audio", audioFiles, candidates, joint.buildBytes),
  ];
  const currentBytes = categories.reduce((sum, category) => sum + category.currentBytes, 0);
  const savingsMin = categories.reduce((sum, category) => sum + category.estimatedSavingsBytesMin, 0);
  const savingsMax = categories.reduce((sum, category) => sum + category.estimatedSavingsBytesMax, 0);
  const warnings: string[] = [];
  if (imageFiles.length > 0 && candidates.filter((candidate) => candidate.category === "image").length === 0) {
    warnings.push("没有发现达到 1 KiB 收益阈值的图片候选，或部分图片无法由当前解码器读取。");
  }
  if (audioFiles.length > 0 && candidates.filter((candidate) => candidate.category === "audio").length === 0) {
    warnings.push("没有发现达到 1 KiB 收益阈值的音频候选，或音频时长信息无法解析。");
  }
  warnings.push("图片尺寸为临时 WebP 80 实测值；音频尺寸为 48 kbps 参数估算，最终结果仍以实际编码和浏览器试玩为准。");

  return {
    imageTarget: { format: "webp", quality: TARGET_IMAGE_QUALITY },
    audioTarget: { format: "mp3", bitrateKbps: TARGET_AUDIO_BITRATE_KBPS },
    imageFileCount: imageFiles.length,
    measuredImageCount: candidates.filter((candidate) => candidate.category === "image").length,
    audioFileCount: audioFiles.length,
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
