import type { AssetsManifest } from "./assets-manifest.js";
import type { JointResourceAnalysis, SourceBuildStatus } from "./joint-resource-analysis.js";

export type DuplicateSourceClassification =
  | "all-in-build"
  | "mixed"
  | "not-in-build"
  | "not-assessable";

export interface DuplicateSourceItem {
  path: string;
  extension: string;
  bytes: number;
  status: SourceBuildStatus;
  buildPaths: string[];
}

export interface DuplicateSourceGroup {
  sha256: string;
  bytesPerFile: number;
  fileCount: number;
  redundantProjectBytes: number;
  classification: DuplicateSourceClassification;
  includedCount: number;
  notInBuildCount: number;
  notAssessableCount: number;
  items: DuplicateSourceItem[];
}

export interface SourceRedundancyReport {
  duplicateGroupCount: number;
  duplicateFileCount: number;
  redundantProjectBytes: number;
  allInBuildGroupCount: number;
  mixedGroupCount: number;
  notInBuildGroupCount: number;
  notAssessableGroupCount: number;
  groups: DuplicateSourceGroup[];
  warnings: string[];
}

function classificationForStatuses(statuses: readonly SourceBuildStatus[]): DuplicateSourceClassification {
  const included = statuses.filter((status) => status === "included").length;
  const notInBuild = statuses.filter((status) => status === "not-in-build").length;
  const notAssessable = statuses.filter((status) => status === "not-assessable").length;
  if (included === statuses.length) return "all-in-build";
  if (notInBuild === statuses.length) return "not-in-build";
  if (notAssessable === statuses.length) return "not-assessable";
  return "mixed";
}

export function analyzeSourceRedundancy(
  manifest: AssetsManifest,
  joint: JointResourceAnalysis,
): SourceRedundancyReport {
  const mappingByPath = new Map(joint.mappings.map((mapping) => [mapping.path, mapping]));
  const entriesByHash = new Map<string, AssetsManifest["entries"]>();
  for (const entry of manifest.entries) {
    if (entry.bytes <= 0 || entry.sha256.length === 0) continue;
    const current = entriesByHash.get(entry.sha256) ?? [];
    current.push(entry);
    entriesByHash.set(entry.sha256, current);
  }

  const groups: DuplicateSourceGroup[] = [];
  for (const [sha256, entries] of entriesByHash) {
    if (entries.length < 2) continue;
    const items = entries
      .map((entry): DuplicateSourceItem => {
        const mapping = mappingByPath.get(entry.path);
        return {
          path: entry.path,
          extension: entry.extension,
          bytes: entry.bytes,
          status: mapping?.status ?? "not-assessable",
          buildPaths: [...(mapping?.buildPaths ?? [])].sort(),
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path));
    const statuses = items.map((item) => item.status);
    groups.push({
      sha256,
      bytesPerFile: entries[0]?.bytes ?? 0,
      fileCount: items.length,
      redundantProjectBytes: Math.max(0, items.length - 1) * (entries[0]?.bytes ?? 0),
      classification: classificationForStatuses(statuses),
      includedCount: statuses.filter((status) => status === "included").length,
      notInBuildCount: statuses.filter((status) => status === "not-in-build").length,
      notAssessableCount: statuses.filter((status) => status === "not-assessable").length,
      items,
    });
  }
  groups.sort((left, right) =>
    right.redundantProjectBytes - left.redundantProjectBytes
    || right.fileCount - left.fileCount
    || left.items[0]!.path.localeCompare(right.items[0]!.path));

  const countByClassification = (classification: DuplicateSourceClassification): number =>
    groups.filter((group) => group.classification === classification).length;

  return {
    duplicateGroupCount: groups.length,
    duplicateFileCount: groups.reduce((sum, group) => sum + group.fileCount, 0),
    redundantProjectBytes: groups.reduce((sum, group) => sum + group.redundantProjectBytes, 0),
    allInBuildGroupCount: countByClassification("all-in-build"),
    mixedGroupCount: countByClassification("mixed"),
    notInBuildGroupCount: countByClassification("not-in-build"),
    notAssessableGroupCount: countByClassification("not-assessable"),
    groups,
    warnings: [
      "重复资源按 assets 清单中的 SHA-256 精确判定，不使用文件名或近似图片相似度。",
      "redundantProjectBytes 表示工程目录理论可减少的重复字节，不等同于最终构建或单 HTML 可减少的字节。",
      "删除或合并重复资源前必须确认 UUID 引用、动态加载路径和编辑器脚本依赖。",
    ],
  };
}
