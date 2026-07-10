import path from "node:path";

import {
    detectAutoAtlasDirectories,
} from "./auto-atlas-detector.js";

import {
    classifySourceImageFiles,
} from "./image-classifier.js";

import {
    loadSourceImageOptimizerConfig,
} from "./config.js";

import {
    scanSourceImageFiles,
} from "./file-scanner.js";

import {
    inspectSourceImageFiles,
} from "./image-inspector.js";

import {
    writeSourceImageAnalysisOutputs,
} from "./report-writer.js";

import type {
    ClassifiedSourceImageFile,
    InspectedSourceImageFile,
    ScannedSourceImageFile,
    SourceImageClassification,
} from "./types.js";

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function sumFileBytes(
    files: readonly ScannedSourceImageFile[],
): number {
    return files.reduce(
        (total, file) => total + file.sizeBytes,
        0,
    );
}

function countByExtension(
    files: readonly ScannedSourceImageFile[],
): Map<string, {
    count: number;
    bytes: number;
}> {
    const result = new Map<string, {
        count: number;
        bytes: number;
    }>();

    for (const file of files) {
        const current = result.get(file.extension) ?? {
            count: 0,
            bytes: 0,
        };

        current.count += 1;
        current.bytes += file.sizeBytes;

        result.set(file.extension, current);
    }

    return result;
}

function printMetadataSummary(
    files: readonly InspectedSourceImageFile[],
): void {
    let pngCount = 0;
    let jpegCount = 0;
    let unknownCount = 0;

    let alphaCount = 0;
    let noAlphaCount = 0;
    let unknownAlphaCount = 0;

    let parsedDimensionsCount = 0;

    for (const file of files) {
        switch (file.metadata.format) {
            case "png":
                pngCount += 1;
                break;

            case "jpeg":
                jpegCount += 1;
                break;

            default:
                unknownCount += 1;
                break;
        }

        if (
            file.metadata.width !== null &&
            file.metadata.height !== null
        ) {
            parsedDimensionsCount += 1;
        }

        if (file.metadata.hasAlpha === true) {
            alphaCount += 1;
        } else if (file.metadata.hasAlpha === false) {
            noAlphaCount += 1;
        } else {
            unknownAlphaCount += 1;
        }
    }

    console.log();
    console.log("图片元数据：");
    console.log(`PNG：${pngCount}`);
    console.log(`JPEG：${jpegCount}`);
    console.log(`未知格式：${unknownCount}`);

    console.log(
        `成功解析宽高：` +
        `${parsedDimensionsCount}/${files.length}`,
    );

    console.log(`包含透明信息：${alphaCount}`);
    console.log(`不包含透明信息：${noAlphaCount}`);
    console.log(`透明信息未知：${unknownAlphaCount}`);
}

function printDuplicateHashSummary(
    files: readonly InspectedSourceImageFile[],
): void {
    const groups = new Map<
        string,
        InspectedSourceImageFile[]
    >();

    for (const file of files) {
        const group = groups.get(file.sha256) ?? [];
        group.push(file);
        groups.set(file.sha256, group);
    }

    const duplicateGroups = [...groups.values()]
        .filter((group) => group.length > 1);

    const duplicateFileCount = duplicateGroups.reduce(
        (total, group) => total + group.length - 1,
        0,
    );

    const duplicateBytes = duplicateGroups.reduce(
        (total, group) => {
            const firstFile = group[0];

            if (!firstFile) {
                return total;
            }

            return (
                total +
                firstFile.sizeBytes *
                (group.length - 1)
            );
        },
        0,
    );

    console.log();
    console.log("内容哈希：");
    console.log(`重复内容组：${duplicateGroups.length}`);
    console.log(`额外重复文件：${duplicateFileCount}`);

    console.log(
        `重复原始体积：${formatBytes(duplicateBytes)}`,
    );
}

type ClassificationStats = Record<
    SourceImageClassification,
    {
        count: number;
        bytes: number;
    }
>;

function createClassificationStats():
    ClassificationStats {
    return {
        safe: {
            count: 0,
            bytes: 0,
        },

        atlas: {
            count: 0,
            bytes: 0,
        },

        "special-texture": {
            count: 0,
            bytes: 0,
        },

        "manual-review": {
            count: 0,
            bytes: 0,
        },

        "too-small": {
            count: 0,
            bytes: 0,
        },

        unsupported: {
            count: 0,
            bytes: 0,
        },
    };
}

function printClassificationSummary(
    files: readonly ClassifiedSourceImageFile[],
): void {
    const stats = createClassificationStats();

    for (const file of files) {
        const current = stats[file.classification];

        current.count += 1;
        current.bytes += file.sizeBytes;
    }

    const rows: Array<{
        classification: SourceImageClassification;
        label: string;
    }> = [
            {
                classification: "safe",
                label: "安全候选",
            },
            {
                classification: "atlas",
                label: "自动图集",
            },
            {
                classification: "special-texture",
                label: "特殊纹理",
            },
            {
                classification: "manual-review",
                label: "人工检查",
            },
            {
                classification: "too-small",
                label: "体积过小",
            },
            {
                classification: "unsupported",
                label: "不支持",
            },
        ];

    console.log();
    console.log("压缩候选分类：");

    for (const row of rows) {
        const current = stats[row.classification];

        console.log(
            `${row.label.padEnd(8, " ")} ` +
            `${String(current.count).padStart(4, " ")} 张  ` +
            formatBytes(current.bytes).padStart(10, " "),
        );
    }
}

