import { addDevicePreviewSimulator } from "./device-preview-ui.js";
import { createBuildFilesResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-build-files-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`资源体检概况 UI 缺少插入点：${search.slice(0, 100)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createOverviewResourceAnalysisWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  let html = createBuildFilesResourceAnalysisWebMvpIndexHtml(versionInfo);

  html = replaceOnce(
    html,
    "  </style>",
    `    .analysis-overview-columns { display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(0, .82fr); gap: 16px; margin-top: 14px; }
    .analysis-overview-card { min-width: 0; padding: 18px; border: 1px solid #374151; border-radius: 11px; background: #111827; }
    .analysis-overview-card h4 { margin: 0 0 6px; }
    .analysis-pie-layout { display: grid; grid-template-columns: minmax(210px, 270px) minmax(220px, 1fr); gap: 18px; align-items: center; margin-top: 12px; }
    .analysis-pie-svg { display: block; width: 100%; max-width: 270px; height: auto; margin: auto; }
    .analysis-pie-total-label { fill: #9ca3af; font-size: 9px; }
    .analysis-pie-total-value { fill: #e5e7eb; font-size: 10px; font-weight: 700; }
    .analysis-pie-legend { display: grid; gap: 8px; }
    .analysis-pie-legend-row { display: grid; grid-template-columns: 12px minmax(50px, 1fr) auto; gap: 8px; align-items: center; font-size: 13px; }
    .analysis-pie-swatch { width: 10px; height: 10px; border-radius: 3px; }
    .analysis-pie-legend-row strong { font-size: 12px; text-align: right; }
    .build-report-dialog { width: min(1040px, calc(100vw - 28px)); max-height: calc(100vh - 36px); overflow: auto; }
    .build-report-dialog h2 { margin-bottom: 4px; }
    .build-report-subtitle { margin: 0 0 18px; color: #9ca3af; }
    .build-report-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .build-report-stat { min-width: 0; padding: 15px; border: 1px solid #374151; border-radius: 10px; background: #111827; }
    .build-report-stat small { color: #9ca3af; }
    .build-report-stat strong { display: block; margin-top: 5px; font-size: 22px; overflow-wrap: anywhere; }
    .build-report-stat span { display: block; margin-top: 4px; color: #cbd5e1; font-size: 12px; line-height: 1.5; }
    .build-report-section { margin-top: 20px; padding-top: 18px; border-top: 1px solid #374151; }
    .build-report-section h3 { margin: 0 0 5px; font-size: 16px; }
    .build-report-section-note { margin: 0 0 12px; color: #9ca3af; font-size: 13px; line-height: 1.55; }
    .build-report-overall { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 22px; align-items: center; }
    .build-report-donut { --remaining: 100%; width: 170px; height: 170px; margin: auto; padding: 18px; border-radius: 50%; background: conic-gradient(#3b82f6 0 var(--remaining), #10b981 var(--remaining) 100%); }
    .build-report-donut-inner { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; flex-direction: column; border-radius: 50%; background: #111827; text-align: center; }
    .build-report-donut-inner small { color: #9ca3af; }
    .build-report-donut-inner strong { margin-top: 4px; font-size: 24px; }
    .build-report-bars { display: grid; gap: 11px; }
    .build-report-bar-row { display: grid; grid-template-columns: minmax(110px, 170px) minmax(150px, 1fr) minmax(120px, auto); gap: 10px; align-items: center; }
    .build-report-bar-label { color: #d1d5db; }
    .build-report-bar-track { height: 13px; overflow: hidden; border-radius: 999px; background: #0f172a; }
    .build-report-bar-fill { height: 100%; border-radius: inherit; background: #3b82f6; }
    .build-report-bar-value { color: #cbd5e1; font-size: 12px; text-align: right; }
    .build-report-table-wrap { overflow: auto; }
    .build-report-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .build-report-table th, .build-report-table td { padding: 9px 10px; border-bottom: 1px solid #374151; text-align: left; vertical-align: top; }
    .build-report-table th { color: #9ca3af; font-weight: 600; }
    .build-report-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .build-report-empty { padding: 13px; border-left: 3px solid #64748b; background: #111827; color: #cbd5e1; }
    .build-report-error { color: #fca5a5; }
    @media (max-width: 920px) { .analysis-overview-columns { grid-template-columns: 1fr; } .analysis-pie-layout { grid-template-columns: minmax(210px, 270px) minmax(220px, 1fr); } .build-report-overall { grid-template-columns: 1fr; } }
    @media (max-width: 700px) { .build-report-bar-row { grid-template-columns: 1fr; gap: 5px; } .build-report-bar-value { text-align: left; } }
    @media (max-width: 620px) { .analysis-pie-layout { grid-template-columns: 1fr; } .analysis-pie-legend-row { grid-template-columns: 12px minmax(45px, 1fr) auto; } }
  </style>`,
  );

  html = replaceOnce(
    html,
    '<a id="reportLink" class="action">下载报告</a>',
    `<button id="viewBuildReportButton" class="secondary" type="button" disabled>查看报告</button>
        <a id="reportLink" class="action">下载 JSON 报告</a>`,
  );

  html = replaceOnce(
    html,
    "  <script>",
    `  <dialog id="buildReportDialog" class="build-report-dialog">
    <h2>Playable 打包报告</h2>
    <p class="build-report-subtitle">只展示本次构建已经实际产生并写入 JSON 的数据，不估算其他模式，也不拆分无法精确归因的 Solid Brotli 资源占比。</p>
    <div id="buildReportContent" class="build-report-empty">正在读取报告……</div>
    <div class="dialog-actions">
      <button id="closeBuildReportButton" class="secondary" type="button">关闭</button>
    </div>
  </dialog>
  <script>`,
  );

  html = replaceOnce(
    html,
    "    const reportLink = document.getElementById('reportLink');",
    `    const reportLink = document.getElementById('reportLink');
    const viewBuildReportButton = document.getElementById('viewBuildReportButton');
    const buildReportDialog = document.getElementById('buildReportDialog');
    const buildReportContent = document.getElementById('buildReportContent');
    const closeBuildReportButton = document.getElementById('closeBuildReportButton');`,
  );

  html = replaceOnce(
    html,
    "    let busy = false;",
    `    let busy = false;
    let completedReportUrl = null;`,
  );

  html = replaceOnce(
    html,
    "        reportLink.href = job.links.report + '?download=1&bundle=1';",
    `        reportLink.href = job.links.report + '?download=1&bundle=1';
        completedReportUrl = job.links.report + '?bundle=1';
        viewBuildReportButton.disabled = false;`,
  );

  html = replaceOnce(
    html,
    "      actionsElement.style.display = 'none';",
    `      actionsElement.style.display = 'none';
      completedReportUrl = null;
      viewBuildReportButton.disabled = true;`,
  );

  html = replaceOnce(
    html,
    "    function renderAnalysisReport(report) {",
    `    function analysisOverviewCategoryLabel(value) {
      if (value === 'image') return '图片';
      if (value === 'audio') return '音频';
      if (value === 'code') return '脚本';
      if (value === 'font') return '字体';
      if (value === 'model') return '模型';
      if (value === 'cocos') return 'Cocos 资源';
      if (value === 'editor-config') return '编辑器配置';
      if (value === 'other') return '其他';
      return value;
    }

    function analysisPiePoint(angle, radius) {
      const radians = (angle - 90) * Math.PI / 180;
      return { x: 100 + radius * Math.cos(radians), y: 100 + radius * Math.sin(radians) };
    }

    function analysisPiePath(startAngle, endAngle) {
      const start = analysisPiePoint(startAngle, 82);
      const end = analysisPiePoint(endAngle, 82);
      const largeArc = endAngle - startAngle > 180 ? 1 : 0;
      return 'M 100 100 L ' + start.x.toFixed(3) + ' ' + start.y.toFixed(3)
        + ' A 82 82 0 ' + largeArc + ' 1 ' + end.x.toFixed(3) + ' ' + end.y.toFixed(3) + ' Z';
    }

    function analysisBuildPieSlices(items, totalBytes) {
      const primary = items.slice(0, 7).map((item) => ({
        name: item.extension,
        bytes: Number(item.bytes) || 0,
        percent: totalBytes > 0 ? (Number(item.bytes) || 0) / totalBytes * 100 : 0,
      }));
      const remainingBytes = items.slice(7).reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
      if (remainingBytes > 0) primary.push({ name: '其他', bytes: remainingBytes, percent: totalBytes > 0 ? remainingBytes / totalBytes * 100 : 0 });
      return primary;
    }

    function renderAnalysisBuildPie(report) {
      const colors = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16', '#64748b'];
      const totalBytes = Number(report.buildBytes) || 0;
      const slices = analysisBuildPieSlices(report.buildExtensions || [], totalBytes);
      let angle = 0;
      const paths = slices.map((slice, index) => {
        const sweep = totalBytes > 0 ? slice.bytes / totalBytes * 360 : 0;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        if (sweep >= 359.999) {
          return '<circle cx="100" cy="100" r="82" fill="' + colors[index % colors.length] + '"><title>'
            + escapeAnalysisHtml(slice.name) + ' · ' + slice.percent.toFixed(2) + '%</title></circle>';
        }
        return '<path d="' + analysisPiePath(start, end) + '" fill="' + colors[index % colors.length]
          + '" stroke="#0f172a" stroke-width="1.5"><title>' + escapeAnalysisHtml(slice.name) + ' · '
          + slice.percent.toFixed(2) + '%</title></path>';
      }).join('');
      const legend = slices.map((slice, index) => '<div class="analysis-pie-legend-row">'
        + '<span class="analysis-pie-swatch" style="background:' + colors[index % colors.length] + '"></span>'
        + '<span>' + escapeAnalysisHtml(slice.name) + '</span><strong>' + formatAnalysisBytes(slice.bytes)
        + ' · ' + slice.percent.toFixed(2) + '%</strong></div>').join('');
      return '<div class="analysis-pie-layout"><svg class="analysis-pie-svg" viewBox="0 0 200 200" role="img" aria-label="构建资源体积构成饼图">'
        + paths + '<circle cx="100" cy="100" r="39" fill="#111827"></circle>'
        + '<text x="100" y="94" text-anchor="middle" class="analysis-pie-total-label">Web Mobile</text>'
        + '<text x="100" y="113" text-anchor="middle" class="analysis-pie-total-value">' + escapeAnalysisHtml(formatAnalysisBytes(totalBytes)) + '</text>'
        + '</svg><div class="analysis-pie-legend">' + legend + '</div></div>';
    }

    function renderAnalysisSourceRatios(report) {
      const categories = (report.sourceCategories || []).filter((item) => item.includedPercentByBytes !== null);
      if (categories.length === 0) return '<div class="analysis-note">基础分析没有工程清单，无法计算源资源进入构建比例。</div>';
      return '<div class="analysis-bars">' + categories.map((item) => {
        const percent = Math.max(0, Math.min(100, Number(item.includedPercentByBytes) || 0));
        return '<div class="analysis-bar-row"><span>' + escapeAnalysisHtml(analysisOverviewCategoryLabel(item.category))
          + '</span><div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:' + percent
          + '%"></div></div><span>' + percent.toFixed(2) + '%</span></div>';
      }).join('') + '</div>';
    }

    function renderOverviewInsights(report) {
      return '<h3>构建与源资源概况</h3><div class="analysis-overview-columns">'
        + '<article class="analysis-overview-card"><h4>构建资源体积构成</h4>'
        + '<div class="analysis-upload-note">主要扩展名以扇形占比展示，较小项目合并为“其他”。</div>'
        + renderAnalysisBuildPie(report) + '</article>'
        + '<article class="analysis-overview-card"><h4>源资源进入构建比例</h4>'
        + '<div class="analysis-upload-note">按可评估源资源的文件体积统计；脚本等合并产物不参与该比例。</div>'
        + renderAnalysisSourceRatios(report) + '</article></div>';
    }

    function renderAnalysisReport(report) {`,
  );

  html = replaceOnce(
    html,
    `        + '<h3>构建资源体积构成</h3>'
        + renderAnalysisBars(buildExtensions, 'extension', 'bytes', 'percentOfBuildBytes')
        + (categories.length === 0 ? '' : '<h3>源资源进入构建比例</h3>' + '<div class="analysis-bars">'
          + categories.map((item) => {
            const percent = Number(item.includedPercentByBytes) || 0;
            return '<div class="analysis-bar-row"><span>' + escapeAnalysisHtml(item.category)
              + '</span><div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:' + percent
              + '%"></div></div><span>' + percent.toFixed(2) + '%</span></div>';
          }).join('') + '</div>')`,
    `        + renderOverviewInsights(report)`,
  );

  html = replaceOnce(
    html,
    "    recommendedPresetButton.addEventListener('click', () => {",
    `    function buildReportEscapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function buildReportObject(value) {
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }

    function buildReportNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    function formatBuildReportBytes(value) {
      const bytes = buildReportNumber(value);
      if (bytes === null) return '—';
      if (Math.abs(bytes) >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MiB';
      if (Math.abs(bytes) >= 1024) return (bytes / 1024).toFixed(1) + ' KiB';
      return Math.round(bytes) + ' B';
    }

    function formatBuildReportPercent(value) {
      const percent = buildReportNumber(value);
      return percent === null ? '—' : percent.toFixed(2) + '%';
    }

    function formatBuildReportDuration(value) {
      const milliseconds = buildReportNumber(value);
      if (milliseconds === null) return '—';
      if (milliseconds >= 1000) return (milliseconds / 1000).toFixed(2) + ' s';
      return milliseconds.toFixed(0) + ' ms';
    }

    function buildReportStat(label, value, detail) {
      return '<article class="build-report-stat"><small>' + buildReportEscapeHtml(label) + '</small><strong>'
        + buildReportEscapeHtml(value) + '</strong>'
        + (detail ? '<span>' + buildReportEscapeHtml(detail) + '</span>' : '') + '</article>';
    }

    function buildReportBar(label, percent, valueText) {
      const width = Math.max(0, Math.min(100, buildReportNumber(percent) || 0));
      return '<div class="build-report-bar-row"><span class="build-report-bar-label">'
        + buildReportEscapeHtml(label) + '</span><div class="build-report-bar-track"><div class="build-report-bar-fill" style="width:'
        + width.toFixed(3) + '%"></div></div><span class="build-report-bar-value">'
        + buildReportEscapeHtml(valueText) + '</span></div>';
    }

    function buildReportOptimizationSection(title, data, detail) {
      const source = buildReportObject(data);
      if (!source) return '';
      const before = buildReportNumber(source.beforeBytes);
      const after = buildReportNumber(source.afterBytes);
      const saved = buildReportNumber(source.savedBytes);
      const savedPercent = buildReportNumber(source.savedPercent);
      if (before === null && after === null && saved === null) return '';
      const remainingPercent = before !== null && before > 0 && after !== null ? after / before * 100 : 0;
      return '<section class="build-report-section"><h3>' + buildReportEscapeHtml(title) + '</h3>'
        + '<p class="build-report-section-note">' + buildReportEscapeHtml(detail) + '</p>'
        + '<div class="build-report-grid">'
        + buildReportStat('优化前', formatBuildReportBytes(before), '')
        + buildReportStat('优化后', formatBuildReportBytes(after), '')
        + buildReportStat('实际减少', formatBuildReportBytes(saved), formatBuildReportPercent(savedPercent))
        + '</div><div class="build-report-bars" style="margin-top:12px">'
        + buildReportBar('优化后保留体积', remainingPercent, formatBuildReportBytes(after) + ' · ' + formatBuildReportPercent(remainingPercent))
        + '</div></section>';
    }

    function buildReportTimingSection(timing) {
      const source = buildReportObject(timing);
      if (!source) return '';
      const labels = {
        copy: '复制构建目录',
        imageOptimization: '图片优化',
        audioOptimization: '音频优化',
        packaging: 'Solid Brotli 打包',
        payloadEncoding: 'Payload 编码',
        brotliFallbackOptimization: 'Brotli 回退优化',
        total: '总耗时',
      };
      const entries = Object.entries(source)
        .map(([key, value]) => ({ key, value: buildReportNumber(value) }))
        .filter((item) => item.value !== null && item.value >= 0);
      if (entries.length === 0) return '';
      const totalEntry = entries.find((item) => item.key === 'total');
      const scale = totalEntry?.value || Math.max(...entries.map((item) => item.value || 0), 1);
      const rows = entries.map((item) => buildReportBar(
        labels[item.key] || item.key,
        scale > 0 ? (item.value || 0) / scale * 100 : 0,
        formatBuildReportDuration(item.value),
      )).join('');
      return '<section class="build-report-section"><h3>构建耗时</h3>'
        + '<p class="build-report-section-note">各阶段均为本次任务实际记录的耗时；条形长度以总耗时为基准。</p>'
        + '<div class="build-report-bars">' + rows + '</div></section>';
    }

    function buildReportDeliveriesSection(report) {
      const deliveries = Array.isArray(report.deliveries)
        ? report.deliveries
        : buildReportObject(report.delivery)
          ? [report.delivery]
          : [];
      if (deliveries.length === 0) return '';
      const rows = deliveries.map((item) => {
        const delivery = buildReportObject(item) || {};
        return '<tr><td>' + buildReportEscapeHtml(delivery.platform || '—') + '</td><td>'
          + buildReportEscapeHtml(delivery.format || '—') + '</td><td>'
          + buildReportEscapeHtml(delivery.fileName || '—') + '</td><td>'
          + buildReportEscapeHtml(formatBuildReportBytes(delivery.bytes)) + '</td><td class="build-report-mono">'
          + buildReportEscapeHtml(delivery.sha256 || '—') + '</td></tr>';
      }).join('');
      return '<section class="build-report-section"><h3>渠道交付产物</h3>'
        + '<p class="build-report-section-note">以下大小和 SHA-256 来自本次渠道包装实际结果。</p>'
        + '<div class="build-report-table-wrap"><table class="build-report-table"><thead><tr>'
        + '<th>渠道</th><th>格式</th><th>文件</th><th>大小</th><th>SHA-256</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
    }

    function renderBuildReport(report) {
      const input = buildReportObject(report.input) || {};
      const output = buildReportObject(report.output) || {};
      const image = buildReportObject(report.imageOptimization);
      const audio = buildReportObject(report.audioOptimization);
      const payload = buildReportObject(report.payloadEncoding);
      const fallback = buildReportObject(report.brotliFallback);
      const bundle = buildReportObject(report.bundle);
      const inputBytes = buildReportNumber(input.totalBytes);
      const outputBytes = buildReportNumber(output.bytes);
      const savedBytes = inputBytes !== null && outputBytes !== null ? inputBytes - outputBytes : null;
      const savedPercent = inputBytes !== null && inputBytes > 0 && savedBytes !== null ? savedBytes / inputBytes * 100 : null;
      const remainingPercent = inputBytes !== null && inputBytes > 0 && outputBytes !== null ? outputBytes / inputBytes * 100 : null;
      const imageMode = image?.mode || '—';
      const audioText = audio?.enabled
        ? String(audio.targetBitrateKbps || '—') + ' kbps'
        : audio ? '未启用' : '—';
      const payloadMode = payload?.mode || report.processing?.payloadEncoding || '—';
      const fallbackMode = fallback?.mode || 'raw-js';
      const fileCount = buildReportNumber(input.fileCount);
      const completedAt = report.completedAt ? new Date(report.completedAt).toLocaleString() : '—';
      const overallAvailable = inputBytes !== null && outputBytes !== null;
      const overall = overallAvailable
        ? '<section class="build-report-section"><h3>整体压缩结果</h3>'
          + '<p class="build-report-section-note">输入目录总大小与最终基础 HTML 大小直接对比；不包含无法精确拆分的分类归因。</p>'
          + '<div class="build-report-overall"><div class="build-report-donut" style="--remaining:'
          + Math.max(0, Math.min(100, remainingPercent || 0)).toFixed(3) + '%"><div class="build-report-donut-inner">'
          + '<small>实际减少</small><strong>' + buildReportEscapeHtml(formatBuildReportPercent(savedPercent)) + '</strong></div></div>'
          + '<div class="build-report-bars">'
          + buildReportBar('输入 Web Mobile', 100, formatBuildReportBytes(inputBytes))
          + buildReportBar('最终基础 HTML', remainingPercent, formatBuildReportBytes(outputBytes) + ' · ' + formatBuildReportPercent(remainingPercent))
          + buildReportBar('实际减少', savedPercent, formatBuildReportBytes(savedBytes) + ' · ' + formatBuildReportPercent(savedPercent))
          + '</div></div></section>'
        : '<section class="build-report-section"><div class="build-report-empty">当前构建报告没有输入目录总大小，因此不显示整体压缩比。</div></section>';
      const payloadSection = payload
        ? '<section class="build-report-section"><h3>Payload 编码</h3>'
          + '<p class="build-report-section-note">只展示当前选择的编码模式相对本次 Base64 基线的实际结果。</p>'
          + '<div class="build-report-grid">'
          + buildReportStat('编码模式', String(payload.mode || '—'), '')
          + buildReportStat('Base64 基线', formatBuildReportBytes(payload.base64HtmlBytes), '')
          + buildReportStat('最终 HTML', formatBuildReportBytes(payload.outputHtmlBytes), '')
          + buildReportStat('编码层减少', formatBuildReportBytes(payload.savedBytes), formatBuildReportPercent(payload.savedPercent))
          + '</div></section>'
        : '';
      const deliveryBundleCard = bundle
        ? buildReportStat('渠道合集 ZIP', formatBuildReportBytes(bundle.bytes), String(bundle.fileName || ''))
        : '';
      buildReportContent.className = '';
      buildReportContent.innerHTML = '<div class="build-report-grid">'
        + buildReportStat('输入目录', formatBuildReportBytes(inputBytes), fileCount === null ? '' : Math.round(fileCount) + ' 个文件')
        + buildReportStat('最终基础 HTML', formatBuildReportBytes(outputBytes), String(output.sha256 || ''))
        + buildReportStat('整体减少', formatBuildReportBytes(savedBytes), formatBuildReportPercent(savedPercent))
        + buildReportStat('图片模式', String(imageMode), image ? formatBuildReportPercent(image.savedPercent) + ' 减少' : '')
        + buildReportStat('音频压缩', audioText, audio ? formatBuildReportPercent(audio.savedPercent) + ' 减少' : '')
        + buildReportStat('Payload / Brotli', String(payloadMode) + ' / ' + String(fallbackMode), '')
        + deliveryBundleCard
        + buildReportStat('完成时间', completedAt, '')
        + '</div>'
        + overall
        + buildReportOptimizationSection('图片优化', image, '图片压缩模式与优化前后体积均来自本次构建报告。')
        + buildReportOptimizationSection('音频优化', audio, audio?.enabled ? '目标码率：' + audioText + '；声道保持不变。' : '本次未启用音频压缩，前后体积应保持一致。')
        + payloadSection
        + buildReportTimingSection(report.timingMs)
        + buildReportDeliveriesSection(report);
    }

    async function openBuildReport() {
      if (!completedReportUrl) return;
      buildReportContent.className = 'build-report-empty';
      buildReportContent.textContent = '正在读取报告……';
      buildReportDialog.showModal();
      try {
        const response = await fetch(completedReportUrl, { cache: 'no-store' });
        const report = await response.json();
        if (!response.ok) {
          throw new Error(report?.error?.message || ('读取报告失败：' + response.status));
        }
        renderBuildReport(report);
      } catch (error) {
        buildReportContent.className = 'build-report-empty build-report-error';
        buildReportContent.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    viewBuildReportButton.addEventListener('click', () => void openBuildReport());
    closeBuildReportButton.addEventListener('click', () => buildReportDialog.close());
    buildReportDialog.addEventListener('click', (event) => {
      if (event.target === buildReportDialog) buildReportDialog.close();
    });

    recommendedPresetButton.addEventListener('click', () => {`,
  );

  return addDevicePreviewSimulator(html);
}
