import {
    mkdir,
    readFile,
} from "node:fs/promises";

import path from "node:path";

import {
    isNodeError,
    isRecord,
    readJsonUnknown,
    resolvePortableRelativePath,
    toErrorMessage,
    writeBufferAtomically,
    writeJsonAtomically,
} from "../tinypng/file-utils.js";

import {
    calculateImageSha256,
} from "../tinypng/image-inspector.js";

import type {
    BuildImageCacheEntry,
    BuildImageCacheIndex,
    BuildImageCacheLookupResult,
    BuildImageExtension,
    BuildImageMetadata,
    LoadedBuildImageCache,
} from "./types.js";

const CACHE_SCHEMA_VERSION = 1;

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

function requireOptionalString(
    value: unknown,
    fieldName: string,
): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    return requireString(
        value,
        fieldName,
    );
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

function requireOptionalNonNegativeInteger(
    value: unknown,
    fieldName: string,
): number | undefined {
    if (value === undefined) {
        return undefined;
    }

    return requireNonNegativeInteger(
        value,
        fieldName,
    );
}

function validateSha256(
    value: string,
    fieldName: string,
): void {
    if (!/^[a-f0-9]{64}$/.test(value)) {
        throw new Error(
            `缓存字段 "${fieldName}" 不是合法 SHA-256：${value}`,
        );
    }
}

function requireSha256(
    value: unknown,
    fieldName: string,
): string {
    const result = requireString(
        value,
        fieldName,
    ).toLowerCase();

    validateSha256(
        result,
        fieldName,
    );

    return result;
}

function requireExtension(
    value: unknown,
    fieldName: string,
): BuildImageExtension {
    if (
        value !== ".png" &&
        value !== ".jpg" &&
        value !== ".jpeg"
    ) {
        throw new Error(
            `缓存字段 "${fieldName}" 的扩展名无效。`,
        );
    }

    return value;
}

function parseCacheEntry(
    sourceSha256Key: string,
    value: unknown,
): BuildImageCacheEntry {
    if (!isRecord(value)) {
        throw new Error(
            `缓存记录 "${sourceSha256Key}" 必须是对象。`,
        );
    }

    const sourceSha256 = requireSha256(
        value.sourceSha256,
        `${sourceSha256Key}.sourceSha256`,
    );

    if (sourceSha256 !== sourceSha256Key) {
        throw new Error(
            `缓存记录键与 sourceSha256 不一致：${sourceSha256Key}`,
        );
    }

    const status = value.status;

    if (
        status !== "compressed" &&
        status !== "no-benefit" &&
        status !== "failed"
    ) {
        throw new Error(
            `缓存记录 "${sourceSha256Key}" 的 status 无效。`,
        );
    }

    const entry: BuildImageCacheEntry = {
        sourceSha256,
        extension: requireExtension(
            value.extension,
            `${sourceSha256Key}.extension`,
        ),
        sourceBytes: requireNonNegativeInteger(
            value.sourceBytes,
            `${sourceSha256Key}.sourceBytes`,
        ),
        status,
        createdAt: requireString(
            value.createdAt,
            `${sourceSha256Key}.createdAt`,
        ),
        updatedAt: requireString(
            value.updatedAt,
            `${sourceSha256Key}.updatedAt`,
        ),
    };

    const compressedSha256 =
        requireOptionalString(
            value.compressedSha256,
            `${sourceSha256Key}.compressedSha256`,
        );

    if (compressedSha256 !== undefined) {
        const normalized =
            compressedSha256.toLowerCase();

        validateSha256(
            normalized,
            `${sourceSha256Key}.compressedSha256`,
        );

        entry.compressedSha256 = normalized;
    }

    const compressedBytes =
        requireOptionalNonNegativeInteger(
            value.compressedBytes,
            `${sourceSha256Key}.compressedBytes`,
        );

    if (compressedBytes !== undefined) {
        entry.compressedBytes = compressedBytes;
    }

    const width = requireOptionalNonNegativeInteger(
        value.width,
        `${sourceSha256Key}.width`,
    );

    const height = requireOptionalNonNegativeInteger(
        value.height,
        `${sourceSha256Key}.height`,
    );

    if (width !== undefined) {
        entry.width = width;
    }

    if (height !== undefined) {
        entry.height = height;
    }

    const compressedRelativePath =
        requireOptionalString(
            value.compressedRelativePath,
            `${sourceSha256Key}.compressedRelativePath`,
        );

    if (compressedRelativePath !== undefined) {
        entry.compressedRelativePath =
            compressedRelativePath;
    }

    const errorMessage = requireOptionalString(
        value.errorMessage,
        `${sourceSha256Key}.errorMessage`,
    );

    if (errorMessage !== undefined) {
        entry.errorMessage = errorMessage;
    }

    if (status === "compressed") {
        if (
            entry.compressedSha256 === undefined ||
            entry.compressedBytes === undefined ||
            entry.compressedRelativePath === undefined
        ) {
            throw new Error(
                `compressed 缓存记录缺少压缩结果字段：${sourceSha256Key}`,
            );
        }

        if (entry.compressedBytes >= entry.sourceBytes) {
            throw new Error(
                `compressed 缓存记录没有体积收益：${sourceSha256Key}`,
            );
        }
    }

    return entry;
}

