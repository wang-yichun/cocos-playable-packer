import {
    readFile,
    readdir,
    writeFile,
    mkdir,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
    brotliCompressSync,
    constants as zlibConstants,
} from 'node:zlib';
import { performance } from 'node:perf_hooks';

type CandidateClass =
    | 'safe'
    | 'review'
    | 'risky'
    | 'ignore';

type Priority = 'P0' | 'P1' | 'P2';

type AlphaState =
    | 'yes'
    | 'no'
    | 'possible'
    | 'unknown';

interface FileRecord {
    path: string;
    absolutePath: string;
    extension: string;
    basename: string;
    stem: string;
    rawBytes: number;
    singleBrotliBytes: number;
    brotliRatio: number;
    sha256: string;
    estimatedSolidContributionBytes: number;
    archiveIncluded: boolean;
    textual: boolean;
}

interface ImageInfo {
    path: string;
    format: string;
    width: number | null;
    height: number | null;
    pixelCount: number | null;
    hasAlpha: AlphaState;
    bitDepth: number | null;
    channels: number | null;
    rawBytes: number;
    singleBrotliBytes: number;
    bytesPerPixel: number | null;
    notes: string[];
}

interface AudioInfo {
    path: string;
    format: string;
    rawBytes: number;
    singleBrotliBytes: number;
    durationSeconds: number | null;
    bitrateKbps: number | null;
    sampleRateHz: number | null;
    channels: number | null;
    bitsPerSample: number | null;
    codec: string | null;
    metadataConfidence: 'high' | 'medium' | 'low' | 'unknown';
    notes: string[];
}

interface FontInfo {
    path: string;
    format: string;
    rawBytes: number;
    singleBrotliBytes: number;
    family: string | null;
    subfamily: string | null;
    glyphCount: number | null;
    unitsPerEm: number | null;
    sfntSize: number | null;
    notes: string[];
}

interface WasmInfo {
    path: string;
    rawBytes: number;
    singleBrotliBytes: number;
    validWasm: boolean;
    version: number | null;
    sectionCount: number;
    customSectionBytes: number;
    importCount: number | null;
    exportCount: number | null;
    customSectionNames: string[];
    notes: string[];
}

interface JavaScriptInfo {
    path: string;
    rawBytes: number;
    singleBrotliBytes: number;
    lineCount: number;
    averageLineLength: number;
    minifiedHeuristic: boolean;
    consoleCallCount: number;
    debuggerCount: number;
    sourceMapReferenceCount: number;
    asmJsMarkerCount: number;
    systemRegisterCount: number;
    systemRegisterNamedCount: number;
    systemRegisterAnonymousCount: number;
    debugMarkerCount: number;
    featureMarkers: string[];
}

interface DuplicateGroup {
    sha256: string;
    fileCount: number;
    paths: string[];
    rawBytes: number;
    uniqueRawBytes: number;
    rawSavingsBytes: number;
    groupBrotliBeforeBytes: number;
    groupBrotliAfterBytes: number;
    groupBrotliSavingsBytes: number;
    classification: CandidateClass;
    note: string;
}

interface SimilarNameGroup {
    key: string;
    kind: 'asset-id-variants' | 'normalized-name';
    paths: string[];
    rawBytes: number;
    extensions: string[];
    note: string;
}

interface UnreferencedCandidate {
    path: string;
    rawBytes: number;
    singleBrotliBytes: number;
    estimatedSolidContributionBytes: number;
    extractedTokens: string[];
    foundReferenceTokens: string[];
    classification: CandidateClass;
    confidence: 'low' | 'medium';
    warning: string;
}

interface Opportunity {
    id: string;
    priority: Priority;
    category: string;
    classification: CandidateClass;
    title: string;
    paths: string[];
    currentRawBytes: number;
    estimatedAfterRawBytes: number | null;
    rawSavingsBytes: number | null;
    currentBrotliBytes: number;
    estimatedAfterBrotliBytes: number | null;
    estimatedBrotliSavingsBytes: number | null;
    estimateKind: 'measured' | 'modelled' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    compatibilityRisk: string;
    functionalRisk: string;
    rationale: string;
    nextAction: string;
}

interface ExtensionSummary {
    extension: string;
    fileCount: number;
    rawBytes: number;
    singleBrotliBytes: number;
    estimatedSolidContributionBytes: number;
    brotliRatio: number;
    percentageOfRaw: number;
    percentageOfEstimatedSolid: number;
}

const ANALYZER_VERSION = '1.0.0';
const TOP_LIMIT = 50;
const UNREFERENCED_LIMIT = 200;
const TEXT_SCAN_LIMIT_BYTES = 32 * 1024 * 1024;
const SOLID_EXCLUDED_FILES = new Set([
    'index.html',
    'style.css',
]);

const TEXT_EXTENSIONS = new Set([
    '.html', '.htm', '.css', '.js', '.mjs', '.cjs',
    '.json', '.map', '.txt', '.xml', '.plist', '.atlas',
    '.fnt', '.effect', '.glsl', '.vert', '.frag', '.md',
    '.yaml', '.yml', '.csv', '.tsv', '.ini', '.cfg',
]);

const IMAGE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
    '.svg', '.astc', '.pkm', '.pvr',
]);

const AUDIO_EXTENSIONS = new Set([
    '.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a',
    '.mp4', '.aac',
]);

const FONT_EXTENSIONS = new Set([
    '.ttf', '.otf', '.woff', '.woff2',
]);

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function round(value: number, digits = 2): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function percent(part: number, total: number): number {
    return total > 0 ? round(part / total * 100) : 0;
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

function brotli(buffer: Buffer): Buffer {
    return brotliCompressSync(
        buffer,
        {
            params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
                [zlibConstants.BROTLI_PARAM_MODE]:
                    zlibConstants.BROTLI_MODE_GENERIC,
                [zlibConstants.BROTLI_PARAM_SIZE_HINT]:
                    buffer.byteLength,
            },
        },
    );
}

async function walkDirectory(
    root: string,
    current: string,
    output: string[],
): Promise<void> {
    const entries = await readdir(current, {
        withFileTypes: true,
    });

    for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);

        if (entry.isDirectory()) {
            await walkDirectory(root, absolutePath, output);
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        output.push(
            normalizePath(path.relative(root, absolutePath)),
        );
    }
}

function sha256(buffer: Buffer): string {
    return createHash('sha256')
        .update(buffer)
        .digest('hex');
}

function readUInt24LE(buffer: Buffer, offset: number): number {
    return (
        buffer[offset]!
        | (buffer[offset + 1]! << 8)
        | (buffer[offset + 2]! << 16)
    ) >>> 0;
}

function readUInt24BE(buffer: Buffer, offset: number): number {
    return (
        (buffer[offset]! << 16)
        | (buffer[offset + 1]! << 8)
        | buffer[offset + 2]!
    ) >>> 0;
}

function readUInt64LEAsNumber(
    buffer: Buffer,
    offset: number,
): number {
    const value = buffer.readBigUInt64LE(offset);
    return value > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(value);
}

function isPng(buffer: Buffer): boolean {
    return buffer.length >= 24
        && buffer.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
}

function parsePng(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    if (!isPng(buffer)) {
        return null;
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const bitDepth = buffer[24] ?? null;
    const colorType = buffer[25] ?? -1;
    let hasTransparencyChunk = false;
    let offset = 8;

    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);

        if (type === 'tRNS') {
            hasTransparencyChunk = true;
        }

        offset += 12 + length;

        if (type === 'IEND') {
            break;
        }
    }

    const channelsByColorType: Record<number, number> = {
        0: 1,
        2: 3,
        3: 1,
        4: 2,
        6: 4,
    };

    return {
        format: 'png',
        width,
        height,
        pixelCount: width * height,
        hasAlpha:
            colorType === 4
            || colorType === 6
            || hasTransparencyChunk
                ? 'yes'
                : 'no',
        bitDepth,
        channels: channelsByColorType[colorType] ?? null,
        bytesPerPixel: null,
        notes: [
            `PNG color type ${colorType}`,
            hasTransparencyChunk
                ? '包含 tRNS 透明度块'
                : '未发现 tRNS 透明度块',
        ],
    };
}

function parseJpeg(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    if (
        buffer.length < 4
        || buffer[0] !== 0xff
        || buffer[1] !== 0xd8
    ) {
        return null;
    }

    const sofMarkers = new Set([
        0xc0, 0xc1, 0xc2, 0xc3,
        0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb,
        0xcd, 0xce, 0xcf,
    ]);

    let offset = 2;

    while (offset + 4 <= buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        let markerOffset = offset + 1;
        while (buffer[markerOffset] === 0xff) {
            markerOffset += 1;
        }

        const marker = buffer[markerOffset]!;
        offset = markerOffset + 1;

        if (marker === 0xd9 || marker === 0xda) {
            break;
        }

        if (offset + 2 > buffer.length) {
            break;
        }

        const segmentLength = buffer.readUInt16BE(offset);

        if (
            sofMarkers.has(marker)
            && offset + 8 <= buffer.length
        ) {
            const bitDepth = buffer[offset + 2]!;
            const height = buffer.readUInt16BE(offset + 3);
            const width = buffer.readUInt16BE(offset + 5);
            const channels = buffer[offset + 7]!;

            return {
                format: 'jpeg',
                width,
                height,
                pixelCount: width * height,
                hasAlpha: 'no',
                bitDepth,
                channels,
                bytesPerPixel: null,
                notes: [`JPEG SOF marker 0x${marker.toString(16)}`],
            };
        }

        if (segmentLength < 2) {
            break;
        }

        offset += segmentLength;
    }

    return {
        format: 'jpeg',
        width: null,
        height: null,
        pixelCount: null,
        hasAlpha: 'no',
        bitDepth: null,
        channels: null,
        bytesPerPixel: null,
        notes: ['未定位到 JPEG SOF 尺寸段'],
    };
}

function parseGif(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    const signature = buffer.toString('ascii', 0, 6);
    if (signature !== 'GIF87a' && signature !== 'GIF89a') {
        return null;
    }

    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    let hasAlpha: AlphaState = 'no';

    for (let index = 0; index + 7 < buffer.length; index += 1) {
        if (
            buffer[index] === 0x21
            && buffer[index + 1] === 0xf9
            && buffer[index + 2] === 0x04
        ) {
            const packed = buffer[index + 3]!;
            if ((packed & 0x01) !== 0) {
                hasAlpha = 'yes';
                break;
            }
        }
    }

    return {
        format: 'gif',
        width,
        height,
        pixelCount: width * height,
        hasAlpha,
        bitDepth: 8,
        channels: null,
        bytesPerPixel: null,
        notes: [signature],
    };
}

