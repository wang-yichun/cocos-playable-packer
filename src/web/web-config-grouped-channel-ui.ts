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
    .config-group > summary { padding: 14px 16px; cursor: pointer; font-weight: 700; color: #e5e7eb; user-select: none; }
    .config-group > summary:hover { background: #172033; }
    .config-group[open] > summary { border-bottom: 1px solid #374151; }
    .config-group-body { padding: 16px; }
    .config-group-body .config-grid { margin-top: 0 !important; }
    .tinypng-field[hidden] { display: none; }
    .secret-note { color: #fbbf24; }
    .error { color: #fca5a5; }`,
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
          <input id="tinyPngMinBytes" type="number" min="0" max="1073741824" step="1" value="1024">
          <small>小于该大小的图片不调用 TinyPNG API。</small>
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
    "      const audioBitrateKbps = audioEnabledInput.checked",
    `      const tinyPngApiKey = imageMode === 'tinypng' ? tinyPngApiKeyInput.value.trim() : null;
      if (imageMode === 'tinypng' && !tinyPngApiKey) {
        throw new Error('TinyPNG 模式必须填写 TINYPNG_API_KEY。');
      }
      const tinyPngScope = tinyPngScopeInput.value;
      const tinyPngLimit = tinyPngScope === 'limit'
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
      tinyPngMinBytesInput.value = String(config.tinyPngMinBytes ?? 1024);`,
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
    "    payloadEncodingInput.addEventListener('change', refreshConfigUi);",
    `    payloadEncodingInput.addEventListener('change', refreshConfigUi);
    tinyPngScopeInput.addEventListener('change', refreshConfigUi);
    tinyPngApiKeyInput.addEventListener('input', refreshConfigUi);`,
  );

  html = replaceOnce(
    html,
    "    applyConfig({",
    `    function createConfigGroup(title, open, elements) {
      const details = document.createElement('details');
      details.className = 'config-group';
      details.open = open;
      const summary = document.createElement('summary');
      summary.textContent = title;
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

    function groupConfigSections() {
      const configCard = recommendedPresetButton.closest('.card');
      if (!configCard || configCard.querySelector('.config-groups')) return;
      const field = (id) => document.getElementById(id)?.closest('.field') || null;
      const groups = document.createElement('div');
      groups.className = 'config-groups';
      groups.append(
        createConfigGroup('基础构建', true, [field('buildMode')]),
        createConfigGroup('图片压缩', true, [field('imageMode'), field('pngQuality'), field('jpegQuality'), tinyPngApiKeyField, tinyPngScopeField, tinyPngLimitField, tinyPngMinBytesField]),
        createConfigGroup('音频压缩', false, [field('audioEnabled'), field('audioBitrate')]),
        createConfigGroup('Payload 与兼容性', false, [field('payloadEncoding')]),
        createConfigGroup('目标渠道', true, [document.getElementById('channelPlatformGroup')?.closest('.field') || null]),
        createConfigGroup('跳转地址', false, [field('androidStoreUrl'), field('iosStoreUrl'), document.getElementById('testStoreUrlsButton')?.closest('.field') || null]),
        createConfigGroup('加载界面', false, [document.getElementById('loadingScreenEnabled')?.closest('.field') || null, document.getElementById('loadingLogoFile')?.closest('.field') || null]),
      );
      const firstGrid = configCard.querySelector('.config-grid');
      if (firstGrid) firstGrid.before(groups);
      for (const grid of Array.from(configCard.querySelectorAll(':scope > .config-grid'))) {
        if (grid.children.length === 0) grid.remove();
      }
    }

    queueMicrotask(groupConfigSections);
    applyConfig({`,
  );

  return html;
}