function createEmptyCacheIndex(): BuildImageCacheIndex {
    const now = new Date().toISOString();

    return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        provider: "tinypng",
        namespace: "build-images",
        createdAt: now,
        updatedAt: now,
        entriesBySourceSha256: {},
        sourceSha256ByCompressedSha256: {},
    };
}

function buildCompressedIndex(
    entries: Record<string, BuildImageCacheEntry>,
): Record<string, string> {
    const output: Record<string, string> = {};

    for (const [sourceSha256, entry] of Object.entries(entries)) {
        if (
            entry.status !== "compressed" ||
            !entry.compressedSha256
        ) {
            continue;
        }

        output[entry.compressedSha256] =
            sourceSha256;
    }

    return output;
}

function parseCacheIndex(
    value: unknown,
): BuildImageCacheIndex {
    if (!isRecord(value)) {
        throw new Error(
            "构建图片缓存 index.json 根节点必须是对象。",
        );
    }

    if (value.schemaVersion !== CACHE_SCHEMA_VERSION) {
        throw new Error(
            `不支持的构建图片缓存 schemaVersion：${String(
                value.schemaVersion,
            )}`,
        );
    }

    if (value.provider !== "tinypng") {
        throw new Error(
            '构建图片缓存 provider 必须是 "tinypng"。',
        );
    }

    if (value.namespace !== "build-images") {
        throw new Error(
            '构建图片缓存 namespace 必须是 "build-images"。',
        );
    }

    if (!isRecord(value.entriesBySourceSha256)) {
        throw new Error(
            '缓存字段 "entriesBySourceSha256" 必须是对象。',
        );
    }

    if (!isRecord(value.sourceSha256ByCompressedSha256)) {
        throw new Error(
            '缓存字段 "sourceSha256ByCompressedSha256" 必须是对象。',
        );
    }

    const entriesBySourceSha256:
        Record<string, BuildImageCacheEntry> = {};

    for (
        const [sourceSha256Key, entryValue]
        of Object.entries(value.entriesBySourceSha256)
    ) {
        const normalizedKey =
            sourceSha256Key.toLowerCase();

        validateSha256(
            normalizedKey,
            `entriesBySourceSha256.${sourceSha256Key}`,
        );

        entriesBySourceSha256[normalizedKey] =
            parseCacheEntry(
                normalizedKey,
                entryValue,
            );
    }

    const storedCompressedIndex:
        Record<string, string> = {};

    for (
        const [compressedSha256Key, sourceSha256Value]
        of Object.entries(
            value.sourceSha256ByCompressedSha256,
        )
    ) {
        const compressedSha256 =
            compressedSha256Key.toLowerCase();

        validateSha256(
            compressedSha256,
            `sourceSha256ByCompressedSha256.${compressedSha256Key}`,
        );

        const sourceSha256 = requireSha256(
            sourceSha256Value,
            `sourceSha256ByCompressedSha256.${compressedSha256Key}`,
        );

        storedCompressedIndex[compressedSha256] =
            sourceSha256;
    }

    const expectedCompressedIndex =
        buildCompressedIndex(
            entriesBySourceSha256,
        );

    const storedCompressedKeys = Object.keys(
        storedCompressedIndex,
    );

    const expectedCompressedKeys = Object.keys(
        expectedCompressedIndex,
    );

    const compressedIndexMatches =
        storedCompressedKeys.length ===
        expectedCompressedKeys.length &&
        expectedCompressedKeys.every(
            (compressedSha256) =>
                storedCompressedIndex[compressedSha256] ===
                expectedCompressedIndex[compressedSha256],
        );

    if (!compressedIndexMatches) {
        throw new Error(
            "构建图片缓存的 compressed SHA 快速索引与源条目不一致。",
        );
    }

    return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        provider: "tinypng",
        namespace: "build-images",
        createdAt: requireString(
            value.createdAt,
            "createdAt",
        ),
        updatedAt: requireString(
            value.updatedAt,
            "updatedAt",
        ),
        entriesBySourceSha256,
        sourceSha256ByCompressedSha256:
            storedCompressedIndex,
    };
}

