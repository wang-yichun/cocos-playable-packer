import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { encodeHtmlSafe7Bit } from "../encoding/html-safe-7bit.js";
import { encodeSafeBase91 } from "../encoding/safe-base91.js";

export type PayloadEncodingName = "base64" | "base91" | "html7";

export interface PayloadEncodingMeasurement {
  encoding: PayloadEncodingName;
  payloadBytes: number;
  htmlBytes: number;
  htmlPercentOfBuildBytes: number;
  savingsVsBase64Bytes: number;
  savingsVsBase64Percent: number;
}

export interface PayloadEncodingBenchmark {
  status: "measured" | "unavailable";
  archiveRawBytes: number | null;
  brotliBytes: number | null;
  brotliCompressionPercent: number | null;
  encodings: PayloadEncodingMeasurement[];
  warnings: string[];
}

interface PackedArchive {
  c?: unknown;
  u?: unknown;
  b?: unknown;
}

const ARCHIVE_MARKER = "window.__PACK_ARCHIVE__=";

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percent(part: number, total: number): number {
  return total > 0 ? round(part / total * 100) : 0;
}

function scanBalancedObject(source: string, startIndex: number): string {
  let index = startIndex;
  while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
  if (source[index] !== "{") throw new Error("没有在 __PACK_ARCHIVE__ 后找到 JSON 对象。");
  const start = index;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error("__PACK_ARCHIVE__ JSON 对象没有正常结束。");
}

function extractPackedArchive(html: string): { rawBytes: number; compressed: Buffer; base64PayloadBytes: number } {
  const markerIndex = html.indexOf(ARCHIVE_MARKER);
  if (markerIndex < 0) throw new Error("生成的 HTML 中没有找到 __PACK_ARCHIVE__。");
  const parsed = JSON.parse(scanBalancedObject(html, markerIndex + ARCHIVE_MARKER.length)) as PackedArchive;
  if (parsed.c !== "br" || typeof parsed.u !== "number" || typeof parsed.b !== "string") {
    throw new Error("生成的 HTML 中 Brotli 归档信息无效。");
  }
  return {
    rawBytes: parsed.u,
    compressed: Buffer.from(parsed.b, "base64"),
    base64PayloadBytes: Buffer.byteLength(parsed.b, "utf8"),
  };
}

async function runTypeScript(
  projectRoot: string,
  scriptRelativePath: string,
  args: readonly string[],
): Promise<void> {
  const scriptPath = path.resolve(projectRoot, scriptRelativePath);
  await access(scriptPath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...args],
      {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const output: string[] = [];
    const capture = (chunk: Buffer | string): void => {
      output.push(String(chunk));
      if (output.length > 40) output.splice(0, output.length - 40);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `Payload 编码测量脚本失败：${scriptRelativePath}，退出码 ${String(code)}，信号 ${String(signal)}\n${output.join("")}`,
      ));
    });
  });
}

export function calculatePayloadEncodingMeasurements(
  compressedBytes: Uint8Array,
  htmlBytes: Readonly<Record<PayloadEncodingName, number>>,
  buildBytes: number,
): PayloadEncodingMeasurement[] {
  const payloadBytes: Record<PayloadEncodingName, number> = {
    base64: Buffer.byteLength(Buffer.from(compressedBytes).toString("base64"), "utf8"),
    base91: Buffer.byteLength(encodeSafeBase91(compressedBytes), "utf8"),
    html7: Buffer.byteLength(encodeHtmlSafe7Bit(compressedBytes), "utf8"),
  };
  const base64HtmlBytes = htmlBytes.base64;
  return (["base64", "base91", "html7"] as const).map((encoding) => ({
    encoding,
    payloadBytes: payloadBytes[encoding],
    htmlBytes: htmlBytes[encoding],
    htmlPercentOfBuildBytes: percent(htmlBytes[encoding], buildBytes),
    savingsVsBase64Bytes: Math.max(0, base64HtmlBytes - htmlBytes[encoding]),
    savingsVsBase64Percent: percent(Math.max(0, base64HtmlBytes - htmlBytes[encoding]), base64HtmlBytes),
  }));
}

export async function measurePayloadEncodingBenchmark(
  buildDirectory: string,
  workingDirectory: string,
  buildBytes: number,
  projectRoot = process.cwd(),
): Promise<PayloadEncodingBenchmark> {
  const buildRoot = path.resolve(buildDirectory);
  const root = path.resolve(projectRoot);
  const prerequisites = [
    path.join(buildRoot, "index.html"),
    path.join(buildRoot, "src", "import-map.json"),
  ];
  for (const prerequisite of prerequisites) {
    const info = await stat(prerequisite).catch(() => null);
    if (!info?.isFile()) {
      return {
        status: "unavailable",
        archiveRawBytes: null,
        brotliBytes: null,
        brotliCompressionPercent: null,
        encodings: [],
        warnings: [`缺少 ${path.relative(buildRoot, prerequisite).replace(/\\/g, "/")}，无法运行完整 Payload 编码测量。`],
      };
    }
  }

  const workspace = path.resolve(workingDirectory);
  const base64File = path.join(workspace, "payload-base64.html");
  const base91File = path.join(workspace, "payload-base91.html");
  const html7File = path.join(workspace, "payload-html7.html");
  await mkdir(workspace, { recursive: true });
  try {
    await runTypeScript(root, "src/pack-compressed-cli.ts", [buildRoot, base64File]);
    await Promise.all([
      runTypeScript(root, "src/encoding/reencode-brotli-html.ts", [base64File, base91File, "--iterations=1"]),
      runTypeScript(root, "src/encoding/reencode-brotli-html7.ts", [base64File, html7File, "--iterations=1"]),
    ]);
    const base64Html = await readFile(base64File, "utf8");
    const archive = extractPackedArchive(base64Html);
    const [base64Info, base91Info, html7Info] = await Promise.all([
      stat(base64File),
      stat(base91File),
      stat(html7File),
    ]);
    const measurements = calculatePayloadEncodingMeasurements(
      archive.compressed,
      { base64: base64Info.size, base91: base91Info.size, html7: html7Info.size },
      buildBytes,
    );
    return {
      status: "measured",
      archiveRawBytes: archive.rawBytes,
      brotliBytes: archive.compressed.byteLength,
      brotliCompressionPercent: percent(archive.compressed.byteLength, archive.rawBytes),
      encodings: measurements,
      warnings: [
        "这里运行当前打包器与三种实际编码器测量尺寸，不是固定倍率换算。",
        "测量基于当前 web-mobile 内容，尚未应用报告中的 WebP 或音频优化建议。",
        "单 HTML 尺寸包含当前 Brotli JavaScript 回退、运行时和编码解码器开销。",
      ],
    };
  } catch (error) {
    return {
      status: "unavailable",
      archiveRawBytes: null,
      brotliBytes: null,
      brotliCompressionPercent: null,
      encodings: [],
      warnings: [`Payload 编码测量失败：${error instanceof Error ? error.message : String(error)}`],
    };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}
