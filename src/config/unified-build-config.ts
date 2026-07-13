import { readFile } from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, unknown>;

export type ImageMode = "none" | "tinypng" | "squoosh" | "webp";
export type PayloadEncoding = "base64" | "base91" | "html7";
export type BrotliFallbackMode = "raw-js" | "gzip-packed-js";

export interface PlayableBuildConfig {
  schemaVersion?: 1;
  input?: string;
  output?: string;
  image?: {
    mode?: ImageMode;
    pngQuality?: number;
    jpegQuality?: number;
    pngWebpQuality?: number;
    jpegWebpQuality?: number;
  };
  audio?: {
    bitrate?: number;
    ffmpeg?: string;
  };
  compression?: {
    payloadEncoding?: PayloadEncoding;
    brotliFallback?: BrotliFallbackMode;
  };
  workspace?: {
    keep?: boolean;
  };
  extraArgs?: string[];
}

export interface ResolvedBuildArguments {
  argv: string[];
  configFile: string | null;
  config: PlayableBuildConfig | null;
}

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "input",
  "output",
  "image",
  "audio",
  "compression",
  "workspace",
  "extraArgs",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value: JsonObject, allowed: ReadonlySet<string>, source: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${source} 包含未知字段：${key}`);
    }
  }
}

function optionalString(value: unknown, source: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${source} 必须是非空字符串。`);
  }
  return value;
}

function optionalInteger(
  value: unknown,
  source: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${source} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return value as number;
}

