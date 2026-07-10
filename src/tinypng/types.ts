/**
 * TinyPNG 源资源优化工具使用的公共类型。
 *
 * 当前阶段只定义数据结构，不执行文件扫描、
 * 不调用 TinyPNG，也不会修改 Cocos Creator 工程。
 */

export interface AutoAtlasConfig {
    /**
     * 是否检测 Cocos Creator 自动图集配置。
     */
    enabled: boolean;

    /**
     * 自动图集配置文件扩展名，例如 .pac。
     */
    configExtensions: string[];

    /**
     * 是否排除自动图集配置文件所在目录中的图片。
     */
    excludeAtlasDirectory: boolean;

    /**
     * 是否同时排除自动图集目录下面的所有子目录。
     */
    excludeAtlasSubdirectories: boolean;
}

export interface SourceImageCompressionConfig {
    /**
     * 是否处理 PNG。
     */
    processPng: boolean;

    /**
     * 是否处理 JPG/JPEG。
     */
    processJpeg: boolean;

    /**
     * 是否保持原始扩展名。
     */
    preserveExtension: boolean;

    /**
     * 是否允许直接覆盖源资源。
     *
     * 第一阶段必须保持 false。
     */
    overwriteSource: boolean;
}

/**
 * configs/game141-source-images.json 对应的数据结构。
 */
export interface SourceImageOptimizerConfig {
    projectName: string;

    /**
     * Cocos Creator 工程根目录。
     */
    projectRoot: string;

    /**
     * 相对于 projectRoot 的资源目录。
     */
    assetsDirectory: string;

    /**
     * 相对于 cocos-playable-packer 根目录的工作目录。
     */
    workspaceDirectory: string;

    /**
     * 相对于 cocos-playable-packer 根目录的 TinyPNG 缓存目录。
     */
    cacheDirectory: string;

    /**
     * 允许扫描的图片扩展名。
     */
    extensions: string[];

    autoAtlas: AutoAtlasConfig;

    /**
     * 目录名称命中这些值时，默认排除。
     */
    excludeDirectories: string[];

    /**
     * 目录名称命中这些值时，归类为人工检查。
     */
    manualReviewDirectories: string[];

    /**
     * 文件名包含这些字符串时，归类为特殊纹理。
     */
    excludeNamePatterns: string[];

    /**
     * 文件名包含这些字符串时，需要人工检查。
     */
    manualReviewNamePatterns: string[];

    /**
     * 小于该体积的图片默认不提交 TinyPNG。
     */
    minimumFileSizeBytes: number;

    compression: SourceImageCompressionConfig;
}

/**
 * 配置文件中的路径全部解析为绝对路径后的结果。
 */
export interface ResolvedSourceImageOptimizerConfig
    extends SourceImageOptimizerConfig {
    /**
     * cocos-playable-packer 工程根目录。
     */
    toolRoot: string;

    /**
     * 配置文件绝对路径。
     */
    configFilePath: string;

    /**
     * Cocos Creator 工程绝对路径。
     */
    resolvedProjectRoot: string;

    /**
     * Cocos Creator assets 绝对路径。
     */
    resolvedAssetsDirectory: string;

    /**
     * 当前项目工作区绝对路径。
     */
    resolvedWorkspaceDirectory: string;

    /**
     * TinyPNG 缓存绝对路径。
     */
    resolvedCacheDirectory: string;
}

/**
 * 图片分析后的分类。
 */
export type SourceImageClassification =
    | "safe"
    | "atlas"
    | "special-texture"
    | "manual-review"
    | "too-small"
    | "unsupported";

/**
 * 基础图片元数据。
 *
 * 第一版扫描器至少会解析 PNG 和 JPEG 的宽高。
 */
export interface SourceImageMetadata {
    format: "png" | "jpeg" | "unknown";
    width: number | null;
    height: number | null;

    /**
     * PNG 可以根据颜色类型判断是否包含 Alpha 通道。
     * JPEG 固定为 false。
     * 无法判断时为 null。
     */
    hasAlpha: boolean | null;

