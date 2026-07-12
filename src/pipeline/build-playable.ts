import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

type ImageMode = "none" | "tinypng" | "squoosh";
type TinyPngScope = { type: "all" } | { type: "limit"; limit: number };

interface Options {
  inputDirectory: string;
  outputFile: string;
  imageMode: ImageMode;
  projectName: string | null;
  keepWorkspace: boolean;
  tinyPngScope: TinyPngScope | null;
  minBytes: number | null;
  quality: number;
  colours: number;
  effort: number;
  dither: number;
  oxipngLevel: number;
  audioBitrateKbps: number | null;
  ffmpegPath: string;
}

interface DirectoryStats {
  fileCount: number;
  totalBytes: number;
  imageCount: number;
  imageBytes: number;
  audioCount: number;
  audioBytes: number;
}

interface BuildReport {
  schemaVersion: 1;
  tool: "playable-build";
  status: "succeeded";
  startedAt: string;
  completedAt: string;
  project: {
    key: string;
    explicitName: string | null;
  };
  input: {
    directory: string;
    fileCount: number;
    totalBytes: number;
    imageCount: number;
    imageBytes: number;
    audioCount: number;
    audioBytes: number;
  };
  workspace: {
    runDirectory: string;
    buildDirectory: string;
    kept: boolean;
  };
  imageOptimization: {
    mode: ImageMode;
    beforeBytes: number;
    afterBytes: number;
    savedBytes: number;
    savedPercent: number;
  };
  audioOptimization: {
    enabled: boolean;
    targetBitrateKbps: number | null;
    preserveChannels: true;
    beforeBytes: number;
    afterBytes: number;
    savedBytes: number;
    savedPercent: number;
  };
  output: {
    file: string;
    bytes: number;
    sha256: string;
    reportFile: string;
    projectReportFile: string;
  };
  timingMs: {
    copy: number;
    imageOptimization: number;
    audioOptimization: number;
    packaging: number;
    total: number;
  };
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function usage(): string {
  return [
    "Playable 全流程构建",
    "",
    "npm run playable:build -- <web-mobile目录> <输出HTML> --image-mode=squoosh",
    "npm run playable:build -- <web-mobile目录> <输出HTML> --image-mode=none",
    "npm run playable:build -- <web-mobile目录> <输出HTML> --image-mode=tinypng --all",
    "",
    "通用参数：",
    "  --project=<项目名>       显式指定 workspaces 下的项目名",
    "  --keep-workspace         成功后保留本次 web-mobile 副本",
    "  --audio-bitrate=48       将更高码率 MP3 转为目标码率；不传则关闭",
    "  --ffmpeg=ffmpeg          FFmpeg 命令或可执行文件路径",
    "",
    "TinyPNG 参数：",
    "  --all | --limit=N [--min-bytes=N]",
    "",
    "Squoosh 参数：",
    "  --quality=80 --colours=256 --effort=10",
    "  --dither=0.5 --oxipng-level=3 --min-bytes=0",
  ].join("\n");
}

function parseInteger(
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

function parseDecimal(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的数字。`);
  }
  return parsed;
}

function parseImageMode(value: string): ImageMode {
  if (value !== "none" && value !== "tinypng" && value !== "squoosh") {
    throw new Error(`无效图片压缩模式：${value}`);
  }
  return value;
}

function parseArguments(argv: readonly string[]): Options {
  const args = argv.filter((argument) => argument !== "--");
  const positional: string[] = [];

  let imageMode: ImageMode | null = null;
  let projectName: string | null = null;
  let keepWorkspace = false;
  let tinyPngScope: TinyPngScope | null = null;
  let minBytes: number | null = null;
  let quality = 80;
  let colours = 256;
  let effort = 10;
  let dither = 0.5;
  let oxipngLevel = 3;
  let audioBitrateKbps: number | null = null;
  let ffmpegPath = "ffmpeg";

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }

    if (argument === "--keep-workspace") {
      keepWorkspace = true;
      continue;
    }

    if (argument === "--all") {
      if (tinyPngScope !== null) {
        throw new Error("--all 与 --limit 不能同时使用。");
      }
      tinyPngScope = { type: "all" };
      continue;
    }

    if (argument.startsWith("--limit=")) {
      if (tinyPngScope !== null) {
        throw new Error("--all 与 --limit 不能同时使用。");
      }
      tinyPngScope = {
        type: "limit",
        limit: parseInteger(
          argument.slice("--limit=".length),
          "--limit",
          0,
          Number.MAX_SAFE_INTEGER,
        ),
      };
      continue;
    }

    if (argument.startsWith("--image-mode=")) {
      if (imageMode !== null) {
        throw new Error("图片压缩模式只能指定一次。");
      }
      imageMode = parseImageMode(argument.slice("--image-mode=".length));
      continue;
    }

    if (argument.startsWith("--mode=")) {
      if (imageMode !== null) {
        throw new Error("--image-mode 与兼容参数 --mode 不能同时使用。");
      }
      imageMode = parseImageMode(argument.slice("--mode=".length));
      console.warn("警告：--mode 已弃用，请改用 --image-mode。");
      continue;
    }

    if (argument.startsWith("--project=")) {
      projectName = argument.slice("--project=".length).trim();
      if (projectName.length === 0) {
        throw new Error("--project 不能为空。");
      }
      continue;
    }

    if (argument.startsWith("--min-bytes=")) {
      minBytes = parseInteger(
        argument.slice("--min-bytes=".length),
        "--min-bytes",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      continue;
    }

    if (argument.startsWith("--quality=")) {
      quality = parseInteger(
        argument.slice("--quality=".length),
        "--quality",
        0,
        100,
      );
      continue;
    }

    if (argument.startsWith("--colours=")) {
      colours = parseInteger(
        argument.slice("--colours=".length),
        "--colours",
        2,
        256,
      );
      continue;
    }

    if (argument.startsWith("--effort=")) {
      effort = parseInteger(
        argument.slice("--effort=".length),
        "--effort",
        1,
        10,
      );
      continue;
    }

    if (argument.startsWith("--dither=")) {
      dither = parseDecimal(
        argument.slice("--dither=".length),
        "--dither",
        0,
        1,
      );
      continue;
    }

    if (argument.startsWith("--oxipng-level=")) {
      oxipngLevel = parseInteger(
        argument.slice("--oxipng-level=".length),
        "--oxipng-level",
        1,
        6,
      );
      continue;
    }

    if (argument.startsWith("--audio-bitrate=")) {
      if (audioBitrateKbps !== null) {
        throw new Error("--audio-bitrate 只能指定一次。");
      }
      audioBitrateKbps = parseInteger(
        argument.slice("--audio-bitrate=".length),
        "--audio-bitrate",
        8,
        320,
      );
      continue;
    }

    if (argument.startsWith("--ffmpeg=")) {
      ffmpegPath = argument.slice("--ffmpeg=".length).trim();
      if (ffmpegPath.length === 0) {
        throw new Error("--ffmpeg 不能为空。");
      }
      continue;
    }

    if (argument.startsWith("-")) {
      throw new Error(`无法识别的参数：${argument}`);
    }

    positional.push(argument);
  }

  if (positional.length !== 2 || imageMode === null) {
    throw new Error(`${usage()}\n\n必须提供输入目录、输出 HTML 和 --image-mode。`);
  }

  if (imageMode === "tinypng" && tinyPngScope === null) {
    throw new Error(
      "TinyPNG 模式必须显式指定 --all 或 --limit=N，避免意外消耗 API 配额。",
    );
  }

  if (imageMode !== "tinypng" && tinyPngScope !== null) {
    throw new Error("--all 与 --limit 只适用于 TinyPNG 模式。");
  }

  if (imageMode === "squoosh" && minBytes !== null && minBytes !== 0) {
    throw new Error("Squoosh 生产流程要求 --min-bytes=0。");
  }

  return {
    inputDirectory: path.resolve(positional[0] ?? ""),
    outputFile: path.resolve(positional[1] ?? ""),
    imageMode,
    projectName,
    keepWorkspace,
    tinyPngScope,
    minBytes,
    quality,
    colours,
    effort,
    dither,
    oxipngLevel,
    audioBitrateKbps,
    ffmpegPath,
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

function normalizeForHash(value: string): string {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sanitizeProjectName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (sanitized.length === 0) {
    throw new Error(`项目名无法转换为安全目录名：${value}`);
  }
  return sanitized;
}

function inferProjectName(inputDirectory: string): string {
  const inputName = path.basename(inputDirectory);
  const parentDirectory = path.dirname(inputDirectory);
  const parentName = path.basename(parentDirectory);

  if (
    inputName.toLowerCase() === "web-mobile" &&
    parentName.toLowerCase() === "build"
  ) {
    return path.basename(path.dirname(parentDirectory));
  }

  return parentName || inputName || "project";
}

function createProjectKey(options: Options): string {
  if (options.projectName !== null) {
    return sanitizeProjectName(options.projectName);
  }

  const name = sanitizeProjectName(inferProjectName(options.inputDirectory));
  const pathHash = createHash("sha256")
    .update(normalizeForHash(options.inputDirectory))
    .digest("hex")
    .slice(0, 8);
  return `${name}-${pathHash}`;
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

function isInside(parentDirectory: string, candidate: string): boolean {
  const relative = path.relative(parentDirectory, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function validateOptions(options: Options): Promise<void> {
  const inputInfo = await stat(options.inputDirectory).catch(() => null);
  if (!inputInfo?.isDirectory()) {
    throw new Error(`构建目录不存在：${options.inputDirectory}`);
  }

  if (!(await exists(path.join(options.inputDirectory, "index.html")))) {
    throw new Error(`构建目录缺少 index.html：${options.inputDirectory}`);
  }

  if (path.extname(options.outputFile).toLowerCase() !== ".html") {
    throw new Error(`输出文件必须是 .html：${options.outputFile}`);
  }

  if (isInside(options.inputDirectory, options.outputFile)) {
    throw new Error("输出 HTML 不能位于输入构建目录内部。");
  }
}

async function collectDirectoryStats(directory: string): Promise<DirectoryStats> {
  let fileCount = 0;
  let totalBytes = 0;
  let imageCount = 0;
  let imageBytes = 0;
  let audioCount = 0;
  let audioBytes = 0;

  async function visit(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const info = await stat(absolutePath);
      fileCount += 1;
      totalBytes += info.size;
      if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        imageCount += 1;
        imageBytes += info.size;
      }
      if (path.extname(entry.name).toLowerCase() === ".mp3") {
        audioCount += 1;
        audioBytes += info.size;
      }
    }
  }

  await visit(directory);
  return { fileCount, totalBytes, imageCount, imageBytes, audioCount, audioBytes };
}

async function runTypeScript(
  projectRoot: string,
  relativeScript: string,
  argumentsList: readonly string[],
): Promise<void> {
  const scriptPath = path.join(projectRoot, ...relativeScript.split("/"));
  if (!(await exists(scriptPath))) {
    throw new Error(`缺少脚本：${scriptPath}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...argumentsList],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: "inherit",
        windowsHide: false,
      },
    );

    child.once("error", reject);
    child.once(
      "exit",
      (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            signal === null
              ? `${relativeScript} 退出码：${String(code)}`
              : `${relativeScript} 被信号 ${signal} 终止。`,
          ),
        );
      },
    );
  });
}

