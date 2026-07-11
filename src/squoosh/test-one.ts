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

import decodeJpeg, {
    init as initJpegDecode,
} from "@jsquash/jpeg/decode.js";
import encodeJpeg, {
    init as initJpegEncode,
} from "@jsquash/jpeg/encode.js";
import optimisePng, {
    init as initOxiPng,
} from "@jsquash/oxipng/optimise.js";

type SupportedFormat = "png" | "jpeg";

interface ImageMetadata {
    format: SupportedFormat | "unknown";
    width: number | null;
    height: number | null;
}

interface CliOptions {
    inputPath: string;
    outputPath: string | null;
    jpegQuality: number;
    oxiPngLevel: number;
}

interface SmokeTestReport {
    schemaVersion: 1;
    tool: "squoosh-test-one";
    startedAt: string;
    completedAt: string;
    inputPath: string;
    outputPath: string;
    codec: "oxipng" | "mozjpeg";
    options: {
        jpegQuality: number;
        oxiPngLevel: number;
    };
    input: {
        format: SupportedFormat;
        width: number;
        height: number;
        bytes: number;
        sha256: string;
    };
    output: {
        format: SupportedFormat;
        width: number;
        height: number;
        bytes: number;
        sha256: string;
    };
    savedBytes: number;
    savedPercent: number;
    isSmaller: boolean;
    elapsedMs: number;
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

const JPEG_SOF_MARKERS = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
]);

