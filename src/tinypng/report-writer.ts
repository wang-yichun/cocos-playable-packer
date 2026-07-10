import {
    mkdir,
    writeFile,
} from "node:fs/promises";
import path from "node:path";

import type {
    AutoAtlasDirectoryInfo,
    ClassifiedSourceImageFile,
    ResolvedSourceImageOptimizerConfig,
    SourceImageAnalysisItem,
    SourceImageAnalysisReport,
    SourceImageAnalysisSummary,
    SourceImageCandidateItem,
    SourceImageCandidateManifest,
    SourceImageClassificationCounts,
    WrittenSourceImageAnalysisOutputs,
} from "./types.js";

const SCHEMA_VERSION = 1;
const ANALYZER_VERSION = "0.1.0";

function sumBytes(
    files: readonly ClassifiedSourceImageFile[],
): number {
    return files.reduce(
        (total, file) => total + file.sizeBytes,
        0,
    );
}

function createClassificationCounts():
    SourceImageClassificationCounts {
    return {
        safe: 0,
        atlas: 0,
        specialTexture: 0,
        manualReview: 0,
        tooSmall: 0,
        unsupported: 0,
    };
}

function buildSummary(
    files: readonly ClassifiedSourceImageFile[],
): SourceImageAnalysisSummary {
    const classificationCounts =
        createClassificationCounts();

    let pngCount = 0;
    let jpegCount = 0;

    let pngBytes = 0;
    let jpegBytes = 0;

    let safeCandidateBytes = 0;
    let atlasImageBytes = 0;

    for (const file of files) {
        switch (file.classification) {
            case "safe":
                classificationCounts.safe += 1;
                safeCandidateBytes += file.sizeBytes;
                break;

            case "atlas":
                classificationCounts.atlas += 1;
                atlasImageBytes += file.sizeBytes;
                break;

            case "special-texture":
                classificationCounts.specialTexture += 1;
                break;

            case "manual-review":
                classificationCounts.manualReview += 1;
                break;

            case "too-small":
                classificationCounts.tooSmall += 1;
                break;

            case "unsupported":
                classificationCounts.unsupported += 1;
                break;
        }

        if (file.metadata.format === "png") {
            pngCount += 1;
            pngBytes += file.sizeBytes;
        } else if (file.metadata.format === "jpeg") {
            jpegCount += 1;
            jpegBytes += file.sizeBytes;
        }
    }

    return {
        totalImageCount: files.length,
        totalImageBytes: sumBytes(files),

        pngCount,
        jpegCount,

        pngBytes,
        jpegBytes,

        classificationCounts,

        safeCandidateBytes,
        atlasImageBytes,
    };
}

function toAnalysisItem(
    file: ClassifiedSourceImageFile,
): SourceImageAnalysisItem {
    return {
        projectRelativePath:
            file.projectRelativePath,

        assetsRelativePath:
            file.assetsRelativePath,

        absolutePath:
            file.absolutePath,

        basename:
            file.basename,

        extension:
            file.extension,

        sizeBytes:
            file.sizeBytes,

        sha256:
            file.sha256,

        classification:
            file.classification,

        reasons:
            [...file.reasons],

        atlasConfigPath:
            file.atlasConfigPath,

        metadata: {
            ...file.metadata,
        },
    };
}

function toCandidateItem(
    file: ClassifiedSourceImageFile,
): SourceImageCandidateItem {
    if (file.classification !== "safe") {
        throw new Error(
            `非安全候选不能写入 candidates.json：` +
            file.projectRelativePath,
        );
    }

    return {
        projectRelativePath:
            file.projectRelativePath,

        assetsRelativePath:
            file.assetsRelativePath,

        basename:
            file.basename,

        extension:
            file.extension,

        sizeBytes:
            file.sizeBytes,

        sha256:
            file.sha256,

        classification: "safe",

        metadata: {
            ...file.metadata,
        },
    };
}

