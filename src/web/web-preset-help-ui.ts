import { createPlayableBuildReportWebMvpIndexHtml } from "./playable-build-report-ui.js";
import type { WebVersionInfo } from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new Error(`Web 推荐预设帮助扩展缺少插入点：${search.slice(0, 80)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function repairBuildReportInlineScript(source: string): string {
  const slash = String.fromCharCode(92);
  const brokenPathNormalizer = `.replace(/${slash}/g, '/')`;
  const safePathNormalizer = ".split(String.fromCharCode(92)).join('/')";
  if (!source.includes(brokenPathNormalizer)) {
    return source;
  }
  return source.replace(brokenPathNormalizer, safePathNormalizer);
}

export function supportRawSingleHtmlBuildReport(source: string): string {
  let html = replaceOnce(
    source,
    `    function reportOptionalNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }`,
    `    function reportOptionalNumber(value) {
      if (value === null || value === undefined || value === '') return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    function formatReportCount(value) {
      const number = reportOptionalNumber(value);
      return number === null ? '未记录' : Math.max(0, number).toLocaleString();
    }

    function isRawSingleHtmlReport(report) {
      return report.buildMode === 'raw-single-html' || report.tool === 'raw-single-html';
    }`,
  );

  html = replaceOnce(
    html,
    `      const settings = [
        ['图片模式', reportModeLabel(image.mode), imageQuality],
        ['音频压缩', audio.enabled ? (audio.targetBitrateKbps + ' kbps') : '未启用', audio.preserveChannels ? '保持原声道数' : ''],
        ['Payload 编码', payload.mode || '未记录', payload.savedBytes === undefined ? '' : '相对 Base64 ' + formatReportPercent(payload.savedPercent)],
        ['Brotli 回退', fallback.mode || 'raw-js', fallback.mode === 'gzip-packed-js' ? '压缩存储 JS 解码器' : '兼容优先'],
      ];`,
    `      const settings = isRawSingleHtmlReport(report)
        ? [
            ['图片模式', '未执行', '仅合并为单 HTML'],
            ['音频压缩', '未执行', '仅合并为单 HTML'],
            ['Payload 编码', '未执行', '未生成压缩 Payload'],
            ['Brotli 压缩', '未执行', '未生成 Brotli 数据块'],
          ]
        : [
            ['图片模式', reportModeLabel(image.mode), imageQuality],
            ['音频压缩', audio.enabled ? (audio.targetBitrateKbps + ' kbps') : '未启用', audio.preserveChannels ? '保持原声道数' : ''],
            ['Payload 编码', payload.mode || '未记录', payload.savedBytes === undefined ? '' : '相对 Base64 ' + formatReportPercent(payload.savedPercent)],
            ['Brotli 回退', fallback.mode || 'raw-js', fallback.mode === 'gzip-packed-js' ? '压缩存储 JS 解码器' : '兼容优先'],
          ];`,
  );

  html = replaceOnce(
    html,
    `        ['项目', project.key || project.explicitName || '-'],
        ['输入文件数', reportNumber(input.fileCount).toLocaleString()],
        ['图片文件数', reportNumber(input.imageCount).toLocaleString()],
        ['音频文件数', reportNumber(input.audioCount).toLocaleString()],`,
    `        ['项目', project.key || project.explicitName || '-'],
        ['输入文件数', formatReportCount(input.fileCount)],
        ['图片文件数', formatReportCount(input.imageCount)],
        ['音频文件数', formatReportCount(input.audioCount)],`,
  );

  html = replaceOnce(
    html,
    `      const inputBytes = Math.max(0, reportNumber(input.totalBytes));
      const outputBytes = Math.max(0, reportNumber(output.bytes));
      const savedBytes = inputBytes - outputBytes;
      const savedPercent = reportPercent(savedBytes, inputBytes);
      const reductionText = savedBytes >= 0 ? formatReportBytes(savedBytes) : '增加 ' + formatReportBytes(Math.abs(savedBytes));
      const status = report.status === 'succeeded' ? '构建成功' : String(report.status || '报告已生成');
      const mode = reportObject(report.payloadEncoding).mode || (report.tool === 'raw-single-html' ? '原始单 HTML' : 'Base64');`,
    `      const rawSingleHtml = isRawSingleHtmlReport(report);
      const inputBytesValue = reportOptionalNumber(input.totalBytes);
      const inputBytes = inputBytesValue === null ? null : Math.max(0, inputBytesValue);
      const outputBytes = Math.max(0, reportNumber(output.bytes));
      const savedBytes = inputBytes === null ? null : inputBytes - outputBytes;
      const savedPercent = savedBytes === null ? null : reportPercent(savedBytes, inputBytes);
      const reductionText = savedBytes === null
        ? '不适用'
        : savedBytes >= 0
          ? formatReportBytes(savedBytes)
          : '增加 ' + formatReportBytes(Math.abs(savedBytes));
      const reductionDetail = savedPercent === null
        ? '未记录输入目录总体积'
        : (savedPercent >= 0 ? '减少 ' : '增加 ') + Math.abs(savedPercent).toFixed(2) + '%';
      const status = report.status === 'succeeded' || rawSingleHtml
        ? '构建成功'
        : String(report.status || '报告已生成');
      const mode = rawSingleHtml
        ? '未压缩单 HTML'
        : reportObject(report.payloadEncoding).mode || 'Base64';
      const imageMode = rawSingleHtml
        ? '图片未处理'
        : reportObject(report.imageOptimization).mode || '图片模式未记录';
      const inputSizeText = inputBytes === null ? '未记录' : formatReportBytes(inputBytes);
      const inputFileCount = formatReportCount(input.fileCount);
      const inputFileDetail = inputFileCount === '未记录' ? '报告未提供文件统计' : inputFileCount + ' 个文件';
      const imageSavingsText = rawSingleHtml
        ? '不适用'
        : formatReportBytes(reportObject(report.imageOptimization).savedBytes);
      const imageSavingsDetail = rawSingleHtml
        ? '图片压缩未执行'
        : formatReportPercent(reportObject(report.imageOptimization).savedPercent);`,
  );

  html = replaceOnce(
    html,
    `        + escapeReportHtml(reportFileName(output.file)) + '</h3><p>' + escapeReportHtml('实际输出 · ' + mode + ' · ' + (reportObject(report.imageOptimization).mode || '图片模式未记录'))`,
    `        + escapeReportHtml(reportFileName(output.file)) + '</h3><p>' + escapeReportHtml('实际输出 · ' + mode + ' · ' + imageMode)`,
  );

  html = replaceOnce(
    html,
    `        + renderReportKpi('输入资源', formatReportBytes(inputBytes), reportNumber(input.fileCount) + ' 个文件')
        + renderReportKpi('总体积变化', reductionText, (savedPercent >= 0 ? '减少 ' : '增加 ') + Math.abs(savedPercent).toFixed(2) + '%')
        + renderReportKpi('图片收益', formatReportBytes(reportObject(report.imageOptimization).savedBytes), formatReportPercent(reportObject(report.imageOptimization).savedPercent))`,
    `        + renderReportKpi('输入资源', inputSizeText, inputFileDetail)
        + renderReportKpi('总体积变化', reductionText, reductionDetail)
        + renderReportKpi('图片收益', imageSavingsText, imageSavingsDetail)`,
  );

  return html;
}

export function simplifyBuildReportSettingsLayout(source: string): string {
  let html = replaceOnce(
    source,
    `    .report-settings { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 10px; }
    .report-setting { padding: 13px; border-radius: 9px; background: #0f172a; border: 1px solid #273244; }
    .report-setting span { display: block; color: #9ca3af; font-size: 11px; }
    .report-setting strong { display: block; margin-top: 6px; overflow-wrap: anywhere; }`,
    `    .report-settings { display: grid; gap: 0; margin: 0; }
    .report-setting-row { min-width: 0; padding: 12px 0; border-bottom: 1px solid #273244; }
    .report-setting-row:first-child { padding-top: 0; }
    .report-setting-row:last-child { padding-bottom: 0; border-bottom: 0; }
    .report-setting-row dt { color: #9ca3af; font-size: 11px; }
    .report-setting-row dd { display: flex; min-width: 0; margin: 5px 0 0; gap: 8px; align-items: baseline; flex-wrap: wrap; color: #f9fafb; overflow-wrap: anywhere; }
    .report-setting-row dd strong { font-size: 15px; }
    .report-setting-row dd span { color: #94a3b8; font-size: 11px; line-height: 1.45; }`,
  );

  html = replaceOnce(
    html,
    `      return '<div class="report-settings">' + settings.map((item) => '<article class="report-setting"><span>'
        + escapeReportHtml(item[0]) + '</span><strong>' + escapeReportHtml(item[1]) + '</strong><span style="margin-top:5px">'
        + escapeReportHtml(item[2]) + '</span></article>').join('') + '</div>';`,
    `      return '<dl class="report-settings">' + settings.map((item) => '<div class="report-setting-row"><dt>'
        + escapeReportHtml(item[0]) + '</dt><dd><strong>' + escapeReportHtml(item[1]) + '</strong>'
        + (item[2] ? '<span>' + escapeReportHtml(item[2]) + '</span>' : '') + '</dd></div>').join('') + '</dl>';`,
  );

  return html;
}

export function createPresetHelpWebMvpIndexHtml(versionInfo: WebVersionInfo): string {
  let html = simplifyBuildReportSettingsLayout(
    supportRawSingleHtmlBuildReport(
      repairBuildReportInlineScript(
        createPlayableBuildReportWebMvpIndexHtml(versionInfo),
      ),
    ),
  );

  html = replaceOnce(
    html,
    "    .error { color: #fca5a5; }",
    `    .preset-actions { display: flex; align-items: center; gap: 8px; }
    .compact-help-button { width: 34px; height: 34px; padding: 0; border: 1px solid #4b5563; border-radius: 50%; background: #111827; color: #cbd5e1; font-weight: 800; line-height: 1; flex: 0 0 auto; }
    .compact-help-button:hover { border-color: #6b7280; background: #1f2937; color: #fff; }
    .channel-warning-help-button { width: 24px; height: 24px; margin-left: 8px; border-color: #a16207; color: #fbbf24; font-size: 13px; }
    .channel-warning-help-button:hover { border-color: #f59e0b; color: #fde68a; }
    .preset-help-dialog h2, .channel-warning-dialog h2 { margin-bottom: 12px; }
    .preset-help-dialog p, .channel-warning-dialog p { margin: 0; color: #cbd5e1; }
    .preset-help-dialog strong { color: #fff; }
    .error { color: #fca5a5; }`,
  );

  html = replaceOnce(
    html,
    '        <button id="recommendedPresetButton" class="secondary" type="button">应用一键推荐预设</button>',
    `        <div class="preset-actions">
          <button id="recommendedPresetHelpButton" class="compact-help-button" type="button" aria-label="查看推荐预设说明" title="查看推荐预设说明">?</button>
          <button id="recommendedPresetButton" class="secondary" type="button">应用一键推荐预设</button>
        </div>`,
  );

  html = replaceOnce(
    html,
    `      <div class="preset">
        <strong>推荐预设</strong>
        Squoosh 80 / 音频不压缩 / HTML7 / Brotli raw-js。图片保持 PNG/JPEG 格式；音频压缩需按项目试听后手动启用。
      </div>`,
    `      <dialog id="recommendedPresetHelpDialog" class="preset-help-dialog">
        <h2>推荐预设</h2>
        <p><strong>Squoosh 80 / 音频不压缩 / HTML7 / Brotli raw-js</strong>。图片保持 PNG/JPEG 格式，避免默认引入 WebP 兼容风险；音频压缩需按项目试听后手动启用。</p>
        <div class="dialog-actions">
          <button id="closeRecommendedPresetHelpButton" class="secondary" type="button">关闭</button>
        </div>
      </dialog>
      <dialog id="channelWarningDialog" class="channel-warning-dialog">
        <h2>目标渠道注意事项</h2>
        <p id="channelWarningDialogText">当前所选渠道没有额外注意事项。</p>
        <div class="dialog-actions">
          <button id="closeChannelWarningButton" class="secondary" type="button">关闭</button>
        </div>
      </dialog>`,
  );

  html = replaceOnce(
    html,
    "    const recommendedPresetButton = document.getElementById('recommendedPresetButton');",
    `    const recommendedPresetButton = document.getElementById('recommendedPresetButton');
    const recommendedPresetHelpButton = document.getElementById('recommendedPresetHelpButton');
    const recommendedPresetHelpDialog = document.getElementById('recommendedPresetHelpDialog');
    const closeRecommendedPresetHelpButton = document.getElementById('closeRecommendedPresetHelpButton');
    const channelWarningDialog = document.getElementById('channelWarningDialog');
    const channelWarningDialogText = document.getElementById('channelWarningDialogText');
    const closeChannelWarningButton = document.getElementById('closeChannelWarningButton');`,
  );

  html = replaceOnce(
    html,
    "    recommendedPresetButton.addEventListener('click', () => {",
    `    recommendedPresetHelpButton.addEventListener('click', () => recommendedPresetHelpDialog.showModal());
    closeRecommendedPresetHelpButton.addEventListener('click', () => recommendedPresetHelpDialog.close());
    recommendedPresetHelpDialog.addEventListener('click', (event) => {
      if (event.target === recommendedPresetHelpDialog) recommendedPresetHelpDialog.close();
    });
    closeChannelWarningButton.addEventListener('click', () => channelWarningDialog.close());
    channelWarningDialog.addEventListener('click', (event) => {
      if (event.target === channelWarningDialog) channelWarningDialog.close();
    });

    function setupChannelWarningHelp() {
      const channelGroup = document.querySelector('.config-group[data-group="channel"]');
      const title = channelGroup?.querySelector('.config-group-title');
      if (!title || document.getElementById('channelWarningHelpButton')) return;
      const button = document.createElement('button');
      button.id = 'channelWarningHelpButton';
      button.className = 'compact-help-button channel-warning-help-button';
      button.type = 'button';
      button.textContent = '!';
      button.setAttribute('aria-label', '查看目标渠道注意事项');
      button.title = '查看目标渠道注意事项';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const warning = channelWarning?.textContent?.trim();
        channelWarningDialogText.textContent = warning || '当前所选渠道没有额外注意事项。';
        channelWarningDialog.showModal();
      });
      title.after(button);
      if (channelWarning) channelWarning.hidden = true;
    }

    recommendedPresetButton.addEventListener('click', () => {`,
  );

  html = replaceOnce(
    html,
    "    groupConfigSections();",
    `    groupConfigSections();
    setupChannelWarningHelp();`,
  );

  return html;
}