function printUsage(): void {
    console.log([
        "用法：",
        "  npm run squoosh:test-one -- -- <input.png|jpg|jpeg> [选项]",
        "",
        "选项：",
        "  --output=<路径>         指定输出文件。默认写入 workspaces/squoosh-smoke/output/。",
        "  --jpeg-quality=<1-100>  MozJPEG 质量，默认 80。",
        "  --oxipng-level=<1-6>    OxiPNG 优化等级，默认 3。",
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
    let outputPath: string | null = null;
    let jpegQuality = 80;
    let oxiPngLevel = 3;

    for (const argument of argv) {
        if (argument === "--") {
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            printUsage();
            process.exit(0);
        }

        if (argument.startsWith("--output=")) {
            outputPath = argument.slice("--output=".length);
            continue;
        }

        if (argument.startsWith("--jpeg-quality=")) {
            jpegQuality = parseIntegerOption(
                argument,
                "--jpeg-quality",
                1,
                100,
            );
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
        throw new Error("缺少输入图片路径。");
    }

    return {
        inputPath,
        outputPath,
        jpegQuality,
        oxiPngLevel,
    };
}

function calculateSha256(buffer: Buffer): string {
    return createHash("sha256")
        .update(buffer)
        .digest("hex");
}

function inspectPng(buffer: Buffer): ImageMetadata {
    if (
        buffer.length < 24 ||
        !buffer.subarray(0, PNG_SIGNATURE.length)
            .equals(PNG_SIGNATURE) ||
        buffer.toString("ascii", 12, 16) !== "IHDR"
    ) {
        return {
            format: "unknown",
            width: null,
            height: null,
        };
    }

    return {
        format: "png",
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function inspectJpeg(buffer: Buffer): ImageMetadata {
    if (
        buffer.length < 2 ||
        buffer[0] !== 0xff ||
        buffer[1] !== 0xd8
    ) {
        return {
            format: "unknown",
            width: null,
            height: null,
        };
    }

    let offset = 2;

    while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        while (
            offset < buffer.length &&
            buffer[offset] === 0xff
        ) {
            offset += 1;
        }

        const marker = buffer[offset];

        if (marker === undefined) {
            break;
        }

        offset += 1;

        if (marker === 0x00) {
            continue;
        }

        if (
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

        if (
            segmentLength < 2 ||
            offset + segmentLength > buffer.length
        ) {
            break;
        }

        if (
            JPEG_SOF_MARKERS.has(marker) &&
            segmentLength >= 7
        ) {
            return {
                format: "jpeg",
                width: buffer.readUInt16BE(offset + 5),
                height: buffer.readUInt16BE(offset + 3),
            };
        }

        offset += segmentLength;
    }

    return {
        format: "jpeg",
        width: null,
        height: null,
    };
}

function inspectImage(buffer: Buffer): ImageMetadata {
    const png = inspectPng(buffer);

    if (png.format === "png") {
        return png;
    }

    return inspectJpeg(buffer);
}

function requireCompleteMetadata(
    metadata: ImageMetadata,
    description: string,
): asserts metadata is {
    format: SupportedFormat;
    width: number;
    height: number;
} {
    if (
        metadata.format === "unknown" ||
        metadata.width === null ||
        metadata.height === null
    ) {
        throw new Error(
            `${description}不是可识别的 PNG 或 JPEG，或无法读取宽高。`,
        );
    }
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

    Object.defineProperty(
        globalThis,
        "ImageData",
        {
            configurable: true,
            writable: true,
            value: NodeImageData,
        },
    );
}

function resolvePackageFile(
    packageJsonRequest: string,
    portableRelativePath: string,
): string {
    const packageJsonPath = require.resolve(
        packageJsonRequest,
    );

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

async function compressPng(
    sourceBuffer: Buffer,
    level: number,
): Promise<Buffer> {
    installNodeImageDataPolyfill();

    const wasmModule = await compilePackageWasm(
        "@jsquash/oxipng/package.json",
        "codec/pkg/squoosh_oxipng_bg.wasm",
    );

    await initOxiPng(wasmModule);

    const output = await optimisePng(
        toExactArrayBuffer(sourceBuffer),
        {
            level,
            interlace: false,
            optimiseAlpha: false,
        },
    );

    return Buffer.from(output);
}

async function compressJpeg(
    sourceBuffer: Buffer,
    quality: number,
): Promise<Buffer> {
    const [decoderModule, encoderModule] =
        await Promise.all([
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

    const imageData = await decodeJpeg(
        toExactArrayBuffer(sourceBuffer),
    );

    const output = await encodeJpeg(
        imageData,
        {
            quality,
            chroma_quality: quality,
        },
    );

    return Buffer.from(output);
}

async function replaceFile(
    temporaryPath: string,
    targetPath: string,
): Promise<void> {
    try {
        await rename(temporaryPath, targetPath);
    } catch (error) {
        const code =
            error instanceof Error &&
            "code" in error
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
            // 临时文件可能还没有创建。
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
        Buffer.from(
            `${JSON.stringify(value, null, 2)}\n`,
            "utf8",
        ),
    );
}

function createDefaultOutputPath(
    inputPath: string,
    format: SupportedFormat,
): string {
    const extension = format === "png"
        ? ".png"
        : path.extname(inputPath).toLowerCase() === ".jpeg"
            ? ".jpeg"
            : ".jpg";

    const basename = path.basename(
        inputPath,
        path.extname(inputPath),
    );

    return path.resolve(
        "workspaces",
        "squoosh-smoke",
        "output",
        `${basename}.squoosh${extension}`,
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    return `${(bytes / 1024).toFixed(2)} KB`;
}

async function main(): Promise<void> {
    const options = parseCliArguments(
        process.argv.slice(2),
    );

    const startedAt = new Date().toISOString();
    const inputPath = path.resolve(options.inputPath);
    const sourceBuffer = await readFile(inputPath);
    const sourceMetadata = inspectImage(sourceBuffer);

    requireCompleteMetadata(
        sourceMetadata,
        "输入文件",
    );

    const outputPath = options.outputPath
        ? path.resolve(options.outputPath)
        : createDefaultOutputPath(
            inputPath,
            sourceMetadata.format,
        );

    if (inputPath.toLowerCase() === outputPath.toLowerCase()) {
        throw new Error(
            "输出路径不能与输入路径相同。冒烟测试不会覆盖原图。",
        );
    }

    console.log(`输入：${inputPath}`);
    console.log(
        `格式：${sourceMetadata.format.toUpperCase()} ` +
        `${sourceMetadata.width}x${sourceMetadata.height}`,
    );

    const started = performance.now();

    const outputBuffer = sourceMetadata.format === "png"
        ? await compressPng(
            sourceBuffer,
            options.oxiPngLevel,
        )
        : await compressJpeg(
            sourceBuffer,
            options.jpegQuality,
        );

    const elapsedMs = performance.now() - started;
    const outputMetadata = inspectImage(outputBuffer);

    requireCompleteMetadata(
        outputMetadata,
        "压缩结果",
    );

    if (outputMetadata.format !== sourceMetadata.format) {
        throw new Error(
            `压缩前后格式不一致：` +
            `${sourceMetadata.format} → ${outputMetadata.format}`,
        );
    }

    if (
        outputMetadata.width !== sourceMetadata.width ||
        outputMetadata.height !== sourceMetadata.height
    ) {
        throw new Error(
            `压缩前后尺寸不一致：` +
            `${sourceMetadata.width}x${sourceMetadata.height} → ` +
            `${outputMetadata.width}x${outputMetadata.height}`,
        );
    }

    await writeBufferAtomically(
        outputPath,
        outputBuffer,
    );

    const savedBytes =
        sourceBuffer.length - outputBuffer.length;

    const savedPercent = sourceBuffer.length > 0
        ? savedBytes / sourceBuffer.length * 100
        : 0;

    const report: SmokeTestReport = {
        schemaVersion: 1,
        tool: "squoosh-test-one",
        startedAt,
        completedAt: new Date().toISOString(),
        inputPath,
        outputPath,
        codec: sourceMetadata.format === "png"
            ? "oxipng"
            : "mozjpeg",
        options: {
            jpegQuality: options.jpegQuality,
            oxiPngLevel: options.oxiPngLevel,
        },
        input: {
            format: sourceMetadata.format,
            width: sourceMetadata.width,
            height: sourceMetadata.height,
            bytes: sourceBuffer.length,
            sha256: calculateSha256(sourceBuffer),
        },
        output: {
            format: outputMetadata.format,
            width: outputMetadata.width,
            height: outputMetadata.height,
            bytes: outputBuffer.length,
            sha256: calculateSha256(outputBuffer),
        },
        savedBytes,
        savedPercent,
        isSmaller: outputBuffer.length < sourceBuffer.length,
        elapsedMs,
    };

    const reportsDirectory = path.resolve(
        "workspaces",
        "squoosh-smoke",
        "reports",
    );

    const archiveName =
        `report-${report.completedAt.replace(/[:.]/g, "-")}.json`;

    const latestReportPath = path.join(
        reportsDirectory,
        "latest.json",
    );

    const archiveReportPath = path.join(
        reportsDirectory,
        archiveName,
    );

    await writeJsonAtomically(latestReportPath, report);
    await writeJsonAtomically(archiveReportPath, report);

    console.log("");
    console.log("Squoosh 单图冒烟测试完成");
    console.log(`编解码器：${report.codec}`);
    console.log(`原始体积：${formatBytes(sourceBuffer.length)}`);
    console.log(`输出体积：${formatBytes(outputBuffer.length)}`);
    console.log(
        `体积变化：${savedBytes >= 0 ? "减少" : "增加"} ` +
        `${formatBytes(Math.abs(savedBytes))} ` +
        `(${savedPercent.toFixed(2)}%)`,
    );
    console.log(`处理耗时：${elapsedMs.toFixed(2)} ms`);
    console.log(`输出文件：${outputPath}`);
    console.log(`JSON 报告：${latestReportPath}`);

    if (!report.isSmaller) {
        console.warn(
            "注意：本次输出没有更小。冒烟测试仍保留结果用于检查。",
        );
    }
}

main().catch((error: unknown) => {
    console.error("");
    console.error("Squoosh 单图冒烟测试失败：");
    console.error(
        error instanceof Error
            ? error.stack ?? error.message
            : String(error),
    );
    process.exitCode = 1;
});
