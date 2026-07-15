export const PANGLE_PLAYABLE_SDK_URL =
  "https://sf-tb-sg.ibytedtos.com/obj/ttfe-malisg/playable/sdk/index.b5662ec443f458c8a87e.js";
export const TIKTOK_PLAYABLE_SDK_URL =
  "https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js";

export const BYTEDANCE_PLAYABLE_SDK_MARKER =
  "data-cocos-playable-bytedance-sdk";
export const BYTEDANCE_PLAYABLE_BRIDGE_MARKER =
  "data-cocos-playable-bytedance-bridge";

const BYTEDANCE_SNAPSHOT_GLOBAL =
  "__COCOS_PLAYABLE_BYTE_DANCE_SNAPSHOT__";

export type ByteDanceChannelPlatform = "Pangle" | "TikTok";

export function isByteDanceChannel(
  platform: string,
): platform is ByteDanceChannelPlatform {
  return platform === "Pangle" || platform === "TikTok";
}

export function getByteDancePlayableSdkUrl(
  platform: ByteDanceChannelPlatform,
): string {
  return platform === "Pangle"
    ? PANGLE_PLAYABLE_SDK_URL
    : TIKTOK_PLAYABLE_SDK_URL;
}

function injectBeforeHeadClose(
  html: string,
  source: string,
): string {
  const headClose = /<\/head\s*>/i.exec(html);
  if (headClose !== null && headClose.index !== undefined) {
    return `${html.slice(0, headClose.index)}${source}\n${html.slice(headClose.index)}`;
  }
  return `${source}\n${html}`;
}

function createCaptureSource(): string {
  return `(() => {
  const bridge = window.xsd_playable && typeof window.xsd_playable === "object"
    ? window.xsd_playable
    : null;
  window.${BYTEDANCE_SNAPSHOT_GLOBAL} = {
    bridge: bridge,
    download: bridge && typeof bridge.download === "function" ? bridge.download : null,
    install: bridge && typeof bridge.install === "function" ? bridge.install : null,
  };
})();`;
}

function createDelegateSource(
  platform: ByteDanceChannelPlatform,
): string {
  const platformLabel = JSON.stringify(platform);

  return `(() => {
  const snapshot = window.${BYTEDANCE_SNAPSHOT_GLOBAL} || {};
  const bridge = window.xsd_playable && typeof window.xsd_playable === "object"
    ? window.xsd_playable
    : {};

  const sdkDownload = typeof bridge.download === "function"
    && bridge.download !== snapshot.download
    ? bridge.download.bind(bridge)
    : null;
  const sdkInstall = typeof bridge.install === "function"
    && bridge.install !== snapshot.install
    ? bridge.install.bind(bridge)
    : null;

  function invokeByteDanceCta() {
    if (sdkDownload) {
      return sdkDownload();
    }
    if (sdkInstall) {
      return sdkInstall();
    }
    console.warn("[Playable Channel] " + ${platformLabel}
      + " Playable SDK 未提供 xsd_playable.download/install，请在渠道预览环境确认 SDK URL 与宿主接口。");
  }

  bridge.download = invokeByteDanceCta;
  bridge.install = invokeByteDanceCta;
  bridge.mraidOpen = invokeByteDanceCta;
  window.xsd_playable = bridge;

  try {
    delete window.${BYTEDANCE_SNAPSHOT_GLOBAL};
  } catch (_error) {
    window.${BYTEDANCE_SNAPSHOT_GLOBAL} = undefined;
  }
})();`;
}

export function injectByteDancePlayableSdk(
  html: string,
  platform: ByteDanceChannelPlatform,
): string {
  if (html.includes(BYTEDANCE_PLAYABLE_SDK_MARKER)) {
    return html;
  }

  const sdkUrl = getByteDancePlayableSdkUrl(platform);
  const source = [
    `<script ${BYTEDANCE_PLAYABLE_BRIDGE_MARKER}="capture">\n${createCaptureSource()}\n</script>`,
    `<script ${BYTEDANCE_PLAYABLE_SDK_MARKER} src="${sdkUrl}"></script>`,
    `<script ${BYTEDANCE_PLAYABLE_BRIDGE_MARKER}="delegate">\n${createDelegateSource(platform)}\n</script>`,
  ].join("\n");

  return injectBeforeHeadClose(html, source);
}
