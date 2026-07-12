import {
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

export function createChannelWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  const profilesJson = JSON.stringify(CHANNEL_PROFILES);
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
        <div class="field">
          <label for="channelPlatform">目标渠道</label>
          <select id="channelPlatform">
            <option value="Preview">Preview（本地预览）</option>
            <option value="AppLovin">AppLovin</option>
            <option value="Google">Google Ads</option>
            <option value="Facebook">Facebook</option>
            <option value="Liftoff">Liftoff</option>
            <option value="IronSource">IronSource</option>
            <option value="Unity">Unity Ads</option>
            <option value="Moloco">Moloco</option>
          </select>
          <small id="channelPlatformHint">根据渠道 Profile 生成下载桥和对应交付文件。</small>
        </div>

        <div class="field">
          <label for="androidStoreUrl">Android 商店地址</label>
          <input id="androidStoreUrl" type="url" placeholder="https://play.google.com/store/apps/details?id=...">
          <small>渠道下载桥会优先调用宿主 API，否则回退到该地址。</small>
        </div>

        <div class="field">
          <label for="iosStoreUrl">iOS 商店地址</label>
          <input id="iosStoreUrl" type="url" placeholder="https://apps.apple.com/app/id...">
          <small>可以暂时留空；未配置时会回退到另一平台地址。</small>
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
  </main>`,
  );

  html = replaceOnce(
    html,
    "    const recommendedConfig = ",
    `    const channelProfiles = ${profilesJson};
    const testAndroidStoreUrl = ${testAndroidUrlJson};
    const testIosStoreUrl = ${testIosUrlJson};
    const recommendedConfig = `,
  );

  html = replaceOnce(
    html,
    "    const recommendedPresetButton = document.getElementById('recommendedPresetButton');",
    `    const recommendedPresetButton = document.getElementById('recommendedPresetButton');
    const channelPlatformInput = document.getElementById('channelPlatform');
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
    "    function readConfig() {\n      const buildMode = buildModeInput.value;",
    `    function readConfig() {
      const channel = {
        platform: channelPlatformInput.value,
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
      const channel = config.channel || { platform: 'Preview', androidStoreUrl: null, iosStoreUrl: null };
      channelPlatformInput.value = channel.platform;
      androidStoreUrlInput.value = channel.androidStoreUrl || '';
      iosStoreUrlInput.value = channel.iosStoreUrl || '';
      buildModeInput.value = config.buildMode;`,
  );

  html = replaceOnce(
    html,
    "      recommendedPresetButton.disabled = busy;",
    `      recommendedPresetButton.disabled = busy;
      channelPlatformInput.disabled = busy;
      androidStoreUrlInput.disabled = busy;
      iosStoreUrlInput.disabled = busy;
      testStoreUrlsButton.disabled = busy;`,
  );

  html = replaceOnce(
    html,
    "      audioWarning.hidden = rawMode || !audioEnabled;",
    `      audioWarning.hidden = rawMode || !audioEnabled;

      const channelProfile = channelProfiles[channelPlatformInput.value];
      if (channelProfile) {
        channelPlatformHint.textContent = '交付格式：' + channelProfile.deliveryFormat
          + '；桥接：' + channelProfile.bridge
          + '；启动：' + channelProfile.startupPolicy + '。';
        channelSummary.textContent = '渠道 Profile：' + channelProfile.displayName
          + ' / ' + channelProfile.deliveryFormat
          + ' / ' + channelProfile.bridge
          + ' / 必需全局对象：'
          + (channelProfile.requiredGlobals.length === 0 ? '无' : channelProfile.requiredGlobals.join(', '));
        channelWarning.textContent = channelProfile.warnings.join(' ');
        htmlLink.textContent = channelProfile.deliveryFormat === 'single-html'
          ? '下载 HTML'
          : '下载渠道 ZIP';
      }`,
  );

  html = replaceOnce(
    html,
    "        htmlLink.href = job.links.html + '?download=1';",
    `        htmlLink.href = job.links.html + '?download=1';
        const completedPlatform = job.config?.channel?.platform;
        htmlLink.textContent = completedPlatform === 'Liftoff'
          ? '下载 Liftoff ZIP'
          : completedPlatform === 'Facebook'
            ? '下载 Facebook ZIP'
            : '下载 HTML';`,
  );

  html = replaceOnce(
    html,
    "      applyConfig(recommendedConfig);",
    `      applyConfig({
        ...recommendedConfig,
        channel: {
          platform: channelPlatformInput.value,
          androidStoreUrl: androidStoreUrlInput.value.trim() || null,
          iosStoreUrl: iosStoreUrlInput.value.trim() || null,
        },
      });`,
  );

  html = replaceOnce(
    html,
    "    recommendedPresetButton.addEventListener('click', () => {",
    `    testStoreUrlsButton.addEventListener('click', () => {
      androidStoreUrlInput.value = testAndroidStoreUrl;
      iosStoreUrlInput.value = testIosStoreUrl;
      statusElement.classList.remove('error');
      statusElement.textContent = '已填入 Google Maps 测试商店地址；正式投放前必须替换。';
      refreshConfigUi();
    });

    recommendedPresetButton.addEventListener('click', () => {`,
  );

  html = replaceOnce(
    html,
    "    buildModeInput.addEventListener('change', refreshConfigUi);",
    `    channelPlatformInput.addEventListener('change', refreshConfigUi);
    androidStoreUrlInput.addEventListener('input', refreshConfigUi);
    iosStoreUrlInput.addEventListener('input', refreshConfigUi);
    buildModeInput.addEventListener('change', refreshConfigUi);`,
  );

  return html;
}
