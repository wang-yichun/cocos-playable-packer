import type {
  PlayablePlatform,
  PlayableRuntime,
} from "./playable-sdk-types.js";

declare global {
  interface Window {
    __COCOS_PLAYABLE__?: PlayableRuntime;
    __PLATFORM?: PlayablePlatform | string;
  }
}

export {};
