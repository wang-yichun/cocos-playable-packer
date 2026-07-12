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
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import subsetFont from "subset-font";

import { extractCharacterSet } from "./character-source.js";
import {
  codePointsToText,
  supportedCodePoints,
  validateSfnt,
} from "./sfnt.js";

type CacheStatus = "subset" | "no-benefit" | "no-supported-characters";
type FileAction =
  | "processed-subset"
  | "processed-no-benefit"
  | "processed-no-supported-characters"
  | "cache-subset"
  | "cache-no-benefit"
  | "cache-no-supported-characters"
  | "already-applied";

interface CliOptions {
  buildDirectory: string;
  charactersDirectory: string;
  cacheRootDirectory: string;
  minSavingsBytes: number;
  minSavingsPercent: number;
  confirm: boolean;
}

interface FontFile {
  absolutePath: string;
  relativePath: string;
  bytes: number;
  sha256: string;
}

interface CacheEntry {
  sourceSha256: string;
  sourceBytes: number;
  status: CacheStatus;
  outputSha256?: string;
  outputBytes?: number;
  outputRelativePath?: string;
  requestedCharacters: number;
  supportedCharacters: number;
  unsupportedCharacters: string;
  elapsedMs: number;
  createdAt: string;
  updatedAt: string;
}

interface CacheIndex {
  schemaVersion: 1;
  provider: "subset-font";
  namespace: "build-fonts";
  profileKey: string;
  characterSha256: string;
  entries: Record<string, CacheEntry>;
}

interface SourceResult {
  sourceSha256: string;
  sourceBytes: number;
  finalBytes: number;
  outputSha256: string | null;
  outputPath: string | null;
  action: Exclude<FileAction, "already-applied">;
  supportedCharacters: number;
  unsupportedCharacters: string;
  elapsedMs: number;
}

interface ReportFileEntry {
  relativePath: string;
  currentSha256: string;
  currentBytes: number;
  action: FileAction;
  finalBytes: number;
  savedBytes: number;
  savedPercent: number;
  supportedCharacters: number;
  unsupportedCharacters: string;
  outputSha256: string | null;
}

interface FontSubsetReport {
  schemaVersion: 1;
  tool: "build-font-subsetter";
  status: "preview" | "applied";
  startedAt: string;
  completedAt: string;
  buildDirectory: string;
  charactersDirectory: string;
  cacheDirectory: string;
  backupDirectory: string | null;
  options: {
    minSavingsBytes: number;
    minSavingsPercent: number;
    confirm: boolean;
  };
  characters: {
    sha256: string;
    totalCharacters: number;
    extractedCharacters: number;
    safeCharacters: number;
    extractedStrings: number;
    sourceFiles: Array<{
      file: string;
      extractedStrings: number;
      extractedCharacters: number;
    }>;
  };
  summary: {
    scannedFontFiles: number;
    currentBytesBefore: number;
    finalBytesAfter: number;
    savedBytes: number;
    savedPercent: number;
    processedSubset: number;
    processedNoBenefit: number;
    processedNoSupportedCharacters: number;
    cacheSubsetHits: number;
    cacheNoBenefitHits: number;
    cacheNoSupportedCharactersHits: number;
    alreadyAppliedFiles: number;
    filesReplaced: number;
    totalElapsedMs: number;
  };
  files: ReportFileEntry[];
}

function usage(): string {
  return [
    "构建字体字符子集化",
    "",
    "npm run fonts:subset -- <web-mobile目录> [--characters=./characters] [--confirm]",
    "",
    "默认只生成缓存和报告，不修改构建目录。指定 --confirm 后才替换 TTF。",
    "",
    "选项：",
    "  --characters=<目录>           多语言字符源目录，默认 ./characters",
    "  --cache-dir=<目录>            缓存目录，默认 .font-cache/build-fonts",
    "  --min-savings-bytes=<字节>    最低绝对收益，默认 128",
    "  --min-savings-percent=<百分比> 最低相对收益，默认 1",
    "  --preview                     强制预览",
    "  --confirm                     应用到构建目录",
  ].join("\n");
}

function integer(value: string, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} 必须是不小于 ${minimum} 的整数。`);
  }
  return parsed;
}

function decimal(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的数字。`);
  }
  return parsed;
}

