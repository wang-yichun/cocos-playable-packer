import {
    mkdir,
    readFile,
    rename,
    unlink,
    writeFile,
} from "node:fs/promises";

import path from "node:path";

export function isNodeError(
    error: unknown,
): error is NodeJS.ErrnoException {
    return (
        error instanceof Error &&
        "code" in error
    );
}

export function isRecord(
    value: unknown,
): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

export function toErrorMessage(
    error: unknown,
): string {
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

export function resolvePortableRelativePath(
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

function removeUtf8Bom(
    content: string,
): string {
    return content.charCodeAt(0) === 0xfeff
        ? content.slice(1)
        : content;
}

export async function readJsonUnknown(
    filePath: string,
): Promise<unknown> {
    const content = await readFile(
        filePath,
        "utf8",
    );

    return JSON.parse(
        removeUtf8Bom(content),
    ) as unknown;
}

async function replaceFile(
    temporaryPath: string,
    targetPath: string,
): Promise<void> {
    try {
        await rename(
            temporaryPath,
            targetPath,
        );
    } catch (error) {
        if (
            isNodeError(error) &&
            (
                error.code === "EEXIST" ||
                error.code === "EPERM"
            )
        ) {
            await unlink(targetPath).catch(
                (unlinkError: unknown) => {
                    if (
                        !isNodeError(unlinkError) ||
                        unlinkError.code !== "ENOENT"
                    ) {
                        throw unlinkError;
                    }
                },
            );

            await rename(
                temporaryPath,
                targetPath,
            );

            return;
        }

        throw error;
    }
}

export async function writeBufferAtomically(
    filePath: string,
    buffer: Buffer,
): Promise<void> {
    await mkdir(
        path.dirname(filePath),
        {
            recursive: true,
        },
    );

    const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.` +
        `${process.pid}.${Date.now()}.tmp`,
    );

    try {
        await writeFile(
            temporaryPath,
            buffer,
        );

        await replaceFile(
            temporaryPath,
            filePath,
        );
    } catch (error) {
        await unlink(temporaryPath).catch(() => {
            // 临时文件可能尚未创建。
        });

        throw error;
    }
}

export async function writeJsonAtomically(
    filePath: string,
    value: unknown,
): Promise<void> {
    const content =
        `${JSON.stringify(value, null, 2)}\n`;

    await writeBufferAtomically(
        filePath,
        Buffer.from(content, "utf8"),
    );
}
