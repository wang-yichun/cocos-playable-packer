import { createLoadingScreenWebMvpIndexHtml } from "./loading-screen-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`资源体检 UI 缺少插入点：${search.slice(0, 80)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function replaceLast(source: string, search: string, replacement: string): string {
  const index = source.lastIndexOf(search);
  if (index < 0) throw new Error(`资源体检 UI 缺少末尾插入点：${search.slice(0, 80)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createResourceAnalysisWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  let html = createLoadingScreenWebMvpIndexHtml(versionInfo);

  html = replaceOnce(
    html,
    "    .error { color: #fca5a5; }",
    `    .feature-tabs { display: flex; gap: 8px; margin-top: 22px; padding: 5px; border: 1px solid #374151; border-radius: 11px; background: #0f172a; width: fit-content; }
    .feature-tab { background: transparent; color: #cbd5e1; }
    .feature-tab.active { background: #2563eb; color: #fff; }
    .analysis-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-top: 18px; }
    .analysis-stat { padding: 14px; border: 1px solid #374151; border-radius: 10px; background: #111827; }
    .analysis-stat strong { display: block; margin-top: 5px; font-size: 22px; }
    .analysis-stat small { color: #9ca3af; }
    .analysis-report { margin-top: 20px; }
    .analysis-bars { display: grid; gap: 10px; margin-top: 12px; }
    .analysis-bar-row { display: grid; grid-template-columns: minmax(100px, 170px) minmax(150px, 1fr) minmax(90px, auto); gap: 10px; align-items: center; }
    .analysis-bar-track { height: 12px; overflow: hidden; border-radius: 999px; background: #111827; }
    .analysis-bar-fill { height: 100%; border-radius: inherit; background: #3b82f6; }
    .analysis-table-wrap { overflow: auto; margin-top: 12px; }
    .analysis-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .analysis-table th, .analysis-table td { padding: 9px 10px; border-bottom: 1px solid #374151; text-align: left; vertical-align: top; }
    .analysis-table th { color: #9ca3af; font-weight: 600; }
    .analysis-note { margin-top: 12px; padding: 11px 13px; border-left: 3px solid #f59e0b; background: #111827; color: #d1d5db; }
    .analysis-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .analysis-upload-note { margin-top: 10px; color: #9ca3af; font-size: 13px; line-height: 1.55; }
    .error { color: #fca5a5; }`,
  );

  html = replaceOnce(
    html,
    "    <p>上传 Cocos Creator 的 <code>web-mobile.zip</code>，按所选模式生成单文件 Playable HTML。</p>",
    `    <p>上传 Cocos Creator 的 <code>web-mobile.zip</code>，按所选模式生成单文件 Playable HTML。</p>
    <nav class="feature-tabs" aria-label="主要功能">
      <button id="packFeatureTab" class="feature-tab active" type="button">Playable 打包</button>
      <button id="analysisFeatureTab" class="feature-tab" type="button">资源体检</button>
    </nav>`,
  );

  html = replaceOnce(
    html,
    "    <footer class=\"app-footer\">",
    `    <section id="resourceAnalysisPanel" class="card" hidden>
      <div class="section-head">
        <div>
          <h2>Cocos 构建资源体检</h2>
          <div class="hint">基础模式只分析 Web Mobile 构建 ZIP；完整模式再结合工程资源清单，恢复源路径并统计未进入本次构建的资源。</div>
        </div>
      </div>
      <div class="field">
        <label for="analysisZipFile">Web Mobile 构建 ZIP</label>
        <input id="analysisZipFile" type="file" accept=".zip,application/zip">
      </div>
      <div class="field" style="margin-top: 16px;">
        <label for="analysisManifestFile">工程资源清单（可选）</label>
        <input id="analysisManifestFile" type="file" accept=".json,application/json">
        <small>可以手动选择 assets-manifest.json，也可以下载 CMD 放到 Cocos 项目根目录双击运行。</small>
      </div>
      <div class="analysis-actions">
        <button id="analyzeBuildOnlyButton" type="button">仅分析构建 ZIP</button>
        <button id="analyzeJointButton" type="button">上传清单并完整分析</button>
        <button id="downloadManifestCmdButton" class="secondary" type="button">下载工程扫描 CMD</button>
      </div>
      <div class="analysis-upload-note">CMD 只上传路径、大小、SHA-256、UUID 与必要 Meta 配置，不上传图片、音频、字体或脚本内容。</div>
      <div id="analysisStatus" class="status">等待选择 Web Mobile ZIP。</div>
      <progress id="analysisProgress" max="100" value="0"></progress>
      <div id="analysisReport" class="analysis-report" hidden></div>
    </section>

    <footer class="app-footer">`,
  );

  html = replaceLast(
    html,
    "  </script>",
    `    const packFeatureTab = document.getElementById('packFeatureTab');
    const analysisFeatureTab = document.getElementById('analysisFeatureTab');
    const resourceAnalysisPanel = document.getElementById('resourceAnalysisPanel');
    const packFeaturePanels = Array.from(document.querySelectorAll('main > section.card'))
      .filter((panel) => panel !== resourceAnalysisPanel);
    const analysisZipFileInput = document.getElementById('analysisZipFile');
    const analysisManifestFileInput = document.getElementById('analysisManifestFile');
    const analyzeBuildOnlyButton = document.getElementById('analyzeBuildOnlyButton');
    const analyzeJointButton = document.getElementById('analyzeJointButton');
    const downloadManifestCmdButton = document.getElementById('downloadManifestCmdButton');
    const analysisStatus = document.getElementById('analysisStatus');
    const analysisProgress = document.getElementById('analysisProgress');
    const analysisReport = document.getElementById('analysisReport');
    let analysisBusy = false;
    let analysisJobId = null;
    let analysisPollTimer = null;

    function selectFeatureTab(tab) {
      const analysisActive = tab === 'analysis';
      packFeatureTab.classList.toggle('active', !analysisActive);
      analysisFeatureTab.classList.toggle('active', analysisActive);
      for (const panel of packFeaturePanels) panel.hidden = analysisActive;
      resourceAnalysisPanel.hidden = !analysisActive;
    }

    function formatAnalysisBytes(bytes) {
      if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MiB';
      if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KiB';
      return bytes + ' B';
    }

    function escapeAnalysisHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function setAnalysisBusy(value) {
      analysisBusy = value;
      analysisZipFileInput.disabled = value;
      analysisManifestFileInput.disabled = value;
      analyzeBuildOnlyButton.disabled = value;
      analyzeJointButton.disabled = value;
      downloadManifestCmdButton.disabled = value;
    }

    async function responseJson(response) {
      const value = await response.json();
      if (!response.ok) {
        throw new Error(value?.error?.message || ('请求失败：' + response.status));
      }
      return value;
    }

    async function createAnalysisJob() {
      const zip = analysisZipFileInput.files?.[0];
      if (!zip) throw new Error('请先选择 web-mobile.zip。');
      analysisStatus.textContent = '正在上传 Web Mobile ZIP……';
      analysisProgress.value = 12;
      const response = await fetch('/api/resource-analysis/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: zip,
      });
      const payload = await responseJson(response);
      analysisJobId = payload.job.id;
      return payload.job;
    }

    async function uploadAnalysisManifest(jobId) {
      const file = analysisManifestFileInput.files?.[0];
      if (!file) throw new Error('完整分析需要选择 assets-manifest.json，或使用工程扫描 CMD。');
      analysisStatus.textContent = '正在上传工程资源清单……';
      analysisProgress.value = 28;
      const response = await fetch('/api/resource-analysis/jobs/' + jobId + '/manifest', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: await file.text(),
      });
      await responseJson(response);
    }

    async function startAnalysis(jobId, requireManifest) {
      analysisStatus.textContent = requireManifest ? '正在启动完整分析……' : '正在启动基础分析……';
      analysisProgress.value = 35;
      const response = await fetch('/api/resource-analysis/jobs/' + jobId + '/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ requireManifest }),
      });
      await responseJson(response);
      pollAnalysisJob(jobId);
    }

    function renderAnalysisBars(items, labelKey, bytesKey, percentKey) {
      return '<div class="analysis-bars">' + items.map((item) => {
        const percent = Math.max(0, Math.min(100, Number(item[percentKey]) || 0));
        return '<div class="analysis-bar-row">'
          + '<span>' + escapeAnalysisHtml(item[labelKey]) + '</span>'
          + '<div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:' + percent + '%"></div></div>'
          + '<span>' + formatAnalysisBytes(item[bytesKey]) + ' · ' + percent.toFixed(2) + '%</span>'
          + '</div>';
      }).join('') + '</div>';
    }

    function renderAnalysisReport(report) {
      const buildExtensions = report.buildExtensions.slice(0, 10);
      const notInBuild = report.mappings.filter((item) => item.status === 'not-in-build').slice(0, 30);
      const categories = report.sourceCategories.filter((item) => item.includedPercentByBytes !== null);
      analysisReport.innerHTML = '<div class="analysis-grid">'
        + '<div class="analysis-stat"><small>构建文件</small><strong>' + report.buildFileCount + '</strong></div>'
        + '<div class="analysis-stat"><small>构建资源大小</small><strong>' + formatAnalysisBytes(report.buildBytes) + '</strong></div>'
        + '<div class="analysis-stat"><small>确认进入构建</small><strong>' + report.includedCount + '</strong></div>'
        + '<div class="analysis-stat"><small>未在本次构建中发现</small><strong>' + report.notInBuildCount + '</strong></div>'
        + '</div>'
        + '<h3>构建资源体积构成</h3>'
        + renderAnalysisBars(buildExtensions, 'extension', 'bytes', 'percentOfBuildBytes')
        + (categories.length === 0 ? '' : '<h3>源资源进入构建比例</h3>' + '<div class="analysis-bars">'
          + categories.map((item) => {
            const percent = Number(item.includedPercentByBytes) || 0;
            return '<div class="analysis-bar-row"><span>' + escapeAnalysisHtml(item.category)
              + '</span><div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:' + percent
              + '%"></div></div><span>' + percent.toFixed(2) + '%</span></div>';
          }).join('') + '</div>')
        + (notInBuild.length === 0 ? '' : '<h3>未在本次构建中发现的源资源</h3>'
          + '<div class="analysis-note">这些资源不等同于“无用资源”，可能属于其他平台、远程 Bundle、测试内容或当前构建配置未包含的功能。</div>'
          + '<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>源路径</th><th>类型</th><th>源大小</th></tr></thead><tbody>'
          + notInBuild.map((item) => '<tr><td>' + escapeAnalysisHtml(item.path) + '</td><td>'
            + escapeAnalysisHtml(item.extension) + '</td><td>' + formatAnalysisBytes(item.bytes) + '</td></tr>').join('')
          + '</tbody></table></div>')
        + '<div class="analysis-actions"><a class="action" href="/artifacts/resource-analysis/'
          + escapeAnalysisHtml(analysisJobId) + '/report.json?download=1">下载 JSON 报告</a></div>';
      analysisReport.hidden = false;
    }

    async function pollAnalysisJob(jobId) {
      clearTimeout(analysisPollTimer);
      try {
        const payload = await responseJson(await fetch('/api/resource-analysis/jobs/' + jobId));
        const job = payload.job;
        analysisStatus.textContent = job.message;
        if (job.status === 'waiting') analysisProgress.value = 30;
        if (job.status === 'extracting') analysisProgress.value = 55;
        if (job.status === 'analyzing') analysisProgress.value = 78;
        if (job.status === 'failed') {
          throw new Error(job.error?.message || '资源体检失败。');
        }
        if (job.status === 'succeeded') {
          analysisProgress.value = 100;
          const report = await responseJson(await fetch(job.links.report));
          renderAnalysisReport(report);
          setAnalysisBusy(false);
          return;
        }
        analysisPollTimer = setTimeout(() => pollAnalysisJob(jobId), 900);
      } catch (error) {
        analysisStatus.textContent = error instanceof Error ? error.message : String(error);
        analysisStatus.classList.add('error');
        setAnalysisBusy(false);
      }
    }

    async function runAnalysis(mode) {
      if (analysisBusy) return;
      analysisStatus.classList.remove('error');
      analysisReport.hidden = true;
      setAnalysisBusy(true);
      try {
        const job = await createAnalysisJob();
        if (mode === 'joint') await uploadAnalysisManifest(job.id);
        await startAnalysis(job.id, mode === 'joint');
      } catch (error) {
        analysisStatus.textContent = error instanceof Error ? error.message : String(error);
        analysisStatus.classList.add('error');
        setAnalysisBusy(false);
      }
    }

    packFeatureTab.addEventListener('click', () => selectFeatureTab('pack'));
    analysisFeatureTab.addEventListener('click', () => selectFeatureTab('analysis'));
    analyzeBuildOnlyButton.addEventListener('click', () => void runAnalysis('build-only'));
    analyzeJointButton.addEventListener('click', () => void runAnalysis('joint'));
    downloadManifestCmdButton.addEventListener('click', async () => {
      if (analysisBusy) return;
      analysisStatus.classList.remove('error');
      setAnalysisBusy(true);
      try {
        const job = await createAnalysisJob();
        analysisStatus.textContent = 'CMD 已生成。请放到 Cocos 项目根目录双击运行，页面会自动等待完整分析结果。';
        analysisProgress.value = 25;
        window.location.href = job.links.manifestCmd + '?download=1';
        pollAnalysisJob(job.id);
      } catch (error) {
        analysisStatus.textContent = error instanceof Error ? error.message : String(error);
        analysisStatus.classList.add('error');
        setAnalysisBusy(false);
      }
    });
  </script>`,
  );

  return html;
}