function getCanonicalCacheExtension(
    extension: BuildImageExtension,
): ".png" | ".jpg" {
    return extension === ".png"
        ? ".png"
        : ".jpg";
}

function getCompressedRelativePath(
    sourceSha256: string,
    extension: BuildImageExtension,
): string {
    return (
        `files/${sourceSha256}` +
        getCanonicalCacheExtension(extension)
    );
}

function rebuildCompressedIndex(
    cache: LoadedBuildImageCache,
): void {
    cache.index.sourceSha256ByCompressedSha256 =
        buildCompressedIndex(
            cache.index.entriesBySourceSha256,
        );
}

function createEntryBase(
    cache: LoadedBuildImageCache,
    sourceSha256: string,
    extension: BuildImageExtension,
    sourceBytes: number,
    metadata: BuildImageMetadata,
): Pick<
    BuildImageCacheEntry,
    | "sourceSha256"
    | "extension"
    | "sourceBytes"
    | "width"
    | "height"
    | "createdAt"
    | "updatedAt"
> {
    const now = new Date().toISOString();
    const previousEntry =
        cache.index.entriesBySourceSha256[
            sourceSha256
        ];

    return {
        sourceSha256,
        extension,
        sourceBytes,
        ...(metadata.width !== undefined
            ? { width: metadata.width }
            : {}),
        ...(metadata.height !== undefined
            ? { height: metadata.height }
            : {}),
        createdAt:
            previousEntry?.createdAt ?? now,
        updatedAt: now,
    };
}

export async function loadBuildImageCache(
    cacheDirectory = path.resolve(
        process.cwd(),
        ".tinypng-cache",
        "build-images",
    ),
): Promise<LoadedBuildImageCache> {
    const filesDirectory = path.join(
        cacheDirectory,
        "files",
    );

    const reportsDirectory = path.join(
        cacheDirectory,
        "reports",
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

    await mkdir(
        reportsDirectory,
        {
            recursive: true,
        },
    );

    let index: BuildImageCacheIndex;

    try {
        index = parseCacheIndex(
            await readJsonUnknown(
                indexPath,
            ),
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
                `无法加载构建图片缓存索引：${indexPath}`,
                {
                    cause: error,
                },
            );
        }
    }

    return {
        cacheDirectory,
        filesDirectory,
        reportsDirectory,
        indexPath,
        index,
    };
}

export async function saveBuildImageCacheIndex(
    cache: LoadedBuildImageCache,
): Promise<void> {
    rebuildCompressedIndex(cache);

    cache.index.updatedAt =
        new Date().toISOString();

    await writeJsonAtomically(
        cache.indexPath,
        cache.index,
    );
}

export function findBuildCacheEntryBySourceSha256(
    cache: LoadedBuildImageCache,
    sourceSha256: string,
): BuildImageCacheEntry | null {
    validateSha256(
        sourceSha256,
        "sourceSha256",
    );

    return (
        cache.index.entriesBySourceSha256[
            sourceSha256
        ] ?? null
    );
}

export function findBuildCacheEntryByCompressedSha256(
    cache: LoadedBuildImageCache,
    compressedSha256: string,
): BuildImageCacheEntry | null {
    validateSha256(
        compressedSha256,
        "compressedSha256",
    );

    const sourceSha256 =
        cache.index.sourceSha256ByCompressedSha256[
            compressedSha256
        ];

    if (!sourceSha256) {
        return null;
    }

    const entry =
        cache.index.entriesBySourceSha256[
            sourceSha256
        ];

    if (
        !entry ||
        entry.status !== "compressed" ||
        entry.compressedSha256 !== compressedSha256
    ) {
        throw new Error(
            "构建图片缓存的 compressed SHA 索引已损坏。",
        );
    }

    return entry;
}

