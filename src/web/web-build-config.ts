import type {
  BuildPlayableRequest,
  PlayableBrotliFallbackMode,
  PlayablePayloadEncoding,
} from "../service/build-playable-types.js";
import {
  CHANNEL_PLATFORMS,
  normalizeChannelBuildConfig,
  type ChannelBuildConfig,
  type ChannelPlatform,
} from "../channel/channel-profile.js";

export type WebBuildMode = "optimized" | "raw-single-html";
export type WebImageMode = "none" | "tinypng" | "squoosh" | "webp";
export type WebTinyPngScope = "all" | "limit";

export interface WebBuildConfig {
  buildMode?: WebBuildMode;
  imageMode?: WebImageMode;
  pngQuality?: number;
  jpegQuality?: number;
  tinyPngScope?: WebTinyPngScope;
  tinyPngLimit?: number | null;
  tinyPngMinBytes?: number;
  audioBitrateKbps?: number | null;
  payloadEncoding?: PlayablePayloadEncoding;
  brotliFallback?: PlayableBrotliFallbackMode;
  channel?: Partial<ChannelBuildConfig> & {
    platforms?: readonly ChannelPlatform[];
  };
}

export interface NormalizedChannelBuildConfig extends ChannelBuildConfig {
  platforms: readonly ChannelPlatform[];
}

export interface NormalizedWebBuildConfig {
  buildMode: WebBuildMode;
  imageMode: WebImageMode;
  pngQuality: number;
  jpegQuality: number;
  tinyPngScope: WebTinyPngScope;
  tinyPngLimit: number | null;
  tinyPngMinBytes: number;
  audioBitrateKbps: number | null;
  payloadEncoding: PlayablePayloadEncoding;
  brotliFallback: PlayableBrotliFallbackMode;
  channel: NormalizedChannelBuildConfig;
}

const DEFAULT_CHANNEL_CONFIG: NormalizedChannelBuildConfig = {
  platform: "Preview",
  platforms: ["Preview"],
  androidStoreUrl: null,
  iosStoreUrl: null,
};

export const DEFAULT_WEB_BUILD_CONFIG: Readonly<NormalizedWebBuildConfig> = {
  buildMode: "optimized",
  imageMode: "webp",
  pngQuality: 80,
  jpegQuality: 80,
  tinyPngScope: "all",
  tinyPngLimit: null,
  tinyPngMinBytes: 1024,
  audioBitrateKbps: null,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
  channel: { ...DEFAULT_CHANNEL_CONFIG, platforms: [...DEFAULT_CHANNEL_CONFIG.platforms] },
};

export const RECOMMENDED_WEB_BUILD_CONFIG: Readonly<NormalizedWebBuildConfig> = {
  ...DEFAULT_WEB_BUILD_CONFIG,
  audioBitrateKbps: 48,
  channel: { ...DEFAULT_CHANNEL_CONFIG, platforms: [...DEFAULT_CHANNEL_CONFIG.platforms] },
};

export const RAW_SINGLE_HTML_WEB_BUILD_CONFIG: Readonly<NormalizedWebBuildConfig> = {
  ...DEFAULT_WEB_BUILD_CONFIG,
  buildMode: "raw-single-html",
  imageMode: "none",
  audioBitrateKbps: null,
  payloadEncoding: "base64",
  channel: { ...DEFAULT_CHANNEL_CONFIG, platforms: [...DEFAULT_CHANNEL_CONFIG.platforms] },
};

function integerInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return value as number;
}

function normalizeBuildMode(value: unknown): WebBuildMode {
  if (value === undefined) return DEFAULT_WEB_BUILD_CONFIG.buildMode;
  if (value !== "optimized" && value !== "raw-single-html") {
    throw new Error("buildMode 只支持 optimized 或 raw-single-html。");
  }
  return value;
}

function normalizeImageMode(value: unknown): WebImageMode {
  if (value === undefined) return DEFAULT_WEB_BUILD_CONFIG.imageMode;
  if (value !== "none" && value !== "tinypng" && value !== "squoosh" && value !== "webp") {
    throw new Error("imageMode 只支持 none、tinypng、squoosh 或 webp。");
  }
  return value;
}

function normalizeTinyPngScope(value: unknown): WebTinyPngScope {
  if (value === undefined) return DEFAULT_WEB_BUILD_CONFIG.tinyPngScope;
  if (value !== "all" && value !== "limit") {
    throw new Error("tinyPngScope 只支持 all 或 limit。");
  }
  return value;
}

function normalizePayloadEncoding(value: unknown): PlayablePayloadEncoding {
  if (value === undefined) return DEFAULT_WEB_BUILD_CONFIG.payloadEncoding;
  if (value !== "base64" && value !== "base91" && value !== "html7") {
    throw new Error("payloadEncoding 只支持 base64、base91 或 html7。");
  }
  return value;
}

function normalizeBrotliFallback(value: unknown): PlayableBrotliFallbackMode {
  if (value === undefined) return DEFAULT_WEB_BUILD_CONFIG.brotliFallback;
  if (value !== "raw-js" && value !== "gzip-packed-js") {
    throw new Error("brotliFallback 只支持 raw-js 或 gzip-packed-js。");
  }
  return value;
}

