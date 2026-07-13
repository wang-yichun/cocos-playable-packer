import { createGroupedChannelWebMvpIndexHtml } from "./web-config-grouped-channel-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";
import { MAX_LOADING_LOGO_BYTES } from "./loading-screen.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new Error(`Web UI 加载界面扩展缺少插入点：${search.slice(0, 80)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function replaceLast(source: string, search: string, replacement: string): string {
  const index = source.lastIndexOf(search);
  if (index < 0) {
    throw new Error(`Web UI 加载界面扩展缺少末尾插入点：${search.slice(0, 80)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createLoadingScreenWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  let html = createGroupedChannelWebMvpIndexHtml(versionInfo);

  html = replaceOnce(
    html,
    "    .error { color: #fca5a5; }",
    `    .loading-screen-field { grid-column: 1 / -1; }
    .loading-logo-row { align-items: flex-start; }
    .loading-logo-row input[type=file] { min-width: min(420px, 100%); }
    .loading-logo-preview { display: flex; align-items: center; gap: 14px; min-height: 92px; padding: 12px; border: 1px solid #374151; border-radius: 9px; background: #111827; }
    .loading-logo-preview[hidden] { display: none; }
    .loading-logo-preview img { width: 112px; height: 68px; object-fit: contain; border-radius: 6px; background: #171717; }
    .loading-logo-preview span { color: #cbd5e1; font-size: 13px; overflow-wrap: anywhere; }
    .error { color: #fca5a5; }`,
  );

  html = replaceOnce(
    html,
    '      <div id="channelSummary" class="summary"></div>',
    `      <div class="config-grid" style="margin-top: 18px;">
        <div class="field loading-screen-field">
          <label>Playable 加载界面</label>
          <div class="check-row">
            <input id="loadingScreenEnabled" type="checkbox">
            <label for="loadingScreenEnabled">启用 Logo 与蓝色进度条</label>
          </div>
          <small>建议在 Cocos Creator 构建时关闭“启用插屏”，避免连续出现两套启动画面。</small>
        </div>
        <div class="field loading-screen-field">
          <label for="loadingLogoFile">加载 Logo</label>
          <div class="row loading-logo-row">
            <input id="loadingLogoFile" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp">
            <button id="clearLoadingLogoButton" class="secondary" type="button" disabled>清除 Logo</button>
          </div>
          <div id="loadingLogoPreview" class="loading-logo-preview" hidden>
            <img id="loadingLogoImage" alt="加载 Logo 预览">
            <span id="loadingLogoMeta">尚未选择 Logo。</span>
          </div>
          <small>支持 PNG、JPEG、WebP，最大 ${MAX_LOADING_LOGO_BYTES} B。图片会以内嵌 Data URL 写入所有已选渠道包。</small>
        </div>
      </div>
      <div id="loadingScreenSummary" class="summary">加载界面：关闭。</div>
      <div id="channelSummary" class="summary"></div>`,
  );

  html = replaceOnce(
    html,
    "    const configSummary = document.getElementById('configSummary');",
    `    const loadingScreenEnabledInput = document.getElementById('loadingScreenEnabled');
    const loadingLogoFileInput = document.getElementById('loadingLogoFile');
    const clearLoadingLogoButton = document.getElementById('clearLoadingLogoButton');
    const loadingLogoPreview = document.getElementById('loadingLogoPreview');
    const loadingLogoImage = document.getElementById('loadingLogoImage');
    const loadingLogoMeta = document.getElementById('loadingLogoMeta');
    const loadingScreenSummary = document.getElementById('loadingScreenSummary');
    const configSummary = document.getElementById('configSummary');`,
  );

  html = replaceOnce(
    html,
    "    let busy = false;",
    `    let busy = false;
    let loadingLogoDataUrl = null;
    let loadingLogoBytes = 0;
    let loadingLogoMimeType = null;`,
  );

  html = replaceOnce(
    html,
    "    function readConfig() {",
    `    function readLoadingScreenConfig() {
      if (!loadingScreenEnabledInput.checked) {
        return { enabled: false };
      }
      if (!loadingLogoDataUrl) {
        throw new Error('启用加载界面时必须选择 Logo。');
      }
      return {
        enabled: true,
        logoDataUrl: loadingLogoDataUrl,
      };
    }

    function updateLoadingScreenUi() {
      loadingScreenEnabledInput.disabled = busy;
      loadingLogoFileInput.disabled = busy;
      clearLoadingLogoButton.disabled = busy || !loadingLogoDataUrl;
      loadingLogoPreview.hidden = !loadingLogoDataUrl;
      if (loadingLogoDataUrl) {
        loadingLogoImage.src = loadingLogoDataUrl;
        loadingLogoMeta.textContent = (loadingLogoMimeType || 'image') + ' · ' + loadingLogoBytes + ' B';
      } else {
        loadingLogoImage.removeAttribute('src');
        loadingLogoMeta.textContent = '尚未选择 Logo。';
      }
      loadingScreenSummary.textContent = loadingScreenEnabledInput.checked
        ? loadingLogoDataUrl
          ? '加载界面：启用；居中 Logo + 蓝色进度条；Logo ' + loadingLogoBytes + ' B。'
          : '加载界面：已启用，但尚未选择 Logo。'
        : '加载界面：关闭。';
    }

    function inferLoadingLogoMime(file) {
      if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp') {
        return file.type;
      }
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.png')) return 'image/png';
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
      if (lower.endsWith('.webp')) return 'image/webp';
      return null;
    }

    function bytesToBase64(bytes) {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 8192)));
      }
      return btoa(binary);
    }

    function readConfig() {`,
  );

  html = replaceOnce(
    html,
    "      fileInput.disabled = busy;",
    `      fileInput.disabled = busy;
      updateLoadingScreenUi();`,
  );

  html = replaceOnce(
    html,
    "        config = readConfig();",
    `        config = readConfig();
        config.loadingScreen = readLoadingScreenConfig();`,
  );

  html = replaceOnce(
    html,
    "    payloadEncodingInput.addEventListener('change', refreshConfigUi);",
    `    payloadEncodingInput.addEventListener('change', refreshConfigUi);
    loadingScreenEnabledInput.addEventListener('change', updateLoadingScreenUi);
    clearLoadingLogoButton.addEventListener('click', () => {
      loadingLogoDataUrl = null;
      loadingLogoBytes = 0;
      loadingLogoMimeType = null;
      loadingLogoFileInput.value = '';
      updateLoadingScreenUi();
    });
    loadingLogoFileInput.addEventListener('change', async () => {
      const file = loadingLogoFileInput.files?.[0];
      if (!file) return;
      try {
        const mimeType = inferLoadingLogoMime(file);
        if (!mimeType) {
          throw new Error('加载 Logo 只支持 PNG、JPEG 或 WebP。');
        }
        if (file.size < 1 || file.size > ${MAX_LOADING_LOGO_BYTES}) {
          throw new Error('加载 Logo 必须在 1 B 到 ${MAX_LOADING_LOGO_BYTES} B 之间。');
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        loadingLogoDataUrl = 'data:' + mimeType + ';base64,' + bytesToBase64(bytes);
        loadingLogoBytes = bytes.byteLength;
        loadingLogoMimeType = mimeType;
        loadingScreenEnabledInput.checked = true;
        statusElement.classList.remove('error');
        statusElement.textContent = '加载 Logo 已读取，将内嵌到最终渠道包。';
      } catch (error) {
        loadingLogoDataUrl = null;
        loadingLogoBytes = 0;
        loadingLogoMimeType = null;
        loadingLogoFileInput.value = '';
        statusElement.textContent = error instanceof Error ? error.message : String(error);
        statusElement.classList.add('error');
      }
      updateLoadingScreenUi();
    });`,
  );

  html = replaceLast(
    html,
    "    applyConfig({",
    `    updateLoadingScreenUi();
    applyConfig({`,
  );

  return html;
}
