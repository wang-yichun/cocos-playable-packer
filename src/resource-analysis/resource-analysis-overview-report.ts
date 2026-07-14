import type {
  BuildExtensionSummary,
  SourceCategorySummary,
} from "./joint-resource-analysis.js";
import {
  createFinalResourceAnalysisHtmlReport,
  type FinalResourceAnalysisReport,
} from "./resource-analysis-final-report.js";

interface OverviewReportData {
  buildBytes: number;
  buildExtensions: BuildExtensionSummary[];
  sourceCategories: SourceCategorySummary[];
}

interface PieSlice {
  name: string;
  bytes: number;
  percent: number;
}

const PIE_COLORS = [
  "#2563eb",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
  "#64748b",
];

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

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    image: "图片",
    audio: "音频",
    code: "脚本",
    font: "字体",
    model: "模型",
    cocos: "Cocos 资源",
    other: "其他",
    "editor-config": "编辑器配置",
  };
  return labels[category] ?? category;
}

function pieSlices(
  extensions: readonly BuildExtensionSummary[],
  totalBytes: number,
): PieSlice[] {
  const primary = extensions.slice(0, 7).map((item) => ({
    name: item.extension,
    bytes: item.bytes,
    percent: totalBytes > 0 ? item.bytes / totalBytes * 100 : 0,
  }));
  const remainingBytes = extensions.slice(7).reduce((sum, item) => sum + item.bytes, 0);
  if (remainingBytes > 0) {
    primary.push({
      name: "其他",
      bytes: remainingBytes,
      percent: totalBytes > 0 ? remainingBytes / totalBytes * 100 : 0,
    });
  }
  return primary;
}

function polarPoint(angleDegrees: number, radius = 82): { x: number; y: number } {
  const radians = (angleDegrees - 90) * Math.PI / 180;
  return {
    x: 100 + radius * Math.cos(radians),
    y: 100 + radius * Math.sin(radians),
  };
}

