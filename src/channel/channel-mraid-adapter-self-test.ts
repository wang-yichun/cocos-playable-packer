import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Script, createContext } from "node:vm";

import {
  CHANNEL_DOWNLOAD_BRIDGE_MARKER,
  CHANNEL_RUNTIME_GATE_MARKER,
  createChannelDownloadBridgeSource,
  injectChannelDownloadBridge,
  installRuntimeStartGate,
  usesMraid,
} from "./channel-download-bridge.js";
import {
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
} from "./channel-profile.js";

const appLovinConfig = {
  platform: "AppLovin" as const,
  androidStoreUrl: TEST_ANDROID_STORE_URL,
  iosStoreUrl: TEST_IOS_STORE_URL,
};

assert.equal(usesMraid("AppLovin"), true);
assert.equal(usesMraid("IronSource"), true);
assert.equal(usesMraid("Liftoff"), true);
assert.equal(usesMraid("Unity"), true);
assert.equal(usesMraid("Google"), false);

const bridgeSource = createChannelDownloadBridgeSource(appLovinConfig);
new Script(bridgeSource);
assert.match(bridgeSource, /__PACK_DEFER_START__/);
assert.match(bridgeSource, /viewableChange/);
assert.match(bridgeSource, /audioVolumeChange/);
assert.match(bridgeSource, /sizeChange/);
assert.match(bridgeSource, /__MRAID_SIMULATOR__/);
assert.match(bridgeSource, /Ready \+ 可见/);
assert.match(bridgeSource, /mraid\.open/);

const runtimeSource = `(function () {
    var bootCount = 0;
    async function boot() {
        bootCount += 1;
        window.__bootCount = bootCount;
    }
    boot().catch(
        function (error) {
            window.__bootError = String(error);
        }
    );
})();`;

const gatedRuntime = installRuntimeStartGate(runtimeSource);
assert.match(gatedRuntime, new RegExp(CHANNEL_RUNTIME_GATE_MARKER));
assert.match(gatedRuntime, /window\.__runGame = function/);
assert.match(gatedRuntime, /playable-runtime-ready/);
assert.match(gatedRuntime, /playable-game-started/);

for (const packerFile of ["src/pack-compressed.ts", "src/pack-uncompressed.ts"]) {
  const packerSource = await readFile(path.resolve(packerFile), "utf8");
  const gatedPackerSource = installRuntimeStartGate(packerSource);
  assert.notEqual(
    gatedPackerSource,
    packerSource,
    `${packerFile} 中没有匹配到运行时 boot() 调用。`,
  );
  assert.match(gatedPackerSource, new RegExp(CHANNEL_RUNTIME_GATE_MARKER));
}

const runtimeEvents: string[] = [];
const runtimeWindow: Record<string, unknown> & {
  __PACK_DEFER_START__?: boolean;
  __PACK_START_REQUESTED__?: boolean;
  __runGame?: () => Promise<unknown>;
  __bootCount?: number;
  dispatchEvent: (event: { type: string }) => boolean;
} = {
  __PACK_DEFER_START__: true,
  dispatchEvent(event) {
    runtimeEvents.push(event.type);
    return true;
  },
};

class TestEvent {
  readonly type: string;
  readonly detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
}

const runtimeContext = createContext({
  window: runtimeWindow,
  CustomEvent: TestEvent,
  console,
});
new Script(gatedRuntime).runInContext(runtimeContext);
assert.equal(runtimeWindow.__bootCount, undefined);
assert.equal(typeof runtimeWindow.__runGame, "function");
assert.deepEqual(runtimeEvents, ["playable-runtime-ready"]);

runtimeWindow.__PACK_START_REQUESTED__ = true;
await runtimeWindow.__runGame?.();
assert.equal(runtimeWindow.__bootCount, 1);
assert.deepEqual(runtimeEvents, ["playable-runtime-ready", "playable-game-started"]);
await runtimeWindow.__runGame?.();
assert.equal(runtimeWindow.__bootCount, 1);

const mraidListeners = new Map<string, Array<(value?: unknown) => void>>();
const windowListeners = new Map<string, Array<(event: TestEvent) => void>>();
let mraidState = "loading";
let mraidViewable = false;
let mraidVolume = 100;
let mraidSize = { width: 720, height: 1080 };
let startCount = 0;
const cocosEvents: Array<{ name: string; value: unknown }> = [];

