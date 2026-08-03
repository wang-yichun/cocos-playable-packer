/**
 * 游戏侧唯一需要依赖的 Playable 广告门面。
 *
 * 不要在游戏脚本中直接调用 FbPlayableAd、mraid、ExitApi 或 window.open。
 * Packer 会在构建目标渠道包时注入对应的 __PLAYABLE_ADAPTER__；此类同时
 * 保留对旧项目 xsd_playable 的兼容。在 Creator 编辑器与普通浏览器预览中，
 * 没有宿主桥接时所有调用都会安全地返回 false。
 */

export type PlayableLifecycleEvent = "gameReady" | "gameStart" | "gameEnd";

export interface PlayableScreenSize {
  width: number;
  height: number;
}

export interface PlayableAudioState {
  volume: number;
  enabled: boolean;
}

export type PlayableUnsubscribe = () => void;

/**
 * 当前运行时所处的试玩广告渠道。
 *
 * `None` 表示 Creator 编辑器、普通浏览器预览，或没有使用本 Packer 渠道交付包的环境。
 */
export enum PlayableChannel {
  None = "none",
  Meta = "meta",
  GoogleAds = "google-ads",
  AppLovin = "applovin",
  UnityAds = "unity-ads",
}

/** The layout class of the generated playable asset, independent from the device's current rotation. */
export enum PlayableOrientation {
  None = "none",
  Responsive = "responsive",
  Portrait = "portrait",
  Landscape = "landscape",
}

interface PlayableAdapter {
  cta?: () => void;
  gameReady?: () => void;
  gameStart?: () => void;
  gameEnd?: () => void;
  track?: (eventName: string) => void;
}

interface LegacyPlayableAdapter {
  download?: () => void;
  install?: () => void;
  gameReady?: () => void;
  gameStart?: () => void;
  gameEnd?: () => void;
  playableSDKsendEvent?: (eventName: string) => void;
}

type PlayableGlobal = typeof globalThis & {
  __PLAYABLE_ADAPTER__?: PlayableAdapter;
  __PLATFORM?: unknown;
  __PLAYABLE_CHANNEL_CONFIG__?: {
    platform?: unknown;
    orientation?: unknown;
  };
  __PLAYABLE_VIEWABLE__?: boolean;
  __PLAYABLE_SCREEN_SIZE__?: PlayableScreenSize;
  __PLAYABLE_AUDIO_VOLUME__?: number;
  volumeAudio?: number;
  volumeSwitch?: boolean;
  xsd_playable?: LegacyPlayableAdapter;
};

type PlayableEventTarget = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

function runtimeGlobal(): PlayableGlobal {
  return globalThis as PlayableGlobal;
}

function eventTarget(): PlayableEventTarget | null {
  const runtime = runtimeGlobal() as PlayableGlobal & Partial<PlayableEventTarget>;
  return typeof runtime.addEventListener === "function"
    && typeof runtime.removeEventListener === "function"
    ? runtime as PlayableEventTarget
    : null;
}

function normalizeScreenSize(value: unknown): PlayableScreenSize | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { width?: unknown; height?: unknown };
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

function normalizeAudioState(value: unknown): PlayableAudioState | null {
  if (typeof value === "number") {
    const volume = Math.max(0, Math.min(100, value));
    return { volume, enabled: volume > 0 };
  }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { volume?: unknown; enabled?: unknown };
  const volume = Number(candidate.volume);
  if (!Number.isFinite(volume)) return null;
  const normalizedVolume = Math.max(0, Math.min(100, volume));
  return {
    volume: normalizedVolume,
    enabled: typeof candidate.enabled === "boolean"
      ? candidate.enabled
      : normalizedVolume > 0,
  };
}

function eventDetail<T>(event: Event): T | undefined {
  return (event as CustomEvent<T>).detail;
}

/**
 * 在 Cocos 游戏脚本内使用，例如：
 *
 *     PlayableFacade.cta();
 *     PlayableFacade.gameReady();
 *     PlayableFacade.track("tutorial_complete");
 */
export class PlayableFacade {
  /**
   * 获取当前交付渠道。游戏代码只依赖这个枚举，无需探测 Meta、Google 或 AppLovin 的宿主 SDK。
   */
  public static getChannel(): PlayableChannel {
    const runtime = runtimeGlobal();
    const platform = runtime.__PLAYABLE_CHANNEL_CONFIG__?.platform ?? runtime.__PLATFORM;

    switch (platform) {
      case "Facebook":
        return PlayableChannel.Meta;
      case "Google":
        return PlayableChannel.GoogleAds;
      case "AppLovin":
        return PlayableChannel.AppLovin;
      case "Unity":
        return PlayableChannel.UnityAds;
      default:
        return PlayableChannel.None;
    }
  }

  /**
   * Returns the orientation class selected when this playable was packaged.
   * Responsive remains a single adaptive asset; portrait and landscape are the
   * independent files emitted for Unity's Portrait & Landscape upload mode.
   */
  public static getOrientation(): PlayableOrientation {
    switch (runtimeGlobal().__PLAYABLE_CHANNEL_CONFIG__?.orientation) {
      case "responsive":
        return PlayableOrientation.Responsive;
      case "portrait":
        return PlayableOrientation.Portrait;
      case "landscape":
        return PlayableOrientation.Landscape;
      default:
        return PlayableOrientation.None;
    }
  }