function piePath(startAngle: number, endAngle: number): string {
  const start = polarPoint(startAngle);
  const end = polarPoint(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M 100 100 L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A 82 82 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

function renderPie(report: OverviewReportData): string {
  const slices = pieSlices(report.buildExtensions, report.buildBytes);
  let angle = 0;
  const paths = slices.map((slice, index) => {
    const sweep = report.buildBytes > 0 ? slice.bytes / report.buildBytes * 360 : 0;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    if (sweep >= 359.999) {
      return `<circle cx="100" cy="100" r="82" fill="${PIE_COLORS[index % PIE_COLORS.length]}"><title>${escapeHtml(slice.name)} · ${slice.percent.toFixed(2)}%</title></circle>`;
    }
    return `<path d="${piePath(start, end)}" fill="${PIE_COLORS[index % PIE_COLORS.length]}" stroke="#0f172a" stroke-width="1.5"><title>${escapeHtml(slice.name)} · ${slice.percent.toFixed(2)}%</title></path>`;
  }).join("");
  const legend = slices.map((slice, index) => `<div class="overview-pie-legend-row">
    <span class="overview-pie-swatch" style="background:${PIE_COLORS[index % PIE_COLORS.length]}"></span>
    <span class="overview-pie-name">${escapeHtml(slice.name)}</span>
    <strong>${formatBytes(slice.bytes)} · ${slice.percent.toFixed(2)}%</strong>
  </div>`).join("");
  return `<div class="overview-pie-layout">
    <svg class="overview-pie-svg" viewBox="0 0 200 200" role="img" aria-label="构建资源体积构成饼图">${paths}<circle cx="100" cy="100" r="39" fill="#111827"></circle><text x="100" y="94" text-anchor="middle" class="overview-pie-total-label">Web Mobile</text><text x="100" y="113" text-anchor="middle" class="overview-pie-total-value">${escapeHtml(formatBytes(report.buildBytes))}</text></svg>
    <div class="overview-pie-legend">${legend}</div>
  </div>`;
}

function renderSourceRatios(report: OverviewReportData): string {
  const categories = report.sourceCategories.filter((item) => item.includedPercentByBytes !== null);
  if (categories.length === 0) {
    return `<div class="notice">基础分析没有工程清单，无法计算源资源进入构建比例。</div>`;
  }
  return `<div class="bars">${categories.map((item) => {
    const percent = Math.max(0, Math.min(100, item.includedPercentByBytes ?? 0));
    return `<div class="bar-row">
      <span>${escapeHtml(categoryLabel(item.category))}</span>
      <div class="track"><div class="fill included" style="width:${percent}%"></div></div>
      <span>${percent.toFixed(2)}%</span>
    </div>`;
  }).join("")}</div>`;
}

export function renderOverviewResourceInsights(report: OverviewReportData): string {
  return `<h2>构建与源资源概况</h2>
  <div class="overview-insights-grid">
    <article class="overview-insight-card">
      <h3>构建资源体积构成</h3>
      <p class="muted">主要扩展名以扇形占比展示，较小项目合并为“其他”。</p>
      ${renderPie(report)}
    </article>
    <article class="overview-insight-card">
      <h3>源资源进入构建比例</h3>
      <p class="muted">按可评估源资源的文件体积统计；脚本等合并产物不参与该比例。</p>
      ${renderSourceRatios(report)}
    </article>
  </div>`;
}

function insertOverviewStyles(html: string): string {
  const marker = "</style>";
  const index = html.indexOf(marker);
  if (index < 0) throw new Error("资源体检概况报告缺少样式插入点。");
  const styles = `.overview-insights-grid{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(0,.82fr);gap:16px;margin-top:14px}.overview-insight-card{min-width:0;padding:20px;border:1px solid #334155;border-radius:13px;background:#111827}.overview-insight-card h3{margin:0 0 6px}.overview-pie-layout{display:grid;grid-template-columns:minmax(220px,280px) minmax(230px,1fr);gap:20px;align-items:center;margin-top:12px}.overview-pie-svg{display:block;width:100%;max-width:280px;height:auto;margin:auto}.overview-pie-total-label{fill:#94a3b8;font-size:9px}.overview-pie-total-value{fill:#e5e7eb;font-size:10px;font-weight:700}.overview-pie-legend{display:grid;gap:8px}.overview-pie-legend-row{display:grid;grid-template-columns:12px minmax(54px,1fr) auto;gap:8px;align-items:center;font-size:13px}.overview-pie-swatch{width:10px;height:10px;border-radius:3px}.overview-pie-name{color:#cbd5e1}.overview-pie-legend-row strong{font-size:12px;text-align:right}@media(max-width:920px){.overview-insights-grid{grid-template-columns:1fr}.overview-pie-layout{grid-template-columns:minmax(210px,280px) minmax(220px,1fr)}}@media(max-width:620px){.overview-pie-layout{grid-template-columns:1fr}.overview-pie-legend-row{grid-template-columns:12px minmax(45px,1fr) auto}}`;
  return `${html.slice(0, index)}${styles}${html.slice(index)}`;
}

export function createOverviewResourceAnalysisHtmlReport(
  report: FinalResourceAnalysisReport,
): string {
  let html = insertOverviewStyles(createFinalResourceAnalysisHtmlReport(report));
  const overviewMarker = '<section class="report-tab-panel" data-report-panel="overview">';
  const attentionMarker = '<section class="report-tab-panel" data-report-panel="attention" hidden>';
  const overviewStart = html.indexOf(overviewMarker);
  const overviewEnd = html.indexOf(attentionMarker, overviewStart);
  if (overviewStart < 0 || overviewEnd < 0) {
    throw new Error("资源体检概况报告缺少分页插入点。");
  }
  const bodyStart = overviewStart + overviewMarker.length;
  const currentOverview = html.slice(bodyStart, overviewEnd);
  const optimizationStart = currentOverview.indexOf("<h2>图片与音频优化前后对比</h2>");
  const sourceStart = currentOverview.indexOf("<h2>源资源进入构建比例</h2>");
  if (optimizationStart < 0 || sourceStart < 0 || sourceStart <= optimizationStart) {
    throw new Error("资源体检概况报告缺少内容拆分点。");
  }
  const preserved = currentOverview.slice(optimizationStart, sourceStart);
  html = `${html.slice(0, bodyStart)}${renderOverviewResourceInsights(report)}${preserved}${html.slice(overviewEnd)}`;
  return html;
}
