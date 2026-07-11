export interface PackedArchive {
  v?: number;
  c?: string;
  e?: string;
  u?: number;
  b: string;
  [key: string]: unknown;
}

export interface ExtractedArchive {
  archive: PackedArchive;
  start: number;
  end: number;
}

export interface RuntimePatchResult {
  html: string;
  startupCodeBytes: number;
}

const ARCHIVE_MARKER = "window.__PACK_ARCHIVE__=";
const BROTLI_DECODER_MARKER = "/* brotli-compress/js 1.3.3 fallback;";
const BROTLI_FUNCTION_MARKER = "    async function decompressBrotli(";
const INITIALIZE_FUNCTION_MARKER = "    async function initializeArchive()";
const BOOT_FUNCTION_MARKER = "    async function boot()";

function scanBalancedJsonObject(
  source: string,
  startIndex: number,
): { source: string; start: number; end: number } {
  let index = startIndex;
  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }
  if (source[index] !== "{") {
    throw new Error("没有在 __PACK_ARCHIVE__ 标记后找到 JSON 对象。");
  }

  const objectStart = index;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          source: source.slice(objectStart, index + 1),
          start: objectStart,
          end: index + 1,
        };
      }
    }
  }
  throw new Error("__PACK_ARCHIVE__ JSON 对象没有正常结束。");
}

export function extractPackedArchive(html: string): ExtractedArchive {
  const markerIndex = html.indexOf(ARCHIVE_MARKER);
  if (markerIndex < 0) {
    throw new Error("HTML 中没有找到 window.__PACK_ARCHIVE__。");
  }
  const object = scanBalancedJsonObject(
    html,
    markerIndex + ARCHIVE_MARKER.length,
  );
  const parsed = JSON.parse(object.source) as Partial<PackedArchive>;
  if (typeof parsed.b !== "string" || parsed.b.length === 0) {
    throw new Error("__PACK_ARCHIVE__.b 不是有效字符串。");
  }
  return {
    archive: parsed as PackedArchive,
    start: object.start,
    end: object.end,
  };
}

export function replacePackedArchive(
  html: string,
  extracted: ExtractedArchive,
  archive: PackedArchive,
): string {
  return html.slice(0, extracted.start) + JSON.stringify(archive) + html.slice(extracted.end);
}

function findContainingScript(
  html: string,
  marker: string,
): { contentStart: number; contentEnd: number } {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`HTML 中没有找到脚本标记：${marker}`);
  }
  const scriptOpen = html.lastIndexOf("<script>", markerIndex);
  const scriptClose = html.indexOf("</script>", markerIndex);
  if (scriptOpen < 0 || scriptClose < 0) {
    throw new Error(`无法确定脚本边界：${marker}`);
  }
  return {
    contentStart: scriptOpen + "<script>".length,
    contentEnd: scriptClose,
  };
}

export function getBrotliDecoderSourceBytes(html: string): number {
  const script = findContainingScript(html, BROTLI_DECODER_MARKER);
  return Buffer.byteLength(
    html.slice(script.contentStart, script.contentEnd).trim(),
  );
}

export function replaceBrotliDecoderScript(
  html: string,
  lzmaDecoderSource: string,
): string {
  const script = findContainingScript(html, BROTLI_DECODER_MARKER);
  return html.slice(0, script.contentStart)
    + `\n${lzmaDecoderSource.trim()}\n`
    + html.slice(script.contentEnd);
}

interface FunctionRange {
  start: number;
  end: number;
}

function findFunctionRange(source: string, marker: string): FunctionRange {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`没有找到 Runtime 函数：${marker.trim()}`);
  }
  const bodyStart = source.indexOf("{", start + marker.length);
  if (bodyStart < 0) {
    throw new Error(`Runtime 函数缺少函数体：${marker.trim()}`);
  }

  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { start, end: index + 1 };
      }
    }
  }
  throw new Error(`Runtime 函数没有正常结束：${marker.trim()}`);
}

function replaceFunction(
  source: string,
  marker: string,
  replacement: string,
): string {
  const range = findFunctionRange(source, marker);
  return source.slice(0, range.start) + replacement + source.slice(range.end);
}

const METRICS_BOOTSTRAP = String.raw`
    var METRICS =
        window.__PACK_RUNTIME_METRICS__ = {
            algorithm: 'lzma',
            payloadEncoding: 'base64',
            scriptStartMs: performance.now(),
            payloadDecodeStartMs: null,
            payloadDecodeEndMs: null,
            payloadDecodeDurationMs: null,
            archiveDecodeStartMs: null,
            archiveDecodeEndMs: null,
            archiveDecodeDurationMs: null,
            archiveReadyMs: null,
            systemImportStartMs: null,
            systemImportEndMs: null,
            systemImportDurationMs: null,
            pageToGameStartMs: null,
            usedJSHeapBeforeDecodeBytes: null,
            usedJSHeapAfterDecodeBytes: null,
            usedJSHeapAfterBootBytes: null,
        };

    function readUsedJsHeapBytes() {
        var memory =
            performance
            && performance.memory;

        return (
            memory
            && typeof memory.usedJSHeapSize
                === 'number'
        )
            ? memory.usedJSHeapSize
            : null;
    }
`;

const LZMA_DECOMPRESS_FUNCTION = String.raw`    async function decompressLzma(
        compressedBytes
    ) {
        var decoder =
            window.__PACK_LZMA_DECOMPRESS__;

        if (typeof decoder !== 'function') {
            throw new Error(
                '没有可用的 LZMA 解码器。'
            );
        }

        var result = decoder(compressedBytes);
        if (
            result
            && typeof result.then === 'function'
        ) {
            result = await result;
        }

        return result instanceof Uint8Array
            ? result
            : new Uint8Array(result);
    }`;

