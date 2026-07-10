import {
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
} from "./hash-cache.js";

import {
    calculateImageSha256,
    inspectImageBufferMetadata,
} from "./image-inspector.js";

import type {
    ResolvedSourceImageOptimizerConfig,
    SourceImageCandidateManifest,
    SourceImageCandidateItem,
    TinyPngApplyPlan,
    TinyPngApplyPlanItem,
    TinyPngApplyPlanSummary,
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

function toErrorMessage(error: unknown): string {
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

function createPlanId(): string {
    return new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
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
        parsed.projectName !== config.projectName ||
        !Array.isArray(parsed.files)
    ) {
        throw new Error(
            `候选清单结构或项目信息无效：${manifestPath}`,
        );
    }

    return {
        manifestPath,
        manifest:
            parsed as unknown as
            SourceImageCandidateManifest,
    };
}

function createFailedItem(
    candidate: SourceImageCandidateItem,
    status:
        | "source-changed"
        | "cache-miss"
        | "cache-invalid"
        | "failed",
    message: string,
    currentSourceSha256: string | null,
): TinyPngApplyPlanItem {
    return {
        projectRelativePath:
            candidate.projectRelativePath,

        assetsRelativePath:
            candidate.assetsRelativePath,

        sourceSha256:
            candidate.sha256,

        currentSourceSha256,

        sourceBytes:
            candidate.sizeBytes,

        compressedRelativePath: null,
        compressedSha256: null,
        compressedBytes: null,

        savedBytes: null,
        savedPercent: null,

        status,
        message,
    };
}

function buildSummary(
    files: readonly TinyPngApplyPlanItem[],
): TinyPngApplyPlanSummary {
    let readyCount = 0;
    let sourceChangedCount = 0;
    let cacheMissCount = 0;
    let cacheInvalidCount = 0;
    let notSmallerCount = 0;
    let failedCount = 0;

    let readySourceBytes = 0;
    let readyCompressedBytes = 0;

    for (const file of files) {
        switch (file.status) {
            case "ready":
                readyCount += 1;

                readySourceBytes +=
                    file.sourceBytes;

                readyCompressedBytes +=
                    file.compressedBytes ?? 0;

                break;

            case "source-changed":
                sourceChangedCount += 1;
                break;

            case "cache-miss":
                cacheMissCount += 1;
                break;

            case "cache-invalid":
                cacheInvalidCount += 1;
                break;

            case "not-smaller":
                notSmallerCount += 1;
                break;

            case "failed":
                failedCount += 1;
                break;
        }
    }

    const readySavedBytes =
        readySourceBytes -
        readyCompressedBytes;

    const readySavedPercent =
        readySourceBytes > 0
            ? readySavedBytes /
            readySourceBytes *
            100
            : 0;

    return {
        candidateCount:
            files.length,

        readyCount,
        sourceChangedCount,
        cacheMissCount,
        cacheInvalidCount,
        notSmallerCount,
        failedCount,

        readySourceBytes,
        readyCompressedBytes,
        readySavedBytes,
        readySavedPercent,
    };
}

async function inspectCandidate(
    config: ResolvedSourceImageOptimizerConfig,
    candidate: SourceImageCandidateItem,
    cache: Awaited<
        ReturnType<typeof loadTinyPngCache>
    >,
): Promise<TinyPngApplyPlanItem> {
    let sourcePath: string;

    try {
        sourcePath =
            resolvePortableRelativePath(
                config.resolvedProjectRoot,
                candidate.projectRelativePath,
            );
    } catch (error) {
        return createFailedItem(
            candidate,
            "failed",
            toErrorMessage(error),
            null,
        );
    }

    if (
        !isPathInsideDirectory(
            sourcePath,
            config.resolvedAssetsDirectory,
        )
    ) {
        return createFailedItem(
            candidate,
            "failed",
            `源文件不在 assets 目录：${sourcePath}`,
            null,
        );
    }

    let sourceBuffer: Buffer;

    try {
        sourceBuffer =
            await readFile(sourcePath);
    } catch (error) {
        return createFailedItem(
            candidate,
            "failed",
            `无法读取源文件：${toErrorMessage(error)}`,
            null,
        );
    }

    const currentSourceSha256 =
        calculateImageSha256(sourceBuffer);

    if (
        currentSourceSha256 !==
        candidate.sha256
    ) {
        return createFailedItem(
            candidate,
            "source-changed",
            "源文件哈希与 candidates.json 不一致，请重新分析。",
            currentSourceSha256,
        );
    }

    const cacheLookup =
        await lookupTinyPngCache(
            cache,
            candidate.sha256,
        );

    if (cacheLookup.status === "miss") {
        return createFailedItem(
            candidate,
            "cache-miss",
            "找不到对应的 TinyPNG 缓存。",
            currentSourceSha256,
        );
    }

    if (cacheLookup.status === "invalid") {
        return createFailedItem(
            candidate,
            "cache-invalid",
            cacheLookup.reason,
            currentSourceSha256,
        );
    }

    let compressedBuffer: Buffer;

    try {
        compressedBuffer =
            await readFile(
                cacheLookup.compressedFilePath,
            );
    } catch (error) {
        return createFailedItem(
            candidate,
            "cache-invalid",
            `无法读取压缩缓存：${toErrorMessage(error)}`,
            currentSourceSha256,
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
        return createFailedItem(
            candidate,
            "cache-invalid",
            "压缩缓存不是有效 PNG/JPEG。",
            currentSourceSha256,
        );
    }

    if (
        compressedMetadata.format !==
        sourceMetadata.format
    ) {
        return createFailedItem(
            candidate,
            "cache-invalid",
            [
                "压缩缓存格式发生变化。",
                `源格式=${sourceMetadata.format}`,
                `压缩格式=${compressedMetadata.format}`,
            ].join(" "),
            currentSourceSha256,
        );
    }

    if (
        compressedMetadata.width !==
        sourceMetadata.width ||
        compressedMetadata.height !==
        sourceMetadata.height
    ) {
        return createFailedItem(
            candidate,
            "cache-invalid",
            [
                "压缩缓存尺寸发生变化。",
                `源尺寸=${sourceMetadata.width}x${sourceMetadata.height}`,
                `压缩尺寸=${compressedMetadata.width}x${compressedMetadata.height}`,
            ].join(" "),
            currentSourceSha256,
        );
    }

    const compressedBytes =
        cacheLookup.entry.compressedBytes;

    const savedBytes =
        candidate.sizeBytes -
        compressedBytes;

    const savedPercent =
        candidate.sizeBytes > 0
            ? savedBytes /
            candidate.sizeBytes *
            100
            : 0;

    if (compressedBytes >= candidate.sizeBytes) {
        return {
            projectRelativePath:
                candidate.projectRelativePath,

            assetsRelativePath:
                candidate.assetsRelativePath,

            sourceSha256:
                candidate.sha256,

            currentSourceSha256,

            sourceBytes:
                candidate.sizeBytes,

            compressedRelativePath:
                cacheLookup.entry
                    .compressedRelativePath,

            compressedSha256:
                cacheLookup.entry
                    .compressedSha256,

            compressedBytes,

            savedBytes,
            savedPercent,

            status: "not-smaller",

            message:
                "压缩结果没有小于源文件，不会替换。",
        };
    }

    return {
        projectRelativePath:
            candidate.projectRelativePath,

        assetsRelativePath:
            candidate.assetsRelativePath,

        sourceSha256:
            candidate.sha256,

        currentSourceSha256,

        sourceBytes:
            candidate.sizeBytes,

        compressedRelativePath:
            cacheLookup.entry
                .compressedRelativePath,

        compressedSha256:
            cacheLookup.entry
                .compressedSha256,

        compressedBytes,

        savedBytes,
        savedPercent,

        status: "ready",
        message: null,
    };
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
                "npm run tinypng:apply-plan -- " +
                "\"./configs/game141-source-images.json\"",
            ].join("\n"),
        );
    }

    const config =
        await loadSourceImageOptimizerConfig(
            configArgument,
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

    const planId =
        createPlanId();

    const backupDirectory =
        path.join(
            config.resolvedWorkspaceDirectory,
            "backups",
            planId,
        );

    console.log("TinyPNG 应用计划");
    console.log("----------------");
    console.log(
        `项目：${config.projectName}`,
    );
    console.log(
        `候选数量：${manifest.files.length}`,
    );
    console.log(
        `计划编号：${planId}`,
    );
    console.log();
    console.log(
        "正在重新检查源文件和压缩缓存……",
    );

    const files:
        TinyPngApplyPlanItem[] = [];

    for (
        const [index, candidate]
        of manifest.files.entries()
    ) {
        const item =
            await inspectCandidate(
                config,
                candidate,
                cache,
            );

        files.push(item);

        const statusText =
            item.status === "ready"
                ? "可应用"
                : item.status;

        console.log(
            `[${index + 1}/${manifest.files.length}] ` +
            `${statusText}  ` +
            candidate.projectRelativePath,
        );
    }

    files.sort(
        (left, right) =>
            left.projectRelativePath
                .localeCompare(
                    right.projectRelativePath,
                    "en",
                ),
    );

    const summary =
        buildSummary(files);

    const plan: TinyPngApplyPlan = {
        schemaVersion: 1,
        planId,
        generatedAt:
            new Date().toISOString(),

        projectName:
            config.projectName,

        configFilePath:
            config.configFilePath,

        candidateManifestPath:
            manifestPath,

        projectRoot:
            config.resolvedProjectRoot,

        assetsDirectory:
            config.resolvedAssetsDirectory,

        cacheDirectory:
            cache.cacheDirectory,

        backupDirectory,

        summary,
        files,

        notes: [
            "本文件只是应用计划，尚未修改 Cocos Creator 工程。",
            "正式应用前会再次检查源文件和缓存哈希。",
            "只有 status 为 ready 的文件会被应用。",
            "每张源图片会先备份，再进行原子替换。",
            "不会修改图片对应的 .meta 文件。",
            "压缩结果不小于原图时不会进行替换。",
            "backupDirectory 将用于后续恢复操作。",
        ],
    };

    const planPath = path.join(
        config.resolvedWorkspaceDirectory,
        "manifests",
        "apply-plan.json",
    );

    await mkdir(
        path.dirname(planPath),
        {
            recursive: true,
        },
    );

    await writeFile(
        planPath,
        `${JSON.stringify(plan, null, 2)}\n`,
        "utf8",
    );

    console.log();
    console.log("应用计划已生成");
    console.log("----------------");

    console.log(
        `可应用：${summary.readyCount}`,
    );

    console.log(
        `源文件变化：${summary.sourceChangedCount}`,
    );

    console.log(
        `缓存缺失：${summary.cacheMissCount}`,
    );

    console.log(
        `缓存无效：${summary.cacheInvalidCount}`,
    );

    console.log(
        `压缩无收益：${summary.notSmallerCount}`,
    );

    console.log(
        `其他失败：${summary.failedCount}`,
    );

    console.log(
        `原始体积：${formatBytes(
            summary.readySourceBytes,
        )}`,
    );

    console.log(
        `压缩体积：${formatBytes(
            summary.readyCompressedBytes,
        )}`,
    );

    console.log(
        `预计减少：${formatBytes(
            summary.readySavedBytes,
        )}`,
    );

    console.log(
        `预计收益：${summary.readySavedPercent.toFixed(2)}%`,
    );

    console.log(
        `备份目录：${backupDirectory}`,
    );

    console.log(
        `计划文件：${planPath}`,
    );

    if (
        summary.sourceChangedCount > 0 ||
        summary.cacheMissCount > 0 ||
        summary.cacheInvalidCount > 0 ||
        summary.failedCount > 0
    ) {
        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error();
    console.error("生成应用计划失败：");

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