function createImageArguments(options: Options, buildDirectory: string): string[] {
  const args = [buildDirectory, `--image-mode=${options.imageMode}`];

  if (options.tinyPngScope?.type === "all") {
    args.push("--all");
  } else if (options.tinyPngScope?.type === "limit") {
    args.push(`--limit=${options.tinyPngScope.limit}`);
  }

  if (options.minBytes !== null) {
    args.push(`--min-bytes=${options.minBytes}`);
  }

  if (options.imageMode === "squoosh") {
    args.push(
      `--quality=${options.quality}`,
      `--colours=${options.colours}`,
      `--effort=${options.effort}`,
      `--dither=${options.dither}`,
      `--oxipng-level=${options.oxipngLevel}`,
    );
  }

  return args;
}

function createAudioArguments(
  options: Options,
  buildDirectory: string,
  reportFile: string,
): string[] {
  if (options.audioBitrateKbps === null) {
    return [];
  }
  return [
    buildDirectory,
    `--bitrate=${options.audioBitrateKbps}`,
    "--confirm",
    `--ffmpeg=${options.ffmpegPath}`,
    `--report=${reportFile}`,
  ];
}

function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".report.json");
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function promoteOutput(tempFile: string, outputFile: string): Promise<void> {
  const previousFile = `${outputFile}.previous-${process.pid}`;
  let movedPrevious = false;

  try {
    await rm(previousFile, { force: true });
    if (await exists(outputFile)) {
      await rename(outputFile, previousFile);
      movedPrevious = true;
    }

    await rename(tempFile, outputFile);

    if (movedPrevious) {
      await rm(previousFile, { force: true });
    }
  } catch (error) {
    if (
      movedPrevious &&
      !(await exists(outputFile)) &&
      (await exists(previousFile))
    ) {
      await rename(previousFile, outputFile);
    }
    throw error;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const projectRoot = process.cwd();
  const startedAt = new Date();
  const totalStart = performance.now();

  await validateOptions(options);

  const projectKey = createProjectKey(options);
  const timestamp = createTimestamp();
  const projectDirectory = path.join(projectRoot, "workspaces", projectKey);
  const runDirectory = path.join(projectDirectory, "runs", timestamp);
  const workspaceBuildDirectory = path.join(runDirectory, "web-mobile");
  const projectReportFile = path.join(
    projectDirectory,
    "reports",
    `${timestamp}.json`,
  );
  const audioOptimizationReportFile = path.join(
    runDirectory,
    "audio-optimization.json",
  );
  const outputReportFile = reportPathForOutput(options.outputFile);
  const tempOutputFile = `${options.outputFile}.tmp-${process.pid}-${timestamp}`;

  console.log("Playable 全流程构建");
  console.log("-----------------");
  console.log(`项目：${projectKey}`);
  console.log(`输入：${options.inputDirectory}`);
  console.log(`工作区：${workspaceBuildDirectory}`);
  console.log(`图片压缩模式：${options.imageMode}`);
  console.log(`音频压缩：${options.audioBitrateKbps === null ? "关闭" : `${options.audioBitrateKbps} kbps（保持声道）`}`);
  console.log(`输出：${options.outputFile}`);
  console.log("");

  const inputStats = await collectDirectoryStats(options.inputDirectory);

  let copyMs = 0;
  let imageOptimizationMs = 0;
  let audioOptimizationMs = 0;
  let packagingMs = 0;

  try {
    const copyStart = performance.now();
    await mkdir(runDirectory, { recursive: true });
    await cp(options.inputDirectory, workspaceBuildDirectory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    copyMs = performance.now() - copyStart;

    const imageStart = performance.now();
    await runTypeScript(
      projectRoot,
      "src/images/optimize-build-images-cli.ts",
      createImageArguments(options, workspaceBuildDirectory),
    );
    imageOptimizationMs = performance.now() - imageStart;

    const afterImageStats = await collectDirectoryStats(workspaceBuildDirectory);

    if (options.audioBitrateKbps !== null) {
      const audioStart = performance.now();
      await runTypeScript(
        projectRoot,
        "src/audio/optimize-build-audio.ts",
        createAudioArguments(
          options,
          workspaceBuildDirectory,
          audioOptimizationReportFile,
        ),
      );
      audioOptimizationMs = performance.now() - audioStart;
    }

    const optimizedStats = await collectDirectoryStats(workspaceBuildDirectory);

    await mkdir(path.dirname(options.outputFile), { recursive: true });
    await rm(tempOutputFile, { force: true });

    const packagingStart = performance.now();
    await runTypeScript(
      projectRoot,
      "src/pack-compressed-cli.ts",
      [workspaceBuildDirectory, tempOutputFile],
    );
    packagingMs = performance.now() - packagingStart;

    const tempInfo = await stat(tempOutputFile).catch(() => null);
    if (!tempInfo?.isFile() || tempInfo.size === 0) {
      throw new Error(`打包未生成有效 HTML：${tempOutputFile}`);
    }

    await promoteOutput(tempOutputFile, options.outputFile);

    const outputInfo = await stat(options.outputFile);
    const savedBytes = inputStats.imageBytes - optimizedStats.imageBytes;
    const savedPercent =
      inputStats.imageBytes === 0
        ? 0
        : (savedBytes / inputStats.imageBytes) * 100;
    const audioSavedBytes = afterImageStats.audioBytes - optimizedStats.audioBytes;
    const audioSavedPercent =
      afterImageStats.audioBytes === 0
        ? 0
        : (audioSavedBytes / afterImageStats.audioBytes) * 100;

    const report: BuildReport = {
      schemaVersion: 1,
      tool: "playable-build",
      status: "succeeded",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      project: {
        key: projectKey,
        explicitName: options.projectName,
      },
      input: {
        directory: options.inputDirectory,
        fileCount: inputStats.fileCount,
        totalBytes: inputStats.totalBytes,
        imageCount: inputStats.imageCount,
        imageBytes: inputStats.imageBytes,
        audioCount: inputStats.audioCount,
        audioBytes: inputStats.audioBytes,
      },
      workspace: {
        runDirectory,
        buildDirectory: workspaceBuildDirectory,
        kept: options.keepWorkspace,
      },
      imageOptimization: {
        mode: options.imageMode,
        beforeBytes: inputStats.imageBytes,
        afterBytes: optimizedStats.imageBytes,
        savedBytes,
        savedPercent,
      },
      audioOptimization: {
        enabled: options.audioBitrateKbps !== null,
        targetBitrateKbps: options.audioBitrateKbps,
        preserveChannels: true,
        beforeBytes: afterImageStats.audioBytes,
        afterBytes: optimizedStats.audioBytes,
        savedBytes: audioSavedBytes,
        savedPercent: audioSavedPercent,
      },
      output: {
        file: options.outputFile,
        bytes: outputInfo.size,
        sha256: await hashFile(options.outputFile),
        reportFile: outputReportFile,
        projectReportFile,
      },
      timingMs: {
        copy: copyMs,
        imageOptimization: imageOptimizationMs,
        audioOptimization: audioOptimizationMs,
        packaging: packagingMs,
        total: performance.now() - totalStart,
      },
    };

    await writeJson(outputReportFile, report);
    await writeJson(projectReportFile, report);

    if (!options.keepWorkspace) {
      await rm(runDirectory, { recursive: true, force: true });
    }

    console.log("");
    console.log("全流程构建完成");
    console.log("----------------");
    console.log(`项目：${projectKey}`);
    console.log(`图片数量：${inputStats.imageCount}`);
    console.log(`图片优化前：${formatBytes(inputStats.imageBytes)}`);
    console.log(`图片优化后：${formatBytes(optimizedStats.imageBytes)}`);
    console.log(
      `图片减少：${formatBytes(savedBytes)} (${savedPercent.toFixed(2)}%)`,
    );
    console.log(`音频数量：${inputStats.audioCount}`);
    console.log(`音频优化前：${formatBytes(afterImageStats.audioBytes)}`);
    console.log(`音频优化后：${formatBytes(optimizedStats.audioBytes)}`);
    console.log(
      `音频减少：${formatBytes(audioSavedBytes)} (${audioSavedPercent.toFixed(2)}%)`,
    );
    console.log(`最终 HTML：${formatBytes(outputInfo.size)}`);
    console.log(`SHA-256：${report.output.sha256}`);
    console.log(`输出报告：${outputReportFile}`);
    console.log(`项目报告：${projectReportFile}`);
    console.log(`总耗时：${report.timingMs.total.toFixed(2)} ms`);
    console.log(`工作区：${options.keepWorkspace ? "已保留" : "已清理"}`);
  } catch (error) {
    await rm(tempOutputFile, { force: true }).catch(() => undefined);

    const failureReport = {
      schemaVersion: 1,
      tool: "playable-build",
      status: "failed",
      startedAt: startedAt.toISOString(),
      failedAt: new Date().toISOString(),
      projectKey,
      inputDirectory: options.inputDirectory,
      outputFile: options.outputFile,
      runDirectory,
      imageMode: options.imageMode,
      audioBitrateKbps: options.audioBitrateKbps,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
    await writeJson(path.join(runDirectory, "failure.json"), failureReport).catch(
      () => undefined,
    );

    console.error("");
    console.error(`失败工作区已保留：${runDirectory}`);
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error("");
  console.error("Playable 全流程构建失败");
  console.error("----------------------");
  console.error(
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
  process.exitCode = 1;
});