function printLargestClassificationFiles(
    files: readonly ClassifiedSourceImageFile[],
    classification: SourceImageClassification,
    title: string,
    limit: number,
): void {
    const selectedFiles = files
        .filter(
            (file) =>
                file.classification === classification,
        )
        .sort(
            (left, right) =>
                right.sizeBytes - left.sizeBytes,
        )
        .slice(0, limit);

    console.log();
    console.log(
        `${title}（前 ${selectedFiles.length} 张）：`,
    );

    if (selectedFiles.length === 0) {
        console.log("无");
        return;
    }

    for (
        const [index, file]
        of selectedFiles.entries()
    ) {
        const dimensions =
            file.metadata.width !== null &&
                file.metadata.height !== null
                ? `${file.metadata.width}x` +
                `${file.metadata.height}`
                : "unknown";

        console.log(
            `${String(index + 1).padStart(2, " ")}. ` +
            `${formatBytes(file.sizeBytes).padStart(10, " ")}  ` +
            `${dimensions.padStart(11, " ")}  ` +
            file.projectRelativePath,
        );

        if (classification !== "safe") {
            console.log(
                `    原因：${file.reasons.join("；")}`,
            );
        }
    }
}

async function main(): Promise<void> {
    const configArgument = process.argv[2];

    if (!configArgument) {
        throw new Error(
            [
                "缺少配置文件参数。",
                "",
                "用法：",
                "npm run analyze:source-images -- " +
                "\"./configs/game141-source-images.json\"",
            ].join("\n"),
        );
    }

    const toolRoot = process.cwd();

    console.log("TinyPNG 源图片分析");
    console.log("------------------");
    console.log(`工具目录：${toolRoot}`);

    console.log(
        `配置参数：${path.normalize(configArgument)}`,
    );

    const config =
        await loadSourceImageOptimizerConfig(
            configArgument,
            toolRoot,
        );

    console.log();
    console.log(`项目名称：${config.projectName}`);
    console.log(`项目目录：${config.resolvedProjectRoot}`);

    console.log(
        `资源目录：${config.resolvedAssetsDirectory}`,
    );

    console.log(
        `工作目录：${config.resolvedWorkspaceDirectory}`,
    );

    console.log(
        `缓存目录：${config.resolvedCacheDirectory}`,
    );

    console.log();
    console.log("正在扫描源图片……");

    const scanStartedAt = performance.now();

    const scannedFiles =
        await scanSourceImageFiles(config);

    const scanElapsedMs =
        performance.now() - scanStartedAt;

    console.log(
        `扫描到 ${scannedFiles.length} 张图片，` +
        `耗时 ${scanElapsedMs.toFixed(2)} ms`,
    );

    console.log();
    console.log("正在读取图片哈希和元数据……");

    const inspectStartedAt = performance.now();

    const inspectedFiles =
        await inspectSourceImageFiles(
            scannedFiles,
            8,
        );

    const inspectElapsedMs =
        performance.now() - inspectStartedAt;

    console.log();
    console.log("正在检测自动图集……");

    const atlasDirectories =
        await detectAutoAtlasDirectories(config);

    console.log(
        `检测到 ${atlasDirectories.length} 个自动图集配置`,
    );

    const files = classifySourceImageFiles(
        inspectedFiles,
        atlasDirectories,
        config,
    );

    const totalBytes = sumFileBytes(files);
    const extensionStats = countByExtension(files);

    console.log();
    console.log("分析完成");
    console.log("--------");
    console.log(`图片数量：${files.length}`);
    console.log(`图片体积：${formatBytes(totalBytes)}`);

    console.log(
        `元数据耗时：${inspectElapsedMs.toFixed(2)} ms`,
    );

    console.log();
    console.log("按扩展名统计：");

    const sortedExtensionStats = [
        ...extensionStats.entries(),
    ].sort(
        (left, right) =>
            right[1].bytes - left[1].bytes,
    );

    for (
        const [extension, stats]
        of sortedExtensionStats
    ) {
        console.log(
            `${extension.padEnd(6, " ")} ` +
            `${String(stats.count).padStart(5, " ")} 个  ` +
            formatBytes(stats.bytes).padStart(10, " "),
        );
    }

    printMetadataSummary(files);
    printDuplicateHashSummary(files);
    printClassificationSummary(files);

    printLargestClassificationFiles(
        files,
        "safe",
        "体积最大的安全候选",
        20,
    );

    printLargestClassificationFiles(
        files,
        "special-texture",
        "特殊纹理",
        15,
    );

    printLargestClassificationFiles(
        files,
        "manual-review",
        "需要人工检查",
        15,
    );

    printLargestClassificationFiles(
        files,
        "atlas",
        "自动图集源图片",
        15,
    );

    
    console.log();
    console.log("正在写入分析报告……");

    const output =
        await writeSourceImageAnalysisOutputs(
            config,
            files,
            atlasDirectories,
        );

    console.log();
    console.log("分析文件已生成");
    console.log("----------------");

    console.log(
        `完整报告：${output.reportPath}`,
    );

    console.log(
        `候选清单：${output.candidatesPath}`,
    );

    console.log(
        `安全候选文件：${output.candidateFileCount}`,
    );

    console.log(
        `唯一候选内容：` +
        `${output.uniqueCandidateContentCount}`,
    );

    console.log(
        `预计首次最多消耗 API 次数：` +
        `${output.uniqueCandidateContentCount}`,
    );
}

main().catch((error: unknown) => {
    console.error();
    console.error("源图片分析失败：");

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