function addListener<T>(
  map: Map<string, T[]>,
  name: string,
  callback: T,
): void {
  const group = map.get(name) ?? [];
  group.push(callback);
  map.set(name, group);
}

const lifecycleWindow: Record<string, unknown> & {
  __PACK_DEFER_START__?: boolean;
  __PACK_START_REQUESTED__?: boolean;
  __PLAYABLE_VIEWABLE__?: boolean;
  __PLAYABLE_AUDIO_VOLUME__?: number;
  volumeSwitch?: boolean;
  volumeAudio?: number;
} = {
  location: { pathname: "/artifacts/test/game.html" },
  innerWidth: 720,
  innerHeight: 1080,
  open: () => ({}),
  addEventListener(name: string, callback: (event: TestEvent) => void) {
    addListener(windowListeners, name, callback);
  },
  dispatchEvent(event: TestEvent) {
    for (const callback of windowListeners.get(event.type) ?? []) {
      callback(event);
    }
    return true;
  },
  __runGame() {
    startCount += 1;
    return Promise.resolve();
  },
  cc: {
    view: {
      emit(name: string, value: unknown) {
        cocosEvents.push({ name, value });
      },
    },
  },
  mraid: {
    getState: () => mraidState,
    isViewable: () => mraidViewable,
    getScreenSize: () => ({ ...mraidSize }),
    getAudioVolume: () => mraidVolume,
    addEventListener(name: string, callback: (value?: unknown) => void) {
      addListener(mraidListeners, name, callback);
    },
    removeEventListener() {},
    open() {},
  },
};

const lifecycleContext = createContext({
  window: lifecycleWindow,
  navigator: {
    userAgent: "test",
    platform: "Win32",
    maxTouchPoints: 0,
  },
  document: {},
  CustomEvent: TestEvent,
  Event: TestEvent,
  console,
});
new Script(bridgeSource).runInContext(lifecycleContext);
assert.equal(lifecycleWindow.__PACK_DEFER_START__, true);
assert.equal(startCount, 0);
assert.equal(mraidListeners.has("ready"), true);

mraidState = "default";
for (const callback of mraidListeners.get("ready") ?? []) callback();
assert.equal(startCount, 0);
assert.equal(lifecycleWindow.__PLAYABLE_VIEWABLE__, false);
assert.equal(lifecycleWindow.__PLAYABLE_AUDIO_VOLUME__, 100);
assert.equal(lifecycleWindow.volumeSwitch, true);
assert.equal(cocosEvents.some((event) => event.name === "canvas-resize"), true);

mraidViewable = true;
for (const callback of mraidListeners.get("viewableChange") ?? []) callback(true);
assert.equal(startCount, 1);
assert.equal(lifecycleWindow.__PACK_START_REQUESTED__, true);
assert.equal(lifecycleWindow.__PLAYABLE_VIEWABLE__, true);

mraidVolume = 0;
for (const callback of mraidListeners.get("audioVolumeChange") ?? []) callback(0);
assert.equal(lifecycleWindow.__PLAYABLE_AUDIO_VOLUME__, 0);
assert.equal(lifecycleWindow.volumeAudio, 0);
assert.equal(lifecycleWindow.volumeSwitch, false);

mraidSize = { width: 1080, height: 720 };
for (const callback of mraidListeners.get("sizeChange") ?? []) callback();
assert.equal(
  cocosEvents.some(
    (event) => event.name === "canvas-resize"
      && (event.value as { width?: number }).width === 1080,
  ),
  true,
);

const html = `<!doctype html><html><head></head><body><script>${runtimeSource}</script></body></html>`;
const injected = injectChannelDownloadBridge(html, appLovinConfig);
assert.match(injected, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
assert.match(injected, new RegExp(CHANNEL_RUNTIME_GATE_MARKER));
assert.match(injected, /window\.__PLATFORM = platform/);
assert.equal(injectChannelDownloadBridge(injected, appLovinConfig), injected);

const googleInjected = injectChannelDownloadBridge(html, {
  platform: "Google",
  androidStoreUrl: TEST_ANDROID_STORE_URL,
  iosStoreUrl: TEST_IOS_STORE_URL,
});
assert.match(googleInjected, new RegExp(CHANNEL_DOWNLOAD_BRIDGE_MARKER));
assert.doesNotMatch(googleInjected, new RegExp(CHANNEL_RUNTIME_GATE_MARKER));

console.log("MRAID channel adapter self-test passed.");
