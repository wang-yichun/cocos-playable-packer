import {
    loadSourceImageOptimizerConfig,
} from "./config.js";

import {
    loadTinyPngCache,
    verifyTinyPngCache,
} from "./hash-cache.js";

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main(): Promise<void> {
    const configArgument =
        process.argv[2];

    if (!configArgument) {
        throw new Error(
            [
                "缺少配置文件参数。",
                "",
                "用法：",
                "npm run tinypng:cache-check -- " +
                "\"./configs/game141-source-images.json\"",
            ].join("\n"),
        );
    }

    const config =
        await loadSourceImageOptimizerConfig(
            configArgument,
            process.cwd(),
        );

    const cache =
        await loadTinyPngCache(config);

    console.log("TinyPNG 本地缓存检查");
    console.log("-------------------");
    console.log(
        `缓存目录：${cache.cacheDirectory}`,
    );
    console.log(
        `索引文件：${cache.indexPath}`,
    );

    const result =
        await verifyTinyPngCache(cache);

    console.log();
    console.log(`缓存记录：${result.totalEntries}`);
    console.log(`有效记录：${result.validEntries}`);
    console.log(`无效记录：${result.invalidEntries}`);

    console.log(
        `原始体积：${formatBytes(result.totalSourceBytes)}`,
    );

    console.log(
        `压缩体积：${formatBytes(result.totalCompressedBytes)}`,
    );

    if (result.invalidItems.length > 0) {
        console.log();
        console.log("无效缓存：");

        for (const item of result.invalidItems) {
            console.log(
                `${item.sourceSha256}：${item.reason}`,
            );
        }

        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error();
    console.error("TinyPNG 缓存检查失败：");

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