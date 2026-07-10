import {
    readFile,
    readdir,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
    brotliCompressSync,
    constants as zlibConstants,
    deflateRawSync,
    gzipSync,
} from 'node:zlib';

type ArchiveGroup =
    | 'compressed'
    | 'stored';

interface InputFile {
    path: string;
    extension: string;
    mime: string;
    bytes: Buffer;
    group: ArchiveGroup;
}

interface ArchiveGroupSummary {
    group: ArchiveGroup;
    fileCount: number;
    rawBytes: number;
    rawSize: string;
    percentage: number;
}

interface MethodResult {
    name: string;
    description: string;

    compressionUnitCount: number;

    compressedPayloadBytes: number;
    storedPayloadBytes: number;
    manifestBytes: number;
    shellBytes: number;

    binaryTotalBytes: number;
    base64PayloadBytes: number;

    /**
     * 不包含最终解压运行时代码。
     *
     * 包含：
     * - index.html/style.css 壳
     * - Manifest
     * - Base64 数据块
     */
    estimatedEmbeddedBytes: number;

    estimatedEmbeddedSize: string;
    ratioToOriginal: number;
    savedPercentage: number;

    compressionTimeMs: number;
}

interface SolidCompressionReport {
    generatedAt: string;
    root: string;

    fileCount: number;
    archiveFileCount: number;
    shellFileCount: number;

    originalBytes: number;
    originalSize: string;

    archiveRawBytes: number;
    archiveRawSize: string;

    shellBytes: number;
    shellSize: string;

    groups: ArchiveGroupSummary[];
    methods: MethodResult[];

    bestMethod: {
        name: string;
        estimatedEmbeddedBytes: number;
        estimatedEmbeddedSize: string;
    };
}

interface PolicyManifestEntry {
    /**
     * 文件路径。
     */
    p: string;

    /**
     * MIME。
     */
    m: string;

    /**
     * 数据组：
     * c = 解压后的压缩区
     * s = 原样存储区
     */
    g: 'c' | 's';

    /**
     * 在对应数据组中的原始数据偏移。
     */
    o: number;

    /**
     * 原始长度。
     */
    l: number;
}

interface SolidManifestEntry {
    p: string;
    m: string;
    o: number;
    l: number;
}

interface PerFileManifestEntry {
    p: string;
    m: string;

    /**
     * 在逐文件压缩数据块中的偏移。
     */
    o: number;

    /**
     * 压缩后的长度。
     */
    c: number;

    /**
     * 原始长度。
     */
    l: number;
}

const SHELL_FILES = new Set([
    'index.html',
    'style.css',
]);

/**
 * 这些格式自身已经经过压缩，默认放入原样存储区。
 *
 * 基准测试仍然会额外测试“所有文件整体 Brotli”，
 * 所以暂时不会错过 PNG/JPG 再压缩产生的小幅收益。
 */
