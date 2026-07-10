import { readdir } from "node:fs/promises";
import path from "node:path";

import type {
    AutoAtlasDirectoryInfo,
    InspectedSourceImageFile,
    ResolvedSourceImageOptimizerConfig,
} from "./types.js";

function toPortablePath(filePath: string): string {
    return filePath.split(path.sep).join("/");
}

async function scanDirectoryForAtlasConfigs(
    currentDirectory: string,
    config: ResolvedSourceImageOptimizerConfig,
    configExtensions: ReadonlySet<string>,
    output: AutoAtlasDirectoryInfo[],
): Promise<void> {
    const entries = await readdir(currentDirectory, {
        withFileTypes: true,
    });

    entries.sort((left, right) =>
        left.name.localeCompare(right.name, "en"),
    );

    for (const entry of entries) {
        const absolutePath = path.join(
            currentDirectory,
            entry.name,
        );

        if (entry.isDirectory()) {
            await scanDirectoryForAtlasConfigs(
                absolutePath,
                config,
                configExtensions,
                output,
            );

            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        const extension = path
            .extname(entry.name)
            .toLowerCase();

        if (!configExtensions.has(extension)) {
            continue;
        }

        const absoluteDirectoryPath =
            path.dirname(absolutePath);

        output.push({
            absoluteConfigPath: path.normalize(absolutePath),
            absoluteDirectoryPath:
                path.normalize(absoluteDirectoryPath),

            projectRelativeConfigPath: toPortablePath(
                path.relative(
                    config.resolvedProjectRoot,
                    absolutePath,
                ),
            ),

            assetsRelativeConfigPath: toPortablePath(
                path.relative(
                    config.resolvedAssetsDirectory,
                    absolutePath,
                ),
            ),

            assetsRelativeDirectoryPath: toPortablePath(
                path.relative(
                    config.resolvedAssetsDirectory,
                    absoluteDirectoryPath,
                ),
            ),
        });
    }
}

/**
 * 查找 assets 目录下所有自动图集配置文件。
 *
 * 当前只根据配置扩展名识别，例如 .pac。
 * 不读取也不修改 .pac 内容。
 */
export async function detectAutoAtlasDirectories(
    config: ResolvedSourceImageOptimizerConfig,
): Promise<AutoAtlasDirectoryInfo[]> {
    if (!config.autoAtlas.enabled) {
        return [];
    }

    const configExtensions = new Set(
        config.autoAtlas.configExtensions.map(
            (extension) => extension.toLowerCase(),
        ),
    );

    const result: AutoAtlasDirectoryInfo[] = [];

    await scanDirectoryForAtlasConfigs(
        config.resolvedAssetsDirectory,
        config,
        configExtensions,
        result,
    );

    /*
     * 较深层的图集目录排在前面。
     *
     * 如果存在嵌套图集目录，图片优先归属距离它最近的配置。
     */
    result.sort((left, right) => {
        const depthDifference =
            right.absoluteDirectoryPath.length -
            left.absoluteDirectoryPath.length;

        if (depthDifference !== 0) {
            return depthDifference;
        }

        return left.assetsRelativeConfigPath.localeCompare(
            right.assetsRelativeConfigPath,
            "en",
        );
    });

    return result;
}

function isPathInsideDirectory(
    filePath: string,
    directoryPath: string,
): boolean {
    const relativePath = path.relative(
        directoryPath,
        filePath,
    );

    return (
        relativePath.length > 0 &&
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

/**
 * 查找图片所属的自动图集。
 */
export function findAutoAtlasForImage(
    file: InspectedSourceImageFile,
    atlasDirectories: readonly AutoAtlasDirectoryInfo[],
    config: ResolvedSourceImageOptimizerConfig,
): AutoAtlasDirectoryInfo | null {
    if (!config.autoAtlas.enabled) {
        return null;
    }

    for (const atlas of atlasDirectories) {
        if (
            !isPathInsideDirectory(
                file.absolutePath,
                atlas.absoluteDirectoryPath,
            )
        ) {
            continue;
        }

        const imageDirectory = path.dirname(
            file.absolutePath,
        );

        const isDirectChild =
            path.normalize(imageDirectory) ===
            path.normalize(atlas.absoluteDirectoryPath);

        if (
            isDirectChild &&
            config.autoAtlas.excludeAtlasDirectory
        ) {
            return atlas;
        }

        if (
            !isDirectChild &&
            config.autoAtlas.excludeAtlasSubdirectories
        ) {
            return atlas;
        }
    }

    return null;
}