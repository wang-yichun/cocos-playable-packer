import assert from "node:assert/strict";

import {
  PlayablePlatform,
  PlayableSDK,
} from "./playable-sdk.js";
import type { PlayableRuntimeHost } from "./playable-sdk-types.js";

const host = globalThis as unknown as PlayableRuntimeHost;
const calls: Array<{ name: string; value?: unknown }> = [];

host.__PLATFORM = "FallbackPlatform";
assert.equal(PlayableSDK.platformName, "FallbackPlatform");
assert.equal(PlayableSDK.platform, PlayablePlatform.Unknown);
assert.equal(PlayableSDK.getConfig("missing", "fallback"), "fallback");
PlayableSDK.ready();
PlayableSDK.openStore();

host.__COCOS_PLAYABLE__ = {
  platform: PlayablePlatform.Google,
  ready: () => calls.push({ name: "ready" }),
  setLoadingProgress: (value) => calls.push({ name: "progress", value }),
  openStore: () => calls.push({ name: "openStore" }),
  end: (value) => calls.push({ name: "end", value }),
  interacted: () => calls.push({ name: "interacted" }),
  track: (name, value) => calls.push({ name: `track:${name}`, value }),
  getConfig: <T>(key: string, fallback?: T): T | undefined => {
    if (key === "language") {
      return "zh-CN" as T;
    }
    return fallback;
  },
};

assert.equal(PlayableSDK.platformName, "Google");
assert.equal(PlayableSDK.platform, PlayablePlatform.Google);
PlayableSDK.ready();
PlayableSDK.setLoadingProgress(-1);
PlayableSDK.setLoadingProgress(0.5);
PlayableSDK.setLoadingProgress(2);
PlayableSDK.openStore();
PlayableSDK.end({ result: "completed", score: 100 });
PlayableSDK.interacted();
PlayableSDK.track(" level_complete ", { level: 1 });
assert.equal(PlayableSDK.getConfig("language", "en"), "zh-CN");
assert.equal(PlayableSDK.getConfig("unknown", "fallback"), "fallback");

assert.deepEqual(calls, [
  { name: "ready" },
  { name: "progress", value: 0 },
  { name: "progress", value: 0.5 },
  { name: "progress", value: 1 },
  { name: "openStore" },
  { name: "end", value: { result: "completed", score: 100 } },
  { name: "interacted" },
  { name: "track:level_complete", value: { level: 1 } },
]);

delete host.__COCOS_PLAYABLE__;
delete host.__PLATFORM;

assert.equal(PlayableSDK.platformName, PlayablePlatform.Preview);
assert.equal(PlayableSDK.platform, PlayablePlatform.Preview);

console.log("Playable SDK facade self-test passed.");
