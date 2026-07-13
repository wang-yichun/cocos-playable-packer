import { createChannelWebMvpIndexHtml } from "./web-channel-ui.js";
import type { WebVersionInfo } from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new Error(`Web 配置分组扩展缺少插入点：${search.slice(0, 80)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createGroupedChannelWebMvpIndexHtml(versionInfo: WebVersionInfo): string {
  let html = createChannelWebMvpIndexHtml(versionInfo);

  html = replaceOnce(
    html,
    "select, input[type=number], input[type=url] {",
    "select, input[type=number], input[type=url], input[type=password] {",
  );

  html = replaceOnce(
    html,
    "    .error { color: #fca5a5; }",
    `    .config-groups { display: grid; gap: 12px; margin-top: 18px; }
    .config-group { border: 1px solid #374151; border-radius: 11px; background: #111827; overflow: hidden; }
    .config-group > summary { display: flex; align-items: center; gap: 12px; padding: 14px 16px; cursor: pointer; color: #e5e7eb; user-select: none; }
    .config-group-title { flex: 0 0 auto; font-weight: 700; }
    .config-group-state { min-width: 0; margin-left: auto; color: #9ca3af; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
    .config-group > summary:hover { background: #172033; }
    .config-group[open] > summary { border-bottom: 1px solid #374151; }
    .config-group[open] .config-group-state { color: #cbd5e1; }
    .config-group-body { padding: 16px; }
    .config-group-body .config-grid { margin-top: 0 !important; }
    .tinypng-field[hidden] { display: none; }
    .secret-note { color: #fbbf24; }
    .error { color: #fca5a5; }
    @media (max-width: 700px) {
      .config-group > summary { align-items: flex-start; flex-wrap: wrap; }
      .config-group-state { width: 100%; margin-left: 0; padding-left: 20px; white-space: normal; text-align: left; }
    }`,
  );

  html = replaceOnce(
    html,
    '<option value="squoosh">Squoosh</option>',
    '<option value="squoosh">Squoosh</option>\n            <option value="tinypng">TinyPNG API</option>',
  );

  html = replaceOnce(
    html,
    '      <div id="channelSummary" class="summary"></div>',
    `      <div class="config-grid" style="margin-top: 18px;">
        <div id="tinyPngApiKeyField" class="field tinypng-field" hidden>
          <label for="tinyPngApiKey">TinyPNG API Key</label>
          <input id="tinyPngApiKey" type="password" autocomplete="off" placeholder="请填写客户自己的 TINYPNG_API_KEY">
          <small class="secret-note">仅用于本次构建，不写入任务状态、报告或浏览器本地存储。</small>
        </div>
        <div id="tinyPngScopeField" class="field tinypng-field" hidden>
          <label for="tinyPngScope">TinyPNG 处理范围</label>
          <select id="tinyPngScope">
            <option value="all">处理全部符合条件的图片</option>
            <option value="limit">最多处理指定数量</option>
          </select>
          <small>选择限制模式可以控制单次 API 调用数量。</small>
        </div>
        <div id="tinyPngLimitField" class="field tinypng-field" hidden>
          <label for="tinyPngLimit">最多处理数量</label>
          <input id="tinyPngLimit" type="number" min="1" max="10000" step="1" value="50">
          <small>仅在“最多处理指定数量”时生效。</small>
        </div>
        <div id="tinyPngMinBytesField" class="field tinypng-field" hidden>
          <label for="tinyPngMinBytes">最小图片大小（B）</label>
          <input id="tinyPngMinBytes" type="number" min="0" max="1073741824" step="1" value="4096">
          <small>默认 4 KB；小于该大小的图片不调用 TinyPNG API。</small>
        </div>
      </div>
      <div id="channelSummary" class="summary"></div>`,
  );

  html = replaceOnce(
    html,
    "    const imageModeHint = document.getElementById('imageModeHint');",
    `    const imageModeHint = document.getElementById('imageModeHint');
    const tinyPngApiKeyField = document.getElementById('tinyPngApiKeyField');
    const tinyPngScopeField = document.getElementById('tinyPngScopeField');
    const tinyPngLimitField = document.getElementById('tinyPngLimitField');
    const tinyPngMinBytesField = document.getElementById('tinyPngMinBytesField');
    const tinyPngApiKeyInput = document.getElementById('tinyPngApiKey');
    const tinyPngScopeInput = document.getElementById('tinyPngScope');
    const tinyPngLimitInput = document.getElementById('tinyPngLimit');
    const tinyPngMinBytesInput = document.getElementById('tinyPngMinBytes');`,
  );

  html = replaceOnce(
    html,
    "    let busy = false;",
    `    const persistedConfigStorageKey = 'cocos-playable-packer.web-config.v1';
    let configPersistenceReady = false;
    let busy = false;`,
  );

  html = replaceOnce(
    html,
    "      const audioBitrateKbps = audioEnabledInput.checked",
    `      const tinyPngApiKey = imageMode === 'tinypng' ? tinyPngApiKeyInput.value.trim() : null;
      if (imageMode === 'tinypng' && !tinyPngApiKey) {
        throw new Error('TinyPNG 模式必须填写 TINYPNG_API_KEY。');
      }
      const tinyPngScope = tinyPngScopeInput.value;
      const tinyPngLimit = imageMode === 'tinypng' && tinyPngScope === 'limit'
        ? parseInteger(tinyPngLimitInput, 'TinyPNG 最多处理数量', 1, 10000)
        : null;
      const tinyPngMinBytes = imageMode === 'tinypng'
        ? parseInteger(tinyPngMinBytesInput, 'TinyPNG 最小图片大小', 0, 1073741824)
        : null;
      const audioBitrateKbps = audioEnabledInput.checked`,
  );

  html = replaceOnce(
    html,
    "        imageMode: imageMode,\n        pngQuality: pngQuality,",
    `        imageMode: imageMode,
        tinyPngApiKey: tinyPngApiKey,
        tinyPngScope: tinyPngScope,
        tinyPngLimit: tinyPngLimit,
        tinyPngMinBytes: tinyPngMinBytes,
        pngQuality: pngQuality,`,
  );

  html = replaceOnce(
    html,
    "      imageModeInput.value = config.imageMode;",
    `      imageModeInput.value = config.imageMode;
      tinyPngApiKeyInput.value = '';
      tinyPngScopeInput.value = config.tinyPngScope || 'all';
      tinyPngLimitInput.value = String(config.tinyPngLimit || 50);
      tinyPngMinBytesInput.value = String(config.tinyPngMinBytes ?? 4096);`,
  );

  html = replaceOnce(
    html,
    "      const imagesDisabled = busy || rawMode || imageMode === 'none';",
    `      const imagesDisabled = busy || rawMode || imageMode === 'none' || imageMode === 'tinypng';
      const tinyPngMode = !rawMode && imageMode === 'tinypng';
      tinyPngApiKeyField.hidden = !tinyPngMode;
      tinyPngScopeField.hidden = !tinyPngMode;
      tinyPngLimitField.hidden = !tinyPngMode;
      tinyPngMinBytesField.hidden = !tinyPngMode;
      tinyPngApiKeyInput.disabled = busy || !tinyPngMode;
      tinyPngScopeInput.disabled = busy || !tinyPngMode;
      tinyPngLimitInput.disabled = busy || !tinyPngMode || tinyPngScopeInput.value !== 'limit';
      tinyPngMinBytesInput.disabled = busy || !tinyPngMode;`,
  );

  html = replaceOnce(
    html,
    "      } else if (imageMode === 'squoosh') {",
    `      } else if (imageMode === 'tinypng') {
        imageModeHint.textContent = '调用 TinyPNG API 压缩 PNG/JPEG；需要填写客户自己的 API Key。';
      } else if (imageMode === 'squoosh') {`,
  );

  html = replaceOnce(
    html,
    "      audioWarning.hidden = rawMode || !audioEnabled;",
    `      audioWarning.hidden = rawMode || !audioEnabled;
      updateConfigGroupSummaries();
      persistCurrentConfig();`,
  );

  html = replaceOnce(
    html,
    "    payloadEncodingInput.addEventListener('change', refreshConfigUi);",
    `    payloadEncodingInput.addEventListener('change', refreshConfigUi);
    tinyPngScopeInput.addEventListener('change', refreshConfigUi);
    tinyPngApiKeyInput.addEventListener('input', refreshConfigUi);`,
  );

  const channelDefaultInitialization = `    applyConfig({
      ...defaultConfig,
      channel: {
        ...defaultConfig.channel,
        platform: 'Preview',
        platforms: channelPlatforms,
      },
    });`;

  html = replaceOnce(
    html,
    channelDefaultInitialization,
    `    function createConfigGroup(title, key, elements) {
      const details = document.createElement('details');
      details.className = 'config-group';
      details.dataset.group = key;
      details.open = false;
      const summary = document.createElement('summary');
      const titleElement = document.createElement('span');
      titleElement.className = 'config-group-title';
      titleElement.textContent = title;
      const stateElement = document.createElement('span');
      stateElement.className = 'config-group-state';
      stateElement.id = 'configGroupState-' + key;
      stateElement.textContent = '读取中…';
      summary.append(titleElement, stateElement);
      const body = document.createElement('div');
      body.className = 'config-group-body';
      const grid = document.createElement('div');
      grid.className = 'config-grid';
      for (const element of elements) {
        if (element) grid.appendChild(element);
      }
      body.appendChild(grid);
      details.append(summary, body);
      return details;
    }

    function abbreviateConfigUrl(value) {
      const text = String(value || '').trim();
      if (!text) return '未配置';
      if (text.length <= 34) return text;
      try {
        const parsed = new URL(text);
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const tailSource = pathParts[pathParts.length - 1] || parsed.search.replace(/^\\?/, '') || '';
        const tail = tailSource.length > 14 ? tailSource.slice(-14) : tailSource;
        const host = parsed.hostname.length > 18 ? parsed.hostname.slice(0, 18) : parsed.hostname;
        return parsed.protocol + '//' + host + '…' + tail;
      } catch {
        return text.slice(0, 18) + '…' + text.slice(-12);
      }
    }

    function setConfigGroupState(key, value) {
      const element = document.getElementById('configGroupState-' + key);
      if (element) element.textContent = value;
    }

    function createPersistedConfigSnapshot() {
      const selectedPlatforms = readSelectedPlatforms(false);
      const pngQuality = Number(pngQualityInput.value);
      const jpegQuality = Number(jpegQualityInput.value);
      const tinyPngLimit = Number(tinyPngLimitInput.value);
      const tinyPngMinBytes = Number(tinyPngMinBytesInput.value);
      const audioBitrate = Number(audioBitrateInput.value);
      return {
        schemaVersion: 1,
        buildMode: buildModeInput.value,
        imageMode: imageModeInput.value,
        pngQuality: Number.isFinite(pngQuality) ? pngQuality : 80,
        jpegQuality: Number.isFinite(jpegQuality) ? jpegQuality : 80,
        tinyPngScope: tinyPngScopeInput.value,
        tinyPngLimit: Number.isFinite(tinyPngLimit) ? tinyPngLimit : 50,
        tinyPngMinBytes: Number.isFinite(tinyPngMinBytes) ? tinyPngMinBytes : 4096,
        audioBitrateKbps: audioEnabledInput.checked && Number.isFinite(audioBitrate) ? audioBitrate : null,
        payloadEncoding: payloadEncodingInput.value,
        brotliFallback: 'raw-js',
        loadingScreenEnabled: loadingScreenEnabledInput.checked,
        channel: {
          platform: selectedPlatforms[0] || 'Preview',
          platforms: selectedPlatforms.length > 0 ? selectedPlatforms : channelPlatforms,
          androidStoreUrl: androidStoreUrlInput.value.trim() || null,
          iosStoreUrl: iosStoreUrlInput.value.trim() || null,
        },
      };
    }

    function persistCurrentConfig() {
      if (!configPersistenceReady) return;
      try {
        localStorage.setItem(persistedConfigStorageKey, JSON.stringify(createPersistedConfigSnapshot()));
      } catch {
        // 浏览器禁用 localStorage 或存储空间不足时，不影响构建功能。
      }
    }

    function loadPersistedConfig() {
      try {
        const source = localStorage.getItem(persistedConfigStorageKey);
        if (!source) return null;
        const parsed = JSON.parse(source);
        if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1) return null;
        return parsed;
      } catch {
        return null;
      }
    }

    function updateConfigGroupSummaries() {
      const rawMode = buildModeInput.value === 'raw-single-html';
      const imageMode = imageModeInput.value;
      const selectedPlatforms = readSelectedPlatforms(false);
      const platformNames = selectedPlatforms.map((platform) => channelProfiles[platform]?.displayName || platform);

      setConfigGroupState('build', rawMode ? '仅合并单 HTML' : '优化并压缩');

      let imageState = '不处理';
      if (!rawMode && imageMode === 'webp') {
        imageState = 'WebP · PNG ' + pngQualityInput.value + ' · JPEG ' + jpegQualityInput.value;
      } else if (!rawMode && imageMode === 'squoosh') {
        imageState = 'Squoosh · PNG ' + pngQualityInput.value + ' · JPEG ' + jpegQualityInput.value;
      } else if (!rawMode && imageMode === 'tinypng') {
        const scope = tinyPngScopeInput.value === 'limit'
          ? '最多 ' + tinyPngLimitInput.value + ' 张'
          : '全部符合条件图片';
        const keyState = tinyPngApiKeyInput.value.trim() ? 'Key 已填写' : 'Key 未填写';
        imageState = 'TinyPNG · ' + scope + ' · ≥ ' + tinyPngMinBytesInput.value + ' B · ' + keyState;
      }
      setConfigGroupState('image', imageState);

      const audioState = rawMode || !audioEnabledInput.checked
        ? '不处理'
        : 'MP3 · ' + audioBitrateInput.value + ' kbps';
      setConfigGroupState('audio', audioState);

      setConfigGroupState(
        'payload',
        rawMode ? '不使用 Brotli / Payload' : payloadEncodingInput.value.toUpperCase() + ' · Brotli raw-js',
      );

      setConfigGroupState(
        'channel',
        platformNames.length === 0 ? '未选择渠道' : platformNames.join(' / '),
      );

      const androidUrl = abbreviateConfigUrl(androidStoreUrlInput.value);
      const iosUrl = abbreviateConfigUrl(iosStoreUrlInput.value);
      setConfigGroupState('links', 'Android: ' + androidUrl + ' · iOS: ' + iosUrl);

      let loadingState = '关闭';
      if (loadingScreenEnabledInput.checked) {
        loadingState = loadingLogoDataUrl
          ? '启用 · Logo ' + loadingLogoBytes + ' B'
          : '启用 · 尚未选择 Logo';
      }
      setConfigGroupState('loading', loadingState);
    }

    function groupConfigSections() {
      const configCard = recommendedPresetButton.closest('.card');
      if (!configCard || configCard.querySelector('.config-groups')) return;
      const field = (id) => document.getElementById(id)?.closest('.field') || null;
      const groups = document.createElement('div');
      groups.className = 'config-groups';
      groups.append(
        createConfigGroup('基础构建', 'build', [field('buildMode')]),
        createConfigGroup('图片压缩', 'image', [field('imageMode'), field('pngQuality'), field('jpegQuality'), tinyPngApiKeyField, tinyPngScopeField, tinyPngLimitField, tinyPngMinBytesField]),
        createConfigGroup('音频压缩', 'audio', [field('audioEnabled'), field('audioBitrate')]),
        createConfigGroup('Payload 与兼容性', 'payload', [field('payloadEncoding')]),
        createConfigGroup('目标渠道', 'channel', [document.getElementById('channelPlatformGroup')?.closest('.field') || null]),
        createConfigGroup('跳转地址', 'links', [field('androidStoreUrl'), field('iosStoreUrl'), document.getElementById('testStoreUrlsButton')?.closest('.field') || null]),
        createConfigGroup('加载界面', 'loading', [document.getElementById('loadingScreenEnabled')?.closest('.field') || null, document.getElementById('loadingLogoFile')?.closest('.field') || null]),
      );
      const firstGrid = configCard.querySelector('.config-grid');
      if (firstGrid) firstGrid.before(groups);
      for (const grid of Array.from(configCard.querySelectorAll(':scope > .config-grid'))) {
        if (grid.children.length === 0) grid.remove();
      }
      for (const id of ['configSummary', 'channelSummary', 'loadingScreenSummary']) {
        const element = document.getElementById(id);
        if (element) element.hidden = true;
      }
      updateConfigGroupSummaries();
    }

    groupConfigSections();
    const persistedConfig = loadPersistedConfig();
    const initialConfig = persistedConfig || {
      ...recommendedConfig,
      channel: {
        ...recommendedConfig.channel,
        platform: 'Preview',
        platforms: channelPlatforms,
      },
    };
    applyConfig(initialConfig);
    loadingScreenEnabledInput.checked = persistedConfig?.loadingScreenEnabled === true;
    configPersistenceReady = true;
    refreshConfigUi();
    updateLoadingScreenUi();`,
  );

  return html;
}
