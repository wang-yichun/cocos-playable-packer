import { spawn } from "node:child_process";
import path from "node:path";

const JPEG_QUALITY_ENV = "PLAYABLE_PACKER_JPEG_QUALITY";
const SUPPRESS_LEGACY_PNG_WARNING_ENV =
  "PLAYABLE_PACKER_SUPPRESS_LEGACY_PNG_QUALITY_WARNING";

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

const rawArguments = process.argv
  .slice(2)
  .filter((argument: string) => argument !== "--");

const environmentJpegQuality = process.env[JPEG_QUALITY_ENV];
let jpegQuality = environmentJpegQuality === undefined
  ? 80
  : integer(environmentJpegQuality, JPEG_QUALITY_ENV, 1, 100);
let jpegQualitySpecified = false;
let pngQualitySpecified = false;
let usedLegacyPngQuality = false;
const forwardedArguments: string[] = [];

for (const argument of rawArguments) {
  if (argument.startsWith("--jpeg-quality=")) {
    if (jpegQualitySpecified || environmentJpegQuality !== undefined) {
      throw new Error("--jpeg-quality 只能指定一次，且不能与流水线环境配置同时使用。");
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

  if (argument.startsWith("--png-quality=")) {
    if (pngQualitySpecified) {
      throw new Error("--png-quality 与兼容参数 --quality 只能指定一个。");
    }
    const value = integer(
      argument.slice("--png-quality=".length),
      "--png-quality",
      0,
      100,
    );
    pngQualitySpecified = true;
    forwardedArguments.push(`--quality=${value}`);
    continue;
  }

  if (argument.startsWith("--quality=")) {
    if (pngQualitySpecified) {
      throw new Error("--png-quality 与兼容参数 --quality 只能指定一个。");
    }
    integer(argument.slice("--quality=".length), "--quality", 0, 100);
    pngQualitySpecified = true;
    usedLegacyPngQuality = true;
    forwardedArguments.push(argument);
    continue;
  }

  forwardedArguments.push(
    argument.startsWith("--image-mode=")
      ? `--mode=${argument.slice("--image-mode=".length)}`
      : argument,
  );
}

const imageMode = forwardedArguments
  .find((argument) => argument.startsWith("--mode="))
  ?.slice("--mode=".length);
const preview = forwardedArguments.includes("--preview");
const buildDirectory = forwardedArguments.find(
  (argument) => !argument.startsWith("-"),
);

if ((jpegQualitySpecified || pngQualitySpecified) && imageMode !== "squoosh") {
  throw new Error(
    "--png-quality、--jpeg-quality 与兼容参数 --quality 只适用于 Squoosh 模式。",
  );
}

if (
  usedLegacyPngQuality &&
  process.env[SUPPRESS_LEGACY_PNG_WARNING_ENV] !== "1"
) {
  console.warn("警告：--quality 已弃用，请改用 --png-quality。");
}

async function runTypeScript(
  relativeScript: string,
  argumentsList: readonly string[],
  description: string,
): Promise<void> {
  const scriptPath = path.join(
    process.cwd(),
    ...relativeScript.split("/"),
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...argumentsList],
      {
        cwd: process.cwd(),
        env: process.env,
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
            ? `${description} 退出码：${String(code)}`
            : `${description} 被信号 ${signal} 终止。`,
        ),
      );
    });
  });
}

await runTypeScript(
  "src/images/optimize-build-images.ts",
  forwardedArguments,
  "构建图片 PNG/TinyPNG 流程",
);

if (imageMode === "squoosh") {
  if (buildDirectory === undefined) {
    throw new Error("Squoosh JPEG 优化缺少构建目录。");
  }

  await runTypeScript(
    "src/squoosh/optimize-build-jpegs-cli.ts",
    [
      buildDirectory,
      `--quality=${jpegQuality}`,
      preview ? "--preview" : "--confirm",
    ],
    "Squoosh JPEG 优化",
  );
}
