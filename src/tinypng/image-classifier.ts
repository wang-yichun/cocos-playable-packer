import { findAutoAtlasForImage } from "./auto-atlas-detector.js";

import type {
    AutoAtlasDirectoryInfo,
    ClassifiedSourceImageFile,
    InspectedSourceImageFile,
    ResolvedSourceImageOptimizerConfig,
    SourceImageClassification,
} from "./types.js";

function getPortablePathSegments(
    relativePath: string,
): string[] {
    return relativePath
        .split(/[\\/]+/)
        .map((segment) => segment.trim().toLowerCase())
        .filter((segment) => segment.length > 0);
}

function findMatchingDirectory(
    file: InspectedSourceImageFile,
    configuredDirectories: readonly string[],
): string | null {
    const configuredSet = new Set(
        configuredDirectories.map(
            (directory) => directory.toLowerCase(),
        ),
    );

    /*
     * 最后一个 segment 是文件名，因此不参与目录匹配。
     */
    const pathSegments = getPortablePathSegments(
        file.assetsRelativePath,
    );

    pathSegments.pop();

    for (const segment of pathSegments) {
        if (configuredSet.has(segment)) {
            return segment;
        }
    }

    return null;
}

function findMatchingNamePattern(
    file: InspectedSourceImageFile,
    patterns: readonly string[],
): string | null {
    const lowerBasename = file.basename.toLowerCase();

    for (const pattern of patterns) {
        if (lowerBasename.includes(pattern.toLowerCase())) {
            return pattern;
        }
    }

    return null;
}

function isFormatEnabled(
    file: InspectedSourceImageFile,
    config: ResolvedSourceImageOptimizerConfig,
): boolean {
    if (file.metadata.format === "png") {
        return config.compression.processPng;
    }

    if (file.metadata.format === "jpeg") {
        return config.compression.processJpeg;
    }

    return false;
}

function determinePrimaryClassification(
    options: {
        unsupported: boolean;
        specialTexture: boolean;
        atlas: boolean;
        tooSmall: boolean;
        manualReview: boolean;
    },
): SourceImageClassification {
    /*
     * 分类优先级：
     *
     * 1. 不支持的格式
     * 2. 特殊数据纹理
     * 3. 自动图集源图片
     * 4. 体积过小，不值得消耗 API
     * 5. 需要人工检查
     * 6. 安全候选
     */
    if (options.unsupported) {
        return "unsupported";
    }

    if (options.specialTexture) {
        return "special-texture";
    }

    if (options.atlas) {
        return "atlas";
    }

    if (options.tooSmall) {
        return "too-small";
    }

    if (options.manualReview) {
        return "manual-review";
    }

    return "safe";
}

export function classifySourceImageFile(
    file: InspectedSourceImageFile,
    atlasDirectories: readonly AutoAtlasDirectoryInfo[],
    config: ResolvedSourceImageOptimizerConfig,
): ClassifiedSourceImageFile {
    const reasons: string[] = [];

    const formatEnabled = isFormatEnabled(file, config);

    const unsupported =
        file.metadata.format === "unknown" ||
        !formatEnabled;

    if (file.metadata.format === "unknown") {
        reasons.push("无法识别图片格式");
    } else if (!formatEnabled) {
        reasons.push(
            `配置未启用 ${file.metadata.format} 压缩`,
        );
    }

    const excludedDirectory =
        findMatchingDirectory(
            file,
            config.excludeDirectories,
        );

    const excludedNamePattern =
        findMatchingNamePattern(
            file,
            config.excludeNamePatterns,
        );

    const specialTexture =
        excludedDirectory !== null ||
        excludedNamePattern !== null;

    if (excludedDirectory !== null) {
        reasons.push(
            `路径命中特殊纹理目录：${excludedDirectory}`,
        );
    }

    if (excludedNamePattern !== null) {
        reasons.push(
            `文件名命中特殊纹理规则：${excludedNamePattern}`,
        );
    }

    const atlas = findAutoAtlasForImage(
        file,
        atlasDirectories,
        config,
    );

    if (atlas !== null) {
        reasons.push(
            `位于自动图集目录：` +
            atlas.projectRelativeConfigPath,
        );
    }

    const tooSmall =
        file.sizeBytes <
        config.minimumFileSizeBytes;

    if (tooSmall) {
        reasons.push(
            `文件小于最小处理体积 ` +
            `${config.minimumFileSizeBytes} 字节`,
        );
    }

    const manualReviewDirectory =
        findMatchingDirectory(
            file,
            config.manualReviewDirectories,
        );

    const manualReviewNamePattern =
        findMatchingNamePattern(
            file,
            config.manualReviewNamePatterns,
        );

    const manualReview =
        manualReviewDirectory !== null ||
        manualReviewNamePattern !== null;

    if (manualReviewDirectory !== null) {
        reasons.push(
            `路径命中人工检查目录：` +
            manualReviewDirectory,
        );
    }

    if (manualReviewNamePattern !== null) {
        reasons.push(
            `文件名命中人工检查规则：` +
            manualReviewNamePattern,
        );
    }

    const classification =
        determinePrimaryClassification({
            unsupported,
            specialTexture,
            atlas: atlas !== null,
            tooSmall,
            manualReview,
        });

    if (classification === "safe") {
        reasons.push(
            "未命中自动图集、特殊纹理、人工检查或小文件规则",
        );
    }

    return {
        ...file,
        classification,
        reasons,

        atlasConfigPath:
            atlas?.projectRelativeConfigPath ?? null,
    };
}

export function classifySourceImageFiles(
    files: readonly InspectedSourceImageFile[],
    atlasDirectories: readonly AutoAtlasDirectoryInfo[],
    config: ResolvedSourceImageOptimizerConfig,
): ClassifiedSourceImageFile[] {
    const result = files.map((file) =>
        classifySourceImageFile(
            file,
            atlasDirectories,
            config,
        ),
    );

    result.sort((left, right) =>
        left.assetsRelativePath.localeCompare(
            right.assetsRelativePath,
            "en",
        ),
    );

    return result;
}