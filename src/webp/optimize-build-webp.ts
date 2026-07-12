import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { detectImageMimeType } from "../images/image-content-type.js";
import { encodeWebpCandidate } from "./benchmark-build-webp.js";

export interface OptimizeBuildWebpOptions {
  buildDirectory: string;
  pngQuality: number;
  jpegQuality: number;
  confirm: boolean;
  reportFile: string;
}

interface FileReport {
  path: string;
  sourceFormat: "png" | "jpeg";
  quality: number;
  action: "optimized" | "would-optimize" | "no-benefit" | "already-webp";
  beforeBytes: number;
  candidateBytes: number | null;
  afterBytes: number;
  savedBytes: number;
  beforeBrotliBytes: number;
  candidateBrotliBytes: number | null;
  beforeSha256: string;
  afterSha256: string;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function brotliBytes(buffer: Buffer): number {
  return brotliCompressSync(buffer, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength;
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

async function replaceAtomically(source: string, replacement: string): Promise<void> {
  const backup = `${source}.webp-backup-${process.pid}`;
  await rm(backup, { force: true });
  await rename(source, backup);
  try {
    await rename(replacement, source);
    await rm(backup, { force: true });
  } catch (error) {
    await rm(source, { force: true }).catch(() => undefined);
    await rename(backup, source).catch(() => undefined);
    throw error;
  }
}

export async function optimizeBuildWebp(options: OptimizeBuildWebpOptions): Promise<Record<string, unknown>> {
  const root = path.resolve(options.buildDirectory);
  const reportFile = path.resolve(options.reportFile);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`构建目录不存在：${root}`);
  for (const [name, value] of [["--png-quality", options.pngQuality], ["--jpeg-quality", options.jpegQuality]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error(`${name} 必须是 1 到 100 之间的整数。`);
  }

  const files: FileReport[] = [];
  for (const absolutePath of await collectImages(root)) {
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
    const extension = path.extname(absolutePath).toLowerCase();
    const sourceFormat = extension === ".png" ? "png" : "jpeg";
    const quality = sourceFormat === "png" ? options.pngQuality : options.jpegQuality;
    const before = await readFile(absolutePath);
    const beforeHash = sha256(before);
    const beforeCompressed = brotliBytes(before);
    if (detectImageMimeType(before) === "image/webp") {
      files.push({ path: relativePath, sourceFormat, quality, action: "already-webp", beforeBytes: before.byteLength, candidateBytes: null, afterBytes: before.byteLength, savedBytes: 0, beforeBrotliBytes: beforeCompressed, candidateBrotliBytes: null, beforeSha256: beforeHash, afterSha256: beforeHash });
      continue;
    }
    const candidate = (await encodeWebpCandidate(before, quality)).buffer;
    const candidateCompressed = brotliBytes(candidate);
    const beneficial = candidate.byteLength < before.byteLength && candidateCompressed < beforeCompressed;
    if (!beneficial) {
      files.push({ path: relativePath, sourceFormat, quality, action: "no-benefit", beforeBytes: before.byteLength, candidateBytes: candidate.byteLength, afterBytes: before.byteLength, savedBytes: 0, beforeBrotliBytes: beforeCompressed, candidateBrotliBytes: candidateCompressed, beforeSha256: beforeHash, afterSha256: beforeHash });
      continue;
    }
    if (!options.confirm) {
      files.push({ path: relativePath, sourceFormat, quality, action: "would-optimize", beforeBytes: before.byteLength, candidateBytes: candidate.byteLength, afterBytes: candidate.byteLength, savedBytes: before.byteLength - candidate.byteLength, beforeBrotliBytes: beforeCompressed, candidateBrotliBytes: candidateCompressed, beforeSha256: beforeHash, afterSha256: sha256(candidate) });
      continue;
    }
    const temporary = `${absolutePath}.webp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporary, candidate);
      await replaceAtomically(absolutePath, temporary);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    files.push({ path: relativePath, sourceFormat, quality, action: "optimized", beforeBytes: before.byteLength, candidateBytes: candidate.byteLength, afterBytes: candidate.byteLength, savedBytes: before.byteLength - candidate.byteLength, beforeBrotliBytes: beforeCompressed, candidateBrotliBytes: candidateCompressed, beforeSha256: beforeHash, afterSha256: sha256(candidate) });
  }

  const selected = files.filter(file => file.action === "optimized" || file.action === "would-optimize");
  const beforeBytes = files.reduce((sum, file) => sum + file.beforeBytes, 0);
  const afterBytes = files.reduce((sum, file) => sum + file.afterBytes, 0);
  const report = {
    schemaVersion: 1,
    tool: "webp-build-optimizer",
    status: options.confirm ? "applied" : "preview",
    generatedAt: new Date().toISOString(),
    buildDirectory: root,
    settings: { pngWebpQuality: options.pngQuality, jpegWebpQuality: options.jpegQuality, alphaQuality: 100, preserveLogicalPaths: true },
    summary: {
      scannedImages: files.length,
      optimizedImages: files.filter(file => file.action === "optimized").length,
      wouldOptimizeImages: files.filter(file => file.action === "would-optimize").length,
      noBenefitImages: files.filter(file => file.action === "no-benefit").length,
      alreadyWebpImages: files.filter(file => file.action === "already-webp").length,
      beforeBytes,
      afterBytes,
      savedBytes: beforeBytes - afterBytes,
      savedPercent: beforeBytes > 0 ? (beforeBytes - afterBytes) / beforeBytes * 100 : 0,
      selectedSingleFileBrotliSavingsBytes: selected.reduce((sum, file) => sum + file.beforeBrotliBytes - (file.candidateBrotliBytes ?? file.beforeBrotliBytes), 0),
    },
    files,
  };
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`WebP 优化${options.confirm ? "完成" : "预览完成"}：${selected.length} 张采用候选，PNG Q${options.pngQuality}，JPEG Q${options.jpegQuality}。`);
  console.log(`报告：${reportFile}`);
  return report;
}

function parseCli(argv: string[]): OptimizeBuildWebpOptions {
  const args = argv.filter(argument => argument !== "--");
  const positional = args.filter(argument => !argument.startsWith("--"));
  const value = (name: string) => args.find(argument => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  if (positional.length !== 1) throw new Error('用法：npm run webp:optimize-build -- "<构建目录>" [--png-quality=80] [--jpeg-quality=80] (--preview|--confirm) [--report=<路径>]');
  const confirm = args.includes("--confirm");
  const preview = args.includes("--preview");
  if (confirm === preview) throw new Error("必须且只能指定 --preview 或 --confirm。");
  return { buildDirectory: positional[0]!, pngQuality: Number(value("--png-quality") ?? 80), jpegQuality: Number(value("--jpeg-quality") ?? 80), confirm, reportFile: value("--report") ?? path.resolve(`./webp-optimization-${confirm ? "apply" : "preview"}.json`) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void optimizeBuildWebp(parseCli(process.argv.slice(2))).catch(error => { console.error("WebP 优化失败：", error); process.exitCode = 1; });
