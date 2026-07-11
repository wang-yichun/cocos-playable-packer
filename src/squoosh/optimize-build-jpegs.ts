/// <reference lib="dom" />
/// <reference path="./jsquash-emscripten.d.ts" />

import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import decodeJpeg, {
  init as initJpegDecode,
} from "@jsquash/jpeg/decode.js";
import encodeJpeg, {
  init as initJpegEncode,
} from "@jsquash/jpeg/encode.js";

type CacheStatus = "compressed" | "no-benefit";
type FileAction =
  | "processed-compressed"
  | "processed-no-benefit"
  | "cache-compressed"
  | "cache-no-benefit"
  | "already-applied";

interface CliOptions {
  buildDirectory: string;
  quality: number;
  confirm: boolean;
}

export interface JpegMetadata {
  width: number;
  height: number;
}

interface BuildJpegFile {
  absolutePath: string;
  relativePath: string;
  bytes: number;
  sha256: string;
  metadata: JpegMetadata;
}

interface CacheEntry {
  sourceSha256: string;
  sourceBytes: number;
  width: number;
  height: number;
  status: CacheStatus;
  outputSha256?: string;
  outputBytes?: number;
  outputRelativePath?: string;
  elapsedMs: number;
  createdAt: string;
  updatedAt: string;
}

interface CacheIndex {
  schemaVersion: 1;
  provider: "squoosh-local";
  namespace: "build-jpegs";
  profileKey: string;
  quality: number;
  entries: Record<string, CacheEntry>;
}

interface SourceResult {
  sourceSha256: string;
  sourceBytes: number;
  finalBytes: number;
  outputSha256: string | null;
  outputPath: string | null;
  action: Exclude<FileAction, "already-applied">;
  elapsedMs: number;
}

interface ReportFileEntry {
  relativePath: string;
  duplicateSource: boolean;
  currentSha256: string;
  currentBytes: number;
  action: FileAction;
  finalBytes: number;
  savedBytes: number;
  savedPercent: number;
  outputSha256: string | null;
}

interface OptimizerReport {
  schemaVersion: 1;
  tool: "squoosh-build-jpeg-optimizer";
  status: "preview" | "applied";
  startedAt: string;
  completedAt: string;
  buildDirectory: string;
  cacheDirectory: string;
  backupDirectory: string | null;
  options: {
    quality: number;
    profileKey: string;
    confirm: boolean;
  };
  summary: {
    scannedJpegFiles: number;
    uniqueCurrentImages: number;
    duplicateFiles: number;
    currentBytesBefore: number;
    finalBytesAfter: number;
    savedBytes: number;
    savedPercent: number;
    processedCompressedUnique: number;
    processedNoBenefitUnique: number;
    cacheCompressedHitsUnique: number;
    cacheNoBenefitHitsUnique: number;
    alreadyAppliedFiles: number;
    filesReplaced: number;
    totalElapsedMs: number;
  };
  files: ReportFileEntry[];
}

const require = createRequire(import.meta.url);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

let codecInitialization: Promise<void> | null = null;

function usage(): string {
  return [
    "Squoosh 构建 JPEG 优化",
    "",
    "npm run squoosh:optimize-build-jpegs -- <构建目录> [--quality=80] [--confirm]",
    "",
    "默认仅预览并建立缓存；指定 --confirm 才会替换构建目录中的 JPG/JPEG。",
  ].join("\n");
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

export function isJpegFileName(fileName: string): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return extension === ".jpg" || extension === ".jpeg";
}