  /**
   * Returns whether the playable is currently visible to the ad host.
   * Local browser previews are treated as visible when the host has not
   * supplied a viewability signal.
   */
  public static isViewable(): boolean {
    return runtimeGlobal().__PLAYABLE_VIEWABLE__ ?? true;
  }

  /** Returns the latest MRAID/container size, or the browser viewport size. */
  public static getScreenSize(): PlayableScreenSize | null {
    const runtime = runtimeGlobal() as PlayableGlobal & {
      innerWidth?: number;
      innerHeight?: number;
    };
    const reportedSize = normalizeScreenSize(runtime.__PLAYABLE_SCREEN_SIZE__);
    if (reportedSize !== null) return reportedSize;
    return normalizeScreenSize({ width: runtime.innerWidth, height: runtime.innerHeight });
  }

  /** Returns the latest host audio volume as a percentage from 0 to 100. */
  public static getAudioVolume(): number {
    const runtime = runtimeGlobal();
    const reportedVolume = Number(runtime.__PLAYABLE_AUDIO_VOLUME__);
    if (Number.isFinite(reportedVolume)) {
      return Math.max(0, Math.min(100, reportedVolume));
    }
    const legacyVolume = Number(runtime.volumeAudio);
    if (Number.isFinite(legacyVolume)) {
      return Math.max(0, Math.min(100, legacyVolume * 100));
    }
    return 100;
  }

  /** Returns whether host audio is currently enabled. */
  public static isAudioEnabled(): boolean {
    return runtimeGlobal().volumeSwitch ?? this.getAudioVolume() > 0;
  }

  /** Subscribe to host visibility changes and receive an unsubscribe function. */
  public static onViewableChange(listener: (viewable: boolean) => void): PlayableUnsubscribe {
    return this.subscribe("playable-viewable-change", (event) => {
      const value = eventDetail<boolean>(event);
      return typeof value === "boolean" ? value : undefined;
    }, listener);
  }

  /** Subscribe to host/container size changes and receive an unsubscribe function. */
  public static onScreenSizeChange(listener: (size: PlayableScreenSize) => void): PlayableUnsubscribe {
    return this.subscribe("playable-size-change", (event) => {
      return normalizeScreenSize(eventDetail<PlayableScreenSize>(event));
    }, listener);
  }

  /** Subscribe to host audio-volume changes and receive an unsubscribe function. */
  public static onAudioVolumeChange(listener: (state: PlayableAudioState) => void): PlayableUnsubscribe {
    return this.subscribe("playable-audio-volume-change", (event) => {
      return normalizeAudioState(eventDetail<PlayableAudioState | number>(event));
    }, listener);
  }

  /**
   * 仅在玩家主动点击“下载 / 安装 / 立即试玩”按钮时调用。
   * 返回 true 表示已找到并调用渠道桥接；false 表示当前为本地预览环境。
   */
  public static cta(): boolean {
    const adapter = runtimeGlobal().__PLAYABLE_ADAPTER__;
    if (typeof adapter?.cta === "function") {
      adapter.cta();
      return true;
    }

    const legacy = runtimeGlobal().xsd_playable;
    const legacyCta = legacy?.download ?? legacy?.install;
    if (typeof legacyCta === "function") {
      legacyCta.call(legacy);
      return true;
    }

    return false;
  }

  /** 通知广告宿主：游戏已完成初始化并可开始交互。 */
  public static gameReady(): boolean {
    return this.lifecycle("gameReady");
  }

  /** 通知广告宿主：玩家已开始游戏。 */
  public static gameStart(): boolean {
    return this.lifecycle("gameStart");
  }

  /** 通知广告宿主：本局游戏结束。 */
  public static gameEnd(): boolean {
    return this.lifecycle("gameEnd");
  }

  /** 发送不含用户信息的游戏事件；未接入渠道时安全忽略。 */
  public static track(eventName: string): boolean {
    const normalizedEventName = eventName.trim();
    if (normalizedEventName.length === 0) return false;

    const adapter = runtimeGlobal().__PLAYABLE_ADAPTER__;
    if (typeof adapter?.track === "function") {
      adapter.track(normalizedEventName);
      return true;
    }

    const legacy = runtimeGlobal().xsd_playable;
    if (typeof legacy?.playableSDKsendEvent === "function") {
      legacy.playableSDKsendEvent(normalizedEventName);
      return true;
    }

    return false;
  }

  private static subscribe<T>(
    eventName: string,
    readValue: (event: Event) => T | undefined | null,
    listener: (value: T) => void,
  ): PlayableUnsubscribe {
    const target = eventTarget();
    if (target === null) return () => {};

    const handler = (event: Event): void => {
      const value = readValue(event);
      if (value !== undefined && value !== null) listener(value);
    };
    target.addEventListener(eventName, handler);
    return () => target.removeEventListener(eventName, handler);
  }

  private static lifecycle(event: PlayableLifecycleEvent): boolean {
    const adapter = runtimeGlobal().__PLAYABLE_ADAPTER__;
    const handler = adapter?.[event];
    if (typeof handler === "function") {
      handler.call(adapter);
      return true;
    }

    const legacy = runtimeGlobal().xsd_playable;
    const legacyHandler = legacy?.[event];
    if (typeof legacyHandler === "function") {
      legacyHandler.call(legacy);
      return true;
    }

    return false;
  }
}