    /**
     * width × height。无法解析宽高时为 null。
     */
    pixelCount: number | null;
}

/**
 * 单张源图片的分析结果。
 */
export interface SourceImageAnalysisItem {
    /**
     * 相对于 Cocos Creator 工程根目录的路径。
     *
     * 例如：
     * assets/textures/background.png
     */
    projectRelativePath: string;

    /**
     * 相对于 assets 目录的路径。
     *
     * 例如：
     * textures/background.png
     */
    assetsRelativePath: string;

    absolutePath: string;
    basename: string;
    extension: string;

    sizeBytes: number;
    sha256: string;

    classification: SourceImageClassification;

    /**
     * 可能存在多个分类依据。
     */
    reasons: string[];

    /**
     * 命中的自动图集配置文件。
     */
    atlasConfigPath: string | null;

    metadata: SourceImageMetadata;
}

/**
 * 分类统计。
 */
export interface SourceImageClassificationCounts {
    safe: number;
    atlas: number;
    specialTexture: number;
    manualReview: number;
    tooSmall: number;
    unsupported: number;
}

/**
 * 源资源分析报告摘要。
 */
export interface SourceImageAnalysisSummary {
    totalImageCount: number;
    totalImageBytes: number;

    pngCount: number;
    jpegCount: number;

    pngBytes: number;
    jpegBytes: number;

    classificationCounts: SourceImageClassificationCounts;

    /**
     * safe 类型图片的总体积。
     */
    safeCandidateBytes: number;

    /**
     * 自动图集目录中图片的总体积。
     */
    atlasImageBytes: number;
}

/**
 * analyze:source-images 最终写出的 JSON 报告。
 */
export interface SourceImageAnalysisReport {
    generatedAt: string;
    schemaVersion: number;
    analyzerVersion: string;

    projectName: string;
    configFilePath: string;
    projectRoot: string;
    assetsDirectory: string;

    summary: SourceImageAnalysisSummary;
    files: SourceImageAnalysisItem[];

    notes: string[];
}

/**
 * 文件扫描阶段得到的基础图片信息。
 *
 * 此阶段尚未进行：
 * - SHA-256 计算
 * - 图片头解析
 * - 自动图集识别
 * - 安全性分类
 */
export interface ScannedSourceImageFile {
    /**
     * 图片文件绝对路径。
     */
    absolutePath: string;

    /**
     * 相对于 Cocos Creator 工程根目录的路径。
     *
     * 示例：
     * assets/textures/background.png
     */
    projectRelativePath: string;

    /**
     * 相对于 assets 目录的路径。
     *
     * 示例：
     * textures/background.png
     */
    assetsRelativePath: string;

    basename: string;
    extension: string;

    sizeBytes: number;
    modifiedTimeMs: number;
}

/**
 * 已读取文件内容，并完成哈希和图片头解析的源图片。
 */
export interface InspectedSourceImageFile
    extends ScannedSourceImageFile {
    /**
     * 原始图片文件内容的 SHA-256。
     *
     * 后续 TinyPNG 缓存会使用这个值作为唯一键，
     * 而不是使用可能发生变化的文件路径。
     */
    sha256: string;

    /**
     * 从 PNG/JPEG 文件头解析出的基础信息。
     */
    metadata: SourceImageMetadata;
}

/**
 * 检测到的 Cocos Creator 自动图集目录。
 */
export interface AutoAtlasDirectoryInfo {
    /**
     * .pac 文件绝对路径。
     */
    absoluteConfigPath: string;

    /**
     * .pac 所在目录的绝对路径。
     */
    absoluteDirectoryPath: string;

    /**
     * 相对于 Cocos Creator 工程根目录的 .pac 路径。
     */
    projectRelativeConfigPath: string;

    /**
     * 相对于 assets 的 .pac 路径。
     */
    assetsRelativeConfigPath: string;

    /**
     * 相对于 assets 的图集目录路径。
     */
    assetsRelativeDirectoryPath: string;
}

/**
 * 完成自动图集和安全性分类后的图片。
 */
