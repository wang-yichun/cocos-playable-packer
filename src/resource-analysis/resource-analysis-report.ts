import type { JointResourceAnalysis } from "./joint-resource-analysis.js";
import type {
  OptimizationCategory,
  OptimizationEstimateKind,
  ResourceOptimizationCandidate,
  ResourceOptimizationReport,
} from "./resource-optimization-estimates.js";

export interface CompleteResourceAnalysisReport extends JointResourceAnalysis {
  optimization: ResourceOptimizationReport;
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

function formatRange(minimum: number, maximum: number): string {
  return minimum === maximum
    ? formatBytes(minimum)
    : `${formatBytes(minimum)}–${formatBytes(maximum)}`;
}

function categoryLabel(category: OptimizationCategory | string): string {
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

function estimateLabel(kind: OptimizationEstimateKind): string {
  return kind === "measured" ? "实测" : "参数估算";
}

function impactText(candidate: ResourceOptimizationCandidate): string {
  const minimum = candidate.totalBuildImpactPercentMin.toFixed(2);
  const maximum = candidate.totalBuildImpactPercentMax.toFixed(2);
  return minimum === maximum ? `${minimum}%` : `${minimum}%–${maximum}%`;
}

function renderCandidate(candidate: ResourceOptimizationCandidate): string {
  const source = candidate.sourcePaths.length === 0
    ? "未恢复源路径"
    : candidate.sourcePaths.map((value) => `<code>${escapeHtml(value)}</code>`).join("<br>");
  return `<article class="issue-card priority-${candidate.priority.toLowerCase()}">
    <div class="issue-head">
      <div><span class="priority">${candidate.priority}</span><span class="estimate">${estimateLabel(candidate.estimateKind)}</span></div>
      <strong>${escapeHtml(candidate.title)}</strong>
    </div>
    <dl class="issue-metrics">
      <div><dt>当前大小</dt><dd>${formatBytes(candidate.currentBytes)}</dd></div>
      <div><dt>预计处理后</dt><dd>${formatRange(candidate.estimatedAfterBytesMin, candidate.estimatedAfterBytesMax)}</dd></div>
      <div><dt>自身减少</dt><dd>${candidate.savingsPercentMin.toFixed(2)}%${candidate.savingsPercentMin === candidate.savingsPercentMax ? "" : `–${candidate.savingsPercentMax.toFixed(2)}%`}</dd></div>
      <div><dt>对总构建影响</dt><dd>${impactText(candidate)}</dd></div>
    </dl>
    <p><b>构建路径：</b><code>${escapeHtml(candidate.buildPath)}</code></p>
    <p><b>源资源：</b>${source}</p>
    <p>${escapeHtml(candidate.rationale)}</p>
    <p class="next-action"><b>建议：</b>${escapeHtml(candidate.nextAction)}</p>
  </article>`;
}

function renderBuildComposition(report: CompleteResourceAnalysisReport): string {
  return report.buildExtensions.slice(0, 12).map((item) => `<div class="bar-row">
    <span>${escapeHtml(item.extension)}</span>
    <div class="track"><div class="fill" style="width:${Math.min(100, item.percentOfBuildBytes)}%"></div></div>
    <span>${formatBytes(item.bytes)} · ${item.percentOfBuildBytes.toFixed(2)}%</span>
  </div>`).join("");
}

function renderOptimizationComparison(report: CompleteResourceAnalysisReport): string {
  return report.optimization.categories.map((category) => {
    const current = Math.max(1, category.currentBytes);
    const minimumWidth = category.estimatedAfterBytesMin / current * 100;
    const maximumWidth = category.estimatedAfterBytesMax / current * 100;
    return `<section class="comparison-card">
      <h3>${categoryLabel(category.category)}</h3>
      <div class="comparison-line"><span>当前</span><div class="track"><div class="fill current" style="width:100%"></div></div><span>${formatBytes(category.currentBytes)}</span></div>
      <div class="comparison-line"><span>预计后</span><div class="track"><div class="fill after" style="width:${Math.min(100, maximumWidth)}%"></div></div><span>${formatRange(category.estimatedAfterBytesMin, category.estimatedAfterBytesMax)}</span></div>
      <p>候选 ${category.candidateCount}/${category.fileCount}；预计减少 ${formatRange(category.estimatedSavingsBytesMin, category.estimatedSavingsBytesMax)}，约占总构建 ${category.totalBuildImpactPercentMin.toFixed(2)}%–${category.totalBuildImpactPercentMax.toFixed(2)}%。</p>
    </section>`;
  }).join("");
}

function renderSourceCategories(report: CompleteResourceAnalysisReport): string {
  const categories = report.sourceCategories.filter((item) => item.includedPercentByBytes !== null);
  return categories.map((item) => `<div class="bar-row">
    <span>${escapeHtml(categoryLabel(item.category))}</span>
    <div class="track"><div class="fill included" style="width:${Math.min(100, item.includedPercentByBytes ?? 0)}%"></div></div>
    <span>${(item.includedPercentByBytes ?? 0).toFixed(2)}%</span>
  </div>`).join("");
}

function renderNotInBuild(report: CompleteResourceAnalysisReport): string {
  const items = report.mappings.filter((item) => item.status === "not-in-build").slice(0, 100);
  if (items.length === 0) return "<p>没有发现未进入本次构建的可评估源资源。</p>";
  return `<div class="notice">这些项目不等同于“无用资源”。它们可能属于其他平台、远程 Bundle、测试内容或当前构建配置未包含的功能，删除前必须人工确认。</div>
  <div class="table-wrap"><table><thead><tr><th>源路径</th><th>类型</th><th>源大小</th><th>判断依据</th></tr></thead><tbody>
  ${items.map((item) => `<tr><td><code>${escapeHtml(item.path)}</code></td><td>${escapeHtml(item.extension)}</td><td>${formatBytes(item.bytes)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

export function createResourceAnalysisHtmlReport(report: CompleteResourceAnalysisReport): string {
  const optimizedMinimum = Math.max(0, report.buildBytes - report.optimization.estimatedSavingsBytesMax);
  const optimizedMaximum = Math.max(0, report.buildBytes - report.optimization.estimatedSavingsBytesMin);
  const candidates = report.optimization.candidates.slice(0, 80);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.projectName)} - Cocos 构建资源体检报告</title>
<style>
:root{font-family:Inter,"Segoe UI",sans-serif;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#0b1120;color:#e5e7eb}main{max-width:1180px;margin:auto;padding:36px 22px 72px}h1{font-size:30px;margin:0 0 8px}h2{margin:34px 0 14px;font-size:21px}h3{margin:0 0 12px}p{color:#cbd5e1;line-height:1.6}code{font-family:Consolas,monospace;overflow-wrap:anywhere}.muted{color:#94a3b8}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.stat,.panel,.comparison-card,.issue-card{border:1px solid #334155;border-radius:13px;background:#111827}.stat{padding:16px}.stat span{display:block;color:#94a3b8;font-size:13px}.stat strong{display:block;margin-top:5px;font-size:23px}.panel{padding:20px;margin-top:14px}.bars{display:grid;gap:10px}.bar-row,.comparison-line{display:grid;grid-template-columns:minmax(85px,150px) minmax(160px,1fr) minmax(120px,auto);gap:10px;align-items:center}.track{height:13px;background:#020617;border-radius:999px;overflow:hidden}.fill{height:100%;background:#3b82f6;border-radius:inherit}.fill.current{background:#64748b}.fill.after{background:#22c55e}.fill.included{background:#14b8a6}.comparison-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}.comparison-card{padding:18px}.issue-list{display:grid;gap:14px}.issue-card{padding:18px;border-left-width:5px}.priority-p0{border-left-color:#ef4444}.priority-p1{border-left-color:#f59e0b}.priority-p2{border-left-color:#3b82f6}.issue-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.priority,.estimate{display:inline-block;padding:3px 8px;margin-right:6px;border-radius:999px;background:#1e293b;font-size:12px}.estimate{background:#164e63}.issue-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}.issue-metrics div{padding:10px;background:#0f172a;border-radius:9px}.issue-metrics dt{color:#94a3b8;font-size:12px}.issue-metrics dd{margin:4px 0 0;font-weight:700}.next-action{padding:11px;border-left:3px solid #22c55e;background:#0f172a}.notice{padding:12px 14px;border-left:3px solid #f59e0b;background:#111827;color:#d1d5db}.table-wrap{overflow:auto;margin-top:12px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px 10px;border-bottom:1px solid #334155;text-align:left;vertical-align:top}th{color:#94a3b8}.footer{margin-top:38px;padding-top:18px;border-top:1px solid #334155;color:#94a3b8;font-size:12px}@media(max-width:700px){.bar-row,.comparison-line{grid-template-columns:85px 1fr}.bar-row>span:last-child,.comparison-line>span:last-child{grid-column:2}.issue-head{display:block}.issue-head strong{display:block;margin-top:10px}}
</style>
</head>
<body><main>
<h1>Cocos 构建资源体检报告</h1>
<p>${escapeHtml(report.projectName)} · 生成时间 ${escapeHtml(report.generatedAt)}</p>
<div class="grid">
  <div class="stat"><span>构建文件</span><strong>${report.buildFileCount}</strong></div>
  <div class="stat"><span>当前构建大小</span><strong>${formatBytes(report.buildBytes)}</strong></div>
  <div class="stat"><span>预计优化后</span><strong>${formatRange(optimizedMinimum, optimizedMaximum)}</strong></div>
  <div class="stat"><span>预计总构建减少</span><strong>${report.optimization.totalBuildSavingsPercentMin.toFixed(2)}%–${report.optimization.totalBuildSavingsPercentMax.toFixed(2)}%</strong></div>
  <div class="stat"><span>确认进入构建</span><strong>${report.includedCount}</strong></div>
  <div class="stat"><span>未在本次构建中发现</span><strong>${report.notInBuildCount}</strong></div>
</div>
<h2>构建资源体积构成</h2><div class="panel bars">${renderBuildComposition(report)}</div>
<h2>图片与音频优化前后对比</h2><div class="comparison-grid">${renderOptimizationComparison(report)}</div>
<p class="muted">图片采用 WebP ${report.optimization.imageTarget.quality} 临时转码实测；音频采用 ${report.optimization.audioTarget.bitrateKbps} kbps 参数估算。报告不会自动修改或选择打包配置。</p>
<h2>问题与优化候选</h2>
<div class="issue-list">${candidates.length === 0 ? "<div class=\"panel\">未发现达到报告阈值的图片或音频候选。</div>" : candidates.map(renderCandidate).join("")}</div>
<h2>源资源进入构建比例</h2><div class="panel bars">${renderSourceCategories(report)}</div>
<h2>未在本次构建中发现的源资源</h2>${renderNotInBuild(report)}
${report.optimization.warnings.map((warning) => `<div class="notice">${escapeHtml(warning)}</div>`).join("")}
<div class="footer">Cocos Playable Packer · 该报告用于定位与评估，不会自动删除资源或修改 Cocos 工程。</div>
</main></body></html>`;
}
