import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { JointResourceAnalysis, SourceBuildMapping } from "./joint-resource-analysis.js";
import type {
  ResourceOptimizationCandidate,
  ResourceOptimizationReport,
} from "./resource-optimization-estimates.js";

export type ManualAttentionSeverity = "high" | "medium";
export type ManualAttentionCategory =
  | "large-scene"
  | "large-model"
  | "large-prefab"
  | "large-font"
  | "oversized-image"
  | "long-audio"
  | "large-build-script"
  | "large-build-json"
  | "large-build-binary"
  | "large-build-wasm"
  | "large-build-font";

export interface ManualAttentionItem {
  id: string;
  severity: ManualAttentionSeverity;
  category: ManualAttentionCategory;
  title: string;
  sizeBasis: "source" | "build";
  currentBytes: number;
  sourcePaths: string[];
  buildPaths: string[];
  rationale: string;
  nextAction: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface ManualAttentionCategorySummary {
  category: ManualAttentionCategory;
  itemCount: number;
  highCount: number;
  mediumCount: number;
}

export interface LargestBuildFile {
  path: string;
  extension: string;
  bytes: number;
  percentOfBuildBytes: number;
  bundleName: string | null;
  sourcePaths: string[];
}

export interface ManualAttentionReport {
  itemCount: number;
  highCount: number;
  mediumCount: number;
  categories: ManualAttentionCategorySummary[];
  largestBuildFiles: LargestBuildFile[];
  items: ManualAttentionItem[];
  warnings: string[];
}

interface BuildFile {
  absolutePath: string;
  path: string;
  extension: string;
  bytes: number;
  bundleName: string | null;
}

const KIB = 1024;
const MIB = 1024 * KIB;
const MODEL_EXTENSIONS = new Set([".fbx", ".gltf", ".glb"]);
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

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

function buildBundleName(relativePath: string): string | null {
  const segments = normalizePath(relativePath).split("/");
  return segments[0] === "assets" && segments.length > 1 ? segments[1] ?? null : null;
}

async function walkBuildFiles(root: string, current: string, output: BuildFile[]): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkBuildFiles(root, absolutePath, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(absolutePath);
    const relativePath = normalizePath(path.relative(root, absolutePath));
    output.push({
      absolutePath,
      path: relativePath,
      extension: path.extname(relativePath).toLowerCase() || "[none]",
      bytes: info.size,
      bundleName: buildBundleName(relativePath),
    });
  }
}

