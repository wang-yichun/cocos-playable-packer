import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
    InspectedSourceImageFile,
    ScannedSourceImageFile,
    SourceImageMetadata,
} from "./types.js";

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

/**
 * JPEG 中包含宽高信息的 Start Of Frame 标记。
 *
 * 不包括：
 * - 0xC4：DHT
 * - 0xC8：JPG
 * - 0xCC：DAC
 */
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

export function calculateImageSha256(
    buffer: Buffer,
): string {
    return createHash("sha256")
        .update(buffer)
        .digest("hex");
}

function isPng(buffer: Buffer): boolean {
    if (buffer.length < PNG_SIGNATURE.length) {
        return false;
    }

    return buffer.subarray(0, PNG_SIGNATURE.length)
        .equals(PNG_SIGNATURE);
}

function isJpeg(buffer: Buffer): boolean {
    return (
        buffer.length >= 2 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8
    );
}

/**
 * 判断 PNG 是否包含 tRNS 透明信息块。
 *
 * PNG 并不只有 RGBA 才能透明：
 * - 调色板 PNG 可以通过 tRNS 指定透明度；
 * - RGB/灰度 PNG 也可以指定某一个透明颜色。
 */
function pngHasTransparencyChunk(buffer: Buffer): boolean {
    let offset = 8;

    while (offset + 12 <= buffer.length) {
        const chunkLength = buffer.readUInt32BE(offset);
        const chunkTypeOffset = offset + 4;
        const chunkDataOffset = offset + 8;
        const nextChunkOffset =
            chunkDataOffset + chunkLength + 4;

        if (nextChunkOffset > buffer.length) {
            return false;
        }

        const chunkType = buffer.toString(
            "ascii",
            chunkTypeOffset,
            chunkTypeOffset + 4,
        );

        if (chunkType === "tRNS") {
            return true;
        }

        if (chunkType === "IEND") {
            return false;
        }

        offset = nextChunkOffset;
    }

    return false;
}

function parsePngMetadata(
    buffer: Buffer,
): SourceImageMetadata {
    /*
     * PNG 基础结构：
     *
     * 0  - 7   PNG signature
     * 8  - 11  IHDR data length
     * 12 - 15  "IHDR"
     * 16 - 19  width
     * 20 - 23  height
     * 24       bit depth
     * 25       color type
     */
    if (
        buffer.length < 33 ||
        !isPng(buffer) ||
        buffer.toString("ascii", 12, 16) !== "IHDR"
    ) {
        return {
            format: "unknown",
            width: null,
            height: null,
            hasAlpha: null,
            pixelCount: null,
        };
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const colorType = buffer[25];

    /*
     * PNG color type：
     *
     * 0：灰度
     * 2：RGB
     * 3：索引色
     * 4：灰度 + Alpha
     * 6：RGBA
     */
    const hasAlphaChannel =
        colorType === 4 ||
        colorType === 6;

    const hasTransparency =
        hasAlphaChannel ||
        pngHasTransparencyChunk(buffer);

    return {
        format: "png",
        width,
        height,
        hasAlpha: hasTransparency,
        pixelCount: width * height,
    };
}

function parseJpegMetadata(
    buffer: Buffer,
): SourceImageMetadata {
    if (!isJpeg(buffer)) {
        return {
            format: "unknown",
            width: null,
            height: null,
            hasAlpha: null,
            pixelCount: null,
        };
    }

    /*
     * 跳过 JPEG SOI：
     *
     * FF D8
     */
    let offset = 2;

    while (offset < buffer.length) {
        /*
         * 寻找 marker 前缀 FF。
         */
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        /*
         * JPEG 中可能连续出现多个 FF 填充字节。
         */
        while (
            offset < buffer.length &&
            buffer[offset] === 0xff
        ) {
            offset += 1;
        }

        if (offset >= buffer.length) {
            break;
        }

        const marker = buffer[offset];

        if (marker === undefined) {
            break;
        }

        offset += 1;

        /*
         * FF 00 表示字节填充，不是真正 marker。
         */
        if (marker === 0x00) {
            continue;
        }

        /*
         * 这些 marker 没有附带长度字段。
         */
        if (
            marker === 0xd8 ||
            marker === 0xd9 ||
            marker === 0x01 ||
            (marker >= 0xd0 && marker <= 0xd7)
        ) {
            continue;
        }

        /*
         * SOS：Start Of Scan。
         *
         * 宽高信息应该已经在此前出现；
         * 后面是压缩图像数据，不继续按 segment 解析。
         */
        if (marker === 0xda) {
            break;
        }

        if (offset + 2 > buffer.length) {
            break;
        }

        const segmentLength =
            buffer.readUInt16BE(offset);

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
            /*
             * segmentLength 起点：
             *
             * +0  length high
             * +1  length low
             * +2  precision
             * +3  height high
             * +4  height low
             * +5  width high
             * +6  width low
             */
            const height =
                buffer.readUInt16BE(offset + 3);

            const width =
                buffer.readUInt16BE(offset + 5);

            return {
                format: "jpeg",
                width,
                height,

                /*
                 * 标准 JPEG 不支持 Alpha。
                 */
                hasAlpha: false,

                pixelCount: width * height,
            };
        }

        /*
         * segmentLength 已经包含它自身的两个长度字节。
         */
        offset += segmentLength;
    }

    return {
        format: "jpeg",
        width: null,
        height: null,
        hasAlpha: false,
        pixelCount: null,
    };
}

