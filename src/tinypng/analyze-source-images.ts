import path from "node:path";

import { loadSourceImageOptimizerConfig } from "./config.js";
import { scanSourceImageFiles } from "./file-scanner.js";
import type { ScannedSourceImageFile } from "./types.js";

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function sumFileBytes(files: readonly ScannedSourceImageFile[]): number {
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

function printLargestFiles(
    files: readonly ScannedSourceImageFile[],
    limit = 20,
): void {
    const largestFiles = [...files]
        .sort(
            (left, right) =>
                right.sizeBytes - left.sizeBytes,
        )
        .slice(0, limit);

    console.log();
    console.log(`体积最大的 ${largestFiles.length} 张源图片：`);

    for (const [index, file] of largestFiles.entries()) {
        console.log(
            `${String(index + 1).padStart(2, " ")}. ` +
            `${formatBytes(file.sizeBytes).padStart(10, " ")}  ` +
            file.projectRelativePath,
        );
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

    const config = await loadSourceImageOptimizerConfig(
        configArgument,
        toolRoot,
    );

    console.log();
    console.log(`项目名称：${config.projectName}`);
    console.log(`项目目录：${config.resolvedProjectRoot}`);
    console.log(`资源目录：${config.resolvedAssetsDirectory}`);
    console.log(
        `工作目录：${config.resolvedWorkspaceDirectory}`,
    );
    console.log(`缓存目录：${config.resolvedCacheDirectory}`);

    console.log();
    console.log("正在扫描源图片……");

    const startedAt = performance.now();

    const files = await scanSourceImageFiles(config);

    const elapsedMs = performance.now() - startedAt;
    const totalBytes = sumFileBytes(files);
    const extensionStats = countByExtension(files);

    console.log();
    console.log("扫描完成");
    console.log("--------");
    console.log(`图片数量：${files.length}`);
    console.log(`图片体积：${formatBytes(totalBytes)}`);
    console.log(`扫描耗时：${elapsedMs.toFixed(2)} ms`);

    console.log();
    console.log("按扩展名统计：");

    const sortedExtensionStats = [...extensionStats.entries()]
        .sort(
            (left, right) =>
                right[1].bytes - left[1].bytes,
        );

    for (const [extension, stats] of sortedExtensionStats) {
        console.log(
            `${extension.padEnd(6, " ")} ` +
            `${String(stats.count).padStart(5, " ")} 个  ` +
            formatBytes(stats.bytes).padStart(10, " "),
        );
    }

    printLargestFiles(files);
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