import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync, constants as zlibConstants } from "node:zlib";

const RAW_FALLBACK_MARKER = "/* brotli-compress/js 1.3.3 fallback;";
const PACKED_FALLBACK_MARKER = "/* Playable Packer gzip-packed Brotli fallback */";

export interface OptimizedBrotliFallback {
  html: string;
  rawDecoderBytes: number;
  gzipDecoderBytes: number;
  base64Characters: number;
  loaderBytes: number;
  embeddedFallbackBytes: number;
  savedBytes: number;
  savedPercent: number;
}

interface ScriptRange {
  openStart: number;
  contentStart: number;
  contentEnd: number;
  closeEnd: number;
}

interface CliOptions {
  inputFile: string;
  outputFile: string;
}

function usage(): string {
  return [
    "压缩 Brotli JavaScript 回退解码器",
    "",
    "npm run brotli:fallback:optimize -- <输入HTML> <输出HTML>",
    "",
    "输入必须是当前 packer 生成、且仍包含原始 brotli-compress/js 1.3.3 回退脚本的 HTML。",
  ].join("\n");
}

function parseArguments(argv: readonly string[]): CliOptions {
  const args = argv.filter((argument) => argument !== "--");
  if (args.includes("-h") || args.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }
  if (args.length !== 2) {
    throw new Error(`${usage()}\n\n必须提供输入 HTML 和输出 HTML。`);
  }

  const inputFile = path.resolve(args[0] ?? "");
  const outputFile = path.resolve(args[1] ?? "");
  if (path.extname(inputFile).toLowerCase() !== ".html") {
    throw new Error(`输入文件必须是 .html：${inputFile}`);
  }
  if (path.extname(outputFile).toLowerCase() !== ".html") {
    throw new Error(`输出文件必须是 .html：${outputFile}`);
  }
  if (inputFile === outputFile) {
    throw new Error("输入和输出 HTML 不能是同一个文件。先保留原始基线用于比较。");
  }
  return { inputFile, outputFile };
}

function findScriptContaining(html: string, marker: string): ScriptRange {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`没有找到目标脚本标记：${marker}`);
  }

  const openStart = html.lastIndexOf("<script", markerIndex);
  if (openStart < 0) {
    throw new Error("目标标记不在 script 标签中。");
  }
  const contentStart = html.indexOf(">", openStart);
  if (contentStart < 0 || contentStart >= markerIndex) {
    throw new Error("无法确定 Brotli 回退 script 的开始位置。");
  }
  const contentEnd = html.indexOf("</script>", markerIndex);
  if (contentEnd < 0) {
    throw new Error("无法确定 Brotli 回退 script 的结束位置。");
  }

  return {
    openStart,
    contentStart: contentStart + 1,
    contentEnd,
    closeEnd: contentEnd + "</script>".length,
  };
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createPackedLoader(
  gzipBase64: string,
  rawDecoderBytes: number,
  gzipDecoderBytes: number,
): string {
  return `${PACKED_FALLBACK_MARKER}\n(function(){\n` +
    `var p=${JSON.stringify(gzipBase64)};\n` +
    "var r=null;\n" +
    "var m=window.__PACK_BROTLI_FALLBACK_METRICS__={mode:'gzip-packed-js',sourceBytes:" +
    String(rawDecoderBytes) +
    ",gzipBytes:" +
    String(gzipDecoderBytes) +
    ",base64Characters:" +
    String(gzipBase64.length) +
    ",loadStartMs:null,loadEndMs:null,loadDurationMs:null};\n" +
    "async function l(){\n" +
    "if(r)return r;\n" +
    "r=(async function(){\n" +
    "if(typeof DecompressionStream!=='function'){throw new Error('gzip-packed Brotli 回退需要 DecompressionStream(\\'gzip\\')。');}\n" +
    "m.loadStartMs=performance.now();\n" +
    "var s=atob(p),b=new Uint8Array(s.length);\n" +
    "for(var i=0;i<s.length;i+=1)b[i]=s.charCodeAt(i);\n" +
    "var q=new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));\n" +
    "var a=await new Response(q).arrayBuffer();\n" +
    "var t=new TextDecoder('utf-8').decode(a);\n" +
    "(0,eval)(t+'\\n//# sourceURL=playable-brotli-fallback.js');\n" +
    "var f=window.__PACK_BROTLI_DECOMPRESS__;\n" +
    "if(typeof f!=='function')throw new Error('Brotli 回退解码器初始化失败。');\n" +
    "m.loadEndMs=performance.now();m.loadDurationMs=m.loadEndMs-m.loadStartMs;\n" +
    "console.log('[Playable Packer] Brotli JS 回退解码器展开完成：',m.sourceBytes+' B，',m.loadDurationMs.toFixed(2)+' ms');\n" +
    "p='';return f;\n" +
    "})();return r;\n" +
    "}\n" +
    "window.__PACK_BROTLI_DECOMPRESS__=async function(x){var f=await l();return f(x);};\n" +
    "})();";
}

