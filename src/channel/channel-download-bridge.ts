import type { ChannelBuildConfig, ChannelPlatform } from "./channel-profile.js";

export const CHANNEL_DOWNLOAD_BRIDGE_MARKER = "data-cocos-playable-channel-download-bridge";
export const CHANNEL_RUNTIME_GATE_MARKER = "__PACK_RUNTIME_START_GATE__";

function safeJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new Error("无法序列化渠道下载桥配置。");
  }
  return json.replace(/</g, "\\u003c");
}

export function usesMraid(platform: ChannelPlatform): boolean {
  return platform === "AppLovin"
    || platform === "IronSource"
    || platform === "Liftoff"
    || platform === "Unity";
}

export function installRuntimeStartGate(html: string): string {
  if (html.includes(CHANNEL_RUNTIME_GATE_MARKER) || html.includes("window.__runGame = function")) {
    return html;
  }

  const pattern = /    boot\(\)\.catch\(\n([\s\S]*?)\n    \);\n\}\)\(\);/;
  const match = pattern.exec(html);
  if (match === null) {
    return html;
  }

  const catchHandler = match[1] ?? "";
  const replacement = `    var ${CHANNEL_RUNTIME_GATE_MARKER} = true;
    var bootPromise = null;

    window.__runGame = function () {
        if (bootPromise) {
            return bootPromise;
        }

        bootPromise = boot()
            .then(function (result) {
                window.dispatchEvent(
                    new CustomEvent(
                        'playable-game-started'
                    )
                );
                return result;
            })
            .catch(
${catchHandler}
            );

        return bootPromise;
    };

    window.dispatchEvent(
        new CustomEvent(
            'playable-runtime-ready'
        )
    );

    if (
        window.__PACK_DEFER_START__ !== true
        || window.__PACK_START_REQUESTED__ === true
    ) {
        window.__runGame();
    }
})();`;

  return html.replace(pattern, replacement);
}