export async function lookupCompressedBuildImage(
    cache: LoadedBuildImageCache,
    entry: BuildImageCacheEntry,
): Promise<BuildImageCacheLookupResult> {
    if (
        entry.status !== "compressed" ||
        !entry.compressedRelativePath ||
        !entry.compressedSha256 ||
        entry.compressedBytes === undefined
    ) {
        return {
            status: "invalid",
            entry,
            compressedFilePath: null,
            compressedBuffer: null,
            reason:
                "缓存条目不是完整的 compressed 记录。",
        };
    }

    let compressedFilePath: string;

    try {
        compressedFilePath =
            resolvePortableRelativePath(
                cache.cacheDirectory,
                entry.compressedRelativePath,
            );
    } catch (error) {
        return {
            status: "invalid",
            entry,
            compressedFilePath: null,
            compressedBuffer: null,
            reason: toErrorMessage(error),
        };
    }

    let compressedBuffer: Buffer;

    try {
        compressedBuffer = await readFile(
            compressedFilePath,
        );
    } catch (error) {
        return {
            status: "invalid",
            entry,
            compressedFilePath,
            compressedBuffer: null,
            reason:
                `无法读取缓存文件：${toErrorMessage(error)}`,
        };
    }

    if (
        compressedBuffer.length !==
        entry.compressedBytes
    ) {
        return {
            status: "invalid",
            entry,
            compressedFilePath,
            compressedBuffer: null,
            reason:
                `缓存文件大小不一致：索引=${entry.compressedBytes}，` +
                `实际=${compressedBuffer.length}`,
        };
    }

    const actualSha256 =
        calculateImageSha256(
            compressedBuffer,
        );

    if (actualSha256 !== entry.compressedSha256) {
        return {
            status: "invalid",
            entry,
            compressedFilePath,
            compressedBuffer: null,
            reason:
                "缓存文件 SHA-256 与索引不一致。",
        };
    }

    return {
        status: "hit",
        entry,
        compressedFilePath,
        compressedBuffer,
    };
}

export async function storeCompressedBuildImage(
    cache: LoadedBuildImageCache,
    sourceSha256: string,
    extension: BuildImageExtension,
    sourceBytes: number,
    metadata: BuildImageMetadata,
    compressedBuffer: Buffer,
): Promise<BuildImageCacheEntry> {
    if (compressedBuffer.length >= sourceBytes) {
        throw new Error(
            "不能把无体积收益的结果写成 compressed 缓存。",
        );
    }

    const compressedSha256 =
        calculateImageSha256(
            compressedBuffer,
        );

    const compressedRelativePath =
        getCompressedRelativePath(
            sourceSha256,
            extension,
        );

    const compressedFilePath =
        resolvePortableRelativePath(
            cache.cacheDirectory,
            compressedRelativePath,
        );

    await writeBufferAtomically(
        compressedFilePath,
        compressedBuffer,
    );

    const entry: BuildImageCacheEntry = {
        ...createEntryBase(
            cache,
            sourceSha256,
            extension,
            sourceBytes,
            metadata,
        ),
        status: "compressed",
        compressedSha256,
        compressedBytes:
            compressedBuffer.length,
        compressedRelativePath,
    };

    cache.index.entriesBySourceSha256[
        sourceSha256
    ] = entry;

    rebuildCompressedIndex(cache);

    return entry;
}

export function storeNoBenefitBuildImage(
    cache: LoadedBuildImageCache,
    sourceSha256: string,
    extension: BuildImageExtension,
    sourceBytes: number,
    metadata: BuildImageMetadata,
    compressedBytes: number,
): BuildImageCacheEntry {
    const entry: BuildImageCacheEntry = {
        ...createEntryBase(
            cache,
            sourceSha256,
            extension,
            sourceBytes,
            metadata,
        ),
        status: "no-benefit",
        compressedBytes,
    };

    cache.index.entriesBySourceSha256[
        sourceSha256
    ] = entry;

    rebuildCompressedIndex(cache);

    return entry;
}

export function storeFailedBuildImage(
    cache: LoadedBuildImageCache,
    sourceSha256: string,
    extension: BuildImageExtension,
    sourceBytes: number,
    metadata: BuildImageMetadata,
    error: unknown,
): BuildImageCacheEntry {
    const entry: BuildImageCacheEntry = {
        ...createEntryBase(
            cache,
            sourceSha256,
            extension,
            sourceBytes,
            metadata,
        ),
        status: "failed",
        errorMessage: toErrorMessage(error),
    };

    cache.index.entriesBySourceSha256[
        sourceSha256
    ] = entry;

    rebuildCompressedIndex(cache);

    return entry;
}

export function removeBuildImageCacheEntry(
    cache: LoadedBuildImageCache,
    sourceSha256: string,
): void {
    delete cache.index.entriesBySourceSha256[
        sourceSha256
    ];

    rebuildCompressedIndex(cache);
}