function parseWebp(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    if (
        buffer.length < 16
        || buffer.toString('ascii', 0, 4) !== 'RIFF'
        || buffer.toString('ascii', 8, 12) !== 'WEBP'
    ) {
        return null;
    }

    const chunkType = buffer.toString('ascii', 12, 16);

    if (chunkType === 'VP8X' && buffer.length >= 30) {
        const flags = buffer[20]!;
        const width = readUInt24LE(buffer, 24) + 1;
        const height = readUInt24LE(buffer, 27) + 1;

        return {
            format: 'webp',
            width,
            height,
            pixelCount: width * height,
            hasAlpha: (flags & 0x10) !== 0 ? 'yes' : 'no',
            bitDepth: 8,
            channels: (flags & 0x10) !== 0 ? 4 : 3,
            bytesPerPixel: null,
            notes: ['WebP VP8X'],
        };
    }

    if (chunkType === 'VP8L' && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >>> 14) & 0x3fff) + 1;

        return {
            format: 'webp-lossless',
            width,
            height,
            pixelCount: width * height,
            hasAlpha: 'possible',
            bitDepth: 8,
            channels: 4,
            bytesPerPixel: null,
            notes: ['VP8L 支持 Alpha，但头部不能确认是否实际使用'],
        };
    }

    if (chunkType === 'VP8 ' && buffer.length >= 30) {
        const frameOffset = 20;
        if (
            buffer[frameOffset + 3] === 0x9d
            && buffer[frameOffset + 4] === 0x01
            && buffer[frameOffset + 5] === 0x2a
        ) {
            const width = buffer.readUInt16LE(frameOffset + 6) & 0x3fff;
            const height = buffer.readUInt16LE(frameOffset + 8) & 0x3fff;

            return {
                format: 'webp-lossy',
                width,
                height,
                pixelCount: width * height,
                hasAlpha: 'no',
                bitDepth: 8,
                channels: 3,
                bytesPerPixel: null,
                notes: ['WebP VP8 lossy'],
            };
        }
    }

    return {
        format: 'webp',
        width: null,
        height: null,
        pixelCount: null,
        hasAlpha: 'unknown',
        bitDepth: null,
        channels: null,
        bytesPerPixel: null,
        notes: [`未识别 WebP chunk ${chunkType}`],
    };
}

function parseBmp(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    if (
        buffer.length < 30
        || buffer.toString('ascii', 0, 2) !== 'BM'
    ) {
        return null;
    }

    const dibSize = buffer.readUInt32LE(14);
    if (dibSize < 12) {
        return null;
    }

    const width = dibSize === 12
        ? buffer.readUInt16LE(18)
        : Math.abs(buffer.readInt32LE(18));
    const height = dibSize === 12
        ? buffer.readUInt16LE(20)
        : Math.abs(buffer.readInt32LE(22));
    const bitsPerPixel = dibSize === 12
        ? buffer.readUInt16LE(24)
        : buffer.readUInt16LE(28);

    return {
        format: 'bmp',
        width,
        height,
        pixelCount: width * height,
        hasAlpha: bitsPerPixel === 32 ? 'possible' : 'no',
        bitDepth: bitsPerPixel,
        channels: bitsPerPixel === 32 ? 4 : 3,
        bytesPerPixel: null,
        notes: [`BMP DIB ${dibSize} bytes`],
    };
}

function parseSvg(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    const source = buffer.toString('utf8');
    if (!/<svg\b/i.test(source)) {
        return null;
    }

    const widthMatch = /\bwidth\s*=\s*["']([0-9.]+)/i.exec(source);
    const heightMatch = /\bheight\s*=\s*["']([0-9.]+)/i.exec(source);
    const viewBoxMatch = /\bviewBox\s*=\s*["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)/i.exec(source);

    const width = widthMatch
        ? Number(widthMatch[1])
        : viewBoxMatch
            ? Number(viewBoxMatch[1])
            : null;
    const height = heightMatch
        ? Number(heightMatch[1])
        : viewBoxMatch
            ? Number(viewBoxMatch[2])
            : null;

    return {
        format: 'svg',
        width,
        height,
        pixelCount:
            width !== null && height !== null
                ? width * height
                : null,
        hasAlpha: 'possible',
        bitDepth: null,
        channels: null,
        bytesPerPixel: null,
        notes: ['矢量图；像素总量仅按 viewport 估算'],
    };
}

function parseAstc(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    if (
        buffer.length < 16
        || buffer[0] !== 0x13
        || buffer[1] !== 0xab
        || buffer[2] !== 0xa1
        || buffer[3] !== 0x5c
    ) {
        return null;
    }

    const width = readUInt24LE(buffer, 7);
    const height = readUInt24LE(buffer, 10);

    return {
        format: 'astc',
        width,
        height,
        pixelCount: width * height,
        hasAlpha: 'unknown',
        bitDepth: null,
        channels: null,
        bytesPerPixel: null,
        notes: [
            `ASTC block ${buffer[4]}x${buffer[5]}x${buffer[6]}`,
        ],
    };
}

function parsePkm(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    const signature = buffer.toString('ascii', 0, 6);
    if (signature !== 'PKM 10' && signature !== 'PKM 20') {
        return null;
    }

    const width = buffer.readUInt16BE(12);
    const height = buffer.readUInt16BE(14);

    return {
        format: 'pkm',
        width,
        height,
        pixelCount: width * height,
        hasAlpha: 'unknown',
        bitDepth: null,
        channels: null,
        bytesPerPixel: null,
        notes: [signature],
    };
}

function parsePvr(buffer: Buffer): Omit<ImageInfo,
    'path' | 'rawBytes' | 'singleBrotliBytes'> | null {
    if (
        buffer.length < 52
        || buffer.readUInt32LE(0) !== 0x03525650
    ) {
        return null;
    }

    const height = buffer.readUInt32LE(24);
    const width = buffer.readUInt32LE(28);

    return {
        format: 'pvr-v3',
        width,
        height,
        pixelCount: width * height,
        hasAlpha: 'unknown',
        bitDepth: null,
        channels: null,
        bytesPerPixel: null,
        notes: [
            `PVR pixel format low=${buffer.readUInt32LE(8)}`,
        ],
    };
}

function analyzeImage(
    file: FileRecord,
    buffer: Buffer,
): ImageInfo | null {
    const extension = file.extension;
    let parsed: Omit<ImageInfo,
        'path' | 'rawBytes' | 'singleBrotliBytes'> | null = null;

    if (extension === '.png') parsed = parsePng(buffer);
    else if (extension === '.jpg' || extension === '.jpeg') parsed = parseJpeg(buffer);
    else if (extension === '.gif') parsed = parseGif(buffer);
    else if (extension === '.webp') parsed = parseWebp(buffer);
    else if (extension === '.bmp') parsed = parseBmp(buffer);
    else if (extension === '.svg') parsed = parseSvg(buffer);
    else if (extension === '.astc') parsed = parseAstc(buffer);
    else if (extension === '.pkm') parsed = parsePkm(buffer);
    else if (extension === '.pvr') parsed = parsePvr(buffer);

    if (!parsed) {
        return {
            path: file.path,
            format: extension.slice(1) || 'unknown',
            width: null,
            height: null,
            pixelCount: null,
            hasAlpha: 'unknown',
            bitDepth: null,
            channels: null,
            rawBytes: file.rawBytes,
            singleBrotliBytes: file.singleBrotliBytes,
            bytesPerPixel: null,
            notes: ['文件格式解析失败'],
        };
    }

    const bytesPerPixel = parsed.pixelCount && parsed.pixelCount > 0
        ? round(file.rawBytes / parsed.pixelCount, 4)
        : null;

    return {
        ...parsed,
        path: file.path,
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        bytesPerPixel,
    };
}

const MPEG_BITRATES: Record<string, number[]> = {
    '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

function synchsafeToInt(buffer: Buffer, offset: number): number {
    return (
        ((buffer[offset]! & 0x7f) << 21)
        | ((buffer[offset + 1]! & 0x7f) << 14)
        | ((buffer[offset + 2]! & 0x7f) << 7)
        | (buffer[offset + 3]! & 0x7f)
    );
}

function parseMp3(
    file: FileRecord,
    buffer: Buffer,
): AudioInfo | null {
    let offset = 0;
    if (buffer.toString('ascii', 0, 3) === 'ID3' && buffer.length >= 10) {
        offset = 10 + synchsafeToInt(buffer, 6);
    }

    while (offset + 4 <= buffer.length) {
        const header = buffer.readUInt32BE(offset);
        if ((header & 0xffe00000) !== 0xffe00000) {
            offset += 1;
            continue;
        }

        const versionBits = (header >>> 19) & 0x03;
        const layerBits = (header >>> 17) & 0x03;
        const bitrateIndex = (header >>> 12) & 0x0f;
        const sampleRateIndex = (header >>> 10) & 0x03;
        const channelMode = (header >>> 6) & 0x03;

        if (
            versionBits === 1
            || layerBits === 0
            || bitrateIndex === 0
            || bitrateIndex === 15
            || sampleRateIndex === 3
        ) {
            offset += 1;
            continue;
        }

        const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
        const layer = 4 - layerBits;
        const versionGroup = version === 1 ? 1 : 2;
        const bitrateTable = MPEG_BITRATES[`${versionGroup}-${layer}`];
        const bitrateKbps = bitrateTable?.[bitrateIndex] ?? 0;
        const baseRates = [44100, 48000, 32000];
        const sampleRateHz = Math.round(
            baseRates[sampleRateIndex]! / (version === 1 ? 1 : version === 2 ? 2 : 4),
        );
        const channels = channelMode === 3 ? 1 : 2;
        const audioBytes = Math.max(0, buffer.length - offset);
        const durationSeconds = bitrateKbps > 0
            ? audioBytes * 8 / (bitrateKbps * 1000)
            : null;

        return {
            path: file.path,
            format: 'mp3',
            rawBytes: file.rawBytes,
            singleBrotliBytes: file.singleBrotliBytes,
            durationSeconds: durationSeconds === null ? null : round(durationSeconds, 3),
            bitrateKbps,
            sampleRateHz,
            channels,
            bitsPerSample: null,
            codec: `MPEG ${version} Layer ${layer}`,
            metadataConfidence: 'medium',
            notes: [
                '时长按首帧码率估算；VBR 文件可能有偏差',
            ],
        };
    }

    return null;
}

function parseWav(
    file: FileRecord,
    buffer: Buffer,
): AudioInfo | null {
    if (
        buffer.length < 12
        || buffer.toString('ascii', 0, 4) !== 'RIFF'
        || buffer.toString('ascii', 8, 12) !== 'WAVE'
    ) {
        return null;
    }

    let offset = 12;
    let formatTag: number | null = null;
    let channels: number | null = null;
    let sampleRateHz: number | null = null;
    let byteRate: number | null = null;
    let bitsPerSample: number | null = null;
    let dataBytes: number | null = null;

    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const dataOffset = offset + 8;

        if (chunkId === 'fmt ' && chunkSize >= 16 && dataOffset + 16 <= buffer.length) {
            formatTag = buffer.readUInt16LE(dataOffset);
            channels = buffer.readUInt16LE(dataOffset + 2);
            sampleRateHz = buffer.readUInt32LE(dataOffset + 4);
            byteRate = buffer.readUInt32LE(dataOffset + 8);
            bitsPerSample = buffer.readUInt16LE(dataOffset + 14);
        } else if (chunkId === 'data') {
            dataBytes = Math.min(chunkSize, buffer.length - dataOffset);
        }

        offset = dataOffset + chunkSize + (chunkSize % 2);
    }

    const durationSeconds =
        dataBytes !== null && byteRate && byteRate > 0
            ? dataBytes / byteRate
            : null;

    return {
        path: file.path,
        format: 'wav',
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        durationSeconds: durationSeconds === null ? null : round(durationSeconds, 3),
        bitrateKbps: byteRate ? round(byteRate * 8 / 1000, 2) : null,
        sampleRateHz,
        channels,
        bitsPerSample,
        codec: formatTag === 1 ? 'PCM' : formatTag === 3 ? 'IEEE float' : formatTag ? `WAVE format ${formatTag}` : null,
        metadataConfidence: 'high',
        notes: [],
    };
}

function parseOgg(
    file: FileRecord,
    buffer: Buffer,
): AudioInfo | null {
    if (buffer.toString('ascii', 0, 4) !== 'OggS') {
        return null;
    }

    let offset = 0;
    let lastGranule = 0;
    let sampleRateHz: number | null = null;
    let channels: number | null = null;
    let codec: string | null = null;

    while (offset + 27 <= buffer.length) {
        if (buffer.toString('ascii', offset, offset + 4) !== 'OggS') {
            offset += 1;
            continue;
        }

        const granule = readUInt64LEAsNumber(buffer, offset + 6);
        if (granule !== Number.MAX_SAFE_INTEGER && granule > lastGranule) {
            lastGranule = granule;
        }

        const segmentCount = buffer[offset + 26]!;
        const tableOffset = offset + 27;
        if (tableOffset + segmentCount > buffer.length) {
            break;
        }

        let bodyLength = 0;
        for (let index = 0; index < segmentCount; index += 1) {
            bodyLength += buffer[tableOffset + index]!;
        }

        const bodyOffset = tableOffset + segmentCount;
        if (bodyOffset + bodyLength > buffer.length) {
            break;
        }

        const packet = buffer.subarray(bodyOffset, bodyOffset + Math.min(bodyLength, 64));
        const vorbisIndex = packet.indexOf(Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]));
        if (vorbisIndex >= 0 && vorbisIndex + 16 <= packet.length) {
            codec = 'Vorbis';
            channels = packet[vorbisIndex + 11]!;
            sampleRateHz = packet.readUInt32LE(vorbisIndex + 12);
        }

        const opusIndex = packet.indexOf(Buffer.from('OpusHead', 'ascii'));
        if (opusIndex >= 0 && opusIndex + 12 <= packet.length) {
            codec = 'Opus';
            channels = packet[opusIndex + 9]!;
            sampleRateHz = 48000;
        }

        offset = bodyOffset + bodyLength;
    }

    const durationSeconds = sampleRateHz && lastGranule > 0
        ? lastGranule / sampleRateHz
        : null;

    return {
        path: file.path,
        format: codec === 'Opus' ? 'opus/ogg' : 'ogg',
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        durationSeconds: durationSeconds === null ? null : round(durationSeconds, 3),
        bitrateKbps:
            durationSeconds && durationSeconds > 0
                ? round(file.rawBytes * 8 / durationSeconds / 1000, 2)
                : null,
        sampleRateHz,
        channels,
        bitsPerSample: null,
        codec,
        metadataConfidence: durationSeconds ? 'high' : 'medium',
        notes: [],
    };
}

function parseAacAdts(
    file: FileRecord,
    buffer: Buffer,
): AudioInfo | null {
    const sampleRates = [
        96000, 88200, 64000, 48000, 44100, 32000, 24000,
        22050, 16000, 12000, 11025, 8000, 7350,
    ];

    let offset = 0;
    let frameCount = 0;
    let sampleRateHz: number | null = null;
    let channels: number | null = null;

    while (offset + 7 <= buffer.length) {
        if (
            buffer[offset] !== 0xff
            || (buffer[offset + 1]! & 0xf6) !== 0xf0
        ) {
            if (frameCount === 0) {
                offset += 1;
                continue;
            }
            break;
        }

        const sampleRateIndex = (buffer[offset + 2]! >>> 2) & 0x0f;
        const channelConfig =
            ((buffer[offset + 2]! & 0x01) << 2)
            | ((buffer[offset + 3]! >>> 6) & 0x03);
        const frameLength =
            ((buffer[offset + 3]! & 0x03) << 11)
            | (buffer[offset + 4]! << 3)
            | ((buffer[offset + 5]! >>> 5) & 0x07);

        if (frameLength < 7 || offset + frameLength > buffer.length) {
            break;
        }

        sampleRateHz ??= sampleRates[sampleRateIndex] ?? null;
        channels ??= channelConfig;
        frameCount += 1;
        offset += frameLength;
    }

    if (frameCount === 0 || !sampleRateHz) {
        return null;
    }

    const durationSeconds = frameCount * 1024 / sampleRateHz;

    return {
        path: file.path,
        format: 'aac-adts',
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        durationSeconds: round(durationSeconds, 3),
        bitrateKbps: round(file.rawBytes * 8 / durationSeconds / 1000, 2),
        sampleRateHz,
        channels,
        bitsPerSample: null,
        codec: 'AAC ADTS',
        metadataConfidence: 'high',
        notes: [`检测到 ${frameCount} 个 ADTS 帧`],
    };
}

function parseMp4Duration(buffer: Buffer): {
    durationSeconds: number | null;
    notes: string[];
} {
    let offset = 0;
    const notes: string[] = [];

    while (offset + 8 <= buffer.length) {
        let size = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        let headerSize = 8;

        if (size === 1 && offset + 16 <= buffer.length) {
            const bigSize = buffer.readBigUInt64BE(offset + 8);
            if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) {
                break;
            }
            size = Number(bigSize);
            headerSize = 16;
        } else if (size === 0) {
            size = buffer.length - offset;
        }

        if (size < headerSize || offset + size > buffer.length) {
            break;
        }

        if (type === 'moov') {
            const moovStart = offset + headerSize;
            const moovEnd = offset + size;
            let child = moovStart;

            while (child + 8 <= moovEnd) {
                const childSize = buffer.readUInt32BE(child);
                const childType = buffer.toString('ascii', child + 4, child + 8);
                if (childSize < 8 || child + childSize > moovEnd) {
                    break;
                }

                if (childType === 'mvhd') {
                    const version = buffer[child + 8]!;
                    if (version === 0 && child + 28 <= buffer.length) {
                        const timescale = buffer.readUInt32BE(child + 20);
                        const duration = buffer.readUInt32BE(child + 24);
                        if (timescale > 0) {
                            notes.push('时长来自 MP4 mvhd');
                            return {
                                durationSeconds: duration / timescale,
                                notes,
                            };
                        }
                    } else if (version === 1 && child + 40 <= buffer.length) {
                        const timescale = buffer.readUInt32BE(child + 28);
                        const duration = buffer.readBigUInt64BE(child + 32);
                        if (timescale > 0 && duration <= BigInt(Number.MAX_SAFE_INTEGER)) {
                            notes.push('时长来自 MP4 mvhd v1');
                            return {
                                durationSeconds: Number(duration) / timescale,
                                notes,
                            };
                        }
                    }
                }

                child += childSize;
            }
        }

        offset += size;
    }

    return {
        durationSeconds: null,
        notes: ['未解析到 MP4 mvhd 时长'],
    };
}

