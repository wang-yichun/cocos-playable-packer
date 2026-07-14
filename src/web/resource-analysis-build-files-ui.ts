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

    function explainBuildArtifact(file) {
      const value = String(file.path || '').replace(/\\\\/g, '/').toLowerCase();
      const extension = String(file.extension || '').toLowerCase();
      const sources = Array.isArray(file.sourcePaths) ? file.sourcePaths : [];
      if (sources.length > 0) return ['已关联源资源', '已通过 UUID 或构建路径恢复到工程源资源，优先从源资源和导入配置排查。', 'high'];
      if (/^cocos-js\\/cc(?:\\.|\\/|$)/.test(value)) return ['Cocos 引擎运行时', 'Cocos Creator Web 构建生成的引擎运行时代码，通常不能映射到单个 assets 资源。', 'high'];
      if (/^cocos-js\\/bullet(?:\\.|\\/|$)/.test(value)) return ['Bullet 物理运行时', 'Bullet 物理引擎的生成代码或 ASM/WASM 兼容运行时，不属于单个工程资源。', 'high'];
      if (/^cocos-js\\//.test(value) && ['.js', '.mjs', '.cjs', '.wasm'].includes(extension)) return ['Cocos 生成运行时', '通常是引擎模块、物理、解码器或其他构建运行时代码。', 'medium'];
      if (/^assets\\/[^/]+\\/index\\.(?:js|mjs|cjs)$/.test(value)) return ['项目脚本合并包', 'Cocos Bundle 的脚本入口或合并产物，通常包含多个用户脚本和模块依赖。', 'high'];
      if (/^src\\/assets\\/scripts\\/libs\\//.test(value) && ['.js', '.mjs', '.cjs'].includes(extension)) return ['用户或第三方库脚本', '通常是项目直接携带的第三方库或未参与常规 Bundle 合并的用户脚本。', 'medium'];
      if (/^assets\\/[^/]+\\/import\\/.+\\.(?:json|cconb)$/.test(value)) return ['Cocos 序列化导入数据', '可能聚合场景、Prefab、材质、动画或模型元数据，因此不一定能恢复到单一源文件。', 'high'];
      if (/^assets\\/[^/]+\\/config\\.json$/.test(value)) return ['Bundle 配置索引', 'Cocos Bundle 的配置与 UUID 索引，由构建流程生成。', 'high'];
      if (/^assets\\/[^/]+\\/native\\/[0-9a-f]{2}\\/[0-9a-f]{8,}\\.(?:png|jpe?g|webp)$/.test(value)) return ['生成纹理或图集页', '经验上通常是自动图集页、合并纹理或构建生成图片，应结合 Auto Atlas 配置判断。', 'medium'];
      if (extension === '.wasm') return ['WASM 运行模块', '常见于物理、解码或高性能库，不对应单个 assets 资源。', 'medium'];
      if (['.js', '.mjs', '.cjs'].includes(extension)) return ['未映射脚本产物', '可能包含用户代码、第三方库或生成运行时，需要 Source Map 或模块清单进一步确认。', 'low'];
      if (extension === '.json' && value.startsWith('assets/')) return ['未映射 Cocos 数据', '通常属于序列化资源或 Bundle 数据，缺少直接 UUID 证据时不能安全归到单个源资源。', 'medium'];
      return ['未知构建产物', '当前证据不足，建议结合构建配置、文件头、Source Map 或运行时引用继续定位。', 'low'];
    }

    function renderLargestBuildFiles(attention) {
      const files = Array.isArray(attention.largestBuildFiles) ? attention.largestBuildFiles : [];
      if (files.length === 0) return '';
      const rows = files.map((file) => {
        const inferred = explainBuildArtifact(file);
        return '<tr><td>' + escapeAnalysisHtml(file.path)
          + '</td><td>' + escapeAnalysisHtml(file.extension)
          + '</td><td>' + formatAnalysisBytes(file.bytes)
          + '</td><td>' + Number(file.percentOfBuildBytes || 0).toFixed(2) + '%</td><td>'
          + ((file.sourcePaths || []).length === 0 ? '—' : file.sourcePaths.slice(0, 5).map(escapeAnalysisHtml).join('<br>'))
          + '</td><td><b>' + escapeAnalysisHtml(inferred[0]) + '</b><br><small>' + escapeAnalysisHtml(inferred[1])
          + ' · 可信度 ' + escapeAnalysisHtml(inferred[2]) + '</small></td></tr>';
      }).join('');
      return '<h3>构建产物大文件排行</h3>'
        + '<div class="analysis-note">这里按实际 Web Mobile 文件大小排序。排行本身不表示文件异常；只有超过分类阈值的项目才会进入人工关注列表。经验判断用于解释无法精确关联源资源的构建产物，不应当作绝对结论。</div>'
        + '<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>构建路径</th><th>类型</th><th>大小</th><th>占 Web Mobile</th><th>关联源资源</th><th>经验判断</th></tr></thead><tbody>'
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
