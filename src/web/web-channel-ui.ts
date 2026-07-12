import {
  CHANNEL_PROFILES,
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
} from "../channel/channel-profile.js";
import { createWebMvpIndexHtml } from "./web-ui.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new Error(`Web UI 渠道扩展缺少插入点：${search.slice(0, 80)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createChannelWebMvpIndexHtml(): string {
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
          <small id="channelPlatformHint">本轮只记录渠道 Profile，不改变最终产物格式。</small>
        </div>

        <div class="field">
          <label for="androidStoreUrl">Android 商店地址</label>
          <input id="androidStoreUrl" type="url" placeholder="https://play.google.com/store/apps/details?id=...">
          <small>后续渠道桥会把下载按钮跳转到该地址。</small>
        </div>

        <div class="field">
          <label for="iosStoreUrl">iOS 商店地址</label>
          <input id="iosStoreUrl" type="url" placeholder="https://apps.apple.com/app/id...">
          <small>可以暂时留空；本轮只写入渠道报告。</small>
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
      }`,
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
