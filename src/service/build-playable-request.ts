import path from "node:path";

import {
  PlayableBuildServiceError,
  type BuildPlayableRequest,
  type PlayableAudioOptions,
  type NormalizedBuildPlayableRequest,
  type PlayableImageOptions,
  type TinyPngScope,
} from "./build-playable-types.js";

function assertInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      `${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`,
    );
  }
}

function assertDecimal(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      `${name} 必须是 ${minimum} 到 ${maximum} 之间的数字。`,
    );
  }
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      `${name} 必须是字符串。`,
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new PlayableBuildServiceError("INVALID_REQUEST", `${name} 不能为空。`);
  }
  return normalized;
}

function validateImageOptions(image: unknown): PlayableImageOptions {
  if (typeof image !== "object" || image === null || Array.isArray(image)) {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      "image 必须是包含 mode 的对象。",
    );
  }

  const value = image as Record<string, unknown>;
  const mode = value.mode;
  switch (mode) {
    case "none":
      return { mode: "none" };
    case "tinypng": {
      const scope = value.scope;
      if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
        throw new PlayableBuildServiceError(
          "INVALID_REQUEST",
          "TinyPNG 模式必须提供 scope。",
        );
      }
      const scopeValue = scope as Record<string, unknown>;
      let normalizedScope: TinyPngScope;
      if (scopeValue.type === "all") {
        normalizedScope = { type: "all" };
      } else if (scopeValue.type === "limit" && typeof scopeValue.limit === "number") {
        assertInteger(scopeValue.limit, "TinyPNG limit", 0, Number.MAX_SAFE_INTEGER);
        normalizedScope = { type: "limit", limit: scopeValue.limit };
      } else {
        throw new PlayableBuildServiceError(
          "INVALID_REQUEST",
          "TinyPNG scope 必须是 all 或包含有效 limit 的 limit。",
        );
      }

      const minBytes = value.minBytes;
      if (minBytes !== undefined) {
        if (typeof minBytes !== "number") {
          throw new PlayableBuildServiceError(
            "INVALID_REQUEST",
            "TinyPNG minBytes 必须是数字。",
          );
        }
        assertInteger(minBytes, "TinyPNG minBytes", 0, Number.MAX_SAFE_INTEGER);
      }
      return {
        mode: "tinypng",
        scope: normalizedScope,
        ...(minBytes === undefined ? {} : { minBytes }),
      };
    }
    case "squoosh": {
      const pngQuality = value.pngQuality ?? 80;
      const jpegQuality = value.jpegQuality ?? 80;
      const colours = value.colours ?? 256;
      const effort = value.effort ?? 10;
      const dither = value.dither ?? 0.5;
      const oxipngLevel = value.oxipngLevel ?? 3;
      if (
        typeof pngQuality !== "number"
        || typeof jpegQuality !== "number"
        || typeof colours !== "number"
        || typeof effort !== "number"
        || typeof dither !== "number"
        || typeof oxipngLevel !== "number"
      ) {
        throw new PlayableBuildServiceError(
          "INVALID_REQUEST",
          "Squoosh 参数必须是数字。",
        );
      }
      assertInteger(pngQuality, "Squoosh PNG quality", 0, 100);
      assertInteger(jpegQuality, "Squoosh JPEG quality", 1, 100);
      assertInteger(colours, "Squoosh colours", 2, 256);
      assertInteger(effort, "Squoosh effort", 1, 10);
      assertDecimal(dither, "Squoosh dither", 0, 1);
      assertInteger(oxipngLevel, "OxiPNG level", 1, 6);
      return {
        mode: "squoosh",
        pngQuality,
        jpegQuality,
        colours,
        effort,
        dither,
        oxipngLevel,
      };
    }
    case "webp": {
      const pngQuality = value.pngQuality ?? 80;
      const jpegQuality = value.jpegQuality ?? 80;
      if (typeof pngQuality !== "number" || typeof jpegQuality !== "number") {
        throw new PlayableBuildServiceError(
          "INVALID_REQUEST",
          "WebP 参数必须是数字。",
        );
      }
      assertInteger(pngQuality, "WebP PNG quality", 1, 100);
      assertInteger(jpegQuality, "WebP JPEG quality", 1, 100);
      return { mode: "webp", pngQuality, jpegQuality };
    }
    default:
      throw new PlayableBuildServiceError(
        "INVALID_REQUEST",
        `无效图片压缩模式：${String(mode)}`,
      );
  }
}

