import { createClarifiedResourceAnalysisHtmlReport } from "./resource-analysis-clarified-report.js";
import type { CompleteResourceAnalysisReport } from "./resource-analysis-report.js";
import type {
  DuplicateSourceClassification,
  SourceRedundancyReport,
} from "./source-redundancy-analysis.js";

export interface ExtendedResourceAnalysisReport extends CompleteResourceAnalysisReport {
  redundancy: SourceRedundancyReport;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function classificationLabel(classification: DuplicateSourceClassification): string {
  if (classification === "all-in-build") return "全部进入构建";
  if (classification === "mixed") return "部分进入构建";
  if (classification === "not-in-build") return "均未进入本次构建";
  return "无法通过 UUID 判断";
}

function statusLabel(status: string): string {
  if (status === "included") return "已进入构建";
  if (status === "not-in-build") return "未进入本次构建";
  return "无法判断";
}

function renderRedundancy(report: SourceRedundancyReport): string {
  if (report.duplicateGroupCount === 0) {
    return `<h2>完全重复的工程资源</h2><div class="panel">没有发现 SHA-256 完全相同的非空源资源。</div>`;
  }
  const groups = report.groups.slice(0, 50).map((group, index) => `<details class="duplicate-group"${index < 3 ? " open" : ""}>
    <summary><b>${escapeHtml(classificationLabel(group.classification))}</b> · ${group.fileCount} 个文件 · 工程重复 ${formatBytes(group.redundantProjectBytes)}</summary>
    <p class="muted">单文件 ${formatBytes(group.bytesPerFile)}；SHA-256：<code>${escapeHtml(group.sha256)}</code></p>
    <div class="table-wrap"><table><thead><tr><th>源路径</th><th>状态</th><th>构建路径</th></tr></thead><tbody>
      ${group.items.map((item) => `<tr><td><code>${escapeHtml(item.path)}</code></td><td>${escapeHtml(statusLabel(item.status))}</td><td>${item.buildPaths.length === 0 ? "—" : item.buildPaths.map((value) => `<code>${escapeHtml(value)}</code>`).join("<br>")}</td></tr>`).join("")}
    </tbody></table></div>
  </details>`).join("");
  return `<h2>完全重复的工程资源</h2>
  <div class="grid">
    <div class="stat"><span>重复组</span><strong>${report.duplicateGroupCount}</strong></div>
    <div class="stat"><span>涉及文件</span><strong>${report.duplicateFileCount}</strong></div>
    <div class="stat"><span>工程理论重复字节</span><strong>${formatBytes(report.redundantProjectBytes)}</strong></div>
    <div class="stat"><span>全部进入构建的组</span><strong>${report.allInBuildGroupCount}</strong></div>
    <div class="stat"><span>部分进入构建的组</span><strong>${report.mixedGroupCount}</strong></div>
  </div>
  <div class="notice">这里按源文件 SHA-256 精确判定。工程理论重复字节不等同于最终 Web Mobile、Brotli Payload 或单 HTML 可减少的字节。</div>
  <div class="duplicate-groups">${groups}</div>
  ${report.warnings.map((warning) => `<div class="notice">${escapeHtml(warning)}</div>`).join("")}`;
}

export function createRedundancyResourceAnalysisHtmlReport(
  report: ExtendedResourceAnalysisReport,
): string {
  let html = createClarifiedResourceAnalysisHtmlReport(report);
  html = html.replace(
    ".footer{margin-top:38px;",
    ".duplicate-groups{display:grid;gap:10px;margin-top:14px}.duplicate-group{border:1px solid #334155;border-radius:10px;background:#111827;padding:12px 14px}.duplicate-group summary{cursor:pointer;color:#e5e7eb}.footer{margin-top:38px;",
  );
  const anchor = "<h2>未在本次构建中发现的源资源</h2>";
  if (!html.includes(anchor)) throw new Error("资源体检报告缺少重复资源插入点。");
  return html.replace(anchor, `${renderRedundancy(report.redundancy)}\n${anchor}`);
}
