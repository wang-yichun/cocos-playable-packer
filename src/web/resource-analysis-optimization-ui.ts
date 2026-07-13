import { createResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`资源优化 UI 缺少插入点：${search.slice(0, 80)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createResourceOptimizationWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  let html = createResourceAnalysisWebMvpIndexHtml(versionInfo);

  html = replaceOnce(
    html,
    "    .analysis-upload-note { margin-top: 10px; color: #9ca3af; font-size: 13px; line-height: 1.55; }",
    `    .analysis-upload-note { margin-top: 10px; color: #9ca3af; font-size: 13px; line-height: 1.55; }
    .optimization-comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
    .optimization-category { padding: 14px; border: 1px solid #374151; border-radius: 10px; background: #111827; }
    .optimization-category h4 { margin: 0 0 10px; }
    .optimization-line { display: grid; grid-template-columns: 58px minmax(120px, 1fr) minmax(90px, auto); gap: 9px; align-items: center; margin-top: 8px; }
    .optimization-line .analysis-bar-fill.current { background: #64748b; }
    .optimization-line .analysis-bar-fill.after { background: #22c55e; }
    .optimization-card-list { display: grid; gap: 12px; margin-top: 12px; }
    .optimization-card { padding: 15px; border: 1px solid #374151; border-left-width: 5px; border-radius: 10px; background: #111827; }
    .optimization-card.p0 { border-left-color: #ef4444; }
    .optimization-card.p1 { border-left-color: #f59e0b; }
    .optimization-card.p2 { border-left-color: #3b82f6; }
    .optimization-card-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .optimization-badge { display: inline-block; padding: 3px 8px; margin-right: 6px; border-radius: 999px; background: #1e293b; font-size: 12px; }
    .optimization-badge.estimate { background: #164e63; }
    .optimization-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-top: 12px; }
    .optimization-metric { padding: 9px; border-radius: 8px; background: #0f172a; }
    .optimization-metric small { display: block; color: #9ca3af; }
    .optimization-metric strong { display: block; margin-top: 3px; }
    .optimization-path { margin-top: 10px; color: #cbd5e1; overflow-wrap: anywhere; }
    .optimization-next { margin-top: 10px; padding: 9px 11px; border-left: 3px solid #22c55e; background: #0f172a; color: #d1d5db; }`,
  );

  html = replaceOnce(
    html,
    "    function renderAnalysisReport(report) {",
    `    function optimizationRange(minimum, maximum) {
      return minimum === maximum
        ? formatAnalysisBytes(minimum)
        : formatAnalysisBytes(minimum) + '–' + formatAnalysisBytes(maximum);
    }

    function optimizationCategoryLabel(category) {
      if (category === 'image') return '图片';
      if (category === 'audio') return '音频';
      return category;
    }

    function renderOptimizationSection(report) {
      const optimization = report.optimization;
      if (!optimization) return '';
      const optimizedMin = Math.max(0, report.buildBytes - optimization.estimatedSavingsBytesMax);
      const optimizedMax = Math.max(0, report.buildBytes - optimization.estimatedSavingsBytesMin);
      const comparisons = optimization.categories.map((item) => {
        const current = Math.max(1, item.currentBytes);
        const afterWidth = Math.max(0, Math.min(100, item.estimatedAfterBytesMax / current * 100));
        return '<div class="optimization-category"><h4>' + optimizationCategoryLabel(item.category) + '</h4>'
          + '<div class="optimization-line"><span>当前</span><div class="analysis-bar-track"><div class="analysis-bar-fill current" style="width:100%"></div></div><span>' + formatAnalysisBytes(item.currentBytes) + '</span></div>'
          + '<div class="optimization-line"><span>预计后</span><div class="analysis-bar-track"><div class="analysis-bar-fill after" style="width:' + afterWidth + '%"></div></div><span>' + optimizationRange(item.estimatedAfterBytesMin, item.estimatedAfterBytesMax) + '</span></div>'
          + '<div class="analysis-upload-note">候选 ' + item.candidateCount + '/' + item.fileCount + '；预计影响总构建 ' + item.totalBuildImpactPercentMin.toFixed(2) + '%–' + item.totalBuildImpactPercentMax.toFixed(2) + '%。</div></div>';
      }).join('');
      const cards = optimization.candidates.slice(0, 24).map((item) => {
        const source = item.sourcePaths.length === 0 ? '未恢复源路径' : item.sourcePaths.join('<br>');
        const estimate = item.estimateKind === 'measured' ? '实测' : '参数估算';
        const selfPercent = item.savingsPercentMin === item.savingsPercentMax
          ? item.savingsPercentMin.toFixed(2) + '%'
          : item.savingsPercentMin.toFixed(2) + '%–' + item.savingsPercentMax.toFixed(2) + '%';
        const impact = item.totalBuildImpactPercentMin === item.totalBuildImpactPercentMax
          ? item.totalBuildImpactPercentMin.toFixed(2) + '%'
          : item.totalBuildImpactPercentMin.toFixed(2) + '%–' + item.totalBuildImpactPercentMax.toFixed(2) + '%';
        return '<article class="optimization-card ' + item.priority.toLowerCase() + '">'
          + '<div class="optimization-card-head"><div><span class="optimization-badge">' + item.priority + '</span><span class="optimization-badge estimate">' + estimate + '</span></div><strong>' + escapeAnalysisHtml(item.title) + '</strong></div>'
          + '<div class="optimization-metrics">'
          + '<div class="optimization-metric"><small>当前大小</small><strong>' + formatAnalysisBytes(item.currentBytes) + '</strong></div>'
          + '<div class="optimization-metric"><small>预计处理后</small><strong>' + optimizationRange(item.estimatedAfterBytesMin, item.estimatedAfterBytesMax) + '</strong></div>'
          + '<div class="optimization-metric"><small>自身减少</small><strong>' + selfPercent + '</strong></div>'
          + '<div class="optimization-metric"><small>对总构建影响</small><strong>' + impact + '</strong></div>'
          + '</div><div class="optimization-path"><b>构建路径：</b>' + escapeAnalysisHtml(item.buildPath) + '</div>'
          + '<div class="optimization-path"><b>源资源：</b>' + source.split('<br>').map(escapeAnalysisHtml).join('<br>') + '</div>'
          + '<div class="optimization-next"><b>建议：</b>' + escapeAnalysisHtml(item.nextAction) + '</div></article>';
      }).join('');
      return '<h3>图片与音频优化估算</h3>'
        + '<div class="analysis-grid"><div class="analysis-stat"><small>预计优化后构建大小</small><strong>' + optimizationRange(optimizedMin, optimizedMax) + '</strong></div>'
        + '<div class="analysis-stat"><small>预计总构建减少</small><strong>' + optimization.totalBuildSavingsPercentMin.toFixed(2) + '%–' + optimization.totalBuildSavingsPercentMax.toFixed(2) + '%</strong></div>'
        + '<div class="analysis-stat"><small>图片实测候选</small><strong>' + optimization.measuredImageCount + '</strong></div>'
        + '<div class="analysis-stat"><small>音频参数估算候选</small><strong>' + optimization.parameterEstimatedAudioCount + '</strong></div></div>'
        + '<div class="optimization-comparison">' + comparisons + '</div>'
        + '<div class="analysis-note">图片为 WebP 80 临时转码实测；音频为 48 kbps 参数估算。这里只提供诊断，不会自动修改打包配置或资源文件。</div>'
        + (cards.length === 0 ? '' : '<h3>优先处理候选</h3><div class="optimization-card-list">' + cards + '</div>');
    }

    function renderAnalysisReport(report) {`,
  );

  html = replaceOnce(
    html,
    `          + '</tbody></table></div>')
        + '<div class="analysis-actions"><a class="action" href="/artifacts/resource-analysis/'
          + escapeAnalysisHtml(analysisJobId) + '/report.json?download=1">下载 JSON 报告</a></div>';`,
    `          + '</tbody></table></div>')
        + renderOptimizationSection(report)
        + '<div class="analysis-actions"><a class="action" target="_blank" rel="noopener" href="/artifacts/resource-analysis/'
          + escapeAnalysisHtml(analysisJobId) + '/report.html">打开完整 HTML 报告</a>'
          + '<a class="action" href="/artifacts/resource-analysis/' + escapeAnalysisHtml(analysisJobId) + '/report.html?download=1">下载 HTML 报告</a>'
          + '<a class="action" href="/artifacts/resource-analysis/' + escapeAnalysisHtml(analysisJobId) + '/report.json?download=1">下载 JSON 报告</a></div>';`,
  );

  return html;
}