export function parseFontSubsetArguments(argv: readonly string[]): CliOptions {
  const args = argv.filter((argument) => argument !== "--");
  let buildDirectory: string | null = null;
  let charactersDirectory = path.resolve("characters");
  let cacheRootDirectory = path.resolve(".font-cache", "build-fonts");
  let minSavingsBytes = 128;
  let minSavingsPercent = 1;
  let confirm = false;
  let modeSpecified = false;

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--confirm" || argument === "--preview") {
      if (modeSpecified) {
        throw new Error("--preview 与 --confirm 只能指定一个。");
      }
      confirm = argument === "--confirm";
      modeSpecified = true;
      continue;
    }
    if (argument.startsWith("--characters=")) {
      charactersDirectory = path.resolve(argument.slice("--characters=".length));
      continue;
    }
    if (argument.startsWith("--cache-dir=")) {
      cacheRootDirectory = path.resolve(argument.slice("--cache-dir=".length));
      continue;
    }
    if (argument.startsWith("--min-savings-bytes=")) {
      minSavingsBytes = integer(
        argument.slice("--min-savings-bytes=".length),
        "--min-savings-bytes",
        0,
      );
      continue;
    }
    if (argument.startsWith("--min-savings-percent=")) {
      minSavingsPercent = decimal(
        argument.slice("--min-savings-percent=".length),
        "--min-savings-percent",
        0,
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
    buildDirectory = path.resolve(argument);
  }

  if (buildDirectory === null) {
    throw new Error(`${usage()}\n\n缺少 web-mobile 构建目录。`);
  }

  return {
    buildDirectory,
    charactersDirectory,
    cacheRootDirectory,
    minSavingsBytes,
    minSavingsPercent,
    confirm,
  };
}

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function portable(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator * 100;
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

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFonts(buildDirectory: string): Promise<FontFile[]> {
  const files: FontFile[] = [];

  async function visit(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".ttf") {
        const buffer = await readFile(absolutePath);
        validateSfnt(buffer);
        files.push({
          absolutePath,
          relativePath: portable(path.relative(buildDirectory, absolutePath)),
          bytes: buffer.length,
          sha256: sha256(buffer),
        });
      }
    }
  }

  await visit(buildDirectory);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function readIndex(indexPath: string, profileKey: string, characterSha256: string): Promise<CacheIndex> {
  if (!(await exists(indexPath))) {
    return {
      schemaVersion: 1,
      provider: "subset-font",
      namespace: "build-fonts",
      profileKey,
      characterSha256,
      entries: {},
    };
  }
  const parsed = JSON.parse(await readFile(indexPath, "utf8")) as CacheIndex;
  if (
    parsed.schemaVersion !== 1
    || parsed.provider !== "subset-font"
    || parsed.namespace !== "build-fonts"
    || parsed.profileKey !== profileKey
    || parsed.characterSha256 !== characterSha256
  ) {
    throw new Error(`字体缓存索引格式或字符配置不匹配：${indexPath}`);
  }
  return parsed;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(filePath, { force: true });
  await rename(temporaryPath, filePath);
}

async function writeBufferAtomically(filePath: string, buffer: Buffer): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, buffer);
  await rm(filePath, { force: true });
  await rename(temporaryPath, filePath);
}

function meetsSavingsPolicy(
  sourceBytes: number,
  outputBytes: number,
  minSavingsBytes: number,
  minSavingsPercent: number,
): boolean {
  const savedBytes = sourceBytes - outputBytes;
  return savedBytes >= minSavingsBytes
    && percentage(savedBytes, sourceBytes) >= minSavingsPercent;
}

function difference(left: Set<number>, right: Set<number>): number[] {
  return [...left].filter((value) => !right.has(value)).sort((a, b) => a - b);
}

async function loadOutputHashes(cacheRootDirectory: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  if (!(await exists(cacheRootDirectory))) {
    return hashes;
  }

  const profiles = await readdir(cacheRootDirectory, { withFileTypes: true });
  for (const profile of profiles) {
    if (!profile.isDirectory()) {
      continue;
    }
    const indexPath = path.join(cacheRootDirectory, profile.name, "index.json");
    if (!(await exists(indexPath))) {
      continue;
    }
    try {
      const parsed = JSON.parse(await readFile(indexPath, "utf8")) as Partial<CacheIndex>;
      for (const entry of Object.values(parsed.entries ?? {})) {
        if (entry.outputSha256) {
          hashes.set(entry.outputSha256, profile.name);
        }
      }
    } catch {
      // 损坏的其它配置缓存不会静默用于当前结果。
    }
  }
  return hashes;
}

