import {
  DEFAULT_WEB_BUILD_CONFIG,
  RECOMMENDED_WEB_BUILD_CONFIG,
} from "./web-build-config.js";

export function createWebMvpIndexHtml(): string {
  const defaultConfigJson = JSON.stringify(DEFAULT_WEB_BUILD_CONFIG);
  const recommendedConfigJson = JSON.stringify(RECOMMENDED_WEB_BUILD_CONFIG);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cocos Playable Packer</title>
  <style>
    :root { font-family: Inter, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #111827; color: #e5e7eb; }
    main { max-width: 980px; margin: 0 auto; padding: 48px 24px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    h2 { margin: 0; font-size: 18px; }
    p { color: #9ca3af; line-height: 1.6; }
    .card { margin-top: 24px; padding: 24px; border: 1px solid #374151; border-radius: 14px; background: #1f2937; }
    .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
    .config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; }
    .field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
    .field > label { font-weight: 600; color: #e5e7eb; }
    .field small, .hint { color: #9ca3af; line-height: 1.45; }
    .check-row { display: flex; align-items: center; gap: 9px; min-height: 42px; }
    .check-row label { font-weight: 600; }
    input[type=file] { flex: 1; min-width: 260px; }
    select, input[type=number] { width: 100%; border: 1px solid #4b5563; border-radius: 8px; padding: 10px 11px; background: #111827; color: #e5e7eb; font: inherit; }
    select:disabled, input:disabled { opacity: .55; cursor: not-allowed; }
    button, a.action { border: 0; border-radius: 8px; padding: 10px 16px; font: inherit; cursor: pointer; text-decoration: none; }
    button { background: #2563eb; color: #fff; }
    button.secondary { background: #374151; }
    button[disabled] { opacity: .55; cursor: not-allowed; }
    a.action { display: inline-block; background: #374151; color: #fff; }
    .preset { padding: 14px; border-radius: 10px; background: #111827; border: 1px solid #374151; }
    .preset strong { display: block; margin-bottom: 5px; }
    .summary { margin-top: 18px; padding: 12px 14px; border-radius: 8px; background: #0f172a; color: #cbd5e1; font-size: 14px; line-height: 1.55; }
    .warning { margin-top: 8px; color: #fbbf24; }
    .status { margin-top: 18px; font-weight: 600; }
    progress { width: 100%; height: 14px; margin-top: 12px; }
    pre { margin: 16px 0 0; max-height: 300px; overflow: auto; padding: 14px; border-radius: 8px; background: #030712; color: #d1d5db; white-space: pre-wrap; word-break: break-word; }
    .actions { display: none; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .error { color: #fca5a5; }
  </style>
</head>
<body>
  <main>
    <h1>Cocos Playable Packer</h1>
    <p>上传 Cocos Creator 的 <code>web-mobile.zip</code>，按所选模式生成单文件 Playable HTML。</p>

    <section class="card">
      <div class="section-head">
        <div>
          <h2>构建配置</h2>
          <div class="hint">既可以执行完整压缩，也可以只合并为单 HTML，作为兼容基线或竞品能力对照。</div>
        </div>
        <button id="recommendedPresetButton" class="secondary" type="button">应用一键推荐预设</button>
      </div>

      <div class="preset">
        <strong>推荐预设</strong>
        WebP 80 / 音频 48 kbps / HTML7 / Brotli raw-js。该组合已经通过真实游戏试玩验证；启用音频压缩前需确保系统可以执行 FFmpeg。
      </div>

      <div class="config-grid" style="margin-top: 18px;">
        <div class="field">
          <label for="buildMode">构建模式</label>
          <select id="buildMode">
            <option value="optimized">优化并压缩</option>
            <option value="raw-single-html">仅合并单 HTML（不压缩）</option>
          </select>
          <small id="buildModeHint">执行图片、音频、Brotli 和 Payload 优化。</small>
        </div>

        <div class="field">
          <label for="imageMode">图片模式</label>
          <select id="imageMode">
            <option value="webp">WebP</option>
            <option value="squoosh">Squoosh</option>
            <option value="none">不处理图片</option>
          </select>
          <small id="imageModeHint">将 PNG/JPEG 内容编码为 WebP，并保留逻辑路径。</small>
        </div>

        <div class="field">
          <label for="pngQuality">PNG 质量</label>
          <input id="pngQuality" type="number" min="1" max="100" step="1" value="80">
          <small id="pngQualityHint">WebP PNG 质量，范围 1-100。</small>
        </div>

        <div class="field">
          <label for="jpegQuality">JPEG 质量</label>
          <input id="jpegQuality" type="number" min="1" max="100" step="1" value="80">
          <small id="jpegQualityHint">WebP JPEG 质量，范围 1-100。</small>
        </div>

        <div class="field">
          <label>音频压缩</label>
          <div class="check-row">
            <input id="audioEnabled" type="checkbox">
            <label for="audioEnabled">启用 MP3 码率压缩</label>
          </div>
          <small>启用后需要 FFmpeg；关闭时保留原音频。</small>
        </div>

        <div class="field">
          <label for="audioBitrate">音频码率（kbps）</label>
          <input id="audioBitrate" type="number" min="8" max="320" step="1" value="48" disabled>
          <small>范围 8-320，生产流程保持原声道数。</small>
        </div>

        <div class="field">
          <label for="payloadEncoding">Payload 编码</label>
          <select id="payloadEncoding">
            <option value="html7">HTML7（体积优先）</option>
            <option value="base91">Base91（折中）</option>
            <option value="base64">Base64（兼容优先）</option>
          </select>
          <small id="payloadHint">HTML-safe 7-bit，正式投放前应在目标渠道验证。</small>
        </div>
      </div>

      <div id="configSummary" class="summary"></div>
      <div id="audioWarning" class="warning" hidden>已启用音频压缩：运行 Web 服务的环境必须能够执行 ffmpeg。</div>
    </section>

    <section class="card">
      <div class="row">
        <input id="zipFile" type="file" accept=".zip,application/zip">
        <button id="buildButton" type="button">上传并构建</button>
        <button id="cancelButton" class="secondary" type="button" disabled>取消任务</button>
      </div>
      <div id="status" class="status">等待上传。</div>
      <progress id="progress" max="100" value="0"></progress>
      <pre id="logs">尚未开始。</pre>
      <div id="actions" class="actions">
        <a id="previewLink" class="action" target="_blank" rel="noopener">在线试玩</a>
        <a id="htmlLink" class="action">下载 HTML</a>
        <a id="reportLink" class="action">下载报告</a>
      </div>
    </section>
  </main>
  <script>
    const defaultConfig = ${defaultConfigJson};
    const recommendedConfig = ${recommendedConfigJson};

    const fileInput = document.getElementById('zipFile');
    const buildButton = document.getElementById('buildButton');
    const cancelButton = document.getElementById('cancelButton');
    const recommendedPresetButton = document.getElementById('recommendedPresetButton');
    const buildModeInput = document.getElementById('buildMode');
    const buildModeHint = document.getElementById('buildModeHint');
    const imageModeInput = document.getElementById('imageMode');
    const imageModeHint = document.getElementById('imageModeHint');
    const pngQualityInput = document.getElementById('pngQuality');
    const pngQualityHint = document.getElementById('pngQualityHint');
    const jpegQualityInput = document.getElementById('jpegQuality');
    const jpegQualityHint = document.getElementById('jpegQualityHint');
    const audioEnabledInput = document.getElementById('audioEnabled');
    const audioBitrateInput = document.getElementById('audioBitrate');
    const payloadEncodingInput = document.getElementById('payloadEncoding');
    const payloadHint = document.getElementById('payloadHint');
    const configSummary = document.getElementById('configSummary');
    const audioWarning = document.getElementById('audioWarning');
    const statusElement = document.getElementById('status');
    const progressElement = document.getElementById('progress');
    const logsElement = document.getElementById('logs');
    const actionsElement = document.getElementById('actions');
    const previewLink = document.getElementById('previewLink');
    const htmlLink = document.getElementById('htmlLink');
    const reportLink = document.getElementById('reportLink');

    let currentJobId = null;
    let pollingTimer = null;
    let busy = false;

    function parseInteger(input, name, minimum, maximum) {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(name + '必须是 ' + minimum + ' 到 ' + maximum + ' 之间的整数。');
      }
      return value;
    }

    function readConfig() {
      const buildMode = buildModeInput.value;
      if (buildMode === 'raw-single-html') {
        return {
          buildMode: 'raw-single-html',
          imageMode: 'none',
          pngQuality: 80,
          jpegQuality: 80,
          audioBitrateKbps: null,
          payloadEncoding: 'base64',
          brotliFallback: 'raw-js',
        };
      }

      const imageMode = imageModeInput.value;
      const minimumPngQuality = imageMode === 'squoosh' ? 0 : 1;
      const pngQuality = parseInteger(pngQualityInput, 'PNG 质量', minimumPngQuality, 100);
      const jpegQuality = parseInteger(jpegQualityInput, 'JPEG 质量', 1, 100);
      const audioBitrateKbps = audioEnabledInput.checked
        ? parseInteger(audioBitrateInput, '音频码率', 8, 320)
        : null;

      return {
        buildMode: 'optimized',
        imageMode: imageMode,
        pngQuality: pngQuality,
        jpegQuality: jpegQuality,
        audioBitrateKbps: audioBitrateKbps,
        payloadEncoding: payloadEncodingInput.value,
        brotliFallback: 'raw-js',
      };
    }

    function applyConfig(config) {
      buildModeInput.value = config.buildMode;
      imageModeInput.value = config.imageMode;
      pngQualityInput.value = String(config.pngQuality);
      jpegQualityInput.value = String(config.jpegQuality);
      audioEnabledInput.checked = config.audioBitrateKbps !== null;
      audioBitrateInput.value = String(config.audioBitrateKbps === null ? 48 : config.audioBitrateKbps);
      payloadEncodingInput.value = config.payloadEncoding;
      refreshConfigUi();
    }

    function refreshConfigUi() {
      const rawMode = buildModeInput.value === 'raw-single-html';
      const imageMode = imageModeInput.value;
      const imagesDisabled = busy || rawMode || imageMode === 'none';
      const audioEnabled = !rawMode && audioEnabledInput.checked;

      fileInput.disabled = busy;
      buildButton.disabled = busy;
      recommendedPresetButton.disabled = busy;
      buildModeInput.disabled = busy;
      imageModeInput.disabled = busy || rawMode;
      pngQualityInput.disabled = imagesDisabled;
      jpegQualityInput.disabled = imagesDisabled;
      audioEnabledInput.disabled = busy || rawMode;
      audioBitrateInput.disabled = busy || rawMode || !audioEnabled;
      payloadEncodingInput.disabled = busy || rawMode;
      cancelButton.disabled = !busy || currentJobId === null;

      buildModeHint.textContent = rawMode
        ? '直接复用未压缩单 HTML 打包器，不处理图片、音频，也不使用 Brotli 或文本 Payload 编码。'
        : '执行资源优化、Solid Brotli 和所选 Payload 编码。';

      if (imageMode === 'webp') {
        pngQualityInput.min = '1';
        imageModeHint.textContent = '将 PNG/JPEG 内容编码为 WebP，并保留逻辑路径。';
        pngQualityHint.textContent = 'WebP PNG 质量，范围 1-100。';
        jpegQualityHint.textContent = 'WebP JPEG 质量，范围 1-100。';
      } else if (imageMode === 'squoosh') {
        pngQualityInput.min = '0';
        imageModeHint.textContent = 'PNG 量化 + OxiPNG，JPEG 使用 MozJPEG。';
        pngQualityHint.textContent = 'PNG 量化质量，范围 0-100。';
        jpegQualityHint.textContent = 'MozJPEG 质量，范围 1-100。';
      } else {
        pngQualityInput.min = '1';
        imageModeHint.textContent = '保留构建目录中的原始图片内容。';
        pngQualityHint.textContent = '图片模式为 none 时忽略。';
        jpegQualityHint.textContent = '图片模式为 none 时忽略。';
      }

      if (payloadEncodingInput.value === 'html7') {
        payloadHint.textContent = 'HTML-safe 7-bit，正式投放前应在目标渠道验证。';
      } else if (payloadEncodingInput.value === 'base91') {
        payloadHint.textContent = '体积与字符兼容性的折中方案。';
      } else {
        payloadHint.textContent = '兼容性最高，但文本 Payload 体积最大。';
      }

      audioWarning.hidden = rawMode || !audioEnabled;

      if (rawMode) {
        configSummary.textContent = '当前配置：仅合并单 HTML，不执行图片压缩、音频压缩、Brotli 压缩或 Payload 编码。该模式通常约 20 MB，用于兼容基线和竞品能力对照。';
        return;
      }

      try {
        const config = readConfig();
        const imageText = config.imageMode === 'none'
          ? '图片不处理'
          : config.imageMode + '，PNG ' + config.pngQuality + '，JPEG ' + config.jpegQuality;
        const audioText = config.audioBitrateKbps === null
          ? '音频不处理'
          : '音频 ' + config.audioBitrateKbps + ' kbps';
        configSummary.textContent = '当前配置：' + imageText + ' / ' + audioText + ' / ' + config.payloadEncoding + ' / Brotli raw-js';
      } catch (error) {
        configSummary.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    function setBusy(value) {
      busy = value;
      refreshConfigUi();
    }

    function updateProgress(status) {
      const values = { queued: 15, extracting: 35, building: 70, succeeded: 100, failed: 100, cancelled: 100 };
      progressElement.value = values[status] || 0;
    }

    async function readJson(response) {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error?.message || payload.message || ('请求失败：' + response.status));
      }
      return payload;
    }

    async function pollJob(jobId) {
      const payload = await readJson(await fetch('/api/jobs/' + jobId, { cache: 'no-store' }));
      const job = payload.job;
      statusElement.textContent = job.message + '（' + job.status + '）';
      updateProgress(job.status);
      logsElement.textContent = job.recentLogs.length === 0 ? '暂无日志。' : job.recentLogs.join('\\n');
      logsElement.scrollTop = logsElement.scrollHeight;

      if (job.status === 'succeeded') {
        clearInterval(pollingTimer);
        pollingTimer = null;
        currentJobId = null;
        setBusy(false);
        actionsElement.style.display = 'flex';
        previewLink.href = job.links.preview;
        htmlLink.href = job.links.html + '?download=1';
        reportLink.href = job.links.report + '?download=1';
        return;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        clearInterval(pollingTimer);
        pollingTimer = null;
        currentJobId = null;
        setBusy(false);
        if (job.error) {
          statusElement.textContent = job.error.message;
          statusElement.classList.add('error');
        }
      }
    }

    recommendedPresetButton.addEventListener('click', () => {
      applyConfig(recommendedConfig);
      statusElement.classList.remove('error');
      statusElement.textContent = '已应用推荐预设。';
    });

    buildModeInput.addEventListener('change', refreshConfigUi);
    imageModeInput.addEventListener('change', refreshConfigUi);
    pngQualityInput.addEventListener('input', refreshConfigUi);
    jpegQualityInput.addEventListener('input', refreshConfigUi);
    audioEnabledInput.addEventListener('change', refreshConfigUi);
    audioBitrateInput.addEventListener('input', refreshConfigUi);
    payloadEncodingInput.addEventListener('change', refreshConfigUi);

    buildButton.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        statusElement.textContent = '请选择 ZIP 文件。';
        return;
      }
      if (!file.name.toLowerCase().endsWith('.zip')) {
        statusElement.textContent = '请选择 .zip 文件。';
        return;
      }

      let config;
      try {
        config = readConfig();
      } catch (error) {
        statusElement.textContent = error instanceof Error ? error.message : String(error);
        statusElement.classList.add('error');
        return;
      }

      currentJobId = null;
      actionsElement.style.display = 'none';
      statusElement.classList.remove('error');
      setBusy(true);
      progressElement.value = 5;
      statusElement.textContent = '正在上传 ZIP。';
      logsElement.textContent = '上传中……';

      try {
        const upload = await readJson(await fetch('/api/uploads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/zip',
            'X-Upload-Name': encodeURIComponent(file.name),
          },
          body: file,
        }));
        progressElement.value = 12;
        statusElement.textContent = '上传完成，正在创建构建任务。';

        const created = await readJson(await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId: upload.upload.uploadId, config: config }),
        }));
        currentJobId = created.job.id;
        refreshConfigUi();
        await pollJob(currentJobId);
        if (currentJobId !== null) {
          pollingTimer = setInterval(() => {
            void pollJob(currentJobId).catch((error) => {
              statusElement.textContent = error.message;
              statusElement.classList.add('error');
            });
          }, 1000);
        }
      } catch (error) {
        currentJobId = null;
        setBusy(false);
        statusElement.textContent = error instanceof Error ? error.message : String(error);
        statusElement.classList.add('error');
      }
    });

    cancelButton.addEventListener('click', async () => {
      if (currentJobId === null) return;
      cancelButton.disabled = true;
      try {
        await readJson(await fetch('/api/jobs/' + currentJobId + '/cancel', { method: 'POST' }));
        statusElement.textContent = '正在取消任务。';
      } catch (error) {
        statusElement.textContent = error instanceof Error ? error.message : String(error);
        statusElement.classList.add('error');
      }
    });

    applyConfig(defaultConfig);
  </script>
</body>
</html>`;
}
