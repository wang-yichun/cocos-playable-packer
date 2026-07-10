import {
    readFile,
} from "node:fs/promises";

import path from "node:path";

import {
    calculateImageSha256,
    inspectImageBufferMetadata,
} from "../tinypng/image-inspector.js";

import {
    createTinyPngClientFromEnvironment,
    type TinyPngClient,
} from "../tinypng/tinypng-client.js";

import {
    toErrorMessage,
    writeBufferAtomically,
    writeJsonAtomically,
} from "../tinypng/file-utils.js";

import {
    findBuildCacheEntryByCompressedSha256,
    findBuildCacheEntryBySourceSha256,
    loadBuildImageCache,
    lookupCompressedBuildImage,
    removeBuildImageCacheEntry,
    saveBuildImageCacheIndex,
    storeCompressedBuildImage,
    storeFailedBuildImage,
    storeNoBenefitBuildImage,
} from "./build-cache.js";

import {
    scanBuildImages,
} from "./build-image-scanner.js";

import type {
    BuildImageCliOptions,
    BuildImageExtension,
    BuildImageFormat,
    BuildImageMetadata,
    BuildImageOptimizationReport,
    BuildImageOptimizationSummary,
    BuildImageReportItem,
    ScannedBuildImageFile,
} from "./types.js";

import {
    validateCocosBuildDirectory,
} from "./validate-cocos-build.js";

