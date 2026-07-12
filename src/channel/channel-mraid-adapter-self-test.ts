import assert from "node:assert/strict";
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

const eventNames: string[] = [];
const windowObject: Record<string, unknown> & {
  __PACK_DEFER_START__?: boolean;
  __PACK_START_REQUESTED__?: boolean;
  __runGame?: () => Promise<unknown>;
  __bootCount?: number;
  dispatchEvent: (event: { type: string }) => boolean;
} = {
  __PACK_DEFER_START__: true,
  dispatchEvent(event) {
    eventNames.push(event.type);
    return true;
  },
};

class TestCustomEvent {
  readonly type: string;
  constructor(type: string) {
    this.type = type;
  }
}

const context = createContext({
  window: windowObject,
  CustomEvent: TestCustomEvent,
  console,
});
new Script(gatedRuntime).runInContext(context);
assert.equal(windowObject.__bootCount, undefined);
assert.equal(typeof windowObject.__runGame, "function");
assert.deepEqual(eventNames, ["playable-runtime-ready"]);

windowObject.__PACK_START_REQUESTED__ = true;
await windowObject.__runGame?.();
assert.equal(windowObject.__bootCount, 1);
assert.deepEqual(eventNames, ["playable-runtime-ready", "playable-game-started"]);
await windowObject.__runGame?.();
assert.equal(windowObject.__bootCount, 1);

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
