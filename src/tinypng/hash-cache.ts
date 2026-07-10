import { createHash } from "node:crypto";

import {
    mkdir,
    readFile,
    rename,
    unlink,
    writeFile,
} from "node:fs/promises";

import path from "node:path";

import type {
    LoadedTinyPngCache,
    ResolvedSourceImageOptimizerConfig,
    SourceImageCandidateItem,
    TinyPngCacheEntry,
    TinyPngCacheIndex,
    TinyPngCacheLookupResult,
    TinyPngCacheVerificationResult,
} from "./types.js";

const CACHE_SCHEMA_VERSION = 1;

function isNodeError(
    error: unknown,
): error is NodeJS.ErrnoException {
    return (
        error instanceof Error &&
        "code" in error
    );
}

function removeUtf8Bom(content: string): string {
    if (content.charCodeAt(0) === 0xfeff) {
        return content.slice(1);
    }

    return content;
}

function isRecord(
    value: unknown,
): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function requireString(
    value: unknown,
    fieldName: string,
): string {
    if (
        typeof value !== "string" ||
        value.length === 0
    ) {
        throw new Error(
            `缓存字段 "${fieldName}" 必须是非空字符串。`,
        );
    }

    return value;
}

function requireNonNegativeInteger(
    value: unknown,
    fieldName: string,
): number {
    if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0
    ) {
        throw new Error(
            `缓存字段 "${fieldName}" 必须是非负整数。`,
        );
    }

    return value;
}

function requireNonNegativeNumber(
    value: unknown,
    fieldName: string,
): number {
    if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0
    ) {
        throw new Error(
            `缓存字段 "${fieldName}" 必须是非负数。`,
        );
    }

    return value;
}

function validateSha256(
    value: string,
    fieldName: string,
): void {
    if (!/^[a-f0-9]{64}$/i.test(value)) {
        throw new Error(
            `缓存字段 "${fieldName}" 不是合法 SHA-256：${value}`,
        );
    }
}

function calculateSha256(buffer: Buffer): string {
    return createHash("sha256")
        .update(buffer)
        .digest("hex");
}

function createEmptyCacheIndex(): TinyPngCacheIndex {
    const now = new Date().toISOString();

    return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        provider: "tinypng",

        createdAt: now,
        updatedAt: now,

        entries: {},
    };
}

function parseCacheEntry(
    sourceSha256Key: string,
    value: unknown,
): TinyPngCacheEntry {
    if (!isRecord(value)) {
        throw new Error(
            `缓存记录 "${sourceSha256Key}" 必须是对象。`,
        );
    }

    const sourceSha256 = requireString(
        value.sourceSha256,
        `${sourceSha256Key}.sourceSha256`,
    );

    validateSha256(
        sourceSha256,
        `${sourceSha256Key}.sourceSha256`,
    );

    if (sourceSha256 !== sourceSha256Key) {
        throw new Error(
            `缓存记录键与 sourceSha256 不一致：${sourceSha256Key}`,
        );
    }

    const sourceFormat = requireString(
        value.sourceFormat,
        `${sourceSha256Key}.sourceFormat`,
    );

    if (
        sourceFormat !== "png" &&
        sourceFormat !== "jpeg"
    ) {
        throw new Error(
            `缓存记录 "${sourceSha256Key}" 的 sourceFormat 无效。`,
        );
    }

    const compressedSha256 = requireString(
        value.compressedSha256,
        `${sourceSha256Key}.compressedSha256`,
    );

    validateSha256(
        compressedSha256,
        `${sourceSha256Key}.compressedSha256`,
    );

    return {
        sourceSha256,

        sourceBytes: requireNonNegativeInteger(
            value.sourceBytes,
            `${sourceSha256Key}.sourceBytes`,
        ),

        sourceExtension: requireString(
            value.sourceExtension,
            `${sourceSha256Key}.sourceExtension`,
        ),

        sourceFormat,

        compressedRelativePath: requireString(
            value.compressedRelativePath,
            `${sourceSha256Key}.compressedRelativePath`,
        ),

        compressedSha256,

        compressedBytes: requireNonNegativeInteger(
            value.compressedBytes,
            `${sourceSha256Key}.compressedBytes`,
        ),

        compressionRatio: requireNonNegativeNumber(
            value.compressionRatio,
            `${sourceSha256Key}.compressionRatio`,
        ),

        createdAt: requireString(
            value.createdAt,
            `${sourceSha256Key}.createdAt`,
        ),

        updatedAt: requireString(
            value.updatedAt,
            `${sourceSha256Key}.updatedAt`,
        ),
    };
}