export function createChannelDownloadBridgeSource(config: ChannelBuildConfig): string {
  const serializedConfig = safeJson(config);
  const mraidPlatform = usesMraid(config.platform);

  return `(() => {
  const config = ${serializedConfig};
  const platform = config.platform;
  const isMraidPlatform = ${mraidPlatform ? "true" : "false"};
  const previewPath = /^\\/preview\\//.test(window.location.pathname);
  window.__PLATFORM = platform;
  window.__PLAYABLE_CHANNEL_CONFIG__ = config;

  if (isMraidPlatform) {
    window.__PACK_DEFER_START__ = true;
  }

  function emitWindowEvent(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (_error) {
      window.dispatchEvent(new Event(name));
    }
  }

  function emitCocosEvent(name, value) {
    const cocos = window.cc;
    if (cocos && cocos.view && typeof cocos.view.emit === "function") {
      cocos.view.emit(name, value);
    }
  }

  function requestGameStart(reason) {
    window.__PACK_START_REQUESTED__ = true;
    window.__PACK_START_REASON__ = reason;
    if (typeof window.__runGame === "function") {
      return window.__runGame();
    }
    return null;
  }

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

  function installPreviewMraidSimulator() {
    if (!isMraidPlatform || !previewPath || window.mraid) {
      return;
    }

    let state = "loading";
    let viewable = false;
    let volume = 100;
    let size = {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
    };
    const listeners = Object.create(null);

    function addListener(name, callback) {
      if (typeof callback !== "function") return;
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(callback);
    }

    function removeListener(name, callback) {
      const group = listeners[name];
      if (!group) return;
      if (typeof callback !== "function") {
        delete listeners[name];
        return;
      }
      listeners[name] = group.filter((item) => item !== callback);
    }

    function dispatch(name, value) {
      const group = (listeners[name] || []).slice();
      for (const callback of group) {
        try {
          callback(value);
        } catch (error) {
          console.error("[MRAID Simulator] 事件处理失败：", name, error);
        }
      }
    }

    window.mraid = {
      getState: () => state,
      getVersion: () => "preview-simulator-1.0",
      isViewable: () => viewable,
      getScreenSize: () => ({ ...size }),
      getMaxSize: () => ({ ...size }),
      getAudioVolume: () => volume,
      addEventListener: addListener,
      removeEventListener: removeListener,
      open: (url) => openStoreFallback(url),
    };

    window.__MRAID_SIMULATOR__ = {
      ready() {
        if (state !== "loading") return;
        state = "default";
        dispatch("ready");
      },
      setViewable(value) {
        viewable = Boolean(value);
        dispatch("viewableChange", viewable);
      },
      setVolume(value) {
        const numeric = Number(value);
        volume = Number.isFinite(numeric)
          ? Math.max(0, Math.min(100, numeric))
          : volume;
        dispatch("audioVolumeChange", volume);
      },
      setSize(width, height) {
        const nextWidth = Number(width);
        const nextHeight = Number(height);
        if (Number.isFinite(nextWidth) && nextWidth > 0) size.width = Math.round(nextWidth);
        if (Number.isFinite(nextHeight) && nextHeight > 0) size.height = Math.round(nextHeight);
        dispatch("sizeChange", size.width, size.height);
      },
      quickStart() {
        this.ready();
        this.setViewable(true);
      },
      snapshot() {
        return { state, viewable, volume, size: { ...size } };
      },
    };

    function createPanel() {
      if (!document.body || document.getElementById("mraid-simulator-panel")) return;
      const panel = document.createElement("section");
      panel.id = "mraid-simulator-panel";
      panel.style.cssText = "position:fixed;right:10px;top:10px;z-index:2147483647;width:230px;padding:10px;border:1px solid rgba(255,255,255,.35);border-radius:8px;background:rgba(15,23,42,.94);color:#fff;font:12px/1.4 Segoe UI,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)";
      panel.innerHTML = '<strong style="display:block;margin-bottom:8px">MRAID 本地模拟器</strong>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'
        + '<button data-mraid="quick">Ready + 可见</button>'
        + '<button data-mraid="ready">仅 Ready</button>'
        + '<button data-mraid="show">设为可见</button>'
        + '<button data-mraid="hide">设为不可见</button>'
        + '<button data-mraid="mute">静音</button>'
        + '<button data-mraid="sound">音量 100</button>'
        + '</div>'
        + '<div id="mraid-simulator-status" style="margin-top:8px;color:#cbd5e1"></div>';
      panel.querySelectorAll("button").forEach((button) => {
        button.style.cssText = "padding:6px;border:0;border-radius:5px;background:#334155;color:#fff;cursor:pointer";
      });
      panel.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.mraid;
        const simulator = window.__MRAID_SIMULATOR__;
        if (!simulator) return;
        if (action === "quick") simulator.quickStart();
        if (action === "ready") simulator.ready();
        if (action === "show") simulator.setViewable(true);
        if (action === "hide") simulator.setViewable(false);
        if (action === "mute") simulator.setVolume(0);
        if (action === "sound") simulator.setVolume(100);
        updatePanelStatus();
      });
      document.body.appendChild(panel);
      updatePanelStatus();
    }

    function updatePanelStatus() {
      const status = document.getElementById("mraid-simulator-status");
      const simulator = window.__MRAID_SIMULATOR__;
      if (!status || !simulator) return;
      const snapshot = simulator.snapshot();
      status.textContent = "state=" + snapshot.state
        + " / viewable=" + snapshot.viewable
        + " / volume=" + snapshot.volume;
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", createPanel, { once: true });
    } else {
      createPanel();
    }
  }

  function installMraidLifecycle() {
    if (!isMraidPlatform) return;

    installPreviewMraidSimulator();

    let lifecycleReady = false;
    let currentSize = null;
    let currentVolume = 100;
    let currentViewable = false;

    function forwardSize() {
      const api = window.mraid;
      let nextSize = null;
      try {
        if (api && typeof api.getScreenSize === "function") {
          nextSize = api.getScreenSize();
        }
      } catch (_error) {}
      if (!nextSize || !Number.isFinite(nextSize.width) || !Number.isFinite(nextSize.height)) {
        nextSize = { width: window.innerWidth, height: window.innerHeight };
      }
      currentSize = {
        width: Math.max(1, Math.round(nextSize.width)),
        height: Math.max(1, Math.round(nextSize.height)),
      };
      window.__PLAYABLE_SCREEN_SIZE__ = currentSize;
      emitCocosEvent("canvas-resize", currentSize);
      emitWindowEvent("playable-size-change", currentSize);
    }

    function forwardVolume(value) {
      const numeric = Number(value);
      currentVolume = Number.isFinite(numeric)
        ? Math.max(0, Math.min(100, numeric))
        : currentVolume;
      window.volumeAudio = currentVolume / 100;
      window.volumeSwitch = currentVolume > 0;
      window.__PLAYABLE_AUDIO_VOLUME__ = currentVolume;
      emitCocosEvent("audioVolumeChange", window.volumeSwitch);
      emitWindowEvent("playable-audio-volume-change", {
        volume: currentVolume,
        enabled: window.volumeSwitch,
      });
    }

    function forwardViewable(value) {
      currentViewable = Boolean(value);
      window.__PLAYABLE_VIEWABLE__ = currentViewable;
      emitWindowEvent("playable-viewable-change", currentViewable);
      if (currentViewable) {
        requestGameStart("mraid-viewable");
      }
    }

    function onReady() {
      if (lifecycleReady) return;
      lifecycleReady = true;
      const api = window.mraid;
      if (!api) {
        requestGameStart("mraid-missing-after-ready");
        return;
      }
      if (typeof api.addEventListener === "function") {
        api.addEventListener("viewableChange", forwardViewable);
        api.addEventListener("sizeChange", forwardSize);
        api.addEventListener("audioVolumeChange", forwardVolume);
      }
      forwardSize();
      try {
        forwardVolume(typeof api.getAudioVolume === "function" ? api.getAudioVolume() : 100);
      } catch (_error) {
        forwardVolume(100);
      }
      try {
        forwardViewable(typeof api.isViewable === "function" ? api.isViewable() : true);
      } catch (_error) {
        forwardViewable(true);
      }
    }

    function attach() {
      const api = window.mraid;
      if (!api) {
        requestGameStart("mraid-unavailable-fallback");
        return;
      }
      try {
        if (typeof api.getState === "function" && api.getState() === "loading") {
          if (typeof api.addEventListener === "function") {
            api.addEventListener("ready", onReady);
            return;
          }
        }
      } catch (_error) {}
      onReady();
    }

    window.addEventListener("playable-game-started", () => {
      if (currentSize) emitCocosEvent("canvas-resize", currentSize);
      emitCocosEvent("audioVolumeChange", currentVolume > 0);
      emitWindowEvent("playable-viewable-change", currentViewable);
    });

    if (window.mraid) {
      attach();
    } else {
      window.addEventListener("load", attach, { once: true });
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

    if (isMraidPlatform
      && window.mraid
      && typeof window.mraid.open === "function"
      && storeUrl) {
      window.mraid.open(storeUrl);
      return;
    }

    openStoreFallback(storeUrl);
  };

  bridge.install = bridge.download;
  bridge.mraidOpen = bridge.download;
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
  installMraidLifecycle();
})();`;
}

