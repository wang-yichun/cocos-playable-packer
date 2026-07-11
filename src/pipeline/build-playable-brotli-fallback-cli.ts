import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

type BrotliFallbackMode = "raw-js" | "gzip-packed-js";
type JsonObject = Record<string, unknown>;

export interface BrotliFallbackCliOptions {
  fallbackMode: BrotliFallbackMode;
  passthroughArgs: string[];
  outputArgumentIndex: number;
  outputFile: string;
}

function usage(): string {
  return [
    "Playable 全流程构建（支持 Brotli 回退解码器存储模式）",
    "",
    "npm run playable:build -- <web-mobile目录> <输出HTML> --image-mode=squoosh --payload-encoding=base64 --brotli-fallback=raw-js",
    "npm run playable:build -- <web-mobile目录> <输出HTML> --image-mode=squoosh --payload-encoding=base64 --brotli-fallback=gzip-packed-js",
    "",
    "Brotli 回退模式：",
    "  raw-js          原始 JavaScript 解码器，默认模式，兼容性最高",
    "  gzip-packed-js  gzip 压缩后内嵌，运行时通过 DecompressionStream('gzip') 展开",
    "",
    "未指定 --brotli-fallback 时默认使用 raw-js。",
    "其他参数原样转发给原有 playable:build 流程。",
  ].join("\n");
}

function parseFallbackMode(value: string): BrotliFallbackMode {
  if (value === "raw-js" || value === "gzip-packed-js") {
    return value;
  }

  throw new Error(`无效 Brotli 回退模式：${value}`);
}

export function parseBrotliFallbackArguments(
  argv: readonly string[],
): BrotliFallbackCliOptions {
  const args = argv.filter((argument) => argument !== "--");

  if (args.includes("-h") || args.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }

  let fallbackMode: BrotliFallbackMode = "raw-js";
  let fallbackModeSpecified = false;
  const passthroughArgs: string[] = [];
  const positionalIndexes: number[] = [];

  for (const argument of args) {
    if (argument.startsWith("--brotli-fallback=")) {
      if (fallbackModeSpecified) {
        throw new Error("--brotli-fallback 只能指定一次。");
      }

      fallbackMode = parseFallbackMode(
        argument.slice("--brotli-fallback=".length),
      );
      fallbackModeSpecified = true;
      continue;
    }

    const index = passthroughArgs.length;
    passthroughArgs.push(argument);

    if (!argument.startsWith("-")) {
      positionalIndexes.push(index);
    }
  }

  if (positionalIndexes.length !== 2) {
    throw new Error(`${usage()}\n\n必须提供输入目录和输出 HTML。`);
  }

  const outputArgumentIndex = positionalIndexes[1];
  if (outputArgumentIndex === undefined) {
    throw new Error("无法确定输出 HTML 参数位置。");
  }

  const outputArgument = passthroughArgs[outputArgumentIndex];
  if (outputArgument === undefined) {
    throw new Error("缺少输出 HTML 参数。");
  }

  const outputFile = path.resolve(outputArgument);
  if (path.extname(outputFile).toLowerCase() !== ".html") {
    throw new Error(`输出文件必须是 .html：${outputFile}`);
  }

  return {
    fallbackMode,
    passthroughArgs,
    outputArgumentIndex,
    outputFile,
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

function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".report.json");
}

function fallbackReportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".brotli-decoder-report.json");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(filePath: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isJsonObject(parsed)) {
    throw new Error(`JSON 根节点必须是对象：${filePath}`);
  }
  return parsed;
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

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function promotePair(
  tempOutputFile: string,
  outputFile: string,
  tempReportFile: string,
  reportFile: string,
): Promise<void> {
  const token = `${process.pid}-${Date.now()}`;
  const outputBackup = `${outputFile}.previous-${token}`;
  const reportBackup = `${reportFile}.previous-${token}`;
  let outputBackedUp = false;
  let reportBackedUp = false;
  let outputPromoted = false;
  let reportPromoted = false;

  try {
    await rm(outputBackup, { force: true });
    await rm(reportBackup, { force: true });

    if (await exists(outputFile)) {
      await rename(outputFile, outputBackup);
      outputBackedUp = true;
    }

    if (await exists(reportFile)) {
      await rename(reportFile, reportBackup);
      reportBackedUp = true;
    }

    await rename(tempOutputFile, outputFile);
    outputPromoted = true;
    await rename(tempReportFile, reportFile);
    reportPromoted = true;

    await rm(outputBackup, { force: true });
    await rm(reportBackup, { force: true });
  } catch (error) {
    if (reportPromoted) {
      await rm(reportFile, { force: true }).catch(() => undefined);
    }
    if (outputPromoted) {
      await rm(outputFile, { force: true }).catch(() => undefined);
    }
    if (reportBackedUp && (await exists(reportBackup))) {
      await rename(reportBackup, reportFile).catch(() => undefined);
    }
    if (outputBackedUp && (await exists(outputBackup))) {
      await rename(outputBackup, outputFile).catch(() => undefined);
    }
    throw error;
  }
}

