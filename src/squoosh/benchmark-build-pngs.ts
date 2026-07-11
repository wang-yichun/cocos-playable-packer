/// <reference lib="dom" />
/// <reference path="./jsquash-emscripten.d.ts" />

import { createHash } from "node:crypto";
import {
    mkdir,
    readFile,
    readdir,
    rename,
    stat,
    unlink,
    writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";

import optimisePng, {
    init as initOxiPng,
} from "@jsquash/oxipng/optimise.js";
import sharp from "sharp";

interface CliOptions {
    buildDirectory: string;
    mode:
        | { type: "all" }
        | { type: "limit"; limit: number };
    minimumSourceBytes: number;
    quality: number;
    colours: number;
    effort: number;
    dither: number;
    oxiPngLevel: number;
    cacheRootDirectory: string;
    cacheDirectory: string;
    tinyPngCacheDirectory: string;
    compareTinyPng: boolean;
    profileKey: string;
}

interface PngMetadata {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    colorTypeName: string;
    hasPalette: boolean;
    hasTransparencyChunk: boolean;
}

interface VisualDifference {
    differentPixelPercent: number;
    maxChannelError: number;
    alphaRmse: number;
    blackBackgroundRmse: number;
    blackBackgroundPsnr: number | null;
    whiteBackgroundRmse: number;
    whiteBackgroundPsnr: number | null;
}

interface SourceFileRecord {
    absolutePath: string;
    relativePath: string;
    sourceBytes: number;
    sourceSha256: string;
    png: PngMetadata;
}

interface UniqueSourceRecord {
    sourceSha256: string;
    sourceBytes: number;
    png: PngMetadata;
    representativePath: string;
    relativePaths: string[];
}

type LocalAction =
    | "cache-compressed"
    | "cache-no-benefit"
    | "processed-compressed"
    | "processed-no-benefit"
    | "skipped-below-min-bytes"
    | "skipped-processing-limit"
    | "failed";

interface LocalSourceResult {
    action: LocalAction;
    sourceSha256: string;
    sourceBytes: number;
    finalBytes: number;
    savedBytes: number;
    savedPercent: number;
    outputSha256: string | null;
    outputPath: string | null;
    selectedStage: "quantized" | "quantized-oxipng" | "source";
    quantizedBytes: number | null;
    oxiPngBytes: number | null;
    quantizeElapsedMs: number;
    oxiPngElapsedMs: number;
    totalElapsedMs: number;
    png: PngMetadata;
    visualDifference: VisualDifference;
    message?: string;
}

type TinyPngStatus =
    | "compressed"
    | "no-benefit"
    | "unavailable"
    | "invalid";

interface TinyPngSourceResult {
    status: TinyPngStatus;
    sourceSha256: string;
    sourceBytes: number;
    finalBytes: number | null;
    savedBytes: number | null;
    savedPercent: number | null;
    outputSha256: string | null;
    outputPath: string | null;
    png: PngMetadata | null;
    visualDifference: VisualDifference | null;
    message?: string;
}

interface ComparisonResult {
    comparable: boolean;
    localBytes: number;
    tinyPngBytes: number | null;
    deltaBytesLocalMinusTinyPng: number | null;
    deltaPercentOfTinyPng: number | null;
    relation: "local-smaller" | "tinypng-smaller" | "equal" | "unavailable";
    withinFivePercent: boolean | null;
    localMoreThanTwentyPercentLarger: boolean | null;
}

interface FileReportItem {
    relativePath: string;
    duplicateSource: boolean;
    sourceSha256: string;
    sourceBytes: number;
    png: PngMetadata;
    local: LocalSourceResult;
    tinyPng: TinyPngSourceResult;
    comparison: ComparisonResult;
}

interface BenchmarkSummary {
    scannedPngFiles: number;
    uniqueSourceImages: number;
    duplicateFiles: number;
    totalSourceBytes: number;

    localCacheCompressedHitsUnique: number;
    localCacheNoBenefitHitsUnique: number;
    localProcessedUnique: number;
    localCompressedUnique: number;
    localNoBenefitUnique: number;
    localSkippedBelowMinBytesUnique: number;
    localSkippedByLimitUnique: number;
    localFailedUnique: number;
    localCacheInvalidUnique: number;

    localPolicyComplete: boolean;
    localFinalBytesForAllFiles: number;
    localSavedBytesForAllFiles: number;
    localSavedPercentForAllFiles: number;

    tinyPngCompressedUnique: number;
    tinyPngNoBenefitUnique: number;
    tinyPngUnavailableUnique: number;
    tinyPngInvalidUnique: number;

    comparableUniqueSources: number;
    comparableFiles: number;
    localSmallerUnique: number;
    tinyPngSmallerUnique: number;
    equalUnique: number;
    withinFivePercentUnique: number;
    localMoreThanTwentyPercentLargerUnique: number;

    comparableSourceBytesForFiles: number;
    localBytesOnComparableFiles: number;
    tinyPngBytesOnComparableFiles: number;
    deltaBytesLocalMinusTinyPng: number;
    deltaPercentOfTinyPng: number;

    totalElapsedMs: number;
}

interface ReviewItem {
    relativePath: string;
    sourceSha256: string;
    sourceBytes: number;
    localBytes: number;
    tinyPngBytes: number | null;
    deltaBytesLocalMinusTinyPng: number | null;
    deltaPercentOfTinyPng: number | null;
    whiteBackgroundPsnr: number | null;
    alphaRmse: number;
    localOutputPath: string | null;
    tinyPngOutputPath: string | null;
}

interface BenchmarkReport {
    schemaVersion: 1;
    tool: "squoosh-build-png-benchmark";
    startedAt: string;
    completedAt: string;
    buildDirectory: string;
    cacheDirectory: string;
    tinyPngCacheDirectory: string;
    options: {
        mode: CliOptions["mode"];
        minimumSourceBytes: number;
        quality: number;
        colours: number;
        effort: number;
        dither: number;
        oxiPngLevel: number;
        compareTinyPng: boolean;
        profileKey: string;
    };
    summary: BenchmarkSummary;
    review: {
        localLargestVsTinyPng: ReviewItem[];
        lowestWhiteBackgroundPsnr: ReviewItem[];
        largestLocalSavings: ReviewItem[];
    };
    files: FileReportItem[];
}

interface LocalCacheEntry {
    sourceSha256: string;
    sourceBytes: number;
    width: number;
    height: number;
    status: "compressed" | "no-benefit";
    selectedStage: "quantized" | "quantized-oxipng" | "source";
    quantizedBytes: number;
    oxiPngBytes: number;
    outputSha256?: string;
    outputBytes?: number;
    outputRelativePath?: string;
    outputPng?: PngMetadata;
    visualDifference: VisualDifference;
    quantizeElapsedMs: number;
    oxiPngElapsedMs: number;
    totalElapsedMs: number;
    createdAt: string;
    updatedAt: string;
}

interface LocalCacheIndex {
    schemaVersion: 1;
    provider: "squoosh-local";
    namespace: "build-png-benchmark";
    profileKey: string;
    options: {
        quality: number;
        colours: number;
        effort: number;
        dither: number;
        oxiPngLevel: number;
    };
    createdAt: string;
    updatedAt: string;
    entriesBySourceSha256: Record<string, LocalCacheEntry>;
}

interface LoadedLocalCache {
    cacheDirectory: string;
    filesDirectory: string;
    reportsDirectory: string;
    indexPath: string;
    index: LocalCacheIndex;
}

interface TinyPngCacheEntryLike {
    status?: unknown;
    sourceSha256?: unknown;
    sourceBytes?: unknown;
    compressedSha256?: unknown;
    compressedBytes?: unknown;
    compressedRelativePath?: unknown;
}

interface TinyPngCacheContext {
    cacheDirectory: string;
    indexPath: string;
    entriesBySourceSha256: Record<string, unknown> | null;
    loadError: string | null;
}

const require = createRequire(import.meta.url);

const PNG_SIGNATURE = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
]);

const ZERO_VISUAL_DIFFERENCE: VisualDifference = {
    differentPixelPercent: 0,
    maxChannelError: 0,
    alphaRmse: 0,
    blackBackgroundRmse: 0,
    blackBackgroundPsnr: null,
    whiteBackgroundRmse: 0,
    whiteBackgroundPsnr: null,
};