function analyzeAudio(
    file: FileRecord,
    buffer: Buffer,
): AudioInfo {
    const extension = file.extension;
    let parsed: AudioInfo | null = null;

    if (extension === '.wav') parsed = parseWav(file, buffer);
    else if (extension === '.mp3') parsed = parseMp3(file, buffer);
    else if (extension === '.ogg' || extension === '.oga' || extension === '.opus') parsed = parseOgg(file, buffer);
    else if (extension === '.aac') parsed = parseAacAdts(file, buffer);
    else if (extension === '.m4a' || extension === '.mp4') {
        const mp4 = parseMp4Duration(buffer);
        parsed = {
            path: file.path,
            format: extension.slice(1),
            rawBytes: file.rawBytes,
            singleBrotliBytes: file.singleBrotliBytes,
            durationSeconds: mp4.durationSeconds === null ? null : round(mp4.durationSeconds, 3),
            bitrateKbps:
                mp4.durationSeconds && mp4.durationSeconds > 0
                    ? round(file.rawBytes * 8 / mp4.durationSeconds / 1000, 2)
                    : null,
            sampleRateHz: null,
            channels: null,
            bitsPerSample: null,
            codec: 'MP4 container',
            metadataConfidence: mp4.durationSeconds ? 'medium' : 'low',
            notes: mp4.notes,
        };
    }

    return parsed ?? {
        path: file.path,
        format: extension.slice(1) || 'unknown',
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        durationSeconds: null,
        bitrateKbps: null,
        sampleRateHz: null,
        channels: null,
        bitsPerSample: null,
        codec: null,
        metadataConfidence: 'unknown',
        notes: ['音频元数据解析失败'],
    };
}

interface SfntTable {
    tag: string;
    offset: number;
    length: number;
}

function decodeUtf16Be(buffer: Buffer): string {
    if (buffer.length % 2 !== 0) {
        return '';
    }

    const swapped = Buffer.allocUnsafe(buffer.length);
    for (let index = 0; index < buffer.length; index += 2) {
        swapped[index] = buffer[index + 1]!;
        swapped[index + 1] = buffer[index]!;
    }

    return swapped.toString('utf16le').replace(/\0/g, '').trim();
}

function parseSfntName(
    buffer: Buffer,
    table: SfntTable | undefined,
): { family: string | null; subfamily: string | null } {
    if (!table || table.offset + 6 > buffer.length) {
        return { family: null, subfamily: null };
    }

    const count = buffer.readUInt16BE(table.offset + 2);
    const stringOffset = buffer.readUInt16BE(table.offset + 4);
    const recordsOffset = table.offset + 6;
    const stringsBase = table.offset + stringOffset;
    let family: string | null = null;
    let subfamily: string | null = null;

    for (let index = 0; index < count; index += 1) {
        const recordOffset = recordsOffset + index * 12;
        if (recordOffset + 12 > buffer.length) {
            break;
        }

        const platformId = buffer.readUInt16BE(recordOffset);
        const nameId = buffer.readUInt16BE(recordOffset + 6);
        const length = buffer.readUInt16BE(recordOffset + 8);
        const offset = buffer.readUInt16BE(recordOffset + 10);
        const start = stringsBase + offset;
        const end = start + length;

        if (end > buffer.length || (nameId !== 1 && nameId !== 2)) {
            continue;
        }

        const valueBuffer = buffer.subarray(start, end);
        const value = platformId === 0 || platformId === 3
            ? decodeUtf16Be(valueBuffer)
            : valueBuffer.toString('latin1').replace(/\0/g, '').trim();

        if (!value) {
            continue;
        }

        if (nameId === 1 && family === null) family = value;
        if (nameId === 2 && subfamily === null) subfamily = value;
    }

    return { family, subfamily };
}

function parseSfntFont(
    file: FileRecord,
    buffer: Buffer,
): FontInfo | null {
    if (buffer.length < 12) {
        return null;
    }

    const signature = buffer.toString('ascii', 0, 4);
    const valid =
        buffer.readUInt32BE(0) === 0x00010000
        || signature === 'OTTO'
        || signature === 'true'
        || signature === 'typ1';

    if (!valid) {
        return null;
    }

    const numTables = buffer.readUInt16BE(4);
    const tables = new Map<string, SfntTable>();

    for (let index = 0; index < numTables; index += 1) {
        const offset = 12 + index * 16;
        if (offset + 16 > buffer.length) {
            break;
        }

        const tag = buffer.toString('ascii', offset, offset + 4);
        const tableOffset = buffer.readUInt32BE(offset + 8);
        const length = buffer.readUInt32BE(offset + 12);

        if (tableOffset + length <= buffer.length) {
            tables.set(tag, {
                tag,
                offset: tableOffset,
                length,
            });
        }
    }

    const head = tables.get('head');
    const maxp = tables.get('maxp');
    const names = parseSfntName(buffer, tables.get('name'));

    const unitsPerEm =
        head && head.offset + 20 <= buffer.length
            ? buffer.readUInt16BE(head.offset + 18)
            : null;
    const glyphCount =
        maxp && maxp.offset + 6 <= buffer.length
            ? buffer.readUInt16BE(maxp.offset + 4)
            : null;

    return {
        path: file.path,
        format: signature === 'OTTO' ? 'otf-cff' : 'ttf-sfnt',
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        family: names.family,
        subfamily: names.subfamily,
        glyphCount,
        unitsPerEm,
        sfntSize: buffer.length,
        notes: [`SFNT tables: ${tables.size}`],
    };
}