function normalizeChannelPlatforms(
  value: unknown,
  fallback: ChannelPlatform,
): readonly ChannelPlatform[] {
  if (value === undefined || value === null) return [fallback];
  if (!Array.isArray(value)) throw new Error("channel.platforms 必须是渠道数组。");
  const selected = new Set<ChannelPlatform>();
  for (const item of value) {
    if (typeof item !== "string" || !CHANNEL_PLATFORMS.includes(item as ChannelPlatform)) {
      throw new Error(`channel.platforms 只支持：${CHANNEL_PLATFORMS.join("、")}。`);
    }
    selected.add(item as ChannelPlatform);
  }
  if (selected.size === 0) throw new Error("至少需要选择一个目标渠道。");
  return CHANNEL_PLATFORMS.filter((platform) => selected.has(platform));
}

function normalizeMultiChannelConfig(value: unknown): NormalizedChannelBuildConfig {
  const base = normalizeChannelBuildConfig(value);
  const source = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const platforms = normalizeChannelPlatforms(source.platforms, base.platform);
  const platform = platforms.includes(base.platform) ? base.platform : platforms[0];
  if (platform === undefined) throw new Error("至少需要选择一个目标渠道。");
  return { ...base, platform, platforms };
}

export function normalizeWebBuildConfig(value: unknown): NormalizedWebBuildConfig {
  if (value === undefined || value === null) {
    return {
      ...DEFAULT_WEB_BUILD_CONFIG,
      channel: {
        ...DEFAULT_WEB_BUILD_CONFIG.channel,
        platforms: [...DEFAULT_WEB_BUILD_CONFIG.channel.platforms],
      },
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("config 必须是对象。");
  }

  const source = value as Record<string, unknown>;
  const channel = normalizeMultiChannelConfig(source.channel);
  const buildMode = normalizeBuildMode(source.buildMode);
  if (buildMode === "raw-single-html") {
    return { ...RAW_SINGLE_HTML_WEB_BUILD_CONFIG, channel };
  }

  const imageMode = normalizeImageMode(source.imageMode);
  const minimumPngQuality = imageMode === "squoosh" ? 0 : 1;
  const pngQuality = source.pngQuality === undefined
    ? DEFAULT_WEB_BUILD_CONFIG.pngQuality
    : integerInRange(source.pngQuality, "pngQuality", minimumPngQuality, 100);
  const jpegQuality = source.jpegQuality === undefined
    ? DEFAULT_WEB_BUILD_CONFIG.jpegQuality
    : integerInRange(source.jpegQuality, "jpegQuality", 1, 100);
  const tinyPngScope = normalizeTinyPngScope(source.tinyPngScope);
  const tinyPngLimit = tinyPngScope === "limit"
    ? integerInRange(source.tinyPngLimit, "tinyPngLimit", 1, 10_000)
    : null;
  const tinyPngMinBytes = source.tinyPngMinBytes === undefined
    ? DEFAULT_WEB_BUILD_CONFIG.tinyPngMinBytes
    : integerInRange(source.tinyPngMinBytes, "tinyPngMinBytes", 0, 1_073_741_824);

  let audioBitrateKbps: number | null;
  if (source.audioBitrateKbps === undefined) {
    audioBitrateKbps = DEFAULT_WEB_BUILD_CONFIG.audioBitrateKbps;
  } else if (source.audioBitrateKbps === null) {
    audioBitrateKbps = null;
  } else {
    audioBitrateKbps = integerInRange(source.audioBitrateKbps, "audioBitrateKbps", 8, 320);
  }

  return {
    buildMode,
    imageMode,
    pngQuality,
    jpegQuality,
    tinyPngScope,
    tinyPngLimit,
    tinyPngMinBytes,
    audioBitrateKbps,
    payloadEncoding: normalizePayloadEncoding(source.payloadEncoding),
    brotliFallback: normalizeBrotliFallback(source.brotliFallback),
    channel,
  };
}

export function createWebBuildRequest(
  inputDirectory: string,
  outputFile: string,
  projectName: string,
  config: NormalizedWebBuildConfig,
): BuildPlayableRequest {
  const image: BuildPlayableRequest["image"] = config.imageMode === "none"
    ? { mode: "none" }
    : config.imageMode === "tinypng"
      ? {
          mode: "tinypng",
          scope: config.tinyPngScope === "all"
            ? { type: "all" }
            : { type: "limit", limit: config.tinyPngLimit ?? 1 },
          minBytes: config.tinyPngMinBytes,
        }
      : config.imageMode === "squoosh"
        ? {
            mode: "squoosh",
            pngQuality: config.pngQuality,
            jpegQuality: config.jpegQuality,
          }
        : {
            mode: "webp",
            pngQuality: config.pngQuality,
            jpegQuality: config.jpegQuality,
          };

  return {
    inputDirectory,
    outputFile,
    image,
    audio: config.audioBitrateKbps === null
      ? null
      : { bitrateKbps: config.audioBitrateKbps },
    payloadEncoding: config.payloadEncoding,
    brotliFallback: config.brotliFallback,
    projectName,
    keepWorkspace: false,
  };
}
