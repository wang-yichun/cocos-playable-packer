import {
    copyFile,
    mkdir,
    readFile,
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
    TinyPngCacheEntry,
} from "./types.js";

function formatBytes(bytes: number): string {
    if (Math.abs(bytes) < 1024) {
        return `${bytes} B`;
    }

    if (Math.abs(bytes) < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function removeUtf8Bom(content: string): string {
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

function normalizePortablePath(
    value: string,
): string {
    return value
        .replaceAll("\\", "/")
        .replace(/^\.\/+/, "");
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
        relativePath !== "" &&
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

function resolvePortableRelativePath(
    rootDirectory: string,
    portableRelativePath: string,
): string {
    if (
        path.isAbsolute(portableRelativePath)
    ) {
        throw new Error(
            `不允许使用绝对路径：${portableRelativePath}`,
        );
    }

    const segments = portableRelativePath
        .split(/[\\/]+/)
        .filter((segment) => segment.length > 0);

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

async function loadCandidateManifest(
    config: ResolvedSourceImageOptimizerConfig,
): Promise<SourceImageCandidateManifest> {
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
        parsed.projectName !== config.projectName ||
        !Array.isArray(parsed.files)
    ) {
        throw new Error(
            `候选清单结构或项目信息无效：${manifestPath}`,
        );
    }

    return parsed as unknown as
        SourceImageCandidateManifest;
}

function selectCandidate(
    manifest: SourceImageCandidateManifest,
    requestedPath: string | undefined,
): SourceImageCandidateItem {
    if (manifest.files.length === 0) {
        throw new Error(
            "候选清单中没有安全候选图片。",
        );
    }

    if (requestedPath) {
        const normalizedRequestedPath =
            normalizePortablePath(
                requestedPath,
            );

        const candidate =
            manifest.files.find((file) => {
                return (
                    normalizePortablePath(
                        file.projectRelativePath,
                    ) === normalizedRequestedPath ||
                    normalizePortablePath(
                        file.assetsRelativePath,
                    ) === normalizedRequestedPath
                );
            });

        if (!candidate) {
            throw new Error(
                `候选清单中找不到图片：${requestedPath}`,
            );
        }

        return candidate;
    }

    /*
     * 默认选最大的一张安全候选，
     * 更容易直观看出压缩效果。
     */
    const candidate = [...manifest.files]
        .sort(
            (left, right) =>
                right.sizeBytes -
                left.sizeBytes,
        )[0];

    if (!candidate) {
        throw new Error(
            "无法选择测试候选图片。",
        );
    }

    return candidate;
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
        compressedMetadata.format === "unknown"
    ) {
        throw new Error(
            "TinyPNG 返回的数据不是有效 PNG/JPEG 图片。",
        );
    }

    if (
        sourceMetadata.format !==
        compressedMetadata.format
    ) {
        throw new Error(
            [
                "TinyPNG 返回图片格式发生变化。",
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

    await mkdir(
        previewRoot,
        {
            recursive: true,
        },
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

function printCompressionResult(
    candidate: SourceImageCandidateItem,
    entry: TinyPngCacheEntry,
    previewPath: string,
    cacheStatus: "hit" | "stored",
    compressionCount: number | null,
): void {
    const savedBytes =
        entry.sourceBytes -
        entry.compressedBytes;

    const savedPercent =
        entry.sourceBytes > 0
            ? (
                savedBytes /
                entry.sourceBytes *
                100
            )
            : 0;

    console.log();
    console.log("单图测试完成");
    console.log("------------");

    console.log(
        `图片：${candidate.projectRelativePath}`,
    );

    console.log(
        `缓存状态：${cacheStatus === "hit"
            ? "命中，未调用 API"
            : "新结果已写入缓存"
        }`,
    );

    console.log(
        `原始体积：${formatBytes(entry.sourceBytes)}`,
    );

    console.log(
        `压缩体积：${formatBytes(entry.compressedBytes)}`,
    );

    console.log(
        `减少体积：${formatBytes(savedBytes)}`,
    );

    console.log(
        `压缩收益：${savedPercent.toFixed(2)}%`,
    );

    console.log(
        `压缩比例：${(
            entry.compressionRatio *
            100
        ).toFixed(2)}%`,
    );

    console.log(
        `预览文件：${previewPath}`,
    );

    if (compressionCount !== null) {
        console.log(
            `本月 API 压缩次数：${compressionCount}`,
        );
    }

    if (entry.compressedBytes >= entry.sourceBytes) {
        console.warn();
        console.warn(
            "警告：压缩结果没有小于原图，" +
            "后续批处理时不应覆盖原图。",
        );
    }
}

async function main(): Promise<void> {
    const configArgument =
        process.argv[2];

    const requestedCandidatePath =
        process.argv[3];

    if (!configArgument) {
        throw new Error(
            [
                "缺少配置文件参数。",
                "",
                "用法：",
                "npm run tinypng:test-one -- " +
                "\"./configs/game141-source-images.json\"",
                "",
                "也可以指定候选图片：",
                "npm run tinypng:test-one -- " +
                "\"./configs/game141-source-images.json\" " +
                "\"assets/Art0/Texture/diren.png\"",
            ].join("\n"),
        );
    }

    const config =
        await loadSourceImageOptimizerConfig(
            configArgument,
            process.cwd(),
        );

    const manifest =
        await loadCandidateManifest(config);

    const candidate =
        selectCandidate(
            manifest,
            requestedCandidatePath,
        );

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
            `候选图片不在 assets 目录内：${sourcePath}`,
        );
    }

    console.log("TinyPNG 单图压缩测试");
    console.log("-------------------");

    console.log(
        `测试图片：${candidate.projectRelativePath}`,
    );

    console.log(
        `源文件：${sourcePath}`,
    );

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
        throw new Error(
            [
                "源图片在生成 candidates.json 后发生了变化。",
                `图片：${candidate.projectRelativePath}`,
                `清单哈希：${candidate.sha256}`,
                `当前哈希：${currentSha256}`,
                "",
                "请重新运行 analyze:source-images。",
            ].join("\n"),
        );
    }

    const cache =
        await loadTinyPngCache(config);

    const cacheLookup =
        await lookupTinyPngCache(
            cache,
            candidate.sha256,
        );

    if (cacheLookup.status === "hit") {
        const previewPath =
            await writePreviewFile(
                config,
                candidate,
                cacheLookup.compressedFilePath,
            );

        printCompressionResult(
            candidate,
            cacheLookup.entry,
            previewPath,
            "hit",
            null,
        );

        return;
    }

    if (cacheLookup.status === "invalid") {
        console.warn();
        console.warn(
            `发现无效缓存，将重新请求 TinyPNG：` +
            cacheLookup.reason,
        );
    }

    console.log();
    console.log(
        "缓存未命中，正在调用 TinyPNG API……",
    );

    const client =
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

    /*
     * 写入后立即重新走完整校验，
     * 确认缓存文件大小和 SHA-256 正确。
     */
    const storedLookup =
        await lookupTinyPngCache(
            cache,
            candidate.sha256,
        );

    if (storedLookup.status !== "hit") {
        throw new Error(
            storedLookup.status === "invalid"
                ? `新缓存校验失败：${storedLookup.reason}`
                : "新缓存写入后无法查到。",
        );
    }

    const previewPath =
        await writePreviewFile(
            config,
            candidate,
            storedLookup.compressedFilePath,
        );

    printCompressionResult(
        candidate,
        storedLookup.entry,
        previewPath,
        "stored",
        compressionResult.compressionCount,
    );
}

main().catch((error: unknown) => {
    console.error();
    console.error("TinyPNG 单图测试失败：");

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