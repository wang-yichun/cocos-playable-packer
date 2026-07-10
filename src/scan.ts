import {
    readdir,
    stat,
    writeFile,
} from 'node:fs/promises';
import {
    createHash,
} from 'node:crypto';
import path from 'node:path';

interface FileRecord {
    path: string;
    extension: string;
    bytes: number;
    formattedSize: string;
    hash: string;
    category: FileCategory;
}

type FileCategory =
    | 'html'
    | 'javascript'
    | 'css'
    | 'json'
    | 'image'
    | 'audio'
    | 'font'
    | 'wasm'
    | 'binary'
    | 'other';

interface ExtensionSummary {
    extension: string;
    fileCount: number;
    bytes: number;
    formattedSize: string;
    percentage: number;
}

interface ScanReport {
    generatedAt: string;
    root: string;
    fileCount: number;
    totalBytes: number;
    totalSize: string;
    categories: Record<string, {
        fileCount: number;
        bytes: number;
        formattedSize: string;
        percentage: number;
    }>;
    extensions: ExtensionSummary[];
    largestFiles: FileRecord[];
    files: FileRecord[];
}

const IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.avif',
    '.gif',
    '.ktx',
    '.ktx2',
    '.pvr',
    '.astc',
]);

const AUDIO_EXTENSIONS = new Set([
    '.mp3',
    '.ogg',
    '.wav',
    '.m4a',
    '.aac',
]);

const FONT_EXTENSIONS = new Set([
    '.ttf',
    '.otf',
    '.woff',
    '.woff2',
]);

const BINARY_EXTENSIONS = new Set([
    '.bin',
    '.cconb',
    '.mesh',
    '.dbbin',
]);

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function getExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase() || '[none]';
}

function classifyFile(extension: string): FileCategory {
    if (extension === '.html' || extension === '.htm') {
        return 'html';
    }

    if (
        extension === '.js'
        || extension === '.mjs'
        || extension === '.cjs'
    ) {
        return 'javascript';
    }

    if (extension === '.css') {
        return 'css';
    }

    if (
        extension === '.json'
        || extension === '.plist'
        || extension === '.ccon'
    ) {
        return 'json';
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
        return 'image';
    }

    if (AUDIO_EXTENSIONS.has(extension)) {
        return 'audio';
    }

    if (FONT_EXTENSIONS.has(extension)) {
        return 'font';
    }

    if (extension === '.wasm') {
        return 'wasm';
    }

    if (BINARY_EXTENSIONS.has(extension)) {
        return 'binary';
    }

    return 'other';
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

function calculatePercentage(
    bytes: number,
    totalBytes: number,
): number {
    if (totalBytes === 0) {
        return 0;
    }

    return Number(
        ((bytes / totalBytes) * 100).toFixed(2),
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

async function createFileRecord(
    root: string,
    relativePath: string,
): Promise<FileRecord> {
    const absolutePath = path.join(
        root,
        relativePath,
    );

    const fileStat = await stat(absolutePath);
    const extension = getExtension(relativePath);

    /*
     * 当前只根据文件路径和大小生成轻量 Hash。
     * 下一阶段再读取文件内容生成真正的内容 Hash，
     * 避免第一次扫描大项目时占用过多内存。
     */
    const hash = createHash('sha1')
        .update(relativePath)
        .update(String(fileStat.size))
        .digest('hex')
        .slice(0, 12);

    return {
        path: normalizePath(relativePath),
        extension,
        bytes: fileStat.size,
        formattedSize: formatBytes(fileStat.size),
        hash,
        category: classifyFile(extension),
    };
}

async function scanBuildDirectory(
    inputDirectory: string,
): Promise<ScanReport> {
    const root = path.resolve(inputDirectory);
    const relativePaths: string[] = [];

    await walkDirectory(
        root,
        root,
        relativePaths,
    );

    const files: FileRecord[] = [];

    for (const relativePath of relativePaths) {
        files.push(
            await createFileRecord(
                root,
                relativePath,
            ),
        );
    }

    files.sort((a, b) => b.bytes - a.bytes);

    const totalBytes = files.reduce(
        (sum, file) => sum + file.bytes,
        0,
    );

    const categoryMap = new Map<
        string,
        {
            fileCount: number;
            bytes: number;
        }
    >();

    const extensionMap = new Map<
        string,
        {
            fileCount: number;
            bytes: number;
        }
    >();

    for (const file of files) {
        const category = categoryMap.get(
            file.category,
        ) ?? {
            fileCount: 0,
            bytes: 0,
        };

        category.fileCount += 1;
        category.bytes += file.bytes;

        categoryMap.set(
            file.category,
            category,
        );

        const extension = extensionMap.get(
            file.extension,
        ) ?? {
            fileCount: 0,
            bytes: 0,
        };

        extension.fileCount += 1;
        extension.bytes += file.bytes;

        extensionMap.set(
            file.extension,
            extension,
        );
    }

    const categories: ScanReport['categories'] = {};

    for (const [name, value] of categoryMap) {
        categories[name] = {
            fileCount: value.fileCount,
            bytes: value.bytes,
            formattedSize: formatBytes(value.bytes),
            percentage: calculatePercentage(
                value.bytes,
                totalBytes,
            ),
        };
    }

    const extensions: ExtensionSummary[] = [];

    for (const [extension, value] of extensionMap) {
        extensions.push({
            extension,
            fileCount: value.fileCount,
            bytes: value.bytes,
            formattedSize: formatBytes(value.bytes),
            percentage: calculatePercentage(
                value.bytes,
                totalBytes,
            ),
        });
    }

    extensions.sort(
        (a, b) => b.bytes - a.bytes,
    );

    return {
        generatedAt: new Date().toISOString(),
        root,
        fileCount: files.length,
        totalBytes,
        totalSize: formatBytes(totalBytes),
        categories,
        extensions,
        largestFiles: files.slice(0, 30),
        files,
    };
}

async function main(): Promise<void> {
    const inputDirectory = process.argv[2];
    const outputFile =
        process.argv[3] ?? './scan-report.json';

    if (!inputDirectory) {
        console.error(
            '用法：npm run scan -- <web-mobile目录> [报告路径]',
        );

        process.exitCode = 1;
        return;
    }

    try {
        const report = await scanBuildDirectory(
            inputDirectory,
        );

        await writeFile(
            path.resolve(outputFile),
            JSON.stringify(report, null, 2),
            'utf8',
        );

        console.log('');
        console.log('Cocos Web Mobile 包体扫描完成');
        console.log(`文件数量：${report.fileCount}`);
        console.log(`总大小：${report.totalSize}`);
        console.log('');

        console.table(
            report.extensions.slice(0, 15).map(
                item => ({
                    扩展名: item.extension,
                    数量: item.fileCount,
                    大小: item.formattedSize,
                    占比: `${item.percentage}%`,
                }),
            ),
        );

        console.log('');
        console.log('最大的 15 个文件：');

        console.table(
            report.largestFiles.slice(0, 15).map(
                file => ({
                    文件: file.path,
                    类型: file.category,
                    大小: file.formattedSize,
                }),
            ),
        );

        console.log('');
        console.log(
            `报告已写入：${path.resolve(outputFile)}`,
        );
    } catch (error) {
        console.error('扫描失败：', error);
        process.exitCode = 1;
    }
}

void main();