const DEFAULT_MINIMUM_SOURCE_BYTES = 4096;

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(
        bytes / 1024 / 1024
    ).toFixed(2)} MB`;
}

function parseNonNegativeInteger(
    value: string,
    optionName: string,
): number {
    if (!/^\d+$/.test(value)) {
        throw new Error(
            `${optionName} 必须是非负整数，当前值：${value}`,
        );
    }

    const result = Number(value);

    if (!Number.isSafeInteger(result)) {
        throw new Error(
            `${optionName} 超出安全整数范围：${value}`,
        );
    }

    return result;
}

function parseCliOptions(
    argv: readonly string[],
): BuildImageCliOptions {
    const positionalArguments: string[] = [];

    let all = false;
    let apiRequestLimit: number | null = null;
    let minimumSourceBytes =
        DEFAULT_MINIMUM_SOURCE_BYTES;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (
            argument === undefined ||
            argument === "--"
        ) {
            continue;
        }

        if (argument === "--all") {
            all = true;
            continue;
        }

        if (argument.startsWith("--limit=")) {
            apiRequestLimit =
                parseNonNegativeInteger(
                    argument.slice("--limit=".length),
                    "--limit",
                );

            continue;
        }

        if (argument === "--limit") {
            const value = argv[index + 1];

            if (value === undefined) {
                throw new Error(
                    "--limit 后缺少数值。",
                );
            }

            apiRequestLimit =
                parseNonNegativeInteger(
                    value,
                    "--limit",
                );

            index += 1;
            continue;
        }

        if (argument.startsWith("--min-bytes=")) {
            minimumSourceBytes =
                parseNonNegativeInteger(
                    argument.slice(
                        "--min-bytes=".length,
                    ),
                    "--min-bytes",
                );

            continue;
        }

        if (argument === "--min-bytes") {
            const value = argv[index + 1];

            if (value === undefined) {
                throw new Error(
                    "--min-bytes 后缺少数值。",
                );
            }

            minimumSourceBytes =
                parseNonNegativeInteger(
                    value,
                    "--min-bytes",
                );

            index += 1;
            continue;
        }

        if (argument.startsWith("-")) {
            throw new Error(
                `无法识别的参数：${argument}`,
            );
        }

        positionalArguments.push(argument);
    }

    if (positionalArguments.length !== 1) {
        throw new Error(
            [
                "必须提供一个 Cocos Creator Web 构建目录。",
                "",
                "示例：",
                "npm run tinypng:build -- -- \"./web-mobile\" --limit=5",
                "npm run tinypng:build -- -- \"./web-mobile\" --all",
                "npm run tinypng:build -- -- \"./web-mobile\" --all --min-bytes=0",
            ].join("\n"),
        );
    }

    if (all && apiRequestLimit !== null) {
        throw new Error(
            "--all 与 --limit 不能同时使用。",
        );
    }

    if (!all && apiRequestLimit === null) {
        throw new Error(
            "必须显式指定 --all 或 --limit=N，避免意外消耗 TinyPNG API 配额。",
        );
    }

    return {
        buildDirectoryArgument:
            positionalArguments[0] as string,
        apiRequestLimit:
            all
                ? null
                : apiRequestLimit,
        minimumSourceBytes,
    };
}

function getExpectedFormat(
    extension: BuildImageExtension,
): BuildImageFormat {
    return extension === ".png"
        ? "png"
        : "jpeg";
}

function inspectAndValidateImage(
    buffer: Buffer,
    extension: BuildImageExtension,
    displayPath: string,
): BuildImageMetadata {
    const metadata =
        inspectImageBufferMetadata(buffer);

    const expectedFormat =
        getExpectedFormat(extension);

    if (metadata.format !== expectedFormat) {
        throw new Error(
            `图片扩展名与文件内容不一致：${displayPath}，` +
            `扩展名=${extension}，检测格式=${metadata.format}`,
        );
    }

    return {
        format: expectedFormat,
        ...(metadata.width !== null
            ? { width: metadata.width }
            : {}),
        ...(metadata.height !== null
            ? { height: metadata.height }
            : {}),
    };
}

function validateCompressedResult(
    source: BuildImageMetadata,
    compressedBuffer: Buffer,
    extension: BuildImageExtension,
    displayPath: string,
): BuildImageMetadata {
    const compressed = inspectAndValidateImage(
        compressedBuffer,
        extension,
        displayPath,
    );

    if (
        source.width !== undefined &&
        compressed.width !== source.width
    ) {
        throw new Error(
            `TinyPNG 返回图片宽度发生变化：${displayPath}`,
        );
    }

    if (
        source.height !== undefined &&
        compressed.height !== source.height
    ) {
        throw new Error(
            `TinyPNG 返回图片高度发生变化：${displayPath}`,
        );
    }

    return compressed;
}

function createEmptySummary():
    BuildImageOptimizationSummary {
    return {
        scannedImages: 0,
        alreadyCompressed: 0,
        cacheHitAndReplaced: 0,
        negativeCacheHits: 0,
        apiRequests: 0,
        apiCompressedAndReplaced: 0,
        apiNoBenefit: 0,
        skippedByMinBytes: 0,
        skippedByApiLimit: 0,
        skippedAfterApiFailure: 0,
        cacheInvalid: 0,
        replacedImages: 0,
        failedImages: 0,
        sourceBytesScanned: 0,
        finalBytes: 0,
        savedBytesThisRun: 0,
    };
}

function addReportItem(
    files: BuildImageReportItem[],
    summary: BuildImageOptimizationSummary,
    item: BuildImageReportItem,
): void {
    files.push(item);

    summary.sourceBytesScanned +=
        item.sourceBytes;

    summary.finalBytes +=
        item.finalBytes;

    summary.savedBytesThisRun +=
        item.savedBytes;
}

function canIssueApiRequest(
    limit: number | null,
    requestsMade: number,
): boolean {
    return (
        limit === null ||
        requestsMade < limit
    );
}

function printProgress(
    index: number,
    total: number,
    file: ScannedBuildImageFile,
    message: string,
): void {
    console.log(
        `[${index + 1}/${total}] ${message} ` +
        file.relativePath,
    );
}

async function writeReport(
    report: BuildImageOptimizationReport,
    reportsDirectory: string,
): Promise<{
    latestPath: string;
    archivePath: string;
}> {
    const safeTimestamp = report.startedAt
        .replace(/[:.]/g, "-");

    const archivePath = path.join(
        reportsDirectory,
        `report-${safeTimestamp}.json`,
    );

    const latestPath = path.join(
        reportsDirectory,
        "latest.json",
    );

    await writeJsonAtomically(
        archivePath,
        report,
    );

    await writeJsonAtomically(
        latestPath,
        report,
    );

    return {
        latestPath,
        archivePath,
    };
}

async function main(): Promise<void> {
    const options = parseCliOptions(
        process.argv.slice(2),
    );

    const startedAt = new Date().toISOString();

    const build =
        await validateCocosBuildDirectory(
            options.buildDirectoryArgument,
        );

    const cache =
        await loadBuildImageCache();

    const files = await scanBuildImages(
        build.rootDirectory,
    );

    const summary = createEmptySummary();
    summary.scannedImages = files.length;

    const reportItems: BuildImageReportItem[] = [];

    let client: TinyPngClient | null = null;
    let compressionCountStart: number | null = null;
    let compressionCountEnd: number | null = null;
    let stopNewApiRequests = false;

    console.log(
        `构建目录：${build.rootDirectory}`,
    );
    console.log(
        `构建图片缓存：${cache.cacheDirectory}`,
    );
    console.log(
        `扫描到 PNG/JPG/JPEG：${files.length} 张`,
    );
    console.log(
        options.apiRequestLimit === null
            ? "API 模式：--all"
            : `API 模式：--limit=${options.apiRequestLimit}`,
    );
    console.log(
        `最小原图尺寸：${options.minimumSourceBytes} B` +
        (
            options.minimumSourceBytes === 0
                ? "（不按尺寸跳过）"
                : ""
        ),
    );
    console.log("");

    for (
        let index = 0;
        index < files.length;
        index += 1
    ) {
        const file = files[index];

        if (!file) {
            continue;
        }

        let sourceBuffer: Buffer;

        try {
            sourceBuffer = await readFile(
                file.absolutePath,
            );
        } catch (error) {
            summary.failedImages += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    relativePath: file.relativePath,
                    extension: file.extension,
                    sourceBytes: 0,
                    finalBytes: 0,
                    savedBytes: 0,
                    action: "failed",
                    message:
                        `无法读取图片：${toErrorMessage(error)}`,
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "失败：无法读取",
            );

            continue;
        }

        const sourceBytes = sourceBuffer.length;
        const sourceSha256 =
            calculateImageSha256(sourceBuffer);

        let metadata: BuildImageMetadata;

        try {
            metadata = inspectAndValidateImage(
                sourceBuffer,
                file.extension,
                file.relativePath,
            );
        } catch (error) {
            const fallbackMetadata:
                BuildImageMetadata = {
                    format: getExpectedFormat(
                        file.extension,
                    ),
                };

            storeFailedBuildImage(
                cache,
                sourceSha256,
                file.extension,
                sourceBytes,
                fallbackMetadata,
                error,
            );

            await saveBuildImageCacheIndex(cache);

            summary.failedImages += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    relativePath: file.relativePath,
                    extension: file.extension,
                    sourceSha256,
                    sourceBytes,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "failed",
                    cacheStatus: "failed",
                    message: toErrorMessage(error),
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "失败：格式验证",
            );

            continue;
        }

        const commonReportFields = {
            relativePath: file.relativePath,
            extension: file.extension,
            sourceSha256,
            sourceBytes,
            ...(metadata.width !== undefined
                ? { width: metadata.width }
                : {}),
            ...(metadata.height !== undefined
                ? { height: metadata.height }
                : {}),
        };

        const compressedEntry =
            findBuildCacheEntryByCompressedSha256(
                cache,
                sourceSha256,
            );

        if (compressedEntry) {
            summary.alreadyCompressed += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalSha256: sourceSha256,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "already-compressed",
                    cacheStatus: "compressed",
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "已是 TinyPNG 输出：",
            );

            continue;
        }

        const sourceEntry =
            findBuildCacheEntryBySourceSha256(
                cache,
                sourceSha256,
            );

        if (sourceEntry?.status === "compressed") {
            const lookup =
                await lookupCompressedBuildImage(
                    cache,
                    sourceEntry,
                );

            if (
                lookup.status === "hit" &&
                lookup.compressedBuffer
            ) {
                try {
                    await writeBufferAtomically(
                        file.absolutePath,
                        lookup.compressedBuffer,
                    );
                } catch (error) {
                    summary.failedImages += 1;

                    addReportItem(
                        reportItems,
                        summary,
                        {
                            ...commonReportFields,
                            finalBytes: sourceBytes,
                            savedBytes: 0,
                            action: "failed",
                            cacheStatus: "compressed",
                            message:
                                "缓存有效，但替换构建图片失败：" +
                                toErrorMessage(error),
                        },
                    );

                    printProgress(
                        index,
                        files.length,
                        file,
                        "失败：缓存替换",
                    );

                    continue;
                }

                const savedBytes =
                    sourceBytes -
                    lookup.compressedBuffer.length;

                summary.cacheHitAndReplaced += 1;
                summary.replacedImages += 1;

                addReportItem(
                    reportItems,
                    summary,
                    {
                        ...commonReportFields,
                        finalSha256:
                            calculateImageSha256(
                                lookup.compressedBuffer,
                            ),
                        finalBytes:
                            lookup.compressedBuffer.length,
                        savedBytes,
                        action: "cache-replaced",
                        cacheStatus: "compressed",
                    },
                );

                printProgress(
                    index,
                    files.length,
                    file,
                    `缓存替换，节省 ${formatBytes(savedBytes)}：`,
                );

                continue;
            }

            summary.cacheInvalid += 1;

            console.warn(
                `[缓存无效] ${file.relativePath}：` +
                `${lookup.reason ?? "未知原因"}`,
            );

            removeBuildImageCacheEntry(
                cache,
                sourceSha256,
            );

            await saveBuildImageCacheIndex(cache);
        } else if (
            sourceEntry?.status === "no-benefit"
        ) {
            summary.negativeCacheHits += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "negative-cache-hit",
                    cacheStatus: "no-benefit",
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "负缓存命中：",
            );

            continue;
        }

        if (
            sourceBytes <
            options.minimumSourceBytes
        ) {
            summary.skippedByMinBytes += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action:
                        "skipped-below-min-bytes",
                    message:
                        `原图 ${sourceBytes} B，小于最小处理尺寸 ` +
                        `${options.minimumSourceBytes} B。`,
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "跳过：低于最小尺寸",
            );

            continue;
        }

        if (stopNewApiRequests) {
            summary.skippedAfterApiFailure += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "skipped-after-api-failure",
                    message:
                        "本次运行此前已有 TinyPNG API 失败，后续新图片停止请求。",
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "跳过：API 已停止",
            );

            continue;
        }

        if (
            !canIssueApiRequest(
                options.apiRequestLimit,
                summary.apiRequests,
            )
        ) {
            summary.skippedByApiLimit += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "skipped-api-limit",
                    message:
                        "TinyPNG API 请求上限已用完。",
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "跳过：达到 API 上限",
            );

            continue;
        }

        let result:
            Awaited<
                ReturnType<
                    TinyPngClient["compressBuffer"]
                >
            >;

        try {
            if (!client) {
                client =
                    createTinyPngClientFromEnvironment();
            }

            summary.apiRequests += 1;

            result = await client.compressBuffer(
                sourceBuffer,
            );

            if (compressionCountStart === null) {
                compressionCountStart =
                    result.compressionCount !== null
                        ? result.compressionCount - 1
                        : null;
            }

            compressionCountEnd =
                result.compressionCount;

            validateCompressedResult(
                metadata,
                result.compressedBuffer,
                file.extension,
                file.relativePath,
            );
        } catch (error) {
            storeFailedBuildImage(
                cache,
                sourceSha256,
                file.extension,
                sourceBytes,
                metadata,
                error,
            );

            await saveBuildImageCacheIndex(cache);

            summary.failedImages += 1;
            stopNewApiRequests = true;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "failed",
                    cacheStatus: "failed",
                    message: toErrorMessage(error),
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "失败：TinyPNG",
            );

            console.error(
                toErrorMessage(error),
            );

            continue;
        }

        if (
            result.compressedBuffer.length >=
            sourceBytes
        ) {
            try {
                storeNoBenefitBuildImage(
                    cache,
                    sourceSha256,
                    file.extension,
                    sourceBytes,
                    metadata,
                    result.compressedBuffer.length,
                );

                await saveBuildImageCacheIndex(cache);
            } catch (error) {
                summary.failedImages += 1;
                stopNewApiRequests = true;

                addReportItem(
                    reportItems,
                    summary,
                    {
                        ...commonReportFields,
                        finalBytes: sourceBytes,
                        savedBytes: 0,
                        action: "failed",
                        message:
                            "TinyPNG 无压缩收益，但写入负缓存失败：" +
                            toErrorMessage(error),
                    },
                );

                printProgress(
                    index,
                    files.length,
                    file,
                    "失败：写入负缓存",
                );

                continue;
            }

            summary.apiNoBenefit += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "api-no-benefit",
                    cacheStatus: "no-benefit",
                    message:
                        `TinyPNG 返回 ${formatBytes(
                            result.compressedBuffer.length,
                        )}，不小于原图。`,
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "无收益，写入负缓存：",
            );

            continue;
        }

        try {
            await storeCompressedBuildImage(
                cache,
                sourceSha256,
                file.extension,
                sourceBytes,
                metadata,
                result.compressedBuffer,
            );

            await saveBuildImageCacheIndex(cache);
        } catch (error) {
            summary.failedImages += 1;
            stopNewApiRequests = true;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "failed",
                    message:
                        "TinyPNG 压缩成功，但写入缓存失败：" +
                        toErrorMessage(error),
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "失败：写入压缩缓存",
            );

            continue;
        }

        try {
            await writeBufferAtomically(
                file.absolutePath,
                result.compressedBuffer,
            );
        } catch (error) {
            summary.failedImages += 1;

            addReportItem(
                reportItems,
                summary,
                {
                    ...commonReportFields,
                    finalBytes: sourceBytes,
                    savedBytes: 0,
                    action: "failed",
                    cacheStatus: "compressed",
                    message:
                        "压缩缓存已保存，但替换构建图片失败：" +
                        toErrorMessage(error),
                },
            );

            printProgress(
                index,
                files.length,
                file,
                "失败：替换构建图片",
            );

            continue;
        }

        const savedBytes =
            sourceBytes -
            result.compressedBuffer.length;

        summary.apiCompressedAndReplaced += 1;
        summary.replacedImages += 1;

        addReportItem(
            reportItems,
            summary,
            {
                ...commonReportFields,
                finalSha256:
                    calculateImageSha256(
                        result.compressedBuffer,
                    ),
                finalBytes:
                    result.compressedBuffer.length,
                savedBytes,
                action: "api-compressed",
                cacheStatus: "compressed",
            },
        );

        printProgress(
            index,
            files.length,
            file,
            `API 压缩并替换，节省 ${formatBytes(savedBytes)}：`,
        );
    }

    const completedAt = new Date().toISOString();

    const report: BuildImageOptimizationReport = {
        schemaVersion: 1,
        tool: "tinypng-build",
        startedAt,
        completedAt,
        buildDirectory: build.rootDirectory,
        cacheDirectory: cache.cacheDirectory,
        mode:
            options.apiRequestLimit === null
                ? { type: "all" }
                : {
                    type: "limit",
                    limit:
                        options.apiRequestLimit,
                },
        minimumSourceBytes:
            options.minimumSourceBytes,
        tinyPngCompressionCountStart:
            compressionCountStart,
        tinyPngCompressionCountEnd:
            compressionCountEnd,
        summary,
        files: reportItems,
    };

    const reportPaths = await writeReport(
        report,
        cache.reportsDirectory,
    );

    console.log("");
    console.log("TinyPNG 构建图片处理完成");
    console.log(`构建图片扫描数量：${summary.scannedImages}`);
    console.log(`已是 TinyPNG 输出数量：${summary.alreadyCompressed}`);
    console.log(`缓存命中并替换数量：${summary.cacheHitAndReplaced}`);
    console.log(`负缓存命中数量：${summary.negativeCacheHits}`);
    console.log(`新增 API 请求数量：${summary.apiRequests}`);
    console.log(`API 压缩并替换数量：${summary.apiCompressedAndReplaced}`);
    console.log(`替换数量：${summary.replacedImages}`);
    console.log(`无收益数量：${summary.apiNoBenefit}`);
    console.log(`低于最小尺寸跳过：${summary.skippedByMinBytes}`);
    console.log(`缓存无效数量：${summary.cacheInvalid}`);
    console.log(`达到 API 上限跳过：${summary.skippedByApiLimit}`);
    console.log(`API 失败后跳过：${summary.skippedAfterApiFailure}`);
    console.log(`失败数量：${summary.failedImages}`);
    console.log(`本次替换节省：${formatBytes(summary.savedBytesThisRun)}`);
    console.log(`JSON 报告：${reportPaths.latestPath}`);
    console.log(`归档报告：${reportPaths.archivePath}`);

    if (summary.failedImages > 0) {
        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error(
        `tinypng:build 失败：${toErrorMessage(error)}`,
    );

    process.exitCode = 1;
});
