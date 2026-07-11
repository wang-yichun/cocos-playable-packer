import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  createSafeBase91BrowserDecoderSource,
  decodeSafeBase91,
  encodeSafeBase91,
} from "./safe-base91.js";

interface PackedArchive {
  v?: number;
  c?: string;
  e?: string;
  u?: number;
  b: string;
}

interface CliOptions {
  inputFile: string;
  outputFile: string;
  iterations: number;
}

interface TimingSummary {
  averageMs: number;
  minimumMs: number;
  maximumMs: number;
}

const ARCHIVE_MARKER = "window.__PACK_ARCHIVE__=";
const BASE64_DECODER_START = "    function decodeBase64(base64) {";
const BROTLI_DECODER_START = "    async function decompressBrotli(";
const BASE64_CALL = "            decodeBase64(ARCHIVE.b);";
const BASE91_CALL = "            decodeSafeBase91(ARCHIVE.b);";

function usage(): string {
  return [
    "将现有 Brotli + Base64 Playable HTML 转换为 Brotli + Safe Base91。",
    "",
    "npm run encoding:base91 -- <输入HTML> <输出HTML> [--iterations=3]",
  ].join("\n");
}

function parseArguments(argv: readonly string[]): CliOptions {
  const args = argv.filter((argument) => argument !== "--");
  const positional: string[] = [];
  let iterations = 3;

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }

    if (argument.startsWith("--iterations=")) {
      const value = Number(argument.slice("--iterations=".length));
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        throw new Error("--iterations 必须是 1 到 20 之间的整数。");
      }
      iterations = value;
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

  return { inputFile, outputFile, iterations };
}

function scanBalancedJsonObject(
  source: string,
  startIndex: number,
): { source: string; start: number; end: number } {
  let index = startIndex;

  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  if (source[index] !== "{") {
    throw new Error("没有在 __PACK_ARCHIVE__ 标记后找到 JSON 对象。");
  }

  const objectStart = index;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          source: source.slice(objectStart, index + 1),
          start: objectStart,
          end: index + 1,
        };
      }
    }
  }

  throw new Error("__PACK_ARCHIVE__ JSON 对象没有正常结束。");
}