export interface ClassifiedSourceImageFile
    extends InspectedSourceImageFile {
    classification: SourceImageClassification;

    /**
     * 记录命中的所有规则，不仅限于最终分类依据。
     */
    reasons: string[];

    /**
     * 命中的自动图集配置路径。
     */
    atlasConfigPath: string | null;
}

/**
 * candidates.json 中记录的安全候选。
 *
 * 不写入 absolutePath，避免清单与当前电脑的盘符强绑定。
 */
export interface SourceImageCandidateItem {
    projectRelativePath: string;
    assetsRelativePath: string;

    basename: string;
    extension: string;

    sizeBytes: number;
    sha256: string;

    classification: "safe";
    metadata: SourceImageMetadata;
}

export interface SourceImageCandidateManifestSummary {
    /**
     * 需要替换结果的文件数量。
     */
    candidateFileCount: number;

    /**
     * 按 SHA-256 去重后的内容数量。
     *
     * 在没有缓存的情况下，这才接近真实 API 请求次数。
     */
    uniqueSourceCount: number;

    /**
     * 可以通过同一份压缩结果复用的重复文件数量。
     */
    duplicateReusableCount: number;

    totalSourceBytes: number;
}

export interface SourceImageCandidateManifest {
    generatedAt: string;
    schemaVersion: number;
    generatorVersion: string;

    projectName: string;
    configFilePath: string;
    projectRoot: string;
    assetsDirectory: string;

    summary: SourceImageCandidateManifestSummary;
    files: SourceImageCandidateItem[];

    notes: string[];
}

export interface WrittenSourceImageAnalysisOutputs {
    reportPath: string;
    candidatesPath: string;

    candidateFileCount: number;
    uniqueCandidateContentCount: number;
}

/**
 * TinyPNG 缓存中的单条记录。
 */
export interface TinyPngCacheEntry {
    /**
     * 原始源图片的 SHA-256，同时也是缓存索引键。
     */
    sourceSha256: string;

    sourceBytes: number;
    sourceExtension: string;
    sourceFormat: "png" | "jpeg";

    /**
     * 相对于 cacheDirectory 的压缩文件路径。
     *
     * 例如：
     * files/abc123.png
     */
    compressedRelativePath: string;

    compressedSha256: string;
    compressedBytes: number;

    /**
     * compressedBytes / sourceBytes。
     */
    compressionRatio: number;

    createdAt: string;
    updatedAt: string;
}

/**
 * .tinypng-cache/index.json。
 */
export interface TinyPngCacheIndex {
    schemaVersion: number;
    provider: "tinypng";

    createdAt: string;
    updatedAt: string;

    /**
     * key 是源文件 SHA-256。
     */
    entries: Record<string, TinyPngCacheEntry>;
}

/**
 * 已加载的缓存运行时对象。
 */
export interface LoadedTinyPngCache {
    cacheDirectory: string;
    filesDirectory: string;
    indexPath: string;

    index: TinyPngCacheIndex;
}

export type TinyPngCacheLookupResult =
    | {
        status: "hit";
        entry: TinyPngCacheEntry;
        compressedFilePath: string;
    }
    | {
        status: "miss";
        entry: null;
        compressedFilePath: null;
    }
    | {
        status: "invalid";
        entry: TinyPngCacheEntry;
        compressedFilePath: string | null;
        reason: string;
    };

export interface TinyPngCacheVerificationResult {
    totalEntries: number;
    validEntries: number;
    invalidEntries: number;

    totalSourceBytes: number;
    totalCompressedBytes: number;

    invalidItems: Array<{
        sourceSha256: string;
        reason: string;
    }>;
}

export interface TinyPngClientOptions {
    apiKey: string;

    /**
     * 可选 HTTP 代理，例如：
     * http://127.0.0.1:7890
     */
    proxy?: string;

    appIdentifier?: string;
}

export interface TinyPngCompressionResult {
    compressedBuffer: Buffer;

    /**
     * 当前自然月已经使用的压缩次数。
     *
     * API 未返回时为 null。
     */
    compressionCount: number | null;
}