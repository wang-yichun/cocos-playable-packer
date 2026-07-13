import type { ManualAttentionCategory, ManualAttentionReport } from "./manual-attention-analysis.js";
import type { PayloadEncodingBenchmark, PayloadEncodingName } from "./payload-encoding-benchmark.js";
import {
  createRedundancyResourceAnalysisHtmlReport,
  type ExtendedResourceAnalysisReport,
} from "./resource-analysis-redundancy-report.js";

export interface FinalResourceAnalysisReport extends ExtendedResourceAnalysisReport {
  payloadEncoding: PayloadEncodingBenchmark;
  manualAttention: ManualAttentionReport;
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

function encodingLabel(encoding: PayloadEncodingName): string {
  if (encoding === "base64") return "Base64";
  if (encoding === "base91") return "Base91";
  return "HTML7";
}

function attentionCategoryLabel(category: ManualAttentionCategory): string {
  if (category === "large-scene") return "大型场景";
  if (category === "large-model") return "大型模型";
  if (category === "large-prefab") return "大型 Prefab";
  if (category === "large-font") return "大型字体";
  if (category === "oversized-image") return "超大像素图片";
  return "长音频";
}

export function renderPayloadEncodingSummary(report: PayloadEncodingBenchmark): string {
  if (report.status !== "measured") {
    return `<h2>Playable Payload 编码体积</h2><div class="panel">${report.warnings.map(escapeHtml).join("<br>")}</div>`;
  }
  const byEncoding = new Map(report.encodings.map((item) => [item.encoding, item]));
  const finalHtmlCard = (encoding: PayloadEncodingName): string => {
    const item = byEncoding.get(encoding);
    if (item === undefined) return "";
    return `<div class="stat"><span>最终单 HTML（${encodingLabel(encoding)}）</span><strong>${formatBytes(item.htmlBytes)}（${item.htmlPercentOfBuildBytes.toFixed(2)}%）</strong></div>`;
  };
  const rows = report.encodings.map((item) => `<tr>
    <td><b>${encodingLabel(item.encoding)}</b></td>
    <td>${formatBytes(item.payloadBytes)}</td>
    <td>${item.encoding === "base64" ? "基准" : `${formatBytes(item.savingsVsBase64Bytes)} · ${item.savingsVsBase64Percent.toFixed(2)}%`}</td>
  </tr>`).join("");
  return `<h2>Playable Payload 编码体积</h2>
  <div class="grid">
    <div class="stat"><span>归档原始字节</span><strong>${formatBytes(report.archiveRawBytes ?? 0)}</strong></div>
    <div class="stat"><span>Brotli Q11 二进制</span><strong>${formatBytes(report.brotliBytes ?? 0)}</strong></div>
    <div class="stat"><span>Brotli 压缩率</span><strong>${(report.brotliCompressionPercent ?? 0).toFixed(2)}%</strong></div>
    ${finalHtmlCard("base64")}
    ${finalHtmlCard("base91")}
    ${finalHtmlCard("html7")}
  </div>
  <div class="table-wrap"><table><thead><tr><th>编码</th><th>编码 Payload</th><th>相对 Base64 最终 HTML 减少</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${report.warnings.map((warning) => `<div class="notice">${escapeHtml(warning)}</div>`).join("")}`;
}

function renderManualAttention(report: ManualAttentionReport): string {
  if (report.itemCount === 0) {
    return `<h2>需人工关注</h2><div class="panel">没有发现达到当前人工复核阈值的项目。该结果不代表项目不存在其他设计或运行问题。</div>`;
  }
  const categoryCards = report.categories.map((category) => `<div class="stat"><span>${escapeHtml(attentionCategoryLabel(category.category))}</span><strong>${category.itemCount}</strong><small>高 ${category.highCount} · 中 ${category.mediumCount}</small></div>`).join("");
  const items = report.items.slice(0, 80).map((item, index) => {
    const pathRows = [
      ...item.sourcePaths.map((value) => `<div><b>源路径：</b><code>${escapeHtml(value)}</code></div>`),
      ...item.buildPaths.map((value) => `<div><b>构建路径：</b><code>${escapeHtml(value)}</code></div>`),
    ].join("");
    const basis = item.sizeBasis === "source" ? "源文件大小" : "构建文件大小";
    return `<details class="attention-item attention-${item.severity}"${index < 5 ? " open" : ""}>
      <summary><b>${item.severity === "high" ? "高" : "中"}</b> · ${escapeHtml(item.title)} · ${basis} ${formatBytes(item.currentBytes)}</summary>
      <div class="attention-paths">${pathRows || "<div>没有可显示的精确路径。</div>"}</div>
      <p>${escapeHtml(item.rationale)}</p>
      <div class="attention-action"><b>建议：</b>${escapeHtml(item.nextAction)}</div>
    </details>`;
  }).join("");
  return `<h2>需人工关注</h2>
  <div class="grid">
    <div class="stat"><span>关注项</span><strong>${report.itemCount}</strong></div>
    <div class="stat"><span>高优先级复核</span><strong>${report.highCount}</strong></div>
    <div class="stat"><span>中优先级复核</span><strong>${report.mediumCount}</strong></div>
    ${categoryCards}
  </div>
  ${report.warnings.map((warning) => `<div class="notice">${escapeHtml(warning)}</div>`).join("")}
  <div class="attention-list">${items}</div>`;
}

function requireIndex(source: string, marker: string, after = 0): number {
  const index = source.indexOf(marker, after);
  if (index < 0) throw new Error(`资源体检分页报告缺少插入点：${marker}`);
  return index;
}

export function createFinalResourceAnalysisHtmlReport(report: FinalResourceAnalysisReport): string {
  let html = createRedundancyResourceAnalysisHtmlReport(report);
  html = html.replace("<h2>问题与优化候选</h2>", `<h2>压缩收益明细</h2>
  <div class="notice">这里展示打包 Pipeline 可自动处理的图片和音频压缩收益，P0/P1/P2 只表示对当前 Web Mobile 体积的影响等级，不表示必须手工修改源资源。真正需要人工排查的异常项单独归入“需人工关注”。</div>`);
  html = html.replace(
    "</style>",
    `.report-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:26px 0 18px;padding:5px;border:1px solid #334155;border-radius:11px;background:#0f172a;width:fit-content}.report-tab{border:0;border-radius:8px;padding:9px 14px;background:transparent;color:#cbd5e1;cursor:pointer;font:inherit}.report-tab.active{background:#2563eb;color:#fff}.report-tab-panel[hidden]{display:none}.attention-list{display:grid;gap:10px;margin-top:14px}.attention-item{border:1px solid #334155;border-left-width:4px;border-radius:10px;background:#111827;padding:12px 14px}.attention-high{border-left-color:#ef4444}.attention-medium{border-left-color:#f59e0b}.attention-item summary{cursor:pointer;color:#e5e7eb}.attention-paths{display:grid;gap:6px;margin-top:12px}.attention-action{margin-top:12px;padding:10px 12px;border-left:3px solid #22c55e;background:#0f172a}</style>`,
  );

  const buildStart = requireIndex(html, "<h2>构建资源体积构成</h2>");
  const compressionStart = requireIndex(html, "<h2>压缩收益明细</h2>", buildStart);
  const sourceStart = requireIndex(html, "<h2>源资源进入构建比例</h2>", compressionStart);
  const duplicateStart = requireIndex(html, "<h2>完全重复的工程资源</h2>", sourceStart);
  const notInBuildStart = requireIndex(html, "<h2>未在本次构建中发现的源资源</h2>", duplicateStart);
  const footerStart = requireIndex(html, '<div class="footer">', notInBuildStart);

  const prefix = html.slice(0, buildStart);
  const overviewPrimary = html.slice(buildStart, compressionStart);
  const compression = html.slice(compressionStart, sourceStart);
  const sourceOverview = html.slice(sourceStart, duplicateStart);
  const duplicates = html.slice(duplicateStart, notInBuildStart);
  const notInBuild = html.slice(notInBuildStart, footerStart);
  const suffix = html.slice(footerStart);

  const tabs = `<nav class="report-tabs" aria-label="资源体检报告分类">
    <button class="report-tab active" type="button" data-report-tab="overview">概况</button>
    <button class="report-tab" type="button" data-report-tab="attention">需人工关注</button>
    <button class="report-tab" type="button" data-report-tab="compression">压缩收益</button>
    <button class="report-tab" type="button" data-report-tab="duplicates">完全重复资源</button>
    <button class="report-tab" type="button" data-report-tab="not-in-build">未进入构建</button>
  </nav>`;
  const script = `<script>
  (function(){
    var buttons=Array.prototype.slice.call(document.querySelectorAll('[data-report-tab]'));
    var panels=Array.prototype.slice.call(document.querySelectorAll('[data-report-panel]'));
    function select(name){
      buttons.forEach(function(button){button.classList.toggle('active',button.getAttribute('data-report-tab')===name);});
      panels.forEach(function(panel){panel.hidden=panel.getAttribute('data-report-panel')!==name;});
    }
    buttons.forEach(function(button){button.addEventListener('click',function(){select(button.getAttribute('data-report-tab'));});});
  })();
  </script>`;

  html = `${prefix}${tabs}
  <section class="report-tab-panel" data-report-panel="overview">${overviewPrimary}${renderPayloadEncodingSummary(report.payloadEncoding)}${sourceOverview}</section>
  <section class="report-tab-panel" data-report-panel="attention" hidden>${renderManualAttention(report.manualAttention)}</section>
  <section class="report-tab-panel" data-report-panel="compression" hidden>${compression}</section>
  <section class="report-tab-panel" data-report-panel="duplicates" hidden>${duplicates}</section>
  <section class="report-tab-panel" data-report-panel="not-in-build" hidden>${notInBuild}</section>
  ${suffix}`;
  return html.replace("</body>", `${script}</body>`);
}