function extractArchive(html: string): {
  archive: PackedArchive;
  start: number;
  end: number;
} {
  const markerIndex = html.indexOf(ARCHIVE_MARKER);
  if (markerIndex < 0) {
    throw new Error("HTML 中没有找到 window.__PACK_ARCHIVE__。");
  }

  const object = scanBalancedJsonObject(
    html,
    markerIndex + ARCHIVE_MARKER.length,
  );
  const parsed = JSON.parse(object.source) as Partial<PackedArchive>;

  if (parsed.c !== "br") {
    throw new Error(`只支持 Brotli 归档，当前压缩算法：${String(parsed.c)}`);
  }

  if (typeof parsed.b !== "string" || parsed.b.length === 0) {
    throw new Error("__PACK_ARCHIVE__.b 不是有效字符串。");
  }

  if (parsed.e !== undefined && parsed.e !== "base64") {
    throw new Error(`输入 HTML 已使用其他文本编码：${String(parsed.e)}`);
  }

  return {
    archive: parsed as PackedArchive,
    start: object.start,
    end: object.end,
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function measure<T>(iterations: number, callback: () => T): {
  value: T;
  timing: TimingSummary;
} {
  const times: number[] = [];
  let value: T | undefined;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    value = callback();
    times.push(performance.now() - startedAt);
  }

  if (value === undefined) {
    throw new Error("基准测试没有产生结果。");
  }

  const total = times.reduce((sum, current) => sum + current, 0);
  return {
    value,
    timing: {
      averageMs: total / times.length,
      minimumMs: Math.min(...times),
      maximumMs: Math.max(...times),
    },
  };
}

function replaceRuntimeDecoder(html: string): {
  html: string;
  decoderSourceBytes: number;
} {
  const decoderStart = html.indexOf(BASE64_DECODER_START);
  if (decoderStart < 0) {
    throw new Error("没有找到当前 Base64 浏览器解码函数，打包器模板可能已变化。");
  }

  const brotliStart = html.indexOf(BROTLI_DECODER_START, decoderStart);
  if (brotliStart < 0) {
    throw new Error("没有找到 Brotli 解码函数，无法确定 Base64 解码函数边界。");
  }

  const decoderSource = createSafeBase91BrowserDecoderSource();
  let output =
    html.slice(0, decoderStart) + decoderSource + html.slice(brotliStart);

  const callIndex = output.indexOf(BASE64_CALL);
  if (callIndex < 0) {
    throw new Error("没有找到 Base64 Payload 解码调用，打包器模板可能已变化。");
  }

  output =
    output.slice(0, callIndex) +
    BASE91_CALL +
    output.slice(callIndex + BASE64_CALL.length);

  return {
    html: output,
    decoderSourceBytes: Buffer.byteLength(decoderSource, "utf8"),
  };
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

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".encoding-report.json");
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const inputBuffer = await readFile(options.inputFile);
  const inputHtml = inputBuffer.toString("utf8");
  const extracted = extractArchive(inputHtml);
  const compressedBytes = Buffer.from(extracted.archive.b, "base64");

  const encoded = measure(
    options.iterations,
    () => encodeSafeBase91(compressedBytes),
  );
  const decoded = measure(
    options.iterations,
    () => decodeSafeBase91(encoded.value),
  );

  if (!equalBytes(compressedBytes, decoded.value)) {
    throw new Error("Safe Base91 回环校验失败。");
  }

  const nextArchive: PackedArchive = {
    ...extracted.archive,
    e: "base91",
    b: encoded.value,
  };
  const archiveSource = JSON.stringify(nextArchive);

  let outputHtml =
    inputHtml.slice(0, extracted.start) +
    archiveSource +
    inputHtml.slice(extracted.end);

  const runtime = replaceRuntimeDecoder(outputHtml);
  outputHtml = runtime.html;

  if (outputHtml.includes("decodeBase64(ARCHIVE.b)")) {
    throw new Error("输出 HTML 中仍然存在 Base64 Payload 解码调用。");
  }

  const outputBuffer = Buffer.from(outputHtml, "utf8");
  const reportFile = reportPathForOutput(options.outputFile);
  const base64PayloadBytes = Buffer.byteLength(
    JSON.stringify(extracted.archive.b),
    "utf8",
  );
  const base91PayloadBytes = Buffer.byteLength(
    JSON.stringify(encoded.value),
    "utf8",
  );

  const report = {
    schemaVersion: 1,
    tool: "brotli-safe-base91-reencoder",
    generatedAt: new Date().toISOString(),
    input: {
      file: options.inputFile,
      htmlBytes: inputBuffer.byteLength,
      htmlSha256: sha256(inputBuffer),
      encoding: extracted.archive.e ?? "base64",
    },
    payload: {
      compressedBytes: compressedBytes.byteLength,
      compressedSha256: sha256(compressedBytes),
      base64Characters: extracted.archive.b.length,
      base64EmbeddedBytes: base64PayloadBytes,
      base91Characters: encoded.value.length,
      base91EmbeddedBytes: base91PayloadBytes,
      base64OverheadPercent: percentage(
        base64PayloadBytes - compressedBytes.byteLength,
        compressedBytes.byteLength,
      ),
      base91OverheadPercent: percentage(
        base91PayloadBytes - compressedBytes.byteLength,
        compressedBytes.byteLength,
      ),
      payloadSavedBytes: base64PayloadBytes - base91PayloadBytes,
      payloadSavedPercent: percentage(
        base64PayloadBytes - base91PayloadBytes,
        base64PayloadBytes,
      ),
      decoderSourceBytes: runtime.decoderSourceBytes,
      encodeTimingMs: encoded.timing,
      decodeTimingMs: decoded.timing,
      roundTripOk: true,
    },
    output: {
      file: options.outputFile,
      htmlBytes: outputBuffer.byteLength,
      htmlSha256: sha256(outputBuffer),
      savedVsInputBytes: inputBuffer.byteLength - outputBuffer.byteLength,
      savedVsInputPercent: percentage(
        inputBuffer.byteLength - outputBuffer.byteLength,
        inputBuffer.byteLength,
      ),
      reportFile,
    },
  };

  await mkdir(path.dirname(options.outputFile), { recursive: true });
  await writeFile(options.outputFile, outputBuffer);
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("Brotli Safe Base91 转换完成");
  console.log("---------------------------");
  console.log(`输入 HTML：${formatBytes(inputBuffer.byteLength)}`);
  console.log(`Brotli 二进制：${formatBytes(compressedBytes.byteLength)}`);
  console.log(`Base64 Payload：${formatBytes(base64PayloadBytes)}`);
  console.log(`Base91 Payload：${formatBytes(base91PayloadBytes)}`);
  console.log(
    `Payload 减少：${formatBytes(base64PayloadBytes - base91PayloadBytes)} ` +
      `(${report.payload.payloadSavedPercent.toFixed(2)}%)`,
  );
  console.log(`浏览器解码器：${formatBytes(runtime.decoderSourceBytes)}`);
  console.log(`输出 HTML：${formatBytes(outputBuffer.byteLength)}`);
  console.log(
    `最终减少：${formatBytes(inputBuffer.byteLength - outputBuffer.byteLength)} ` +
      `(${report.output.savedVsInputPercent.toFixed(2)}%)`,
  );
  console.log(`Node 解码平均：${decoded.timing.averageMs.toFixed(2)} ms`);
  console.log(`输出：${options.outputFile}`);
  console.log(`报告：${reportFile}`);
  console.log("");
  console.log("请通过 npm run serve 测试输出 HTML，并观察控制台中的 Safe Base91 解码耗时。");
}

main().catch((error: unknown) => {
  console.error("");
  console.error("Brotli Safe Base91 转换失败");
  console.error("---------------------------");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
