import {
    readFile,
    readdir,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
    brotliCompressSync,
    constants as zlibConstants,
    gzipSync,
} from 'node:zlib';

interface CompressionFileRecord {
    path: string;
    extension: string;

    rawBytes: number;
    gzipBytes: number;
    brotliBytes: number;

    gzipRatio: number;
    brotliRatio: number;

    brotliBase64Bytes: number;
}

interface ExtensionRecord {
    extension: string;
    fileCount: number;

    rawBytes: number;
    gzipBytes: number;
    brotliBytes: number;
    brotliBase64Bytes: number;

    gzipRatio: number;
    brotliRatio: number;
}

interface CompressionReport {
    generatedAt: string;
    root: string;

    totalRawBytes: number;
    totalGzipBytes: number;
    totalBrotliBytes: number;
    totalBrotliBase64Bytes: number;

    totalRawSize: string;
    totalGzipSize: string;
    totalBrotliSize: string;
    totalBrotliBase64Size: string;

    gzipRatio: number;
    brotliRatio: number;

    extensions: ExtensionRecord[];
    largestRawFiles: CompressionFileRecord[];
    poorestCompressionFiles: CompressionFileRecord[];
    files: CompressionFileRecord[];
}

const TEXT_EXTENSIONS = new Set([
    '.html',
    '.css',
    '.js',
    '.mjs',
    '.cjs',
    '.json',
    '.xml',
    '.txt',
    '.effect',
    '.chunk',
    '.plist',
    '.ccon',
    '.svg',
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

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function calculateRatio(
    compressedBytes: number,
    rawBytes: number,
): number {
    if (rawBytes === 0) {
        return 0;
    }

    return Number(
        ((compressedBytes / rawBytes) * 100).toFixed(2),
    );
}

function calculateBase64Size(bytes: number): number {
    return Math.ceil(bytes / 3) * 4;
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
                path.relative(root, absolutePath),
            ),
        );
    }
}

function compressFile(
    relativePath: string,
    data: Buffer,
): CompressionFileRecord {
    const extension =
        path.extname(relativePath).toLowerCase()
        || '[none]';

    const gzipData = gzipSync(data, {
        level: 9,
    });

    const brotliMode = TEXT_EXTENSIONS.has(extension)
        ? zlibConstants.BROTLI_MODE_TEXT
        : zlibConstants.BROTLI_MODE_GENERIC;

    const brotliData = brotliCompressSync(data, {
        params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
            [zlibConstants.BROTLI_PARAM_MODE]:
                brotliMode,
        },
    });

    return {
        path: relativePath,
        extension,

        rawBytes: data.byteLength,
        gzipBytes: gzipData.byteLength,
        brotliBytes: brotliData.byteLength,

        gzipRatio: calculateRatio(
            gzipData.byteLength,
            data.byteLength,
        ),

        brotliRatio: calculateRatio(
            brotliData.byteLength,
            data.byteLength,
        ),

        brotliBase64Bytes: calculateBase64Size(
            brotliData.byteLength,
        ),
    };
}