async function processSource(
  font: FontFile,
  requestedCodePoints: readonly number[],
  profileDirectory: string,
  index: CacheIndex,
  options: CliOptions,
): Promise<SourceResult> {
  const cached = index.entries[font.sha256];
  if (cached) {
    if (cached.status === "subset") {
      const outputRelativePath = cached.outputRelativePath;
      if (!outputRelativePath || !cached.outputSha256 || cached.outputBytes === undefined) {
        throw new Error(`字体缓存条目不完整：${font.relativePath}`);
      }
      const outputPath = path.join(profileDirectory, ...outputRelativePath.split("/"));
      const output = await readFile(outputPath).catch(() => null);
      if (
        output === null
        || output.length !== cached.outputBytes
        || sha256(output) !== cached.outputSha256
      ) {
        throw new Error(`字体缓存文件缺失或校验失败：${outputPath}`);
      }
      validateSfnt(output);
      return {
        sourceSha256: font.sha256,
        sourceBytes: font.bytes,
        finalBytes: output.length,
        outputSha256: cached.outputSha256,
        outputPath,
        action: "cache-subset",
        supportedCharacters: cached.supportedCharacters,
        unsupportedCharacters: cached.unsupportedCharacters,
        elapsedMs: 0,
      };
    }

    return {
      sourceSha256: font.sha256,
      sourceBytes: font.bytes,
      finalBytes: font.bytes,
      outputSha256: null,
      outputPath: null,
      action: cached.status === "no-benefit"
        ? "cache-no-benefit"
        : "cache-no-supported-characters",
      supportedCharacters: cached.supportedCharacters,
      unsupportedCharacters: cached.unsupportedCharacters,
      elapsedMs: 0,
    };
  }

  const startedAt = performance.now();
  const source = await readFile(font.absolutePath);
  const sourceSupported = supportedCodePoints(source, requestedCodePoints);
  const unsupported = requestedCodePoints.filter((codePoint) => !sourceSupported.has(codePoint));
  const unsupportedCharacters = codePointsToText(unsupported);
  const createdAt = new Date().toISOString();

  if (sourceSupported.size === 0) {
    const elapsedMs = performance.now() - startedAt;
    index.entries[font.sha256] = {
      sourceSha256: font.sha256,
      sourceBytes: font.bytes,
      status: "no-supported-characters",
      requestedCharacters: requestedCodePoints.length,
      supportedCharacters: 0,
      unsupportedCharacters,
      elapsedMs,
      createdAt,
      updatedAt: createdAt,
    };
    return {
      sourceSha256: font.sha256,
      sourceBytes: font.bytes,
      finalBytes: font.bytes,
      outputSha256: null,
      outputPath: null,
      action: "processed-no-supported-characters",
      supportedCharacters: 0,
      unsupportedCharacters,
      elapsedMs,
    };
  }

  const subsetText = codePointsToText([...sourceSupported].sort((a, b) => a - b));
  const subset = Buffer.from(await subsetFont(source, subsetText, {
    targetFormat: "sfnt",
    preserveNameIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 25],
  }));
  validateSfnt(subset);

  const outputSupported = supportedCodePoints(subset, [...sourceSupported]);
  const lostCodePoints = difference(sourceSupported, outputSupported);
  if (lostCodePoints.length > 0) {
    throw new Error(
      `子集字体丢失原字体支持的字符：${font.relativePath}\n${codePointsToText(lostCodePoints)}`,
    );
  }

  const elapsedMs = performance.now() - startedAt;
  const saved = meetsSavingsPolicy(
    source.length,
    subset.length,
    options.minSavingsBytes,
    options.minSavingsPercent,
  );

  if (!saved) {
    index.entries[font.sha256] = {
      sourceSha256: font.sha256,
      sourceBytes: source.length,
      status: "no-benefit",
      requestedCharacters: requestedCodePoints.length,
      supportedCharacters: sourceSupported.size,
      unsupportedCharacters,
      elapsedMs,
      createdAt,
      updatedAt: createdAt,
    };
    return {
      sourceSha256: font.sha256,
      sourceBytes: source.length,
      finalBytes: source.length,
      outputSha256: null,
      outputPath: null,
      action: "processed-no-benefit",
      supportedCharacters: sourceSupported.size,
      unsupportedCharacters,
      elapsedMs,
    };
  }

  const outputRelativePath = portable(path.join("outputs", `${font.sha256}.ttf`));
  const outputPath = path.join(profileDirectory, ...outputRelativePath.split("/"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeBufferAtomically(outputPath, subset);
  const outputSha256 = sha256(subset);

  index.entries[font.sha256] = {
    sourceSha256: font.sha256,
    sourceBytes: source.length,
    status: "subset",
    outputSha256,
    outputBytes: subset.length,
    outputRelativePath,
    requestedCharacters: requestedCodePoints.length,
    supportedCharacters: sourceSupported.size,
    unsupportedCharacters,
    elapsedMs,
    createdAt,
    updatedAt: createdAt,
  };

  return {
    sourceSha256: font.sha256,
    sourceBytes: source.length,
    finalBytes: subset.length,
    outputSha256,
    outputPath,
    action: "processed-subset",
    supportedCharacters: sourceSupported.size,
    unsupportedCharacters,
    elapsedMs,
  };
}

async function applyResults(
  buildDirectory: string,
  fonts: readonly FontFile[],
  results: ReadonlyMap<string, SourceResult>,
  backupDirectory: string,
): Promise<number> {
  const applied: Array<{ target: string; backup: string }> = [];

  try {
    for (const font of fonts) {
      const result = results.get(font.sha256);
      if (!result?.outputPath) {
        continue;
      }
      const backupPath = path.join(backupDirectory, ...font.relativePath.split("/"));
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(font.absolutePath, backupPath);
      applied.push({ target: font.absolutePath, backup: backupPath });
      await writeBufferAtomically(font.absolutePath, await readFile(result.outputPath));
    }
    return applied.length;
  } catch (error) {
    for (const item of applied.reverse()) {
      await copyFile(item.backup, item.target).catch(() => undefined);
    }
    throw error;
  }
}

export async function runFontSubset(options: CliOptions): Promise<FontSubsetReport> {
  const startedAtDate = new Date();
  const startedAt = performance.now();
  const buildInfo = await stat(options.buildDirectory).catch(() => null);
  if (!buildInfo?.isDirectory()) {
    throw new Error(`构建目录不存在：${options.buildDirectory}`);
  }

  const characters = await extractCharacterSet(options.charactersDirectory);
  const characterSha256 = sha256(characters.text);
  const profileKey = `chars-${characterSha256.slice(0, 16)}`;
  const profileDirectory = path.join(options.cacheRootDirectory, profileKey);
  const indexPath = path.join(profileDirectory, "index.json");
  const reportsDirectory = path.join(profileDirectory, "reports");
  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(path.join(profileDirectory, "characters.txt"), characters.text, "utf8");

  const fonts = await collectFonts(options.buildDirectory);
  const outputHashes = await loadOutputHashes(options.cacheRootDirectory);
  const index = await readIndex(indexPath, profileKey, characterSha256);
  const results = new Map<string, SourceResult>();
  const alreadyApplied = new Set<string>();

  for (const font of fonts) {
    const appliedProfile = outputHashes.get(font.sha256);
    if (appliedProfile !== undefined) {
      if (appliedProfile !== profileKey) {
        throw new Error(
          `检测到字体已经由另一套字符集子集化：${font.relativePath}\n当前配置：${profileKey}\n历史配置：${appliedProfile}\n请重新生成干净的 Cocos web-mobile 构建。`,
        );
      }
      alreadyApplied.add(font.relativePath);
      continue;
    }

    const result = await processSource(
      font,
      characters.codePoints,
      profileDirectory,
      index,
      options,
    );
    results.set(font.sha256, result);
    await writeJson(indexPath, index);
  }

  const backupDirectory = options.confirm
    ? path.join(profileDirectory, "backups", timestamp())
    : null;
  const filesReplaced = options.confirm && backupDirectory !== null
    ? await applyResults(options.buildDirectory, fonts, results, backupDirectory)
    : 0;

  const files: ReportFileEntry[] = fonts.map((font) => {
    if (alreadyApplied.has(font.relativePath)) {
      return {
        relativePath: font.relativePath,
        currentSha256: font.sha256,
        currentBytes: font.bytes,
        action: "already-applied",
        finalBytes: font.bytes,
        savedBytes: 0,
        savedPercent: 0,
        supportedCharacters: characters.codePoints.length,
        unsupportedCharacters: "",
        outputSha256: font.sha256,
      };
    }
    const result = results.get(font.sha256);
    if (!result) {
      throw new Error(`缺少字体处理结果：${font.relativePath}`);
    }
    const savedBytes = font.bytes - result.finalBytes;
    return {
      relativePath: font.relativePath,
      currentSha256: font.sha256,
      currentBytes: font.bytes,
      action: result.action,
      finalBytes: result.finalBytes,
      savedBytes,
      savedPercent: percentage(savedBytes, font.bytes),
      supportedCharacters: result.supportedCharacters,
      unsupportedCharacters: result.unsupportedCharacters,
      outputSha256: result.outputSha256,
    };
  });

  const currentBytesBefore = files.reduce((sum, file) => sum + file.currentBytes, 0);
  const finalBytesAfter = files.reduce((sum, file) => sum + file.finalBytes, 0);
  const savedBytes = currentBytesBefore - finalBytesAfter;
  const count = (action: FileAction): number => files.filter((file) => file.action === action).length;

  const report: FontSubsetReport = {
    schemaVersion: 1,
    tool: "build-font-subsetter",
    status: options.confirm ? "applied" : "preview",
    startedAt: startedAtDate.toISOString(),
    completedAt: new Date().toISOString(),
    buildDirectory: options.buildDirectory,
    charactersDirectory: options.charactersDirectory,
    cacheDirectory: profileDirectory,
    backupDirectory,
    options: {
      minSavingsBytes: options.minSavingsBytes,
      minSavingsPercent: options.minSavingsPercent,
      confirm: options.confirm,
    },
    characters: {
      sha256: characterSha256,
      totalCharacters: characters.codePoints.length,
      extractedCharacters: characters.extractedCharacterCount,
      safeCharacters: characters.safeCharacterCount,
      extractedStrings: characters.extractedStringCount,
      sourceFiles: characters.sourceFiles,
    },
    summary: {
      scannedFontFiles: fonts.length,
      currentBytesBefore,
      finalBytesAfter,
      savedBytes,
      savedPercent: percentage(savedBytes, currentBytesBefore),
      processedSubset: count("processed-subset"),
      processedNoBenefit: count("processed-no-benefit"),
      processedNoSupportedCharacters: count("processed-no-supported-characters"),
      cacheSubsetHits: count("cache-subset"),
      cacheNoBenefitHits: count("cache-no-benefit"),
      cacheNoSupportedCharactersHits: count("cache-no-supported-characters"),
      alreadyAppliedFiles: count("already-applied"),
      filesReplaced,
      totalElapsedMs: performance.now() - startedAt,
    },
    files,
  };

  const archiveReport = path.join(reportsDirectory, `${timestamp()}.json`);
  await writeJson(archiveReport, report);
  await writeJson(path.join(reportsDirectory, "latest.json"), report);

  console.log("");
  console.log(options.confirm ? "字体子集化应用完成" : "字体子集化预览完成");
  console.log("--------------------");
  console.log(`字符源：${options.charactersDirectory}`);
  console.log(`字符数量：${characters.codePoints.length}`);
  console.log(`TTF 数量：${fonts.length}`);
  console.log(`字体原始体积：${formatBytes(currentBytesBefore)}`);
  console.log(`预计/最终体积：${formatBytes(finalBytesAfter)}`);
  console.log(`减少：${formatBytes(savedBytes)} (${report.summary.savedPercent.toFixed(2)}%)`);
  console.log(`替换数量：${filesReplaced}`);
  console.log(`报告：${path.join(reportsDirectory, "latest.json")}`);
  if (!options.confirm) {
    console.log("当前为预览模式，构建目录未被修改。使用 --confirm 后应用。");
  }

  return report;
}

async function main(): Promise<void> {
  await runFontSubset(parseFontSubsetArguments(process.argv.slice(2)));
}

const entryFile = process.argv[1];
if (entryFile !== undefined && import.meta.url === pathToFileURL(entryFile).href) {
  main().catch((error: unknown) => {
    console.error("");
    console.error("字体子集化失败");
    console.error("--------------");
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
