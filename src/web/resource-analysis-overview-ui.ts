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
    @media (max-width: 920px) { .analysis-overview-columns { grid-template-columns: 1fr; } .analysis-pie-layout { grid-template-columns: minmax(210px, 270px) minmax(220px, 1fr); } }
    @media (max-width: 620px) { .analysis-pie-layout { grid-template-columns: 1fr; } .analysis-pie-legend-row { grid-template-columns: 12px minmax(45px, 1fr) auto; } }
  </style>`,
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

  return html;
}