export function parseJpegOptimizerArguments(
  argv: readonly string[],
): CliOptions {
  const args = argv.filter((argument) => argument !== "--");
  let buildDirectory: string | null = null;
  let quality = 80;
  let confirm = false;

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--confirm") {
      confirm = true;
      continue;
    }
    if (argument === "--preview") {
      confirm = false;
      continue;
    }
    if (argument.startsWith("--quality=")) {
      quality = integer(
        argument.slice("--quality=".length),
        "--quality",
        1,
        100,
      );
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`无法识别的参数：${argument}`);
    }
    if (buildDirectory !== null) {
      throw new Error(`只允许传入一个构建目录，额外参数：${argument}`);
    }
    buildDirectory = argument;
  }

  if (buildDirectory === null) {
    throw new Error(`${usage()}\n\n缺少构建目录。`);
  }

  return {
    buildDirectory: path.resolve(buildDirectory),
    quality,
    confirm,
  };
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function portable(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator * 100;
}

function profileKey(quality: number): string {
  return `q${quality}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function replaceFile(
  temporaryPath: string,
  targetPath: string,
): Promise<void> {
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String(error.code)
      : "";
    if (code !== "EEXIST" && code !== "EPERM") {
      throw error;
    }
    await rm(targetPath, { force: true });
    await rename(temporaryPath, targetPath);
  }
}

async function writeBufferAtomically(
  filePath: string,
  buffer: Buffer,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, buffer);
    await replaceFile(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeJsonAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeBufferAtomically(
    filePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  );
}

export function inspectJpeg(buffer: Buffer): JpegMetadata {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("不是有效的 JPEG 文件。");
  }

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }
    const marker = buffer[offset];
    if (marker === undefined) {
      break;
    }
    offset += 1;
    if (
      marker === 0x00 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (marker === 0xda || offset + 2 > buffer.length) {
      break;
    }
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break;
    }
    if (JPEG_SOF_MARKERS.has(marker) && segmentLength >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }

  throw new Error("JPEG 文件无法读取宽高。 ");
}

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  return bytes.buffer;
}

function installNodeImageDataPolyfill(): void {
  if (typeof globalThis.ImageData !== "undefined") {
    return;
  }

  class NodeImageData {
    public readonly data: Uint8ClampedArray;
    public readonly width: number;
    public readonly height: number;
    public readonly colorSpace = "srgb" as const;

    public constructor(
      data: Uint8ClampedArray,
      width: number,
      height: number,
    ) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }

  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    writable: true,
    value: NodeImageData,
  });
}

function resolvePackageFile(
  packageJsonRequest: string,
  portableRelativePath: string,
): string {
  const packageJsonPath = require.resolve(packageJsonRequest);
  return path.join(
    path.dirname(packageJsonPath),
    ...portableRelativePath.split("/"),
  );
}

async function compilePackageWasm(
  packageJsonRequest: string,
  portableRelativePath: string,
): Promise<WebAssembly.Module> {
  const wasmPath = resolvePackageFile(
    packageJsonRequest,
    portableRelativePath,
  );
  return WebAssembly.compile(await readFile(wasmPath));
}

async function initializeCodec(): Promise<void> {
  if (codecInitialization !== null) {
    return codecInitialization;
  }

  codecInitialization = (async () => {
    installNodeImageDataPolyfill();
    const [decoderModule, encoderModule] = await Promise.all([
      compilePackageWasm(
        "@jsquash/jpeg/package.json",
        "codec/dec/mozjpeg_dec.wasm",
      ),
      compilePackageWasm(
        "@jsquash/jpeg/package.json",
        "codec/enc/mozjpeg_enc.wasm",
      ),
    ]);
    const initDecode = initJpegDecode as unknown as (
      module: WebAssembly.Module,
    ) => Promise<void>;
    const initEncode = initJpegEncode as unknown as (
      module: WebAssembly.Module,
    ) => Promise<void>;
    await Promise.all([
      initDecode(decoderModule),
      initEncode(encoderModule),
    ]);
  })();

  return codecInitialization;
}

export async function compressJpegBuffer(
  sourceBuffer: Buffer,
  quality: number,
): Promise<Buffer> {
  await initializeCodec();
  const imageData = await decodeJpeg(toExactArrayBuffer(sourceBuffer));
  const output = await encodeJpeg(imageData, {
    quality,
    chroma_quality: quality,
  });
  return Buffer.from(output);
}

async function collectJpegFiles(
  buildDirectory: string,
): Promise<BuildJpegFile[]> {
  const absolutePaths: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && isJpegFileName(entry.name)) {
        absolutePaths.push(absolutePath);
      }
    }
  }

  await visit(buildDirectory);
  absolutePaths.sort((left, right) => left.localeCompare(right));

  return Promise.all(
    absolutePaths.map(async (absolutePath) => {
      const buffer = await readFile(absolutePath);
      return {
        absolutePath,
        relativePath: portable(path.relative(buildDirectory, absolutePath)),
        bytes: buffer.length,
        sha256: sha256(buffer),
        metadata: inspectJpeg(buffer),
      };
    }),
  );
}

function emptyIndex(quality: number): CacheIndex {
  return {
    schemaVersion: 1,
    provider: "squoosh-local",
    namespace: "build-jpegs",
    profileKey: profileKey(quality),
    quality,
    entries: {},
  };
}

function isCacheIndex(value: unknown, quality: number): value is CacheIndex {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<CacheIndex>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.provider === "squoosh-local" &&
    candidate.namespace === "build-jpegs" &&
    candidate.profileKey === profileKey(quality) &&
    candidate.quality === quality &&
    typeof candidate.entries === "object" &&
    candidate.entries !== null
  );
}

async function loadIndex(
  indexPath: string,
  quality: number,
): Promise<CacheIndex> {
  if (!(await exists(indexPath))) {
    return emptyIndex(quality);
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(indexPath, "utf8"));
    return isCacheIndex(parsed, quality) ? parsed : emptyIndex(quality);
  } catch {
    return emptyIndex(quality);
  }
}

async function loadTinyPngOutputHashes(
  projectRoot: string,
): Promise<Set<string>> {
  const indexPath = path.join(
    projectRoot,
    ".tinypng-cache",
    "build-images",
    "index.json",
  );
  if (!(await exists(indexPath))) {
    return new Set();
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(indexPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return new Set();
    }
    const map = (parsed as {
      sourceSha256ByCompressedSha256?: unknown;
    }).sourceSha256ByCompressedSha256;
    return typeof map === "object" && map !== null
      ? new Set(Object.keys(map))
      : new Set();
  } catch {
    return new Set();
  }
}

async function loadKnownJpegOutputs(
  cacheRoot: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!(await exists(cacheRoot))) {
    return result;
  }
  const profiles = await readdir(cacheRoot, { withFileTypes: true });
  for (const profile of profiles) {
    if (!profile.isDirectory()) {
      continue;
    }
    const indexPath = path.join(cacheRoot, profile.name, "index.json");
    if (!(await exists(indexPath))) {
      continue;
    }
    try {
      const parsed = JSON.parse(await readFile(indexPath, "utf8")) as {
        entries?: Record<string, CacheEntry>;
      };
      for (const entry of Object.values(parsed.entries ?? {})) {
        if (entry.outputSha256 !== undefined) {
          result.set(entry.outputSha256, profile.name);
        }
      }
    } catch {
      // Ignore damaged historical indexes. The current profile is validated separately.
    }
  }
  return result;
}

async function validateCompressedCacheEntry(
  entry: CacheEntry,
  profileDirectory: string,
): Promise<string | null> {
  if (
    entry.status !== "compressed" ||
    entry.outputRelativePath === undefined ||
    entry.outputSha256 === undefined ||
    entry.outputBytes === undefined
  ) {
    return null;
  }
  const outputPath = path.join(
    profileDirectory,
    ...entry.outputRelativePath.split("/"),
  );
  const info = await stat(outputPath).catch(() => null);
  if (!info?.isFile() || info.size !== entry.outputBytes) {
    return null;
  }
  const buffer = await readFile(outputPath);
  if (sha256(buffer) !== entry.outputSha256) {
    return null;
  }
  const metadata = inspectJpeg(buffer);
  if (metadata.width !== entry.width || metadata.height !== entry.height) {
    return null;
  }
  return outputPath;
}

async function processSource(
  file: BuildJpegFile,
  quality: number,
  profileDirectory: string,
  index: CacheIndex,
): Promise<SourceResult> {
  const cached = index.entries[file.sha256];
  if (
    cached !== undefined &&
    cached.sourceBytes === file.bytes &&
    cached.width === file.metadata.width &&
    cached.height === file.metadata.height
  ) {
    if (cached.status === "no-benefit") {
      return {
        sourceSha256: file.sha256,
        sourceBytes: file.bytes,
        finalBytes: file.bytes,
        outputSha256: null,
        outputPath: null,
        action: "cache-no-benefit",
        elapsedMs: cached.elapsedMs,
      };
    }
    const outputPath = await validateCompressedCacheEntry(
      cached,
      profileDirectory,
    );
    if (outputPath !== null) {
      return {
        sourceSha256: file.sha256,
        sourceBytes: file.bytes,
        finalBytes: cached.outputBytes ?? file.bytes,
        outputSha256: cached.outputSha256 ?? null,
        outputPath,
        action: "cache-compressed",
        elapsedMs: cached.elapsedMs,
      };
    }
  }

  const sourceBuffer = await readFile(file.absolutePath);
  const started = performance.now();
  const outputBuffer = await compressJpegBuffer(sourceBuffer, quality);
  const elapsedMs = performance.now() - started;
  const outputMetadata = inspectJpeg(outputBuffer);
  if (
    outputMetadata.width !== file.metadata.width ||
    outputMetadata.height !== file.metadata.height
  ) {
    throw new Error(
      `JPEG 压缩前后尺寸不一致：${file.relativePath} ` +
      `${file.metadata.width}x${file.metadata.height} → ` +
      `${outputMetadata.width}x${outputMetadata.height}`,
    );
  }

  const now = new Date().toISOString();
  if (outputBuffer.length >= sourceBuffer.length) {
    index.entries[file.sha256] = {
      sourceSha256: file.sha256,
      sourceBytes: file.bytes,
      width: file.metadata.width,
      height: file.metadata.height,
      status: "no-benefit",
      elapsedMs,
      createdAt: cached?.createdAt ?? now,
      updatedAt: now,
    };
    return {
      sourceSha256: file.sha256,
      sourceBytes: file.bytes,
      finalBytes: file.bytes,
      outputSha256: null,
      outputPath: null,
      action: "processed-no-benefit",
      elapsedMs,
    };
  }

  const outputRelativePath = portable(
    path.join("outputs", `${file.sha256}.jpg`),
  );
  const outputPath = path.join(
    profileDirectory,
    ...outputRelativePath.split("/"),
  );
  await writeBufferAtomically(outputPath, outputBuffer);
  const outputSha256 = sha256(outputBuffer);
  index.entries[file.sha256] = {
    sourceSha256: file.sha256,
    sourceBytes: file.bytes,
    width: file.metadata.width,
    height: file.metadata.height,
    status: "compressed",
    outputSha256,
    outputBytes: outputBuffer.length,
    outputRelativePath,
    elapsedMs,
    createdAt: cached?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    sourceSha256: file.sha256,
    sourceBytes: file.bytes,
    finalBytes: outputBuffer.length,
    outputSha256,
    outputPath,
    action: "processed-compressed",
    elapsedMs,
  };
}

async function applyCandidates(
  buildDirectory: string,
  files: readonly BuildJpegFile[],
  results: ReadonlyMap<string, SourceResult>,
  backupDirectory: string,
): Promise<number> {
  const applied: Array<{ targetPath: string; backupPath: string }> = [];
  try {
    for (const file of files) {
      const result = results.get(file.sha256);
      if (result?.outputPath === null || result?.outputPath === undefined) {
        continue;
      }
      const backupPath = path.join(
        backupDirectory,
        ...file.relativePath.split("/"),
      );
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(file.absolutePath, backupPath);
      await writeBufferAtomically(
        file.absolutePath,
        await readFile(result.outputPath),
      );
      applied.push({ targetPath: file.absolutePath, backupPath });
    }
  } catch (error) {
    for (const item of applied.reverse()) {
      await copyFile(item.backupPath, item.targetPath).catch(() => undefined);
    }
    throw error;
  }
  return applied.length;
}

async function main(): Promise<void> {
  const options = parseJpegOptimizerArguments(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const projectRoot = process.cwd();
  const buildInfo = await stat(options.buildDirectory).catch(() => null);
  if (!buildInfo?.isDirectory()) {
    throw new Error(`构建目录不存在：${options.buildDirectory}`);
  }

  const key = profileKey(options.quality);
  const cacheRoot = path.join(projectRoot, ".squoosh-cache", "build-jpegs");
  const profileDirectory = path.join(cacheRoot, key);
  const indexPath = path.join(profileDirectory, "index.json");
  const reportDirectory = path.join(profileDirectory, "reports");
  const files = await collectJpegFiles(options.buildDirectory);
  const index = await loadIndex(indexPath, options.quality);
  const currentOutputToSource = new Map<string, string>();
  for (const entry of Object.values(index.entries)) {
    if (entry.outputSha256 !== undefined) {
      currentOutputToSource.set(entry.outputSha256, entry.sourceSha256);
    }
  }

  const tinyPngOutputs = await loadTinyPngOutputHashes(projectRoot);
  const tinyPngMatches = files.filter((file) => tinyPngOutputs.has(file.sha256));
  if (tinyPngMatches.length > 0) {
    throw new Error(
      `检测到 ${tinyPngMatches.length} 张当前 JPG/JPEG 来自 TinyPNG 缓存。` +
      "请重新生成干净 web-mobile 后再使用 Squoosh。",
    );
  }

  const knownOutputs = await loadKnownJpegOutputs(cacheRoot);
  for (const file of files) {
    const knownProfile = knownOutputs.get(file.sha256);
    if (
      knownProfile !== undefined &&
      knownProfile !== key &&
      !currentOutputToSource.has(file.sha256)
    ) {
      throw new Error(
        `检测到其他 JPEG 质量配置的 Squoosh 输出：${file.relativePath} ` +
        `(${knownProfile})。请重新生成干净 web-mobile，避免二次有损压缩。`,
      );
    }
  }

  const sourceGroups = new Map<string, BuildJpegFile[]>();
  let alreadyAppliedFiles = 0;
  for (const file of files) {
    if (currentOutputToSource.has(file.sha256)) {
      alreadyAppliedFiles += 1;
      continue;
    }
    const group = sourceGroups.get(file.sha256);
    if (group === undefined) {
      sourceGroups.set(file.sha256, [file]);
    } else {
      group.push(file);
    }
  }

  const results = new Map<string, SourceResult>();
  for (const group of sourceGroups.values()) {
    const representative = group[0];
    if (representative === undefined) {
      continue;
    }
    const result = await processSource(
      representative,
      options.quality,
      profileDirectory,
      index,
    );
    results.set(representative.sha256, result);
  }
  await writeJsonAtomically(indexPath, index);

  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  const backupDirectory = path.join(
    profileDirectory,
    "backups",
    timestamp,
  );
  const filesReplaced = options.confirm
    ? await applyCandidates(
        options.buildDirectory,
        files.filter((file) => !currentOutputToSource.has(file.sha256)),
        results,
        backupDirectory,
      )
    : 0;

  const seenSourceHashes = new Set<string>();
  const reportFiles: ReportFileEntry[] = files.map((file) => {
    const sourceSha = currentOutputToSource.get(file.sha256);
    if (sourceSha !== undefined) {
      return {
        relativePath: file.relativePath,
        duplicateSource: false,
        currentSha256: file.sha256,
        currentBytes: file.bytes,
        action: "already-applied",
        finalBytes: file.bytes,
        savedBytes: 0,
        savedPercent: 0,
        outputSha256: file.sha256,
      };
    }
    const result = results.get(file.sha256);
    if (result === undefined) {
      throw new Error(`缺少 JPEG 处理结果：${file.relativePath}`);
    }
    const duplicateSource = seenSourceHashes.has(file.sha256);
    seenSourceHashes.add(file.sha256);
    const savedBytes = file.bytes - result.finalBytes;
    return {
      relativePath: file.relativePath,
      duplicateSource,
      currentSha256: file.sha256,
      currentBytes: file.bytes,
      action: result.action,
      finalBytes: result.finalBytes,
      savedBytes,
      savedPercent: percentage(savedBytes, file.bytes),
      outputSha256: result.outputSha256,
    };
  });

  const currentBytesBefore = reportFiles.reduce(
    (total, file) => total + file.currentBytes,
    0,
  );
  const finalBytesAfter = reportFiles.reduce(
    (total, file) => total + file.finalBytes,
    0,
  );
  const actions = [...results.values()].map((result) => result.action);
  const completedAt = new Date().toISOString();
  const report: OptimizerReport = {
    schemaVersion: 1,
    tool: "squoosh-build-jpeg-optimizer",
    status: options.confirm ? "applied" : "preview",
    startedAt,
    completedAt,
    buildDirectory: options.buildDirectory,
    cacheDirectory: profileDirectory,
    backupDirectory: options.confirm && filesReplaced > 0
      ? backupDirectory
      : null,
    options: {
      quality: options.quality,
      profileKey: key,
      confirm: options.confirm,
    },
    summary: {
      scannedJpegFiles: files.length,
      uniqueCurrentImages: new Set(files.map((file) => file.sha256)).size,
      duplicateFiles: files.length - new Set(files.map((file) => file.sha256)).size,
      currentBytesBefore,
      finalBytesAfter,
      savedBytes: currentBytesBefore - finalBytesAfter,
      savedPercent: percentage(
        currentBytesBefore - finalBytesAfter,
        currentBytesBefore,
      ),
      processedCompressedUnique: actions.filter(
        (action) => action === "processed-compressed",
      ).length,
      processedNoBenefitUnique: actions.filter(
        (action) => action === "processed-no-benefit",
      ).length,
      cacheCompressedHitsUnique: actions.filter(
        (action) => action === "cache-compressed",
      ).length,
      cacheNoBenefitHitsUnique: actions.filter(
        (action) => action === "cache-no-benefit",
      ).length,
      alreadyAppliedFiles,
      filesReplaced,
      totalElapsedMs: performance.now() - started,
    },
    files: reportFiles,
  };

  const archiveName = `report-${completedAt.replace(/[:.]/g, "-")}.json`;
  await writeJsonAtomically(path.join(reportDirectory, "latest.json"), report);
  await writeJsonAtomically(path.join(reportDirectory, archiveName), report);

  console.log("");
  console.log("Squoosh JPEG 优化完成");
  console.log("--------------------");
  console.log(`模式：${options.confirm ? "已应用" : "预览"}`);
  console.log(`质量：${options.quality}`);
  console.log(`扫描 JPG/JPEG：${report.summary.scannedJpegFiles}`);
  console.log(`唯一内容：${report.summary.uniqueCurrentImages}`);
  console.log(`替换文件：${report.summary.filesReplaced}`);
  console.log(`原始体积：${currentBytesBefore} B`);
  console.log(`最终体积：${finalBytesAfter} B`);
  console.log(
    `减少：${report.summary.savedBytes} B ` +
    `(${report.summary.savedPercent.toFixed(2)}%)`,
  );
  console.log(`报告：${path.join(reportDirectory, "latest.json")}`);
}

const entryFile = process.argv[1];
if (
  entryFile !== undefined &&
  import.meta.url === pathToFileURL(entryFile).href
) {
  main().catch((error: unknown) => {
    console.error("");
    console.error("Squoosh JPEG 优化失败");
    console.error("----------------------");
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