export function inspectImageBufferMetadata(
    buffer: Buffer,
): SourceImageMetadata {
    if (isPng(buffer)) {
        return parsePngMetadata(buffer);
    }

    if (isJpeg(buffer)) {
        return parseJpegMetadata(buffer);
    }

    return {
        format: "unknown",
        width: null,
        height: null,
        hasAlpha: null,
        pixelCount: null,
    };
}

/**
 * 读取一张图片。
 *
 * Buffer 会同时用于：
 * - SHA-256；
 * - PNG/JPEG 文件头解析。
 *
 * 因此不会为了两个功能重复读取磁盘文件。
 */
export async function inspectSourceImageFile(
    file: ScannedSourceImageFile,
): Promise<InspectedSourceImageFile> {
    let buffer: Buffer;

    try {
        buffer = await readFile(file.absolutePath);
    } catch (error) {
        throw new Error(
            `无法读取源图片：${file.absolutePath}`,
            {
                cause: error,
            },
        );
    }

    return {
        ...file,
        sha256: calculateImageSha256(buffer),
        metadata: inspectImageBufferMetadata(buffer),
    };
}

/**
 * 简单的并发任务执行器。
 *
 * 不直接 Promise.all() 同时读取所有文件，
 * 避免项目图片很多时瞬间打开几百或几千个文件。
 */
async function mapWithConcurrency<TInput, TOutput>(
    inputs: readonly TInput[],
    concurrency: number,
    handler: (
        input: TInput,
        index: number,
    ) => Promise<TOutput>,
): Promise<TOutput[]> {
    if (
        !Number.isInteger(concurrency) ||
        concurrency <= 0
    ) {
        throw new Error(
            `并发数必须是正整数，当前值：${concurrency}`,
        );
    }

    const results = new Array<TOutput>(inputs.length);

    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            if (currentIndex >= inputs.length) {
                return;
            }

            const input = inputs[currentIndex];

            if (input === undefined) {
                throw new Error(
                    `读取图片任务索引越界：${currentIndex}`,
                );
            }

            results[currentIndex] = await handler(
                input,
                currentIndex,
            );
        }
    }

    const workerCount = Math.min(
        concurrency,
        inputs.length,
    );

    await Promise.all(
        Array.from(
            { length: workerCount },
            () => worker(),
        ),
    );

    return results;
}

/**
 * 批量读取图片内容。
 *
 * 默认同时读取 8 个文件。
 */
export async function inspectSourceImageFiles(
    files: readonly ScannedSourceImageFile[],
    concurrency = 8,
): Promise<InspectedSourceImageFile[]> {
    if (files.length === 0) {
        return [];
    }

    return mapWithConcurrency(
        files,
        concurrency,
        async (file) => inspectSourceImageFile(file),
    );
}