import {
    readdir,
} from "node:fs/promises";

import path from "node:path";

import {
    toPortablePath,
} from "../tinypng/file-utils.js";

import type {
    BuildImageExtension,
    ScannedBuildImageFile,
} from "./types.js";

const SUPPORTED_EXTENSIONS = new Set<BuildImageExtension>([
    ".png",
    ".jpg",
    ".jpeg",
]);

function getSupportedExtension(
    filePath: string,
): BuildImageExtension | null {
    const extension = path.extname(filePath)
        .toLowerCase();

    return SUPPORTED_EXTENSIONS.has(
        extension as BuildImageExtension,
    )
        ? extension as BuildImageExtension
        : null;
}

async function scanDirectory(
    rootDirectory: string,
    currentDirectory: string,
    output: ScannedBuildImageFile[],
): Promise<void> {
    let entries;

    try {
        entries = await readdir(
            currentDirectory,
            {
                withFileTypes: true,
            },
        );
    } catch (error) {
        throw new Error(
            `无法扫描构建目录：${currentDirectory}`,
            {
                cause: error,
            },
        );
    }

    entries.sort(
        (left, right) =>
            left.name.localeCompare(
                right.name,
                "en",
            ),
    );

    for (const entry of entries) {
        const absolutePath = path.join(
            currentDirectory,
            entry.name,
        );

        if (entry.isDirectory()) {
            await scanDirectory(
                rootDirectory,
                absolutePath,
                output,
            );

            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        const extension =
            getSupportedExtension(
                absolutePath,
            );

        if (!extension) {
            continue;
        }

        output.push({
            absolutePath,
            relativePath: toPortablePath(
                path.relative(
                    rootDirectory,
                    absolutePath,
                ),
            ),
            extension,
        });
    }
}

/**
 * 递归扫描整个构建目录，而不是只检查 assets 下的 native 目录。
 */
export async function scanBuildImages(
    rootDirectory: string,
): Promise<ScannedBuildImageFile[]> {
    const output: ScannedBuildImageFile[] = [];

    await scanDirectory(
        rootDirectory,
        rootDirectory,
        output,
    );

    output.sort(
        (left, right) =>
            left.relativePath.localeCompare(
                right.relativePath,
                "en",
            ),
    );

    return output;
}
