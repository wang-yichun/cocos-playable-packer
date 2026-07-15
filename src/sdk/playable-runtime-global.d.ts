import type { PlayableRuntime } from "./playable-sdk-types.js";

declare global {
  interface Window {
    __COCOS_PLAYABLE__?: PlayableRuntime;
    __PLATFORM?: string;
  }
}

export {};
