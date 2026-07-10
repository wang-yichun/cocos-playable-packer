import {
    copyFile,
    mkdir,
    readFile,
    writeFile,
} from "node:fs/promises";

import path from "node:path";

import {
    loadSourceImageOptimizerConfig,
} from "./config.js";

import {
    loadTinyPngCache,
    lookupTinyPngCache,
    storeTinyPngCacheResult,
} from "./hash-cache.js";

import {
    calculateImageSha256,
    inspectImageBufferMetadata,
} from "./image-inspector.js";

import {
    createTinyPngClientFromEnvironment,
} from "./tinypng-client.js";

import type {
    ResolvedSourceImageOptimizerConfig,
    SourceImageCandidateItem,
    SourceImageCandidateManifest,
    TinyPngPreviewRunItem,
    TinyPngPreviewRunReport,
    TinyPngPreviewRunSummary,
} from "./types.js";

interface CommandOptions {
    configPath: string;

    /**
     * null 表示不限制，即 --all。
     */
    apiRequestLimit: number | null;
}

interface PreparedCandidate {
    candidate: SourceImageCandidateItem;
    sourcePath: string;
    sourceBuffer: Buffer;

    invalidCacheReason: string | null;
}

function formatBytes(bytes: number): string {
    const sign = bytes < 0
        ? "-"
        : "";

    const absoluteBytes =
        Math.abs(bytes);

    if (absoluteBytes < 1024) {
        return `${sign}${absoluteBytes} B`;
    }

    if (absoluteBytes < 1024 * 1024) {
        return (
            `${sign}` +
            `${(absoluteBytes / 1024).toFixed(2)} KB`
        );
    }

    return (
        `${sign}` +
        `${(
            absoluteBytes /
            1024 /
            1024
        ).toFixed(2)} MB`
    );
}

function removeUtf8Bom(
    content: string,
): string {
    if (content.charCodeAt(0) === 0xfeff) {
        return content.slice(1);
    }

    return content;
}

function isRecord(
    value: unknown,
): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function toErrorMessage(
    error: unknown,
): string {
    return error instanceof Error
        ? error.message
        : String(error);
}

