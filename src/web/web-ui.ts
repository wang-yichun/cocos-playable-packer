export function createWebMvpIndexHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cocos Playable Packer</title>
  <style>
    :root { font-family: Inter, "Segoe UI", sans-serif; color-scheme: light dark; }
    body { margin: 0; background: #111827; color: #e5e7eb; }
    main { max-width: 860px; margin: 0 auto; padding: 48px 24px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    p { color: #9ca3af; line-height: 1.6; }
    .card { margin-top: 24px; padding: 24px; border: 1px solid #374151; border-radius: 14px; background: #1f2937; }
    .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    input[type=file] { flex: 1; min-width: 260px; }
    button, a.action { border: 0; border-radius: 8px; padding: 10px 16px; font: inherit; cursor: pointer; text-decoration: none; }
    button { background: #2563eb; color: #fff; }
    button[disabled] { opacity: .55; cursor: not-allowed; }
    a.action { display: inline-block; background: #374151; color: #fff; }
    .preset { margin-top: 16px; padding: 12px 14px; border-radius: 8px; background: #111827; font-size: 14px; color: #cbd5e1; }
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
    <p>上传 Cocos Creator 的 <code>web-mobile.zip</code>，服务器将生成单文件 Playable HTML。</p>
    <section class="card">
      <div class="row">
        <input id="zipFile" type="file" accept=".zip,application/zip">
        <button id="buildButton" type="button">上传并构建</button>
        <button id="cancelButton" type="button" disabled>取消任务</button>
      </div>
      <div class="preset">当前默认方案：WebP 80 / 音频 48 kbps / HTML7 / Brotli raw-js。后续配置面板将复用同一任务 API。</div>
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
    const fileInput = document.getElementById('zipFile');
    const buildButton = document.getElementById('buildButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusElement = document.getElementById('status');
    const progressElement = document.getElementById('progress');
    const logsElement = document.getElementById('logs');
    const actionsElement = document.getElementById('actions');
    const previewLink = document.getElementById('previewLink');
    const htmlLink = document.getElementById('htmlLink');
    const reportLink = document.getElementById('reportLink');

    let currentJobId = null;
    let pollingTimer = null;

    function setBusy(busy) {
      buildButton.disabled = busy;
      fileInput.disabled = busy;
      cancelButton.disabled = !busy || currentJobId === null;
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
      logsElement.textContent = job.recentLogs.length === 0 ? '暂无日志。' : job.recentLogs.join('\n');
      logsElement.scrollTop = logsElement.scrollHeight;

      if (job.status === 'succeeded') {
        clearInterval(pollingTimer);
        pollingTimer = null;
        setBusy(false);
        cancelButton.disabled = true;
        actionsElement.style.display = 'flex';
        previewLink.href = job.links.preview;
        htmlLink.href = job.links.html + '?download=1';
        reportLink.href = job.links.report + '?download=1';
        return;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        clearInterval(pollingTimer);
        pollingTimer = null;
        setBusy(false);
        cancelButton.disabled = true;
        if (job.error) {
          statusElement.textContent = job.error.message;
          statusElement.classList.add('error');
        }
      }
    }

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
          body: JSON.stringify({ uploadId: upload.upload.uploadId }),
        }));
        currentJobId = created.job.id;
        cancelButton.disabled = false;
        await pollJob(currentJobId);
        pollingTimer = setInterval(() => {
          void pollJob(currentJobId).catch((error) => {
            statusElement.textContent = error.message;
            statusElement.classList.add('error');
          });
        }, 1000);
      } catch (error) {
        setBusy(false);
        cancelButton.disabled = true;
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
  </script>
</body>
</html>`;
}
