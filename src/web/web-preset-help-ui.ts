import { createGroupedChannelWebMvpIndexHtml } from "./web-config-grouped-channel-ui.js";
import type { WebVersionInfo } from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new Error(`Web 推荐预设帮助扩展缺少插入点：${search.slice(0, 80)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createPresetHelpWebMvpIndexHtml(versionInfo: WebVersionInfo): string {
  let html = createGroupedChannelWebMvpIndexHtml(versionInfo);

  html = replaceOnce(
    html,
    "    .error { color: #fca5a5; }",
    `    .preset-actions { display: flex; align-items: center; gap: 8px; }
    .compact-help-button { width: 34px; height: 34px; padding: 0; border: 1px solid #4b5563; border-radius: 50%; background: #111827; color: #cbd5e1; font-weight: 800; line-height: 1; flex: 0 0 auto; }
    .compact-help-button:hover { border-color: #6b7280; background: #1f2937; color: #fff; }
    .channel-warning-help-button { width: 24px; height: 24px; margin-left: 8px; border-color: #a16207; color: #fbbf24; font-size: 13px; }
    .channel-warning-help-button:hover { border-color: #f59e0b; color: #fde68a; }
    .preset-help-dialog h2, .channel-warning-dialog h2 { margin-bottom: 12px; }
    .preset-help-dialog p, .channel-warning-dialog p { margin: 0; color: #cbd5e1; }
    .preset-help-dialog strong { color: #fff; }
    .error { color: #fca5a5; }`,
  );

  html = replaceOnce(
    html,
    '        <button id="recommendedPresetButton" class="secondary" type="button">应用一键推荐预设</button>',
    `        <div class="preset-actions">
          <button id="recommendedPresetHelpButton" class="compact-help-button" type="button" aria-label="查看推荐预设说明" title="查看推荐预设说明">?</button>
          <button id="recommendedPresetButton" class="secondary" type="button">应用一键推荐预设</button>
        </div>`,
  );

  html = replaceOnce(
    html,
    `      <div class="preset">
        <strong>推荐预设</strong>
        WebP 80 / 音频 48 kbps / HTML7 / Brotli raw-js。该组合已经通过真实游戏试玩验证；启用音频压缩前需确保系统可以执行 FFmpeg。
      </div>`,
    `      <dialog id="recommendedPresetHelpDialog" class="preset-help-dialog">
        <h2>推荐预设</h2>
        <p><strong>WebP 80 / 音频 48 kbps / HTML7 / Brotli raw-js</strong>。该组合已经通过真实游戏试玩验证；启用音频压缩前需确保系统可以执行 FFmpeg。</p>
        <div class="dialog-actions">
          <button id="closeRecommendedPresetHelpButton" class="secondary" type="button">关闭</button>
        </div>
      </dialog>
      <dialog id="channelWarningDialog" class="channel-warning-dialog">
        <h2>目标渠道注意事项</h2>
        <p id="channelWarningDialogText">当前所选渠道没有额外注意事项。</p>
        <div class="dialog-actions">
          <button id="closeChannelWarningButton" class="secondary" type="button">关闭</button>
        </div>
      </dialog>`,
  );

  html = replaceOnce(
    html,
    "    const recommendedPresetButton = document.getElementById('recommendedPresetButton');",
    `    const recommendedPresetButton = document.getElementById('recommendedPresetButton');
    const recommendedPresetHelpButton = document.getElementById('recommendedPresetHelpButton');
    const recommendedPresetHelpDialog = document.getElementById('recommendedPresetHelpDialog');
    const closeRecommendedPresetHelpButton = document.getElementById('closeRecommendedPresetHelpButton');
    const channelWarningDialog = document.getElementById('channelWarningDialog');
    const channelWarningDialogText = document.getElementById('channelWarningDialogText');
    const closeChannelWarningButton = document.getElementById('closeChannelWarningButton');`,
  );

  html = replaceOnce(
    html,
    "    recommendedPresetButton.addEventListener('click', () => {",
    `    recommendedPresetHelpButton.addEventListener('click', () => recommendedPresetHelpDialog.showModal());
    closeRecommendedPresetHelpButton.addEventListener('click', () => recommendedPresetHelpDialog.close());
    recommendedPresetHelpDialog.addEventListener('click', (event) => {
      if (event.target === recommendedPresetHelpDialog) recommendedPresetHelpDialog.close();
    });
    closeChannelWarningButton.addEventListener('click', () => channelWarningDialog.close());
    channelWarningDialog.addEventListener('click', (event) => {
      if (event.target === channelWarningDialog) channelWarningDialog.close();
    });

    function setupChannelWarningHelp() {
      const channelGroup = document.querySelector('.config-group[data-group="channel"]');
      const title = channelGroup?.querySelector('.config-group-title');
      if (!title || document.getElementById('channelWarningHelpButton')) return;
      const button = document.createElement('button');
      button.id = 'channelWarningHelpButton';
      button.className = 'compact-help-button channel-warning-help-button';
      button.type = 'button';
      button.textContent = '!';
      button.setAttribute('aria-label', '查看目标渠道注意事项');
      button.title = '查看目标渠道注意事项';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const warning = channelWarning?.textContent?.trim();
        channelWarningDialogText.textContent = warning || '当前所选渠道没有额外注意事项。';
        channelWarningDialog.showModal();
      });
      title.after(button);
      if (channelWarning) channelWarning.hidden = true;
    }

    recommendedPresetButton.addEventListener('click', () => {`,
  );

  html = replaceOnce(
    html,
    "    groupConfigSections();",
    `    groupConfigSections();
    setupChannelWarningHelp();`,
  );

  return html;
}
