import {
    stat,
} from "node:fs/promises";

import path from "node:path";

import type {
    ValidatedCocosBuild,
} from "./types.js";

async function requirePathType(
    targetPath: string,
    expectedType: "file" | "directory",
): Promise<void> {
    let targetStat;

    try {
        targetStat = await stat(targetPath);
    } catch (error) {
        throw new Error(
            `缺少 Cocos 构建${
                expectedType === "file"
                    ? "文件"
                    : "目录"
            }：${targetPath}`,
            {
                cause: error,
            },
        );
    }

    const valid =
        expectedType === "file"
            ? targetStat.isFile()
            : targetStat.isDirectory();

    if (!valid) {
        throw new Error(
            `Cocos 构建路径类型不正确：${targetPath} ` +
            `应为${
                expectedType === "file"
                    ? "文件"
                    : "目录"
            }。`,
        );
    }
}

/**
 * 第一阶段只接受典型的 Cocos Creator 3.8 Web 构建目录。
 */
export async function validateCocosBuildDirectory(
    inputPath: string,
): Promise<ValidatedCocosBuild> {
    const normalizedInputPath = inputPath.trim();

    if (!normalizedInputPath) {
        throw new Error(
            "Cocos 构建目录不能为空。",
        );
    }

    const rootDirectory = path.resolve(
        process.cwd(),
        normalizedInputPath,
    );

    await requirePathType(
        rootDirectory,
        "directory",
    );

    const indexHtmlPath = path.join(
        rootDirectory,
        "index.html",
    );

    await requirePathType(
        indexHtmlPath,
        "file",
    );

    for (const directoryName of [
        "src",
        "assets",
        "cocos-js",
    ]) {
        await requirePathType(
            path.join(
                rootDirectory,
                directoryName,
            ),
            "directory",
        );
    }

    return {
        inputPath: normalizedInputPath,
        rootDirectory,
        indexHtmlPath,
    };
}
