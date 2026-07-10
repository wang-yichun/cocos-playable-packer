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