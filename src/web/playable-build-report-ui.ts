import { createGroupedChannelWebMvpIndexHtml } from "./web-config-grouped-channel-ui.js";
import type { WebVersionInfo } from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new Error(`构建报告视图扩展缺少插入点：${search.slice(0, 100)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createPlayableBuildReportWebMvpIndexHtml(
  versionInfo: WebVersionInfo,
): string {
  let html = createGroupedChannelWebMvpIndexHtml(versionInfo);

  html = replaceOnce(
    html,
    "    .error { color: #fca5a5; }",
    `    .report-dialog { width: min(1160px, calc(100vw - 28px)); max-width: none; max-height: calc(100vh - 28px); padding: 0; overflow: hidden; }
    .report-dialog-shell { display: flex; flex-direction: column; max-height: calc(100vh - 30px); }
    .report-dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 22px 24px 18px; border-bottom: 1px solid #374151; background: #111827; }
    .report-dialog-head h2 { margin: 0 0 6px; font-size: 22px; }
    .report-dialog-head p { margin: 0; color: #9ca3af; line-height: 1.5; }
    .report-dialog-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .report-dialog-body { overflow: auto; padding: 22px 24px 28px; background: #0f172a; }
    .report-loading { padding: 42px 18px; border: 1px dashed #4b5563; border-radius: 12px; color: #cbd5e1; text-align: center; }
    .report-error { padding: 16px; border: 1px solid #7f1d1d; border-radius: 10px; background: #450a0a; color: #fecaca; white-space: pre-wrap; }
    .report-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 18px; border: 1px solid #374151; border-radius: 13px; background: #111827; }
    .report-hero h3 { margin: 0 0 8px; font-size: 20px; }
    .report-hero p { margin: 0; color: #9ca3af; }
    .report-status-badge { flex: 0 0 auto; padding: 6px 10px; border-radius: 999px; background: #064e3b; color: #a7f3d0; font-size: 12px; font-weight: 800; }
    .report-kpis { display: grid; grid-template-columns: repeat(5, minmax(135px, 1fr)); gap: 12px; margin-top: 14px; }
    .report-kpi { min-width: 0; padding: 15px; border: 1px solid #374151; border-radius: 11px; background: #111827; }
    .report-kpi span { display: block; color: #9ca3af; font-size: 12px; }
    .report-kpi strong { display: block; margin-top: 7px; color: #f9fafb; font-size: 21px; overflow-wrap: anywhere; }
    .report-kpi small { display: block; margin-top: 5px; color: #94a3b8; line-height: 1.4; }
    .report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
    .report-card { min-width: 0; padding: 18px; border: 1px solid #374151; border-radius: 12px; background: #111827; }
    .report-card-wide { grid-column: 1 / -1; }
    .report-card h3 { margin: 0 0 6px; font-size: 17px; }
    .report-card-note { margin: 0 0 14px; color: #9ca3af; font-size: 12px; line-height: 1.55; }
    .report-donut-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 20px; align-items: center; }
    .report-donut { position: relative; width: 202px; height: 202px; margin: auto; border-radius: 50%; }
    .report-donut::after { content: ''; position: absolute; inset: 42px; border-radius: 50%; background: #111827; box-shadow: 0 0 0 1px #374151; }
    .report-donut-center { position: absolute; inset: 55px; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .report-donut-center span { color: #9ca3af; font-size: 11px; }
    .report-donut-center strong { margin-top: 4px; font-size: 15px; }
    .report-legend { display: grid; gap: 9px; }
    .report-legend-row { display: grid; grid-template-columns: 11px minmax(60px, 1fr) auto; gap: 9px; align-items: center; font-size: 13px; }
    .report-legend-row i { width: 10px; height: 10px; border-radius: 3px; }
    .report-legend-row strong { text-align: right; font-size: 12px; }
    .report-comparisons { display: grid; gap: 14px; }
    .report-comparison { padding-bottom: 13px; border-bottom: 1px solid #273244; }
    .report-comparison:last-child { padding-bottom: 0; border-bottom: 0; }
    .report-comparison-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
    .report-comparison-head span { color: #e5e7eb; font-weight: 700; }
    .report-comparison-head strong { color: #86efac; font-size: 12px; text-align: right; }
    .report-pair { display: grid; grid-template-columns: 46px minmax(0, 1fr) 82px; gap: 8px; align-items: center; margin-top: 6px; font-size: 12px; }
    .report-pair > span:first-child { color: #9ca3af; }
    .report-track { height: 10px; overflow: hidden; border-radius: 999px; background: #1f2937; }
    .report-fill-before, .report-fill-after, .report-timing-fill { height: 100%; border-radius: inherit; }
    .report-fill-before { background: #64748b; }
    .report-fill-after { background: #2563eb; }
    .report-pair > span:last-child { text-align: right; color: #cbd5e1; }
    .report-timings { display: grid; gap: 10px; }
    .report-timing-row { display: grid; grid-template-columns: minmax(105px, .8fr) minmax(0, 2fr) 88px; gap: 9px; align-items: center; font-size: 12px; }
    .report-timing-row > span:last-child { text-align: right; color: #cbd5e1; }
    .report-timing-fill { background: #14b8a6; }
    .report-settings { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 10px; }
    .report-setting { padding: 13px; border-radius: 9px; background: #0f172a; border: 1px solid #273244; }
    .report-setting span { display: block; color: #9ca3af; font-size: 11px; }
    .report-setting strong { display: block; margin-top: 6px; overflow-wrap: anywhere; }
    .report-table-wrap { overflow: auto; }
    .report-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .report-table th, .report-table td { padding: 9px 10px; border-bottom: 1px solid #273244; text-align: left; vertical-align: top; }
    .report-table th { color: #94a3b8; font-weight: 700; }
    .report-table td { color: #d1d5db; }
    .report-warnings { display: grid; gap: 8px; margin-top: 12px; }
    .report-warning-item { padding: 10px 12px; border-left: 3px solid #f59e0b; border-radius: 6px; background: #292014; color: #fde68a; font-size: 12px; line-height: 1.5; }
    .report-meta { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 7px 14px; margin: 0; font-size: 12px; }
    .report-meta dt { color: #9ca3af; }
    .report-meta dd { margin: 0; color: #d1d5db; overflow-wrap: anywhere; }
    .report-empty { padding: 16px; border: 1px dashed #4b5563; border-radius: 9px; color: #9ca3af; text-align: center; }
    @media (max-width: 940px) { .report-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .report-settings { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 720px) { .report-dialog-head { flex-direction: column; } .report-grid { grid-template-columns: 1fr; } .report-card-wide { grid-column: auto; } .report-donut-layout { grid-template-columns: 1fr; } .report-kpis { grid-template-columns: 1fr; } .report-settings { grid-template-columns: 1fr; } .report-timing-row { grid-template-columns: 92px minmax(0, 1fr) 72px; } .report-meta { grid-template-columns: 105px minmax(0, 1fr); } }
    .error { color: #fca5a5; }`,
  );

  html = replaceOnce(
    html,
    '        <a id="reportLink" class="action">下载报告</a>',
    `        <button id="viewReportButton" class="secondary" type="button" disabled>查看报告</button>
        <a id="reportLink" class="action">下载 JSON 报告</a>`,
  );

  html = replaceOnce(
    html,
    "  <script>",
    `  <dialog id="buildReportDialog" class="report-dialog">
    <div class="report-dialog-shell">
      <header class="report-dialog-head">
        <div>
          <h2>Playable 构建报告</h2>
          <p>基于本次构建实际 JSON 数据生成；不包含其他压缩模式的估算值。</p>
        </div>
        <div class="report-dialog-actions">
          <a id="reportDialogDownloadLink" class="action">下载 JSON 报告</a>
          <button id="closeBuildReportButton" class="secondary" type="button">关闭</button>
        </div>
      </header>
      <div id="buildReportContent" class="report-dialog-body">
        <div class="report-loading">尚未载入报告。</div>
      </div>
    </div>
  </dialog>
  <script>`,
  );

  html = replaceOnce(
    html,
    "    const reportLink = document.getElementById('reportLink');",
    `    const reportLink = document.getElementById('reportLink');
    const viewReportButton = document.getElementById('viewReportButton');
    const buildReportDialog = document.getElementById('buildReportDialog');
    const buildReportContent = document.getElementById('buildReportContent');
    const reportDialogDownloadLink = document.getElementById('reportDialogDownloadLink');
    const closeBuildReportButton = document.getElementById('closeBuildReportButton');`,
  );

  html = replaceOnce(
    html,
    "        actionsElement.style.display = 'flex';",
    `        actionsElement.style.display = 'flex';
        viewReportButton.disabled = false;`,
  );

  html = replaceOnce(
    html,
    "      actionsElement.style.display = 'none';",
    `      actionsElement.style.display = 'none';
      viewReportButton.disabled = true;
      if (buildReportDialog.open) buildReportDialog.close();`,
  );

  html = replaceOnce(
    html,
    "    recommendedPresetButton.addEventListener('click', () => {",
    `    function reportObject(value) {
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function reportNumber(value, fallback = 0) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }

    function reportOptionalNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    function escapeReportHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatReportBytes(value) {
      const bytes = Math.max(0, reportNumber(value));
      if (bytes < 1024) return Math.round(bytes) + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
      return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }

    function formatReportDuration(value) {
      const milliseconds = Math.max(0, reportNumber(value));
      if (milliseconds < 1000) return milliseconds.toFixed(0) + ' ms';
      if (milliseconds < 60 * 1000) return (milliseconds / 1000).toFixed(2) + ' s';
      return (milliseconds / 60000).toFixed(2) + ' min';
    }

    function formatReportPercent(value) {
      const number = reportNumber(value);
      const prefix = number > 0 ? '+' : '';
      return prefix + number.toFixed(2) + '%';
    }

    function reportPercent(savedBytes, beforeBytes) {
      return beforeBytes > 0 ? savedBytes / beforeBytes * 100 : 0;
    }

    function reportFileName(value) {
      const normalized = String(value ?? '').replace(/\\/g, '/');
      const parts = normalized.split('/');
      return parts[parts.length - 1] || normalized || 'game.html';
    }

    function renderReportKpi(label, value, detail) {
      return '<article class="report-kpi"><span>' + escapeReportHtml(label) + '</span><strong>'
        + escapeReportHtml(value) + '</strong><small>' + escapeReportHtml(detail) + '</small></article>';
    }

    function renderReportDonut(report) {
      const input = reportObject(report.input);
      const image = reportObject(report.imageOptimization);
      const audio = reportObject(report.audioOptimization);
      const inputImageBytes = Math.max(0, reportNumber(input.imageBytes));
      const inputAudioBytes = Math.max(0, reportNumber(input.audioBytes));
      const otherBytes = Math.max(0, reportNumber(input.totalBytes) - inputImageBytes - inputAudioBytes);
      const imageBytes = Math.max(0, reportOptionalNumber(image.afterBytes) ?? inputImageBytes);
      const audioBytes = Math.max(0, reportOptionalNumber(audio.afterBytes) ?? inputAudioBytes);
      const items = [
        { label: '图片', bytes: imageBytes, color: '#2563eb' },
        { label: '音频', bytes: audioBytes, color: '#14b8a6' },
        { label: '代码及其他资源', bytes: otherBytes, color: '#64748b' },
      ].filter((item) => item.bytes > 0);
      const total = items.reduce((sum, item) => sum + item.bytes, 0);
      if (total <= 0) return '<div class="report-empty">报告中没有可用于资源构成图的数据。</div>';
      let angle = 0;
      const stops = [];
      for (const item of items) {
        const start = angle;
        angle += item.bytes / total * 360;
        stops.push(item.color + ' ' + start.toFixed(3) + 'deg ' + angle.toFixed(3) + 'deg');
      }
      const legend = items.map((item) => {
        const percent = item.bytes / total * 100;
        return '<div class="report-legend-row"><i style="background:' + item.color + '"></i><span>'
          + escapeReportHtml(item.label) + '</span><strong>' + escapeReportHtml(formatReportBytes(item.bytes))
          + ' · ' + percent.toFixed(2) + '%</strong></div>';
      }).join('');
      return '<div class="report-donut-layout"><div class="report-donut" style="background:conic-gradient('
        + stops.join(',') + ')"><div class="report-donut-center"><span>优化后资源</span><strong>'
        + escapeReportHtml(formatReportBytes(total)) + '</strong></div></div><div class="report-legend">'
        + legend + '</div></div>';
    }

    function renderReportComparison(label, beforeBytes, afterBytes) {
      const before = Math.max(0, reportNumber(beforeBytes));
      const after = Math.max(0, reportNumber(afterBytes));
      const maximum = Math.max(before, after, 1);
      const saved = before - after;
      const percent = reportPercent(saved, before);
      const resultLabel = saved >= 0
        ? '减少 ' + formatReportBytes(saved) + ' · ' + percent.toFixed(2) + '%'
        : '增加 ' + formatReportBytes(Math.abs(saved)) + ' · ' + Math.abs(percent).toFixed(2) + '%';
      return '<div class="report-comparison"><div class="report-comparison-head"><span>'
        + escapeReportHtml(label) + '</span><strong>' + escapeReportHtml(resultLabel) + '</strong></div>'
        + '<div class="report-pair"><span>处理前</span><div class="report-track"><div class="report-fill-before" style="width:'
        + (before / maximum * 100).toFixed(3) + '%"></div></div><span>' + escapeReportHtml(formatReportBytes(before)) + '</span></div>'
        + '<div class="report-pair"><span>处理后</span><div class="report-track"><div class="report-fill-after" style="width:'
        + (after / maximum * 100).toFixed(3) + '%"></div></div><span>' + escapeReportHtml(formatReportBytes(after)) + '</span></div></div>';
    }

    function renderReportComparisons(report) {
      const input = reportObject(report.input);
      const output = reportObject(report.output);
      const image = reportObject(report.imageOptimization);
      const audio = reportObject(report.audioOptimization);
      const payload = reportObject(report.payloadEncoding);
      const rows = [];
      const inputBytes = reportOptionalNumber(input.totalBytes);
      const outputBytes = reportOptionalNumber(output.bytes);
      if (inputBytes !== null && outputBytes !== null) rows.push(renderReportComparison('构建目录 → 最终 HTML', inputBytes, outputBytes));
      if (reportOptionalNumber(image.beforeBytes) !== null && reportOptionalNumber(image.afterBytes) !== null) {
        rows.push(renderReportComparison('图片资源', image.beforeBytes, image.afterBytes));
      }
      if (reportOptionalNumber(audio.beforeBytes) !== null && reportOptionalNumber(audio.afterBytes) !== null) {
        rows.push(renderReportComparison('音频资源', audio.beforeBytes, audio.afterBytes));
      }
      if (reportOptionalNumber(payload.base64HtmlBytes) !== null && reportOptionalNumber(payload.outputHtmlBytes) !== null) {
        rows.push(renderReportComparison('Payload 编码层', payload.base64HtmlBytes, payload.outputHtmlBytes));
      }
      return rows.length === 0 ? '<div class="report-empty">报告中没有可比较的前后体积数据。</div>'
        : '<div class="report-comparisons">' + rows.join('') + '</div>';
    }

    function reportTimingLabel(key) {
      const labels = {
        copy: '复制构建目录',
        imageOptimization: '图片优化',
        audioOptimization: '音频优化',
        packaging: 'Brotli 打包',
        payloadEncoding: 'Payload 编码',
        brotliFallbackOptimization: '回退解码器优化',
        loadingScreen: '加载界面注入',
        total: '总耗时',
      };
      return labels[key] || key;
    }

    function renderReportTimings(report) {
      const timing = reportObject(report.timingMs);
      const rows = Object.entries(timing)
        .filter((entry) => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0)
        .map((entry) => ({ key: entry[0], value: Number(entry[1]) }));
      if (rows.length === 0) return '<div class="report-empty">没有耗时统计。</div>';
      const maximum = Math.max(...rows.map((row) => row.value), 1);
      return '<div class="report-timings">' + rows.map((row) => '<div class="report-timing-row"><span>'
        + escapeReportHtml(reportTimingLabel(row.key)) + '</span><div class="report-track"><div class="report-timing-fill" style="width:'
        + (row.value / maximum * 100).toFixed(3) + '%"></div></div><span>'
        + escapeReportHtml(formatReportDuration(row.value)) + '</span></div>').join('') + '</div>';
    }

    function reportModeLabel(mode) {
      if (mode === 'squoosh') return 'Squoosh（PNG 量化 + OxiPNG / MozJPEG）';
      if (mode === 'webp') return 'WebP';
      if (mode === 'tinypng') return 'TinyPNG';
      if (mode === 'none') return '不处理';
      return mode || '未记录';
    }

    function renderReportSettings(report) {
      const image = reportObject(report.imageOptimization);
      const imageSettings = reportObject(image.settings);
      const audio = reportObject(report.audioOptimization);
      const payload = reportObject(report.payloadEncoding);
      const fallback = reportObject(report.brotliFallback);
      const imageQuality = image.mode === 'webp'
        ? 'PNG ' + (imageSettings.pngWebpQuality ?? '-') + ' / JPEG ' + (imageSettings.jpegWebpQuality ?? '-')
        : image.mode === 'squoosh'
          ? 'PNG ' + (imageSettings.pngQuality ?? '-') + ' / JPEG ' + (imageSettings.jpegQuality ?? '-')
          : '按模式默认设置';
      const settings = [
        ['图片模式', reportModeLabel(image.mode), imageQuality],
        ['音频压缩', audio.enabled ? (audio.targetBitrateKbps + ' kbps') : '未启用', audio.preserveChannels ? '保持原声道数' : ''],
        ['Payload 编码', payload.mode || '未记录', payload.savedBytes === undefined ? '' : '相对 Base64 ' + formatReportPercent(payload.savedPercent)],
        ['Brotli 回退', fallback.mode || 'raw-js', fallback.mode === 'gzip-packed-js' ? '压缩存储 JS 解码器' : '兼容优先'],
      ];
      return '<div class="report-settings">' + settings.map((item) => '<article class="report-setting"><span>'
        + escapeReportHtml(item[0]) + '</span><strong>' + escapeReportHtml(item[1]) + '</strong><span style="margin-top:5px">'
        + escapeReportHtml(item[2]) + '</span></article>').join('') + '</div>';
    }

    function reportDeliveryFormat(value) {
      const labels = {
        'single-html': '单 HTML',
        'zip-index-html': 'ZIP / index.html',
        'zip-index-html-res-js': 'ZIP / index.html + res.js',
      };
      return labels[value] || value || '-';
    }

    function collectReportWarnings(report) {
      const sources = [];
      const channel = reportObject(report.channel);
      if (Array.isArray(channel.warnings)) sources.push(...channel.warnings);
      if (Array.isArray(report.channels)) {
        for (const item of report.channels) {
          const warnings = reportObject(item).warnings;
          if (Array.isArray(warnings)) sources.push(...warnings);
        }
      }
      return [...new Set(sources.map((value) => String(value)).filter(Boolean))];
    }

    function renderReportDeliveries(report) {
      const deliveries = Array.isArray(report.deliveries)
        ? report.deliveries.map(reportObject)
        : Object.keys(reportObject(report.delivery)).length > 0
          ? [reportObject(report.delivery)]
          : [];
      const warnings = collectReportWarnings(report);
      const bundle = reportObject(report.bundle);
      const bundleSummary = Object.keys(bundle).length === 0 ? '' : '<p class="report-card-note">渠道合集：'
        + escapeReportHtml(bundle.fileName || 'playable-channels.zip') + ' · ' + escapeReportHtml(formatReportBytes(bundle.bytes)) + '</p>';
      const table = deliveries.length === 0
        ? '<div class="report-empty">本次报告没有渠道交付数据。</div>'
        : '<div class="report-table-wrap"><table class="report-table"><thead><tr><th>渠道</th><th>格式</th><th>文件</th><th>体积</th><th>SHA-256</th></tr></thead><tbody>'
          + deliveries.map((item) => '<tr><td>' + escapeReportHtml(item.platform || '-') + '</td><td>'
            + escapeReportHtml(reportDeliveryFormat(item.format)) + '</td><td>' + escapeReportHtml(item.fileName || '-')
            + '</td><td>' + escapeReportHtml(formatReportBytes(item.bytes)) + '</td><td>'
            + escapeReportHtml(String(item.sha256 || '').slice(0, 16) + (item.sha256 ? '…' : '-')) + '</td></tr>').join('')
          + '</tbody></table></div>';
      const warningHtml = warnings.length === 0 ? '' : '<div class="report-warnings">'
        + warnings.map((warning) => '<div class="report-warning-item">' + escapeReportHtml(warning) + '</div>').join('') + '</div>';
      return bundleSummary + table + warningHtml;
    }

    function renderReportMeta(report) {
      const input = reportObject(report.input);
      const output = reportObject(report.output);
      const project = reportObject(report.project);
      const rows = [
        ['项目', project.key || project.explicitName || '-'],
        ['输入文件数', reportNumber(input.fileCount).toLocaleString()],
        ['图片文件数', reportNumber(input.imageCount).toLocaleString()],
        ['音频文件数', reportNumber(input.audioCount).toLocaleString()],
        ['最终文件', reportFileName(output.file)],
        ['SHA-256', output.sha256 || '-'],
        ['开始时间', report.startedAt ? new Date(report.startedAt).toLocaleString() : '-'],
        ['完成时间', report.completedAt ? new Date(report.completedAt).toLocaleString() : '-'],
        ['报告 Schema', report.schemaVersion ?? '-'],
      ];
      return '<dl class="report-meta">' + rows.map((row) => '<dt>' + escapeReportHtml(row[0]) + '</dt><dd>'
        + escapeReportHtml(row[1]) + '</dd>').join('') + '</dl>';
    }

    function renderBuildReport(report) {
      const input = reportObject(report.input);
      const output = reportObject(report.output);
      const timing = reportObject(report.timingMs);
      const inputBytes = Math.max(0, reportNumber(input.totalBytes));
      const outputBytes = Math.max(0, reportNumber(output.bytes));
      const savedBytes = inputBytes - outputBytes;
      const savedPercent = reportPercent(savedBytes, inputBytes);
      const reductionText = savedBytes >= 0 ? formatReportBytes(savedBytes) : '增加 ' + formatReportBytes(Math.abs(savedBytes));
      const status = report.status === 'succeeded' ? '构建成功' : String(report.status || '报告已生成');
      const mode = reportObject(report.payloadEncoding).mode || (report.tool === 'raw-single-html' ? '原始单 HTML' : 'Base64');
      buildReportContent.innerHTML = '<section class="report-hero"><div><h3>'
        + escapeReportHtml(reportFileName(output.file)) + '</h3><p>' + escapeReportHtml('实际输出 · ' + mode + ' · ' + (reportObject(report.imageOptimization).mode || '图片模式未记录'))
        + '</p></div><span class="report-status-badge">' + escapeReportHtml(status) + '</span></section>'
        + '<section class="report-kpis">'
        + renderReportKpi('最终 HTML', formatReportBytes(outputBytes), '渠道包装前的基础输出体积')
        + renderReportKpi('输入资源', formatReportBytes(inputBytes), reportNumber(input.fileCount) + ' 个文件')
        + renderReportKpi('总体积变化', reductionText, (savedPercent >= 0 ? '减少 ' : '增加 ') + Math.abs(savedPercent).toFixed(2) + '%')
        + renderReportKpi('图片收益', formatReportBytes(reportObject(report.imageOptimization).savedBytes), formatReportPercent(reportObject(report.imageOptimization).savedPercent))
        + renderReportKpi('总耗时', formatReportDuration(timing.total), '实际流水线统计')
        + '</section><section class="report-grid">'
        + '<article class="report-card"><h3>优化后资源构成</h3><p class="report-card-note">按进入 Solid Brotli 打包前的实际资源体积统计。压缩为单一数据块后无法可靠拆分最终 HTML 内的类别占比，因此这里不会伪造“最终包内占比”。</p>'
        + renderReportDonut(report) + '</article>'
        + '<article class="report-card"><h3>压缩前后对比</h3><p class="report-card-note">所有数值均来自本次报告；未执行的阶段不会显示。</p>'
        + renderReportComparisons(report) + '</article>'
        + '<article class="report-card"><h3>流水线耗时</h3><p class="report-card-note">用于定位构建耗时主要消耗在哪个阶段。</p>'
        + renderReportTimings(report) + '</article>'
        + '<article class="report-card"><h3>本次构建配置</h3><p class="report-card-note">展示实际生效模式，而不是推荐值或估计值。</p>'
        + renderReportSettings(report) + '</article>'
        + '<article class="report-card report-card-wide"><h3>渠道交付</h3><p class="report-card-note">多渠道构建共享一次基础资源压缩；以下为下载时派生的交付结果。</p>'
        + renderReportDeliveries(report) + '</article>'
        + '<article class="report-card report-card-wide"><h3>输出与校验信息</h3>' + renderReportMeta(report) + '</article>'
        + '</section>';
    }

    function buildReportJsonUrl() {
      const url = new URL(reportLink.href, window.location.href);
      url.searchParams.delete('download');
      return url;
    }

    async function openBuildReport() {
      const reportUrl = buildReportJsonUrl();
      reportDialogDownloadLink.href = reportLink.href;
      buildReportContent.innerHTML = '<div class="report-loading">正在读取本次构建报告……</div>';
      buildReportDialog.showModal();
      try {
        const response = await fetch(reportUrl.pathname + reportUrl.search, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error?.message || payload.message || ('读取报告失败：' + response.status));
        renderBuildReport(payload);
      } catch (error) {
        buildReportContent.innerHTML = '<div class="report-error">' + escapeReportHtml(error instanceof Error ? error.message : String(error)) + '</div>';
      }
    }

    viewReportButton.addEventListener('click', () => void openBuildReport());
    closeBuildReportButton.addEventListener('click', () => buildReportDialog.close());
    buildReportDialog.addEventListener('click', (event) => {
      if (event.target === buildReportDialog) buildReportDialog.close();
    });

    recommendedPresetButton.addEventListener('click', () => {`,
  );

  return html;
}