export function optimizeBrotliFallbackHtml(html: string): OptimizedBrotliFallback {
  if (html.includes(PACKED_FALLBACK_MARKER)) {
    throw new Error("输入 HTML 已经使用 gzip-packed Brotli 回退解码器。");
  }

  const script = findScriptContaining(html, RAW_FALLBACK_MARKER);
  const rawSource = html.slice(script.contentStart, script.contentEnd);
  if (!rawSource.includes("window.__PACK_BROTLI_DECOMPRESS__")) {
    throw new Error("Brotli 回退脚本没有导出 window.__PACK_BROTLI_DECOMPRESS__。");
  }

  const rawBuffer = Buffer.from(rawSource, "utf8");
  const gzipBuffer = gzipSync(rawBuffer, {
    level: 9,
    strategy: zlibConstants.Z_DEFAULT_STRATEGY,
  });
  const roundTrip = gunzipSync(gzipBuffer);
  if (!roundTrip.equals(rawBuffer)) {
    throw new Error("gzip 回环校验失败。");
  }

  const gzipBase64 = gzipBuffer.toString("base64");
  const loader = createPackedLoader(
    gzipBase64,
    rawBuffer.byteLength,
    gzipBuffer.byteLength,
  );
  const nextHtml =
    html.slice(0, script.contentStart) + loader + html.slice(script.contentEnd);

  const rawDecoderBytes = rawBuffer.byteLength;
  const loaderBytes = Buffer.byteLength(loader, "utf8");
  const savedBytes =
    Buffer.byteLength(html, "utf8") - Buffer.byteLength(nextHtml, "utf8");

  if (savedBytes <= 0) {
    throw new Error(`压缩后的 HTML 没有变小，反而变化 ${savedBytes} B。`);
  }

  return {
    html: nextHtml,
    rawDecoderBytes,
    gzipDecoderBytes: gzipBuffer.byteLength,
    base64Characters: gzipBase64.length,
    loaderBytes,
    embeddedFallbackBytes: loaderBytes,
    savedBytes,
    savedPercent: percentage(savedBytes, rawDecoderBytes),
  };
}

function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".brotli-decoder-report.json");
}

async function exists(filePath: string): Promise<boolean> {
  return (await stat(filePath).catch(() => null))?.isFile() === true;
}