const LZMA_INITIALIZE_FUNCTION = String.raw`    async function initializeArchive() {
        if (archiveBytes) {
            return;
        }

        if (
            !ARCHIVE
            || ARCHIVE.c !== 'lzma'
            || ARCHIVE.e !== 'base64'
            || typeof ARCHIVE.b !== 'string'
        ) {
            throw new Error(
                'LZMA 压缩资源包信息无效。'
            );
        }

        METRICS.payloadDecodeStartMs =
            performance.now();

        var compressedBytes =
            decodeBase64(ARCHIVE.b);

        METRICS.payloadDecodeEndMs =
            performance.now();
        METRICS.payloadDecodeDurationMs =
            METRICS.payloadDecodeEndMs
            - METRICS.payloadDecodeStartMs;
        METRICS.usedJSHeapBeforeDecodeBytes =
            readUsedJsHeapBytes();
        METRICS.archiveDecodeStartMs =
            performance.now();

        archiveBytes =
            await decompressLzma(
                compressedBytes
            );

        METRICS.archiveDecodeEndMs =
            performance.now();
        METRICS.archiveDecodeDurationMs =
            METRICS.archiveDecodeEndMs
            - METRICS.archiveDecodeStartMs;
        METRICS.usedJSHeapAfterDecodeBytes =
            readUsedJsHeapBytes();

        if (
            archiveBytes.byteLength
            !== ARCHIVE.u
        ) {
            throw new Error(
                'LZMA 解压长度不匹配：期望 '
                + ARCHIVE.u
                + '，实际 '
                + archiveBytes.byteLength
            );
        }

        METRICS.archiveReadyMs =
            performance.now();

        console.log(
            '[Playable Packer] LZMA 解压完成：',
            (
                archiveBytes.byteLength
                / 1024
                / 1024
            ).toFixed(2) + ' MB，',
            METRICS.archiveDecodeDurationMs
                .toFixed(2) + ' ms'
        );

        ARCHIVE.b = '';
        window.__PACK_ARCHIVE__.b = '';
    }`;

const SYSTEM_IMPORT_BEFORE = String.raw`        METRICS.systemImportStartMs =
            performance.now();
`;

const SYSTEM_IMPORT_AFTER = String.raw`
        METRICS.systemImportEndMs =
            performance.now();
        METRICS.systemImportDurationMs =
            METRICS.systemImportEndMs
            - METRICS.systemImportStartMs;
        METRICS.pageToGameStartMs =
            METRICS.systemImportEndMs
            - METRICS.scriptStartMs;
        METRICS.usedJSHeapAfterBootBytes =
            readUsedJsHeapBytes();

        console.log(
            '[Playable Packer] Runtime metrics:',
            JSON.stringify(METRICS)
        );
`;

function patchBootFunction(runtimeSource: string): string {
  const range = findFunctionRange(runtimeSource, BOOT_FUNCTION_MARKER);
  const bootSource = runtimeSource.slice(range.start, range.end);
  const importMarker = "        await System.import(";
  const importStart = bootSource.indexOf(importMarker);
  if (importStart < 0) {
    throw new Error("没有在 boot() 中找到 System.import 调用。");
  }
  const statementEnd = bootSource.indexOf(";", importStart);
  if (statementEnd < 0) {
    throw new Error("System.import 调用没有正常结束。");
  }
  const patchedBoot = bootSource.slice(0, importStart)
    + SYSTEM_IMPORT_BEFORE
    + bootSource.slice(importStart, statementEnd + 1)
    + SYSTEM_IMPORT_AFTER
    + bootSource.slice(statementEnd + 1);
  return runtimeSource.slice(0, range.start) + patchedBoot + runtimeSource.slice(range.end);
}

export function patchRuntimeForLzma(html: string): RuntimePatchResult {
  const script = findContainingScript(html, BROTLI_FUNCTION_MARKER);
  let runtimeSource = html.slice(script.contentStart, script.contentEnd);
  const strictMarker = "    'use strict';\n";
  const strictIndex = runtimeSource.indexOf(strictMarker);
  if (strictIndex < 0) {
    throw new Error("Runtime 中没有找到 use strict 标记。");
  }
  runtimeSource = runtimeSource.slice(0, strictIndex + strictMarker.length)
    + METRICS_BOOTSTRAP
    + runtimeSource.slice(strictIndex + strictMarker.length);
  runtimeSource = replaceFunction(
    runtimeSource,
    BROTLI_FUNCTION_MARKER,
    LZMA_DECOMPRESS_FUNCTION,
  );
  runtimeSource = replaceFunction(
    runtimeSource,
    INITIALIZE_FUNCTION_MARKER,
    LZMA_INITIALIZE_FUNCTION,
  );
  runtimeSource = patchBootFunction(runtimeSource);

  const startupCodeBytes = Buffer.byteLength(
    METRICS_BOOTSTRAP
      + LZMA_DECOMPRESS_FUNCTION
      + LZMA_INITIALIZE_FUNCTION
      + SYSTEM_IMPORT_BEFORE
      + SYSTEM_IMPORT_AFTER,
  );
  return {
    html: html.slice(0, script.contentStart)
      + runtimeSource
      + html.slice(script.contentEnd),
    startupCodeBytes,
  };
}
