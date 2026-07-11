/// <reference lib="dom" />
/// <reference path="./jsquash-emscripten.d.ts" />

import { createHash } from "node:crypto";
import {
    mkdir,
    readFile,
    rename,
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
    inputPath: string;
    outputDirectory: string;
    oxiPngLevel: number;
    tinyPngCacheDirectory: string;
    compareTinyPng: boolean;
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

interface EncodedImageInfo {
    path: string;
    bytes: number;
    sha256: string;
    savedBytes: number;
    savedPercent: number;
    elapsedMs: number;
    png: PngMetadata;
    visualDifference: VisualDifference | null;
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

interface QuantizationProfile {
    id: "q90-d1" | "q80-d1" | "q80-d05";
    label: string;
    quality: number;
    colours: number;
    effort: number;
    dither: number;
}

interface CandidateReport {
    profile: QuantizationProfile;
    quantized: EncodedImageInfo;
    quantizedThenOxiPng: EncodedImageInfo;
}

interface TinyPngReferenceReport {
    available: boolean;
    reason: string | null;
    sourceSha256: string;
    cacheIndexPath: string;
    output: EncodedImageInfo | null;
}

interface BenchmarkReport {
    schemaVersion: 1;
    tool: "squoosh-png-quantization-benchmark";
    startedAt: string;
    completedAt: string;
    inputPath: string;
    outputDirectory: string;
    options: {
        oxiPngLevel: number;
        tinyPngCacheDirectory: string;
        compareTinyPng: boolean;
    };
    input: {
        bytes: number;
        sha256: string;
        png: PngMetadata;
    };
    oxiPngOnly: EncodedImageInfo;
    tinyPngReference: TinyPngReferenceReport;
    candidates: CandidateReport[];
    smallestLocalResult: {
        profileId: QuantizationProfile["id"];
        stage: "quantized" | "quantized-then-oxipng";
        bytes: number;
        path: string;
    };
}

interface TinyPngCacheEntryLike {
    status?: unknown;
    sourceSha256?: unknown;
    compressedSha256?: unknown;
    compressedBytes?: unknown;
    compressedRelativePath?: unknown;
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

const PROFILE_LIST: readonly QuantizationProfile[] = [
    {
        id: "q90-d1",
        label: "质量 90，抖动 1.0",
        quality: 90,
        colours: 256,
        effort: 10,
        dither: 1,
    },
    {
        id: "q80-d1",
        label: "质量 80，抖动 1.0",
        quality: 80,
        colours: 256,
        effort: 10,
        dither: 1,
    },
    {
        id: "q80-d05",
        label: "质量 80，抖动 0.5",
        quality: 80,
        colours: 256,
        effort: 10,
        dither: 0.5,
    },
] as const;

function printUsage(): void {
    console.log([
        "用法：",
        "  npm run squoosh:benchmark-png -- -- <input.png> [选项]",
        "",
        "选项：",
        "  --output-dir=<目录>        输出目录。默认 workspaces/squoosh-png-benchmark/<文件名>/。",
        "  --oxipng-level=<1-6>       OxiPNG 优化等级，默认 3。",
        "  --tinypng-cache=<目录>     TinyPNG 构建缓存目录，默认 .tinypng-cache/build-images。",
        "  --no-tinypng-compare       不读取 TinyPNG 缓存参照。",
    ].join("\n"));
}

function parseIntegerOption(
    argument: string,
    name: string,
    minimum: number,
    maximum: number,
): number {
    const value = Number(argument.slice(name.length + 1));

    if (
        !Number.isInteger(value) ||
        value < minimum ||
        value > maximum
    ) {
        throw new Error(
            `${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`,
        );
    }

    return value;
}

function parseCliArguments(argv: readonly string[]): CliOptions {
    let inputPath: string | null = null;
    let outputDirectory: string | null = null;
    let oxiPngLevel = 3;
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

        if (argument.startsWith("--output-dir=")) {
            outputDirectory = argument.slice("--output-dir=".length);
            continue;
        }

        if (argument.startsWith("--oxipng-level=")) {
            oxiPngLevel = parseIntegerOption(
                argument,
                "--oxipng-level",
                1,
                6,
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

        if (inputPath !== null) {
            throw new Error(`只能指定一个输入文件：${argument}`);
        }

        inputPath = argument;
    }

    if (!inputPath) {
        printUsage();
        throw new Error("缺少输入 PNG 路径。");
    }

    const absoluteInputPath = path.resolve(inputPath);
    const defaultOutputDirectory = path.resolve(
        "workspaces",
        "squoosh-png-benchmark",
        path.basename(
            absoluteInputPath,
            path.extname(absoluteInputPath),
        ),
    );

    return {
        inputPath: absoluteInputPath,
        outputDirectory: outputDirectory
            ? path.resolve(outputDirectory)
            : defaultOutputDirectory,
        oxiPngLevel,
        tinyPngCacheDirectory,
        compareTinyPng,
    };
}

function calculateSha256(buffer: Buffer): string {
    return createHash("sha256")
        .update(buffer)
        .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    return `${(bytes / 1024).toFixed(2)} KB`;
}

function inspectPng(buffer: Buffer): PngMetadata {
    if (
        buffer.length < 33 ||
        !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
        buffer.toString("ascii", 12, 16) !== "IHDR"
    ) {
        throw new Error("输入或输出不是有效 PNG。 ");
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

async function compilePackageWasm(
    packageJsonRequest: string,
    portableRelativePath: string,
): Promise<WebAssembly.Module> {
    const wasmPath = resolvePackageFile(
        packageJsonRequest,
        portableRelativePath,
    );

    const wasmBuffer = await readFile(wasmPath);
    return WebAssembly.compile(wasmBuffer);
}

async function createOxiPngOptimiser(): Promise<(
    sourceBuffer: Buffer,
    level: number,
) => Promise<Buffer>> {
    const wasmModule = await compilePackageWasm(
        "@jsquash/oxipng/package.json",
        "codec/pkg/squoosh_oxipng_bg.wasm",
    );

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

async function createEncodedInfo(
    outputPath: string,
    outputBuffer: Buffer,
    sourceBuffer: Buffer,
    sourceMetadata: PngMetadata,
    elapsedMs: number,
    calculateDifference: boolean,
): Promise<EncodedImageInfo> {
    const metadata = inspectPng(outputBuffer);
    assertSameDimensions(sourceMetadata, metadata, outputPath);

    await writeBufferAtomically(outputPath, outputBuffer);

    const savedBytes = sourceBuffer.length - outputBuffer.length;
    const savedPercent = sourceBuffer.length > 0
        ? savedBytes / sourceBuffer.length * 100
        : 0;

    return {
        path: outputPath,
        bytes: outputBuffer.length,
        sha256: calculateSha256(outputBuffer),
        savedBytes,
        savedPercent,
        elapsedMs,
        png: metadata,
        visualDifference: calculateDifference
            ? await calculateVisualDifference(
                sourceBuffer,
                outputBuffer,
            )
            : null,
    };
}

async function quantizePng(
    sourceBuffer: Buffer,
    profile: QuantizationProfile,
): Promise<Buffer> {
    return sharp(sourceBuffer, {
        failOn: "error",
    })
        .png({
            palette: true,
            quality: profile.quality,
            colours: profile.colours,
            effort: profile.effort,
            dither: profile.dither,
            compressionLevel: 9,
            adaptiveFiltering: true,
            progressive: false,
            force: true,
        })
        .toBuffer();
}

async function loadTinyPngReference(
    cacheDirectory: string,
    sourceSha256: string,
    sourceBuffer: Buffer,
    sourceMetadata: PngMetadata,
    outputDirectory: string,
): Promise<TinyPngReferenceReport> {
    const cacheIndexPath = path.join(
        cacheDirectory,
        "index.json",
    );

    const unavailable = (reason: string): TinyPngReferenceReport => ({
        available: false,
        reason,
        sourceSha256,
        cacheIndexPath,
        output: null,
    });

    let indexValue: unknown;

    try {
        indexValue = JSON.parse(
            await readFile(cacheIndexPath, "utf8"),
        ) as unknown;
    } catch (error) {
        return unavailable(
            `无法读取 TinyPNG 缓存索引：${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }

    if (!isRecord(indexValue)) {
        return unavailable("TinyPNG 缓存索引根节点不是对象。");
    }

    const entries = indexValue.entriesBySourceSha256;

    if (!isRecord(entries)) {
        return unavailable(
            "TinyPNG 缓存索引缺少 entriesBySourceSha256。",
        );
    }

    const rawEntry = entries[sourceSha256];

    if (!isRecord(rawEntry)) {
        return unavailable("当前原图 SHA 未命中 TinyPNG 缓存。");
    }

    const entry = rawEntry as TinyPngCacheEntryLike;

    if (
        entry.status !== "compressed" ||
        typeof entry.compressedRelativePath !== "string" ||
        typeof entry.compressedSha256 !== "string" ||
        typeof entry.compressedBytes !== "number"
    ) {
        return unavailable(
            `TinyPNG 缓存命中，但状态不是完整 compressed：${String(entry.status)}`,
        );
    }

    const compressedPath = path.resolve(
        cacheDirectory,
        ...entry.compressedRelativePath.split("/"),
    );

    let compressedBuffer: Buffer;

    try {
        compressedBuffer = await readFile(compressedPath);
    } catch (error) {
        return unavailable(
            `无法读取 TinyPNG 缓存文件：${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }

    if (compressedBuffer.length !== entry.compressedBytes) {
        return unavailable(
            `TinyPNG 缓存大小不一致：索引=${entry.compressedBytes}，实际=${compressedBuffer.length}`,
        );
    }

    if (calculateSha256(compressedBuffer) !== entry.compressedSha256) {
        return unavailable("TinyPNG 缓存 SHA-256 校验失败。");
    }

    const copiedOutputPath = path.join(
        outputDirectory,
        "reference.tinypng.png",
    );

    const output = await createEncodedInfo(
        copiedOutputPath,
        compressedBuffer,
        sourceBuffer,
        sourceMetadata,
        0,
        true,
    );

    return {
        available: true,
        reason: null,
        sourceSha256,
        cacheIndexPath,
        output,
    };
}

function printEncodedResult(
    label: string,
    result: EncodedImageInfo,
): void {
    const visual = result.visualDifference;
    const psnr = visual?.whiteBackgroundPsnr;

    console.log(
        `${label.padEnd(28)} ` +
        `${formatBytes(result.bytes).padStart(11)}  ` +
        `${result.savedPercent.toFixed(2).padStart(7)}%  ` +
        `${result.png.colorTypeName.padEnd(12)}  ` +
        `${psnr === undefined || psnr === null
            ? "无损/∞"
            : `${psnr.toFixed(2)} dB`}`,
    );
}

async function main(): Promise<void> {
    const options = parseCliArguments(process.argv.slice(2));
    const startedAt = new Date().toISOString();
    const sourceBuffer = await readFile(options.inputPath);
    const sourceMetadata = inspectPng(sourceBuffer);
    const sourceSha256 = calculateSha256(sourceBuffer);

    await mkdir(options.outputDirectory, {
        recursive: true,
    });

    console.log(`输入：${options.inputPath}`);
    console.log(
        `尺寸：${sourceMetadata.width}x${sourceMetadata.height}`,
    );
    console.log(`原始体积：${formatBytes(sourceBuffer.length)}`);
    console.log(`输出目录：${options.outputDirectory}`);
    console.log("");
    console.log("正在初始化 OxiPNG WASM……");

    const optimiseWithOxiPng = await createOxiPngOptimiser();

    const oxiStarted = performance.now();
    const oxiPngOnlyBuffer = await optimiseWithOxiPng(
        sourceBuffer,
        options.oxiPngLevel,
    );
    const oxiPngOnly = await createEncodedInfo(
        path.join(options.outputDirectory, "baseline.oxipng.png"),
        oxiPngOnlyBuffer,
        sourceBuffer,
        sourceMetadata,
        performance.now() - oxiStarted,
        true,
    );

    const candidates: CandidateReport[] = [];

    for (const profile of PROFILE_LIST) {
        console.log(`正在处理 ${profile.id}（${profile.label}）……`);

        const quantizedStarted = performance.now();
        const quantizedBuffer = await quantizePng(
            sourceBuffer,
            profile,
        );
        const quantizedElapsedMs = performance.now() - quantizedStarted;

        const quantized = await createEncodedInfo(
            path.join(
                options.outputDirectory,
                `${profile.id}.quantized.png`,
            ),
            quantizedBuffer,
            sourceBuffer,
            sourceMetadata,
            quantizedElapsedMs,
            true,
        );

        const oxiStartedForCandidate = performance.now();
        const quantizedThenOxiPngBuffer = await optimiseWithOxiPng(
            quantizedBuffer,
            options.oxiPngLevel,
        );
        const oxiElapsedForCandidate =
            performance.now() - oxiStartedForCandidate;

        const quantizedThenOxiPng = await createEncodedInfo(
            path.join(
                options.outputDirectory,
                `${profile.id}.quantized-oxipng.png`,
            ),
            quantizedThenOxiPngBuffer,
            sourceBuffer,
            sourceMetadata,
            quantizedElapsedMs + oxiElapsedForCandidate,
            true,
        );

        candidates.push({
            profile,
            quantized,
            quantizedThenOxiPng,
        });
    }

    const tinyPngReference = options.compareTinyPng
        ? await loadTinyPngReference(
            options.tinyPngCacheDirectory,
            sourceSha256,
            sourceBuffer,
            sourceMetadata,
            options.outputDirectory,
        )
        : {
            available: false,
            reason: "已通过 --no-tinypng-compare 禁用。",
            sourceSha256,
            cacheIndexPath: path.join(
                options.tinyPngCacheDirectory,
                "index.json",
            ),
            output: null,
        } satisfies TinyPngReferenceReport;

    const localResults = candidates.flatMap((candidate) => [
        {
            profileId: candidate.profile.id,
            stage: "quantized" as const,
            result: candidate.quantized,
        },
        {
            profileId: candidate.profile.id,
            stage: "quantized-then-oxipng" as const,
            result: candidate.quantizedThenOxiPng,
        },
    ]);

    const smallestLocal = localResults.reduce((best, current) =>
        current.result.bytes < best.result.bytes ? current : best,
    );

    const report: BenchmarkReport = {
        schemaVersion: 1,
        tool: "squoosh-png-quantization-benchmark",
        startedAt,
        completedAt: new Date().toISOString(),
        inputPath: options.inputPath,
        outputDirectory: options.outputDirectory,
        options: {
            oxiPngLevel: options.oxiPngLevel,
            tinyPngCacheDirectory: options.tinyPngCacheDirectory,
            compareTinyPng: options.compareTinyPng,
        },
        input: {
            bytes: sourceBuffer.length,
            sha256: sourceSha256,
            png: sourceMetadata,
        },
        oxiPngOnly,
        tinyPngReference,
        candidates,
        smallestLocalResult: {
            profileId: smallestLocal.profileId,
            stage: smallestLocal.stage,
            bytes: smallestLocal.result.bytes,
            path: smallestLocal.result.path,
        },
    };

    const latestReportPath = path.join(
        options.outputDirectory,
        "latest.json",
    );
    const archiveReportPath = path.join(
        options.outputDirectory,
        `report-${report.completedAt.replace(/[:.]/g, "-")}.json`,
    );

    await writeJsonAtomically(latestReportPath, report);
    await writeJsonAtomically(archiveReportPath, report);

    console.log("");
    console.log("PNG 本地量化基准完成");
    console.log(
        "结果                         输出体积       节省率  PNG 类型      白底 PSNR",
    );
    console.log(
        "--------------------------------------------------------------------------",
    );
    printEncodedResult("OxiPNG（无损）", oxiPngOnly);

    for (const candidate of candidates) {
        printEncodedResult(
            `${candidate.profile.id} 仅量化`,
            candidate.quantized,
        );
        printEncodedResult(
            `${candidate.profile.id} + OxiPNG`,
            candidate.quantizedThenOxiPng,
        );
    }

    if (tinyPngReference.output) {
        printEncodedResult("TinyPNG 缓存参照", tinyPngReference.output);
    } else {
        console.log(
            `TinyPNG 缓存参照不可用：${tinyPngReference.reason}`,
        );
    }

    console.log("");
    console.log(
        `本地最小结果：${smallestLocal.profileId} / ` +
        `${smallestLocal.stage} / ` +
        `${formatBytes(smallestLocal.result.bytes)}`,
    );
    console.log(`JSON 报告：${latestReportPath}`);
    console.log("请同时打开输出 PNG，对透明边缘、渐变和色带进行目视检查。");
}

main().catch((error: unknown) => {
    console.error("");
    console.error("PNG 本地量化基准失败：");
    console.error(
        error instanceof Error
            ? error.stack ?? error.message
            : String(error),
    );
    process.exitCode = 1;
});
