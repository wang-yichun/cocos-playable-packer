import {
  CHANNEL_PLATFORMS,
  CHANNEL_PROFILES,
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
} from "../channel/channel-profile.js";
import { createWebMvpIndexHtml } from "./web-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new Error(`Web UI 渠道扩展缺少插入点：${search.slice(0, 80)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createVersionFooter(versionInfo: WebVersionInfo): string {
  const components = versionInfo.components.length === 0
    ? '<div class="version-empty">未检测到核心 npm 组件版本。</div>'
    : `<dl class="version-list">${versionInfo.components
      .map(
        (component) => `<dt>${escapeHtml(component.name)}</dt><dd>${escapeHtml(component.version)}</dd>`,
      )
      .join("")}</dl>`;
  const ffmpegVersion = versionInfo.ffmpegVersion ?? "未检测到";
  const buildDate = versionInfo.buildDate ?? "未检测到 Git 提交时间";

  return `    <footer class="app-footer">
      <div class="footer-meta">
        <span>Cocos Playable Packer v${escapeHtml(versionInfo.appVersion)}</span>
        <span aria-hidden="true">·</span>
        <span title="${escapeHtml(versionInfo.buildSha)}">Build ${escapeHtml(versionInfo.buildShortSha)}</span>
        <span aria-hidden="true">·</span>
        <span>Node.js ${escapeHtml(versionInfo.nodeVersion)}</span>
      </div>
      <div class="footer-meta footer-copyright">
        <span>© ${escapeHtml(versionInfo.copyrightYear)} ${escapeHtml(versionInfo.copyrightName)}. All rights reserved.</span>
      </div>
      <details class="version-details">
        <summary>版本与许可</summary>
        <div class="version-panel">
          <section class="version-block">
            <h3>应用与构建</h3>
            <dl class="version-list">
              <dt>应用版本</dt><dd>${escapeHtml(versionInfo.appVersion)}</dd>
              <dt>Git Commit</dt><dd class="version-mono">${escapeHtml(versionInfo.buildSha)}</dd>
              <dt>Git 提交时间</dt><dd>${escapeHtml(buildDate)}</dd>
              <dt>页面信息生成时间</dt><dd>${escapeHtml(versionInfo.generatedAt)}</dd>
            </dl>
          </section>
          <section class="version-block">
            <h3>运行环境</h3>
            <dl class="version-list">
              <dt>Node.js</dt><dd>${escapeHtml(versionInfo.nodeVersion)}</dd>
              <dt>FFmpeg</dt><dd>${escapeHtml(ffmpegVersion)}</dd>
            </dl>
          </section>
          <section class="version-block version-components">
            <h3>核心组件</h3>
            ${components}
          </section>
          <section class="version-block version-legal">
            <h3>版权与声明</h3>
            <p>© ${escapeHtml(versionInfo.copyrightYear)} ${escapeHtml(versionInfo.copyrightName)}. All rights reserved.</p>
            <p>第三方组件保留其各自版权，并遵循各自许可证。</p>
            <p>本工具为独立开发项目，与 Cocos 官方无隶属或授权关系。Cocos Creator 及相关名称归其各自权利人所有。</p>
          </section>
        </div>
      </details>
    </footer>`;
}

function createChannelCheckboxes(): string {
  return CHANNEL_PLATFORMS.map((platform) => {
    const profile = CHANNEL_PROFILES[platform];
    return `<label class="channel-option">
              <input type="checkbox" name="channelPlatform" value="${escapeHtml(platform)}" checked>
              <span><strong>${escapeHtml(profile.displayName)}</strong><small>${escapeHtml(profile.deliveryFormat)} · ${escapeHtml(profile.bridge)}</small></span>
            </label>`;
  }).join("\n");
}

