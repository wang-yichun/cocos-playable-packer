import tinify from "tinify";

export interface TinyPngClientOptions {
    apiKey: string;
    appIdentifier?: string;
    proxy?: string;
}

export interface TinyPngCompressionResult {
    compressedBuffer: Buffer;
    compressionCount: number | null;
}

const DEFAULT_APP_IDENTIFIER =
    "cocos-playable-packer/0.1.0";

function normalizeOptionalString(
    value: string | undefined,
): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function describeTinyPngError(
    error: unknown,
): string {
    if (error instanceof tinify.AccountError) {
        return (
            "TinyPNG 账户错误：请检查 API Key、账户额度或请求频率。" +
            error.message
        );
    }

    if (error instanceof tinify.ClientError) {
        return (
            "TinyPNG 请求错误：源图片或请求参数无效。" +
            error.message
        );
    }

    if (error instanceof tinify.ServerError) {
        return "TinyPNG 服务暂时不可用。" + error.message;
    }

    if (error instanceof tinify.ConnectionError) {
        return (
            "无法连接 TinyPNG 服务，请检查网络或代理。" +
            error.message
        );
    }

    return error instanceof Error
        ? error.message
        : String(error);
}

export class TinyPngClient {
    public constructor(
        options: TinyPngClientOptions,
    ) {
        const apiKey = options.apiKey.trim();

        if (!apiKey) {
            throw new Error("TinyPNG API Key 不能为空。");
        }

        tinify.key = apiKey;
        tinify.appIdentifier =
            options.appIdentifier ??
            DEFAULT_APP_IDENTIFIER;

        if (options.proxy) {
            tinify.proxy = options.proxy;
        }
    }

    public async compressBuffer(
        sourceBuffer: Buffer,
    ): Promise<TinyPngCompressionResult> {
        if (sourceBuffer.length === 0) {
            throw new Error("不能压缩空图片数据。");
        }

        try {
            const result = await tinify
                .fromBuffer(sourceBuffer)
                .toBuffer();

            return {
                compressedBuffer: Buffer.from(result),
                compressionCount:
                    tinify.compressionCount ?? null,
            };
        } catch (error) {
            throw new Error(
                describeTinyPngError(error),
                { cause: error },
            );
        }
    }
}

export function createTinyPngClientFromEnvironment():
    TinyPngClient {
    const apiKey = normalizeOptionalString(
        process.env.TINYPNG_API_KEY,
    );

    if (!apiKey) {
        throw new Error(
            [
                "未设置环境变量 TINYPNG_API_KEY。",
                "",
                "PowerShell 设置方式：",
                '$env:TINYPNG_API_KEY = Read-Host "TinyPNG API Key"',
            ].join("\n"),
        );
    }

    const proxy = normalizeOptionalString(
        process.env.TINYPNG_PROXY,
    );

    return new TinyPngClient({
        apiKey,
        ...(proxy !== undefined ? { proxy } : {}),
    });
}
