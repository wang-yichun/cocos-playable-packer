import { readFileSync } from "node:fs";
import vm from "node:vm";

interface LzmaApi {
  compress?(input: Uint8Array | Buffer, mode: number): number[];
  decompress?(input: Uint8Array | Buffer | readonly number[]): string | number[] | Uint8Array;
}

export interface BrowserDecoderBundle {
  source: string;
  sourceBytes: number;
  decoderCoreBytes: number;
  wrapperBytes: number;
  licenseNoticeBytes: number;
}

const COMPRESSOR_URL = new URL(
  "../../third-party/lzma-js/lzma-c-min.js",
  import.meta.url,
);
const DECODER_URL = new URL(
  "../../third-party/lzma-js/lzma-d-min.js",
  import.meta.url,
);
const LICENSE_URL = new URL(
  "../../third-party/lzma-js/LICENSE",
  import.meta.url,
);

let compressorApi: LzmaApi | null = null;
let decoderApi: LzmaApi | null = null;

function normalizeByteArray(value: string | ArrayLike<number>): Buffer {
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }

  const output = Buffer.allocUnsafe(value.length);
  for (let index = 0; index < value.length; index += 1) {
    output[index] = (value[index] ?? 0) & 0xff;
  }
  return output;
}

function loadApi(
  sourceUrl: URL,
  requiredMethod: "compress" | "decompress",
): LzmaApi {
  const source = readFileSync(sourceUrl, "utf8");
  const context: Record<string, unknown> = {
    Array,
    Date,
    Error,
    Math,
    Number,
    Object,
    String,
    Uint8Array,
    setImmediate,
    setTimeout,
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(source, context, {
    filename: sourceUrl.pathname,
  });

  const api = context.LZMA as LzmaApi | undefined;
  if (!api || typeof api[requiredMethod] !== "function") {
    throw new Error(
      `LZMA-JS 2.3.2 未导出 ${requiredMethod}：${sourceUrl.pathname}`,
    );
  }
  return api;
}

function getCompressorApi(): LzmaApi {
  compressorApi ??= loadApi(COMPRESSOR_URL, "compress");
  return compressorApi;
}

function getDecoderApi(): LzmaApi {
  decoderApi ??= loadApi(DECODER_URL, "decompress");
  return decoderApi;
}

export function compressLzma(
  input: Uint8Array | Buffer,
  level: number,
): Buffer {
  if (!Number.isInteger(level) || level < 1 || level > 9) {
    throw new Error(`LZMA level 必须是 1 到 9 之间的整数：${level}`);
  }

  const api = getCompressorApi();
  const compress = api.compress;
  if (!compress) {
    throw new Error("LZMA 压缩器不可用。");
  }
  return normalizeByteArray(compress(input, level));
}

export function decompressLzma(
  input: Uint8Array | Buffer,
): Buffer {
  const signedBytes = new Array<number>(input.byteLength);
  for (let index = 0; index < input.byteLength; index += 1) {
    const byte = input[index] ?? 0;
    signedBytes[index] = byte > 127 ? byte - 256 : byte;
  }

  const api = getDecoderApi();
  const decompress = api.decompress;
  if (!decompress) {
    throw new Error("LZMA 解码器不可用。");
  }
  return normalizeByteArray(decompress(signedBytes));
}

function createLicenseComment(licenseText: string): string {
  const normalized = licenseText.replace(/\r\n/g, "\n").trim();
  if (normalized.includes("*/")) {
    throw new Error("LZMA-JS LICENSE 包含无法安全嵌入脚本注释的内容。");
  }

  return [
    "/*",
    " * LZMA-JS 2.3.2 decompression code.",
    ...normalized.split("\n").map((line) => ` * ${line}`),
    " */",
  ].join("\n");
}

function createBrowserWrapperSource(): string {
  return String.raw`
(function (api) {
    'use strict';

    if (
        !api
        || typeof api.decompress !== 'function'
    ) {
        throw new Error(
            'LZMA-JS 浏览器解码器初始化失败。'
        );
    }

    window.__PACK_LZMA_DECOMPRESS__ =
        function (compressedBytes) {
            var signedBytes =
                new Array(
                    compressedBytes.byteLength
                );

            for (
                var index = 0;
                index < compressedBytes.byteLength;
                index += 1
            ) {
                var byte = compressedBytes[index];
                signedBytes[index] =
                    byte > 127
                        ? byte - 256
                        : byte;
            }

            var result =
                api.decompress(signedBytes);

            if (typeof result === 'string') {
                return new TextEncoder()
                    .encode(result);
            }

            var output =
                new Uint8Array(result.length);

            for (
                var outputIndex = 0;
                outputIndex < result.length;
                outputIndex += 1
            ) {
                output[outputIndex] =
                    result[outputIndex] & 255;
            }

            return output;
        };
})(window.LZMA);

try {
    delete window.LZMA;
    delete window.LZMA_WORKER;
} catch (_error) {
    window.LZMA = undefined;
    window.LZMA_WORKER = undefined;
}
`;
}

export async function loadBrowserDecoderBundle(): Promise<BrowserDecoderBundle> {
  const decoderCore = readFileSync(DECODER_URL, "utf8");
  const licenseText = readFileSync(LICENSE_URL, "utf8");

  const licenseNotice = createLicenseComment(licenseText);
  const wrapper = createBrowserWrapperSource();
  const source = `${licenseNotice}\n${decoderCore.trim()}\n${wrapper.trim()}\n`;

  return {
    source,
    sourceBytes: Buffer.byteLength(source),
    decoderCoreBytes: Buffer.byteLength(decoderCore.trim()),
    wrapperBytes: Buffer.byteLength(wrapper.trim()),
    licenseNoticeBytes: Buffer.byteLength(licenseNotice),
  };
}