export function createChannelWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  const profilesJson = JSON.stringify(CHANNEL_PROFILES);
  const platformsJson = JSON.stringify(CHANNEL_PLATFORMS);
  const testAndroidUrlJson = JSON.stringify(TEST_ANDROID_STORE_URL);
  const testIosUrlJson = JSON.stringify(TEST_IOS_STORE_URL);
  let html = createWebMvpIndexHtml();

  html = replaceOnce(
    html,
    "select, input[type=number] {",
    "select, input[type=number], input[type=url] {",
  );

  html = replaceOnce(
    html,
    "    .error { color: #fca5a5; }\n  </style>",
    `    .error { color: #fca5a5; }
    .channel-field { grid-column: 1 / -1; }
    .channel-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .channel-toolbar button { padding: 7px 11px; }
    .channel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 9px; }
    .channel-option { display: flex; gap: 9px; align-items: flex-start; padding: 10px 11px; border: 1px solid #4b5563; border-radius: 9px; background: #111827; cursor: pointer; }
    .channel-option input { margin-top: 3px; }
    .channel-option span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .channel-option small { color: #9ca3af; font-weight: 400; overflow-wrap: anywhere; }
    dialog { width: min(520px, calc(100vw - 32px)); border: 1px solid #4b5563; border-radius: 12px; padding: 20px; background: #1f2937; color: #e5e7eb; }
    dialog::backdrop { background: rgba(3, 7, 18, .72); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
    .app-footer { margin-top: 32px; padding: 22px 2px 0; border-top: 1px solid #374151; color: #9ca3af; font-size: 12px; line-height: 1.65; }
    .footer-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .footer-copyright { margin-top: 2px; }
    .version-details { margin-top: 8px; }
    .version-details summary { width: max-content; color: #cbd5e1; cursor: pointer; user-select: none; }
    .version-details summary:hover { color: #fff; }
    .version-panel { margin-top: 12px; padding: 16px; border: 1px solid #374151; border-radius: 10px; background: #0f172a; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
    .version-block h3 { margin: 0 0 8px; color: #e5e7eb; font-size: 13px; }
    .version-block p { margin: 5px 0 0; color: #9ca3af; font-size: 12px; line-height: 1.55; }
    .version-list { display: grid; grid-template-columns: minmax(90px, auto) minmax(0, 1fr); gap: 5px 12px; margin: 0; }
    .version-list dt { color: #9ca3af; }
    .version-list dd { margin: 0; color: #d1d5db; overflow-wrap: anywhere; }
    .version-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .version-empty { color: #9ca3af; }
    .version-legal { grid-column: 1 / -1; }
  </style>`,
  );

  html = replaceOnce(
    html,
    "      <div class=\"config-grid\" style=\"margin-top: 18px;\">\n        <div class=\"field\">\n          <label for=\"buildMode\">构建模式</label>",
    `      <div class="config-grid" style="margin-top: 18px;">
        <div class="field channel-field">
          <label>目标渠道（可多选）</label>
          <div class="channel-toolbar">
            <button id="selectAllChannelsButton" class="secondary" type="button">全选</button>
            <button id="previewOnlyButton" class="secondary" type="button">仅 Preview</button>
          </div>
          <div id="channelPlatformGroup" class="channel-grid">
            ${createChannelCheckboxes()}
          </div>
          <small id="channelPlatformHint">默认全选。基础资源只压缩一次，各渠道仅派生运行时桥接和最终交付容器。</small>
        </div>

        <div class="field">
          <label for="androidStoreUrl">Android 商店地址</label>
          <input id="androidStoreUrl" type="url" placeholder="https://play.google.com/store/apps/details?id=...">
          <small>所有已选渠道共用；宿主 API 不可用时回退到该地址。</small>
        </div>

        <div class="field">
          <label for="iosStoreUrl">iOS 商店地址</label>
          <input id="iosStoreUrl" type="url" placeholder="https://apps.apple.com/app/id...">
          <small>所有已选渠道共用；可以暂时留空。</small>
        </div>

        <div class="field">
          <label>测试地址</label>
          <button id="testStoreUrlsButton" class="secondary" type="button">填入 Google Maps 测试链接</button>
          <small>仅用于本地验证跳转配置，正式投放时必须替换。</small>
        </div>

        <div class="field">
          <label for="buildMode">构建模式</label>`,
  );

  html = replaceOnce(
    html,
    "      <div id=\"configSummary\" class=\"summary\"></div>",
    `      <div id="channelSummary" class="summary"></div>
      <div id="channelWarning" class="warning"></div>
      <div id="configSummary" class="summary"></div>`,
  );

  html = replaceOnce(
    html,
    "  </main>",
    `${createVersionFooter(versionInfo)}
  </main>
  <dialog id="previewChannelDialog">
    <h2>选择试玩渠道</h2>
    <p>同一份基础构建将按所选渠道注入对应桥接和启动策略。</p>
    <div class="field">
      <label for="previewChannelSelect">试玩渠道</label>
      <select id="previewChannelSelect"></select>
    </div>
    <div class="dialog-actions">
      <button id="closePreviewDialogButton" class="secondary" type="button">取消</button>
      <button id="startPreviewButton" type="button">开始试玩</button>
    </div>
  </dialog>`,
  );

  html = replaceOnce(
    html,
    "    const recommendedConfig = ",
    `    const channelProfiles = ${profilesJson};
    const channelPlatforms = ${platformsJson};
    const testAndroidStoreUrl = ${testAndroidUrlJson};
    const testIosStoreUrl = ${testIosUrlJson};
    const recommendedConfig = `,
  );

  html = replaceOnce(
    html,
    "    const recommendedPresetButton = document.getElementById('recommendedPresetButton');",
    `    const recommendedPresetButton = document.getElementById('recommendedPresetButton');
    const channelPlatformInputs = Array.from(document.querySelectorAll('input[name="channelPlatform"]'));
    const selectAllChannelsButton = document.getElementById('selectAllChannelsButton');
    const previewOnlyButton = document.getElementById('previewOnlyButton');
    const channelPlatformHint = document.getElementById('channelPlatformHint');
    const androidStoreUrlInput = document.getElementById('androidStoreUrl');
    const iosStoreUrlInput = document.getElementById('iosStoreUrl');
    const testStoreUrlsButton = document.getElementById('testStoreUrlsButton');`,
  );

  html = replaceOnce(
    html,
    "    const configSummary = document.getElementById('configSummary');",
    `    const channelSummary = document.getElementById('channelSummary');
    const channelWarning = document.getElementById('channelWarning');
    const configSummary = document.getElementById('configSummary');`,
  );

  html = replaceOnce(
    html,
    "    const reportLink = document.getElementById('reportLink');",
    `    const reportLink = document.getElementById('reportLink');
    const previewChannelDialog = document.getElementById('previewChannelDialog');
    const previewChannelSelect = document.getElementById('previewChannelSelect');
    const closePreviewDialogButton = document.getElementById('closePreviewDialogButton');
    const startPreviewButton = document.getElementById('startPreviewButton');`,
  );

  html = replaceOnce(
    html,
    "    let busy = false;",
    `    let busy = false;
    let completedPreviewUrl = null;
    let completedPlatforms = [];`,
  );

  html = replaceOnce(
    html,
    "    function readConfig() {\n      const buildMode = buildModeInput.value;",
    `    function readSelectedPlatforms(throwWhenEmpty = true) {
      const selected = channelPlatformInputs.filter((input) => input.checked).map((input) => input.value);
      if (throwWhenEmpty && selected.length === 0) {
        throw new Error('至少需要选择一个目标渠道。');
      }
      return channelPlatforms.filter((platform) => selected.includes(platform));
    }

    function applySelectedPlatforms(platforms) {
      const selected = new Set(platforms);
      for (const input of channelPlatformInputs) {
        input.checked = selected.has(input.value);
      }
    }

    function readConfig() {
      const platforms = readSelectedPlatforms();
      const channel = {
        platform: platforms[0],
        platforms: platforms,
        androidStoreUrl: androidStoreUrlInput.value.trim() || null,
        iosStoreUrl: iosStoreUrlInput.value.trim() || null,
      };
      const buildMode = buildModeInput.value;`,
  );

  html = replaceOnce(
    html,
    "          brotliFallback: 'raw-js',\n        };",
    "          brotliFallback: 'raw-js',\n          channel: channel,\n        };",
  );

  html = replaceOnce(
    html,
    "        brotliFallback: 'raw-js',\n      };",
    "        brotliFallback: 'raw-js',\n        channel: channel,\n      };",
  );

  html = replaceOnce(
    html,
    "    function applyConfig(config) {\n      buildModeInput.value = config.buildMode;",
    `    function applyConfig(config) {
      const channel = config.channel || { platform: 'Preview', platforms: channelPlatforms, androidStoreUrl: null, iosStoreUrl: null };
      const configuredPlatforms = Array.isArray(channel.platforms) && channel.platforms.length > 0
        ? channel.platforms
        : channelPlatforms;
      applySelectedPlatforms(configuredPlatforms);
      androidStoreUrlInput.value = channel.androidStoreUrl || '';
      iosStoreUrlInput.value = channel.iosStoreUrl || '';
      buildModeInput.value = config.buildMode;`,
  );

  html = replaceOnce(
    html,
    "      recommendedPresetButton.disabled = busy;",
    `      recommendedPresetButton.disabled = busy;
      for (const input of channelPlatformInputs) input.disabled = busy;
      selectAllChannelsButton.disabled = busy;
      previewOnlyButton.disabled = busy;
      androidStoreUrlInput.disabled = busy;
      iosStoreUrlInput.disabled = busy;
      testStoreUrlsButton.disabled = busy;`,
  );

  html = replaceOnce(
    html,
    "      audioWarning.hidden = rawMode || !audioEnabled;",
    `      audioWarning.hidden = rawMode || !audioEnabled;

      const selectedPlatforms = readSelectedPlatforms(false);
      const selectedProfiles = selectedPlatforms.map((platform) => channelProfiles[platform]).filter(Boolean);
      channelPlatformHint.textContent = selectedPlatforms.length === 0
        ? '至少需要选择一个渠道。'
        : '已选 ' + selectedPlatforms.length + ' 个渠道；基础资源压缩、Brotli 和 Payload 编码只执行一次。';
      channelSummary.textContent = selectedProfiles.length === 0
        ? '未选择渠道。'
        : '渠道合集：' + selectedProfiles.map((profile) => profile.displayName).join(' / ');
      const warnings = [];
      for (const profile of selectedProfiles) {
        for (const warning of profile.warnings) {
          if (!warnings.includes(warning)) warnings.push(warning);
        }
      }
      channelWarning.textContent = warnings.join(' ');
      htmlLink.textContent = '下载渠道合集 ZIP（' + selectedPlatforms.length + '）';`,
  );

  html = replaceOnce(
    html,
    "        previewLink.href = job.links.preview;",
    `        completedPreviewUrl = job.links.preview;
        completedPlatforms = Array.isArray(job.config?.channel?.platforms)
          ? job.config.channel.platforms
          : [job.config?.channel?.platform || 'Preview'];
        previewLink.href = '#';`,
  );

  html = replaceOnce(
    html,
    "        htmlLink.href = job.links.html + '?download=1';",
    `        htmlLink.href = job.links.html + '?download=1';
        htmlLink.textContent = '下载渠道合集 ZIP（' + completedPlatforms.length + '）';`,
  );

  html = replaceOnce(
    html,
    "      applyConfig(recommendedConfig);",
    `      applyConfig({
        ...recommendedConfig,
        channel: {
          platform: readSelectedPlatforms(false)[0] || 'Preview',
          platforms: readSelectedPlatforms(false).length > 0 ? readSelectedPlatforms(false) : channelPlatforms,
          androidStoreUrl: androidStoreUrlInput.value.trim() || null,
          iosStoreUrl: iosStoreUrlInput.value.trim() || null,
        },
      });`,
  );

  html = replaceOnce(
    html,
    "    recommendedPresetButton.addEventListener('click', () => {",
    `    selectAllChannelsButton.addEventListener('click', () => {
      applySelectedPlatforms(channelPlatforms);
      refreshConfigUi();
    });

    previewOnlyButton.addEventListener('click', () => {
      applySelectedPlatforms(['Preview']);
      refreshConfigUi();
    });

    testStoreUrlsButton.addEventListener('click', () => {
      androidStoreUrlInput.value = testAndroidStoreUrl;
      iosStoreUrlInput.value = testIosStoreUrl;
      statusElement.classList.remove('error');
      statusElement.textContent = '已填入 Google Maps 测试商店地址；正式投放前必须替换。';
      refreshConfigUi();
    });

    previewLink.addEventListener('click', (event) => {
      event.preventDefault();
      if (!completedPreviewUrl || completedPlatforms.length === 0) return;
      previewChannelSelect.innerHTML = '';
      for (const platform of completedPlatforms) {
        const option = document.createElement('option');
        option.value = platform;
        option.textContent = channelProfiles[platform]?.displayName || platform;
        previewChannelSelect.appendChild(option);
      }
      previewChannelDialog.showModal();
    });

    closePreviewDialogButton.addEventListener('click', () => previewChannelDialog.close());
    startPreviewButton.addEventListener('click', () => {
      if (!completedPreviewUrl) return;
      const separator = completedPreviewUrl.includes('?') ? '&' : '?';
      window.open(completedPreviewUrl + separator + 'channel=' + encodeURIComponent(previewChannelSelect.value), '_blank', 'noopener');
      previewChannelDialog.close();
    });

    recommendedPresetButton.addEventListener('click', () => {`,
  );

  html = replaceOnce(
    html,
    "    buildModeInput.addEventListener('change', refreshConfigUi);",
    `    for (const input of channelPlatformInputs) input.addEventListener('change', refreshConfigUi);
    androidStoreUrlInput.addEventListener('input', refreshConfigUi);
    iosStoreUrlInput.addEventListener('input', refreshConfigUi);
    buildModeInput.addEventListener('change', refreshConfigUi);`,
  );

  html = replaceOnce(
    html,
    "    applyConfig(defaultConfig);",
    `    applyConfig({
      ...defaultConfig,
      channel: {
        ...defaultConfig.channel,
        platform: 'Preview',
        platforms: channelPlatforms,
      },
    });`,
  );

  return html;
}