async function analyzeDirectory(
    inputDirectory: string,
): Promise<CompressionReport> {
    const root = path.resolve(inputDirectory);
    const paths: string[] = [];

    await walkDirectory(
        root,
        root,
        paths,
    );

    const files: CompressionFileRecord[] = [];

    for (const relativePath of paths) {
        const absolutePath = path.join(
            root,
            relativePath,
        );

        const data = await readFile(absolutePath);

        files.push(
            compressFile(
                normalizePath(relativePath),
                data,
            ),
        );
    }

    const totalRawBytes = files.reduce(
        (sum, file) => sum + file.rawBytes,
        0,
    );

    const totalGzipBytes = files.reduce(
        (sum, file) => sum + file.gzipBytes,
        0,
    );

    const totalBrotliBytes = files.reduce(
        (sum, file) => sum + file.brotliBytes,
        0,
    );

    const totalBrotliBase64Bytes = files.reduce(
        (sum, file) =>
            sum + file.brotliBase64Bytes,
        0,
    );

    const extensionMap = new Map<
        string,
        {
            fileCount: number;
            rawBytes: number;
            gzipBytes: number;
            brotliBytes: number;
            brotliBase64Bytes: number;
        }
    >();

    for (const file of files) {
        const record = extensionMap.get(
            file.extension,
        ) ?? {
            fileCount: 0,
            rawBytes: 0,
            gzipBytes: 0,
            brotliBytes: 0,
            brotliBase64Bytes: 0,
        };

        record.fileCount += 1;
        record.rawBytes += file.rawBytes;
        record.gzipBytes += file.gzipBytes;
        record.brotliBytes += file.brotliBytes;
        record.brotliBase64Bytes +=
            file.brotliBase64Bytes;

        extensionMap.set(
            file.extension,
            record,
        );
    }

    const extensions: ExtensionRecord[] = [];

    for (const [extension, record] of extensionMap) {
        extensions.push({
            extension,
            fileCount: record.fileCount,

            rawBytes: record.rawBytes,
            gzipBytes: record.gzipBytes,
            brotliBytes: record.brotliBytes,
            brotliBase64Bytes:
                record.brotliBase64Bytes,

            gzipRatio: calculateRatio(
                record.gzipBytes,
                record.rawBytes,
            ),

            brotliRatio: calculateRatio(
                record.brotliBytes,
                record.rawBytes,
            ),
        });
    }

    extensions.sort(
        (a, b) => b.rawBytes - a.rawBytes,
    );

    const largestRawFiles = [...files]
        .sort(
            (a, b) => b.rawBytes - a.rawBytes,
        )
        .slice(0, 30);

    const poorestCompressionFiles = [...files]
        .filter(file => file.rawBytes >= 1024)
        .sort(
            (a, b) =>
                b.brotliRatio - a.brotliRatio,
        )
        .slice(0, 30);

    return {
        generatedAt: new Date().toISOString(),
        root,

        totalRawBytes,
        totalGzipBytes,
        totalBrotliBytes,
        totalBrotliBase64Bytes,

        totalRawSize: formatBytes(
            totalRawBytes,
        ),

        totalGzipSize: formatBytes(
            totalGzipBytes,
        ),

        totalBrotliSize: formatBytes(
            totalBrotliBytes,
        ),

        totalBrotliBase64Size: formatBytes(
            totalBrotliBase64Bytes,
        ),

        gzipRatio: calculateRatio(
            totalGzipBytes,
            totalRawBytes,
        ),

        brotliRatio: calculateRatio(
            totalBrotliBytes,
            totalRawBytes,
        ),

        extensions,
        largestRawFiles,
        poorestCompressionFiles,
        files,
    };
}

function printExtensionTable(
    report: CompressionReport,
): void {
    console.table(
        report.extensions.map(item => ({
            扩展名: item.extension,
            数量: item.fileCount,
            原始: formatBytes(item.rawBytes),
            Gzip: formatBytes(item.gzipBytes),
            Brotli: formatBytes(item.brotliBytes),
            Brotli压缩率: `${item.brotliRatio}%`,
            Brotli转Base64: formatBytes(
                item.brotliBase64Bytes,
            ),
        })),
    );
}

function printLargestFiles(
    report: CompressionReport,
): void {
    console.log('');
    console.log('原始体积最大的 20 个文件：');

    console.table(
        report.largestRawFiles
            .slice(0, 20)
            .map(file => ({
                文件: file.path,
                原始: formatBytes(file.rawBytes),
                Brotli: formatBytes(
                    file.brotliBytes,
                ),
                压缩率: `${file.brotliRatio}%`,
            })),
    );
}

function printPoorCompressionFiles(
    report: CompressionReport,
): void {
    console.log('');
    console.log('Brotli 压缩效果最差的 20 个文件：');

    console.table(
        report.poorestCompressionFiles
            .slice(0, 20)
            .map(file => ({
                文件: file.path,
                原始: formatBytes(file.rawBytes),
                Brotli: formatBytes(
                    file.brotliBytes,
                ),
                压缩率: `${file.brotliRatio}%`,
            })),
    );
}

async function main(): Promise<void> {
    const inputDirectory = process.argv[2];

    const outputFile =
        process.argv[3]
        ?? './compression-report.json';

    if (!inputDirectory) {
        console.error(
            '用法：npm run analyze -- '
            + '<web-mobile目录> [报告路径]',
        );

        process.exitCode = 1;
        return;
    }

    try {
        const report = await analyzeDirectory(
            inputDirectory,
        );

        await writeFile(
            path.resolve(outputFile),
            JSON.stringify(report, null, 2),
            'utf8',
        );

        console.log('');
        console.log('压缩率分析完成');
        console.log(
            `原始总大小：${report.totalRawSize}`,
        );
        console.log(
            `逐文件 Gzip：${report.totalGzipSize} `
            + `(${report.gzipRatio}%)`,
        );
        console.log(
            `逐文件 Brotli：${report.totalBrotliSize} `
            + `(${report.brotliRatio}%)`,
        );
        console.log(
            'Brotli 后再使用标准 Base64：'
            + report.totalBrotliBase64Size,
        );
        console.log('');

        printExtensionTable(report);
        printLargestFiles(report);
        printPoorCompressionFiles(report);

        console.log('');
        console.log(
            `报告已写入：${path.resolve(outputFile)}`,
        );
    } catch (error) {
        console.error('分析失败：', error);
        process.exitCode = 1;
    }
}

void main();