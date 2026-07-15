import {
  PLAYABLE_SDK_VERSION,
  PlayablePlatform,
  normalizePlayablePlatform,
} from "./playable-sdk-types.js";
import type {
  PlayableEndPayload,
  PlayableEventParams,
  PlayableRuntime,
  PlayableRuntimeHost,
} from "./playable-sdk-types.js";

export {
  PLAYABLE_SDK_VERSION,
  PlayablePlatform,
} from "./playable-sdk-types.js";
export type {
  PlayableEndPayload,
  PlayableEventParams,
  PlayableRuntime,
  PlayableRuntimeHost,
} from "./playable-sdk-types.js";

const DEFAULT_PLATFORM = PlayablePlatform.Preview;

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
 * Cocos 游戏项目使用的稳定 Playable 门面。
 *
 * 缺少运行时注入时，所有写操作都会安全降级为 no-op，便于直接在
 * Cocos Creator、本地浏览器和普通 Web Mobile 构建中运行。
 *
 * @example 查看 SDK 版本
 * ```ts
 * console.log("Playable SDK:", PlayableSDK.version);
 * ```
 *
 * @example 基础生命周期与 CTA
 * ```ts
 * import PlayableSDK from "./PlayableSDK";
 *
 * PlayableSDK.setLoadingProgress(0.5);
 * PlayableSDK.ready();
 * PlayableSDK.interacted();
 * PlayableSDK.track("level_complete", { level: 1 });
 * PlayableSDK.openStore();
 * PlayableSDK.end({ result: "completed", score: 100 });
 * ```
 *
 * @example 针对已知渠道执行特殊逻辑
 * ```ts
 * import PlayableSDK, { PlayablePlatform } from "./PlayableSDK";
 *
 * if (PlayableSDK.platform === PlayablePlatform.AppLovin) {
 *   // AppLovin 专用游戏逻辑。
 * }
 *
 * if (PlayableSDK.platform === PlayablePlatform.Unknown) {
 *   console.warn("未识别渠道：", PlayableSDK.platformName);
 * }
 * ```
 */
export class PlayableSDK {
  /** 当前门面 SDK 版本。 */
  static readonly version = PLAYABLE_SDK_VERSION;

  /**
   * 原始渠道名称。用于日志、诊断或兼容尚未加入枚举的新渠道。
   *
   * @example
   * ```ts
   * console.log("Playable channel:", PlayableSDK.platformName);
   * ```
   */
  static get platformName(): string {
    const host = getRuntimeHost();
    const value = getRuntime()?.platform ?? host.__PLATFORM ?? DEFAULT_PLATFORM;
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : DEFAULT_PLATFORM;
  }

  /**
   * 已归一化的字符串枚举渠道。
   * 未识别的渠道返回 `PlayablePlatform.Unknown`。
   *
   * @example
   * ```ts
   * if (PlayableSDK.platform === PlayablePlatform.Google) {
   *   // Google Ads 专用处理。
   * }
   * ```
   */
  static get platform(): PlayablePlatform {
    return normalizePlayablePlatform(PlayableSDK.platformName);
  }

  /**
   * 通知宿主：游戏资源和首屏已经准备完成。
   *
   * @example
   * ```ts
   * PlayableSDK.ready();
   * ```
   */
  static ready(): void {
    callRuntime("ready", (runtime) => runtime.ready?.());
  }

  /**
   * 更新加载进度，参数使用 `0` 到 `1` 的比例值。
   * 超出范围的有限数值会自动限制到边界。
   *
   * @example
   * ```ts
   * PlayableSDK.setLoadingProgress(0.75);
   * ```
   */
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

  /**
   * 通过当前渠道适配器执行 CTA 或应用商店跳转。
   *
   * @example
   * ```ts
   * installButton.node.on(Button.EventType.CLICK, () => PlayableSDK.openStore());
   * ```
   */
  static openStore(): void {
    callRuntime("openStore", (runtime) => runtime.openStore?.());
  }

  /**
   * 通知宿主当前试玩流程已经结束。
   *
   * @example
   * ```ts
   * PlayableSDK.end({ result: "win", score: 1200 });
   * ```
   */
  static end(payload?: PlayableEndPayload): void {
    callRuntime("end", (runtime) => runtime.end?.(payload));
  }

  /**
   * 通知宿主用户已经发生首次或关键交互。
   *
   * @example
   * ```ts
   * PlayableSDK.interacted();
   * ```
   */
  static interacted(): void {
    callRuntime("interacted", (runtime) => runtime.interacted?.());
  }

  /**
   * 发送不绑定公司内部协议的通用事件。
   *
   * @example
   * ```ts
   * PlayableSDK.track("weapon_selected", { weapon: "laser" });
   * ```
   */
  static track(eventName: string, params?: PlayableEventParams): void {
    const normalizedName = eventName.trim();
    if (normalizedName.length === 0) {
      console.warn("[PlayableSDK] track 忽略了空事件名。");
      return;
    }

    callRuntime("track", (runtime) => runtime.track?.(normalizedName, params));
  }

  /**
   * 读取打包器或渠道运行时提供的配置。
   * 没有对应配置时返回调用方传入的 fallback。
   *
   * @example
   * ```ts
   * const language = PlayableSDK.getConfig("language", "en");
   * ```
   */
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