function isPathInsideDirectory(
    targetPath: string,
    directoryPath: string,
): boolean {
    const relativePath = path.relative(
        directoryPath,
        targetPath,
    );

    return (
        relativePath.length > 0 &&
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

function resolvePortableRelativePath(
    rootDirectory: string,
    portableRelativePath: string,
): string {
    if (path.isAbsolute(portableRelativePath)) {
        throw new Error(
            `不允许使用绝对路径：${portableRelativePath}`,
        );
    }

    const segments = portableRelativePath
        .split(/[\\/]+/)
        .filter(
            (segment) =>
                segment.length > 0,
        );

    if (
        segments.some(
            (segment) =>
                segment === "." ||
                segment === "..",
        )
    ) {
        throw new Error(
            `路径包含非法片段：${portableRelativePath}`,
        );
    }

    const resolvedPath = path.resolve(
        rootDirectory,
        ...segments,
    );

    if (
        !isPathInsideDirectory(
            resolvedPath,
            rootDirectory,
        )
    ) {
        throw new Error(
            `路径超出允许目录：${portableRelativePath}`,
        );
    }

    return resolvedPath;
}

function parseCommandOptions(
    argv: readonly string[],
): CommandOptions {
    const configPath = argv[0];

    if (!configPath) {
        throw new Error(
            [
                "缺少配置文件参数。",
                "",
                "默认最多新增 5 次 API 请求：",
                "npm run tinypng:preview -- " +
                "\"./configs/game141-source-images.json\"",
                "",
                "指定新增请求上限：",
                "npm run tinypng:preview -- " +
                "\"./configs/game141-source-images.json\" " +
                "--limit=10",
                "",
                "处理全部缓存未命中项：",
                "npm run tinypng:preview -- " +
                "\"./configs/game141-source-images.json\" " +
                "--all",
                "",
                "只复制已有缓存，不调用 API：",
                "npm run tinypng:preview -- " +
                "\"./configs/game141-source-images.json\" " +
                "--limit=0",
            ].join("\n"),
        );
    }

    let apiRequestLimit: number | null = 5;
    let hasLimitOption = false;
    let hasAllOption = false;

    for (const argument of argv.slice(1)) {
        if (argument === "--all") {
            if (hasLimitOption) {
                throw new Error(
                    "--all 不能与 --limit 同时使用。",
                );
            }

            hasAllOption = true;
            apiRequestLimit = null;
            continue;
        }

        if (argument.startsWith("--limit=")) {
            if (hasAllOption) {
                throw new Error(
                    "--limit 不能与 --all 同时使用。",
                );
            }

            const rawValue =
                argument.slice(
                    "--limit=".length,
                );

            const parsedValue =
                Number(rawValue);

            if (
                !Number.isInteger(parsedValue) ||
                parsedValue < 0
            ) {
                throw new Error(
                    `--limit 必须是非负整数：${rawValue}`,
                );
            }

            hasLimitOption = true;
            apiRequestLimit = parsedValue;
            continue;
        }

        throw new Error(
            `无法识别的参数：${argument}`,
        );
    }

    return {
        configPath,
        apiRequestLimit,
    };
}

async function loadCandidateManifest(
    config: ResolvedSourceImageOptimizerConfig,
): Promise<{
    manifestPath: string;
    manifest: SourceImageCandidateManifest;
}> {
    const manifestPath = path.join(
        config.resolvedWorkspaceDirectory,
        "manifests",
        "candidates.json",
    );

    let parsed: unknown;

    try {
        const content = await readFile(
            manifestPath,
            "utf8",
        );

        parsed = JSON.parse(
            removeUtf8Bom(content),
        ) as unknown;
    } catch (error) {
        throw new Error(
            `无法读取候选清单：${manifestPath}`,
            {
                cause: error,
            },
        );
    }

    if (
        !isRecord(parsed) ||
        parsed.schemaVersion !== 1 ||
        parsed.projectName !==
        config.projectName ||
        !Array.isArray(parsed.files)
    ) {
        throw new Error(
            `候选清单结构或项目名称无效：${manifestPath}`,
        );
    }

    return {
        manifestPath,
        manifest:
            parsed as unknown as
            SourceImageCandidateManifest,
    };
}

function validateCompressedImage(
    sourceBuffer: Buffer,
    compressedBuffer: Buffer,
    candidate: SourceImageCandidateItem,
): void {
    if (compressedBuffer.length === 0) {
        throw new Error(
            "TinyPNG 返回了空文件。",
        );
    }

    const sourceMetadata =
        inspectImageBufferMetadata(
            sourceBuffer,
        );

    const compressedMetadata =
        inspectImageBufferMetadata(
            compressedBuffer,
        );

    if (
        compressedMetadata.format ===
        "unknown"
    ) {
        throw new Error(
            "TinyPNG 返回的数据不是有效 PNG/JPEG。",
        );
    }

    if (
        sourceMetadata.format !==
        compressedMetadata.format
    ) {
        throw new Error(
            [
                "TinyPNG 返回图片格式发生变化。",
                `图片：${candidate.projectRelativePath}`,
                `源格式：${sourceMetadata.format}`,
                `目标格式：${compressedMetadata.format}`,
            ].join("\n"),
        );
    }

    if (
        sourceMetadata.width !==
        compressedMetadata.width ||
        sourceMetadata.height !==
        compressedMetadata.height
    ) {
        throw new Error(
            [
                "TinyPNG 返回图片尺寸发生变化。",
                `图片：${candidate.projectRelativePath}`,
                `源尺寸：${sourceMetadata.width}x${sourceMetadata.height}`,
                `目标尺寸：${compressedMetadata.width}x${compressedMetadata.height}`,
            ].join("\n"),
        );
    }
}

async function writePreviewFile(
    config: ResolvedSourceImageOptimizerConfig,
    candidate: SourceImageCandidateItem,
    compressedFilePath: string,
): Promise<string> {
    const previewRoot = path.join(
        config.resolvedWorkspaceDirectory,
        "preview",
    );

    const previewPath =
        resolvePortableRelativePath(
            previewRoot,
            candidate.projectRelativePath,
        );

    await mkdir(
        path.dirname(previewPath),
        {
            recursive: true,
        },
    );

    await copyFile(
        compressedFilePath,
        previewPath,
    );

    return previewPath;
}

function createCompletedItem(
    candidate: SourceImageCandidateItem,
    status: "cache-hit" | "compressed",
    compressedBytes: number,
    previewPath: string,
    compressionCount: number | null,
    message: string | null,
): TinyPngPreviewRunItem {
    const savedBytes =
        candidate.sizeBytes -
        compressedBytes;

    const savedPercent =
        candidate.sizeBytes > 0
            ? (
                savedBytes /
                candidate.sizeBytes *
                100
            )
            : 0;

    return {
        projectRelativePath:
            candidate.projectRelativePath,

        sourceSha256:
            candidate.sha256,

        status,

        sourceBytes:
            candidate.sizeBytes,

        compressedBytes,

        savedBytes,
        savedPercent,

        previewPath,
        compressionCount,
        message,
    };
}

function createIncompleteItem(
    candidate: SourceImageCandidateItem,
    status:
        | "skipped-limit"
        | "skipped-api-error"
        | "source-changed"
        | "failed",
    message: string,
): TinyPngPreviewRunItem {
    return {
        projectRelativePath:
            candidate.projectRelativePath,

        sourceSha256:
            candidate.sha256,

        status,

        sourceBytes:
            candidate.sizeBytes,

        compressedBytes: null,
        savedBytes: null,
        savedPercent: null,

        previewPath: null,
        compressionCount: null,
        message,
    };
}

function buildSummary(
    candidateCount: number,
    items: readonly TinyPngPreviewRunItem[],
    apiRequestAttempts: number,
    apiRequestSuccesses: number,
): TinyPngPreviewRunSummary {
    let cacheHitCount = 0;
    let compressedCount = 0;

    let skippedLimitCount = 0;
    let skippedApiErrorCount = 0;

    let sourceChangedCount = 0;
    let failedCount = 0;

    let previewFileCount = 0;

    let previewSourceBytes = 0;
    let previewCompressedBytes = 0;

    for (const item of items) {
        switch (item.status) {
            case "cache-hit":
                cacheHitCount += 1;
                break;

            case "compressed":
                compressedCount += 1;
                break;

            case "skipped-limit":
                skippedLimitCount += 1;
                break;

            case "skipped-api-error":
                skippedApiErrorCount += 1;
                break;

            case "source-changed":
                sourceChangedCount += 1;
                break;

            case "failed":
                failedCount += 1;
                break;
        }

        if (
            item.status === "cache-hit" ||
            item.status === "compressed"
        ) {
            previewFileCount += 1;

            previewSourceBytes +=
                item.sourceBytes;

            previewCompressedBytes +=
                item.compressedBytes ?? 0;
        }
    }

    return {
        candidateCount,

        cacheHitCount,
        compressedCount,

        apiRequestAttempts,
        apiRequestSuccesses,

        skippedLimitCount,
        skippedApiErrorCount,

        sourceChangedCount,
        failedCount,

        previewFileCount,

        previewSourceBytes,
        previewCompressedBytes,

        previewSavedBytes:
            previewSourceBytes -
            previewCompressedBytes,
    };
}

async function writeRunReport(
    config: ResolvedSourceImageOptimizerConfig,
    report: TinyPngPreviewRunReport,
): Promise<string> {
    const reportPath = path.join(
        config.resolvedWorkspaceDirectory,
        "reports",
        "tinypng-preview-run.json",
    );

    await mkdir(
        path.dirname(reportPath),
        {
            recursive: true,
        },
    );

    await writeFile(
        reportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
    );

    return reportPath;
}

async function main(): Promise<void> {
    const options =
        parseCommandOptions(
            process.argv.slice(2),
        );

    const startedAt =
        new Date().toISOString();

    const config =
        await loadSourceImageOptimizerConfig(
            options.configPath,
            process.cwd(),
        );

    const {
        manifestPath,
        manifest,
    } = await loadCandidateManifest(
        config,
    );

    const cache =
        await loadTinyPngCache(config);

    /*
     * 优先处理体积较大的文件，
     * 让有限 API 次数获得更高收益。
     */
    const candidates = [
        ...manifest.files,
    ].sort(
        (left, right) =>
            right.sizeBytes -
            left.sizeBytes,
    );

    const items:
        TinyPngPreviewRunItem[] = [];

    const pending:
        PreparedCandidate[] = [];

    console.log("TinyPNG 批量预览");
    console.log("----------------");
    console.log(
        `项目：${config.projectName}`,
    );
    console.log(
        `候选数量：${candidates.length}`,
    );

    console.log(
        `API 请求上限：${options.apiRequestLimit === null
            ? "不限"
            : options.apiRequestLimit
        }`,
    );

    console.log();
    console.log(
        "正在检查源文件和本地缓存……",
    );

    for (const candidate of candidates) {
        try {
            const sourcePath =
                resolvePortableRelativePath(
                    config.resolvedProjectRoot,
                    candidate.projectRelativePath,
                );

            if (
                !isPathInsideDirectory(
                    sourcePath,
                    config.resolvedAssetsDirectory,
                )
            ) {
                throw new Error(
                    `候选文件不在 assets 目录：${sourcePath}`,
                );
            }

            const sourceBuffer =
                await readFile(sourcePath);

            const currentSha256 =
                calculateImageSha256(
                    sourceBuffer,
                );

            if (
                currentSha256 !==
                candidate.sha256
            ) {
                items.push(
                    createIncompleteItem(
                        candidate,
                        "source-changed",
                        [
                            "源文件哈希与 candidates.json 不一致。",
                            `清单：${candidate.sha256}`,
                            `当前：${currentSha256}`,
                            "请重新运行 analyze:source-images。",
                        ].join(" "),
                    ),
                );

                continue;
            }

            const cacheLookup =
                await lookupTinyPngCache(
                    cache,
                    candidate.sha256,
                );

            if (
                cacheLookup.status ===
                "hit"
            ) {
                const previewPath =
                    await writePreviewFile(
                        config,
                        candidate,
                        cacheLookup.compressedFilePath,
                    );

                items.push(
                    createCompletedItem(
                        candidate,
                        "cache-hit",
                        cacheLookup.entry
                            .compressedBytes,
                        previewPath,
                        null,
                        "命中本地缓存，未调用 TinyPNG API。",
                    ),
                );

                continue;
            }

            pending.push({
                candidate,
                sourcePath,
                sourceBuffer,

                invalidCacheReason:
                    cacheLookup.status ===
                        "invalid"
                        ? cacheLookup.reason
                        : null,
            });
        } catch (error) {
            items.push(
                createIncompleteItem(
                    candidate,
                    "failed",
                    toErrorMessage(error),
                ),
            );
        }
    }

    const allowedRequestCount =
        options.apiRequestLimit === null
            ? pending.length
            : Math.min(
                options.apiRequestLimit,
                pending.length,
            );

    console.log(
        `缓存命中：${items.filter(
            (item) =>
                item.status ===
                "cache-hit",
        ).length
        }`,
    );

    console.log(
        `缓存未命中：${pending.length}`,
    );

    console.log(
        `本次最多新增请求：${allowedRequestCount}`,
    );

    let apiRequestAttempts = 0;
    let apiRequestSuccesses = 0;

    let lastCompressionCount:
        number | null = null;

    let client:
        ReturnType<
            typeof createTinyPngClientFromEnvironment
        > | null = null;

    let apiStoppedMessage:
        string | null = null;

    for (
        let index = 0;
        index < pending.length;
        index += 1
    ) {
        const prepared = pending[index];

        if (!prepared) {
            continue;
        }

        const {
            candidate,
            sourceBuffer,
        } = prepared;

        if (apiStoppedMessage !== null) {
            items.push(
                createIncompleteItem(
                    candidate,
                    "skipped-api-error",
                    apiStoppedMessage,
                ),
            );

            continue;
        }

        if (
            apiRequestAttempts >=
            allowedRequestCount
        ) {
            items.push(
                createIncompleteItem(
                    candidate,
                    "skipped-limit",
                    "达到本次 API 请求上限。",
                ),
            );

            continue;
        }

        console.log();
        console.log(
            `[${apiRequestAttempts + 1}/${allowedRequestCount}] ` +
            candidate.projectRelativePath,
        );

        if (
            prepared.invalidCacheReason
        ) {
            console.warn(
                `缓存无效，将重新压缩：` +
                prepared.invalidCacheReason,
            );
        }

        apiRequestAttempts += 1;

        try {
            client ??=
                createTinyPngClientFromEnvironment();

            const compressionResult =
                await client.compressBuffer(
                    sourceBuffer,
                );

            validateCompressedImage(
                sourceBuffer,
                compressionResult.compressedBuffer,
                candidate,
            );

            await storeTinyPngCacheResult(
                cache,
                candidate,
                compressionResult.compressedBuffer,
            );

            const storedLookup =
                await lookupTinyPngCache(
                    cache,
                    candidate.sha256,
                );

            if (
                storedLookup.status !==
                "hit"
            ) {
                throw new Error(
                    storedLookup.status ===
                        "invalid"
                        ? `缓存写入后校验失败：${storedLookup.reason}`
                        : "缓存写入后无法读取。",
                );
            }

            const previewPath =
                await writePreviewFile(
                    config,
                    candidate,
                    storedLookup.compressedFilePath,
                );

            apiRequestSuccesses += 1;

            lastCompressionCount =
                compressionResult
                    .compressionCount;

            const message =
                storedLookup.entry
                    .compressedBytes >=
                    storedLookup.entry
                        .sourceBytes
                    ? "压缩结果没有小于原图；后续应用阶段不会覆盖源文件。"
                    : null;

            items.push(
                createCompletedItem(
                    candidate,
                    "compressed",
                    storedLookup.entry
                        .compressedBytes,
                    previewPath,
                    compressionResult
                        .compressionCount,
                    message,
                ),
            );

            const savedBytes =
                candidate.sizeBytes -
                storedLookup.entry
                    .compressedBytes;

            const savedPercent =
                candidate.sizeBytes > 0
                    ? (
                        savedBytes /
                        candidate.sizeBytes *
                        100
                    )
                    : 0;

            console.log(
                `${formatBytes(candidate.sizeBytes)} -> ` +
                `${formatBytes(
                    storedLookup.entry
                        .compressedBytes,
                )}，` +
                `减少 ${savedPercent.toFixed(2)}%`,
            );
        } catch (error) {
            const message =
                toErrorMessage(error);

            items.push(
                createIncompleteItem(
                    candidate,
                    "failed",
                    message,
                ),
            );

            /*
             * API 或网络请求一旦失败，
             * 本次运行不再继续发送更多请求，
             * 防止重复失败或快速消耗请求额度。
             */
            apiStoppedMessage =
                `前一个 TinyPNG 请求失败，` +
                `已停止本次后续 API 请求：` +
                message;
        }
    }

    items.sort(
        (left, right) =>
            left.projectRelativePath
                .localeCompare(
                    right.projectRelativePath,
                    "en",
                ),
    );

    const summary =
        buildSummary(
            candidates.length,
            items,
            apiRequestAttempts,
            apiRequestSuccesses,
        );

    const report: TinyPngPreviewRunReport = {
        schemaVersion: 1,

        startedAt,
        completedAt:
            new Date().toISOString(),

        projectName:
            config.projectName,

        candidateManifestPath:
            manifestPath,

        apiRequestLimit:
            options.apiRequestLimit,

        summary,
        files: items,

        notes: [
            "该命令只生成 preview 文件，不修改 Cocos Creator 源资源。",
            "API 请求限制只计算本次新增请求，不计算缓存命中。",
            "候选按源文件体积从大到小发送给 TinyPNG。",
            "每个 TinyPNG 成功结果都会立即写入 SHA-256 缓存。",
            "源文件哈希变化时不会继续压缩，需要重新生成 candidates.json。",
            "压缩结果不小于原图时仍保留缓存和预览，但应用阶段不会覆盖源图。",
        ],
    };

    const reportPath =
        await writeRunReport(
            config,
            report,
        );

    console.log();
    console.log("批量预览完成");
    console.log("------------");

    console.log(
        `缓存命中：${summary.cacheHitCount}`,
    );

    console.log(
        `新增压缩：${summary.compressedCount}`,
    );

    console.log(
        `API 请求尝试：${summary.apiRequestAttempts}`,
    );

    console.log(
        `API 请求成功：${summary.apiRequestSuccesses}`,
    );

    console.log(
        `达到上限跳过：${summary.skippedLimitCount}`,
    );

    console.log(
        `源文件变化：${summary.sourceChangedCount}`,
    );

    console.log(
        `失败：${summary.failedCount}`,
    );

    console.log(
        `已生成预览：${summary.previewFileCount}`,
    );

    console.log(
        `预览原始体积：` +
        formatBytes(
            summary.previewSourceBytes,
        ),
    );

    console.log(
        `预览压缩体积：` +
        formatBytes(
            summary.previewCompressedBytes,
        ),
    );

    console.log(
        `预览减少体积：` +
        formatBytes(
            summary.previewSavedBytes,
        ),
    );

    if (
        summary.previewSourceBytes > 0
    ) {
        console.log(
            `综合压缩收益：${(
                summary.previewSavedBytes /
                summary.previewSourceBytes *
                100
            ).toFixed(2)}%`,
        );
    }

    if (lastCompressionCount !== null) {
        console.log(
            `本月 API 压缩次数：${lastCompressionCount}`,
        );
    }

    console.log(
        `运行报告：${reportPath}`,
    );

    if (
        summary.failedCount > 0 ||
        summary.sourceChangedCount > 0
    ) {
        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error();
    console.error(
        "TinyPNG 批量预览失败：",
    );

    if (error instanceof Error) {
        console.error(error.message);

        if (error.cause) {
            console.error();
            console.error("原始错误：");
            console.error(error.cause);
        }
    } else {
        console.error(error);
    }

    process.exitCode = 1;
});