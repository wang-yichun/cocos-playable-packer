/**
 * 游戏侧唯一需要依赖的 Playable 广告门面。
 *
 * 不要在游戏脚本中直接调用 FbPlayableAd、mraid、ExitApi 或 window.open。
 * Packer 会在构建目标渠道包时注入对应的 __PLAYABLE_ADAPTER__；此类同时
 * 保留对旧项目 xsd_playable 的兼容。在 Creator 编辑器与普通浏览器预览中，
 * 没有宿主桥接时所有调用都会安全地返回 false。
 */

export type PlayableLifecycleEvent = "gameReady" | "gameStart" | "gameEnd";

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
  };
  xsd_playable?: LegacyPlayableAdapter;
};

function runtimeGlobal(): PlayableGlobal {
  return globalThis as PlayableGlobal;
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
      default:
        return PlayableChannel.None;
    }
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
