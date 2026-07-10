import {
    readdir,
    stat,
} from "node:fs/promises";
import path from "node:path";

import type {
    ResolvedSourceImageOptimizerConfig,
    ScannedSourceImageFile,
} from "./types.js";

/**
 * 报告和缓存中统一使用正斜杠。
 *
 * Node.js 在 Windows 上通过 path.relative() 得到的路径
 * 默认使用反斜杠，例如：
 *
 * textures\ui\button.png
 *
 * 转换后统一为：
 *
 * textures/ui/button.png
 */
function toPortablePath(filePath: string): string {
    return filePath.split(path.sep).join("/");
}

/**
 * 检查 assets 目录是否真实存在，并确认它是目录。
 */
async function validateAssetsDirectory(
    assetsDirectory: string,
): Promise<void> {
    let directoryStat;

    try {
        directoryStat = await stat(assetsDirectory);
    } catch (error) {
        throw new Error(
            `无法访问 Cocos Creator assets 目录：${assetsDirectory}`,
            {
                cause: error,
            },
        );
    }

    if (!directoryStat.isDirectory()) {
        throw new Error(
            `配置中的 assets 路径不是目录：${assetsDirectory}`,
        );
    }
}

/**
 * 递归扫描单个目录。
 */
async function scanDirectory(
    currentDirectory: string,
    config: ResolvedSourceImageOptimizerConfig,
    allowedExtensions: ReadonlySet<string>,
    output: ScannedSourceImageFile[],
): Promise<void> {
    const entries = await readdir(currentDirectory, {
        withFileTypes: true,
    });

    /*
     * 文件系统返回顺序没有跨平台保证。
     *
     * 排序后可以保证：
     * - 每次生成报告顺序稳定；
     * - Git diff 更清晰；
     * - Windows 和其他平台的结果尽量一致。
     */
    entries.sort((left, right) =>
        left.name.localeCompare(right.name, "en"),
    );

    for (const entry of entries) {
        const absolutePath = path.join(
            currentDirectory,
            entry.name,
        );

        if (entry.isDirectory()) {
            await scanDirectory(
                absolutePath,
                config,
                allowedExtensions,
                output,
            );

            continue;
        }

        /*
         * 第一版跳过符号链接和其他特殊文件。
         *
         * 这样可以避免：
         * - 符号链接形成递归环；
         * - 扫描到 assets 目录之外；
         * - 同一图片被重复统计。
         */
        if (!entry.isFile()) {
            continue;
        }

        const extension = path
            .extname(entry.name)
            .toLowerCase();

        if (!allowedExtensions.has(extension)) {
            continue;
        }

        const fileStat = await stat(absolutePath);

        const assetsRelativePath = toPortablePath(
            path.relative(
                config.resolvedAssetsDirectory,
                absolutePath,
            ),
        );

        const projectRelativePath = toPortablePath(
            path.relative(
                config.resolvedProjectRoot,
                absolutePath,
            ),
        );

        output.push({
            absolutePath: path.normalize(absolutePath),
            projectRelativePath,
            assetsRelativePath,

            basename: entry.name,
            extension,

            sizeBytes: fileStat.size,
            modifiedTimeMs: fileStat.mtimeMs,
        });
    }
}

/**
 * 扫描 Cocos Creator assets 目录中的目标图片。
 *
 * 当前函数是完全只读的：
 * - 不创建文件；
 * - 不修改图片；
 * - 不读取 .meta 内容；
 * - 不调用 TinyPNG；
 * - 不消耗 API 次数。
 */
export async function scanSourceImageFiles(
    config: ResolvedSourceImageOptimizerConfig,
): Promise<ScannedSourceImageFile[]> {
    await validateAssetsDirectory(
        config.resolvedAssetsDirectory,
    );

    const allowedExtensions = new Set(
        config.extensions.map((extension) =>
            extension.toLowerCase(),
        ),
    );

    const files: ScannedSourceImageFile[] = [];

    await scanDirectory(
        config.resolvedAssetsDirectory,
        config,
        allowedExtensions,
        files,
    );

    /*
     * 递归过程中已经逐目录排序，但再按完整路径排序一次，
     * 可以确保最终结果完全稳定。
     */
    files.sort((left, right) =>
        left.assetsRelativePath.localeCompare(
            right.assetsRelativePath,
            "en",
        ),
    );

    return files;
}