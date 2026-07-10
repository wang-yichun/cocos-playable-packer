import {
    readFile,
} from "node:fs/promises";

import path from "node:path";

import {
    loadSourceImageOptimizerConfig,
} from "./config.js";

import {
    isPathInsideDirectory,
    isRecord,
    readJsonUnknown,
    resolvePortableRelativePath,
    samePath,
    toErrorMessage,
    writeBufferAtomically,
    writeJsonAtomically,
} from "./file-utils.js";

import {
    calculateImageSha256,
} from "./image-inspector.js";

import type {
    ResolvedSourceImageOptimizerConfig,
    TinyPngApplicationFile,
    TinyPngApplicationManifest,
    TinyPngRestoreItem,
    TinyPngRestoreReport,
} from "./types.js";

interface CommandOptions {
    configPath: string;
    manifestPath: string | null;
    confirmed: boolean;
}

interface PreparedRestoreFile {
    manifestFile:
        TinyPngApplicationFile;

    sourcePath: string;

    currentBuffer: Buffer;
    backupBuffer: Buffer;

    alreadyRestored: boolean;
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
                "npm run tinypng:restore -- " +
                "\"./configs/game141-source-images.json\" " +
                "--confirm",
            ].join("\n"),
        );
    }

    let manifestPath: string | null = null;
    let confirmed = false;

    for (const argument of argv.slice(1)) {
        if (argument === "--confirm") {
            confirmed = true;
            continue;
        }

        if (
            argument.startsWith(
                "--manifest=",
            )
        ) {
            manifestPath =
                argument.slice(
                    "--manifest=".length,
                );

            continue;
        }

        throw new Error(
            `无法识别的参数：${argument}`,
        );
    }

    return {
        configPath,
        manifestPath,
        confirmed,
    };
}

async function loadApplicationManifest(
    config: ResolvedSourceImageOptimizerConfig,
    requestedManifestPath: string | null,
): Promise<{
    manifestPath: string;
    manifest: TinyPngApplicationManifest;
}> {
    const manifestPath =
        requestedManifestPath
            ? path.resolve(
                requestedManifestPath,
            )
            : path.join(
                config.resolvedWorkspaceDirectory,
                "manifests",
                "latest-application.json",
            );

    const parsed =
        await readJsonUnknown(
            manifestPath,
        );

    if (
        !isRecord(parsed) ||
        parsed.schemaVersion !== 1 ||
        parsed.projectName !==
            config.projectName ||
        !Array.isArray(parsed.files)
    ) {
        throw new Error(
            `应用记录结构或项目信息无效：${manifestPath}`,
        );
    }

    const manifest =
        parsed as unknown as
            TinyPngApplicationManifest;

    if (manifest.state !== "applied") {
        throw new Error(
            `应用记录状态不是 applied：` +
            manifest.state,
        );
    }

    if (
        !samePath(
            manifest.projectRoot,
            config.resolvedProjectRoot,
        ) ||
        !samePath(
            manifest.assetsDirectory,
            config.resolvedAssetsDirectory,
        )
    ) {
        throw new Error(
            "应用记录与当前工程配置不一致。",
        );
    }

    return {
        manifestPath,
        manifest,
    };
}

