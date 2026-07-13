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
    .preset-help-button { width: 34px; height: 34px; padding: 0; border: 1px solid #4b5563; border-radius: 50%; background: #111827; color: #cbd5e1; font-weight: 800; line-height: 1; }
    .preset-help-button:hover { border-color: #6b7280; background: #1f2937; color: #fff; }
    .preset-help-dialog h2 { margin-bottom: 12px; }
    .preset-help-dialog p { margin: 0; color: #cbd5e1; }
    .preset-help-dialog strong { color: #fff; }
    .error { color: #fca5a5; }`,
  );

  html = replaceOnce(
    html,
    '        <button id="recommendedPresetButton" class="secondary" type="button">应用一键推荐预设</button>',
    `        <div class="preset-actions">
          <button id="recommendedPresetButton" class="secondary" type="button">应用一键推荐预设</button>
          <button id="recommendedPresetHelpButton" class="preset-help-button" type="button" aria-label="查看推荐预设说明" title="查看推荐预设说明">?</button>
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
      </dialog>`,
  );

  html = replaceOnce(
    html,
    "    const recommendedPresetButton = document.getElementById('recommendedPresetButton');",
    `    const recommendedPresetButton = document.getElementById('recommendedPresetButton');
    const recommendedPresetHelpButton = document.getElementById('recommendedPresetHelpButton');
    const recommendedPresetHelpDialog = document.getElementById('recommendedPresetHelpDialog');
    const closeRecommendedPresetHelpButton = document.getElementById('closeRecommendedPresetHelpButton');`,
  );

  html = replaceOnce(
    html,
    "    recommendedPresetButton.addEventListener('click', () => {",
    `    recommendedPresetHelpButton.addEventListener('click', () => recommendedPresetHelpDialog.showModal());
    closeRecommendedPresetHelpButton.addEventListener('click', () => recommendedPresetHelpDialog.close());
    recommendedPresetHelpDialog.addEventListener('click', (event) => {
      if (event.target === recommendedPresetHelpDialog) recommendedPresetHelpDialog.close();
    });

    recommendedPresetButton.addEventListener('click', () => {`,
  );

  return html;
}
