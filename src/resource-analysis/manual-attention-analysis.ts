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
  | "long-audio";

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

export interface ManualAttentionReport {
  itemCount: number;
  highCount: number;
  mediumCount: number;
  categories: ManualAttentionCategorySummary[];
  items: ManualAttentionItem[];
  warnings: string[];
}

const KIB = 1024;
const MIB = 1024 * KIB;
const MODEL_EXTENSIONS = new Set([".fbx", ".gltf", ".glb"]);
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

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

function sourceItems(joint: JointResourceAnalysis): ManualAttentionItem[] {
  const items: ManualAttentionItem[] = [];
  for (const mapping of joint.mappings) {
    if (mapping.status !== "included") continue;
    const threshold = sourceThreshold(mapping);
    if (threshold === null || mapping.bytes < threshold.mediumBytes) continue;
    const severity: ManualAttentionSeverity = mapping.bytes >= threshold.highBytes ? "high" : "medium";
    items.push({
      id: `${threshold.category}:${mapping.path}`,
      severity,
      category: threshold.category,
      title: threshold.label,
      sizeBasis: "source",
      currentBytes: mapping.bytes,
      sourcePaths: [mapping.path],
      buildPaths: [...mapping.buildPaths],
      rationale: `该资源的源文件大小达到人工复核阈值。源文件大小不等同于最终 Web Mobile 或单 HTML 中的实际占用。`,
      nextAction: threshold.nextAction,
      metadata: {
        extension: mapping.extension,
        sourceBytes: mapping.bytes,
        mediumThresholdBytes: threshold.mediumBytes,
        highThresholdBytes: threshold.highBytes,
        evidence: mapping.evidence,
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

export function analyzeManualAttention(
  joint: JointResourceAnalysis,
  optimization: ResourceOptimizationReport,
): ManualAttentionReport {
  const items = [...sourceItems(joint), ...optimizationItems(optimization)];
  items.sort((left, right) => {
    const severityOrder: Record<ManualAttentionSeverity, number> = { high: 0, medium: 1 };
    return severityOrder[left.severity] - severityOrder[right.severity]
      || right.currentBytes - left.currentBytes
      || left.id.localeCompare(right.id);
  });
  return {
    itemCount: items.length,
    highCount: items.filter((item) => item.severity === "high").length,
    mediumCount: items.filter((item) => item.severity === "medium").length,
    categories: categorySummaries(items),
    items,
    warnings: [
      "这些项目达到保守的人工复核阈值，不代表资源一定有错误，也不会被工具自动修改。",
      "场景、Prefab、模型和字体显示的是源文件大小；其数值不能直接当作最终 Web Mobile、Brotli Payload 或单 HTML 的可减少字节。",
    ],
  };
}