export function createIntegratedFallbackReport(
  coreReport: JsonObject,
  fallbackReport: JsonObject,
  finalOutputFile: string,
  finalReportFile: string,
  finalOutputBytes: number,
  finalOutputSha256: string,
  fallbackOptimizationMs: number,
  totalMs: number,
): JsonObject {
  const coreOutput = requireObject(coreReport, "output", "核心构建报告");
  const coreTiming = requireObject(coreReport, "timingMs", "核心构建报告");
  const compatibility = requireObject(
    fallbackReport,
    "compatibility",
    "Brotli 回退优化报告",
  );
  const fallback = requireObject(
    fallbackReport,
    "fallback",
    "Brotli 回退优化报告",
  );
  const projectReportFile = requireString(
    coreOutput,
    "projectReportFile",
    "核心构建报告",
  );

  return {
    ...coreReport,
    schemaVersion: 3,
    completedAt: new Date().toISOString(),
    brotliFallback: {
      mode: "gzip-packed-js",
      compatibility,
      ...fallback,
    },
    output: {
      ...coreOutput,
      file: finalOutputFile,
      bytes: finalOutputBytes,
      sha256: finalOutputSha256,
      reportFile: finalReportFile,
      projectReportFile,
    },
    timingMs: {
      ...coreTiming,
      brotliFallbackOptimization: fallbackOptimizationMs,
      total: totalMs,
    },
  };
}

async function main(): Promise<void> {
  const options = parseBrotliFallbackArguments(process.argv.slice(2));
  const projectRoot = process.cwd();

  if (options.fallbackMode === "raw-js") {
    await runTypeScript(
      projectRoot,
      "src/pipeline/build-playable-cli.ts",
      options.passthroughArgs,
    );
    return;
  }

  const startedAt = performance.now();
  const outputDirectory = path.dirname(options.outputFile);
  const outputStem = path.basename(
    options.outputFile,
    path.extname(options.outputFile),
  );
  const token = `${process.pid}-${Date.now()}`;
  const tempRawOutputFile = path.join(
    outputDirectory,
    `.${outputStem}.raw-fallback-${token}.html`,
  );
  const tempOptimizedOutputFile = path.join(
    outputDirectory,
    `.${outputStem}.gzip-fallback-${token}.html`,
  );
  const rawReportFile = reportPathForOutput(tempRawOutputFile);
  const fallbackReportFile = fallbackReportPathForOutput(tempOptimizedOutputFile);
  const finalReportFile = reportPathForOutput(options.outputFile);
  const tempFinalReportFile = `${finalReportFile}.tmp-${token}`;
  const forwardedArgs = [...options.passthroughArgs];
  forwardedArgs[options.outputArgumentIndex] = tempRawOutputFile;

  await mkdir(outputDirectory, { recursive: true });

  try {
    await runTypeScript(
      projectRoot,
      "src/pipeline/build-playable-cli.ts",
      forwardedArgs,
    );

    const fallbackStartedAt = performance.now();
    await runTypeScript(
      projectRoot,
      "src/compression/optimize-brotli-fallback.ts",
      [tempRawOutputFile, tempOptimizedOutputFile],
    );
    const fallbackOptimizationMs = performance.now() - fallbackStartedAt;

    const finalInfo = await stat(tempOptimizedOutputFile).catch(() => null);
    if (!finalInfo?.isFile() || finalInfo.size === 0) {
      throw new Error(`没有生成有效的 gzip-packed HTML：${tempOptimizedOutputFile}`);
    }

    const coreReport = await readJsonObject(rawReportFile);
    const fallbackReport = await readJsonObject(fallbackReportFile);
    const coreOutput = requireObject(coreReport, "output", rawReportFile);
    const projectReportFile = requireString(
      coreOutput,
      "projectReportFile",
      rawReportFile,
    );
    const finalSha256 = await hashFile(tempOptimizedOutputFile);
    const report = createIntegratedFallbackReport(
      coreReport,
      fallbackReport,
      options.outputFile,
      finalReportFile,
      finalInfo.size,
      finalSha256,
      fallbackOptimizationMs,
      performance.now() - startedAt,
    );

    await writeJson(tempFinalReportFile, report);
    await promotePair(
      tempOptimizedOutputFile,
      options.outputFile,
      tempFinalReportFile,
      finalReportFile,
    );
    await writeJson(projectReportFile, report);

    console.log("");
    console.log("Brotli 回退优化流水线完成");
    console.log("------------------------");
    console.log("回退模式：gzip-packed-js");
    console.log(`输出：${options.outputFile}`);
    console.log(`最终 HTML：${finalInfo.size} B`);
    console.log(`SHA-256：${finalSha256}`);
    console.log(`报告：${finalReportFile}`);
  } finally {
    await rm(tempRawOutputFile, { force: true }).catch(() => undefined);
    await rm(tempOptimizedOutputFile, { force: true }).catch(() => undefined);
    await rm(rawReportFile, { force: true }).catch(() => undefined);
    await rm(fallbackReportFile, { force: true }).catch(() => undefined);
    await rm(tempFinalReportFile, { force: true }).catch(() => undefined);
  }
}

const entryFile = process.argv[1];
if (
  entryFile !== undefined
  && import.meta.url === pathToFileURL(entryFile).href
) {
  main().catch((error: unknown) => {
    console.error("");
    console.error("Brotli 回退优化流水线失败");
    console.error("--------------------------");
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