const STORED_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',

    '.mp3',
    '.ogg',
    '.wav',
    '.m4a',
    '.aac',

    '.pvr',
    '.pkm',
    '.astc',
]);

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${
        (bytes / 1024 / 1024).toFixed(2)
    } MB`;
}

function calculatePercentage(
    part: number,
    total: number,
): number {
    if (total === 0) {
        return 0;
    }

    return Number(
        ((part / total) * 100).toFixed(2),
    );
}

function calculateBase64Size(
    bytes: number,
): number {
    return Math.ceil(bytes / 3) * 4;
}

function getMimeType(filePath: string): string {
    const extension =
        path.extname(filePath).toLowerCase();

    const mimeMap: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.xml': 'application/xml',
        '.txt': 'text/plain',

        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',

        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',

        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',

        '.wasm': 'application/wasm',

        '.bin': 'application/octet-stream',
        '.cconb': 'application/octet-stream',
        '.ccon': 'application/json',

        '.pvr': 'application/octet-stream',
        '.pkm': 'application/octet-stream',
        '.astc': 'application/octet-stream',
    };

    return (
        mimeMap[extension]
        ?? 'application/octet-stream'
    );
}

function getArchiveGroup(
    extension: string,
): ArchiveGroup {
    return STORED_EXTENSIONS.has(extension)
        ? 'stored'
        : 'compressed';
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
        const absolutePath = path.join(
            current,
            entry.name,
        );

        if (entry.isDirectory()) {
            await walkDirectory(
                root,
                absolutePath,
                output,
            );

            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        output.push(
            normalizePath(
                path.relative(
                    root,
                    absolutePath,
                ),
            ),
        );
    }
}

function createMinifiedJsonBuffer(
    value: unknown,
): Buffer {
    return Buffer.from(
        JSON.stringify(value),
        'utf8',
    );
}

function createSolidManifest(
    files: InputFile[],
): Buffer {
    let offset = 0;

    const entries:
        SolidManifestEntry[] = [];

    for (const file of files) {
        entries.push({
            p: file.path,
            m: file.mime,
            o: offset,
            l: file.bytes.byteLength,
        });

        offset += file.bytes.byteLength;
    }

    return createMinifiedJsonBuffer({
        v: 1,
        t: 'solid',
        e: entries,
    });
}

function createPolicyManifest(
    files: InputFile[],
): Buffer {
    let compressedOffset = 0;
    let storedOffset = 0;

    const entries:
        PolicyManifestEntry[] = [];

    for (const file of files) {
        if (file.group === 'compressed') {
            entries.push({
                p: file.path,
                m: file.mime,
                g: 'c',
                o: compressedOffset,
                l: file.bytes.byteLength,
            });

            compressedOffset +=
                file.bytes.byteLength;

            continue;
        }

        entries.push({
            p: file.path,
            m: file.mime,
            g: 's',
            o: storedOffset,
            l: file.bytes.byteLength,
        });

        storedOffset +=
            file.bytes.byteLength;
    }

    return createMinifiedJsonBuffer({
        v: 1,
        t: 'policy',
        e: entries,
    });
}

function createPerFileManifest(
    files: InputFile[],
    compressedLengths: number[],
): Buffer {
    let compressedOffset = 0;

    const entries:
        PerFileManifestEntry[] = [];

    for (
        let index = 0;
        index < files.length;
        index += 1
    ) {
        const file = files[index];
        const compressedLength =
            compressedLengths[index];

        if (
            !file
            || compressedLength === undefined
        ) {
            throw new Error(
                `逐文件压缩结果不完整：${index}`,
            );
        }

        entries.push({
            p: file.path,
            m: file.mime,
            o: compressedOffset,
            c: compressedLength,
            l: file.bytes.byteLength,
        });

        compressedOffset +=
            compressedLength;
    }

    return createMinifiedJsonBuffer({
        v: 1,
        t: 'per-file',
        e: entries,
    });
}

function createBaselineManifest(
    files: InputFile[],
): Buffer {
    return createMinifiedJsonBuffer({
        v: 1,
        t: 'raw-base64',
        e: files.map(file => ({
            p: file.path,
            m: file.mime,
            l: file.bytes.byteLength,
        })),
    });
}

function compressBrotli(
    input: Buffer,
): Buffer {
    return brotliCompressSync(
        input,
        {
            params: {
                [zlibConstants
                    .BROTLI_PARAM_QUALITY]:
                    11,

                [zlibConstants
                    .BROTLI_PARAM_MODE]:
                    zlibConstants
                        .BROTLI_MODE_GENERIC,
            },
        },
    );
}

function compressGzip(
    input: Buffer,
): Buffer {
    return gzipSync(
        input,
        {
            level: 9,
        },
    );
}

function compressDeflateRaw(
    input: Buffer,
): Buffer {
    return deflateRawSync(
        input,
        {
            level: 9,
        },
    );
}

function measureCompression(
    callback: () => Buffer,
): {
    output: Buffer;
    elapsedMs: number;
} {
    const startTime =
        performance.now();

    const output = callback();

    const elapsedMs =
        performance.now() - startTime;

    return {
        output,
        elapsedMs:
            Number(elapsedMs.toFixed(2)),
    };
}

function createMethodResult(
    options: {
        name: string;
        description: string;

        compressionUnitCount: number;

        compressedPayloadBytes: number;
        storedPayloadBytes: number;

        /**
         * 各个最终嵌入 HTML 的二进制块大小。
         *
         * 每个块会单独 Base64 编码。
         */
        encodedBlockSizes: number[];

        manifestBytes: number;
        shellBytes: number;
        originalBytes: number;

        compressionTimeMs: number;
    },
): MethodResult {
    const binaryTotalBytes =
        options.compressedPayloadBytes
        + options.storedPayloadBytes
        + options.manifestBytes;

    const base64PayloadBytes =
        options.encodedBlockSizes.reduce(
            (sum, blockSize) =>
                sum
                + calculateBase64Size(
                    blockSize,
                ),
            0,
        );

    const estimatedEmbeddedBytes =
        options.shellBytes
        + options.manifestBytes
        + base64PayloadBytes;

    const ratioToOriginal =
        calculatePercentage(
            estimatedEmbeddedBytes,
            options.originalBytes,
        );

    return {
        name: options.name,
        description:
            options.description,

        compressionUnitCount:
            options.compressionUnitCount,

        compressedPayloadBytes:
            options.compressedPayloadBytes,

        storedPayloadBytes:
            options.storedPayloadBytes,

        manifestBytes:
            options.manifestBytes,

        shellBytes:
            options.shellBytes,

        binaryTotalBytes,

        base64PayloadBytes,

        estimatedEmbeddedBytes,

        estimatedEmbeddedSize:
            formatBytes(
                estimatedEmbeddedBytes,
            ),

        ratioToOriginal,

        savedPercentage:
            Number(
                (
                    100
                    - ratioToOriginal
                ).toFixed(2),
            ),

        compressionTimeMs:
            options.compressionTimeMs,
    };
}

async function loadInputFiles(
    root: string,
): Promise<{
    allFiles: InputFile[];
    archiveFiles: InputFile[];
    shellFiles: InputFile[];
}> {
    const relativePaths: string[] = [];

    await walkDirectory(
        root,
        root,
        relativePaths,
    );

    relativePaths.sort();

    const allFiles: InputFile[] = [];
    const archiveFiles: InputFile[] = [];
    const shellFiles: InputFile[] = [];

    for (const relativePath of relativePaths) {
        const extension =
            path.extname(
                relativePath,
            ).toLowerCase();

        const file: InputFile = {
            path: relativePath,
            extension,
            mime:
                getMimeType(relativePath),

            bytes:
                await readFile(
                    path.resolve(
                        root,
                        relativePath,
                    ),
                ),

            group:
                getArchiveGroup(
                    extension,
                ),
        };

        allFiles.push(file);

        if (
            SHELL_FILES.has(
                relativePath,
            )
        ) {
            shellFiles.push(file);
        } else {
            archiveFiles.push(file);
        }
    }

    return {
        allFiles,
        archiveFiles,
        shellFiles,
    };
}

async function analyze(
    inputDirectory: string,
): Promise<SolidCompressionReport> {
    const root =
        path.resolve(inputDirectory);

    const {
        allFiles,
        archiveFiles,
        shellFiles,
    } = await loadInputFiles(root);

    const compressedFiles =
        archiveFiles.filter(
            file =>
                file.group
                === 'compressed',
        );

    const storedFiles =
        archiveFiles.filter(
            file =>
                file.group
                === 'stored',
        );

    const originalBytes =
        allFiles.reduce(
            (sum, file) =>
                sum
                + file.bytes.byteLength,
            0,
        );

    const archiveRawBytes =
        archiveFiles.reduce(
            (sum, file) =>
                sum
                + file.bytes.byteLength,
            0,
        );

    const shellBytes =
        shellFiles.reduce(
            (sum, file) =>
                sum
                + file.bytes.byteLength,
            0,
        );

    const compressedRawBlock =
        Buffer.concat(
            compressedFiles.map(
                file => file.bytes,
            ),
        );

    const storedRawBlock =
        Buffer.concat(
            storedFiles.map(
                file => file.bytes,
            ),
        );

    const allRawBlock =
        Buffer.concat(
            archiveFiles.map(
                file => file.bytes,
            ),
        );

    const methods: MethodResult[] = [];

    /*
     * 当前 Base64 VFS 的近似基线。
     *
     * 每个文件单独转 Base64，会产生逐文件补齐开销。
     */
    const baselineManifest =
        createBaselineManifest(
            archiveFiles,
        );

    methods.push(
        createMethodResult({
            name:
                '原始逐文件 Base64',

            description:
                '不压缩，每个文件单独 Base64，'
                + '接近当前调试版 VFS。',

            compressionUnitCount: 0,

            compressedPayloadBytes: 0,
            storedPayloadBytes:
                archiveRawBytes,

            encodedBlockSizes:
                archiveFiles.map(
                    file =>
                        file.bytes.byteLength,
                ),

            manifestBytes:
                baselineManifest.byteLength,

            shellBytes,
            originalBytes,

            compressionTimeMs: 0,
        }),
    );

    /*
     * 逐文件 Brotli。
     */
    console.log(
        '正在测试：逐文件 Brotli Quality 11...',
    );

    const perFileStart =
        performance.now();

    const perFileCompressedLengths:
        number[] = [];

    let perFileCompressedBytes = 0;

    for (
        let index = 0;
        index < archiveFiles.length;
        index += 1
    ) {
        const file = archiveFiles[index];

        if (!file) {
            continue;
        }

        process.stdout.write(
            `\r逐文件 Brotli：${
                index + 1
            }/${archiveFiles.length}`,
        );

        const compressed =
            compressBrotli(
                file.bytes,
            );

        perFileCompressedLengths.push(
            compressed.byteLength,
        );

        perFileCompressedBytes +=
            compressed.byteLength;
    }

    process.stdout.write('\n');

    const perFileElapsed =
        Number(
            (
                performance.now()
                - perFileStart
            ).toFixed(2),
        );

    const perFileManifest =
        createPerFileManifest(
            archiveFiles,
            perFileCompressedLengths,
        );

    methods.push(
        createMethodResult({
            name:
                '逐文件 Brotli Q11',

            description:
                '每个文件独立 Brotli，'
                + '便于按需解压，但无法利用'
                + '跨文件重复数据。',

            compressionUnitCount:
                archiveFiles.length,

            compressedPayloadBytes:
                perFileCompressedBytes,

            storedPayloadBytes: 0,

            /*
             * 压缩结果最终可以拼接成一个二进制块，
             * 再整体 Base64。
             */
            encodedBlockSizes: [
                perFileCompressedBytes,
            ],

            manifestBytes:
                perFileManifest.byteLength,

            shellBytes,
            originalBytes,

            compressionTimeMs:
                perFileElapsed,
        }),
    );

    /*
     * 所有资源整体 Brotli。
     */
    console.log(
        '正在测试：所有资源 Solid Brotli Q11...',
    );

    const allBrotli =
        measureCompression(
            () =>
                compressBrotli(
                    allRawBlock,
                ),
        );

    const allSolidManifest =
        createSolidManifest(
            archiveFiles,
        );

    methods.push(
        createMethodResult({
            name:
                '全部 Solid Brotli Q11',

            description:
                '全部归档资源拼接后一次 Brotli。'
                + '体积通常最小，但启动时需要'
                + '解压整个资源块。',

            compressionUnitCount: 1,

            compressedPayloadBytes:
                allBrotli.output.byteLength,

            storedPayloadBytes: 0,

            encodedBlockSizes: [
                allBrotli.output.byteLength,
            ],

            manifestBytes:
                allSolidManifest.byteLength,

            shellBytes,
            originalBytes,

            compressionTimeMs:
                allBrotli.elapsedMs,
        }),
    );

    /*
     * 压缩组 Brotli + 媒体原样。
     */
    console.log(
        '正在测试：策略分组 Solid Brotli Q11...',
    );

    const policyManifest =
        createPolicyManifest(
            archiveFiles,
        );

    const policyBrotli =
        measureCompression(
            () =>
                compressBrotli(
                    compressedRawBlock,
                ),
        );

    methods.push(
        createMethodResult({
            name:
                '分组 Solid Brotli Q11',

            description:
                'JS/JSON/BIN/CCONB/WASM/字体'
                + '整体 Brotli；图片、音频和'
                + '压缩纹理保持原样。',

            compressionUnitCount: 1,

            compressedPayloadBytes:
                policyBrotli
                    .output.byteLength,

            storedPayloadBytes:
                storedRawBlock.byteLength,

            encodedBlockSizes: [
                policyBrotli
                    .output.byteLength,

                storedRawBlock.byteLength,
            ],

            manifestBytes:
                policyManifest.byteLength,

            shellBytes,
            originalBytes,

            compressionTimeMs:
                policyBrotli.elapsedMs,
        }),
    );

    /*
     * 压缩组 Gzip + 媒体原样。
     */
    console.log(
        '正在测试：策略分组 Solid Gzip Level 9...',
    );

    const policyGzip =
        measureCompression(
            () =>
                compressGzip(
                    compressedRawBlock,
                ),
        );

    methods.push(
        createMethodResult({
            name:
                '分组 Solid Gzip L9',

            description:
                '可压缩资源整体 Gzip；'
                + '媒体资源保持原样。'
                + '运行时解压兼容性通常更容易处理。',

            compressionUnitCount: 1,

            compressedPayloadBytes:
                policyGzip.output.byteLength,

            storedPayloadBytes:
                storedRawBlock.byteLength,

            encodedBlockSizes: [
                policyGzip.output.byteLength,
                storedRawBlock.byteLength,
            ],

            manifestBytes:
                policyManifest.byteLength,

            shellBytes,
            originalBytes,

            compressionTimeMs:
                policyGzip.elapsedMs,
        }),
    );

    /*
     * 压缩组 Raw Deflate + 媒体原样。
     */
    console.log(
        '正在测试：策略分组 Solid Deflate Raw...',
    );

    const policyDeflate =
        measureCompression(
            () =>
                compressDeflateRaw(
                    compressedRawBlock,
                ),
        );

    methods.push(
        createMethodResult({
            name:
                '分组 Solid Deflate Raw L9',

            description:
                '可压缩资源整体 Raw Deflate；'
                + '媒体资源保持原样。'
                + '没有 Gzip 文件头和校验尾。',

            compressionUnitCount: 1,

            compressedPayloadBytes:
                policyDeflate
                    .output.byteLength,

            storedPayloadBytes:
                storedRawBlock.byteLength,

            encodedBlockSizes: [
                policyDeflate
                    .output.byteLength,

                storedRawBlock.byteLength,
            ],

            manifestBytes:
                policyManifest.byteLength,

            shellBytes,
            originalBytes,

            compressionTimeMs:
                policyDeflate.elapsedMs,
        }),
    );

    const groups: ArchiveGroupSummary[] = [
        {
            group: 'compressed',

            fileCount:
                compressedFiles.length,

            rawBytes:
                compressedRawBlock.byteLength,

            rawSize:
                formatBytes(
                    compressedRawBlock
                        .byteLength,
                ),

            percentage:
                calculatePercentage(
                    compressedRawBlock
                        .byteLength,

                    archiveRawBytes,
                ),
        },
        {
            group: 'stored',

            fileCount:
                storedFiles.length,

            rawBytes:
                storedRawBlock.byteLength,

            rawSize:
                formatBytes(
                    storedRawBlock
                        .byteLength,
                ),

            percentage:
                calculatePercentage(
                    storedRawBlock
                        .byteLength,

                    archiveRawBytes,
                ),
        },
    ];

    const compressedMethods =
        methods.filter(
            method =>
                method
                    .compressedPayloadBytes
                > 0,
        );

    const bestMethod = [
        ...compressedMethods,
    ].sort(
        (a, b) =>
            a.estimatedEmbeddedBytes
            - b.estimatedEmbeddedBytes,
    )[0];

    if (!bestMethod) {
        throw new Error(
            '没有生成有效的压缩测试结果。',
        );
    }

    return {
        generatedAt:
            new Date().toISOString(),

        root,

        fileCount:
            allFiles.length,

        archiveFileCount:
            archiveFiles.length,

        shellFileCount:
            shellFiles.length,

        originalBytes,
        originalSize:
            formatBytes(originalBytes),

        archiveRawBytes,
        archiveRawSize:
            formatBytes(
                archiveRawBytes,
            ),

        shellBytes,
        shellSize:
            formatBytes(shellBytes),

        groups,
        methods,

        bestMethod: {
            name:
                bestMethod.name,

            estimatedEmbeddedBytes:
                bestMethod
                    .estimatedEmbeddedBytes,

            estimatedEmbeddedSize:
                bestMethod
                    .estimatedEmbeddedSize,
        },
    };
}

function printReport(
    report: SolidCompressionReport,
): void {
    console.log('');
    console.log('Solid Compression 分析完成');
    console.log(
        `原始构建：${report.originalSize}`,
    );
    console.log(
        `归档资源：${report.archiveRawSize}`,
    );
    console.log(
        `HTML/CSS 壳：${report.shellSize}`,
    );

    console.log('');
    console.log('资源分组：');

    console.table(
        report.groups.map(group => ({
            分组:
                group.group
                === 'compressed'
                    ? '压缩组'
                    : '原样组',

            文件数:
                group.fileCount,

            原始大小:
                group.rawSize,

            归档占比:
                `${group.percentage}%`,
        })),
    );

    console.log('');
    console.log(
        '压缩结果：'
        + '（估算值暂不包含最终解压运行时代码）',
    );

    console.table(
        report.methods.map(method => ({
            方案:
                method.name,

            压缩单元:
                method.compressionUnitCount,

            压缩数据:
                formatBytes(
                    method
                        .compressedPayloadBytes,
                ),

            原样数据:
                formatBytes(
                    method
                        .storedPayloadBytes,
                ),

            Manifest:
                formatBytes(
                    method.manifestBytes,
                ),

            Base64后估算:
                method
                    .estimatedEmbeddedSize,

            相对原包:
                `${method.ratioToOriginal}%`,

            节省:
                `${method.savedPercentage}%`,

            压缩耗时:
                `${
                    method.compressionTimeMs
                } ms`,
        })),
    );

    console.log('');
    console.log(
        `当前最小方案：${
            report.bestMethod.name
        }`,
    );

    console.log(
        `估算嵌入体积：${
            report.bestMethod
                .estimatedEmbeddedSize
        }`,
    );
}

async function main(): Promise<void> {
    const inputDirectory =
        process.argv[2]
        ?? './web-mobile';

    const outputFile =
        process.argv[3]
        ?? './solid-compression-report.json';

    try {
        const report =
            await analyze(
                inputDirectory,
            );

        const absoluteOutputPath =
            path.resolve(outputFile);

        await writeFile(
            absoluteOutputPath,
            JSON.stringify(
                report,
                null,
                2,
            ),
            'utf8',
        );

        printReport(report);

        console.log('');
        console.log(
            `报告已写入：${
                absoluteOutputPath
            }`,
        );
    } catch (error) {
        console.error(
            'Solid Compression 分析失败：',
            error,
        );

        process.exitCode = 1;
    }
}

void main();