async function promotePair(
  tempOutput: string,
  outputFile: string,
  tempReport: string,
  reportFile: string,
): Promise<void> {
  const token = `${process.pid}-${Date.now()}`;
  const outputBackup = `${outputFile}.previous-${token}`;
  const reportBackup = `${reportFile}.previous-${token}`;
  let outputBackedUp = false;
  let reportBackedUp = false;

  try {
    if (await exists(outputFile)) {
      await rename(outputFile, outputBackup);
      outputBackedUp = true;
    }
    if (await exists(reportFile)) {
      await rename(reportFile, reportBackup);
      reportBackedUp = true;
    }
    await rename(tempOutput, outputFile);
    await rename(tempReport, reportFile);
    await rm(outputBackup, { force: true });
    await rm(reportBackup, { force: true });
  } catch (error) {
    await rm(outputFile, { force: true }).catch(() => undefined);
    await rm(reportFile, { force: true }).catch(() => undefined);
    if (outputBackedUp) {
      await rename(outputBackup, outputFile).catch(() => undefined);
    }
    if (reportBackedUp) {
      await rename(reportBackup, reportFile).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(tempOutput, { force: true }).catch(() => undefined);
    await rm(tempReport, { force: true }).catch(() => undefined);
  }
}

export async function optimizeBrotliFallbackFile(
  inputFile: string,
  outputFile: string,
): Promise<Record<string, unknown>> {
  const inputBuffer = await readFile(inputFile);
  const optimized = optimizeBrotliFallbackHtml(inputBuffer.toString("utf8"));
  const outputBuffer = Buffer.from(optimized.html, "utf8");
  const reportFile = reportPathForOutput(outputFile);
  const token = `${process.pid}-${Date.now()}`;
  const tempOutput = `${outputFile}.tmp-${token}`;
  const tempReport = `${reportFile}.tmp-${token}`;

  const report = {
    schemaVersion: 1,
    tool: "brotli-fallback-optimizer",
    status: "succeeded",
    generatedAt: new Date().toISOString(),
    mode: "gzip-packed-js",
    compatibility: {
      requires: "DecompressionStream('gzip')",
      keepsExistingBrotliDecoder: true,
      changesArchiveCompression: false,
      changesPayloadEncoding: false,
    },
    input: {
      file: inputFile,
      htmlBytes: inputBuffer.byteLength,
      htmlSha256: sha256(inputBuffer),
    },
    fallback: {
      rawDecoderBytes: optimized.rawDecoderBytes,
      gzipDecoderBytes: optimized.gzipDecoderBytes,
      gzipRatioPercent: percentage(
        optimized.gzipDecoderBytes,
        optimized.rawDecoderBytes,
      ),
      base64Characters: optimized.base64Characters,
      loaderBytes: optimized.loaderBytes,
      savedBytes: optimized.savedBytes,
      savedPercentOfRawDecoder: optimized.savedPercent,
      roundTrip: true,
    },
    output: {
      file: outputFile,
      htmlBytes: outputBuffer.byteLength,
      htmlSha256: sha256(outputBuffer),
      savedBytes: inputBuffer.byteLength - outputBuffer.byteLength,
      savedPercent: percentage(
        inputBuffer.byteLength - outputBuffer.byteLength,
        inputBuffer.byteLength,
      ),
      reportFile,
    },
    browserMetricsGlobal: "window.__PACK_BROTLI_FALLBACK_METRICS__",
  };

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(tempOutput, outputBuffer);
  await writeFile(tempReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await promotePair(tempOutput, outputFile, tempReport, reportFile);
  return report;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const report = await optimizeBrotliFallbackFile(
    options.inputFile,
    options.outputFile,
  );
  const input = report.input as { htmlBytes: number };
  const output = report.output as {
    htmlBytes: number;
    savedBytes: number;
    savedPercent: number;
    reportFile: string;
  };
  const fallback = report.fallback as {
    rawDecoderBytes: number;
    gzipDecoderBytes: number;
    loaderBytes: number;
  };

  console.log("");
  console.log("Brotli 回退解码器优化完成");
  console.log("--------------------------");
  console.log(`输入 HTML：${input.htmlBytes} B`);
  console.log(`原始 JS 解码器：${fallback.rawDecoderBytes} B`);
  console.log(`gzip 解码器数据：${fallback.gzipDecoderBytes} B`);
  console.log(`内嵌 Loader：${fallback.loaderBytes} B`);
  console.log(`输出 HTML：${output.htmlBytes} B`);
  console.log(`减少：${output.savedBytes} B (${output.savedPercent.toFixed(2)}%)`);
  console.log(`报告：${output.reportFile}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error: unknown) => {
    console.error("Brotli 回退解码器优化失败：", error);
    process.exitCode = 1;
  });
}