function buildAnalysisReport(
    config: ResolvedSourceImageOptimizerConfig,
    files: readonly ClassifiedSourceImageFile[],
    atlasDirectories: readonly AutoAtlasDirectoryInfo[],
    generatedAt: string,
): SourceImageAnalysisReport {
    return {
        generatedAt,
        schemaVersion: SCHEMA_VERSION,
        analyzerVersion: ANALYZER_VERSION,

        projectName:
            config.projectName,

        configFilePath:
            config.configFilePath,

        projectRoot:
            config.resolvedProjectRoot,

        assetsDirectory:
            config.resolvedAssetsDirectory,

        summary:
            buildSummary(files),

        files:
            files.map(toAnalysisItem),

        notes: [
            "分析器只读取源资源，没有修改 Cocos Creator 工程。",
            `检测到 ${atlasDirectories.length} 个自动图集配置。`,
            "candidates.json 只包含 classification 为 safe 的图片。",
            "atlas 图片暂不进行源文件 TinyPNG 压缩，留待构建后处理最终图集。",
            "manual-review 图片需要人工确认后再加入后续 approved.json。",
            "special-texture 默认禁止有损压缩。",
            "too-small 图片默认不消耗 TinyPNG API 请求。",
            "相同 SHA-256 的文件后续应共享一次 TinyPNG 压缩结果。",
        ],
    };
}

function buildCandidateManifest(
    config: ResolvedSourceImageOptimizerConfig,
    files: readonly ClassifiedSourceImageFile[],
    generatedAt: string,
): SourceImageCandidateManifest {
    const safeFiles = files.filter(
        (
            file,
        ): file is ClassifiedSourceImageFile & {
            classification: "safe";
        } => file.classification === "safe",
    );

    const candidateItems =
        safeFiles.map(toCandidateItem);

    const uniqueHashes = new Set(
        candidateItems.map(
            (file) => file.sha256,
        ),
    );

    return {
        generatedAt,
        schemaVersion: SCHEMA_VERSION,
        generatorVersion: ANALYZER_VERSION,

        projectName:
            config.projectName,

        configFilePath:
            config.configFilePath,

        projectRoot:
            config.resolvedProjectRoot,

        assetsDirectory:
            config.resolvedAssetsDirectory,

        summary: {
            candidateFileCount:
                candidateItems.length,

            uniqueSourceCount:
                uniqueHashes.size,

            duplicateReusableCount:
                candidateItems.length -
                uniqueHashes.size,

            totalSourceBytes:
                candidateItems.reduce(
                    (total, file) =>
                        total + file.sizeBytes,
                    0,
                ),
        },

        files:
            candidateItems,

        notes: [
            "此清单只包含自动分类为 safe 的源图片。",
            "清单本身不会触发 TinyPNG API 请求。",
            "实际压缩前仍会再次校验文件 SHA-256，防止源文件在分析后发生变化。",
            "相同 SHA-256 只应请求 TinyPNG 一次，再把缓存结果复制到所有对应路径。",
        ],
    };
}

async function writeJsonFile(
    filePath: string,
    value: unknown,
): Promise<void> {
    await mkdir(
        path.dirname(filePath),
        {
            recursive: true,
        },
    );

    const json =
        `${JSON.stringify(value, null, 2)}\n`;

    await writeFile(
        filePath,
        json,
        "utf8",
    );
}

/**
 * 写出完整分析报告和安全候选清单。
 */
export async function writeSourceImageAnalysisOutputs(
    config: ResolvedSourceImageOptimizerConfig,
    files: readonly ClassifiedSourceImageFile[],
    atlasDirectories: readonly AutoAtlasDirectoryInfo[],
): Promise<WrittenSourceImageAnalysisOutputs> {
    const generatedAt =
        new Date().toISOString();

    const report =
        buildAnalysisReport(
            config,
            files,
            atlasDirectories,
            generatedAt,
        );

    const candidates =
        buildCandidateManifest(
            config,
            files,
            generatedAt,
        );

    const reportPath = path.join(
        config.resolvedWorkspaceDirectory,
        "reports",
        "source-image-analysis.json",
    );

    const candidatesPath = path.join(
        config.resolvedWorkspaceDirectory,
        "manifests",
        "candidates.json",
    );

    await Promise.all([
        writeJsonFile(
            reportPath,
            report,
        ),

        writeJsonFile(
            candidatesPath,
            candidates,
        ),
    ]);

    return {
        reportPath,
        candidatesPath,

        candidateFileCount:
            candidates.summary.candidateFileCount,

        uniqueCandidateContentCount:
            candidates.summary.uniqueSourceCount,
    };
}