export function normalizeBuildPlayableRequest(
  request: BuildPlayableRequest,
): NormalizedBuildPlayableRequest {
  const inputDirectory = path.resolve(nonEmpty(request.inputDirectory, "inputDirectory"));
  const outputFile = path.resolve(nonEmpty(request.outputFile, "outputFile"));
  if (path.extname(outputFile).toLowerCase() !== ".html") {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      `输出文件必须是 .html：${outputFile}`,
    );
  }

  let audio: PlayableAudioOptions | null = null;
  if (request.audio !== undefined && request.audio !== null) {
    assertInteger(request.audio.bitrateKbps, "audio.bitrateKbps", 8, 320);
    audio = {
      bitrateKbps: request.audio.bitrateKbps,
      ffmpegPath:
        request.audio.ffmpegPath === undefined
          ? "ffmpeg"
          : nonEmpty(request.audio.ffmpegPath, "audio.ffmpegPath"),
    };
  }

  const projectName =
    request.projectName === undefined || request.projectName === null
      ? null
      : nonEmpty(request.projectName, "projectName");

  const payloadEncoding = request.payloadEncoding ?? "base64";
  if (
    payloadEncoding !== "base64"
    && payloadEncoding !== "base91"
    && payloadEncoding !== "html7"
  ) {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      `无效 Payload 编码：${String(payloadEncoding)}`,
    );
  }

  const brotliFallback = request.brotliFallback ?? "raw-js";
  if (brotliFallback !== "raw-js" && brotliFallback !== "gzip-packed-js") {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      `无效 Brotli 回退模式：${String(brotliFallback)}`,
    );
  }

  const keepWorkspace = request.keepWorkspace ?? false;
  if (typeof keepWorkspace !== "boolean") {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      "keepWorkspace 必须是布尔值。",
    );
  }

  return {
    inputDirectory,
    outputFile,
    image: validateImageOptions(request.image),
    audio,
    payloadEncoding,
    brotliFallback,
    projectName,
    keepWorkspace,
  };
}

export function createBuildPlayableArguments(
  request: BuildPlayableRequest | NormalizedBuildPlayableRequest,
): string[] {
  const normalized = normalizeBuildPlayableRequest(request);
  const args = [
    normalized.inputDirectory,
    normalized.outputFile,
    `--image-mode=${normalized.image.mode}`,
    `--payload-encoding=${normalized.payloadEncoding}`,
    `--brotli-fallback=${normalized.brotliFallback}`,
  ];

  if (normalized.projectName !== null) {
    args.push(`--project=${normalized.projectName}`);
  }
  if (normalized.keepWorkspace) {
    args.push("--keep-workspace");
  }

  switch (normalized.image.mode) {
    case "none":
      break;
    case "tinypng":
      args.push(
        normalized.image.scope.type === "all"
          ? "--all"
          : `--limit=${normalized.image.scope.limit}`,
      );
      if (normalized.image.minBytes !== undefined) {
        args.push(`--min-bytes=${normalized.image.minBytes}`);
      }
      break;
    case "squoosh":
      args.push(
        `--png-quality=${normalized.image.pngQuality ?? 80}`,
        `--jpeg-quality=${normalized.image.jpegQuality ?? 80}`,
        `--colours=${normalized.image.colours ?? 256}`,
        `--effort=${normalized.image.effort ?? 10}`,
        `--dither=${normalized.image.dither ?? 0.5}`,
        `--oxipng-level=${normalized.image.oxipngLevel ?? 3}`,
        "--min-bytes=0",
      );
      break;
    case "webp":
      args.push(
        `--png-webp-quality=${normalized.image.pngQuality ?? 80}`,
        `--jpeg-webp-quality=${normalized.image.jpegQuality ?? 80}`,
      );
      break;
  }

  if (normalized.audio !== null) {
    args.push(`--audio-bitrate=${normalized.audio.bitrateKbps}`);
    args.push(`--ffmpeg=${normalized.audio.ffmpegPath ?? "ffmpeg"}`);
  }

  return args;
}

export function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".report.json");
}