function printUsage(): void {
    console.log([
        "用法：",
        "  npm run squoosh:benchmark-build-pngs -- -- <web-mobile目录> --limit=<数量> [选项]",
        "  npm run squoosh:benchmark-build-pngs -- -- <web-mobile目录> --all [选项]",
        "",
        "选项：",
        "  --limit=<数量>            最多处理多少个尚无本地缓存的唯一原图，允许 0。",
        "  --all                     处理全部尚无本地缓存的唯一原图。",
        "  --min-bytes=<字节>        未缓存原图的最小处理体积，默认 4096。",
        "  --quality=<0-100>         Sharp 调色板质量，默认 80。",
        "  --colours=<2-256>         最大调色板颜色数，默认 256。",
        "  --effort=<1-10>           Sharp 调色板计算强度，默认 10。",
        "  --dither=<0-1>            Floyd-Steinberg 抖动强度，默认 0.5。",
        "  --oxipng-level=<1-6>      OxiPNG 优化等级，默认 3。",
        "  --cache-dir=<目录>        本地基准缓存根目录，默认 .squoosh-cache/build-pngs。",
        "  --tinypng-cache=<目录>    TinyPNG 构建缓存目录，默认 .tinypng-cache/build-images。",
        "  --no-tinypng-compare      不读取 TinyPNG 缓存参照。",
    ].join("\n"));
}

function parseInteger(
    rawValue: string,
    optionName: string,
    minimum: number,
    maximum: number,
): number {
    const value = Number(rawValue);

    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(
            `${optionName} 必须是 ${minimum} 到 ${maximum} 之间的整数。`,
        );
    }

    return value;
}

function parseNumber(
    rawValue: string,
    optionName: string,
    minimum: number,
    maximum: number,
): number {
    const value = Number(rawValue);

    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(
            `${optionName} 必须是 ${minimum} 到 ${maximum} 之间的数字。`,
        );
    }

    return value;
}

function formatDecimalForKey(value: number): string {
    return String(value)
        .replace(/\./g, "p")
        .replace(/-/g, "m");
}

function createProfileKey(options: {
    quality: number;
    colours: number;
    effort: number;
    dither: number;
    oxiPngLevel: number;
}): string {
    return [
        `q${options.quality}`,
        `c${options.colours}`,
        `e${options.effort}`,
        `d${formatDecimalForKey(options.dither)}`,
        `o${options.oxiPngLevel}`,
    ].join("-");
}