function numericMetadata(
  candidate: ResourceOptimizationCandidate,
  key: string,
): number | null {
  const value = candidate.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceThreshold(mapping: SourceBuildMapping): {
  category: ManualAttentionCategory;
  mediumBytes: number;
  highBytes: number;
  label: string;
  nextAction: string;
} | null {
  if (mapping.extension === ".scene") {
    return {
      category: "large-scene",
      mediumBytes: 1 * MIB,
      highBytes: 3 * MIB,
      label: "场景源文件较大",
      nextAction: "检查场景中是否包含大量可拆分节点、重复序列化数据、内嵌资源或不再使用的对象；修改后必须重新构建并试玩。",
    };
  }
  if (mapping.extension === ".prefab") {
    return {
      category: "large-prefab",
      mediumBytes: 256 * KIB,
      highBytes: 1 * MIB,
      label: "Prefab 源文件较大",
      nextAction: "检查 Prefab 是否承担了过多层级、重复组件数据或可拆分子模块；不要仅按文件大小直接拆分。",
    };
  }
  if (MODEL_EXTENSIONS.has(mapping.extension)) {
    return {
      category: "large-model",
      mediumBytes: 512 * KIB,
      highBytes: 2 * MIB,
      label: "模型源文件较大",
      nextAction: "检查网格顶点、骨骼、动画片段、材质槽和未使用动画是否超出实际需求；以构建后的 bin/cconb 和浏览器表现为准。",
    };
  }
  if (FONT_EXTENSIONS.has(mapping.extension)) {
    return {
      category: "large-font",
      mediumBytes: 512 * KIB,
      highBytes: 2 * MIB,
      label: "字体源文件较大",
      nextAction: "确认字体是否包含远超项目所需的字符集；需要字体子集化时必须覆盖全部动态文本与本地化字符。",
    };
  }
  return null;
}

function sourceItems(
  joint: JointResourceAnalysis,
  buildFileByPath: ReadonlyMap<string, BuildFile>,
): ManualAttentionItem[] {
  const items: ManualAttentionItem[] = [];
  for (const mapping of joint.mappings) {
    if (mapping.status !== "included") continue;
    const threshold = sourceThreshold(mapping);
    if (threshold === null || mapping.bytes < threshold.mediumBytes) continue;
    const severity: ManualAttentionSeverity = mapping.bytes >= threshold.highBytes ? "high" : "medium";
    const mappedFiles = mapping.buildPaths
      .map((buildPath) => buildFileByPath.get(buildPath))
      .filter((file): file is BuildFile => file !== undefined);
    const mappedBuildBytes = mappedFiles.reduce((sum, file) => sum + file.bytes, 0);
    items.push({
      id: `${threshold.category}:${mapping.path}`,
      severity,
      category: threshold.category,
      title: threshold.label,
      sizeBasis: "source",
      currentBytes: mapping.bytes,
      sourcePaths: [mapping.path],
      buildPaths: [...mapping.buildPaths],
      rationale: "该资源的源文件大小达到人工复核阈值。源文件大小不等同于最终 Web Mobile 或单 HTML 中的实际占用。",
      nextAction: threshold.nextAction,
      metadata: {
        extension: mapping.extension,
        sourceBytes: mapping.bytes,
        mappedBuildBytes,
        mappedBuildFileCount: mappedFiles.length,
        mappedBuildPercent: percent(mappedBuildBytes, joint.buildBytes),
        mediumThresholdBytes: threshold.mediumBytes,
        highThresholdBytes: threshold.highBytes,
        evidence: mapping.evidence,
      },
    });
  }
  return items;
}

function buildThreshold(file: BuildFile): {
  category: ManualAttentionCategory;
  mediumBytes: number;
  highBytes: number;
  label: string;
  nextAction: string;
} | null {
  if ([".js", ".mjs", ".cjs"].includes(file.extension)) {
    return {
      category: "large-build-script",
      mediumBytes: 1 * MIB,
      highBytes: 3 * MIB,
      label: "构建脚本文件较大",
      nextAction: "检查是否包含未使用模块、重复运行时、调试代码或可移除功能；修改脚本或构建配置后必须重新构建并完整试玩。",
    };
  }
  if (file.extension === ".json") {
    return {
      category: "large-build-json",
      mediumBytes: 1 * MIB,
      highBytes: 3 * MIB,
      label: "构建 JSON 文件较大",
      nextAction: "确认该文件属于 Bundle 配置、序列化场景还是其他运行时数据，并结合内容来源检查是否存在异常膨胀；不要直接编辑构建产物。",
    };
  }
  if ([".bin", ".cconb"].includes(file.extension)) {
    return {
      category: "large-build-binary",
      mediumBytes: 512 * KIB,
      highBytes: 2 * MIB,
      label: "构建二进制资源较大",
      nextAction: "根据关联源路径检查模型网格、动画、场景序列化或其他二进制内容；以源资源和导入配置为修改入口。",
    };
  }
  if (file.extension === ".wasm") {
    return {
      category: "large-build-wasm",
      mediumBytes: 1 * MIB,
      highBytes: 3 * MIB,
      label: "WASM 模块较大",
      nextAction: "确认模块是否确实需要、是否存在更精简构建或可裁剪功能；物理与解码模块的体积应结合运行兼容性评估。",
    };
  }
  if (FONT_EXTENSIONS.has(file.extension)) {
    return {
      category: "large-build-font",
      mediumBytes: 512 * KIB,
      highBytes: 2 * MIB,
      label: "构建字体文件较大",
      nextAction: "确认字体字符集覆盖范围和本地化需求；字体子集化必须覆盖所有动态文本。",
    };
  }
  return null;
}

function sourcePathsByBuildPath(joint: JointResourceAnalysis): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const mapping of joint.mappings) {
    for (const buildPath of mapping.buildPaths) {
      const values = result.get(buildPath) ?? [];
      if (!values.includes(mapping.path)) values.push(mapping.path);
      result.set(buildPath, values);
    }
  }
  for (const values of result.values()) values.sort();
  return result;
}

