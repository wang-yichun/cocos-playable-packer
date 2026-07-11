import { createHash } from "node:crypto";
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
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from "node:zlib";

import {
  compressLzma,
  decompressLzma,
  loadBrowserDecoderBundle,
} from "./lzma-js-adapter.js";
import {
  extractPackedArchive,
  getBrotliDecoderSourceBytes,
  patchRuntimeForLzma,
  replaceBrotliDecoderScript,
  replacePackedArchive,
  type PackedArchive,
} from "./packed-html.js";

export interface CliOptions {
  inputFile: string;
  outputFile: string;
  iterations: number;
  lzmaLevel: number;
}

interface TimingSummary {
  iterations: number;
  averageMs: number;
  medianMs: number;
  minimumMs: number;
  maximumMs: number;
}

interface MemorySummary {
  minimumRssBytes: number;
  maximumRssBytes: number;
  maximumObservedRssDeltaBytes: number;
  maximumObservedHeapUsedDeltaBytes: number;
}

interface Measurement<T> {
  value: T;
  timing: TimingSummary;
  memory: MemorySummary;
}

interface BenchmarkResult {
  reportFile: string;
  report: Record<string, unknown>;
}

function usage(): string {
  return [
    "LZMA + Base64 独立研究工具",
    "",
    "npm run compression:lzma -- <Brotli+Base64输入HTML> <LZMA+Base64输出HTML> [--iterations=3] [--lzma-level=9]",
    "",
    "说明：",
    "  工具先从输入 HTML 恢复原始归档字节，再让 Brotli 与 LZMA 使用同一份字节。",
    "  不会修改正式 playable:build Pipeline，也不会覆盖输入 HTML。",
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

export function parseArguments(argv: readonly string[]): CliOptions {
  const args = argv.filter((argument) => argument !== "--");
  const positional: string[] = [];
  let iterations = 3;
  let lzmaLevel = 9;

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument.startsWith("--iterations=")) {
      iterations = parseInteger(
        argument.slice("--iterations=".length),
        "--iterations",
        1,
        20,
      );
      continue;
    }
    if (argument.startsWith("--lzma-level=")) {
      lzmaLevel = parseInteger(
        argument.slice("--lzma-level=".length),
        "--lzma-level",
        1,
        9,
      );
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`无法识别的参数：${argument}`);
    }
    positional.push(argument);
  }

  if (positional.length !== 2) {
    throw new Error(`${usage()}\n\n必须提供输入 HTML 和输出 HTML。`);
  }
  const inputFile = path.resolve(positional[0] ?? "");
  const outputFile = path.resolve(positional[1] ?? "");
  if (inputFile === outputFile) {
    throw new Error("输入 HTML 和输出 HTML 不能是同一个文件。");
  }
  if (path.extname(inputFile).toLowerCase() !== ".html") {
    throw new Error(`输入文件必须是 .html：${inputFile}`);
  }
  if (path.extname(outputFile).toLowerCase() !== ".html") {
    throw new Error(`输出文件必须是 .html：${outputFile}`);
  }
  return { inputFile, outputFile, iterations, lzmaLevel };
}

function sha256(input: Uint8Array | Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function measureSync<T>(iterations: number, callback: () => T): Measurement<T> {
  const times: number[] = [];
  const rssValues: number[] = [];
  let maxRssDelta = Number.NEGATIVE_INFINITY;
  let maxHeapDelta = Number.NEGATIVE_INFINITY;
  let value: T | undefined;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const beforeMemory = process.memoryUsage();
    rssValues.push(beforeMemory.rss);
    const startedAt = performance.now();
    value = callback();
    times.push(performance.now() - startedAt);
    const afterMemory = process.memoryUsage();
    rssValues.push(afterMemory.rss);
    maxRssDelta = Math.max(maxRssDelta, afterMemory.rss - beforeMemory.rss);
    maxHeapDelta = Math.max(
      maxHeapDelta,
      afterMemory.heapUsed - beforeMemory.heapUsed,
    );
  }

  if (value === undefined) {
    throw new Error("基准测试没有产生结果。");
  }
  const total = times.reduce((sum, current) => sum + current, 0);
  return {
    value,
    timing: {
      iterations,
      averageMs: total / times.length,
      medianMs: median(times),
      minimumMs: Math.min(...times),
      maximumMs: Math.max(...times),
    },
    memory: {
      minimumRssBytes: Math.min(...rssValues),
      maximumRssBytes: Math.max(...rssValues),
      maximumObservedRssDeltaBytes: Math.max(0, maxRssDelta),
      maximumObservedHeapUsedDeltaBytes: Math.max(0, maxHeapDelta),
    },
  };
}