async function prepareRestoreFile(
    config: ResolvedSourceImageOptimizerConfig,
    manifest:
        TinyPngApplicationManifest,
    file:
        TinyPngApplicationFile,
): Promise<PreparedRestoreFile> {
    const sourcePath =
        resolvePortableRelativePath(
            config.resolvedProjectRoot,
            file.projectRelativePath,
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

    const backupPath =
        resolvePortableRelativePath(
            manifest.backupDirectory,
            file.backupRelativePath,
        );

    const [
        currentBuffer,
        backupBuffer,
    ] = await Promise.all([
        readFile(sourcePath),
        readFile(backupPath),
    ]);

    const currentSha256 =
        calculateImageSha256(
            currentBuffer,
        );

    const backupSha256 =
        calculateImageSha256(
            backupBuffer,
        );

    if (
        backupSha256 !==
        file.sourceSha256
    ) {
        throw new Error(
            `备份文件 SHA-256 不正确：` +
            file.projectRelativePath,
        );
    }

    if (
        currentSha256 ===
        file.sourceSha256
    ) {
        return {
            manifestFile: file,
            sourcePath,
            currentBuffer,
            backupBuffer,
            alreadyRestored: true,
        };
    }

    if (
        currentSha256 !==
        file.compressedSha256
    ) {
        throw new Error(
            [
                "当前源图片既不是压缩版本，也不是原始版本。",
                `图片：${file.projectRelativePath}`,
                `当前哈希：${currentSha256}`,
                "",
                "为避免覆盖应用之后的人工修改，恢复已中止。",
            ].join("\n"),
        );
    }

    return {
        manifestFile: file,
        sourcePath,
        currentBuffer,
        backupBuffer,
        alreadyRestored: false,
    };
}

async function rollbackRestoreFiles(
    restoredFiles:
        readonly PreparedRestoreFile[],
): Promise<string[]> {
    const failures: string[] = [];

    for (
        const prepared
        of [...restoredFiles].reverse()
    ) {
        try {
            await writeBufferAtomically(
                prepared.sourcePath,
                prepared.currentBuffer,
            );

            const verificationBuffer =
                await readFile(
                    prepared.sourcePath,
                );

            const verificationSha256 =
                calculateImageSha256(
                    verificationBuffer,
                );

            if (
                verificationSha256 !==
                prepared.manifestFile
                    .compressedSha256
            ) {
                throw new Error(
                    "恢复回滚后的 SHA-256 不正确。",
                );
            }
        } catch (error) {
            failures.push(
                `${prepared.manifestFile.projectRelativePath}：` +
                toErrorMessage(error),
            );
        }
    }

    return failures;
}

function createRestoreId(): string {
    return new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
}

async function main(): Promise<void> {
    const options =
        parseCommandOptions(
            process.argv.slice(2),
        );

    if (!options.confirmed) {
        throw new Error(
            [
                "该命令会用备份覆盖当前源图片。",
                "确认执行时必须增加 --confirm。",
                "",
                "npm run tinypng:restore -- " +
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
        manifestPath,
        manifest,
    } = await loadApplicationManifest(
        config,
        options.manifestPath,
    );

    console.log("TinyPNG 源图片恢复");
    console.log("------------------");
    console.log(`项目：${config.projectName}`);
    console.log(
        `应用记录：${manifest.applicationId}`,
    );
    console.log(
        `文件数量：${manifest.files.length}`,
    );
    console.log();
    console.log("正在执行恢复预检……");

    const preparedFiles:
        PreparedRestoreFile[] = [];

    for (
        const [index, file]
        of manifest.files.entries()
    ) {
        const prepared =
            await prepareRestoreFile(
                config,
                manifest,
                file,
            );

        preparedFiles.push(prepared);

        console.log(
            `[${index + 1}/${manifest.files.length}] ` +
            `${
                prepared.alreadyRestored
                    ? "已经是原图"
                    : "可恢复"
            }  ` +
            file.projectRelativePath,
        );
    }

    const toRestore =
        preparedFiles.filter(
            (file) =>
                !file.alreadyRestored,
        );

    console.log();
    console.log(
        `需要恢复：${toRestore.length}`,
    );

    console.log(
        `已经恢复：${
            preparedFiles.length -
            toRestore.length
        }`,
    );

    const restoredFiles:
        PreparedRestoreFile[] = [];

    try {
        for (
            const [index, prepared]
            of toRestore.entries()
        ) {
            restoredFiles.push(
                prepared,
            );

            await writeBufferAtomically(
                prepared.sourcePath,
                prepared.backupBuffer,
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
                prepared.manifestFile
                    .sourceSha256
            ) {
                throw new Error(
                    `恢复后校验失败：` +
                    prepared.manifestFile
                        .projectRelativePath,
                );
            }

            console.log(
                `[${index + 1}/${toRestore.length}] ` +
                prepared.manifestFile
                    .projectRelativePath,
            );
        }
    } catch (error) {
        console.error();
        console.error(
            "恢复过程中发生错误，正在撤销本次恢复……",
        );

        const rollbackFailures =
            await rollbackRestoreFiles(
                restoredFiles,
            );

        throw new Error(
            rollbackFailures.length === 0
                ? (
                    "恢复失败，本次已恢复文件已重新还原为压缩版本。" +
                    ` 原因：${toErrorMessage(error)}`
                )
                : (
                    "恢复失败，且部分恢复操作无法撤销。" +
                    ` 原因：${toErrorMessage(error)}` +
                    ` 撤销失败：${rollbackFailures.join("；")}`
                ),
        );
    }

    const restoredAt =
        new Date().toISOString();

    const restoreItems:
        TinyPngRestoreItem[] =
        preparedFiles.map(
            (prepared) => ({
                projectRelativePath:
                    prepared.manifestFile
                        .projectRelativePath,

                sourceSha256:
                    prepared.manifestFile
                        .sourceSha256,

                compressedSha256:
                    prepared.manifestFile
                        .compressedSha256,

                status:
                    prepared.alreadyRestored
                        ? "already-restored"
                        : "restored",

                restoredAt:
                    prepared.alreadyRestored
                        ? null
                        : restoredAt,
            }),
        );

    const restoreId =
        createRestoreId();

    const report:
        TinyPngRestoreReport = {
        schemaVersion: 1,

        restoreId,
        restoredAt,

        applicationId:
            manifest.applicationId,

        applicationManifestPath:
            manifestPath,

        projectName:
            config.projectName,

        restoredCount:
            toRestore.length,

        alreadyRestoredCount:
            preparedFiles.length -
            toRestore.length,

        files:
            restoreItems,

        notes: [
            "恢复操作只恢复图片源文件。",
            "图片对应的 .meta 文件没有被修改。",
            "当前文件哈希不是已知原图或压缩图时，恢复会拒绝覆盖。",
        ],
    };

    const restoreReportsDirectory =
        path.join(
            config.resolvedWorkspaceDirectory,
            "manifests",
            "restores",
        );

    const historyReportPath =
        path.join(
            restoreReportsDirectory,
            `${restoreId}.json`,
        );

    const latestReportPath =
        path.join(
            config.resolvedWorkspaceDirectory,
            "manifests",
            "latest-restore.json",
        );

    const backupReportPath =
        path.join(
            manifest.backupDirectory,
            `restore-${restoreId}.json`,
        );

    await writeJsonAtomically(
        historyReportPath,
        report,
    );

    await writeJsonAtomically(
        latestReportPath,
        report,
    );

    await writeJsonAtomically(
        backupReportPath,
        report,
    );

    console.log();
    console.log("源图片恢复完成");
    console.log("----------------");
    console.log(
        `本次恢复：${report.restoredCount}`,
    );

    console.log(
        `原本已恢复：${report.alreadyRestoredCount}`,
    );

    console.log(
        `恢复报告：${historyReportPath}`,
    );

    console.log();
    console.log(
        "没有修改任何图片对应的 .meta 文件。",
    );
}

main().catch((error: unknown) => {
    console.error();
    console.error("TinyPNG 源图片恢复失败：");

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