import type { ChannelBuildConfig, ChannelPlatform } from "./channel-profile.js";

export const CHANNEL_DOWNLOAD_BRIDGE_MARKER = "data-cocos-playable-channel-download-bridge";

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function usesMraid(platform: ChannelPlatform): boolean {
  return platform === "AppLovin"
    || platform === "IronSource"
    || platform === "Liftoff"
    || platform === "Unity";
}

export function createChannelDownloadBridgeSource(config: ChannelBuildConfig): string {
  const serializedConfig = safeJson(config);
  const mraidPlatform = usesMraid(config.platform);

  return `(() => {
  const config = ${serializedConfig};
  const platform = config.platform;
  window.__PLATFORM = platform;

  function selectStoreUrl() {
    const userAgent = navigator.userAgent || "";
    const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const isIos = /iPad|iPhone|iPod/i.test(userAgent) || touchMac;
    return isIos
      ? (config.iosStoreUrl || config.androidStoreUrl)
      : (config.androidStoreUrl || config.iosStoreUrl);
  }

  function openStoreFallback(url) {
    if (!url) {
      console.warn("[Playable Channel] 未配置 Android 或 iOS 商店地址，无法执行下载跳转。");
      return;
    }
    const opened = window.open(url, "_blank");
    if (!opened) {
      window.location.href = url;
    }
  }

  const bridge = window.xsd_playable && typeof window.xsd_playable === "object"
    ? window.xsd_playable
    : {};

  bridge.download = function download() {
    const storeUrl = selectStoreUrl();

    if (platform === "Google"
      && window.ExitApi
      && typeof window.ExitApi.exit === "function") {
      window.ExitApi.exit();
      return;
    }

    if ((platform === "Facebook" || platform === "Moloco")
      && window.FbPlayableAd
      && typeof window.FbPlayableAd.onCTAClick === "function") {
      window.FbPlayableAd.onCTAClick();
      return;
    }

    if (${mraidPlatform ? "true" : "false"}
      && window.mraid
      && typeof window.mraid.open === "function"
      && storeUrl) {
      window.mraid.open(storeUrl);
      return;
    }

    openStoreFallback(storeUrl);
  };

  bridge.install = bridge.download;
  bridge.adapter = typeof bridge.adapter === "function" ? bridge.adapter : function adapter() {};
  bridge.gameReady = typeof bridge.gameReady === "function" ? bridge.gameReady : function gameReady() {};
  bridge.gameEnd = typeof bridge.gameEnd === "function" ? bridge.gameEnd : function gameEnd() {};
  bridge.onInteracted = typeof bridge.onInteracted === "function"
    ? bridge.onInteracted
    : function onInteracted() {};
  bridge.playableSDKsendEvent = typeof bridge.playableSDKsendEvent === "function"
    ? bridge.playableSDKsendEvent
    : function playableSDKsendEvent() {};

  window.xsd_playable = bridge;
})();`;
}

export function injectChannelDownloadBridge(
  html: string,
  config: ChannelBuildConfig,
): string {
  if (html.includes(CHANNEL_DOWNLOAD_BRIDGE_MARKER)) {
    return html;
  }

  const script = `<script ${CHANNEL_DOWNLOAD_BRIDGE_MARKER}>\n${createChannelDownloadBridgeSource(config)}\n</script>`;
  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch !== null && headMatch.index !== undefined) {
    const insertionIndex = headMatch.index + headMatch[0].length;
    return `${html.slice(0, insertionIndex)}\n${script}${html.slice(insertionIndex)}`;
  }

  const doctypeMatch = /<!doctype\s+html[^>]*>/i.exec(html);
  if (doctypeMatch !== null && doctypeMatch.index !== undefined) {
    const insertionIndex = doctypeMatch.index + doctypeMatch[0].length;
    return `${html.slice(0, insertionIndex)}\n${script}${html.slice(insertionIndex)}`;
  }

  return `${script}\n${html}`;
}
