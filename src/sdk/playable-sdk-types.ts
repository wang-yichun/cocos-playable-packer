export enum PlayablePlatform {
  Unknown = "Unknown",
  Preview = "Preview",
  AppLovin = "AppLovin",
  Google = "Google",
  Facebook = "Facebook",
  Liftoff = "Liftoff",
  IronSource = "IronSource",
  Unity = "Unity",
  Moloco = "Moloco",
}

export function normalizePlayablePlatform(value: unknown): PlayablePlatform {
  switch (value) {
    case PlayablePlatform.Preview:
      return PlayablePlatform.Preview;
    case PlayablePlatform.AppLovin:
      return PlayablePlatform.AppLovin;
    case PlayablePlatform.Google:
      return PlayablePlatform.Google;
    case PlayablePlatform.Facebook:
      return PlayablePlatform.Facebook;
    case PlayablePlatform.Liftoff:
      return PlayablePlatform.Liftoff;
    case PlayablePlatform.IronSource:
      return PlayablePlatform.IronSource;
    case PlayablePlatform.Unity:
      return PlayablePlatform.Unity;
    case PlayablePlatform.Moloco:
      return PlayablePlatform.Moloco;
    default:
      return PlayablePlatform.Unknown;
  }
}

export type PlayableEventParams = Readonly<Record<string, unknown>>;

export interface PlayableEndPayload {
  result?: string;
  score?: number;
  metadata?: PlayableEventParams;
}

/**
 * 由最终 Playable HTML 运行时注入的中立能力接口。
 *
 * 游戏项目只依赖这个契约，不直接依赖 MRAID、ExitApi、FbPlayableAd
 * 或任何公司内部全局对象。
 */
export interface PlayableRuntime {
  readonly platform?: PlayablePlatform | string;
  ready?(): void;
  setLoadingProgress?(progress: number): void;
  openStore?(): void;
  end?(payload?: PlayableEndPayload): void;
  interacted?(): void;
  track?(eventName: string, params?: PlayableEventParams): void;
  getConfig?<T = unknown>(key: string, fallback?: T): T | undefined;
}

export interface PlayableRuntimeHost {
  __COCOS_PLAYABLE__?: PlayableRuntime;
  __PLATFORM?: PlayablePlatform | string;
}