export function injectChannelDownloadBridge(
  html: string,
  config: ChannelBuildConfig,
): string {
  if (html.includes(CHANNEL_DOWNLOAD_BRIDGE_MARKER)) {
    return html;
  }

  const runtimeReadyHtml = usesMraid(config.platform)
    ? installRuntimeStartGate(html)
    : html;
  const script = `<script ${CHANNEL_DOWNLOAD_BRIDGE_MARKER}>\n${createChannelDownloadBridgeSource(config)}\n</script>`;
  const headMatch = /<head\b[^>]*>/i.exec(runtimeReadyHtml);
  if (headMatch !== null && headMatch.index !== undefined) {
    const insertionIndex = headMatch.index + headMatch[0].length;
    return `${runtimeReadyHtml.slice(0, insertionIndex)}\n${script}${runtimeReadyHtml.slice(insertionIndex)}`;
  }

  const doctypeMatch = /<!doctype\s+html[^>]*>/i.exec(runtimeReadyHtml);
  if (doctypeMatch !== null && doctypeMatch.index !== undefined) {
    const insertionIndex = doctypeMatch.index + doctypeMatch[0].length;
    return `${runtimeReadyHtml.slice(0, insertionIndex)}\n${script}${runtimeReadyHtml.slice(insertionIndex)}`;
  }

  return `${script}\n${runtimeReadyHtml}`;
}
