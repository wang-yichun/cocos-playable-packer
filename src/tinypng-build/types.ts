export type BuildImageExtension =
    | ".png"
    | ".jpg"
    | ".jpeg";

export type BuildImageFormat =
    | "png"
    | "jpeg";

export type BuildImageCacheStatus =
    | "compressed"
    | "no-benefit"
    | "failed";

export interface ValidatedCocosBuild {
    inputPath: string;
    rootDirectory: string;
    indexHtmlPath: string;
}

export interface ScannedBuildImageFile {
    absolutePath: string;
    relativePath: string;
    extension: BuildImageExtension;
}

export interface BuildImageMetadata {
    format: BuildImageFormat;
    width?: number;
    height?: number;
}

export interface BuildImageCacheEntry {
    sourceSha256: string;
    compressedSha256?: string;

    extension: BuildImageExtension;

    sourceBytes: number;
    compressedBytes?: number;

    width?: number;
    height?: number;

    status: BuildImageCacheStatus;

    compressedRelativePath?: string;
    errorMessage?: string;

    createdAt: string;
    updatedAt: string;
}

export interface BuildImageCacheIndex {
    schemaVersion: 1;
    provider: "tinypng";
    namespace: "build-images";

    createdAt: string;
    updatedAt: string;

    entriesBySourceSha256:
        Record<string, BuildImageCacheEntry>;

    sourceSha256ByCompressedSha256:
        Record<string, string>;
}

export interface LoadedBuildImageCache {
    cacheDirectory: string;
    filesDirectory: string;
    reportsDirectory: string;
    indexPath: string;
    index: BuildImageCacheIndex;
}

export interface BuildImageCacheLookupResult {
    status: "hit" | "invalid";
    entry: BuildImageCacheEntry;
    compressedFilePath: string | null;
    compressedBuffer: Buffer | null;
    reason?: string;
}

export type BuildImageAction =
    | "already-compressed"
    | "cache-replaced"
    | "negative-cache-hit"
    | "api-compressed"
    | "api-no-benefit"
    | "skipped-api-limit"
    | "skipped-after-api-failure"
    | "failed";

export interface BuildImageReportItem {
    relativePath: string;
    extension: BuildImageExtension;

    sourceSha256?: string;
    finalSha256?: string;

    sourceBytes: number;
    finalBytes: number;
    savedBytes: number;

    width?: number;
    height?: number;

    action: BuildImageAction;
    cacheStatus?: BuildImageCacheStatus;
    message?: string;
}

export interface BuildImageOptimizationSummary {
    scannedImages: number;

    alreadyCompressed: number;
    cacheHitAndReplaced: number;
    negativeCacheHits: number;

    apiRequests: number;
    apiCompressedAndReplaced: number;
    apiNoBenefit: number;

    skippedByApiLimit: number;
    skippedAfterApiFailure: number;

    cacheInvalid: number;
    replacedImages: number;
    failedImages: number;

    sourceBytesScanned: number;
    finalBytes: number;
    savedBytesThisRun: number;
}

export interface BuildImageOptimizationReport {
    schemaVersion: 1;
    tool: "tinypng-build";

    startedAt: string;
    completedAt: string;

    buildDirectory: string;
    cacheDirectory: string;

    mode:
        | { type: "all" }
        | { type: "limit"; limit: number };

    tinyPngCompressionCountStart: number | null;
    tinyPngCompressionCountEnd: number | null;

    summary: BuildImageOptimizationSummary;
    files: BuildImageReportItem[];
}

export interface BuildImageCliOptions {
    buildDirectoryArgument: string;
    apiRequestLimit: number | null;
}
