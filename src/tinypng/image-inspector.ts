import {
    calculateImageSha256,
} from "../tinypng-build/image-hash.js";

export { calculateImageSha256 };

export interface ImageBufferMetadata {
    format: "png" | "jpeg" | "unknown";
    width: number | null;
    height: number | null;
    hasAlpha: boolean | null;
    pixelCount: number | null;
}

const PNG_SIGNATURE = Buffer.from([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a,
]);

const JPEG_SOF_MARKERS = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
]);

function isPng(buffer: Buffer): boolean {
    return (
        buffer.length >= PNG_SIGNATURE.length &&
        buffer.subarray(0, PNG_SIGNATURE.length)
            .equals(PNG_SIGNATURE)
    );
}

function isJpeg(buffer: Buffer): boolean {
    return (
        buffer.length >= 2 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8
    );
}

function pngHasTransparencyChunk(buffer: Buffer): boolean {
    let offset = 8;

    while (offset + 12 <= buffer.length) {
        const chunkLength = buffer.readUInt32BE(offset);
        const chunkTypeOffset = offset + 4;
        const chunkDataOffset = offset + 8;
        const nextChunkOffset = chunkDataOffset + chunkLength + 4;

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

function inspectPng(buffer: Buffer): ImageBufferMetadata {
    if (
        buffer.length < 33 ||
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
    const hasAlpha =
        colorType === 4 ||
        colorType === 6 ||
        pngHasTransparencyChunk(buffer);

    return {
        format: "png",
        width,
        height,
        hasAlpha,
        pixelCount: width * height,
    };
}

function inspectJpeg(buffer: Buffer): ImageBufferMetadata {
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
            const height = buffer.readUInt16BE(offset + 3);
            const width = buffer.readUInt16BE(offset + 5);

            return {
                format: "jpeg",
                width,
                height,
                hasAlpha: false,
                pixelCount: width * height,
            };
        }

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
): ImageBufferMetadata {
    if (isPng(buffer)) {
        return inspectPng(buffer);
    }

    if (isJpeg(buffer)) {
        return inspectJpeg(buffer);
    }

    return {
        format: "unknown",
        width: null,
        height: null,
        hasAlpha: null,
        pixelCount: null,
    };
}
