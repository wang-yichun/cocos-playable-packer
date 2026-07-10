import {
    readFile,
} from "node:fs/promises";

import path from "node:path";

import {
    loadSourceImageOptimizerConfig,
} from "./config.js";

import {
    isNodeError,
    isPathInsideDirectory,
    isRecord,
    readJsonUnknown,
    resolvePortableRelativePath,
    samePath,
    toErrorMessage,
    toPortablePath,
    writeBufferAtomically,
    writeJsonAtomically,
} from "./file-utils.js";

import {
    calculateImageSha256,
    inspectImageBufferMetadata,
} from "./image-inspector.js";

import type {
    ResolvedSourceImageOptimizerConfig,
    TinyPngApplicationFile,
    TinyPngApplicationManifest,
    TinyPngApplyPlan,
    TinyPngApplyPlanItem,
} from "./types.js";

interface CommandOptions {
    configPath: string;
    planPath: string | null;
    confirmed: boolean;
}

interface PreparedApplyFile {
    planItem: TinyPngApplyPlanItem;

    sourcePath: string;
    sourceBuffer: Buffer;

    compressedPath: string;
    compressedBuffer: Buffer;

    backupPath: string;
    backupRelativePath: string;
}

function formatBytes(bytes: number): string {
    if (Math.abs(bytes) < 1024) {
        return `${bytes} B`;
    }

    if (Math.abs(bytes) < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
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
                "用法：",
                "npm run tinypng:apply -- " +
                "\"./configs/game141-source-images.json\" " +
                "--confirm",
            ].join("\n"),
        );
    }

    let planPath: string | null = null;
    let confirmed = false;

    for (const argument of argv.slice(1)) {
        if (argument === "--confirm") {
            confirmed = true;
            continue;
        }

        if (argument.startsWith("--plan=")) {
            planPath = argument.slice(
                "--plan=".length,
            );

            continue;
        }

        throw new Error(
            `无法识别的参数：${argument}`,
        );
    }

    return {
        configPath,
        planPath,
        confirmed,
    };
}

async function loadApplyPlan(
    config: ResolvedSourceImageOptimizerConfig,
    requestedPlanPath: string | null,
): Promise<{
    planPath: string;
    plan: TinyPngApplyPlan;
}> {
    const planPath = requestedPlanPath
        ? path.resolve(requestedPlanPath)
        : path.join(
            config.resolvedWorkspaceDirectory,
            "manifests",
            "apply-plan.json",
        );

    const parsed =
        await readJsonUnknown(planPath);

    if (
        !isRecord(parsed) ||
        parsed.schemaVersion !== 1 ||
        parsed.projectName !== config.projectName ||
        typeof parsed.planId !== "string" ||
        !Array.isArray(parsed.files)
    ) {
        throw new Error(
            `应用计划结构或项目信息无效：${planPath}`,
        );
    }

    const plan =
        parsed as unknown as TinyPngApplyPlan;

    if (
        !samePath(
            plan.projectRoot,
            config.resolvedProjectRoot,
        ) ||
        !samePath(
            plan.assetsDirectory,
            config.resolvedAssetsDirectory,
        ) ||
        !samePath(
            plan.cacheDirectory,
            config.resolvedCacheDirectory,
        )
    ) {
        throw new Error(
            "应用计划中的工程、资源或缓存路径与当前配置不一致。",
        );
    }

    const expectedBackupDirectory = path.join(
        config.resolvedWorkspaceDirectory,
        "backups",
        plan.planId,
    );

    if (
        !samePath(
            plan.backupDirectory,
            expectedBackupDirectory,
        )
    ) {
        throw new Error(
            [
                "应用计划的备份目录不符合预期。",
                `计划：${plan.backupDirectory}`,
                `预期：${expectedBackupDirectory}`,
            ].join("\n"),
        );
    }

    return {
        planPath,
        plan,
    };
}