function buildItems(
  files: readonly BuildFile[],
  buildBytes: number,
  sourcesByBuildPath: ReadonlyMap<string, string[]>,
): ManualAttentionItem[] {
  const items: ManualAttentionItem[] = [];
  for (const file of files) {
    const threshold = buildThreshold(file);
    if (threshold === null || file.bytes < threshold.mediumBytes) continue;
    const severity: ManualAttentionSeverity = file.bytes >= threshold.highBytes ? "high" : "medium";
    const sourcePaths = [...(sourcesByBuildPath.get(file.path) ?? [])];
    items.push({
      id: `${threshold.category}:${file.path}`,
      severity,
      category: threshold.category,
      title: threshold.label,
      sizeBasis: "build",
      currentBytes: file.bytes,
      sourcePaths,
      buildPaths: [file.path],
      rationale: `该构建文件达到分类复核阈值，占当前 Web Mobile 原始体积 ${percent(file.bytes, buildBytes).toFixed(2)}%。构建文件大小不等于最终 Brotli Payload 或单 HTML 中的独立占用。`,
      nextAction: threshold.nextAction,
      metadata: {
        extension: file.extension,
        bundleName: file.bundleName,
        buildBytes: file.bytes,
        buildPercent: percent(file.bytes, buildBytes),
        associatedSourceCount: sourcePaths.length,
        mediumThresholdBytes: threshold.mediumBytes,
        highThresholdBytes: threshold.highBytes,
      },
    });
  }
  return items;
}

function imageAttentionItem(candidate: ResourceOptimizationCandidate): ManualAttentionItem | null {
  if (candidate.category !== "image") return null;
  const width = numericMetadata(candidate, "width");
  const height = numericMetadata(candidate, "height");
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  const longestSide = Math.max(width, height);
  const pixels = width * height;
  const medium = longestSide >= 2048 || pixels >= 4_194_304;
  if (!medium) return null;
  const severity: ManualAttentionSeverity = longestSide >= 4096 || pixels >= 16_777_216
    ? "high"
    : "medium";
  return {
    id: `oversized-image:${candidate.buildPath}`,
    severity,
    category: "oversized-image",
    title: `图片尺寸需要人工确认：${width} × ${height}`,
    sizeBasis: "build",
    currentBytes: candidate.currentBytes,
    sourcePaths: [...candidate.sourcePaths],
    buildPaths: [candidate.buildPath],
    rationale: "图片已经可以由 Pipeline 自动转码，但像素尺寸是否超过实际显示需求只能结合游戏界面、相机距离、图集和缩放方式判断。",
    nextAction: "确认实际最大显示尺寸、Retina/高 DPI 需求、图集策略与特效用途；尺寸确实过大时应回到源资源缩放，而不是只依赖有损压缩。",
    metadata: {
      width,
      height,
      pixels,
      longestSide,
      hasAlpha: candidate.metadata.hasAlpha ?? null,
    },
  };
}

