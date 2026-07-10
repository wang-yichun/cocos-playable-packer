import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
    ResolvedSourceImageOptimizerConfig,
    SourceImageOptimizerConfig,
} from "./types.js";

function assertNonEmptyString(
    value: unknown,
    fieldName: string,
): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`配置字段 "${fieldName}" 必须是非空字符串。`);
    }
}

function assertBoolean(
    value: unknown,
    fieldName: string,
): asserts value is boolean {
    if (typeof value !== "boolean") {
        throw new Error(`配置字段 "${fieldName}" 必须是 boolean。`);
    }
}

function assertStringArray(
    value: unknown,
    fieldName: string,
): asserts value is string[] {
    if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string")
    ) {
        throw new Error(`配置字段 "${fieldName}" 必须是字符串数组。`);
    }
}

function assertNonNegativeInteger(
    value: unknown,
    fieldName: string,
): asserts value is number {
    if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0
    ) {
        throw new Error(`配置字段 "${fieldName}" 必须是非负整数。`);
    }
}

/**
 * Windows PowerShell 5.1 使用 Set-Content -Encoding UTF8 时，
 * 通常会在文件开头写入 UTF-8 BOM。
 *
 * JSON.parse 无法直接处理 BOM，因此读取后需要主动移除。
 */
function removeUtf8Bom(content: string): string {
    if (content.charCodeAt(0) === 0xfeff) {
        return content.slice(1);
    }

    return content;
}

function normalizeExtension(extension: string): string {
    const normalized = extension.trim().toLowerCase();

    if (normalized.length === 0) {
        throw new Error("图片扩展名不能为空。");
    }

    return normalized.startsWith(".")
        ? normalized
        : `.${normalized}`;
}

function normalizeStringArray(values: string[]): string[] {
    return [
        ...new Set(
            values
                .map((value) => value.trim().toLowerCase())
                .filter((value) => value.length > 0),
        ),
    ];
}

function resolveFromBase(baseDirectory: string, targetPath: string): string {
    if (path.isAbsolute(targetPath)) {
        return path.normalize(targetPath);
    }

    return path.resolve(baseDirectory, targetPath);
}

function validateConfig(
    value: unknown,
): asserts value is SourceImageOptimizerConfig {
    if (typeof value !== "object" || value === null) {
        throw new Error("配置文件根节点必须是一个 JSON 对象。");
    }

    const config = value as Record<string, unknown>;

    assertNonEmptyString(config.projectName, "projectName");
    assertNonEmptyString(config.projectRoot, "projectRoot");
    assertNonEmptyString(config.assetsDirectory, "assetsDirectory");
    assertNonEmptyString(
        config.workspaceDirectory,
        "workspaceDirectory",
    );
    assertNonEmptyString(config.cacheDirectory, "cacheDirectory");

    assertStringArray(config.extensions, "extensions");
    assertStringArray(
        config.excludeDirectories,
        "excludeDirectories",
    );
    assertStringArray(
        config.manualReviewDirectories,
        "manualReviewDirectories",
    );
    assertStringArray(
        config.excludeNamePatterns,
        "excludeNamePatterns",
    );
    assertStringArray(
        config.manualReviewNamePatterns,
        "manualReviewNamePatterns",
    );

    assertNonNegativeInteger(
        config.minimumFileSizeBytes,
        "minimumFileSizeBytes",
    );

    if (
        typeof config.autoAtlas !== "object" ||
        config.autoAtlas === null
    ) {
        throw new Error('配置字段 "autoAtlas" 必须是对象。');
    }

    const autoAtlas = config.autoAtlas as Record<string, unknown>;

    assertBoolean(autoAtlas.enabled, "autoAtlas.enabled");
    assertStringArray(
        autoAtlas.configExtensions,
        "autoAtlas.configExtensions",
    );
    assertBoolean(
        autoAtlas.excludeAtlasDirectory,
        "autoAtlas.excludeAtlasDirectory",
    );
    assertBoolean(
        autoAtlas.excludeAtlasSubdirectories,
        "autoAtlas.excludeAtlasSubdirectories",
    );

    if (
        typeof config.compression !== "object" ||
        config.compression === null
    ) {
        throw new Error('配置字段 "compression" 必须是对象。');
    }

    const compression = config.compression as Record<string, unknown>;

    assertBoolean(
        compression.processPng,
        "compression.processPng",
    );
    assertBoolean(
        compression.processJpeg,
        "compression.processJpeg",
    );
    assertBoolean(
        compression.preserveExtension,
        "compression.preserveExtension",
    );
    assertBoolean(
        compression.overwriteSource,
        "compression.overwriteSource",
    );
}

export async function loadSourceImageOptimizerConfig(
    configFilePath: string,
    toolRoot = process.cwd(),
): Promise<ResolvedSourceImageOptimizerConfig> {
    const resolvedToolRoot = path.resolve(toolRoot);

    const resolvedConfigFilePath = resolveFromBase(
        resolvedToolRoot,
        configFilePath,
    );

    let rawContent: string;

    try {
        rawContent = await readFile(resolvedConfigFilePath, "utf8");
    } catch (error) {
        throw new Error(
            `无法读取配置文件：${resolvedConfigFilePath}`,
            {
                cause: error,
            },
        );
    }

    let parsedConfig: unknown;

    try {
        parsedConfig = JSON.parse(removeUtf8Bom(rawContent));
    } catch (error) {
        throw new Error(
            `配置文件不是合法 JSON：${resolvedConfigFilePath}`,
            {
                cause: error,
            },
        );
    }

    validateConfig(parsedConfig);

    const normalizedConfig: SourceImageOptimizerConfig = {
        ...parsedConfig,

        projectName: parsedConfig.projectName.trim(),

        projectRoot: parsedConfig.projectRoot.trim(),
        assetsDirectory: parsedConfig.assetsDirectory.trim(),
        workspaceDirectory: parsedConfig.workspaceDirectory.trim(),
        cacheDirectory: parsedConfig.cacheDirectory.trim(),

        extensions: [
            ...new Set(
                parsedConfig.extensions.map(normalizeExtension),
            ),
        ],

        autoAtlas: {
            ...parsedConfig.autoAtlas,
            configExtensions: [
                ...new Set(
                    parsedConfig.autoAtlas.configExtensions.map(
                        normalizeExtension,
                    ),
                ),
            ],
        },

        excludeDirectories: normalizeStringArray(
            parsedConfig.excludeDirectories,
        ),

        manualReviewDirectories: normalizeStringArray(
            parsedConfig.manualReviewDirectories,
        ),

        excludeNamePatterns: normalizeStringArray(
            parsedConfig.excludeNamePatterns,
        ),

        manualReviewNamePatterns: normalizeStringArray(
            parsedConfig.manualReviewNamePatterns,
        ),
    };

    const resolvedProjectRoot = resolveFromBase(
        resolvedToolRoot,
        normalizedConfig.projectRoot,
    );

    const resolvedAssetsDirectory = resolveFromBase(
        resolvedProjectRoot,
        normalizedConfig.assetsDirectory,
    );

    const resolvedWorkspaceDirectory = resolveFromBase(
        resolvedToolRoot,
        normalizedConfig.workspaceDirectory,
    );

    const resolvedCacheDirectory = resolveFromBase(
        resolvedToolRoot,
        normalizedConfig.cacheDirectory,
    );

    return {
        ...normalizedConfig,

        toolRoot: resolvedToolRoot,
        configFilePath: resolvedConfigFilePath,

        resolvedProjectRoot,
        resolvedAssetsDirectory,
        resolvedWorkspaceDirectory,
        resolvedCacheDirectory,
    };
}