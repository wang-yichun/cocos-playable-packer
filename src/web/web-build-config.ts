import type {
  BuildPlayableRequest,
  PlayableBrotliFallbackMode,
  PlayablePayloadEncoding,
} from "../service/build-playable-types.js";

export type WebImageMode = "none" | "squoosh" | "webp";

export interface WebBuildConfig {
  imageMode?: WebImageMode;
  pngQuality?: number;
  jpegQuality?: number;
  audioBitrateKbps?: number | null;
  payloadEncoding?: PlayablePayloadEncoding;
  brotliFallback?: PlayableBrotliFallbackMode;
}

export interface NormalizedWebBuildConfig {
  imageMode: WebImageMode;
  pngQuality: number;
  jpegQuality: number;
  audioBitrateKbps: number | null;
  payloadEncoding: PlayablePayloadEncoding;
  brotliFallback: PlayableBrotliFallbackMode;
}

export const DEFAULT_WEB_BUILD_CONFIG: Readonly<NormalizedWebBuildConfig> = {
  imageMode: "webp",
  pngQuality: 80,
  jpegQuality: 80,
  audioBitrateKbps: null,
  payloadEncoding: "html7",
  brotliFallback: "raw-js",
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

function normalizeImageMode(value: unknown): WebImageMode {
  if (value === undefined) {
    return DEFAULT_WEB_BUILD_CONFIG.imageMode;
  }
  if (value !== "none" && value !== "squoosh" && value !== "webp") {
    throw new Error("imageMode 只支持 none、squoosh 或 webp。");
  }
  return value;
}

function normalizePayloadEncoding(value: unknown): PlayablePayloadEncoding {
  if (value === undefined) {
    return DEFAULT_WEB_BUILD_CONFIG.payloadEncoding;
  }
  if (value !== "base64" && value !== "base91" && value !== "html7") {
    throw new Error("payloadEncoding 只支持 base64、base91 或 html7。");
  }
  return value;
}

function normalizeBrotliFallback(value: unknown): PlayableBrotliFallbackMode {
  if (value === undefined) {
    return DEFAULT_WEB_BUILD_CONFIG.brotliFallback;
  }
  if (value !== "raw-js" && value !== "gzip-packed-js") {
    throw new Error("brotliFallback 只支持 raw-js 或 gzip-packed-js。");
  }
  return value;
}

export function normalizeWebBuildConfig(value: unknown): NormalizedWebBuildConfig {
  if (value === undefined || value === null) {
    return { ...DEFAULT_WEB_BUILD_CONFIG };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("config 必须是对象。");
  }

  const source = value as Record<string, unknown>;
  const imageMode = normalizeImageMode(source.imageMode);
  const minimumPngQuality = imageMode === "squoosh" ? 0 : 1;
  const pngQuality = source.pngQuality === undefined
    ? DEFAULT_WEB_BUILD_CONFIG.pngQuality
    : integerInRange(source.pngQuality, "pngQuality", minimumPngQuality, 100);
  const jpegQuality = source.jpegQuality === undefined
    ? DEFAULT_WEB_BUILD_CONFIG.jpegQuality
    : integerInRange(source.jpegQuality, "jpegQuality", 1, 100);

  let audioBitrateKbps: number | null;
  if (source.audioBitrateKbps === undefined) {
    audioBitrateKbps = DEFAULT_WEB_BUILD_CONFIG.audioBitrateKbps;
  } else if (source.audioBitrateKbps === null) {
    audioBitrateKbps = null;
  } else {
    audioBitrateKbps = integerInRange(
      source.audioBitrateKbps,
      "audioBitrateKbps",
      8,
      320,
    );
  }

  return {
    imageMode,
    pngQuality,
    jpegQuality,
    audioBitrateKbps,
    payloadEncoding: normalizePayloadEncoding(source.payloadEncoding),
    brotliFallback: normalizeBrotliFallback(source.brotliFallback),
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
