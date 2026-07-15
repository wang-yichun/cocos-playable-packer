import type {
  PlayableEndPayload,
  PlayableEventParams,
  PlayableRuntime,
  PlayableRuntimeHost,
} from "./playable-sdk-types.js";

const DEFAULT_PLATFORM = "Preview";

function getRuntimeHost(): PlayableRuntimeHost {
  return globalThis as unknown as PlayableRuntimeHost;
}

function getRuntime(): PlayableRuntime | undefined {
  return getRuntimeHost().__COCOS_PLAYABLE__;
}

function reportRuntimeError(method: string, error: unknown): void {
  console.warn(`[PlayableSDK] ${method} 调用失败：`, error);
}

function callRuntime(method: string, callback: (runtime: PlayableRuntime) => void): void {
  const runtime = getRuntime();
  if (runtime === undefined) {
    return;
  }

  try {
    callback(runtime);
  } catch (error) {
    reportRuntimeError(method, error);
  }
}

/**
 * Cocos 游戏项目使用的稳定门面。
 *
 * 缺少运行时注入时，所有写操作都会安全降级为 no-op，便于直接在
 * Cocos Creator、本地浏览器和普通 Web Mobile 构建中运行。
 */
export class PlayableSDK {
  static get platform(): string {
    const host = getRuntimeHost();
    return getRuntime()?.platform ?? host.__PLATFORM ?? DEFAULT_PLATFORM;
  }

  static ready(): void {
    callRuntime("ready", (runtime) => runtime.ready?.());
  }

  /** 加载进度使用 0 到 1 的比例值。 */
  static setLoadingProgress(progress: number): void {
    if (!Number.isFinite(progress)) {
      console.warn("[PlayableSDK] setLoadingProgress 忽略了非有限数值。", progress);
      return;
    }

    const normalizedProgress = Math.max(0, Math.min(1, progress));
    callRuntime(
      "setLoadingProgress",
      (runtime) => runtime.setLoadingProgress?.(normalizedProgress),
    );
  }

  static openStore(): void {
    callRuntime("openStore", (runtime) => runtime.openStore?.());
  }

  static end(payload?: PlayableEndPayload): void {
    callRuntime("end", (runtime) => runtime.end?.(payload));
  }

  static interacted(): void {
    callRuntime("interacted", (runtime) => runtime.interacted?.());
  }

  static track(eventName: string, params?: PlayableEventParams): void {
    const normalizedName = eventName.trim();
    if (normalizedName.length === 0) {
      console.warn("[PlayableSDK] track 忽略了空事件名。");
      return;
    }

    callRuntime("track", (runtime) => runtime.track?.(normalizedName, params));
  }

  static getConfig<T = unknown>(key: string, fallback?: T): T | undefined {
    const normalizedKey = key.trim();
    if (normalizedKey.length === 0) {
      return fallback;
    }

    const runtime = getRuntime();
    if (runtime?.getConfig === undefined) {
      return fallback;
    }

    try {
      return runtime.getConfig(normalizedKey, fallback);
    } catch (error) {
      reportRuntimeError("getConfig", error);
      return fallback;
    }
  }
}

export default PlayableSDK;
