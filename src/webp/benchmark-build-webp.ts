/// <reference lib="dom" />
/// <reference path="../squoosh/jsquash-emscripten.d.ts" />

import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import encodeWebp, { init as initWebpEncode } from "@jsquash/webp/encode.js";
import sharp from "sharp";

interface Options {
  inputDirectory: string;
  outputDirectory: string;
  pngQuality: number;
  jpegQuality: number;
}

interface FileReport {
  path: string;
  sourceFormat: "png" | "jpeg";
  quality: number;
  width: number;
  height: number;
  hasAlpha: boolean;
  sourceBytes: number;
  webpBytes: number;
  finalBytes: number;
  savedBytes: number;
  savedPercent: number;
  sourceBrotliBytes: number;
  webpBrotliBytes: number;
  sourceSha256: string;
  webpSha256: string;
  appliedToBuildCopy: boolean;
  elapsedMs: number;
}

const require = createRequire(import.meta.url);
let codecInitialization: Promise<void> | null = null;

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function brotliBytes(buffer: Buffer): number {
  return brotliCompressSync(buffer, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength;
}

function installNodeImageDataPolyfill(): void {
  if (typeof globalThis.ImageData !== "undefined") return;
  class NodeImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = "srgb" as PredefinedColorSpace;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  Object.defineProperty(globalThis, "ImageData", { configurable: true, writable: true, value: NodeImageData });
}

async function initializeCodec(): Promise<void> {
  if (codecInitialization !== null) return codecInitialization;
  codecInitialization = (async () => {
    installNodeImageDataPolyfill();
    const packageJson = require.resolve("@jsquash/webp/package.json");
    const wasmPath = path.join(path.dirname(packageJson), "codec", "enc", "webp_enc.wasm");
    const module = await WebAssembly.compile(await readFile(wasmPath));
    const init = initWebpEncode as unknown as (module: WebAssembly.Module) => Promise<void>;
    await init(module);
  })();
  return codecInitialization;
}

async function encode(source: Buffer, quality: number): Promise<{ buffer: Buffer; width: number; height: number; hasAlpha: boolean }> {
  await initializeCodec();
  const decoded = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(decoded.data.byteLength);
  pixels.set(decoded.data);
  const imageData = new ImageData(pixels, decoded.info.width, decoded.info.height);
  const output = await encodeWebp(imageData, {
    quality,
    method: 6,
    alpha_quality: 100,
    alpha_compression: 1,
    exact: 1,
    lossless: 0,
  });
  const metadata = await sharp(source).metadata();
  return {
    buffer: Buffer.from(output),
    width: decoded.info.width,
    height: decoded.info.height,
    hasAlpha: metadata.hasAlpha === true,
  };
}

async function collectImages(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile() && [".png", ".jpg", ".jpeg"].includes(path.extname(entry.name).toLowerCase())) output.push(absolutePath);
    }
  }
  await visit(root);
  return output.sort((left, right) => left.localeCompare(right));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function renderPreview(files: FileReport[]): string {
  const cards = files.map(file => {
    const original = `originals/${file.path}`;
    const candidate = `candidates/${file.path.replace(/\.(png|jpe?g)$/i, ".webp")}`;
    return `<section><h2>${escapeHtml(file.path)}</h2><p>${file.sourceFormat.toUpperCase()} Q${file.quality} · ${file.sourceBytes.toLocaleString()} → ${file.webpBytes.toLocaleString()} B · ${file.appliedToBuildCopy ? "已用于构建副本" : "无收益，构建副本保留原图"}</p><div><figure><img src="${encodeURI(original)}"><figcaption>原图</figcaption></figure><figure><img src="${encodeURI(candidate)}"><figcaption>WebP</figcaption></figure></div></section>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>WebP 批量基准</title><style>body{font-family:system-ui,sans-serif;margin:24px;background:#f5f6f8;color:#202124}section{background:#fff;margin:0 0 18px;padding:16px;border-radius:10px}h2{font-size:14px;word-break:break-all}section>div{display:flex;gap:20px;flex-wrap:wrap}figure{margin:0;width:360px}img{max-width:360px;max-height:300px;object-fit:contain;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0/20px 20px;border:1px solid #bbb}</style></head><body><h1>WebP 批量基准预览</h1>${cards}</body></html>`;
}

export async function benchmarkBuildWebp(options: Options): Promise<void> {
  const inputRoot = path.resolve(options.inputDirectory);
  const outputRoot = path.resolve(options.outputDirectory);
  const inputInfo = await stat(inputRoot).catch(() => null);
  if (!inputInfo?.isDirectory()) throw new Error(`输入构建目录不存在：${inputRoot}`);
  if (await stat(outputRoot).catch(() => null)) throw new Error(`输出目录已存在，请换用新目录或先手动删除：${outputRoot}`);
  const relative = path.relative(inputRoot, outputRoot);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("输出目录不能位于输入构建目录内部。");
  for (const [name, value] of [["--png-quality", options.pngQuality], ["--jpeg-quality", options.jpegQuality]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error(`${name} 必须是 1 到 100 之间的整数。`);
  }

  const buildCopy = path.join(outputRoot, "web-mobile");
  await mkdir(outputRoot, { recursive: true });
  await cp(inputRoot, buildCopy, { recursive: true, force: false, errorOnExist: true });
  const images = await collectImages(inputRoot);
  const files: FileReport[] = [];
  const originalParts: Buffer[] = [];
  const finalParts: Buffer[] = [];
  for (const absolutePath of images) {
    const startedAt = performance.now();
    const relativePath = path.relative(inputRoot, absolutePath).replace(/\\/g, "/");
    const extension = path.extname(absolutePath).toLowerCase();
    const sourceFormat = extension === ".png" ? "png" : "jpeg";
    const quality = sourceFormat === "png" ? options.pngQuality : options.jpegQuality;
    const source = await readFile(absolutePath);
    const webp = await encode(source, quality);
    const originalPath = path.join(outputRoot, "originals", ...relativePath.split("/"));
    const candidateRelativePath = relativePath.replace(/\.(png|jpe?g)$/i, ".webp");
    const candidatePath = path.join(outputRoot, "candidates", ...candidateRelativePath.split("/"));
    await mkdir(path.dirname(originalPath), { recursive: true });
    await mkdir(path.dirname(candidatePath), { recursive: true });
    await writeFile(originalPath, source);
    await writeFile(candidatePath, webp.buffer);
    const sourceCompressedBytes = brotliBytes(source);
    const webpCompressedBytes = brotliBytes(webp.buffer);
    const applied = webp.buffer.byteLength < source.byteLength && webpCompressedBytes < sourceCompressedBytes;
    if (applied) await writeFile(path.join(buildCopy, ...relativePath.split("/")), webp.buffer);
    const final = applied ? webp.buffer : source;
    originalParts.push(source);
    finalParts.push(final);
    files.push({
      path: relativePath,
      sourceFormat,
      quality,
      width: webp.width,
      height: webp.height,
      hasAlpha: webp.hasAlpha,
      sourceBytes: source.byteLength,
      webpBytes: webp.buffer.byteLength,
      finalBytes: final.byteLength,
      savedBytes: source.byteLength - final.byteLength,
      savedPercent: source.byteLength > 0 ? round((source.byteLength - final.byteLength) / source.byteLength * 100) : 0,
      sourceBrotliBytes: sourceCompressedBytes,
      webpBrotliBytes: webpCompressedBytes,
      sourceSha256: sha256(source),
      webpSha256: sha256(webp.buffer),
      appliedToBuildCopy: applied,
      elapsedMs: round(performance.now() - startedAt, 2),
    });
  }
  const sourceBytes = files.reduce((sum, file) => sum + file.sourceBytes, 0);
  const finalBytes = files.reduce((sum, file) => sum + file.finalBytes, 0);
  const sourceSolidBrotliBytes = brotliBytes(Buffer.concat(originalParts));
  const finalSolidBrotliBytes = brotliBytes(Buffer.concat(finalParts));
  const report = {
    schemaVersion: 1,
    tool: "webp-build-benchmark",
    generatedAt: new Date().toISOString(),
    inputDirectory: inputRoot,
    outputDirectory: outputRoot,
    buildCopy,
    settings: { pngWebpQuality: options.pngQuality, jpegWebpQuality: options.jpegQuality, preserveLogicalPaths: true, alphaQuality: 100 },
    summary: {
      scannedImages: files.length,
      pngCount: files.filter(file => file.sourceFormat === "png").length,
      jpegCount: files.filter(file => file.sourceFormat === "jpeg").length,
      appliedImages: files.filter(file => file.appliedToBuildCopy).length,
      noBenefitImages: files.filter(file => !file.appliedToBuildCopy).length,
      sourceBytes,
      finalBytes,
      savedBytes: sourceBytes - finalBytes,
      savedPercent: sourceBytes > 0 ? round((sourceBytes - finalBytes) / sourceBytes * 100) : 0,
      sourceImageSubsetSolidBrotliBytes: sourceSolidBrotliBytes,
      finalImageSubsetSolidBrotliBytes: finalSolidBrotliBytes,
      estimatedSolidBrotliSavingsBytes: sourceSolidBrotliBytes - finalSolidBrotliBytes,
    },
    files,
    notes: ["PNG 和 JPEG 分别使用统一质量参数，不按图片用途分类。", "仅当 WebP 原始字节更小时才写入构建副本。", "构建副本保持原逻辑扩展名；打包器通过文件内容识别 image/webp。"],
  };
  await writeFile(path.join(outputRoot, "webp-benchmark-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputRoot, "webp-preview.html"), renderPreview(files), "utf8");
  console.log(`WebP 批量基准完成：${files.length} 张，采用 ${report.summary.appliedImages} 张。`);
  console.log(`图片减少：${report.summary.savedBytes} B（${report.summary.savedPercent}%）`);
  console.log(`构建副本：${buildCopy}`);
  console.log(`报告：${path.join(outputRoot, "webp-benchmark-report.json")}`);
  console.log(`预览：${path.join(outputRoot, "webp-preview.html")}`);
}

function parseCli(argv: string[]): Options {
  const args = argv.filter(argument => argument !== "--");
  const positional = args.filter(argument => !argument.startsWith("--"));
  const value = (name: string) => args.find(argument => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  if (positional.length !== 2) throw new Error('用法：npm run webp:benchmark-build -- "<web-mobile>" "<输出目录>" [--png-quality=80] [--jpeg-quality=80]');
  return { inputDirectory: positional[0]!, outputDirectory: positional[1]!, pngQuality: Number(value("--png-quality") ?? 80), jpegQuality: Number(value("--jpeg-quality") ?? 80) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void benchmarkBuildWebp(parseCli(process.argv.slice(2))).catch(error => { console.error("WebP 批量基准失败：", error); process.exitCode = 1; });