function parseWoffFont(
    file: FileRecord,
    buffer: Buffer,
): FontInfo | null {
    const signature = buffer.toString('ascii', 0, 4);
    if (signature !== 'wOFF' && signature !== 'wOF2') {
        return null;
    }

    const numTables = buffer.length >= 14
        ? buffer.readUInt16BE(12)
        : null;
    const totalSfntSize = buffer.length >= 20
        ? buffer.readUInt32BE(16)
        : null;

    return {
        path: file.path,
        format: signature === 'wOFF' ? 'woff' : 'woff2',
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        family: null,
        subfamily: null,
        glyphCount: null,
        unitsPerEm: null,
        sfntSize: totalSfntSize,
        notes: [
            `WOFF tables: ${numTables ?? 'unknown'}`,
            '未解压 WOFF 表，因此不读取字形和名称',
        ],
    };
}

function analyzeFont(
    file: FileRecord,
    buffer: Buffer,
): FontInfo {
    return parseSfntFont(file, buffer)
        ?? parseWoffFont(file, buffer)
        ?? {
            path: file.path,
            format: file.extension.slice(1) || 'unknown',
            rawBytes: file.rawBytes,
            singleBrotliBytes: file.singleBrotliBytes,
            family: null,
            subfamily: null,
            glyphCount: null,
            unitsPerEm: null,
            sfntSize: null,
            notes: ['字体格式解析失败'],
        };
}

function readLeb128(
    buffer: Buffer,
    start: number,
): { value: number; next: number } | null {
    let value = 0;
    let shift = 0;
    let offset = start;

    while (offset < buffer.length && shift < 35) {
        const byte = buffer[offset]!;
        value |= (byte & 0x7f) << shift;
        offset += 1;

        if ((byte & 0x80) === 0) {
            return { value: value >>> 0, next: offset };
        }

        shift += 7;
    }

    return null;
}

function readWasmName(
    buffer: Buffer,
    start: number,
): { value: string; next: number } | null {
    const length = readLeb128(buffer, start);
    if (!length || length.next + length.value > buffer.length) {
        return null;
    }

    return {
        value: buffer.toString('utf8', length.next, length.next + length.value),
        next: length.next + length.value,
    };
}

function countWasmVectorEntries(
    buffer: Buffer,
    start: number,
): number | null {
    const count = readLeb128(buffer, start);
    return count?.value ?? null;
}

function analyzeWasm(
    file: FileRecord,
    buffer: Buffer,
): WasmInfo {
    const validWasm =
        buffer.length >= 8
        && buffer[0] === 0x00
        && buffer[1] === 0x61
        && buffer[2] === 0x73
        && buffer[3] === 0x6d;

    if (!validWasm) {
        return {
            path: file.path,
            rawBytes: file.rawBytes,
            singleBrotliBytes: file.singleBrotliBytes,
            validWasm: false,
            version: null,
            sectionCount: 0,
            customSectionBytes: 0,
            importCount: null,
            exportCount: null,
            customSectionNames: [],
            notes: ['WASM magic 不匹配'],
        };
    }

    const version = buffer.readUInt32LE(4);
    let offset = 8;
    let sectionCount = 0;
    let customSectionBytes = 0;
    let importCount: number | null = null;
    let exportCount: number | null = null;
    const customSectionNames: string[] = [];
    const notes: string[] = [];

    while (offset < buffer.length) {
        const sectionId = buffer[offset]!;
        offset += 1;
        const length = readLeb128(buffer, offset);
        if (!length) break;
        offset = length.next;
        const sectionStart = offset;
        const sectionEnd = sectionStart + length.value;
        if (sectionEnd > buffer.length) break;

        sectionCount += 1;

        if (sectionId === 0) {
            customSectionBytes += length.value;
            const name = readWasmName(buffer, sectionStart);
            if (name?.value) {
                customSectionNames.push(name.value);
            }
        } else if (sectionId === 2) {
            importCount = countWasmVectorEntries(buffer, sectionStart);
        } else if (sectionId === 7) {
            exportCount = countWasmVectorEntries(buffer, sectionStart);
        }

        offset = sectionEnd;
    }

    if (customSectionBytes > 0) {
        notes.push('自定义段可能包含 name/producers/source map 等可选数据');
    }

    return {
        path: file.path,
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        validWasm,
        version,
        sectionCount,
        customSectionBytes,
        importCount,
        exportCount,
        customSectionNames,
        notes,
    };
}

function countMatches(source: string, expression: RegExp): number {
    let count = 0;
    expression.lastIndex = 0;
    while (expression.exec(source)) {
        count += 1;
    }
    return count;
}