async function prepareApplyFile(
    config: ResolvedSourceImageOptimizerConfig,
    plan: TinyPngApplyPlan,
    item: TinyPngApplyPlanItem,
): Promise<PreparedApplyFile> {
    if (item.status !== "ready") {
        throw new Error(
            `非 ready 文件不能进入应用流程：` +
            item.projectRelativePath,
        );
    }

    if (
        !item.compressedRelativePath ||
        !item.compressedSha256 ||
        item.compressedBytes === null
    ) {
        throw new Error(
            `应用计划缺少压缩文件信息：` +
            item.projectRelativePath,
        );
    }

    const sourcePath =
        resolvePortableRelativePath(
            config.resolvedProjectRoot,
            item.projectRelativePath,
        );

    if (
        !isPathInsideDirectory(
            sourcePath,
            config.resolvedAssetsDirectory,
        )
    ) {
        throw new Error(
            `源文件不在 assets 目录：${sourcePath}`,
        );
    }

    const compressedPath =
        resolvePortableRelativePath(
            config.resolvedCacheDirectory,
            item.compressedRelativePath,
        );

    const backupPath =
        resolvePortableRelativePath(
            plan.backupDirectory,
            item.projectRelativePath,
        );

    const sourceBuffer =
        await readFile(sourcePath);

    const compressedBuffer =
        await readFile(compressedPath);

    const currentSourceSha256 =
        calculateImageSha256(sourceBuffer);

    if (
        currentSourceSha256 !==
        item.sourceSha256
    ) {
        throw new Error(
            [
                "源文件在应用计划生成后发生变化。",
                `图片：${item.projectRelativePath}`,
                `计划哈希：${item.sourceSha256}`,
                `当前哈希：${currentSourceSha256}`,
            ].join("\n"),
        );
    }

    if (
        sourceBuffer.length !==
        item.sourceBytes
    ) {
        throw new Error(
            `源文件体积与应用计划不一致：` +
            item.projectRelativePath,
        );
    }

    const compressedSha256 =
        calculateImageSha256(
            compressedBuffer,
        );

    if (
        compressedSha256 !==
        item.compressedSha256
    ) {
        throw new Error(
            `压缩缓存 SHA-256 不一致：` +
            item.projectRelativePath,
        );
    }

    if (
        compressedBuffer.length !==
        item.compressedBytes
    ) {
        throw new Error(
            `压缩缓存体积不一致：` +
            item.projectRelativePath,
        );
    }

    if (
        compressedBuffer.length >=
        sourceBuffer.length
    ) {
        throw new Error(
            `压缩结果没有小于原图：` +
            item.projectRelativePath,
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
        sourceMetadata.format !==
            compressedMetadata.format ||
        sourceMetadata.width !==
            compressedMetadata.width ||
        sourceMetadata.height !==
            compressedMetadata.height
    ) {
        throw new Error(
            `压缩图片格式或尺寸与原图不一致：` +
            item.projectRelativePath,
        );
    }

    return {
        planItem: item,

        sourcePath,
        sourceBuffer,

        compressedPath,
        compressedBuffer,

        backupPath,

        backupRelativePath:
            toPortablePath(
                path.relative(
                    plan.backupDirectory,
                    backupPath,
                ),
            ),
    };
}

async function ensureBackup(
    prepared: PreparedApplyFile,
): Promise<void> {
    let existingBackup: Buffer | null = null;

    try {
        existingBackup =
            await readFile(
                prepared.backupPath,
            );
    } catch (error) {
        if (
            !isNodeError(error) ||
            error.code !== "ENOENT"
        ) {
            throw error;
        }
    }

    if (existingBackup) {
        const existingSha256 =
            calculateImageSha256(
                existingBackup,
            );

        if (
            existingSha256 !==
            prepared.planItem.sourceSha256
        ) {
            throw new Error(
                `已有备份内容不正确：` +
                prepared.backupPath,
            );
        }

        return;
    }

    await writeBufferAtomically(
        prepared.backupPath,
        prepared.sourceBuffer,
    );

    const verificationBuffer =
        await readFile(
            prepared.backupPath,
        );

    const verificationSha256 =
        calculateImageSha256(
            verificationBuffer,
        );

    if (
        verificationSha256 !==
        prepared.planItem.sourceSha256
    ) {
        throw new Error(
            `备份写入后校验失败：` +
            prepared.backupPath,
        );
    }
}

function buildApplicationFiles(
    preparedFiles:
        readonly PreparedApplyFile[],
): TinyPngApplicationFile[] {
    return preparedFiles.map(
        (prepared) => ({
            projectRelativePath:
                prepared.planItem
                    .projectRelativePath,

            assetsRelativePath:
                prepared.planItem
                    .assetsRelativePath,

            sourceSha256:
                prepared.planItem
                    .sourceSha256,

            sourceBytes:
                prepared.sourceBuffer.length,

            compressedSha256:
                prepared.planItem
                    .compressedSha256!,

            compressedBytes:
                prepared.compressedBuffer.length,

            compressedRelativePath:
                prepared.planItem
                    .compressedRelativePath!,

            backupRelativePath:
                prepared.backupRelativePath,

            appliedAt: null,
        }),
    );
}

function buildManifest(
    config: ResolvedSourceImageOptimizerConfig,
    planPath: string,
    plan: TinyPngApplyPlan,
    files: TinyPngApplicationFile[],
): TinyPngApplicationManifest {
    const sourceBytes =
        files.reduce(
            (total, file) =>
                total + file.sourceBytes,
            0,
        );

    const compressedBytes =
        files.reduce(
            (total, file) =>
                total + file.compressedBytes,
            0,
        );

    const savedBytes =
        sourceBytes - compressedBytes;

    return {
        schemaVersion: 1,

        applicationId:
            plan.planId,

        planId:
            plan.planId,

        state:
            "prepared",

        preparedAt:
            new Date().toISOString(),

        appliedAt:
            null,

        projectName:
            config.projectName,

        configFilePath:
            config.configFilePath,

        applyPlanPath:
            planPath,

        projectRoot:
            config.resolvedProjectRoot,

        assetsDirectory:
            config.resolvedAssetsDirectory,

        cacheDirectory:
            config.resolvedCacheDirectory,

        backupDirectory:
            plan.backupDirectory,

        summary: {
            plannedFileCount:
                files.length,

            appliedCount:
                0,

            sourceBytes,
            compressedBytes,

            savedBytes,

            savedPercent:
                sourceBytes > 0
                    ? savedBytes /
                        sourceBytes *
                        100
                    : 0,
        },

        files,

        notes: [
            "该清单在修改源图片之前写入备份目录。",
            "备份只包含图片源文件，不包含 .meta 文件。",
            "恢复时会验证当前文件、备份文件和哈希。",
        ],
    };
}

async function rollbackAppliedFiles(
    touchedFiles:
        readonly PreparedApplyFile[],
): Promise<string[]> {
    const failures: string[] = [];

    for (
        const prepared
        of [...touchedFiles].reverse()
    ) {
        try {
            await writeBufferAtomically(
                prepared.sourcePath,
                prepared.sourceBuffer,
            );

            const restoredBuffer =
                await readFile(
                    prepared.sourcePath,
                );

            const restoredSha256 =
                calculateImageSha256(
                    restoredBuffer,
                );

            if (
                restoredSha256 !==
                prepared.planItem.sourceSha256
            ) {
                throw new Error(
                    "回滚后的 SHA-256 不正确。",
                );
            }
        } catch (error) {
            failures.push(
                `${prepared.planItem.projectRelativePath}：` +
                toErrorMessage(error),
            );
        }
    }

    return failures;
}

async function main(): Promise<void> {
    const options =
        parseCommandOptions(
            process.argv.slice(2),
        );

    if (!options.confirmed) {
        throw new Error(
            [
                "该命令会修改 Cocos Creator 源图片。",
                "确认执行时必须增加 --confirm。",
                "",
                "npm run tinypng:apply -- " +
                `"${options.configPath}" --confirm`,
            ].join("\n"),
        );
    }

    const config =
        await loadSourceImageOptimizerConfig(
            options.configPath,
            process.cwd(),
        );

    const {
        planPath,
        plan,
    } = await loadApplyPlan(
        config,
        options.planPath,
    );

    const readyItems =
        plan.files.filter(
            (item) =>
                item.status === "ready",
        );

    if (readyItems.length === 0) {
        throw new Error(
            "应用计划中没有可应用文件。",
        );
    }

    console.log("TinyPNG 源图片应用");
    console.log("------------------");
    console.log(`项目：${config.projectName}`);
    console.log(`计划：${plan.planId}`);
    console.log(`可应用：${readyItems.length}`);
    console.log();
    console.log("正在执行最终预检……");

    const preparedFiles:
        PreparedApplyFile[] = [];

    const uniquePaths =
        new Set<string>();

    for (
        const [index, item]
        of readyItems.entries()
    ) {
        const normalizedPath =
            item.projectRelativePath
                .replaceAll("\\", "/")
                .toLowerCase();

        if (uniquePaths.has(normalizedPath)) {
            throw new Error(
                `应用计划存在重复路径：` +
                item.projectRelativePath,
            );
        }

        uniquePaths.add(normalizedPath);

        const prepared =
            await prepareApplyFile(
                config,
                plan,
                item,
            );

        preparedFiles.push(prepared);

        console.log(
            `[${index + 1}/${readyItems.length}] ` +
            `预检通过  ` +
            item.projectRelativePath,
        );
    }

    console.log();
    console.log("正在备份源图片……");

    for (
        const [index, prepared]
        of preparedFiles.entries()
    ) {
        await ensureBackup(prepared);

        console.log(
            `[${index + 1}/${preparedFiles.length}] ` +
            prepared.planItem
                .projectRelativePath,
        );
    }

    const manifest =
        buildManifest(
            config,
            planPath,
            plan,
            buildApplicationFiles(
                preparedFiles,
            ),
        );

    const backupManifestPath =
        path.join(
            plan.backupDirectory,
            "application-manifest.json",
        );

    /*
     * 在修改第一张源图片前，
     * 先把恢复所需的信息写入备份目录。
     */
    await writeJsonAtomically(
        backupManifestPath,
        manifest,
    );

    console.log();
    console.log("正在替换源图片……");

    const touchedFiles:
        PreparedApplyFile[] = [];

    try {
        for (
            const [index, prepared]
            of preparedFiles.entries()
        ) {
            /*
             * 写入动作即使中途失败，
             * 当前文件也会进入回滚集合。
             */
            touchedFiles.push(prepared);

            await writeBufferAtomically(
                prepared.sourcePath,
                prepared.compressedBuffer,
            );

            const appliedBuffer =
                await readFile(
                    prepared.sourcePath,
                );

            const appliedSha256 =
                calculateImageSha256(
                    appliedBuffer,
                );

            if (
                appliedSha256 !==
                prepared.planItem
                    .compressedSha256
            ) {
                throw new Error(
                    `替换后校验失败：` +
                    prepared.planItem
                        .projectRelativePath,
                );
            }

            console.log(
                `[${index + 1}/${preparedFiles.length}] ` +
                prepared.planItem
                    .projectRelativePath,
            );
        }
    } catch (error) {
        console.error();
        console.error(
            "应用过程中发生错误，正在回滚……",
        );

        const rollbackFailures =
            await rollbackAppliedFiles(
                touchedFiles,
            );

        manifest.state =
            "rolled-back";

        manifest.notes.push(
            `应用失败并执行回滚：` +
            toErrorMessage(error),
        );

        if (rollbackFailures.length > 0) {
            manifest.notes.push(
                `以下文件回滚失败：` +
                rollbackFailures.join("；"),
            );
        }

        await writeJsonAtomically(
            backupManifestPath,
            manifest,
        );

        throw new Error(
            rollbackFailures.length === 0
                ? (
                    "应用失败，已成功回滚本次所有修改。" +
                    ` 原因：${toErrorMessage(error)}`
                )
                : (
                    "应用失败，且部分文件回滚失败。" +
                    ` 原因：${toErrorMessage(error)}` +
                    ` 回滚失败：${rollbackFailures.join("；")}`
                ),
        );
    }

    const appliedAt =
        new Date().toISOString();

    manifest.state =
        "applied";

    manifest.appliedAt =
        appliedAt;

    manifest.summary.appliedCount =
        preparedFiles.length;

    for (const file of manifest.files) {
        file.appliedAt =
            appliedAt;
    }

    const applicationsDirectory =
        path.join(
            config.resolvedWorkspaceDirectory,
            "manifests",
            "applications",
        );

    const historyManifestPath =
        path.join(
            applicationsDirectory,
            `${manifest.applicationId}.json`,
        );

    const latestManifestPath =
        path.join(
            config.resolvedWorkspaceDirectory,
            "manifests",
            "latest-application.json",
        );

    await writeJsonAtomically(
        backupManifestPath,
        manifest,
    );

    await writeJsonAtomically(
        historyManifestPath,
        manifest,
    );

    await writeJsonAtomically(
        latestManifestPath,
        manifest,
    );

    console.log();
    console.log("源图片应用完成");
    console.log("----------------");
    console.log(
        `替换数量：${manifest.summary.appliedCount}`,
    );

    console.log(
        `原始体积：${formatBytes(
            manifest.summary.sourceBytes,
        )}`,
    );

    console.log(
        `压缩体积：${formatBytes(
            manifest.summary.compressedBytes,
        )}`,
    );

    console.log(
        `减少体积：${formatBytes(
            manifest.summary.savedBytes,
        )}`,
    );

    console.log(
        `压缩收益：${manifest.summary.savedPercent.toFixed(2)}%`,
    );

    console.log(
        `备份目录：${manifest.backupDirectory}`,
    );

    console.log(
        `应用记录：${historyManifestPath}`,
    );

    console.log();
    console.log(
        "没有修改任何图片对应的 .meta 文件。",
    );
}

main().catch((error: unknown) => {
    console.error();
    console.error("TinyPNG 源图片应用失败：");

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