function audioAttentionItem(candidate: ResourceOptimizationCandidate): ManualAttentionItem | null {
  if (candidate.category !== "audio") return null;
  const durationSeconds = numericMetadata(candidate, "durationSeconds");
  if (durationSeconds === null || durationSeconds < 30) return null;
  const severity: ManualAttentionSeverity = durationSeconds >= 60 ? "high" : "medium";
  return {
    id: `long-audio:${candidate.buildPath}`,
    severity,
    category: "long-audio",
    title: `音频时长需要人工确认：${durationSeconds.toFixed(1)} 秒`,
    sizeBasis: "build",
    currentBytes: candidate.currentBytes,
    sourcePaths: [...candidate.sourcePaths],
    buildPaths: [candidate.buildPath],
    rationale: "长音频即使降低码率仍可能持续占用较多包体，并可能包含可裁剪的静音、循环重复或不适合 Playable 的完整音乐段落。",
    nextAction: "试听并检查首尾静音、循环段、实际播放时长与是否可替换为更短素材；不要仅为减小体积盲目继续降低码率。",
    metadata: {
      durationSeconds,
      currentBitrateKbps: candidate.metadata.currentBitrateKbps ?? null,
      sampleRateHz: candidate.metadata.sampleRateHz ?? null,
      channels: candidate.metadata.channels ?? null,
    },
  };
}

function optimizationItems(optimization: ResourceOptimizationReport): ManualAttentionItem[] {
  const items: ManualAttentionItem[] = [];
  for (const candidate of optimization.candidates) {
    const image = imageAttentionItem(candidate);
    if (image !== null) items.push(image);
    const audio = audioAttentionItem(candidate);
    if (audio !== null) items.push(audio);
  }
  return items;
}

function categorySummaries(items: readonly ManualAttentionItem[]): ManualAttentionCategorySummary[] {
  const categories = new Map<ManualAttentionCategory, ManualAttentionItem[]>();
  for (const item of items) {
    const list = categories.get(item.category) ?? [];
    list.push(item);
    categories.set(item.category, list);
  }
  return [...categories.entries()]
    .map(([category, categoryItems]) => ({
      category,
      itemCount: categoryItems.length,
      highCount: categoryItems.filter((item) => item.severity === "high").length,
      mediumCount: categoryItems.filter((item) => item.severity === "medium").length,
    }))
    .sort((left, right) => right.highCount - left.highCount
      || right.itemCount - left.itemCount
      || left.category.localeCompare(right.category));
}

export async function analyzeManualAttention(
  buildDirectory: string,
  joint: JointResourceAnalysis,
  optimization: ResourceOptimizationReport,
): Promise<ManualAttentionReport> {
  const root = path.resolve(buildDirectory);
  const files: BuildFile[] = [];
  await walkBuildFiles(root, root, files);
  files.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
  const buildFileByPath = new Map(files.map((file) => [file.path, file]));
  const sourcesByBuildPath = sourcePathsByBuildPath(joint);
  const items = [
    ...sourceItems(joint, buildFileByPath),
    ...buildItems(files, joint.buildBytes, sourcesByBuildPath),
    ...optimizationItems(optimization),
  ];
  items.sort((left, right) => {
    const severityOrder: Record<ManualAttentionSeverity, number> = { high: 0, medium: 1 };
    return severityOrder[left.severity] - severityOrder[right.severity]
      || right.currentBytes - left.currentBytes
      || left.id.localeCompare(right.id);
  });
  const largestBuildFiles = files.slice(0, 20).map((file) => ({
    path: file.path,
    extension: file.extension,
    bytes: file.bytes,
    percentOfBuildBytes: percent(file.bytes, joint.buildBytes),
    bundleName: file.bundleName,
    sourcePaths: [...(sourcesByBuildPath.get(file.path) ?? [])],
  }));
  return {
    itemCount: items.length,
    highCount: items.filter((item) => item.severity === "high").length,
    mediumCount: items.filter((item) => item.severity === "medium").length,
    categories: categorySummaries(items),
    largestBuildFiles,
    items,
    warnings: [
      "这些项目达到保守的人工复核阈值，不代表资源一定有错误，也不会被工具自动修改。",
      "场景、Prefab、模型和字体显示的是源文件大小；模型等存在精确构建路径时，同时统计对应 bin/cconb 的实际构建字节。",
      "构建脚本、JSON、二进制、WASM 与字体异常项使用实际 Web Mobile 文件大小；该值仍不等于 Brotli Payload 或单 HTML 中的独立占用。",
    ],
  };
}