function analyzeJavaScript(
    file: FileRecord,
    buffer: Buffer,
): JavaScriptInfo {
    const source = buffer.toString('utf8');
    const lines = source.split(/\r?\n/);
    const lineCount = Math.max(1, lines.length);
    const averageLineLength = source.length / lineCount;
    const systemRegisterCount = countMatches(
        source,
        /\bSystem\.register\s*\(/g,
    );
    const systemRegisterNamedCount = countMatches(
        source,
        /\bSystem\.register\s*\(\s*["'`]/g,
    );
    const featureKeywords = [
        'bullet', 'ammo', 'spine', 'dragonbones', 'webgpu',
        'webxr', 'xr.', 'tiledmap', 'terrain', 'particle-system',
        'video-player', 'webview', 'physics-2d', 'box2d', 'cannon',
    ];
    const lower = source.toLowerCase();
    const featureMarkers = featureKeywords.filter(keyword => lower.includes(keyword));

    return {
        path: file.path,
        rawBytes: file.rawBytes,
        singleBrotliBytes: file.singleBrotliBytes,
        lineCount,
        averageLineLength: round(averageLineLength, 2),
        minifiedHeuristic:
            averageLineLength > 220
            || (lineCount < 100 && source.length > 100_000),
        consoleCallCount: countMatches(source, /\bconsole\.(?:log|warn|error|debug|info|trace)\s*\(/g),
        debuggerCount: countMatches(source, /\bdebugger\s*;/g),
        sourceMapReferenceCount: countMatches(source, /[#@]\s*sourceMappingURL=/g),
        asmJsMarkerCount: countMatches(source, /["']use asm["']/g),
        systemRegisterCount,
        systemRegisterNamedCount,
        systemRegisterAnonymousCount: Math.max(0, systemRegisterCount - systemRegisterNamedCount),
        debugMarkerCount: countMatches(source, /\b(?:DEBUG|DEV|EDITOR|PREVIEW|assert|debugOnly)\b/g),
        featureMarkers,
    };
}

function extractAssetId(filePath: string): string | null {
    const basename = path.posix.basename(filePath);
    const withoutExtension = basename.replace(/\.[^.]+$/, '');
    const beforeVariant = withoutExtension.split('@')[0] ?? withoutExtension;

    if (/^[0-9a-f]{8,9}$/i.test(beforeVariant)) {
        return beforeVariant.toLowerCase();
    }

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeVariant)) {
        return beforeVariant.toLowerCase();
    }

    return null;
}

function normalizedNameKey(filePath: string): string | null {
    const basename = path.posix.basename(filePath).toLowerCase();
    let stem = basename.replace(/\.[^.]+$/, '');
    stem = stem.replace(/@[0-9a-f]{4,}$/gi, '');
    stem = stem.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '');
    stem = stem.replace(/[-_.]?[0-9a-f]{8,}$/gi, '');
    stem = stem.replace(/[-_.]?(?:copy|backup|old|new|final|v\d+|\d+)$/gi, '');
    stem = stem.replace(/[-_.]+/g, '-').replace(/^-|-$/g, '');

    if (stem.length < 3) {
        return null;
    }

    return stem;
}

function buildSimilarNameGroups(files: FileRecord[]): SimilarNameGroup[] {
    const groups: SimilarNameGroup[] = [];
    const byAssetId = new Map<string, FileRecord[]>();
    const byNormalizedName = new Map<string, FileRecord[]>();

    for (const file of files) {
        const assetId = extractAssetId(file.path);
        if (assetId) {
            const list = byAssetId.get(assetId) ?? [];
            list.push(file);
            byAssetId.set(assetId, list);
        }

        const key = normalizedNameKey(file.path);
        if (key) {
            const list = byNormalizedName.get(key) ?? [];
            list.push(file);
            byNormalizedName.set(key, list);
        }
    }

    for (const [key, list] of byAssetId) {
        if (list.length < 2) continue;
        groups.push({
            key,
            kind: 'asset-id-variants',
            paths: list.map(file => file.path).sort(),
            rawBytes: list.reduce((sum, file) => sum + file.rawBytes, 0),
            extensions: [...new Set(list.map(file => file.extension))].sort(),
            note: '同一构建资源 ID 的多个 import/native/压缩纹理变体；不能仅凭名称判定可删除。',
        });
    }

    for (const [key, list] of byNormalizedName) {
        if (list.length < 2) continue;
        const uniquePaths = [...new Set(list.map(file => file.path))];
        if (uniquePaths.length < 2) continue;
        groups.push({
            key,
            kind: 'normalized-name',
            paths: uniquePaths.sort(),
            rawBytes: list.reduce((sum, file) => sum + file.rawBytes, 0),
            extensions: [...new Set(list.map(file => file.extension))].sort(),
            note: '文件名去除 UUID/hash/version 后相似，仅用于人工排查。',
        });
    }

    return groups
        .sort((a, b) => b.rawBytes - a.rawBytes)
        .slice(0, 200);
}

function buildDuplicateGroups(
    files: FileRecord[],
    buffers: Map<string, Buffer>,
): DuplicateGroup[] {
    const byHash = new Map<string, FileRecord[]>();

    for (const file of files) {
        const list = byHash.get(file.sha256) ?? [];
        list.push(file);
        byHash.set(file.sha256, list);
    }

    const groups: DuplicateGroup[] = [];

    for (const [hash, list] of byHash) {
        if (list.length < 2) continue;
        const firstBuffer = buffers.get(list[0]!.path)!;
        const repeatedBuffer = Buffer.concat(
            list.map(file => buffers.get(file.path)!),
        );
        const groupBefore = brotli(repeatedBuffer).byteLength;
        const groupAfter = brotli(firstBuffer).byteLength;
        const rawBytes = list.reduce((sum, file) => sum + file.rawBytes, 0);

        groups.push({
            sha256: hash,
            fileCount: list.length,
            paths: list.map(file => file.path).sort(),
            rawBytes,
            uniqueRawBytes: firstBuffer.byteLength,
            rawSavingsBytes: rawBytes - firstBuffer.byteLength,
            groupBrotliBeforeBytes: groupBefore,
            groupBrotliAfterBytes: groupAfter,
            groupBrotliSavingsBytes: Math.max(0, groupBefore - groupAfter),
            classification: 'safe',
            note: '可在打包归档层让多个 VFS 路径共享同一 offset/length；无需改 UUID 或引用。组内 Brotli 节省为独立测量，不等同完整 Solid 归档边际值。',
        });
    }

    return groups.sort((a, b) => b.rawSavingsBytes - a.rawSavingsBytes);
}

function extractReferenceTokens(file: FileRecord): string[] {
    const tokens = new Set<string>();
    const normalized = file.path.toLowerCase();
    const basename = file.basename.toLowerCase();
    const stem = file.stem.toLowerCase();
    const assetId = extractAssetId(file.path);

    tokens.add(normalized);
    tokens.add(basename);
    if (stem.length >= 8) tokens.add(stem);
    if (assetId) {
        tokens.add(assetId);
        tokens.add(assetId.replace(/-/g, ''));
    }

    const atParts = stem.split('@');
    for (const part of atParts) {
        if (part.length >= 5) tokens.add(part);
    }

    return [...tokens]
        .filter(token => token.length >= 5)
        .sort((a, b) => b.length - a.length);
}

function isUnreferencedCandidatePath(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    if (!lower.startsWith('assets/')) return false;
    if (lower.endsWith('/config.json') || lower.endsWith('/index.js')) return false;
    return lower.includes('/native/') || lower.includes('/import/');
}

function buildUnreferencedCandidates(
    files: FileRecord[],
    textCorpus: string,
): UnreferencedCandidate[] {
    const candidates: UnreferencedCandidate[] = [];

    for (const file of files) {
        if (!isUnreferencedCandidatePath(file.path)) continue;

        const tokens = extractReferenceTokens(file);
        const found = tokens.filter(token => textCorpus.includes(token));

        if (found.length > 0) continue;

        const isNativeMedia =
            IMAGE_EXTENSIONS.has(file.extension)
            || AUDIO_EXTENSIONS.has(file.extension)
            || FONT_EXTENSIONS.has(file.extension);

        candidates.push({
            path: file.path,
            rawBytes: file.rawBytes,
            singleBrotliBytes: file.singleBrotliBytes,
            estimatedSolidContributionBytes: file.estimatedSolidContributionBytes,
            extractedTokens: tokens,
            foundReferenceTokens: found,
            classification: isNativeMedia ? 'review' : 'risky',
            confidence: 'low',
            warning: '仅表示未在可扫描文本中发现路径/文件名/UUID 令牌；Cocos config 压缩 UUID、二进制依赖、动态加载和运行时代码都可能造成假阳性，禁止自动删除。',
        });
    }

    return candidates
        .sort((a, b) => b.estimatedSolidContributionBytes - a.estimatedSolidContributionBytes)
        .slice(0, UNREFERENCED_LIMIT);
}

function minifyJsonCandidate(
    buffer: Buffer,
): {
    minifiedRawBytes: number;
    minifiedBrotliBytes: number;
    rawSavingsBytes: number;
    brotliSavingsBytes: number;
} | null {
    try {
        const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
        const minified = Buffer.from(JSON.stringify(parsed), 'utf8');
        const originalBr = brotli(buffer).byteLength;
        const minifiedBr = brotli(minified).byteLength;

        return {
            minifiedRawBytes: minified.byteLength,
            minifiedBrotliBytes: minifiedBr,
            rawSavingsBytes: Math.max(0, buffer.byteLength - minified.byteLength),
            brotliSavingsBytes: Math.max(0, originalBr - minifiedBr),
        };
    } catch {
        return null;
    }
}

function sumBy<T>(items: T[], selector: (item: T) => number): number {
    return items.reduce((sum, item) => sum + selector(item), 0);
}

function buildExtensionSummaries(files: FileRecord[]): ExtensionSummary[] {
    const groups = new Map<string, FileRecord[]>();
    for (const file of files) {
        const list = groups.get(file.extension) ?? [];
        list.push(file);
        groups.set(file.extension, list);
    }

    const totalRaw = sumBy(files, file => file.rawBytes);
    const totalSolid = sumBy(files, file => file.estimatedSolidContributionBytes);

    return [...groups.entries()]
        .map(([extension, list]) => {
            const rawBytes = sumBy(list, file => file.rawBytes);
            const singleBrotliBytes = sumBy(list, file => file.singleBrotliBytes);
            const estimatedSolidContributionBytes = sumBy(
                list,
                file => file.estimatedSolidContributionBytes,
            );

            return {
                extension,
                fileCount: list.length,
                rawBytes,
                singleBrotliBytes,
                estimatedSolidContributionBytes,
                brotliRatio: percent(singleBrotliBytes, rawBytes),
                percentageOfRaw: percent(rawBytes, totalRaw),
                percentageOfEstimatedSolid: percent(
                    estimatedSolidContributionBytes,
                    totalSolid,
                ),
            };
        })
        .sort((a, b) => b.estimatedSolidContributionBytes - a.estimatedSolidContributionBytes);
}

function makeOpportunity(
    value: Opportunity,
): Opportunity {
    return value;
}

function buildOpportunities(args: {
    files: FileRecord[];
    images: ImageInfo[];
    audio: AudioInfo[];
    fonts: FontInfo[];
    wasm: WasmInfo[];
    javascript: JavaScriptInfo[];
    duplicateGroups: DuplicateGroup[];
    duplicateGlobalRawSavings: number;
    duplicateGlobalSolidSavings: number;
    unreferenced: UnreferencedCandidate[];
    similarNames: SimilarNameGroup[];
    jsonBenchmarks: Array<{
        path: string;
        rawBytes: number;
        singleBrotliBytes: number;
        minifiedRawBytes: number;
        minifiedBrotliBytes: number;
        rawSavingsBytes: number;
        brotliSavingsBytes: number;
    }>;
    bulletFiles: FileRecord[];
    spineFiles: FileRecord[];
    archiveRawBytes: number;
    deduplicatedArchiveRawBytes: number;
    solidBrotliBytes: number;
    deduplicatedSolidBrotliBytes: number;
}): Opportunity[] {
    const opportunities: Opportunity[] = [];

    if (args.duplicateGroups.length > 0) {
        opportunities.push(makeOpportunity({
            id: 'archive-exact-duplicate-aliasing',
            priority: 'P0',
            category: 'duplicate',
            classification: 'safe',
            title: '在 VFS 归档层合并完全相同的文件内容',
            paths: args.duplicateGroups.flatMap(group => group.paths).slice(0, 100),
            currentRawBytes: args.archiveRawBytes,
            estimatedAfterRawBytes: args.deduplicatedArchiveRawBytes,
            rawSavingsBytes: args.duplicateGlobalRawSavings,
            currentBrotliBytes: args.solidBrotliBytes,
            estimatedAfterBrotliBytes: args.deduplicatedSolidBrotliBytes,
            estimatedBrotliSavingsBytes: args.duplicateGlobalSolidSavings,
            estimateKind: 'measured',
            confidence: 'high',
            compatibilityRisk: '低；所有原路径仍保留，只共享同一归档字节区间。',
            functionalRisk: '低；实现时必须保证 MIME、offset、length 和缓存逻辑不变。',
            rationale: 'SHA-256 完全一致，可在打包阶段去重数据而不改 Cocos 资源引用。完整 Solid 去重收益已通过重新压缩去重后的归档测量。',
            nextAction: '下一阶段单独实现 packer 归档 alias 去重，并执行完整启动与资源回归。',
        }));
    }

    const unreferencedWorthReviewing = args.unreferenced.filter(
        item => item.estimatedSolidContributionBytes >= 1024,
    );
    if (unreferencedWorthReviewing.length > 0) {
        opportunities.push(makeOpportunity({
            id: 'possible-unreferenced-assets',
            priority: 'P0',
            category: 'unused-resource',
            classification: 'risky',
            title: '人工核验可能未引用的构建资源',
            paths: unreferencedWorthReviewing.map(item => item.path).slice(0, 100),
            currentRawBytes: sumBy(unreferencedWorthReviewing, item => item.rawBytes),
            estimatedAfterRawBytes: null,
            rawSavingsBytes: null,
            currentBrotliBytes: sumBy(unreferencedWorthReviewing, item => item.estimatedSolidContributionBytes),
            estimatedAfterBrotliBytes: null,
            estimatedBrotliSavingsBytes: null,
            estimateKind: 'unknown',
            confidence: 'low',
            compatibilityRisk: '低到中，取决于资源是否由动态路径、Bundle 或平台逻辑加载。',
            functionalRisk: '高；静态文本未命中不等于未使用，禁止自动删除。',
            rationale: '候选仅用于缩小人工排查范围，报告会保留令牌和风险说明。',
            nextAction: '回到 Creator 工程做依赖追踪、运行时资源访问日志和逐项删除验证。',
        }));
    }

    const opaqueLargePngs = args.images.filter(image =>
        image.format === 'png'
        && image.hasAlpha === 'no'
        && image.rawBytes >= 32 * 1024,
    );
    if (opaqueLargePngs.length > 0) {
        const currentRaw = sumBy(opaqueLargePngs, image => image.rawBytes);
        const currentBr = sumBy(opaqueLargePngs, image => image.singleBrotliBytes);
        const modelledAfter = Math.round(currentRaw * 0.42);
        const modelledBrAfter = Math.round(currentBr * 0.45);

        opportunities.push(makeOpportunity({
            id: 'opaque-png-format-benchmark',
            priority: 'P0',
            category: 'image',
            classification: 'review',
            title: '对无 Alpha 的大 PNG 实测 JPEG/WebP 转码',
            paths: opaqueLargePngs.map(image => image.path),
            currentRawBytes: currentRaw,
            estimatedAfterRawBytes: modelledAfter,
            rawSavingsBytes: currentRaw - modelledAfter,
            currentBrotliBytes: currentBr,
            estimatedAfterBrotliBytes: modelledBrAfter,
            estimatedBrotliSavingsBytes: currentBr - modelledBrAfter,
            estimateKind: 'modelled',
            confidence: 'low',
            compatibilityRisk: 'JPEG 兼容性高；WebP 需要按广告平台/WebView 最低版本确认。',
            functionalRisk: '中；有损压缩可能产生色带、文字边缘和 UI 伪影。',
            rationale: '这些 PNG 不含 Alpha 且 Brotli 基本无法继续压缩；模型值仅用于排序，不能作为验收数据。',
            nextAction: '使用 sharp/libvips 对每张图做多质量档实测，比较视觉质量、原始字节与重新 Solid Brotli 后字节。',
        }));
    }

    const largeAlphaPngs = args.images.filter(image =>
        image.format === 'png'
        && image.hasAlpha === 'yes'
        && image.rawBytes >= 48 * 1024,
    );
    if (largeAlphaPngs.length > 0) {
        const currentRaw = sumBy(largeAlphaPngs, image => image.rawBytes);
        const currentBr = sumBy(largeAlphaPngs, image => image.singleBrotliBytes);
        opportunities.push(makeOpportunity({
            id: 'alpha-png-lossless-benchmark',
            priority: 'P1',
            category: 'image',
            classification: 'review',
            title: '对大 Alpha PNG 实测无损重编码与尺寸下调',
            paths: largeAlphaPngs.map(image => image.path),
            currentRawBytes: currentRaw,
            estimatedAfterRawBytes: Math.round(currentRaw * 0.82),
            rawSavingsBytes: Math.round(currentRaw * 0.18),
            currentBrotliBytes: currentBr,
            estimatedAfterBrotliBytes: Math.round(currentBr * 0.84),
            estimatedBrotliSavingsBytes: Math.round(currentBr * 0.16),
            estimateKind: 'modelled',
            confidence: 'low',
            compatibilityRisk: '低；保持 PNG 时格式兼容性不变。',
            functionalRisk: '无损重编码低；降尺寸为中风险，可能影响清晰度和图集边缘。',
            rationale: 'Alpha PNG 通常是最终包体主要贡献者，但必须逐图实际编码后再判断。',
            nextAction: '分别测试 pngquant/oxipng/sharp，无损与有损方案分开记录。',
        }));
    }

    const textureVariantGroups = args.similarNames.filter(group =>
        group.kind === 'asset-id-variants'
        && group.extensions.some(extension => ['.astc', '.pkm', '.pvr'].includes(extension))
        && group.extensions.length >= 2,
    );
    if (textureVariantGroups.length > 0) {
        const paths = textureVariantGroups.flatMap(group => group.paths);
        const relatedFiles = args.files.filter(file => paths.includes(file.path));
        opportunities.push(makeOpportunity({
            id: 'multi-texture-format-review',
            priority: 'P0',
            category: 'image',
            classification: 'risky',
            title: '核验同一纹理的 PNG/ASTC/PKM/PVR 多格式是否全部需要',
            paths,
            currentRawBytes: sumBy(relatedFiles, file => file.rawBytes),
            estimatedAfterRawBytes: null,
            rawSavingsBytes: null,
            currentBrotliBytes: sumBy(relatedFiles, file => file.estimatedSolidContributionBytes),
            estimatedAfterBrotliBytes: null,
            estimatedBrotliSavingsBytes: null,
            estimateKind: 'unknown',
            confidence: 'medium',
            compatibilityRisk: '高；删除回退格式可能导致特定 GPU/WebView 无法加载纹理。',
            functionalRisk: '高；必须先确认 Creator 构建目标、纹理压缩配置与运行时选择逻辑。',
            rationale: '相同资源 ID 同时存在多种 GPU 压缩格式和普通图片，是明确值得审计的构建输出。',
            nextAction: '在目标广告平台设备矩阵上记录实际选择的纹理格式，再决定构建侧裁剪。',
        }));
    }

    if (args.fonts.length > 0) {
        const currentRaw = sumBy(args.fonts, font => font.rawBytes);
        const currentBr = sumBy(args.fonts, font => font.singleBrotliBytes);
        opportunities.push(makeOpportunity({
            id: 'font-subsetting',
            priority: 'P1',
            category: 'font',
            classification: 'review',
            title: '按实际字符集对子集化字体并审计未使用字重',
            paths: args.fonts.map(font => font.path),
            currentRawBytes: currentRaw,
            estimatedAfterRawBytes: Math.round(currentRaw * 0.30),
            rawSavingsBytes: Math.round(currentRaw * 0.70),
            currentBrotliBytes: currentBr,
            estimatedAfterBrotliBytes: Math.round(currentBr * 0.38),
            estimatedBrotliSavingsBytes: Math.round(currentBr * 0.62),
            estimateKind: 'modelled',
            confidence: 'medium',
            compatibilityRisk: '低；继续输出 TTF/WOFF 时浏览器兼容性不变。',
            functionalRisk: '中；漏字符会出现 tofu 方框，动态文案和多语言必须纳入字符集。',
            rationale: '字体通常包含大量 Playable 不会使用的字形；当前报告中字体 Brotli 后仍占明显体积。',
            nextAction: '先收集代码、Prefab、JSON 和运行时文案字符集，再用 fonttools/pyftsubset 生成候选并做全流程截图验证。',
        }));
    }

    const highBitrateAudio = args.audio.filter(audio =>
        audio.bitrateKbps !== null
        && audio.bitrateKbps >= 96
        && audio.rawBytes >= 16 * 1024,
    );
    if (highBitrateAudio.length > 0) {
        const currentRaw = sumBy(highBitrateAudio, audio => audio.rawBytes);
        const currentBr = sumBy(highBitrateAudio, audio => audio.singleBrotliBytes);
        opportunities.push(makeOpportunity({
            id: 'audio-bitrate-reencode',
            priority: 'P1',
            category: 'audio',
            classification: 'review',
            title: '对高码率音频实测降码率、单声道和裁剪静音',
            paths: highBitrateAudio.map(audio => audio.path),
            currentRawBytes: currentRaw,
            estimatedAfterRawBytes: Math.round(currentRaw * 0.58),
            rawSavingsBytes: Math.round(currentRaw * 0.42),
            currentBrotliBytes: currentBr,
            estimatedAfterBrotliBytes: Math.round(currentBr * 0.60),
            estimatedBrotliSavingsBytes: Math.round(currentBr * 0.40),
            estimateKind: 'modelled',
            confidence: 'low',
            compatibilityRisk: 'MP3 兼容性高；改 Opus/AAC 需按平台确认。',
            functionalRisk: '中；循环点、瞬态音效、声道信息和音质可能受影响。',
            rationale: 'MP3/OGG 已压缩，Brotli 收益有限，必须直接优化编码参数。',
            nextAction: '用 ffmpeg 生成多档候选，逐条试听并重新测量 Solid Brotli。',
        }));
    }

    const usefulJsonMinification = args.jsonBenchmarks.filter(item => item.brotliSavingsBytes >= 256);
    if (usefulJsonMinification.length > 0) {
        opportunities.push(makeOpportunity({
            id: 'json-whitespace-minification',
            priority: 'P1',
            category: 'data',
            classification: 'safe',
            title: '压缩含冗余空白的 JSON',
            paths: usefulJsonMinification.map(item => item.path),
            currentRawBytes: sumBy(usefulJsonMinification, item => item.rawBytes),
            estimatedAfterRawBytes: sumBy(usefulJsonMinification, item => item.minifiedRawBytes),
            rawSavingsBytes: sumBy(usefulJsonMinification, item => item.rawSavingsBytes),
            currentBrotliBytes: sumBy(usefulJsonMinification, item => item.singleBrotliBytes),
            estimatedAfterBrotliBytes: sumBy(usefulJsonMinification, item => item.minifiedBrotliBytes),
            estimatedBrotliSavingsBytes: sumBy(usefulJsonMinification, item => item.brotliSavingsBytes),
            estimateKind: 'measured',
            confidence: 'high',
            compatibilityRisk: '低；标准 JSON 语义不变。',
            functionalRisk: '低；但 Cocos 生成数据仍应在构建后副本上处理并回归。',
            rationale: '报告中的收益来自实际 JSON.parse/stringify 和 Brotli Q11 对比。',
            nextAction: '仅处理报告确认有实际 Brotli 收益的 JSON，并验证加载与哈希。',
        }));
    }

    const debugJs = args.javascript.filter(item =>
        item.consoleCallCount > 0
        || item.debuggerCount > 0
        || item.sourceMapReferenceCount > 0,
    );
    if (debugJs.length > 0) {
        opportunities.push(makeOpportunity({
            id: 'javascript-debug-code-audit',
            priority: 'P1',
            category: 'javascript',
            classification: 'review',
            title: '审计 console、debugger、source map 注释与开发分支',
            paths: debugJs.map(item => item.path),
            currentRawBytes: sumBy(debugJs, item => item.rawBytes),
            estimatedAfterRawBytes: null,
            rawSavingsBytes: null,
            currentBrotliBytes: sumBy(debugJs, item => item.singleBrotliBytes),
            estimatedAfterBrotliBytes: null,
            estimatedBrotliSavingsBytes: null,
            estimateKind: 'unknown',
            confidence: 'medium',
            compatibilityRisk: '低。',
            functionalRisk: '中；日志调用可能带副作用，不能简单正则删除。',
            rationale: '调试标记是构建配置和第三方库裁剪的重要线索，但需要 AST 级处理。',
            nextAction: '先区分业务日志、引擎日志和平台 SDK 日志，再用 terser/esbuild 定向消除。',
        }));
    }

    const wasmCustomBytes = sumBy(args.wasm, item => item.customSectionBytes);
    if (wasmCustomBytes >= 1024) {
        opportunities.push(makeOpportunity({
            id: 'wasm-custom-section-strip',
            priority: 'P1',
            category: 'wasm',
            classification: 'review',
            title: '核验 WASM 自定义段是否可剥离',
            paths: args.wasm.filter(item => item.customSectionBytes > 0).map(item => item.path),
            currentRawBytes: sumBy(args.wasm, item => item.rawBytes),
            estimatedAfterRawBytes: sumBy(args.wasm, item => item.rawBytes - item.customSectionBytes),
            rawSavingsBytes: wasmCustomBytes,
            currentBrotliBytes: sumBy(args.wasm, item => item.singleBrotliBytes),
            estimatedAfterBrotliBytes: null,
            estimatedBrotliSavingsBytes: null,
            estimateKind: 'unknown',
            confidence: 'medium',
            compatibilityRisk: '低，前提是仅删除 name/producers 等非运行段。',
            functionalRisk: '中；必须使用 wasm-tools/wasm-opt 并验证模块加载。',
            rationale: 'WASM 自定义段不是执行必需内容，但压缩后收益需实际测试。',
            nextAction: '复制文件后使用 wasm-strip/wasm-opt 处理，再重新打包验证 Bullet/Spine。',
        }));
    }

    const bulletExtensions = new Set(args.bulletFiles.map(file => file.extension));
    if (args.bulletFiles.length > 1 && bulletExtensions.size > 1) {
        opportunities.push(makeOpportunity({
            id: 'bullet-implementation-audit',
            priority: 'P1',
            category: 'engine',
            classification: 'risky',
            title: '核验 Bullet WASM/ASM/JS 回退实现是否重复打包',
            paths: args.bulletFiles.map(file => file.path),
            currentRawBytes: sumBy(args.bulletFiles, file => file.rawBytes),
            estimatedAfterRawBytes: null,
            rawSavingsBytes: null,
            currentBrotliBytes: sumBy(args.bulletFiles, file => file.estimatedSolidContributionBytes),
            estimatedAfterBrotliBytes: null,
            estimatedBrotliSavingsBytes: null,
            estimateKind: 'unknown',
            confidence: 'medium',
            compatibilityRisk: '高；移除回退实现可能影响禁用 WASM、CSP 或旧 WebView。',
            functionalRisk: '高；物理初始化失败会直接阻断游戏。',
            rationale: '文件名和内容标记显示存在多个 Bullet 相关实现，值得结合实际启动路径确认。',
            nextAction: '在目标平台记录实际加载文件和失败回退路径，再做平台定向构建。',
        }));
    }

    const spineExtensions = new Set(args.spineFiles.map(file => file.extension));
    if (args.spineFiles.length > 1 && spineExtensions.size > 1) {
        opportunities.push(makeOpportunity({
            id: 'spine-implementation-audit',
            priority: 'P1',
            category: 'engine',
            classification: 'risky',
            title: '核验 Spine WASM/JS 实现与运行时数据是否重复',
            paths: args.spineFiles.map(file => file.path),
            currentRawBytes: sumBy(args.spineFiles, file => file.rawBytes),
            estimatedAfterRawBytes: null,
            rawSavingsBytes: null,
            currentBrotliBytes: sumBy(args.spineFiles, file => file.estimatedSolidContributionBytes),
            estimatedAfterBrotliBytes: null,
            estimatedBrotliSavingsBytes: null,
            estimateKind: 'unknown',
            confidence: 'medium',
            compatibilityRisk: '高；不同 Spine 版本和 WASM 支持矩阵可能不同。',
            functionalRisk: '高；会导致骨骼动画无法加载或版本不匹配。',
            rationale: '仅凭文件存在不能判定重复，必须结合 import-map、模块依赖和运行时访问。',
            nextAction: '记录 Spine 初始化和资源加载路径，确认唯一实现后再裁剪。',
        }));
    }

    opportunities.push(makeOpportunity({
        id: 'cocos-engine-feature-build-audit',
        priority: 'P1',
        category: 'engine',
        classification: 'review',
        title: '回到 Cocos Creator 构建设置审计未使用引擎功能模块',
        paths: args.javascript
            .filter(item => item.featureMarkers.length > 0)
            .map(item => item.path),
        currentRawBytes: sumBy(args.javascript, item => item.rawBytes),
        estimatedAfterRawBytes: null,
        rawSavingsBytes: null,
        currentBrotliBytes: sumBy(args.javascript, item => item.singleBrotliBytes),
        estimatedAfterBrotliBytes: null,
        estimatedBrotliSavingsBytes: null,
        estimateKind: 'unknown',
        confidence: 'low',
        compatibilityRisk: '取决于裁剪模块。',
        functionalRisk: '高；构建后单文件分析无法可靠证明模块未使用。',
        rationale: '引擎代码通常已合并进大 JS，最终裁剪应优先在 Creator 功能裁剪/构建配置层完成，而不是对产物做正则删除。',
        nextAction: '根据报告中的 featureMarkers 与项目实际组件清单，逐项关闭引擎模块后重新构建和对比。',
    }));

    opportunities.push(makeOpportunity({
        id: 'experimental-text-encoding',
        priority: 'P2',
        category: 'container',
        classification: 'ignore',
        title: '暂不改变 Base64/Brotli 容器编码',
        paths: [],
        currentRawBytes: 0,
        estimatedAfterRawBytes: null,
        rawSavingsBytes: null,
        currentBrotliBytes: 0,
        estimatedAfterBrotliBytes: null,
        estimatedBrotliSavingsBytes: null,
        estimateKind: 'unknown',
        confidence: 'high',
        compatibilityRisk: 'Safe Base91/Base122 会增加解码和平台兼容风险。',
        functionalRisk: '中到高。',
        rationale: '当前阶段资源与引擎裁剪的收益优先级更高，保持稳定 Base64/Brotli 流程。',
        nextAction: '只有资源侧收益耗尽后再重新评估。',
    }));

    const classOrder: Record<CandidateClass, number> = {
        safe: 0,
        review: 1,
        risky: 2,
        ignore: 3,
    };
    const priorityOrder: Record<Priority, number> = {
        P0: 0,
        P1: 1,
        P2: 2,
    };

    return opportunities.sort((a, b) =>
        priorityOrder[a.priority] - priorityOrder[b.priority]
        || classOrder[a.classification] - classOrder[b.classification]
        || (b.estimatedBrotliSavingsBytes ?? -1) - (a.estimatedBrotliSavingsBytes ?? -1),
    );
}

function publicFileRecord(
    file: FileRecord,
): Omit<FileRecord, 'absolutePath'> & {
    rawSize: string;
    singleBrotliSize: string;
    estimatedSolidContributionSize: string;
} {
    const { absolutePath: _absolutePath, ...rest } = file;
    return {
        ...rest,
        rawSize: formatBytes(file.rawBytes),
        singleBrotliSize: formatBytes(file.singleBrotliBytes),
        estimatedSolidContributionSize:
            formatBytes(file.estimatedSolidContributionBytes),
    };
}

async function main(): Promise<void> {
    const inputDirectory = process.argv[2] ?? './web-mobile';
    const outputFile = process.argv[3]
        ?? './resource-optimization-report.json';
    const root = path.resolve(inputDirectory);
    const absoluteOutput = path.resolve(outputFile);
    const startedAt = performance.now();

    const paths: string[] = [];
    await walkDirectory(root, root, paths);
    paths.sort();

    if (paths.length === 0) {
        throw new Error(`输入目录没有文件：${root}`);
    }

    const buffers = new Map<string, Buffer>();
    for (const relativePath of paths) {
        buffers.set(
            relativePath,
            await readFile(path.join(root, relativePath)),
        );
    }

    console.log(`扫描文件：${paths.length}`);
    console.log('正在执行逐文件 Brotli Q11 分析...');

    const files: FileRecord[] = [];
    let totalSingleBrotliBytes = 0;

    for (let index = 0; index < paths.length; index += 1) {
        const relativePath = paths[index]!;
        const buffer = buffers.get(relativePath)!;
        const extension = path.extname(relativePath).toLowerCase() || '[no-extension]';
        const brBytes = brotli(buffer).byteLength;
        totalSingleBrotliBytes += brBytes;

        files.push({
            path: relativePath,
            absolutePath: path.join(root, relativePath),
            extension,
            basename: path.posix.basename(relativePath),
            stem: path.posix.basename(relativePath).replace(/\.[^.]+$/, ''),
            rawBytes: buffer.byteLength,
            singleBrotliBytes: brBytes,
            brotliRatio: percent(brBytes, buffer.byteLength),
            sha256: sha256(buffer),
            estimatedSolidContributionBytes: 0,
            archiveIncluded: !SOLID_EXCLUDED_FILES.has(relativePath),
            textual: TEXT_EXTENSIONS.has(extension),
        });

        if ((index + 1) % 50 === 0 || index + 1 === paths.length) {
            console.log(`  已分析 ${index + 1}/${paths.length}`);
        }
    }

    const archiveFiles = files.filter(file => file.archiveIncluded);
    const archiveRawBuffer = Buffer.concat(
        archiveFiles.map(file => buffers.get(file.path)!),
    );

    console.log('正在执行输入资源 Solid Brotli Q11 基线...');
    const solidStartedAt = performance.now();
    const solidBrotliBytes = brotli(archiveRawBuffer).byteLength;
    const solidElapsedMs = performance.now() - solidStartedAt;

    const archiveSingleBrotliTotal = sumBy(
        archiveFiles,
        file => file.singleBrotliBytes,
    );

    for (const file of archiveFiles) {
        file.estimatedSolidContributionBytes =
            archiveSingleBrotliTotal > 0
                ? Math.round(
                    solidBrotliBytes
                    * file.singleBrotliBytes
                    / archiveSingleBrotliTotal,
                )
                : 0;
    }

    const duplicateGroups = buildDuplicateGroups(files, buffers);
    const firstPathByHash = new Map<string, string>();
    const dedupArchiveParts: Buffer[] = [];

    for (const file of archiveFiles) {
        if (firstPathByHash.has(file.sha256)) {
            continue;
        }
        firstPathByHash.set(file.sha256, file.path);
        dedupArchiveParts.push(buffers.get(file.path)!);
    }

    const dedupArchiveRawBuffer = Buffer.concat(dedupArchiveParts);
    let dedupSolidBrotliBytes = solidBrotliBytes;

    if (dedupArchiveRawBuffer.byteLength < archiveRawBuffer.byteLength) {
        console.log('正在测量完整 Solid 归档的重复内容去重收益...');
        dedupSolidBrotliBytes = brotli(dedupArchiveRawBuffer).byteLength;
    }

    const images: ImageInfo[] = [];
    const audio: AudioInfo[] = [];
    const fonts: FontInfo[] = [];
    const wasm: WasmInfo[] = [];
    const javascript: JavaScriptInfo[] = [];
    const jsonBenchmarks: Array<{
        path: string;
        rawBytes: number;
        singleBrotliBytes: number;
        minifiedRawBytes: number;
        minifiedBrotliBytes: number;
        rawSavingsBytes: number;
        brotliSavingsBytes: number;
    }> = [];

    for (const file of files) {
        const buffer = buffers.get(file.path)!;

        if (IMAGE_EXTENSIONS.has(file.extension)) {
            const image = analyzeImage(file, buffer);
            if (image) images.push(image);
        }

        if (AUDIO_EXTENSIONS.has(file.extension)) {
            audio.push(analyzeAudio(file, buffer));
        }

        if (FONT_EXTENSIONS.has(file.extension)) {
            fonts.push(analyzeFont(file, buffer));
        }

        if (file.extension === '.wasm') {
            wasm.push(analyzeWasm(file, buffer));
        }

        if (file.extension === '.js' || file.extension === '.mjs') {
            javascript.push(analyzeJavaScript(file, buffer));
        }

        if (file.extension === '.json' && file.rawBytes >= 1024) {
            const benchmark = minifyJsonCandidate(buffer);
            if (benchmark) {
                jsonBenchmarks.push({
                    path: file.path,
                    rawBytes: file.rawBytes,
                    singleBrotliBytes: file.singleBrotliBytes,
                    ...benchmark,
                });
            }
        }
    }

    images.sort((a, b) => b.singleBrotliBytes - a.singleBrotliBytes);
    audio.sort((a, b) => b.singleBrotliBytes - a.singleBrotliBytes);
    fonts.sort((a, b) => b.singleBrotliBytes - a.singleBrotliBytes);
    wasm.sort((a, b) => b.singleBrotliBytes - a.singleBrotliBytes);
    javascript.sort((a, b) => b.singleBrotliBytes - a.singleBrotliBytes);
    jsonBenchmarks.sort((a, b) => b.brotliSavingsBytes - a.brotliSavingsBytes);

    const textParts: string[] = [];
    let textBytes = 0;
    for (const file of files) {
        if (!file.textual || textBytes >= TEXT_SCAN_LIMIT_BYTES) continue;
        const source = buffers.get(file.path)!.toString('utf8').toLowerCase();
        textParts.push(source);
        textBytes += Buffer.byteLength(source);
    }
    const textCorpus = textParts.join('\n');

    const unreferenced = buildUnreferencedCandidates(files, textCorpus);
    const similarNames = buildSimilarNameGroups(files);

    const lowerTextByPath = new Map<string, string>();
    for (const file of files) {
        if (file.textual) {
            lowerTextByPath.set(
                file.path,
                buffers.get(file.path)!.toString('utf8').toLowerCase(),
            );
        }
    }

    const bulletFiles = files.filter(file =>
        /bullet|ammo/i.test(file.path)
        || (lowerTextByPath.get(file.path)?.includes('bullet') ?? false)
        || (lowerTextByPath.get(file.path)?.includes('ammo') ?? false),
    );
    const spineFiles = files.filter(file =>
        /spine/i.test(file.path)
        || (lowerTextByPath.get(file.path)?.includes('spine') ?? false),
    );
    const asmFiles = javascript.filter(item =>
        item.asmJsMarkerCount > 0
        || /asm(?:\.min)?\.js$/i.test(item.path)
        || /bullet|ammo/i.test(item.path),
    );

    const totalRawBytes = sumBy(files, file => file.rawBytes);
    const archiveRawBytes = archiveRawBuffer.byteLength;
    const duplicateGlobalRawSavings =
        archiveRawBuffer.byteLength - dedupArchiveRawBuffer.byteLength;
    const duplicateGlobalSolidSavings =
        Math.max(0, solidBrotliBytes - dedupSolidBrotliBytes);

    const opportunities = buildOpportunities({
        files,
        images,
        audio,
        fonts,
        wasm,
        javascript,
        duplicateGroups,
        duplicateGlobalRawSavings,
        duplicateGlobalSolidSavings,
        unreferenced,
        similarNames,
        jsonBenchmarks,
        bulletFiles,
        spineFiles,
        archiveRawBytes: archiveRawBuffer.byteLength,
        deduplicatedArchiveRawBytes: dedupArchiveRawBuffer.byteLength,
        solidBrotliBytes,
        deduplicatedSolidBrotliBytes: dedupSolidBrotliBytes,
    });

    const largestRawFiles = [...files]
        .sort((a, b) => b.rawBytes - a.rawBytes)
        .slice(0, TOP_LIMIT)
        .map(publicFileRecord);
    const largestSingleBrotliFiles = [...files]
        .sort((a, b) => b.singleBrotliBytes - a.singleBrotliBytes)
        .slice(0, TOP_LIMIT)
        .map(publicFileRecord);
    const poorestCompressionFiles = [...files]
        .filter(file => file.rawBytes >= 1024)
        .sort((a, b) => b.brotliRatio - a.brotliRatio || b.rawBytes - a.rawBytes)
        .slice(0, TOP_LIMIT)
        .map(publicFileRecord);
    const compressedContributionRanking = [...archiveFiles]
        .sort((a, b) => b.estimatedSolidContributionBytes - a.estimatedSolidContributionBytes)
        .slice(0, TOP_LIMIT)
        .map(publicFileRecord);

    const binaryDataFiles = files
        .filter(file => ['.bin', '.cconb'].includes(file.extension))
        .sort((a, b) => b.singleBrotliBytes - a.singleBrotliBytes)
        .slice(0, TOP_LIMIT)
        .map(publicFileRecord);
    const jsonDataFiles = files
        .filter(file => file.extension === '.json')
        .sort((a, b) => b.singleBrotliBytes - a.singleBrotliBytes)
        .slice(0, TOP_LIMIT)
        .map(publicFileRecord);

    const report = {
        generatedAt: new Date().toISOString(),
        schemaVersion: 1,
        analyzerVersion: ANALYZER_VERSION,
        root,
        output: absoluteOutput,
        settings: {
            brotliQuality: 11,
            solidExcludedFiles: [...SOLID_EXCLUDED_FILES],
            topLimit: TOP_LIMIT,
            textScanLimitBytes: TEXT_SCAN_LIMIT_BYTES,
            notes: [
                '逐文件 Brotli 用于比较单文件压缩特征。',
                'Solid 贡献不是可直接观测的独立值；本报告按单文件 Brotli 权重分摊完整 Solid 大小，仅用于排序。',
                'Solid 基线使用原始构建文件，不执行 pack-compressed.ts 的 JS System.register 命名转换，因此与最终 pack:br 字节数可能有小幅差异。',
                '任何无引用候选都禁止自动删除。',
            ],
        },
        summary: {
            fileCount: files.length,
            archiveFileCount: archiveFiles.length,
            shellFileCount: files.length - archiveFiles.length,
            totalRawBytes,
            totalRawSize: formatBytes(totalRawBytes),
            archiveRawBytes,
            archiveRawSize: formatBytes(archiveRawBytes),
            totalSingleBrotliBytes,
            totalSingleBrotliSize: formatBytes(totalSingleBrotliBytes),
            solidBrotliBytes,
            solidBrotliSize: formatBytes(solidBrotliBytes),
            solidBrotliRatio: percent(solidBrotliBytes, archiveRawBytes),
            estimatedSolidBase64Bytes: Math.ceil(solidBrotliBytes / 3) * 4,
            estimatedSolidBase64Size: formatBytes(Math.ceil(solidBrotliBytes / 3) * 4),
            duplicateFileGroupCount: duplicateGroups.length,
            duplicateRawSavingsBytes: duplicateGlobalRawSavings,
            duplicateRawSavingsSize: formatBytes(duplicateGlobalRawSavings),
            deduplicatedSolidBrotliBytes: dedupSolidBrotliBytes,
            deduplicatedSolidBrotliSize: formatBytes(dedupSolidBrotliBytes),
            duplicateSolidBrotliSavingsBytes: duplicateGlobalSolidSavings,
            duplicateSolidBrotliSavingsSize: formatBytes(duplicateGlobalSolidSavings),
            imageCount: images.length,
            audioCount: audio.length,
            fontCount: fonts.length,
            wasmCount: wasm.length,
            javascriptCount: javascript.length,
            possibleUnreferencedCount: unreferenced.length,
            analysisTimeMs: round(performance.now() - startedAt, 2),
            solidCompressionTimeMs: round(solidElapsedMs, 2),
        },
        extensionDistribution: buildExtensionSummaries(files),
        largestRawFiles,
        largestSingleBrotliFiles,
        poorestCompressionFiles,
        compressedContributionRanking: {
            allocationMethod: '完整 Solid Brotli 字节数 × 单文件 Brotli 字节权重 / 所有归档文件单文件 Brotli 字节总和',
            warning: '这是排序估算，不是 leave-one-out 边际压缩收益。跨文件重复、窗口距离和文件顺序会改变真实贡献。',
            files: compressedContributionRanking,
        },
        duplicates: {
            globalMeasurement: {
                originalArchiveRawBytes: archiveRawBuffer.byteLength,
                deduplicatedArchiveRawBytes: dedupArchiveRawBuffer.byteLength,
                rawSavingsBytes: duplicateGlobalRawSavings,
                originalSolidBrotliBytes: solidBrotliBytes,
                deduplicatedSolidBrotliBytes: dedupSolidBrotliBytes,
                solidBrotliSavingsBytes: duplicateGlobalSolidSavings,
                measurement: '对完整原始输入归档与去重输入归档分别执行 Brotli Q11。',
            },
            groups: duplicateGroups,
        },
        similarNames,
        images: {
            count: images.length,
            totalRawBytes: sumBy(images, image => image.rawBytes),
            totalSingleBrotliBytes: sumBy(images, image => image.singleBrotliBytes),
            files: images,
        },
        audio: {
            count: audio.length,
            totalRawBytes: sumBy(audio, item => item.rawBytes),
            totalSingleBrotliBytes: sumBy(audio, item => item.singleBrotliBytes),
            files: audio,
        },
        fonts: {
            count: fonts.length,
            totalRawBytes: sumBy(fonts, item => item.rawBytes),
            totalSingleBrotliBytes: sumBy(fonts, item => item.singleBrotliBytes),
            files: fonts,
        },
        javascript: {
            count: javascript.length,
            totalRawBytes: sumBy(javascript, item => item.rawBytes),
            totalSingleBrotliBytes: sumBy(javascript, item => item.singleBrotliBytes),
            files: javascript,
        },
        wasm: {
            count: wasm.length,
            totalRawBytes: sumBy(wasm, item => item.rawBytes),
            totalSingleBrotliBytes: sumBy(wasm, item => item.singleBrotliBytes),
            files: wasm,
        },
        asm: {
            count: asmFiles.length,
            files: asmFiles,
        },
        engineAndRuntime: {
            bulletFiles: bulletFiles.map(publicFileRecord),
            spineFiles: spineFiles.map(publicFileRecord),
            notes: [
                '按路径和文本关键词识别，仅用于审计线索。',
                '存在多个相关文件不代表它们一定是可互换的重复实现。',
            ],
        },
        dataFiles: {
            largestJson: jsonDataFiles,
            largestBinAndCconb: binaryDataFiles,
            jsonMinificationBenchmarks: jsonBenchmarks.slice(0, TOP_LIMIT),
            warning: 'BIN/CCONB 未做结构重写；只做大小、哈希和 Brotli 分析。',
        },
        possibleUnreferencedResources: {
            methodology: '扫描最多 32 MB 文本内容，查找完整路径、basename、stem、UUID/资源 ID 和 @variant 令牌。',
            warning: 'Cocos 压缩 UUID、config 索引、二进制依赖和动态加载会产生假阳性。所有结果均需人工确认。',
            candidates: unreferenced,
        },
        opportunities: opportunities.map(item => ({
            ...item,
            sizes: {
                currentRaw: formatBytes(item.currentRawBytes),
                estimatedAfterRaw:
                    item.estimatedAfterRawBytes === null
                        ? null
                        : formatBytes(item.estimatedAfterRawBytes),
                rawSavings:
                    item.rawSavingsBytes === null
                        ? null
                        : formatBytes(item.rawSavingsBytes),
                currentBrotli: formatBytes(item.currentBrotliBytes),
                estimatedAfterBrotli:
                    item.estimatedAfterBrotliBytes === null
                        ? null
                        : formatBytes(item.estimatedAfterBrotliBytes),
                estimatedBrotliSavings:
                    item.estimatedBrotliSavingsBytes === null
                        ? null
                        : formatBytes(item.estimatedBrotliSavingsBytes),
            },
        })),
        priorityPlan: {
            P0: opportunities.filter(item => item.priority === 'P0').map(item => ({
                id: item.id,
                classification: item.classification,
                title: item.title,
                estimatedBrotliSavingsBytes: item.estimatedBrotliSavingsBytes,
            })),
            P1: opportunities.filter(item => item.priority === 'P1').map(item => ({
                id: item.id,
                classification: item.classification,
                title: item.title,
                estimatedBrotliSavingsBytes: item.estimatedBrotliSavingsBytes,
            })),
            P2: opportunities.filter(item => item.priority === 'P2').map(item => ({
                id: item.id,
                classification: item.classification,
                title: item.title,
                estimatedBrotliSavingsBytes: item.estimatedBrotliSavingsBytes,
            })),
        },
        validationChecklist: [
            'npm run pack:br -- "./web-mobile" "./dist/game-compressed.html"',
            '游戏完整启动且所有交互正常',
            '图片、字体、音频、Bullet、Spine 正常',
            '浏览器控制台没有新增错误',
            'Network 没有外部资源请求',
            '记录最终 HTML 字节数',
            '记录 Brotli 数据大小',
            '记录浏览器解压耗时',
        ],
    };

    await mkdir(path.dirname(absoluteOutput), { recursive: true });
    await writeFile(
        absoluteOutput,
        JSON.stringify(report, null, 2),
        'utf8',
    );

    console.log('');
    console.log('资源优化分析完成');
    console.log(`输入目录：${root}`);
    console.log(`输出报告：${absoluteOutput}`);
    console.log(`文件总量：${files.length}`);
    console.log(`原始大小：${formatBytes(totalRawBytes)}`);
    console.log(`输入 Solid Brotli：${formatBytes(solidBrotliBytes)}`);
    console.log(`重复内容组：${duplicateGroups.length}`);
    console.log(`重复内容 Solid 实测节省：${formatBytes(duplicateGlobalSolidSavings)}`);
    console.log(`图片：${images.length}，音频：${audio.length}，字体：${fonts.length}`);
    console.log(`可能无引用候选：${unreferenced.length}（禁止自动删除）`);
    console.log(`分析耗时：${(performance.now() - startedAt).toFixed(2)} ms`);
}

void main().catch(error => {
    console.error('资源优化分析失败：', error);
    process.exitCode = 1;
});