function optionalEnum<T extends string>(
  value: unknown,
  source: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${source} 必须是以下值之一：${allowed.join(", ")}`);
  }
  return value as T;
}

export function validateBuildConfig(value: unknown, source = "配置文件"): PlayableBuildConfig {
  if (!isObject(value)) {
    throw new Error(`${source} 根节点必须是对象。`);
  }

  assertKnownKeys(value, TOP_LEVEL_KEYS, source);

  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw new Error(`${source}.schemaVersion 当前只支持 1。`);
  }

  const config: PlayableBuildConfig = {
    schemaVersion: value.schemaVersion as 1 | undefined,
    input: optionalString(value.input, `${source}.input`),
    output: optionalString(value.output, `${source}.output`),
  };

  if (value.image !== undefined) {
    if (!isObject(value.image)) {
      throw new Error(`${source}.image 必须是对象。`);
    }
    assertKnownKeys(
      value.image,
      new Set(["mode", "pngQuality", "jpegQuality", "pngWebpQuality", "jpegWebpQuality"]),
      `${source}.image`,
    );
    config.image = {
      mode: optionalEnum(value.image.mode, `${source}.image.mode`, ["none", "tinypng", "squoosh", "webp"]),
      pngQuality: optionalInteger(value.image.pngQuality, `${source}.image.pngQuality`, 0, 100),
      jpegQuality: optionalInteger(value.image.jpegQuality, `${source}.image.jpegQuality`, 1, 100),
      pngWebpQuality: optionalInteger(value.image.pngWebpQuality, `${source}.image.pngWebpQuality`, 0, 100),
      jpegWebpQuality: optionalInteger(value.image.jpegWebpQuality, `${source}.image.jpegWebpQuality`, 0, 100),
    };
  }

  if (value.audio !== undefined) {
    if (!isObject(value.audio)) {
      throw new Error(`${source}.audio 必须是对象。`);
    }
    assertKnownKeys(value.audio, new Set(["bitrate", "ffmpeg"]), `${source}.audio`);
    config.audio = {
      bitrate: optionalInteger(value.audio.bitrate, `${source}.audio.bitrate`, 8, 320),
      ffmpeg: optionalString(value.audio.ffmpeg, `${source}.audio.ffmpeg`),
    };
  }

  if (value.compression !== undefined) {
    if (!isObject(value.compression)) {
      throw new Error(`${source}.compression 必须是对象。`);
    }
    assertKnownKeys(
      value.compression,
      new Set(["payloadEncoding", "brotliFallback"]),
      `${source}.compression`,
    );
    config.compression = {
      payloadEncoding: optionalEnum(
        value.compression.payloadEncoding,
        `${source}.compression.payloadEncoding`,
        ["base64", "base91", "html7"],
      ),
      brotliFallback: optionalEnum(
        value.compression.brotliFallback,
        `${source}.compression.brotliFallback`,
        ["raw-js", "gzip-packed-js"],
      ),
    };
  }

  if (value.workspace !== undefined) {
    if (!isObject(value.workspace)) {
      throw new Error(`${source}.workspace 必须是对象。`);
    }
    assertKnownKeys(value.workspace, new Set(["keep"]), `${source}.workspace`);
    if (value.workspace.keep !== undefined && typeof value.workspace.keep !== "boolean") {
      throw new Error(`${source}.workspace.keep 必须是布尔值。`);
    }
    config.workspace = { keep: value.workspace.keep as boolean | undefined };
  }

  if (value.extraArgs !== undefined) {
    if (!Array.isArray(value.extraArgs) || value.extraArgs.some((item) => typeof item !== "string")) {
      throw new Error(`${source}.extraArgs 必须是字符串数组。`);
    }
    config.extraArgs = [...value.extraArgs] as string[];
  }

  if (config.image?.mode !== "squoosh" &&
      (config.image?.pngQuality !== undefined || config.image?.jpegQuality !== undefined)) {
    throw new Error(`${source} 中 pngQuality 和 jpegQuality 只适用于 image.mode=squoosh。`);
  }

  if (config.image?.mode !== "webp" &&
      (config.image?.pngWebpQuality !== undefined || config.image?.jpegWebpQuality !== undefined)) {
    throw new Error(`${source} 中 WebP 质量参数只适用于 image.mode=webp。`);
  }

  return config;
}

function optionKey(argument: string): string | null {
  if (!argument.startsWith("--")) {
    return null;
  }
  const equals = argument.indexOf("=");
  return equals === -1 ? argument : argument.slice(0, equals);
}

function mergeOptions(base: readonly string[], overrides: readonly string[]): string[] {
  const overrideKeys = new Set(overrides.map(optionKey).filter((key): key is string => key !== null));
  return [
    ...base.filter((argument) => {
      const key = optionKey(argument);
      return key === null || !overrideKeys.has(key);
    }),
    ...overrides,
  ];
}

function configToArguments(config: PlayableBuildConfig, baseDirectory: string): string[] {
  const args: string[] = [];
  if (config.input !== undefined) {
    args.push(path.resolve(baseDirectory, config.input));
  }
  if (config.output !== undefined) {
    args.push(path.resolve(baseDirectory, config.output));
  }
  if (config.image?.mode !== undefined) {
    args.push(`--image-mode=${config.image.mode}`);
  }
  if (config.image?.pngQuality !== undefined) {
    args.push(`--png-quality=${config.image.pngQuality}`);
  }
  if (config.image?.jpegQuality !== undefined) {
    args.push(`--jpeg-quality=${config.image.jpegQuality}`);
  }
  if (config.image?.pngWebpQuality !== undefined) {
    args.push(`--png-webp-quality=${config.image.pngWebpQuality}`);
  }
  if (config.image?.jpegWebpQuality !== undefined) {
    args.push(`--jpeg-webp-quality=${config.image.jpegWebpQuality}`);
  }
  if (config.audio?.bitrate !== undefined) {
    args.push(`--audio-bitrate=${config.audio.bitrate}`);
  }
  if (config.audio?.ffmpeg !== undefined) {
    args.push(`--ffmpeg=${config.audio.ffmpeg}`);
  }
  if (config.compression?.payloadEncoding !== undefined) {
    args.push(`--payload-encoding=${config.compression.payloadEncoding}`);
  }
  if (config.compression?.brotliFallback !== undefined) {
    args.push(`--brotli-fallback=${config.compression.brotliFallback}`);
  }
  if (config.workspace?.keep === true) {
    args.push("--keep-workspace");
  }
  if (config.extraArgs !== undefined) {
    args.push(...config.extraArgs);
  }
  return args;
}

function extractConfigArgument(argv: readonly string[]): { configPath: string | null; remaining: string[] } {
  const remaining: string[] = [];
  let configPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--config") {
      if (configPath !== null) {
        throw new Error("--config 只能指定一次。");
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new Error("--config 后必须提供配置文件路径。");
      }
      configPath = next;
      index += 1;
      continue;
    }
    if (argument.startsWith("--config=")) {
      if (configPath !== null) {
        throw new Error("--config 只能指定一次。");
      }
      configPath = argument.slice("--config=".length);
      if (configPath.length === 0) {
        throw new Error("--config 后必须提供配置文件路径。");
      }
      continue;
    }
    remaining.push(argument);
  }

  return { configPath, remaining };
}

export async function resolveBuildArguments(
  argv: readonly string[],
  cwd = process.cwd(),
): Promise<ResolvedBuildArguments> {
  const extracted = extractConfigArgument(argv);
  if (extracted.configPath === null) {
    return { argv: [...extracted.remaining], configFile: null, config: null };
  }

  const configFile = path.resolve(cwd, extracted.configPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configFile, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `无法读取配置文件 ${configFile}：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const config = validateBuildConfig(parsed, configFile);
  const configArgs = configToArguments(config, path.dirname(configFile));
  const configPositionals = configArgs.filter((argument) => !argument.startsWith("-"));
  const configOptions = configArgs.filter((argument) => argument.startsWith("-"));
  const cliPositionals = extracted.remaining.filter((argument) => !argument.startsWith("-"));
  const cliOptions = extracted.remaining.filter((argument) => argument.startsWith("-"));

  if (cliPositionals.length > 2) {
    throw new Error("命令行最多提供输入目录和输出 HTML 两个位置参数。");
  }

  const input = cliPositionals[0] ?? configPositionals[0];
  const output = cliPositionals[1] ?? configPositionals[1];
  const merged = [
    ...(input === undefined ? [] : [input]),
    ...(output === undefined ? [] : [output]),
    ...mergeOptions(configOptions, cliOptions),
  ];

  return { argv: merged, configFile, config };
}
