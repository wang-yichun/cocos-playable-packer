import { createRedundancyResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-redundancy-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`资源体检分页 UI 缺少插入点：${search.slice(0, 100)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createTabbedResourceAnalysisWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  let html = createRedundancyResourceAnalysisWebMvpIndexHtml(versionInfo);
  html = html.replace(
    "可以手动选择 assets-manifest.json，也可以下载 CMD 放到 Cocos 项目根目录双击运行。",
    "可以手动选择 assets-manifest.json；CMD 会在 Cocos 项目根目录生成并保留同名清单，然后自动上传，后续可直接重复使用。",
  );
  html = html.replace(
    "<h3>优先处理候选</h3>",
    "<h3>压缩收益明细</h3><div class=\"analysis-note\">这里展示打包 Pipeline 可自动处理的图片和音频压缩收益。P0/P1/P2 只表示对当前 Web Mobile 体积的影响等级，不代表必须手工修改源资源。</div>",
  );
  html = replaceOnce(
    html,
    `        <small>可以手动选择 assets-manifest.json；CMD 会在 Cocos 项目根目录生成并保留同名清单，然后自动上传，后续可直接重复使用。</small>
      </div>
      <div class="analysis-actions">`,
    `        <small>可以手动选择 assets-manifest.json；CMD 会在 Cocos 项目根目录生成并保留同名清单，然后自动上传，后续可直接重复使用。</small>
      </div>
      <div class="field" style="margin-top: 16px;">
        <div class="check-row">
          <input id="analysisPayloadEncoding" type="checkbox">
          <label for="analysisPayloadEncoding">计算 Playable Payload 编码体积</label>
        </div>
        <small>可选。会额外执行一次 Brotli Q11，以及 Base64、Base91、HTML7 三种实际编码，分析时间会明显延长。</small>
      </div>
      <div class="analysis-actions">`,
  );
  html = replaceOnce(
    html,
    "  </style>",
    `    .analysis-subtabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 18px 0 14px; padding: 5px; border: 1px solid #374151; border-radius: 11px; background: #0f172a; width: fit-content; }
    .analysis-subtab { border: 0; border-radius: 8px; padding: 8px 13px; background: transparent; color: #cbd5e1; cursor: pointer; }
    .analysis-subtab.active { background: #2563eb; color: #fff; }
    .analysis-subpanel[hidden] { display: none; }
  </style>`,
  );
  html = replaceOnce(
    html,
    "    const analyzeBuildOnlyButton = document.getElementById('analyzeBuildOnlyButton');",
    `    const analysisPayloadEncodingInput = document.getElementById('analysisPayloadEncoding');
    const analyzeBuildOnlyButton = document.getElementById('analyzeBuildOnlyButton');`,
  );
  html = replaceOnce(
    html,
    "      downloadManifestCmdButton.disabled = value;",
    `      downloadManifestCmdButton.disabled = value;
      analysisPayloadEncodingInput.disabled = value;`,
  );
  html = replaceOnce(
    html,
    `      analysisStatus.textContent = requireManifest ? '正在启动完整分析……' : '正在启动基础分析……';
      analysisProgress.value = 35;`,
    `      const measurePayloadEncoding = analysisPayloadEncodingInput.checked;
      analysisStatus.textContent = (requireManifest ? '正在启动完整分析……' : '正在启动基础分析……')
        + (measurePayloadEncoding ? ' 完成常规分析后还会执行耗时较长的 Payload 编码测量。' : '');
      analysisProgress.value = 35;`,
  );
  html = replaceOnce(
    html,
    "        body: JSON.stringify({ requireManifest }),",
    "        body: JSON.stringify({ requireManifest, measurePayloadEncoding }),",
  );
  html = replaceOnce(
    html,
    "        window.location.href = job.links.manifestCmd + '?download=1';",
    "        window.location.href = job.links.manifestCmd + '?download=1&measurePayloadEncoding=' + (analysisPayloadEncodingInput.checked ? '1' : '0');",
  );
  html = replaceOnce(
    html,
    "    function renderAnalysisReport(report) {",
    `    function payloadEncodingLabel(value) {
      if (value === 'base64') return 'Base64';
      if (value === 'base91') return 'Base91';
      return 'HTML7';
    }

    function renderPayloadEncodingSection(report) {
      const payload = report.payloadEncoding;
      if (!payload) return '';
      if (payload.status !== 'measured') {
        return '<h3>Playable Payload 编码体积</h3><div class="analysis-note">'
          + payload.warnings.map(escapeAnalysisHtml).join('<br>') + '</div>';
      }
      const encodingFor = (name) => payload.encodings.find((item) => item.encoding === name);
      const finalHtmlCard = (name) => {
        const item = encodingFor(name);
        if (!item) return '';
        return '<div class="analysis-stat"><small>最终单 HTML（' + payloadEncodingLabel(name) + '）</small><strong>'
          + formatAnalysisBytes(item.htmlBytes) + '（' + item.htmlPercentOfBuildBytes.toFixed(2) + '%）</strong></div>';
      };
      const rows = payload.encodings.map((item) => '<tr><td><b>' + payloadEncodingLabel(item.encoding)
        + '</b></td><td>' + formatAnalysisBytes(item.payloadBytes)
        + '</td><td>' + (item.encoding === 'base64' ? '基准' : formatAnalysisBytes(item.savingsVsBase64Bytes) + ' · ' + item.savingsVsBase64Percent.toFixed(2) + '%')
        + '</td></tr>').join('');
      return '<h3>Playable Payload 编码体积</h3>'
        + '<div class="analysis-grid">'
        + '<div class="analysis-stat"><small>归档原始字节</small><strong>' + formatAnalysisBytes(payload.archiveRawBytes || 0) + '</strong></div>'
        + '<div class="analysis-stat"><small>Brotli Q11 二进制</small><strong>' + formatAnalysisBytes(payload.brotliBytes || 0) + '</strong></div>'
        + '<div class="analysis-stat"><small>Brotli 压缩率</small><strong>' + (payload.brotliCompressionPercent || 0).toFixed(2) + '%</strong></div>'
        + finalHtmlCard('base64') + finalHtmlCard('base91') + finalHtmlCard('html7')
        + '</div><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>编码</th><th>编码 Payload</th><th>相对 Base64 最终 HTML 减少</th></tr></thead><tbody>'
        + rows + '</tbody></table></div>'
        + payload.warnings.map((warning) => '<div class="analysis-note">' + escapeAnalysisHtml(warning) + '</div>').join('');
    }

    function organizeAnalysisSubTabs() {
      const actions = Array.from(analysisReport.children).find((child) => child.classList.contains('analysis-actions')) || null;
      const children = Array.from(analysisReport.children).filter((child) => child !== actions);
      const tabBar = document.createElement('nav');
      tabBar.className = 'analysis-subtabs';
      const definitions = [
        ['overview', '概况'],
        ['compression', '压缩收益'],
        ['duplicates', '完全重复资源'],
        ['not-in-build', '未进入构建'],
      ];
      const panels = Object.create(null);
      definitions.forEach((definition, index) => {
        const name = definition[0];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'analysis-subtab' + (index === 0 ? ' active' : '');
        button.textContent = definition[1];
        button.dataset.analysisSubtab = name;
        tabBar.appendChild(button);
        const panel = document.createElement('section');
        panel.className = 'analysis-subpanel';
        panel.dataset.analysisSubpanel = name;
        panel.hidden = index !== 0;
        panels[name] = panel;
      });
      let current = 'overview';
      children.forEach((child) => {
        if (child.tagName === 'H3') {
          const text = (child.textContent || '').trim();
          if (text === '压缩收益明细') current = 'compression';
          else if (text === '完全重复的工程资源') current = 'duplicates';
          else if (text === '未在本次构建中发现的源资源') current = 'not-in-build';
          else if (text === 'Playable Payload 编码体积' || text === '图片与音频优化估算') current = 'overview';
        }
        panels[current].appendChild(child);
      });
      analysisReport.replaceChildren(tabBar, ...definitions.map((definition) => panels[definition[0]]));
      if (actions) analysisReport.appendChild(actions);
      tabBar.addEventListener('click', (event) => {
        const button = event.target.closest('[data-analysis-subtab]');
        if (!button) return;
        const selected = button.dataset.analysisSubtab;
        tabBar.querySelectorAll('[data-analysis-subtab]').forEach((item) => item.classList.toggle('active', item === button));
        analysisReport.querySelectorAll('[data-analysis-subpanel]').forEach((panel) => { panel.hidden = panel.dataset.analysisSubpanel !== selected; });
      });
    }

    function renderAnalysisReport(report) {`,
  );
  html = replaceOnce(
    html,
    "        + renderOptimizationSection(report)",
    "        + renderPayloadEncodingSection(report)\n        + renderOptimizationSection(report)",
  );
  html = replaceOnce(
    html,
    "      analysisReport.hidden = false;",
    "      organizeAnalysisSubTabs();\n      analysisReport.hidden = false;",
  );
  return html;
}
