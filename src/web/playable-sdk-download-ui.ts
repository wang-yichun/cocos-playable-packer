import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGroupedChannelWebMvpIndexHtml } from "./web-config-grouped-channel-ui.js";
import type { WebVersionInfo } from "./web-version-info.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new Error(`Playable SDK 下载 UI 缺少插入点：${search.slice(0, 100)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function readSdkSource(fileName: string): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDirectory, "../sdk", fileName),
    path.resolve(process.cwd(), "src/sdk", fileName),
  ];

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // 尝试下一个源码位置。
    }
  }

  throw new Error(`无法读取 Playable SDK 下载源文件：${fileName}`);
}

function createDownloadSources(): Record<string, string> {
  const importPattern = /\.\/playable-sdk-types\.js/g;
  return {
    "PlayableSDK.ts": readSdkSource("playable-sdk.ts")
      .replace(importPattern, "./PlayableSDKTypes"),
    "PlayableSDKTypes.ts": readSdkSource("playable-sdk-types.ts"),
    "PlayableSDKGlobal.d.ts": readSdkSource("playable-runtime-global.d.ts")
      .replace(importPattern, "./PlayableSDKTypes"),
  };
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function createPlayableSdkDownloadWebMvpIndexHtml(
  versionInfo: WebVersionInfo,
): string {
  let html = createGroupedChannelWebMvpIndexHtml(versionInfo);
  const sources = safeScriptJson(createDownloadSources());

  html = replaceOnce(
    html,
    "    .error { color: #fca5a5; }",
    `    .playable-sdk-download-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .playable-sdk-download-actions button { width: auto; }
    .playable-sdk-download-note { color: #9ca3af; line-height: 1.55; }
    .error { color: #fca5a5; }`,
  );

  html = replaceOnce(
    html,
    '      <div id="channelSummary" class="summary"></div>',
    `      <div id="playableSdkDownloadField" class="field">
        <label>游戏侧 Playable SDK</label>
        <div class="playable-sdk-download-actions">
          <button id="downloadPlayableSdkButton" class="secondary" type="button">下载 PlayableSDK.ts</button>
          <button id="downloadPlayableSdkTypesButton" class="secondary" type="button">下载 PlayableSDKTypes.ts</button>
          <button id="downloadPlayableSdkGlobalButton" class="secondary" type="button">下载 PlayableSDKGlobal.d.ts</button>
        </div>
        <small class="playable-sdk-download-note">把三个文件放在 Cocos 项目的同一脚本目录。游戏逻辑通常只导入 PlayableSDK.ts；类型文件和全局声明用于提供字符串枚举、运行时契约与 Window 类型。</small>
      </div>
      <div id="channelSummary" class="summary"></div>`,
  );

  html = replaceOnce(
    html,
    "    const configSummary = document.getElementById('configSummary');",
    `    const playableSdkDownloadFiles = ${sources};
    const downloadPlayableSdkButton = document.getElementById('downloadPlayableSdkButton');
    const downloadPlayableSdkTypesButton = document.getElementById('downloadPlayableSdkTypesButton');
    const downloadPlayableSdkGlobalButton = document.getElementById('downloadPlayableSdkGlobalButton');
    const configSummary = document.getElementById('configSummary');`,
  );

  html = replaceOnce(
    html,
    "    function readConfig() {",
    `    function downloadPlayableSdkFile(fileName) {
      const source = playableSdkDownloadFiles[fileName];
      if (typeof source !== 'string') {
        throw new Error('没有找到 Playable SDK 下载内容：' + fileName);
      }
      const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function readConfig() {`,
  );

  html = replaceOnce(
    html,
    "    payloadEncodingInput.addEventListener('change', refreshConfigUi);",
    `    downloadPlayableSdkButton.addEventListener('click', () => downloadPlayableSdkFile('PlayableSDK.ts'));
    downloadPlayableSdkTypesButton.addEventListener('click', () => downloadPlayableSdkFile('PlayableSDKTypes.ts'));
    downloadPlayableSdkGlobalButton.addEventListener('click', () => downloadPlayableSdkFile('PlayableSDKGlobal.d.ts'));
    payloadEncodingInput.addEventListener('change', refreshConfigUi);`,
  );

  html = replaceOnce(
    html,
    "        createConfigGroup('目标渠道', 'channel', [document.getElementById('channelPlatformGroup')?.closest('.field') || null]),",
    "        createConfigGroup('目标渠道', 'channel', [document.getElementById('channelPlatformGroup')?.closest('.field') || null, document.getElementById('playableSdkDownloadField')]),",
  );

  return html;
}
