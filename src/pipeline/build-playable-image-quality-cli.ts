import { spawn } from "node:child_process";
import {
  access,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const JPEG_QUALITY_ENV = "PLAYABLE_PACKER_JPEG_QUALITY";

type JsonObject = Record<string, unknown>;

export interface ImageQualityPipelineOptions {
  passthroughArgs: string[];
  imageMode: string | null;
  pngQuality: number;
  jpegQuality: number;
  outputFile: string | null;
  helpRequested: boolean;
  usedLegacyPngQuality: boolean;
}

function integer(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return parsed;
}

function imageModeFromArguments(args: readonly string[]): string | null {
  const explicit = args.find((argument) => argument.startsWith("--image-mode="));
  if (explicit !== undefined) {
    return explicit.slice("--image-mode=".length);
  }
  const compatible = args.find((argument) => argument.startsWith("--mode="));
  return compatible === undefined ? null : compatible.slice("--mode=".length);
}

export function parseImageQualityPipelineArguments(
  argv: readonly string[],
): ImageQualityPipelineOptions {
  const args = argv.filter((argument) => argument !== "--");
  const passthroughArgs: string[] = [];
  const positional: string[] = [];
  let pngQuality = 80;
  let jpegQuality = 80;
  let pngQualitySpecified = false;
  let jpegQualitySpecified = false;
  let usedLegacyPngQuality = false;
  const helpRequested = args.includes("--help") || args.includes("-h");

  for (const argument of args) {
    if (argument.startsWith("--png-quality=")) {
      if (pngQualitySpecified) {
        throw new Error("--png-quality 与兼容参数 --quality 只能指定一个。");
      }
      pngQuality = integer(
        argument.slice("--png-quality=".length),
        "--png-quality",
        0,
        100,
      );
      pngQualitySpecified = true;
      continue;
    }

    if (argument.startsWith("--quality=")) {
      if (pngQualitySpecified) {
        throw new Error("--png-quality 与兼容参数 --quality 只能指定一个。");
      }
      pngQuality = integer(
        argument.slice("--quality=".length),
        "--quality",
        0,
        100,
      );
      pngQualitySpecified = true;
      usedLegacyPngQuality = true;
      continue;
    }

    if (argument.startsWith("--jpeg-quality=")) {
      if (jpegQualitySpecified) {
        throw new Error("--jpeg-quality 只能指定一次。");
      }
      jpegQuality = integer(
        argument.slice("--jpeg-quality=".length),
        "--jpeg-quality",
        1,
        100,
      );
      jpegQualitySpecified = true;
      continue;
    }

    passthroughArgs.push(argument);
    if (!argument.startsWith("-")) {
      positional.push(argument);
    }
  }

  if (pngQualitySpecified) {
    passthroughArgs.push(`--quality=${pngQuality}`);
  }

  const imageMode = imageModeFromArguments(passthroughArgs);

  if (helpRequested) {
    return {
      passthroughArgs,
      imageMode,
      pngQuality,
      jpegQuality,
      outputFile: null,
      helpRequested,
      usedLegacyPngQuality,
    };
  }

  if ((pngQualitySpecified || jpegQualitySpecified) && imageMode !== "squoosh") {
    throw new Error(
      "--png-quality、--jpeg-quality 与兼容参数 --quality 只适用于 Squoosh 模式。",
    );
  }

  if (positional.length !== 2) {
    throw new Error("必须提供输入目录和输出 HTML。");
  }

  const outputFile = path.resolve(positional[1] ?? "");
  if (path.extname(outputFile).toLowerCase() !== ".html") {
    throw new Error(`输出文件必须是 .html：${outputFile}`);
  }

  return {
    passthroughArgs,
    imageMode,
    pngQuality,
    jpegQuality,
    outputFile,
    helpRequested,
    usedLegacyPngQuality,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".report.json");
}

function requireObject(parent: JsonObject, key: string, source: string): JsonObject {
  const value = parent[key];
  if (!isJsonObject(value)) {
    throw new Error(`${source} 缺少对象字段：${key}`);
  }
  return value;
}

function requireString(parent: JsonObject, key: string, source: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${source} 缺少字符串字段：${key}`);
  }
  return value;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const backupPath = `${filePath}.previous-${process.pid}-${Date.now()}`;
  let backedUp = false;
  let promoted = false;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (await exists(filePath)) {
      await rename(filePath, backupPath);
      backedUp = true;
    }
    await rename(temporaryPath, filePath);
    promoted = true;
    await rm(backupPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (promoted) {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
    if (backedUp && (await exists(backupPath))) {
      await rename(backupPath, filePath).catch(() => undefined);
    }
    throw error;
  }
}

export function addImageQualitySettings(
  report: JsonObject,
  pngQuality: number,
  jpegQuality: number,
): JsonObject {
  const current = report.imageOptimization;
  const imageOptimization = isJsonObject(current) ? current : {};
  return {
    ...report,
    imageOptimization: {
      ...imageOptimization,
      settings: {
        pngQuality,
        jpegQuality,
      },
    },
  };
}

async function updateReports(
  outputFile: string,
  pngQuality: number,
  jpegQuality: number,
): Promise<void> {
  const outputReportFile = reportPathForOutput(outputFile);
  const outputReport = JSON.parse(await readFile(outputReportFile, "utf8")) as unknown;
  if (!isJsonObject(outputReport)) {
    throw new Error(`报告根节点必须是对象：${outputReportFile}`);
  }

  const updated = addImageQualitySettings(outputReport, pngQuality, jpegQuality);
  const output = requireObject(updated, "output", outputReportFile);
  const projectReportFile = requireString(
    output,
    "projectReportFile",
    outputReportFile,
  );

  await writeJsonAtomically(outputReportFile, updated);
  await writeJsonAtomically(projectReportFile, updated);
}

async function runExistingPipeline(
  args: readonly string[],
  jpegQuality: number,
): Promise<void> {
  const scriptPath = path.join(
    process.cwd(),
    "src",
    "pipeline",
    "build-playable-brotli-fallback-cli.ts",
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          [JPEG_QUALITY_ENV]: String(jpegQuality),
        },
        stdio: "inherit",
        windowsHide: false,
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `Playable 构建流水线退出码：${String(code)}`
            : `Playable 构建流水线被信号 ${signal} 终止。`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const options = parseImageQualityPipelineArguments(process.argv.slice(2));

  if (options.helpRequested) {
    console.log([
      "",
      "图片质量参数：",
      "  --png-quality=80   PNG 调色板量化质量，范围 0-100",
      "  --jpeg-quality=80  MozJPEG 质量，范围 1-100",
      "  --quality=80       --png-quality 的兼容别名",
      "  --audio-bitrate=48  可选：将更高码率 MP3 转为目标码率并保持声道",
      "  --ffmpeg=ffmpeg     可选：FFmpeg 命令或可执行文件路径",
      "  --image-mode=webp    可选：将 PNG/JPEG 编码为 WebP 内容",
      "  --png-webp-quality=80 --jpeg-webp-quality=80",
    ].join("\n"));
  }

  if (options.usedLegacyPngQuality) {
    console.warn("警告：--quality 已弃用，请改用 --png-quality。");
  }

  await runExistingPipeline(options.passthroughArgs, options.jpegQuality);

  if (
    !options.helpRequested &&
    options.imageMode === "squoosh" &&
    options.outputFile !== null
  ) {
    await updateReports(
      options.outputFile,
      options.pngQuality,
      options.jpegQuality,
    );
  }
}

const entryFile = process.argv[1];
if (
  entryFile !== undefined &&
  import.meta.url === pathToFileURL(entryFile).href
) {
  main().catch((error: unknown) => {
    console.error("");
    console.error("图片质量参数流水线失败");
    console.error("----------------------");
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
