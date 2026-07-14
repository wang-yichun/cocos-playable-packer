import { createTabbedResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-tabs-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";

function replaceRange(source: string, startMarker: string, endMarker: string, replacement: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`构建大文件 UI 缺少起始插入点：${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`构建大文件 UI 缺少结束插入点：${endMarker}`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

export function createBuildFilesResourceAnalysisWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  let html = createTabbedResourceAnalysisWebMvpIndexHtml(versionInfo);
  html = replaceRange(
    html,
    "    function manualAttentionCategoryLabel(value) {",
    "    function organizeAnalysisSubTabs() {",
    `    function manualAttentionCategoryLabel(value) {
      if (value === 'large-scene') return '大型场景';
      if (value === 'large-model') return '大型模型';
      if (value === 'large-prefab') return '大型 Prefab';
      if (value === 'large-font') return '大型字体';
      if (value === 'oversized-image') return '超大像素图片';
      if (value === 'long-audio') return '长音频';
      if (value === 'large-build-script') return '大型构建脚本';
      if (value === 'large-build-json') return '大型构建 JSON';
      if (value === 'large-build-binary') return '大型构建二进制';
      if (value === 'large-build-wasm') return '大型 WASM';
      return '大型构建字体';
    }

    function renderLargestBuildFiles(attention) {
      const files = Array.isArray(attention.largestBuildFiles) ? attention.largestBuildFiles : [];
      if (files.length === 0) return '';
      const rows = files.map((file) => '<tr><td>' + escapeAnalysisHtml(file.path)
        + '</td><td>' + escapeAnalysisHtml(file.extension)
        + '</td><td>' + formatAnalysisBytes(file.bytes)
        + '</td><td>' + Number(file.percentOfBuildBytes || 0).toFixed(2) + '%</td><td>'
        + ((file.sourcePaths || []).length === 0 ? '—' : file.sourcePaths.slice(0, 5).map(escapeAnalysisHtml).join('<br>'))
        + '</td></tr>').join('');
      return '<h3>构建产物大文件排行</h3>'
        + '<div class="analysis-note">这里按实际 Web Mobile 文件大小排序。排行本身不表示文件异常；只有超过分类阈值的项目才会进入人工关注列表。</div>'
        + '<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>构建路径</th><th>类型</th><th>大小</th><th>占 Web Mobile</th><th>关联源资源</th></tr></thead><tbody>'
        + rows + '</tbody></table></div>';
    }

    function renderManualAttentionSection(report) {
      const attention = report.manualAttention;
      if (!attention) return '';
      const largest = renderLargestBuildFiles(attention);
      if (attention.itemCount === 0) {
        return '<h3>需人工关注</h3><div class="analysis-note">没有发现达到当前人工复核阈值的项目。该结果不代表项目不存在其他设计或运行问题。</div>' + largest;
      }
      const categoryCards = attention.categories.map((category) => '<div class="analysis-stat"><small>'
        + escapeAnalysisHtml(manualAttentionCategoryLabel(category.category)) + '</small><strong>' + category.itemCount
        + '</strong><div>高 ' + category.highCount + ' · 中 ' + category.mediumCount + '</div></div>').join('');
      const items = attention.items.slice(0, 80).map((item, index) => {
        const paths = item.sourcePaths.map((value) => '<div><b>源路径：</b>' + escapeAnalysisHtml(value) + '</div>')
          .concat(item.buildPaths.map((value) => '<div><b>构建路径：</b>' + escapeAnalysisHtml(value) + '</div>')).join('');
        const basis = item.sizeBasis === 'source' ? '源文件大小' : '构建文件大小';
        const mappedBuildBytes = item.metadata && typeof item.metadata.mappedBuildBytes === 'number' ? item.metadata.mappedBuildBytes : 0;
        const mappedBuild = item.sizeBasis === 'source' && mappedBuildBytes > 0
          ? ' · 映射构建 ' + formatAnalysisBytes(mappedBuildBytes)
          : '';
        return '<details class="attention-item ' + item.severity + '"' + (index < 5 ? ' open' : '') + '><summary><b>'
          + (item.severity === 'high' ? '高' : '中') + '</b> · ' + escapeAnalysisHtml(item.title) + ' · ' + basis + ' '
          + formatAnalysisBytes(item.currentBytes) + mappedBuild + '</summary><div style="margin-top:10px">' + (paths || '没有可显示的精确路径。')
          + '</div><p>' + escapeAnalysisHtml(item.rationale) + '</p><div class="attention-action"><b>建议：</b>'
          + escapeAnalysisHtml(item.nextAction) + '</div></details>';
      }).join('');
      return '<h3>需人工关注</h3><div class="analysis-grid">'
        + '<div class="analysis-stat"><small>关注项</small><strong>' + attention.itemCount + '</strong></div>'
        + '<div class="analysis-stat"><small>高优先级复核</small><strong>' + attention.highCount + '</strong></div>'
        + '<div class="analysis-stat"><small>中优先级复核</small><strong>' + attention.mediumCount + '</strong></div>'
        + categoryCards + '</div>'
        + attention.warnings.map((warning) => '<div class="analysis-note">' + escapeAnalysisHtml(warning) + '</div>').join('')
        + largest + '<h3>达到人工复核阈值的项目</h3><div class="attention-list">' + items + '</div>';
    }

`,
  );
  return html;
}