function compressBrotli(input: Buffer): Buffer {
  return brotliCompressSync(input, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: input.byteLength,
    },
  });
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

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator * 100;
}

function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".lzma-report.json");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

function parseLzmaHeader(input: Buffer): Record<string, unknown> {
  if (input.byteLength < 13) {
    throw new Error(`LZMA 数据不足 13 字节：${input.byteLength}`);
  }

  const uncompressedSize = input.readBigUInt64LE(5);
  return {
    propertiesByte: input[0] ?? null,
    dictionarySizeBytes: input.readUInt32LE(1),
    uncompressedSize:
      uncompressedSize <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(uncompressedSize)
        : uncompressedSize.toString(),
  };
}

function validateInputArchive(archive: PackedArchive): void {
  if (archive.c !== "br") {
    throw new Error(`输入 HTML 必须使用 Brotli，当前算法：${String(archive.c)}`);
  }
  if (archive.e !== undefined && archive.e !== "base64") {
    throw new Error(`输入 HTML 必须使用 Base64，当前编码：${String(archive.e)}`);
  }
  if (!Number.isInteger(archive.u) || (archive.u ?? 0) < 0) {
    throw new Error("输入 HTML 的原始归档长度无效。");
  }
}

export async function runBenchmark(options: CliOptions): Promise<BenchmarkResult> {
  const startedAt = new Date();
  const totalStartedAt = performance.now();
  const inputHtmlBuffer = await readFile(options.inputFile);
  const inputHtml = inputHtmlBuffer.toString("utf8");
  const extracted = extractPackedArchive(inputHtml);
  validateInputArchive(extracted.archive);

  const inputBrotliBinary = Buffer.from(extracted.archive.b, "base64");
  const archiveRawBuffer = brotliDecompressSync(inputBrotliBinary);
  if (archiveRawBuffer.byteLength !== extracted.archive.u) {
    throw new Error(
      `Brotli 基线解压长度不匹配：期望 ${String(extracted.archive.u)}，实际 ${archiveRawBuffer.byteLength}`,
    );
  }

  const archiveSha256 = sha256(archiveRawBuffer);
  const inputBrotliSha256 = sha256(inputBrotliBinary);
  const brotliDecoderSourceBytes = getBrotliDecoderSourceBytes(inputHtml);

  console.log("LZMA 压缩公平基准");
  console.log("-----------------");
  console.log(`输入 HTML：${options.inputFile}`);
  console.log(`输出 HTML：${options.outputFile}`);
  console.log(`原始归档：${formatBytes(archiveRawBuffer.byteLength)}`);
  console.log(`原始 SHA-256：${archiveSha256}`);
  console.log(`测试次数：${options.iterations}`);
  console.log(`LZMA level：${options.lzmaLevel}`);
  console.log("");

  const brotliCompression = measureSync(
    options.iterations,
    () => compressBrotli(archiveRawBuffer),
  );
  const lzmaCompression = measureSync(
    options.iterations,
    () => compressLzma(Buffer.from(archiveRawBuffer), options.lzmaLevel),
  );
  const brotliDecode = measureSync(
    options.iterations,
    () => brotliDecompressSync(inputBrotliBinary),
  );
  const lzmaDecode = measureSync(
    options.iterations,
    () => decompressLzma(lzmaCompression.value),
  );

  const brotliRoundTrip = equalBytes(archiveRawBuffer, brotliDecode.value);
  const lzmaRoundTrip = equalBytes(archiveRawBuffer, lzmaDecode.value);
  if (!brotliRoundTrip || !lzmaRoundTrip) {
    throw new Error(
      `回环校验失败：Brotli=${String(brotliRoundTrip)}，LZMA=${String(lzmaRoundTrip)}`,
    );
  }

  const browserDecoder = await loadBrowserDecoderBundle();
  const lzmaArchive: PackedArchive = {
    ...extracted.archive,
    c: "lzma",
    e: "base64",
    u: archiveRawBuffer.byteLength,
    b: lzmaCompression.value.toString("base64"),
  };

  let lzmaHtml = replacePackedArchive(inputHtml, extracted, lzmaArchive);
  lzmaHtml = replaceBrotliDecoderScript(lzmaHtml, browserDecoder.source);
  const runtimePatch = patchRuntimeForLzma(lzmaHtml);
  lzmaHtml = runtimePatch.html;

  const lzmaHtmlBuffer = Buffer.from(lzmaHtml, "utf8");
  const outputDirectory = path.dirname(options.outputFile);
  const reportFile = reportPathForOutput(options.outputFile);
  const token = `${process.pid}-${Date.now()}`;
  const tempOutputFile = `${options.outputFile}.tmp-${token}`;
  const tempReportFile = `${reportFile}.tmp-${token}`;

  const inputBrotliRecompressedMatches = equalBytes(
    inputBrotliBinary,
    brotliCompression.value,
  );
  const lzmaDecodedSha256 = sha256(lzmaDecode.value);
  const brotliDecodedSha256 = sha256(brotliDecode.value);
  const savedBytes = inputHtmlBuffer.byteLength - lzmaHtmlBuffer.byteLength;

  const report: Record<string, unknown> = {
    schemaVersion: 1,
    tool: "lzma-compression-benchmark",
    status: "succeeded",
    generatedAt: new Date().toISOString(),
    input: {
      htmlFile: options.inputFile,
      htmlBytes: inputHtmlBuffer.byteLength,
      htmlSha256: sha256(inputHtmlBuffer),
      compression: "brotli",
      payloadEncoding: "base64",
    },
    archive: {
      bytes: archiveRawBuffer.byteLength,
      sha256: archiveSha256,
    },
    brotli: {
      quality: 11,
      binaryBytes: inputBrotliBinary.byteLength,
      binarySha256: inputBrotliSha256,
      recompressedBinaryBytes: brotliCompression.value.byteLength,
      recompressedBinarySha256: sha256(brotliCompression.value),
      recompressedMatchesInput: inputBrotliRecompressedMatches,
      compressionRatioPercent: percentage(
        inputBrotliBinary.byteLength,
        archiveRawBuffer.byteLength,
      ),
      compressionTimingMs: brotliCompression.timing,
      compressionMemory: brotliCompression.memory,
      nodeDecodeTimingMs: brotliDecode.timing,
      nodeDecodeMemory: brotliDecode.memory,
      decoderSourceBytes: brotliDecoderSourceBytes,
      base64PayloadCharacters: extracted.archive.b.length,
      base64PayloadBytes: Buffer.byteLength(extracted.archive.b),
      decodedBytes: brotliDecode.value.byteLength,
      decodedSha256: brotliDecodedSha256,
      roundTrip: brotliRoundTrip,
      finalHtmlFile: options.inputFile,
      finalHtmlBytes: inputHtmlBuffer.byteLength,
      finalHtmlSha256: sha256(inputHtmlBuffer),
    },
    lzma: {
      implementation: "LZMA-JS",
      implementationVersion: "2.3.2",
      license: "MIT",
      level: options.lzmaLevel,
      binaryBytes: lzmaCompression.value.byteLength,
      binarySha256: sha256(lzmaCompression.value),
      header: parseLzmaHeader(lzmaCompression.value),
      compressionRatioPercent: percentage(
        lzmaCompression.value.byteLength,
        archiveRawBuffer.byteLength,
      ),
      compressionTimingMs: lzmaCompression.timing,
      compressionMemory: lzmaCompression.memory,
      nodeDecodeTimingMs: lzmaDecode.timing,
      nodeDecodeMemory: lzmaDecode.memory,
      decoderSourceBytes: browserDecoder.sourceBytes,
      decoderCoreBytes: browserDecoder.decoderCoreBytes,
      decoderWrapperBytes: browserDecoder.wrapperBytes,
      licenseNoticeBytes: browserDecoder.licenseNoticeBytes,
      startupCodeBytes: runtimePatch.startupCodeBytes,
      base64PayloadCharacters: lzmaArchive.b.length,
      base64PayloadBytes: Buffer.byteLength(lzmaArchive.b),
      decodedBytes: lzmaDecode.value.byteLength,
      decodedSha256: lzmaDecodedSha256,
      roundTrip: lzmaRoundTrip,
      finalHtmlFile: options.outputFile,
      finalHtmlBytes: lzmaHtmlBuffer.byteLength,
      finalHtmlSha256: sha256(lzmaHtmlBuffer),
      browserMetrics: {
        runtimeGlobal: "window.__PACK_RUNTIME_METRICS__",
        browserDecodeMs: null,
        pageToGameStartMs: null,
        usedJSHeapBeforeDecodeBytes: null,
        usedJSHeapAfterDecodeBytes: null,
        usedJSHeapAfterBootBytes: null,
        note: "浏览器运行后从控制台或 window.__PACK_RUNTIME_METRICS__ 读取。",
      },
    },
    comparison: {
      binarySavedBytes: inputBrotliBinary.byteLength - lzmaCompression.value.byteLength,
      binarySavedPercent: percentage(
        inputBrotliBinary.byteLength - lzmaCompression.value.byteLength,
        inputBrotliBinary.byteLength,
      ),
      finalHtmlSavedBytes: savedBytes,
      finalHtmlSavedPercent: percentage(savedBytes, inputHtmlBuffer.byteLength),
    },
    timingMs: {
      total: performance.now() - totalStartedAt,
    },
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
  };

  await mkdir(outputDirectory, { recursive: true });
  try {
    await writeFile(tempOutputFile, lzmaHtmlBuffer);
    await writeFile(tempReportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const [outputInfo, reportInfo] = await Promise.all([
      stat(tempOutputFile),
      stat(tempReportFile),
    ]);
    if (outputInfo.size === 0 || reportInfo.size === 0) {
      throw new Error("临时输出文件无效。");
    }
    await promotePair(
      tempOutputFile,
      options.outputFile,
      tempReportFile,
      reportFile,
    );
  } catch (error) {
    await rm(tempOutputFile, { force: true }).catch(() => undefined);
    await rm(tempReportFile, { force: true }).catch(() => undefined);
    throw error;
  }

  console.log("比较完成");
  console.log("--------");
  console.log(`Brotli 二进制：${formatBytes(inputBrotliBinary.byteLength)}`);
  console.log(`LZMA 二进制：${formatBytes(lzmaCompression.value.byteLength)}`);
  console.log(
    `二进制净节省：${formatBytes(inputBrotliBinary.byteLength - lzmaCompression.value.byteLength)}`,
  );
  console.log(`Brotli HTML：${formatBytes(inputHtmlBuffer.byteLength)}`);
  console.log(`LZMA HTML：${formatBytes(lzmaHtmlBuffer.byteLength)}`);
  console.log(`HTML 净节省：${formatBytes(savedBytes)}`);
  console.log(`输出 HTML：${options.outputFile}`);
  console.log(`报告：${reportFile}`);
  console.log("");
  console.log("请通过 npm run serve 使用 HTTP 测试，并复制浏览器 Runtime metrics。");

  return { reportFile, report };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  runBenchmark(parseArguments(process.argv.slice(2))).catch((error: unknown) => {
    console.error("");
    console.error("LZMA 压缩研究失败");
    console.error("------------------");
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