function parseCacheIndex(
    value: unknown,
): TinyPngCacheIndex {
    if (!isRecord(value)) {
        throw new Error(
            "TinyPNG 缓存 index.json 根节点必须是对象。",
        );
    }

    const schemaVersion = requireNonNegativeInteger(
        value.schemaVersion,
        "schemaVersion",
    );

    if (schemaVersion !== CACHE_SCHEMA_VERSION) {
        throw new Error(
            `不支持的缓存 schemaVersion：${schemaVersion}`,
        );
    }

    if (value.provider !== "tinypng") {
        throw new Error(
            '缓存 provider 必须是 "tinypng"。',
        );
    }

    if (!isRecord(value.entries)) {
        throw new Error(
            '缓存字段 "entries" 必须是对象。',
        );
    }

    const entries: Record<string, TinyPngCacheEntry> = {};

    for (
        const [sourceSha256, entryValue]
        of Object.entries(value.entries)
    ) {
        validateSha256(
            sourceSha256,
            `entries.${sourceSha256}`,
        );

        entries[sourceSha256] = parseCacheEntry(
            sourceSha256,
            entryValue,
        );
    }

    return {
        schemaVersion,
        provider: "tinypng",

        createdAt: requireString(
            value.createdAt,
            "createdAt",
        ),

        updatedAt: requireString(
            value.updatedAt,
            "updatedAt",
        ),

        entries,
    };
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
        /*
         * Windows 上 rename 覆盖已存在文件时，
         * 可能出现 EEXIST 或 EPERM。
         */
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

async function writeBufferAtomically(
    filePath: string,
    buffer: Buffer,
): Promise<void> {
    await mkdir(
        path.dirname(filePath),
        {
            recursive: true,
        },
    );

    const temporaryPath =
        `${filePath}.${process.pid}.${Date.now()}.tmp`;

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

async function writeJsonAtomically(
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

function resolveCompressedFilePath(
    cache: LoadedTinyPngCache,
    compressedRelativePath: string,
): string {
    if (path.isAbsolute(compressedRelativePath)) {
        throw new Error(
            "缓存压缩文件路径不能是绝对路径。",
        );
    }

    const resolvedPath = path.resolve(
        cache.cacheDirectory,
        compressedRelativePath,
    );

    const relativePath = path.relative(
        cache.cacheDirectory,
        resolvedPath,
    );

    if (
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        throw new Error(
            `缓存文件路径越界：${compressedRelativePath}`,
        );
    }

    return resolvedPath;
}

function normalizeCacheExtension(
    extension: string,
): ".png" | ".jpg" | ".jpeg" {
    const normalized =
        extension.toLowerCase();

    if (
        normalized === ".png" ||
        normalized === ".jpg" ||
        normalized === ".jpeg"
    ) {
        return normalized;
    }

    throw new Error(
        `缓存不支持图片扩展名：${extension}`,
    );
}

/**
 * 加载缓存。
 *
 * index.json 不存在时会创建空缓存，
 * 但不会调用 TinyPNG API。
 */
export async function loadTinyPngCache(
    config: ResolvedSourceImageOptimizerConfig,
): Promise<LoadedTinyPngCache> {
    const cacheDirectory =
        config.resolvedCacheDirectory;

    const filesDirectory = path.join(
        cacheDirectory,
        "files",
    );

    const indexPath = path.join(
        cacheDirectory,
        "index.json",
    );

    await mkdir(
        filesDirectory,
        {
            recursive: true,
        },
    );

    let index: TinyPngCacheIndex;

    try {
        const content = await readFile(
            indexPath,
            "utf8",
        );

        index = parseCacheIndex(
            JSON.parse(
                removeUtf8Bom(content),
            ) as unknown,
        );
    } catch (error) {
        if (
            isNodeError(error) &&
            error.code === "ENOENT"
        ) {
            index = createEmptyCacheIndex();

            await writeJsonAtomically(
                indexPath,
                index,
            );
        } else {
            throw new Error(
                `无法加载 TinyPNG 缓存索引：${indexPath}`,
                {
                    cause: error,
                },
            );
        }
    }

    return {
        cacheDirectory,
        filesDirectory,
        indexPath,
        index,
    };
}

export async function saveTinyPngCacheIndex(
    cache: LoadedTinyPngCache,
): Promise<void> {
    cache.index.updatedAt =
        new Date().toISOString();

    await writeJsonAtomically(
        cache.indexPath,
        cache.index,
    );
}

/**
 * 检查指定源哈希是否存在有效缓存。
 *
 * 不仅检查 index.json，还会校验：
 * - 压缩文件存在；
 * - 文件大小一致；
 * - 压缩文件 SHA-256 一致。
 */
export async function lookupTinyPngCache(
    cache: LoadedTinyPngCache,
    sourceSha256: string,
): Promise<TinyPngCacheLookupResult> {
    validateSha256(
        sourceSha256,
        "sourceSha256",
    );

    const entry =
        cache.index.entries[sourceSha256];

    if (!entry) {
        return {
            status: "miss",
            entry: null,
            compressedFilePath: null,
        };
    }

    let compressedFilePath: string;

    try {
        compressedFilePath =
            resolveCompressedFilePath(
                cache,
                entry.compressedRelativePath,
            );
    } catch (error) {
        return {
            status: "invalid",
            entry,
            compressedFilePath: null,
            reason:
                error instanceof Error
                    ? error.message
                    : String(error),
        };
    }

    let buffer: Buffer;

    try {
        buffer = await readFile(
            compressedFilePath,
        );
    } catch (error) {
        return {
            status: "invalid",
            entry,
            compressedFilePath,
            reason:
                `无法读取缓存压缩文件：` +
                (
                    error instanceof Error
                        ? error.message
                        : String(error)
                ),
        };
    }

    if (buffer.length !== entry.compressedBytes) {
        return {
            status: "invalid",
            entry,
            compressedFilePath,
            reason:
                `缓存文件大小不一致：` +
                `索引=${entry.compressedBytes}，` +
                `实际=${buffer.length}`,
        };
    }

    const compressedSha256 =
        calculateSha256(buffer);

    if (
        compressedSha256 !==
        entry.compressedSha256
    ) {
        return {
            status: "invalid",
            entry,
            compressedFilePath,
            reason:
                "缓存压缩文件 SHA-256 不一致。",
        };
    }

    return {
        status: "hit",
        entry,
        compressedFilePath,
    };
}

/**
 * 写入一份 TinyPNG 压缩结果。
 *
 * 当前函数只负责缓存，不负责调用 TinyPNG。
 */
export async function storeTinyPngCacheResult(
    cache: LoadedTinyPngCache,
    source: SourceImageCandidateItem,
    compressedBuffer: Buffer,
): Promise<TinyPngCacheEntry> {
    validateSha256(
        source.sha256,
        "source.sha256",
    );

    if (
        source.metadata.format !== "png" &&
        source.metadata.format !== "jpeg"
    ) {
        throw new Error(
            `不支持写入缓存的图片格式：` +
            source.metadata.format,
        );
    }

    const extension =
        normalizeCacheExtension(
            source.extension,
        );

    const fileName =
        `${source.sha256}${extension}`;

    const compressedRelativePath =
        `files/${fileName}`;

    const compressedFilePath =
        resolveCompressedFilePath(
            cache,
            compressedRelativePath,
        );

    await writeBufferAtomically(
        compressedFilePath,
        compressedBuffer,
    );

    const now =
        new Date().toISOString();

    const previousEntry =
        cache.index.entries[source.sha256];

    const entry: TinyPngCacheEntry = {
        sourceSha256:
            source.sha256,

        sourceBytes:
            source.sizeBytes,

        sourceExtension:
            source.extension,

        sourceFormat:
            source.metadata.format,

        compressedRelativePath,

        compressedSha256:
            calculateSha256(compressedBuffer),

        compressedBytes:
            compressedBuffer.length,

        compressionRatio:
            source.sizeBytes > 0
                ? compressedBuffer.length /
                source.sizeBytes
                : 0,

        createdAt:
            previousEntry?.createdAt ?? now,

        updatedAt:
            now,
    };

    cache.index.entries[source.sha256] =
        entry;

    await saveTinyPngCacheIndex(cache);

    return entry;
}

export async function verifyTinyPngCache(
    cache: LoadedTinyPngCache,
): Promise<TinyPngCacheVerificationResult> {
    const sourceHashes = Object.keys(
        cache.index.entries,
    ).sort();

    let validEntries = 0;
    let invalidEntries = 0;

    let totalSourceBytes = 0;
    let totalCompressedBytes = 0;

    const invalidItems: Array<{
        sourceSha256: string;
        reason: string;
    }> = [];

    for (const sourceSha256 of sourceHashes) {
        const entry =
            cache.index.entries[sourceSha256];

        if (!entry) {
            continue;
        }

        totalSourceBytes +=
            entry.sourceBytes;

        const lookupResult =
            await lookupTinyPngCache(
                cache,
                sourceSha256,
            );

        if (lookupResult.status === "hit") {
            validEntries += 1;

            totalCompressedBytes +=
                lookupResult.entry.compressedBytes;
        } else if (
            lookupResult.status === "invalid"
        ) {
            invalidEntries += 1;

            invalidItems.push({
                sourceSha256,
                reason: lookupResult.reason,
            });
        }
    }

    return {
        totalEntries:
            sourceHashes.length,

        validEntries,
        invalidEntries,

        totalSourceBytes,
        totalCompressedBytes,

        invalidItems,
    };
}