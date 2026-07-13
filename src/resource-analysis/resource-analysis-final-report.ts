import type { PayloadEncodingBenchmark, PayloadEncodingName } from "./payload-encoding-benchmark.js";
import {
  createRedundancyResourceAnalysisHtmlReport,
  type ExtendedResourceAnalysisReport,
} from "./resource-analysis-redundancy-report.js";

export interface FinalResourceAnalysisReport extends ExtendedResourceAnalysisReport {
  payloadEncoding: PayloadEncodingBenchmark;
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

function renderPayloadEncoding(report: PayloadEncodingBenchmark): string {
  if (report.status !== "measured") {
    return `<h2>Playable Payload 编码体积</h2><div class="panel">${report.warnings.map(escapeHtml).join("<br>")}</div>`;
  }
  const rows = report.encodings.map((item) => `<tr>
    <td><b>${encodingLabel(item.encoding)}</b></td>
    <td>${formatBytes(item.payloadBytes)}</td>
    <td>${formatBytes(item.htmlBytes)}</td>
    <td>${item.htmlPercentOfBuildBytes.toFixed(2)}%</td>
    <td>${item.encoding === "base64" ? "基准" : `${formatBytes(item.savingsVsBase64Bytes)} · ${item.savingsVsBase64Percent.toFixed(2)}%`}</td>
  </tr>`).join("");
  return `<h2>Playable Payload 编码体积</h2>
  <div class="grid">
    <div class="stat"><span>归档原始字节</span><strong>${formatBytes(report.archiveRawBytes ?? 0)}</strong></div>
    <div class="stat"><span>Brotli Q11 二进制</span><strong>${formatBytes(report.brotliBytes ?? 0)}</strong></div>
    <div class="stat"><span>Brotli 压缩率</span><strong>${(report.brotliCompressionPercent ?? 0).toFixed(2)}%</strong></div>
  </div>
  <div class="table-wrap"><table><thead><tr><th>编码</th><th>编码 Payload</th><th>最终单 HTML</th><th>占当前 Web Mobile</th><th>相对 Base64 减少</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${report.warnings.map((warning) => `<div class="notice">${escapeHtml(warning)}</div>`).join("")}`;
}

function requireIndex(source: string, marker: string, after = 0): number {
  const index = source.indexOf(marker, after);
  if (index < 0) throw new Error(`资源体检分页报告缺少插入点：${marker}`);
  return index;
}

export function createFinalResourceAnalysisHtmlReport(report: FinalResourceAnalysisReport): string {
  let html = createRedundancyResourceAnalysisHtmlReport(report);
  html = html.replace("<h2>问题与优化候选</h2>", `<h2>压缩收益明细</h2>
  <div class="notice">这里展示打包 Pipeline 可自动处理的图片和音频压缩收益，P0/P1/P2 只表示对当前 Web Mobile 体积的影响等级，不表示必须手工修改源资源。真正需要人工排查的异常项会单独归入“需人工关注”。</div>`);
  html = html.replace(
    "</style>",
    `.report-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:26px 0 18px;padding:5px;border:1px solid #334155;border-radius:11px;background:#0f172a;width:fit-content}.report-tab{border:0;border-radius:8px;padding:9px 14px;background:transparent;color:#cbd5e1;cursor:pointer;font:inherit}.report-tab.active{background:#2563eb;color:#fff}.report-tab-panel[hidden]{display:none}</style>`,
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
  <section class="report-tab-panel" data-report-panel="overview">${overviewPrimary}${renderPayloadEncoding(report.payloadEncoding)}${sourceOverview}</section>
  <section class="report-tab-panel" data-report-panel="compression" hidden>${compression}</section>
  <section class="report-tab-panel" data-report-panel="duplicates" hidden>${duplicates}</section>
  <section class="report-tab-panel" data-report-panel="not-in-build" hidden>${notInBuild}</section>
  ${suffix}`;
  return html.replace("</body>", `${script}</body>`);
}
