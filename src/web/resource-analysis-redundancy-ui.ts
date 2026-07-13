import { createClarifiedResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-clarity-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`重复资源 UI 缺少插入点：${search.slice(0, 80)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createRedundancyResourceAnalysisWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  let html = createClarifiedResourceAnalysisWebMvpIndexHtml(versionInfo);
  html = replaceOnce(
    html,
    "  </style>",
    `    .redundancy-groups { display: grid; gap: 9px; margin-top: 12px; }
    .redundancy-group { padding: 11px 13px; border: 1px solid #374151; border-radius: 9px; background: #111827; }
    .redundancy-group summary { cursor: pointer; }
  </style>`,
  );
  html = replaceOnce(
    html,
    "    function renderAnalysisReport(report) {",
    `    function redundancyClassificationLabel(value) {
      if (value === 'all-in-build') return '全部进入构建';
      if (value === 'mixed') return '部分进入构建';
      if (value === 'not-in-build') return '均未进入本次构建';
      return '无法通过 UUID 判断';
    }

    function redundancyStatusLabel(value) {
      if (value === 'included') return '已进入构建';
      if (value === 'not-in-build') return '未进入本次构建';
      return '无法判断';
    }

    function renderSourceRedundancySection(report) {
      const redundancy = report.redundancy;
      if (!redundancy) return '';
      const summary = '<h3>完全重复的工程资源</h3>'
        + '<div class="analysis-grid">'
        + '<div class="analysis-stat"><small>重复组</small><strong>' + redundancy.duplicateGroupCount + '</strong></div>'
        + '<div class="analysis-stat"><small>涉及文件</small><strong>' + redundancy.duplicateFileCount + '</strong></div>'
        + '<div class="analysis-stat"><small>工程理论重复字节</small><strong>' + formatAnalysisBytes(redundancy.redundantProjectBytes) + '</strong></div>'
        + '<div class="analysis-stat"><small>全部进入构建的组</small><strong>' + redundancy.allInBuildGroupCount + '</strong></div>'
        + '</div>'
        + '<div class="analysis-note">按 assets 清单 SHA-256 精确判定。工程理论重复字节不等于最终构建、Brotli Payload 或单 HTML 可减少的字节。</div>';
      const groups = redundancy.groups.slice(0, 12).map((group, index) => {
        const rows = group.items.map((item) => '<tr><td>' + escapeAnalysisHtml(item.path) + '</td><td>'
          + redundancyStatusLabel(item.status) + '</td><td>'
          + (item.buildPaths.length === 0 ? '—' : item.buildPaths.map(escapeAnalysisHtml).join('<br>')) + '</td></tr>').join('');
        return '<details class="redundancy-group"' + (index < 2 ? ' open' : '') + '><summary><b>'
          + redundancyClassificationLabel(group.classification) + '</b> · ' + group.fileCount + ' 个文件 · 工程重复 '
          + formatAnalysisBytes(group.redundantProjectBytes) + '</summary>'
          + '<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>源路径</th><th>状态</th><th>构建路径</th></tr></thead><tbody>'
          + rows + '</tbody></table></div></details>';
      }).join('');
      return summary + (groups.length === 0 ? '<div class="analysis-note">没有发现 SHA-256 完全相同的非空源资源。</div>' : '<div class="redundancy-groups">' + groups + '</div>');
    }

    function renderAnalysisReport(report) {`,
  );
  html = replaceOnce(
    html,
    "        + renderOptimizationSection(report)",
    "        + renderOptimizationSection(report)\n        + renderSourceRedundancySection(report)",
  );
  return html;
}