function parseCliArguments(argv: readonly string[]): CliOptions {
    let buildDirectory: string | null = null;
    let mode: CliOptions["mode"] | null = null;
    let minimumSourceBytes = 4096;
    let quality = 80;
    let colours = 256;
    let effort = 10;
    let dither = 0.5;
    let oxiPngLevel = 3;
    let cacheRootDirectory = path.resolve(
        ".squoosh-cache",
        "build-pngs",
    );
    let tinyPngCacheDirectory = path.resolve(
        ".tinypng-cache",
        "build-images",
    );
    let compareTinyPng = true;

    for (const argument of argv) {
        if (argument === "--") {
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            printUsage();
            process.exit(0);
        }

        if (argument === "--all") {
            if (mode !== null) {
                throw new Error("--all 与 --limit 只能指定一个。");
            }

            mode = { type: "all" };
            continue;
        }

        if (argument.startsWith("--limit=")) {
            if (mode !== null) {
                throw new Error("--all 与 --limit 只能指定一个。");
            }

            mode = {
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

        if (argument.startsWith("--min-bytes=")) {
            minimumSourceBytes = parseInteger(
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
            dither = parseNumber(
                argument.slice("--dither=".length),
                "--dither",
                0,
                1,
            );
            continue;
        }

        if (argument.startsWith("--oxipng-level=")) {
            oxiPngLevel = parseInteger(
                argument.slice("--oxipng-level=".length),
                "--oxipng-level",
                1,
                6,
            );
            continue;
        }

        if (argument.startsWith("--cache-dir=")) {
            cacheRootDirectory = path.resolve(
                argument.slice("--cache-dir=".length),
            );
            continue;
        }

        if (argument.startsWith("--tinypng-cache=")) {
            tinyPngCacheDirectory = path.resolve(
                argument.slice("--tinypng-cache=".length),
            );
            continue;
        }

        if (argument === "--no-tinypng-compare") {
            compareTinyPng = false;
            continue;
        }

        if (argument.startsWith("--")) {
            throw new Error(`未知参数：${argument}`);
        }

        if (buildDirectory !== null) {
            throw new Error(`只能指定一个构建目录：${argument}`);
        }

        buildDirectory = path.resolve(argument);
    }

    if (buildDirectory === null) {
        printUsage();
        throw new Error("缺少 Cocos 构建目录。");
    }

    if (mode === null) {
        printUsage();
        throw new Error("必须指定 --limit=<数量> 或 --all。");
    }

    const profileKey = createProfileKey({
        quality,
        colours,
        effort,
        dither,
        oxiPngLevel,
    });

    return {
        buildDirectory,
        mode,
        minimumSourceBytes,
        quality,
        colours,
        effort,
        dither,
        oxiPngLevel,
        cacheRootDirectory,
        cacheDirectory: path.join(
            cacheRootDirectory,
            profileKey,
        ),
        tinyPngCacheDirectory,
        compareTinyPng,
        profileKey,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function calculateSha256(buffer: Buffer): string {
    return createHash("sha256")
        .update(buffer)
        .digest("hex");
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatSignedBytes(bytes: number): string {
    const sign = bytes > 0 ? "+" : bytes < 0 ? "-" : "";
    return `${sign}${formatBytes(Math.abs(bytes))}`;
}

function toPortablePath(filePath: string): string {
    return filePath.split(path.sep).join("/");
}

function resolvePortableRelativePath(
    rootDirectory: string,
    portableRelativePath: string,
): string {
    return path.resolve(
        rootDirectory,
        ...portableRelativePath.split("/"),
    );
}

function isPathInsideRoot(
    rootDirectory: string,
    targetPath: string,
): boolean {
    const relativePath = path.relative(
        path.resolve(rootDirectory),
        path.resolve(targetPath),
    );

    return relativePath === "" || (
        !relativePath.startsWith(`..${path.sep}`) &&
        relativePath !== ".." &&
        !path.isAbsolute(relativePath)
    );
}

function inspectPng(buffer: Buffer): PngMetadata {
    if (
        buffer.length < 33 ||
        !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
        buffer.toString("ascii", 12, 16) !== "IHDR"
    ) {
        throw new Error("文件不是有效 PNG。");
    }

    const bitDepth = buffer[24];
    const colorType = buffer[25];

    if (bitDepth === undefined || colorType === undefined) {
        throw new Error("PNG IHDR 信息不完整。");
    }

    const colorTypeNames: Record<number, string> = {
        0: "灰度",
        2: "真彩色 RGB",
        3: "索引色",
        4: "灰度 + Alpha",
        6: "真彩色 RGBA",
    };

    let offset = 8;
    let hasPalette = false;
    let hasTransparencyChunk = false;

    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const nextOffset = offset + 12 + length;

        if (nextOffset > buffer.length) {
            throw new Error("PNG chunk 长度越界。");
        }

        if (type === "PLTE") {
            hasPalette = true;
        }

        if (type === "tRNS") {
            hasTransparencyChunk = true;
        }

        offset = nextOffset;

        if (type === "IEND") {
            break;
        }
    }

    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
        bitDepth,
        colorType,
        colorTypeName: colorTypeNames[colorType] ?? `未知(${colorType})`,
        hasPalette,
        hasTransparencyChunk,
    };
}

function assertSameDimensions(
    source: PngMetadata,
    candidate: PngMetadata,
    description: string,
): void {
    if (
        source.width !== candidate.width ||
        source.height !== candidate.height
    ) {
        throw new Error(
            `${description}尺寸变化：` +
            `${source.width}x${source.height} → ` +
            `${candidate.width}x${candidate.height}`,
        );
    }
}

async function validateBuildDirectory(buildDirectory: string): Promise<void> {
    let directoryStat;

    try {
        directoryStat = await stat(buildDirectory);
    } catch (error) {
        throw new Error(`构建目录不存在：${buildDirectory}`, {
            cause: error,
        });
    }

    if (!directoryStat.isDirectory()) {
        throw new Error(`构建路径不是目录：${buildDirectory}`);
    }

    const indexHtmlPath = path.join(buildDirectory, "index.html");

    try {
        const indexStat = await stat(indexHtmlPath);

        if (!indexStat.isFile()) {
            throw new Error("index.html 不是文件。");
        }
    } catch (error) {
        throw new Error(
            `目录不像 Cocos Web 构建：缺少 index.html（${indexHtmlPath}）`,
            { cause: error },
        );
    }
}

async function scanPngFiles(
    rootDirectory: string,
): Promise<string[]> {
    const output: string[] = [];

    async function scan(currentDirectory: string): Promise<void> {
        const entries = await readdir(currentDirectory, {
            withFileTypes: true,
        });

        entries.sort((left, right) =>
            left.name.localeCompare(right.name, "en"),
        );

        for (const entry of entries) {
            const absolutePath = path.join(
                currentDirectory,
                entry.name,
            );

            if (entry.isDirectory()) {
                await scan(absolutePath);
                continue;
            }

            if (
                entry.isFile() &&
                path.extname(entry.name).toLowerCase() === ".png"
            ) {
                output.push(absolutePath);
            }
        }
    }

    await scan(rootDirectory);

    output.sort((left, right) =>
        toPortablePath(path.relative(rootDirectory, left))
            .localeCompare(
                toPortablePath(path.relative(rootDirectory, right)),
                "en",
            ),
    );

    return output;
}

async function inspectSourceFiles(
    buildDirectory: string,
    absolutePaths: readonly string[],
): Promise<{
    files: SourceFileRecord[];
    uniqueSources: UniqueSourceRecord[];
}> {
    const files: SourceFileRecord[] = [];
    const uniqueMap = new Map<string, UniqueSourceRecord>();

    for (const [index, absolutePath] of absolutePaths.entries()) {
        const sourceBuffer = await readFile(absolutePath);
        const sourceSha256 = calculateSha256(sourceBuffer);
        const png = inspectPng(sourceBuffer);
        const relativePath = toPortablePath(
            path.relative(buildDirectory, absolutePath),
        );

        const file: SourceFileRecord = {
            absolutePath,
            relativePath,
            sourceBytes: sourceBuffer.length,
            sourceSha256,
            png,
        };

        files.push(file);

        const existing = uniqueMap.get(sourceSha256);

        if (existing) {
            if (
                existing.sourceBytes !== file.sourceBytes ||
                existing.png.width !== png.width ||
                existing.png.height !== png.height
            ) {
                throw new Error(
                    `相同 SHA-256 的 PNG 元数据不一致：${relativePath}`,
                );
            }

            existing.relativePaths.push(relativePath);
        } else {
            uniqueMap.set(sourceSha256, {
                sourceSha256,
                sourceBytes: file.sourceBytes,
                png,
                representativePath: absolutePath,
                relativePaths: [relativePath],
            });
        }

        if ((index + 1) % 25 === 0 || index + 1 === absolutePaths.length) {
            console.log(
                `读取并哈希 PNG：${index + 1}/${absolutePaths.length}`,
            );
        }
    }

    const uniqueSources = [...uniqueMap.values()]
        .sort((left, right) =>
            left.relativePaths[0]?.localeCompare(
                right.relativePaths[0] ?? "",
                "en",
            ) ?? 0,
        );

    return {
        files,
        uniqueSources,
    };
}

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
    const bytes = new Uint8Array(buffer.length);
    bytes.set(buffer);
    return bytes.buffer;
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

async function createOxiPngOptimiser(): Promise<(
    sourceBuffer: Buffer,
    level: number,
) => Promise<Buffer>> {
    const wasmPath = resolvePackageFile(
        "@jsquash/oxipng/package.json",
        "codec/pkg/squoosh_oxipng_bg.wasm",
    );
    const wasmBuffer = await readFile(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuffer);

    await initOxiPng(wasmModule);

    return async (
        sourceBuffer: Buffer,
        level: number,
    ): Promise<Buffer> => {
        const output = await optimisePng(
            toExactArrayBuffer(sourceBuffer),
            {
                level,
                interlace: false,
                optimiseAlpha: false,
            },
        );

        return Buffer.from(output);
    };
}

async function replaceFile(
    temporaryPath: string,
    targetPath: string,
): Promise<void> {
    try {
        await rename(temporaryPath, targetPath);
    } catch (error) {
        const code =
            error instanceof Error && "code" in error
                ? String(error.code)
                : "";

        if (code !== "EEXIST" && code !== "EPERM") {
            throw error;
        }

        await unlink(targetPath).catch(() => {
            // 目标文件可能不存在。
        });

        await rename(temporaryPath, targetPath);
    }
}

async function writeBufferAtomically(
    filePath: string,
    buffer: Buffer,
): Promise<void> {
    await mkdir(path.dirname(filePath), {
        recursive: true,
    });

    const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
    );

    try {
        await writeFile(temporaryPath, buffer);
        await replaceFile(temporaryPath, filePath);
    } catch (error) {
        await unlink(temporaryPath).catch(() => {
            // 临时文件可能尚未创建。
        });
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

function calculatePsnr(rmse: number): number | null {
    if (rmse === 0) {
        return null;
    }

    return 20 * Math.log10(255 / rmse);
}

async function decodeRgba(buffer: Buffer): Promise<{
    data: Buffer;
    width: number;
    height: number;
}> {
    const result = await sharp(buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    if (result.info.channels !== 4) {
        throw new Error(
            `RGBA 解码通道数量异常：${result.info.channels}`,
        );
    }

    return {
        data: result.data,
        width: result.info.width,
        height: result.info.height,
    };
}

async function calculateVisualDifference(
    sourceBuffer: Buffer,
    candidateBuffer: Buffer,
): Promise<VisualDifference> {
    const [source, candidate] = await Promise.all([
        decodeRgba(sourceBuffer),
        decodeRgba(candidateBuffer),
    ]);

    if (
        source.width !== candidate.width ||
        source.height !== candidate.height ||
        source.data.length !== candidate.data.length
    ) {
        throw new Error("像素差异计算时图片尺寸不一致。");
    }

    const pixelCount = source.width * source.height;
    let differentPixels = 0;
    let maxChannelError = 0;
    let alphaSquaredError = 0;
    let blackSquaredError = 0;
    let whiteSquaredError = 0;

    for (let index = 0; index < source.data.length; index += 4) {
        const sourceR = source.data[index] ?? 0;
        const sourceG = source.data[index + 1] ?? 0;
        const sourceB = source.data[index + 2] ?? 0;
        const sourceA = source.data[index + 3] ?? 0;

        const candidateR = candidate.data[index] ?? 0;
        const candidateG = candidate.data[index + 1] ?? 0;
        const candidateB = candidate.data[index + 2] ?? 0;
        const candidateA = candidate.data[index + 3] ?? 0;

        if (
            sourceR !== candidateR ||
            sourceG !== candidateG ||
            sourceB !== candidateB ||
            sourceA !== candidateA
        ) {
            differentPixels += 1;
        }

        const channelErrors = [
            Math.abs(sourceR - candidateR),
            Math.abs(sourceG - candidateG),
            Math.abs(sourceB - candidateB),
            Math.abs(sourceA - candidateA),
        ];

        for (const error of channelErrors) {
            if (error > maxChannelError) {
                maxChannelError = error;
            }
        }

        const alphaError = sourceA - candidateA;
        alphaSquaredError += alphaError * alphaError;

        const sourceAlpha = sourceA / 255;
        const candidateAlpha = candidateA / 255;
        const sourceColours = [sourceR, sourceG, sourceB];
        const candidateColours = [candidateR, candidateG, candidateB];

        for (let channel = 0; channel < 3; channel += 1) {
            const sourceColour = sourceColours[channel] ?? 0;
            const candidateColour = candidateColours[channel] ?? 0;

            const sourceOnBlack = sourceColour * sourceAlpha;
            const candidateOnBlack = candidateColour * candidateAlpha;
            const blackError = sourceOnBlack - candidateOnBlack;
            blackSquaredError += blackError * blackError;

            const sourceOnWhite =
                sourceColour * sourceAlpha + 255 * (1 - sourceAlpha);
            const candidateOnWhite =
                candidateColour * candidateAlpha + 255 * (1 - candidateAlpha);
            const whiteError = sourceOnWhite - candidateOnWhite;
            whiteSquaredError += whiteError * whiteError;
        }
    }

    const alphaRmse = Math.sqrt(alphaSquaredError / pixelCount);
    const blackBackgroundRmse = Math.sqrt(
        blackSquaredError / (pixelCount * 3),
    );
    const whiteBackgroundRmse = Math.sqrt(
        whiteSquaredError / (pixelCount * 3),
    );

    return {
        differentPixelPercent:
            pixelCount > 0
                ? differentPixels / pixelCount * 100
                : 0,
        maxChannelError,
        alphaRmse,
        blackBackgroundRmse,
        blackBackgroundPsnr: calculatePsnr(blackBackgroundRmse),
        whiteBackgroundRmse,
        whiteBackgroundPsnr: calculatePsnr(whiteBackgroundRmse),
    };
}

function createEmptyLocalCache(
    options: CliOptions,
): LocalCacheIndex {
    const now = new Date().toISOString();

    return {
        schemaVersion: 1,
        provider: "squoosh-local",
        namespace: "build-png-benchmark",
        profileKey: options.profileKey,
        options: {
            quality: options.quality,
            colours: options.colours,
            effort: options.effort,
            dither: options.dither,
            oxiPngLevel: options.oxiPngLevel,
        },
        createdAt: now,
        updatedAt: now,
        entriesBySourceSha256: {},
    };
}

function parseVisualDifference(
    value: unknown,
    fieldName: string,
): VisualDifference {
    if (!isRecord(value)) {
        throw new Error(`${fieldName} 必须是对象。`);
    }

    const requireNumber = (key: keyof VisualDifference): number => {
        const fieldValue = value[key];

        if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
            throw new Error(`${fieldName}.${key} 必须是数字。`);
        }

        return fieldValue;
    };

    const parsePsnr = (
        key: "blackBackgroundPsnr" | "whiteBackgroundPsnr",
    ): number | null => {
        const fieldValue = value[key];

        if (fieldValue === null) {
            return null;
        }

        if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
            throw new Error(`${fieldName}.${key} 必须是数字或 null。`);
        }

        return fieldValue;
    };

    return {
        differentPixelPercent: requireNumber("differentPixelPercent"),
        maxChannelError: requireNumber("maxChannelError"),
        alphaRmse: requireNumber("alphaRmse"),
        blackBackgroundRmse: requireNumber("blackBackgroundRmse"),
        blackBackgroundPsnr: parsePsnr("blackBackgroundPsnr"),
        whiteBackgroundRmse: requireNumber("whiteBackgroundRmse"),
        whiteBackgroundPsnr: parsePsnr("whiteBackgroundPsnr"),
    };
}

function parsePngMetadata(
    value: unknown,
    fieldName: string,
): PngMetadata {
    if (!isRecord(value)) {
        throw new Error(`${fieldName} 必须是对象。`);
    }

    const numericFields = [
        "width",
        "height",
        "bitDepth",
        "colorType",
    ] as const;

    for (const field of numericFields) {
        if (
            typeof value[field] !== "number" ||
            !Number.isInteger(value[field]) ||
            value[field] < 0
        ) {
            throw new Error(`${fieldName}.${field} 必须是非负整数。`);
        }
    }

    if (typeof value.colorTypeName !== "string") {
        throw new Error(`${fieldName}.colorTypeName 必须是字符串。`);
    }

    if (
        typeof value.hasPalette !== "boolean" ||
        typeof value.hasTransparencyChunk !== "boolean"
    ) {
        throw new Error(`${fieldName} 的 PNG 标志字段无效。`);
    }

    return {
        width: value.width as number,
        height: value.height as number,
        bitDepth: value.bitDepth as number,
        colorType: value.colorType as number,
        colorTypeName: value.colorTypeName,
        hasPalette: value.hasPalette,
        hasTransparencyChunk: value.hasTransparencyChunk,
    };
}

function parseLocalCacheIndex(
    value: unknown,
    options: CliOptions,
): LocalCacheIndex {
    if (!isRecord(value)) {
        throw new Error("Squoosh 本地缓存 index.json 根节点必须是对象。");
    }

    if (
        value.schemaVersion !== 1 ||
        value.provider !== "squoosh-local" ||
        value.namespace !== "build-png-benchmark" ||
        value.profileKey !== options.profileKey
    ) {
        throw new Error(
            `Squoosh 本地缓存格式或参数不匹配：${options.profileKey}`,
        );
    }

    if (!isRecord(value.options)) {
        throw new Error("Squoosh 本地缓存缺少 options。 ");
    }

    const expectedOptions = {
        quality: options.quality,
        colours: options.colours,
        effort: options.effort,
        dither: options.dither,
        oxiPngLevel: options.oxiPngLevel,
    };

    for (const [key, expected] of Object.entries(expectedOptions)) {
        if (value.options[key] !== expected) {
            throw new Error(
                `Squoosh 本地缓存参数不匹配：${key}`,
            );
        }
    }

    if (
        typeof value.createdAt !== "string" ||
        typeof value.updatedAt !== "string" ||
        !isRecord(value.entriesBySourceSha256)
    ) {
        throw new Error("Squoosh 本地缓存索引字段不完整。");
    }

    const entriesBySourceSha256: Record<string, LocalCacheEntry> = {};

    for (const [sourceSha256, rawEntry] of Object.entries(
        value.entriesBySourceSha256,
    )) {
        if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !isRecord(rawEntry)) {
            throw new Error(`Squoosh 本地缓存记录无效：${sourceSha256}`);
        }

        const status = rawEntry.status;

        if (status !== "compressed" && status !== "no-benefit") {
            throw new Error(`Squoosh 本地缓存 status 无效：${sourceSha256}`);
        }

        const selectedStage = rawEntry.selectedStage;

        if (
            selectedStage !== "quantized" &&
            selectedStage !== "quantized-oxipng" &&
            selectedStage !== "source"
        ) {
            throw new Error(
                `Squoosh 本地缓存 selectedStage 无效：${sourceSha256}`,
            );
        }

        const numberFields = [
            "sourceBytes",
            "width",
            "height",
            "quantizedBytes",
            "oxiPngBytes",
            "quantizeElapsedMs",
            "oxiPngElapsedMs",
            "totalElapsedMs",
        ] as const;

        for (const field of numberFields) {
            if (
                typeof rawEntry[field] !== "number" ||
                !Number.isFinite(rawEntry[field]) ||
                rawEntry[field] < 0
            ) {
                throw new Error(
                    `Squoosh 本地缓存 ${sourceSha256}.${field} 无效。`,
                );
            }
        }

        if (
            rawEntry.sourceSha256 !== sourceSha256 ||
            typeof rawEntry.createdAt !== "string" ||
            typeof rawEntry.updatedAt !== "string"
        ) {
            throw new Error(`Squoosh 本地缓存记录字段不完整：${sourceSha256}`);
        }

        const entry: LocalCacheEntry = {
            sourceSha256,
            sourceBytes: rawEntry.sourceBytes as number,
            width: rawEntry.width as number,
            height: rawEntry.height as number,
            status,
            selectedStage,
            quantizedBytes: rawEntry.quantizedBytes as number,
            oxiPngBytes: rawEntry.oxiPngBytes as number,
            visualDifference: parseVisualDifference(
                rawEntry.visualDifference,
                `${sourceSha256}.visualDifference`,
            ),
            quantizeElapsedMs: rawEntry.quantizeElapsedMs as number,
            oxiPngElapsedMs: rawEntry.oxiPngElapsedMs as number,
            totalElapsedMs: rawEntry.totalElapsedMs as number,
            createdAt: rawEntry.createdAt,
            updatedAt: rawEntry.updatedAt,
        };

        if (status === "compressed") {
            if (
                typeof rawEntry.outputSha256 !== "string" ||
                !/^[a-f0-9]{64}$/.test(rawEntry.outputSha256) ||
                typeof rawEntry.outputBytes !== "number" ||
                !Number.isInteger(rawEntry.outputBytes) ||
                rawEntry.outputBytes < 0 ||
                typeof rawEntry.outputRelativePath !== "string"
            ) {
                throw new Error(
                    `Squoosh compressed 缓存记录不完整：${sourceSha256}`,
                );
            }

            entry.outputSha256 = rawEntry.outputSha256;
            entry.outputBytes = rawEntry.outputBytes;
            entry.outputRelativePath = rawEntry.outputRelativePath;
            entry.outputPng = parsePngMetadata(
                rawEntry.outputPng,
                `${sourceSha256}.outputPng`,
            );
        }

        entriesBySourceSha256[sourceSha256] = entry;
    }

    return {
        schemaVersion: 1,
        provider: "squoosh-local",
        namespace: "build-png-benchmark",
        profileKey: options.profileKey,
        options: expectedOptions,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        entriesBySourceSha256,
    };
}

async function loadLocalCache(
    options: CliOptions,
): Promise<LoadedLocalCache> {
    const filesDirectory = path.join(options.cacheDirectory, "files");
    const reportsDirectory = path.join(options.cacheDirectory, "reports");
    const indexPath = path.join(options.cacheDirectory, "index.json");

    await mkdir(filesDirectory, { recursive: true });
    await mkdir(reportsDirectory, { recursive: true });

    let index: LocalCacheIndex;

    try {
        const value = JSON.parse(
            await readFile(indexPath, "utf8"),
        ) as unknown;
        index = parseLocalCacheIndex(value, options);
    } catch (error) {
        const code =
            error instanceof Error && "code" in error
                ? String(error.code)
                : "";

        if (code !== "ENOENT") {
            throw new Error(
                `无法读取 Squoosh 本地缓存索引：${indexPath}`,
                { cause: error },
            );
        }

        index = createEmptyLocalCache(options);
        await writeJsonAtomically(indexPath, index);
    }

    return {
        cacheDirectory: options.cacheDirectory,
        filesDirectory,
        reportsDirectory,
        indexPath,
        index,
    };
}

async function saveLocalCache(cache: LoadedLocalCache): Promise<void> {
    cache.index.updatedAt = new Date().toISOString();
    await writeJsonAtomically(cache.indexPath, cache.index);
}

async function tryLoadLocalCacheResult(
    source: UniqueSourceRecord,
    cache: LoadedLocalCache,
): Promise<{
    result: LocalSourceResult | null;
    invalidReason: string | null;
}> {
    const entry = cache.index.entriesBySourceSha256[source.sourceSha256];

    if (!entry) {
        return {
            result: null,
            invalidReason: null,
        };
    }

    if (
        entry.sourceBytes !== source.sourceBytes ||
        entry.width !== source.png.width ||
        entry.height !== source.png.height
    ) {
        delete cache.index.entriesBySourceSha256[source.sourceSha256];
        return {
            result: null,
            invalidReason: "缓存中的原图大小或尺寸不一致。",
        };
    }

    if (entry.status === "no-benefit") {
        return {
            result: {
                action: "cache-no-benefit",
                sourceSha256: source.sourceSha256,
                sourceBytes: source.sourceBytes,
                finalBytes: source.sourceBytes,
                savedBytes: 0,
                savedPercent: 0,
                outputSha256: null,
                outputPath: null,
                selectedStage: "source",
                quantizedBytes: entry.quantizedBytes,
                oxiPngBytes: entry.oxiPngBytes,
                quantizeElapsedMs: entry.quantizeElapsedMs,
                oxiPngElapsedMs: entry.oxiPngElapsedMs,
                totalElapsedMs: 0,
                png: source.png,
                visualDifference: ZERO_VISUAL_DIFFERENCE,
            },
            invalidReason: null,
        };
    }

    const outputRelativePath = entry.outputRelativePath;
    const outputSha256 = entry.outputSha256;
    const outputBytes = entry.outputBytes;
    const outputPng = entry.outputPng;

    if (
        outputRelativePath === undefined ||
        outputSha256 === undefined ||
        outputBytes === undefined ||
        outputPng === undefined
    ) {
        delete cache.index.entriesBySourceSha256[source.sourceSha256];
        return {
            result: null,
            invalidReason: "compressed 缓存记录缺少输出字段。",
        };
    }

    const outputPath = resolvePortableRelativePath(
        cache.cacheDirectory,
        outputRelativePath,
    );

    if (!isPathInsideRoot(cache.cacheDirectory, outputPath)) {
        delete cache.index.entriesBySourceSha256[source.sourceSha256];
        return {
            result: null,
            invalidReason: "缓存输出路径越界。",
        };
    }

    let outputBuffer: Buffer;

    try {
        outputBuffer = await readFile(outputPath);
    } catch (error) {
        delete cache.index.entriesBySourceSha256[source.sourceSha256];
        return {
            result: null,
            invalidReason: `无法读取缓存输出：${
                error instanceof Error ? error.message : String(error)
            }`,
        };
    }

    if (
        outputBuffer.length !== outputBytes ||
        calculateSha256(outputBuffer) !== outputSha256
    ) {
        delete cache.index.entriesBySourceSha256[source.sourceSha256];
        return {
            result: null,
            invalidReason: "缓存输出大小或 SHA-256 校验失败。",
        };
    }

    const actualPng = inspectPng(outputBuffer);
    assertSameDimensions(source.png, actualPng, "Squoosh 缓存输出");

    return {
        result: {
            action: "cache-compressed",
            sourceSha256: source.sourceSha256,
            sourceBytes: source.sourceBytes,
            finalBytes: outputBytes,
            savedBytes: source.sourceBytes - outputBytes,
            savedPercent:
                source.sourceBytes > 0
                    ? (source.sourceBytes - outputBytes) /
                        source.sourceBytes * 100
                    : 0,
            outputSha256,
            outputPath,
            selectedStage: entry.selectedStage,
            quantizedBytes: entry.quantizedBytes,
            oxiPngBytes: entry.oxiPngBytes,
            quantizeElapsedMs: entry.quantizeElapsedMs,
            oxiPngElapsedMs: entry.oxiPngElapsedMs,
            totalElapsedMs: 0,
            png: outputPng,
            visualDifference: entry.visualDifference,
        },
        invalidReason: null,
    };
}

async function quantizePng(
    sourceBuffer: Buffer,
    options: CliOptions,
): Promise<Buffer> {
    return sharp(sourceBuffer, {
        failOn: "error",
    })
        .png({
            palette: true,
            quality: options.quality,
            colours: options.colours,
            effort: options.effort,
            dither: options.dither,
            compressionLevel: 9,
            adaptiveFiltering: true,
            progressive: false,
            force: true,
        })
        .toBuffer();
}

async function processLocalSource(
    source: UniqueSourceRecord,
    sourceBuffer: Buffer,
    options: CliOptions,
    cache: LoadedLocalCache,
    optimiseWithOxiPng: (
        sourceBuffer: Buffer,
        level: number,
    ) => Promise<Buffer>,
): Promise<LocalSourceResult> {
    const quantizeStarted = performance.now();
    const quantizedBuffer = await quantizePng(sourceBuffer, options);
    const quantizeElapsedMs = performance.now() - quantizeStarted;
    const quantizedPng = inspectPng(quantizedBuffer);
    assertSameDimensions(source.png, quantizedPng, "Sharp 量化输出");

    const oxiPngStarted = performance.now();
    const oxiPngBuffer = await optimiseWithOxiPng(
        quantizedBuffer,
        options.oxiPngLevel,
    );
    const oxiPngElapsedMs = performance.now() - oxiPngStarted;
    const oxiPngMetadata = inspectPng(oxiPngBuffer);
    assertSameDimensions(source.png, oxiPngMetadata, "OxiPNG 输出");

    const selected = oxiPngBuffer.length <= quantizedBuffer.length
        ? {
            stage: "quantized-oxipng" as const,
            buffer: oxiPngBuffer,
            png: oxiPngMetadata,
        }
        : {
            stage: "quantized" as const,
            buffer: quantizedBuffer,
            png: quantizedPng,
        };

    const totalElapsedMs = quantizeElapsedMs + oxiPngElapsedMs;
    const now = new Date().toISOString();

    if (selected.buffer.length >= source.sourceBytes) {
        cache.index.entriesBySourceSha256[source.sourceSha256] = {
            sourceSha256: source.sourceSha256,
            sourceBytes: source.sourceBytes,
            width: source.png.width,
            height: source.png.height,
            status: "no-benefit",
            selectedStage: "source",
            quantizedBytes: quantizedBuffer.length,
            oxiPngBytes: oxiPngBuffer.length,
            visualDifference: ZERO_VISUAL_DIFFERENCE,
            quantizeElapsedMs,
            oxiPngElapsedMs,
            totalElapsedMs,
            createdAt: now,
            updatedAt: now,
        };

        await saveLocalCache(cache);

        return {
            action: "processed-no-benefit",
            sourceSha256: source.sourceSha256,
            sourceBytes: source.sourceBytes,
            finalBytes: source.sourceBytes,
            savedBytes: 0,
            savedPercent: 0,
            outputSha256: null,
            outputPath: null,
            selectedStage: "source",
            quantizedBytes: quantizedBuffer.length,
            oxiPngBytes: oxiPngBuffer.length,
            quantizeElapsedMs,
            oxiPngElapsedMs,
            totalElapsedMs,
            png: source.png,
            visualDifference: ZERO_VISUAL_DIFFERENCE,
            message:
                `本地最小输出 ${formatBytes(selected.buffer.length)}，` +
                "不小于原图。",
        };
    }

    const outputSha256 = calculateSha256(selected.buffer);
    const outputRelativePath = toPortablePath(
        path.join(
            "files",
            outputSha256.slice(0, 2),
            `${outputSha256}.png`,
        ),
    );
    const outputPath = resolvePortableRelativePath(
        cache.cacheDirectory,
        outputRelativePath,
    );

    await writeBufferAtomically(outputPath, selected.buffer);

    const visualDifference = await calculateVisualDifference(
        sourceBuffer,
        selected.buffer,
    );

    cache.index.entriesBySourceSha256[source.sourceSha256] = {
        sourceSha256: source.sourceSha256,
        sourceBytes: source.sourceBytes,
        width: source.png.width,
        height: source.png.height,
        status: "compressed",
        selectedStage: selected.stage,
        quantizedBytes: quantizedBuffer.length,
        oxiPngBytes: oxiPngBuffer.length,
        outputSha256,
        outputBytes: selected.buffer.length,
        outputRelativePath,
        outputPng: selected.png,
        visualDifference,
        quantizeElapsedMs,
        oxiPngElapsedMs,
        totalElapsedMs,
        createdAt: now,
        updatedAt: now,
    };

    await saveLocalCache(cache);

    return {
        action: "processed-compressed",
        sourceSha256: source.sourceSha256,
        sourceBytes: source.sourceBytes,
        finalBytes: selected.buffer.length,
        savedBytes: source.sourceBytes - selected.buffer.length,
        savedPercent:
            source.sourceBytes > 0
                ? (source.sourceBytes - selected.buffer.length) /
                    source.sourceBytes * 100
                : 0,
        outputSha256,
        outputPath,
        selectedStage: selected.stage,
        quantizedBytes: quantizedBuffer.length,
        oxiPngBytes: oxiPngBuffer.length,
        quantizeElapsedMs,
        oxiPngElapsedMs,
        totalElapsedMs,
        png: selected.png,
        visualDifference,
    };
}

async function loadTinyPngCacheContext(
    options: CliOptions,
): Promise<TinyPngCacheContext> {
    const indexPath = path.join(
        options.tinyPngCacheDirectory,
        "index.json",
    );

    if (!options.compareTinyPng) {
        return {
            cacheDirectory: options.tinyPngCacheDirectory,
            indexPath,
            entriesBySourceSha256: null,
            loadError: "已通过 --no-tinypng-compare 禁用。",
        };
    }

    try {
        const value = JSON.parse(
            await readFile(indexPath, "utf8"),
        ) as unknown;

        if (!isRecord(value) || !isRecord(value.entriesBySourceSha256)) {
            return {
                cacheDirectory: options.tinyPngCacheDirectory,
                indexPath,
                entriesBySourceSha256: null,
                loadError: "TinyPNG 缓存索引缺少 entriesBySourceSha256。",
            };
        }

        return {
            cacheDirectory: options.tinyPngCacheDirectory,
            indexPath,
            entriesBySourceSha256: value.entriesBySourceSha256,
            loadError: null,
        };
    } catch (error) {
        return {
            cacheDirectory: options.tinyPngCacheDirectory,
            indexPath,
            entriesBySourceSha256: null,
            loadError:
                `无法读取 TinyPNG 缓存索引：${
                    error instanceof Error ? error.message : String(error)
                }`,
        };
    }
}

async function loadTinyPngSourceResult(
    source: UniqueSourceRecord,
    sourceBuffer: Buffer | null,
    context: TinyPngCacheContext,
    calculateDifference: boolean,
): Promise<TinyPngSourceResult> {
    const unavailable = (message: string): TinyPngSourceResult => ({
        status: "unavailable",
        sourceSha256: source.sourceSha256,
        sourceBytes: source.sourceBytes,
        finalBytes: null,
        savedBytes: null,
        savedPercent: null,
        outputSha256: null,
        outputPath: null,
        png: null,
        visualDifference: null,
        message,
    });

    const invalid = (message: string): TinyPngSourceResult => ({
        ...unavailable(message),
        status: "invalid",
    });

    if (context.entriesBySourceSha256 === null) {
        return unavailable(
            context.loadError ?? "TinyPNG 缓存不可用。",
        );
    }

    const rawEntry = context.entriesBySourceSha256[source.sourceSha256];

    if (!isRecord(rawEntry)) {
        return unavailable("当前原图 SHA 未命中 TinyPNG 缓存。");
    }

    const entry = rawEntry as TinyPngCacheEntryLike;

    if (entry.status === "no-benefit") {
        return {
            status: "no-benefit",
            sourceSha256: source.sourceSha256,
            sourceBytes: source.sourceBytes,
            finalBytes: source.sourceBytes,
            savedBytes: 0,
            savedPercent: 0,
            outputSha256: null,
            outputPath: null,
            png: source.png,
            visualDifference: ZERO_VISUAL_DIFFERENCE,
        };
    }

    if (entry.status !== "compressed") {
        return unavailable(
            `TinyPNG 缓存状态不是 compressed/no-benefit：${String(entry.status)}`,
        );
    }

    if (
        typeof entry.compressedRelativePath !== "string" ||
        typeof entry.compressedSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.compressedSha256) ||
        typeof entry.compressedBytes !== "number" ||
        !Number.isInteger(entry.compressedBytes) ||
        entry.compressedBytes < 0
    ) {
        return invalid("TinyPNG compressed 缓存记录字段不完整。");
    }

    const outputPath = resolvePortableRelativePath(
        context.cacheDirectory,
        entry.compressedRelativePath,
    );

    if (!isPathInsideRoot(context.cacheDirectory, outputPath)) {
        return invalid("TinyPNG 缓存输出路径越界。");
    }

    let outputBuffer: Buffer;

    try {
        outputBuffer = await readFile(outputPath);
    } catch (error) {
        return invalid(
            `无法读取 TinyPNG 缓存输出：${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }

    if (
        outputBuffer.length !== entry.compressedBytes ||
        calculateSha256(outputBuffer) !== entry.compressedSha256
    ) {
        return invalid("TinyPNG 缓存输出大小或 SHA-256 校验失败。");
    }

    const outputPng = inspectPng(outputBuffer);
    assertSameDimensions(source.png, outputPng, "TinyPNG 缓存输出");

    const visualDifference = calculateDifference
        ? await calculateVisualDifference(
            sourceBuffer ?? await readFile(source.representativePath),
            outputBuffer,
        )
        : null;

    return {
        status: "compressed",
        sourceSha256: source.sourceSha256,
        sourceBytes: source.sourceBytes,
        finalBytes: outputBuffer.length,
        savedBytes: source.sourceBytes - outputBuffer.length,
        savedPercent:
            source.sourceBytes > 0
                ? (source.sourceBytes - outputBuffer.length) /
                    source.sourceBytes * 100
                : 0,
        outputSha256: entry.compressedSha256,
        outputPath,
        png: outputPng,
        visualDifference,
    };
}

function createComparison(
    local: LocalSourceResult,
    tinyPng: TinyPngSourceResult,
): ComparisonResult {
    const localComplete =
        local.action !== "skipped-processing-limit" &&
        local.action !== "failed";
    const tinyComplete =
        tinyPng.status === "compressed" ||
        tinyPng.status === "no-benefit";

    if (!localComplete || !tinyComplete || tinyPng.finalBytes === null) {
        return {
            comparable: false,
            localBytes: local.finalBytes,
            tinyPngBytes: tinyPng.finalBytes,
            deltaBytesLocalMinusTinyPng: null,
            deltaPercentOfTinyPng: null,
            relation: "unavailable",
            withinFivePercent: null,
            localMoreThanTwentyPercentLarger: null,
        };
    }

    const deltaBytes = local.finalBytes - tinyPng.finalBytes;
    const deltaPercent = tinyPng.finalBytes > 0
        ? deltaBytes / tinyPng.finalBytes * 100
        : deltaBytes === 0
            ? 0
            : Number.POSITIVE_INFINITY;

    return {
        comparable: true,
        localBytes: local.finalBytes,
        tinyPngBytes: tinyPng.finalBytes,
        deltaBytesLocalMinusTinyPng: deltaBytes,
        deltaPercentOfTinyPng: deltaPercent,
        relation:
            deltaBytes < 0
                ? "local-smaller"
                : deltaBytes > 0
                    ? "tinypng-smaller"
                    : "equal",
        withinFivePercent: Math.abs(deltaPercent) <= 5,
        localMoreThanTwentyPercentLarger: deltaPercent > 20,
    };
}

function createSkippedLocalResult(
    source: UniqueSourceRecord,
    action:
        | "skipped-below-min-bytes"
        | "skipped-processing-limit",
    message: string,
): LocalSourceResult {
    return {
        action,
        sourceSha256: source.sourceSha256,
        sourceBytes: source.sourceBytes,
        finalBytes: source.sourceBytes,
        savedBytes: 0,
        savedPercent: 0,
        outputSha256: null,
        outputPath: null,
        selectedStage: "source",
        quantizedBytes: null,
        oxiPngBytes: null,
        quantizeElapsedMs: 0,
        oxiPngElapsedMs: 0,
        totalElapsedMs: 0,
        png: source.png,
        visualDifference: ZERO_VISUAL_DIFFERENCE,
        message,
    };
}

function createFailedLocalResult(
    source: UniqueSourceRecord,
    error: unknown,
): LocalSourceResult {
    return {
        action: "failed",
        sourceSha256: source.sourceSha256,
        sourceBytes: source.sourceBytes,
        finalBytes: source.sourceBytes,
        savedBytes: 0,
        savedPercent: 0,
        outputSha256: null,
        outputPath: null,
        selectedStage: "source",
        quantizedBytes: null,
        oxiPngBytes: null,
        quantizeElapsedMs: 0,
        oxiPngElapsedMs: 0,
        totalElapsedMs: 0,
        png: source.png,
        visualDifference: ZERO_VISUAL_DIFFERENCE,
        message: error instanceof Error
            ? error.stack ?? error.message
            : String(error),
    };
}

function createReviewItem(item: FileReportItem): ReviewItem {
    return {
        relativePath: item.relativePath,
        sourceSha256: item.sourceSha256,
        sourceBytes: item.sourceBytes,
        localBytes: item.local.finalBytes,
        tinyPngBytes: item.tinyPng.finalBytes,
        deltaBytesLocalMinusTinyPng:
            item.comparison.deltaBytesLocalMinusTinyPng,
        deltaPercentOfTinyPng:
            item.comparison.deltaPercentOfTinyPng,
        whiteBackgroundPsnr:
            item.local.visualDifference.whiteBackgroundPsnr,
        alphaRmse: item.local.visualDifference.alphaRmse,
        localOutputPath: item.local.outputPath,
        tinyPngOutputPath: item.tinyPng.outputPath,
    };
}

function buildReviewLists(
    uniqueItems: readonly FileReportItem[],
): BenchmarkReport["review"] {
    const localLargestVsTinyPng = uniqueItems
        .filter((item) => item.comparison.comparable)
        .sort((left, right) =>
            (right.comparison.deltaPercentOfTinyPng ?? -Infinity) -
            (left.comparison.deltaPercentOfTinyPng ?? -Infinity),
        )
        .slice(0, 10)
        .map(createReviewItem);

    const lowestWhiteBackgroundPsnr = uniqueItems
        .filter((item) =>
            item.local.outputPath !== null &&
            item.local.visualDifference.whiteBackgroundPsnr !== null,
        )
        .sort((left, right) =>
            (left.local.visualDifference.whiteBackgroundPsnr ?? Infinity) -
            (right.local.visualDifference.whiteBackgroundPsnr ?? Infinity),
        )
        .slice(0, 10)
        .map(createReviewItem);

    const largestLocalSavings = uniqueItems
        .slice()
        .sort((left, right) =>
            right.local.savedBytes - left.local.savedBytes,
        )
        .slice(0, 10)
        .map(createReviewItem);

    return {
        localLargestVsTinyPng,
        lowestWhiteBackgroundPsnr,
        largestLocalSavings,
    };
}

function buildSummary(
    files: readonly FileReportItem[],
    uniqueItems: readonly FileReportItem[],
    localCacheInvalidUnique: number,
    elapsedMs: number,
): BenchmarkSummary {
    const totalSourceBytes = files.reduce(
        (sum, item) => sum + item.sourceBytes,
        0,
    );
    const localFinalBytesForAllFiles = files.reduce(
        (sum, item) => sum + item.local.finalBytes,
        0,
    );
    const comparableFiles = files.filter(
        (item) => item.comparison.comparable,
    );
    const comparableSourceBytesForFiles = comparableFiles.reduce(
        (sum, item) => sum + item.sourceBytes,
        0,
    );
    const localBytesOnComparableFiles = comparableFiles.reduce(
        (sum, item) => sum + item.local.finalBytes,
        0,
    );
    const tinyPngBytesOnComparableFiles = comparableFiles.reduce(
        (sum, item) => sum + (item.tinyPng.finalBytes ?? 0),
        0,
    );
    const deltaBytes =
        localBytesOnComparableFiles - tinyPngBytesOnComparableFiles;

    const countLocalAction = (action: LocalAction): number =>
        uniqueItems.filter((item) => item.local.action === action).length;
    const countTinyStatus = (status: TinyPngStatus): number =>
        uniqueItems.filter((item) => item.tinyPng.status === status).length;

    return {
        scannedPngFiles: files.length,
        uniqueSourceImages: uniqueItems.length,
        duplicateFiles: files.length - uniqueItems.length,
        totalSourceBytes,

        localCacheCompressedHitsUnique:
            countLocalAction("cache-compressed"),
        localCacheNoBenefitHitsUnique:
            countLocalAction("cache-no-benefit"),
        localProcessedUnique:
            countLocalAction("processed-compressed") +
            countLocalAction("processed-no-benefit"),
        localCompressedUnique:
            countLocalAction("cache-compressed") +
            countLocalAction("processed-compressed"),
        localNoBenefitUnique:
            countLocalAction("cache-no-benefit") +
            countLocalAction("processed-no-benefit"),
        localSkippedBelowMinBytesUnique:
            countLocalAction("skipped-below-min-bytes"),
        localSkippedByLimitUnique:
            countLocalAction("skipped-processing-limit"),
        localFailedUnique: countLocalAction("failed"),
        localCacheInvalidUnique,

        localPolicyComplete: uniqueItems.every((item) =>
            item.local.action !== "skipped-processing-limit" &&
            item.local.action !== "failed",
        ),
        localFinalBytesForAllFiles,
        localSavedBytesForAllFiles:
            totalSourceBytes - localFinalBytesForAllFiles,
        localSavedPercentForAllFiles:
            totalSourceBytes > 0
                ? (totalSourceBytes - localFinalBytesForAllFiles) /
                    totalSourceBytes * 100
                : 0,

        tinyPngCompressedUnique: countTinyStatus("compressed"),
        tinyPngNoBenefitUnique: countTinyStatus("no-benefit"),
        tinyPngUnavailableUnique: countTinyStatus("unavailable"),
        tinyPngInvalidUnique: countTinyStatus("invalid"),

        comparableUniqueSources:
            uniqueItems.filter((item) => item.comparison.comparable).length,
        comparableFiles: comparableFiles.length,
        localSmallerUnique:
            uniqueItems.filter(
                (item) => item.comparison.relation === "local-smaller",
            ).length,
        tinyPngSmallerUnique:
            uniqueItems.filter(
                (item) => item.comparison.relation === "tinypng-smaller",
            ).length,
        equalUnique:
            uniqueItems.filter(
                (item) => item.comparison.relation === "equal",
            ).length,
        withinFivePercentUnique:
            uniqueItems.filter(
                (item) => item.comparison.withinFivePercent === true,
            ).length,
        localMoreThanTwentyPercentLargerUnique:
            uniqueItems.filter(
                (item) =>
                    item.comparison.localMoreThanTwentyPercentLarger === true,
            ).length,

        comparableSourceBytesForFiles,
        localBytesOnComparableFiles,
        tinyPngBytesOnComparableFiles,
        deltaBytesLocalMinusTinyPng: deltaBytes,
        deltaPercentOfTinyPng:
            tinyPngBytesOnComparableFiles > 0
                ? deltaBytes / tinyPngBytesOnComparableFiles * 100
                : 0,

        totalElapsedMs: elapsedMs,
    };
}

async function main(): Promise<void> {
    const options = parseCliArguments(process.argv.slice(2));
    const startedAt = new Date().toISOString();
    const benchmarkStarted = performance.now();

    await validateBuildDirectory(options.buildDirectory);

    console.log(`构建目录：${options.buildDirectory}`);
    console.log(`本地缓存：${options.cacheDirectory}`);
    console.log(
        `参数：quality=${options.quality}, colours=${options.colours}, ` +
        `effort=${options.effort}, dither=${options.dither}, ` +
        `OxiPNG=${options.oxiPngLevel}`,
    );
    console.log(`最小原图：${options.minimumSourceBytes} B`);
    console.log(
        `处理模式：${
            options.mode.type === "all"
                ? "--all"
                : `--limit=${options.mode.limit}`
        }`,
    );

    const absolutePaths = await scanPngFiles(options.buildDirectory);
    console.log(`扫描到 PNG：${absolutePaths.length} 张`);

    const { files: sourceFiles, uniqueSources } =
        await inspectSourceFiles(
            options.buildDirectory,
            absolutePaths,
        );

    console.log(
        `唯一原图 SHA：${uniqueSources.length}，` +
        `重复文件：${sourceFiles.length - uniqueSources.length}`,
    );

    const localCache = await loadLocalCache(options);
    const tinyPngCache = await loadTinyPngCacheContext(options);

    console.log("正在初始化 OxiPNG WASM……");
    const optimiseWithOxiPng = await createOxiPngOptimiser();

    const localBySource = new Map<string, LocalSourceResult>();
    const tinyBySource = new Map<string, TinyPngSourceResult>();
    let processedNewSources = 0;
    let localCacheInvalidUnique = 0;

    for (const [index, source] of uniqueSources.entries()) {
        const displayPath = source.relativePaths[0] ?? source.representativePath;
        const prefix = `[${index + 1}/${uniqueSources.length}]`;
        const cached = await tryLoadLocalCacheResult(
            source,
            localCache,
        );

        if (cached.invalidReason !== null) {
            localCacheInvalidUnique += 1;
            console.log(
                `${prefix} 本地缓存无效，将重新处理：${displayPath}`,
            );
        }

        let localResult = cached.result;
        let sourceBuffer: Buffer | null = null;

        if (localResult !== null) {
            console.log(
                `${prefix} 本地缓存命中：${displayPath} → ` +
                `${formatBytes(localResult.finalBytes)}`,
            );
        } else if (source.sourceBytes < options.minimumSourceBytes) {
            localResult = createSkippedLocalResult(
                source,
                "skipped-below-min-bytes",
                `原图 ${source.sourceBytes} B，小于最小处理尺寸 ` +
                `${options.minimumSourceBytes} B。`,
            );
            console.log(`${prefix} 低于尺寸阈值：${displayPath}`);
        } else {
            const limitReached =
                options.mode.type === "limit" &&
                processedNewSources >= options.mode.limit;

            if (limitReached) {
                localResult = createSkippedLocalResult(
                    source,
                    "skipped-processing-limit",
                    "本轮本地处理数量已达到 --limit。",
                );
                console.log(`${prefix} 达到处理上限：${displayPath}`);
            } else {
                sourceBuffer = await readFile(source.representativePath);
                processedNewSources += 1;

                try {
                    console.log(`${prefix} 本地量化：${displayPath}`);
                    localResult = await processLocalSource(
                        source,
                        sourceBuffer,
                        options,
                        localCache,
                        optimiseWithOxiPng,
                    );
                    console.log(
                        `${prefix} 完成：${formatBytes(source.sourceBytes)} → ` +
                        `${formatBytes(localResult.finalBytes)} ` +
                        `(${localResult.savedPercent.toFixed(2)}%)`,
                    );
                } catch (error) {
                    localResult = createFailedLocalResult(source, error);
                    console.error(`${prefix} 处理失败：${displayPath}`);
                    console.error(localResult.message);
                }
            }
        }

        localBySource.set(source.sourceSha256, localResult);

        const calculateTinyDifference =
            localResult.action !== "skipped-processing-limit" &&
            localResult.action !== "failed";

        if (calculateTinyDifference && sourceBuffer === null) {
            sourceBuffer = await readFile(source.representativePath);
        }

        const tinyPngResult = await loadTinyPngSourceResult(
            source,
            sourceBuffer,
            tinyPngCache,
            calculateTinyDifference,
        );
        tinyBySource.set(source.sourceSha256, tinyPngResult);
    }

    await saveLocalCache(localCache);

    const firstRelativePathBySource = new Map<string, string>();
    const fileItems: FileReportItem[] = sourceFiles.map((sourceFile) => {
        const local = localBySource.get(sourceFile.sourceSha256);
        const tinyPng = tinyBySource.get(sourceFile.sourceSha256);

        if (!local || !tinyPng) {
            throw new Error(
                `内部错误：缺少源图片结果 ${sourceFile.relativePath}`,
            );
        }

        const existingFirst = firstRelativePathBySource.get(
            sourceFile.sourceSha256,
        );
        const duplicateSource = existingFirst !== undefined;

        if (!duplicateSource) {
            firstRelativePathBySource.set(
                sourceFile.sourceSha256,
                sourceFile.relativePath,
            );
        }

        return {
            relativePath: sourceFile.relativePath,
            duplicateSource,
            sourceSha256: sourceFile.sourceSha256,
            sourceBytes: sourceFile.sourceBytes,
            png: sourceFile.png,
            local,
            tinyPng,
            comparison: createComparison(local, tinyPng),
        };
    });

    const uniqueItems = fileItems.filter((item) => !item.duplicateSource);
    const elapsedMs = performance.now() - benchmarkStarted;
    const summary = buildSummary(
        fileItems,
        uniqueItems,
        localCacheInvalidUnique,
        elapsedMs,
    );

    const report: BenchmarkReport = {
        schemaVersion: 1,
        tool: "squoosh-build-png-benchmark",
        startedAt,
        completedAt: new Date().toISOString(),
        buildDirectory: options.buildDirectory,
        cacheDirectory: options.cacheDirectory,
        tinyPngCacheDirectory: options.tinyPngCacheDirectory,
        options: {
            mode: options.mode,
            minimumSourceBytes: options.minimumSourceBytes,
            quality: options.quality,
            colours: options.colours,
            effort: options.effort,
            dither: options.dither,
            oxiPngLevel: options.oxiPngLevel,
            compareTinyPng: options.compareTinyPng,
            profileKey: options.profileKey,
        },
        summary,
        review: buildReviewLists(uniqueItems),
        files: fileItems,
    };

    const latestReportPath = path.join(
        localCache.reportsDirectory,
        "latest.json",
    );
    const archiveReportPath = path.join(
        localCache.reportsDirectory,
        `report-${report.completedAt.replace(/[:.]/g, "-")}.json`,
    );

    await writeJsonAtomically(latestReportPath, report);
    await writeJsonAtomically(archiveReportPath, report);

    console.log("");
    console.log("Squoosh 全量 PNG 基准完成");
    console.log(`扫描 PNG：${summary.scannedPngFiles}`);
    console.log(`唯一原图：${summary.uniqueSourceImages}`);
    console.log(`重复文件：${summary.duplicateFiles}`);
    console.log(`本地缓存压缩命中：${summary.localCacheCompressedHitsUnique}`);
    console.log(`本地缓存无收益命中：${summary.localCacheNoBenefitHitsUnique}`);
    console.log(`本轮新处理：${summary.localProcessedUnique}`);
    console.log(`本地压缩结果：${summary.localCompressedUnique}`);
    console.log(`本地无收益：${summary.localNoBenefitUnique}`);
    console.log(`低于最小尺寸跳过：${summary.localSkippedBelowMinBytesUnique}`);
    console.log(`达到处理上限跳过：${summary.localSkippedByLimitUnique}`);
    console.log(`处理失败：${summary.localFailedUnique}`);
    console.log(
        `本地策略总体积：${formatBytes(summary.totalSourceBytes)} → ` +
        `${formatBytes(summary.localFinalBytesForAllFiles)} ` +
        `(${summary.localSavedPercentForAllFiles.toFixed(2)}%)`,
    );
    console.log(`与 TinyPNG 可比较唯一原图：${summary.comparableUniqueSources}`);
    console.log(`本地更小：${summary.localSmallerUnique}`);
    console.log(`TinyPNG 更小：${summary.tinyPngSmallerUnique}`);
    console.log(`差距在 ±5%：${summary.withinFivePercentUnique}`);
    console.log(
        `可比较文件总体积差：${formatSignedBytes(
            summary.deltaBytesLocalMinusTinyPng,
        )} ` +
        `(${summary.deltaPercentOfTinyPng.toFixed(2)}%)`,
    );
    console.log(`JSON 报告：${latestReportPath}`);
    console.log(`归档报告：${archiveReportPath}`);
}

main().catch((error: unknown) => {
    console.error("");
    console.error("Squoosh 全量 PNG 基准失败：");
    console.error(
        error instanceof Error
            ? error.stack ?? error.message
            : String(error),
    );
    process.exitCode = 1;
});
