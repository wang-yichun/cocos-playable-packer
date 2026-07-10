import {
    mkdir,
    readFile,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const ANALYZER_VERSION = '2026-07-10-v2-linear-scan';

interface LoadedPayload {
    bytes: Uint8Array;
    sourceMode: 'binary' | 'base64' | 'html-base64';
    sourceDescription: string;
    matchedBase64Characters?: number;
}

interface TimingSummary {
    iterations: number;
    minMs: number;
    medianMs: number;
    averageMs: number;
    maxMs: number;
}

interface SafetyAudit {
    asciiOnly: boolean;
    printableAsciiOnly: boolean;
    containsLessThan: boolean;
    containsEndScript: boolean;
    containsNull: boolean;
    containsLf: boolean;
    containsCr: boolean;
    containsTab: boolean;
    containsFormFeed: boolean;
    controlCharacterCount: number;
    delCharacterCount: number;
    nonAsciiCharacterCount: number;
    backslashCount: number;
    quoteCount: number;
    apostropheCount: number;
    ampersandCount: number;
    backtickCount: number;
    unicodeLineSeparatorCount: number;
    unicodeParagraphSeparatorCount: number;
}

interface CandidateDefinition {
    id: string;
    name: string;
    category: string;
    description: string;
    reliability: 'baseline' | 'recommended-candidate' | 'experimental' | 'rejected';
    encode: (input: Uint8Array) => string;
    decode: (
        encoded: string,
        expectedLength: number,
    ) => Uint8Array;
    browserDecoderSource: string;
}

interface CandidateReport {
    id: string;
    name: string;
    category: string;
    description: string;
    reliability: CandidateDefinition['reliability'];
    encodedCharacters: number;
    payloadUtf8Bytes: number;
    dataScriptUtf8Bytes: number;
    jsStringLiteralUtf8Bytes: number;
    browserBenchmarkHtmlBytes: number;
    ratioToBinaryPercent: number;
    overheadPercent: number;
    savedVsBase64Bytes: number;
    savedVsBase64Percent: number;
    encodeTiming: TimingSummary;
    decodeTiming: TimingSummary;
    roundTripOk: boolean;
    decodedSha256: string;
    safety: SafetyAudit;
    browserBenchmarkFile: string;
}

const DATA_SCRIPT_PREFIX =
    '<script id="payload" type="application/octet-stream">';

const DATA_SCRIPT_SUFFIX = '</script>';

const BASE91_ALPHABET = Array.from(
    { length: 94 },
    (_, index) => String.fromCharCode(33 + index),
).filter(
    (character) =>
        character !== '<'
        && character !== '>'
        && character !== '&',
).join('');

if (BASE91_ALPHABET.length !== 91) {
    throw new Error(
        `Base91 alphabet length is ${BASE91_ALPHABET.length}, expected 91.`,
    );
}

const BASE85_ALPHABET = BASE91_ALPHABET.slice(0, 85);

const SCRIPT_PRINTABLE_ALPHABET = Array.from(
    { length: 94 },
    (_, index) => String.fromCharCode(33 + index),
).filter((character) => character !== '<')
    .join('');

if (SCRIPT_PRINTABLE_ALPHABET.length !== 93) {
    throw new Error(
        'Printable script alphabet must contain 93 characters.',
    );
}

const PACK7_PRINTABLE_ESCAPE =
    SCRIPT_PRINTABLE_ALPHABET[
        SCRIPT_PRINTABLE_ALPHABET.length - 1
    ] as string;

const PACK7_PRINTABLE_DIRECT =
    SCRIPT_PRINTABLE_ALPHABET.slice(0, -1);

const PACK7_CONTROL_ESCAPE_CODE = 126;

/*
 * 这些字符即使 HTML tokenizer 本身能处理，也很容易在文件传输、
 * 换行转换、HTML 清洗器或广告平台处理中被改写。
 *
 * 控制字符实验方案只转义最明确的结构性危险字符，仍然保留其他
 * C0 控制字符，因此它只能用于验证，不应直接投入生产。
 */
const PACK7_CONTROL_ESCAPED_SYMBOLS = [
    0,      // NUL: HTML script data 会替换为 U+FFFD。
    9,      // TAB: 部分清洗器会规范化空白。
    10,     // LF: 可能被换行转换。
    12,     // FF: HTML 空白字符。
    13,     // CR: HTML 输入预处理会规范化。
    60,     // <: 阻止形成 </script> 或进入 script less-than 状态。
    126,    // ~: 当前方案的转义前缀。
    127,    // DEL: 非打印控制字符。
] as const;

const PACK7_CONTROL_ESCAPE_CHARACTERS =
    'ABCDEFGH';

if (
    PACK7_CONTROL_ESCAPE_CHARACTERS.length
    !== PACK7_CONTROL_ESCAPED_SYMBOLS.length
) {
    throw new Error(
        'Pack7 control escape table length mismatch.',
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function round(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function sha256(input: Uint8Array): string {
    return createHash('sha256')
        .update(input)
        .digest('hex');
}

function adler32(input: Uint8Array): number {
    const MOD_ADLER = 65521;
    let a = 1;
    let b = 0;
    let index = 0;

    while (index < input.length) {
        const end = Math.min(index + 5552, input.length);

        while (index < end) {
            a += input[index] as number;
            b += a;
            index += 1;
        }

        a %= MOD_ADLER;
        b %= MOD_ADLER;
    }

    return (((b << 16) | a) >>> 0);
}

function equalBytes(
    left: Uint8Array,
    right: Uint8Array,
): boolean {
    if (left.byteLength !== right.byteLength) {
        return false;
    }

    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
}

function summarizeTimings(times: number[]): TimingSummary {
    const sorted = [...times].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    const median = sorted.length % 2 === 0
        ? (
            (sorted[middle - 1] as number)
            + (sorted[middle] as number)
        ) / 2
        : sorted[middle] as number;

    return {
        iterations: times.length,
        minMs: round(sorted[0] ?? 0),
        medianMs: round(median),
        averageMs: round(
            times.reduce((sum, value) => sum + value, 0)
            / Math.max(times.length, 1),
        ),
        maxMs: round(sorted[sorted.length - 1] ?? 0),
    };
}

function benchmark<T>(
    operation: () => T,
    iterations: number,
): {
    timing: TimingSummary;
    lastResult: T;
} {
    const times: number[] = [];
    let lastResult: T | undefined;

    /* 预热一次，尽量减少首次 JIT 对统计的影响。 */
    lastResult = operation();

    for (let index = 0; index < iterations; index += 1) {
        const start = performance.now();
        lastResult = operation();
        times.push(performance.now() - start);
    }

    return {
        timing: summarizeTimings(times),
        lastResult,
    } as {
        timing: TimingSummary;
        lastResult: T;
    };
}

function encodeBase64(input: Uint8Array): string {
    return Buffer.from(
        input.buffer,
        input.byteOffset,
        input.byteLength,
    ).toString('base64');
}

function decodeBase64(
    encoded: string,
    _expectedLength: number,
): Uint8Array {
    const decoded = Buffer.from(encoded, 'base64');

    return new Uint8Array(
        decoded.buffer,
        decoded.byteOffset,
        decoded.byteLength,
    );
}

function createDecodeTable(alphabet: string): Int16Array {
    const table = new Int16Array(128);
    table.fill(-1);

    for (let index = 0; index < alphabet.length; index += 1) {
        const code = alphabet.charCodeAt(index);

        if (code >= table.length) {
            throw new Error(
                'Only ASCII alphabets are supported.',
            );
        }

        table[code] = index;
    }

    return table;
}

const BASE85_DECODE_TABLE = createDecodeTable(
    BASE85_ALPHABET,
);

function encodeBase85(input: Uint8Array): string {
    const chunks: string[] = [];
    const chunkCharacterLimit = 16384;
    let current = '';

    for (let offset = 0; offset < input.length; offset += 4) {
        const remaining = Math.min(4, input.length - offset);

        let value =
            (input[offset] as number) * 0x1000000
            + (remaining > 1
                ? (input[offset + 1] as number) * 0x10000
                : 0)
            + (remaining > 2
                ? (input[offset + 2] as number) * 0x100
                : 0)
            + (remaining > 3
                ? input[offset + 3] as number
                : 0);

        const digits = new Array<number>(5);

        for (let digitIndex = 4; digitIndex >= 0; digitIndex -= 1) {
            digits[digitIndex] = value % 85;
            value = Math.floor(value / 85);
        }

        const outputCharacters = remaining + 1;

        for (
            let digitIndex = 0;
            digitIndex < outputCharacters;
            digitIndex += 1
        ) {
            current += BASE85_ALPHABET[
                digits[digitIndex] as number
            ] as string;
        }

        if (current.length >= chunkCharacterLimit) {
            chunks.push(current);
            current = '';
        }
    }

    if (current.length > 0) {
        chunks.push(current);
    }

    return chunks.join('');
}

function decodeBase85(
    encoded: string,
    expectedLength: number,
): Uint8Array {
    const output = new Uint8Array(expectedLength);
    let outputOffset = 0;

    for (let offset = 0; offset < encoded.length; offset += 5) {
        const groupLength = Math.min(5, encoded.length - offset);
        let value = 0;

        for (let digitIndex = 0; digitIndex < 5; digitIndex += 1) {
            let digit = 84;

            if (digitIndex < groupLength) {
                const code = encoded.charCodeAt(offset + digitIndex);
                digit = code < BASE85_DECODE_TABLE.length
                    ? BASE85_DECODE_TABLE[code] as number
                    : -1;

                if (digit < 0) {
                    throw new Error(
                        `Invalid Base85 character at ${offset + digitIndex}.`,
                    );
                }
            }

            value = value * 85 + digit;
        }

        const bytesToWrite = groupLength === 5
            ? 4
            : groupLength - 1;

        for (
            let byteIndex = 0;
            byteIndex < bytesToWrite
                && outputOffset < expectedLength;
            byteIndex += 1
        ) {
            const divisor = 256 ** (3 - byteIndex);
            output[outputOffset] =
                Math.floor(value / divisor) & 0xff;
            outputOffset += 1;
        }
    }

    if (outputOffset !== expectedLength) {
        throw new Error(
            `Base85 decoded ${outputOffset} bytes, expected ${expectedLength}.`,
        );
    }

    return output;
}

const BASE91_DECODE_TABLE = createDecodeTable(
    BASE91_ALPHABET,
);

function encodeBase91(input: Uint8Array): string {
    const chunks: string[] = [];
    const chunkCharacterLimit = 16384;
    let current = '';
    let bitQueue = 0;
    let bitCount = 0;

    for (let index = 0; index < input.length; index += 1) {
        bitQueue |= (input[index] as number) << bitCount;
        bitCount += 8;

        if (bitCount > 13) {
            let value = bitQueue & 8191;

            if (value > 88) {
                bitQueue >>>= 13;
                bitCount -= 13;
            } else {
                value = bitQueue & 16383;
                bitQueue >>>= 14;
                bitCount -= 14;
            }

            current +=
                (BASE91_ALPHABET[value % 91] as string)
                + (BASE91_ALPHABET[Math.floor(value / 91)] as string);

            if (current.length >= chunkCharacterLimit) {
                chunks.push(current);
                current = '';
            }
        }
    }

    if (bitCount > 0) {
        current += BASE91_ALPHABET[bitQueue % 91] as string;

        if (bitCount > 7 || bitQueue > 90) {
            current += BASE91_ALPHABET[
                Math.floor(bitQueue / 91)
            ] as string;
        }
    }

    if (current.length > 0) {
        chunks.push(current);
    }

    return chunks.join('');
}

function decodeBase91(
    encoded: string,
    expectedLength: number,
): Uint8Array {
    const output = new Uint8Array(expectedLength);
    let outputOffset = 0;
    let bitQueue = 0;
    let bitCount = 0;
    let value = -1;

    for (let index = 0; index < encoded.length; index += 1) {
        const code = encoded.charCodeAt(index);
        const decoded = code < BASE91_DECODE_TABLE.length
            ? BASE91_DECODE_TABLE[code] as number
            : -1;

        if (decoded < 0) {
            throw new Error(
                `Invalid Base91 character at ${index}.`,
            );
        }

        if (value < 0) {
            value = decoded;
            continue;
        }

        value += decoded * 91;
        bitQueue |= value << bitCount;
        bitCount += (value & 8191) > 88
            ? 13
            : 14;

        while (bitCount > 7) {
            if (outputOffset >= expectedLength) {
                throw new Error(
                    'Base91 decoded more bytes than expected.',
                );
            }

            output[outputOffset] = bitQueue & 0xff;
            outputOffset += 1;
            bitQueue >>>= 8;
            bitCount -= 8;
        }

        value = -1;
    }

    if (value >= 0 && outputOffset < expectedLength) {
        output[outputOffset] =
            (bitQueue | (value << bitCount)) & 0xff;
        outputOffset += 1;
    }

    if (outputOffset !== expectedLength) {
        throw new Error(
            `Base91 decoded ${outputOffset} bytes, expected ${expectedLength}.`,
        );
    }

    return output;
}

function packTo7BitSymbols(input: Uint8Array): Uint8Array {
    const symbolCount = Math.ceil(input.length * 8 / 7);
    const symbols = new Uint8Array(symbolCount);
    let symbolOffset = 0;
    let bitQueue = 0;
    let bitCount = 0;

    for (let index = 0; index < input.length; index += 1) {
        bitQueue |= (input[index] as number) << bitCount;
        bitCount += 8;

        while (bitCount >= 7) {
            symbols[symbolOffset] = bitQueue & 0x7f;
            symbolOffset += 1;
            bitQueue >>>= 7;
            bitCount -= 7;
        }
    }

    if (bitCount > 0) {
        symbols[symbolOffset] = bitQueue & 0x7f;
        symbolOffset += 1;
    }

    return symbolOffset === symbols.length
        ? symbols
        : symbols.subarray(0, symbolOffset);
}

function unpack7BitSymbols(
    symbols: Uint8Array,
    expectedLength: number,
): Uint8Array {
    const output = new Uint8Array(expectedLength);
    let outputOffset = 0;
    let bitQueue = 0;
    let bitCount = 0;

    for (let index = 0; index < symbols.length; index += 1) {
        bitQueue |= (symbols[index] as number) << bitCount;
        bitCount += 7;

        while (bitCount >= 8 && outputOffset < expectedLength) {
            output[outputOffset] = bitQueue & 0xff;
            outputOffset += 1;
            bitQueue >>>= 8;
            bitCount -= 8;
        }
    }

    if (outputOffset !== expectedLength) {
        throw new Error(
            `7-bit unpack decoded ${outputOffset} bytes, expected ${expectedLength}.`,
        );
    }

    return output;
}

const PACK7_CONTROL_ESCAPE_BY_SYMBOL = new Map<number, string>(
    PACK7_CONTROL_ESCAPED_SYMBOLS.map(
        (symbol, index) => [
            symbol,
            PACK7_CONTROL_ESCAPE_CHARACTERS[index] as string,
        ],
    ),
);

const PACK7_CONTROL_SYMBOL_BY_ESCAPE = new Map<number, number>(
    PACK7_CONTROL_ESCAPED_SYMBOLS.map(
        (symbol, index) => [
            PACK7_CONTROL_ESCAPE_CHARACTERS.charCodeAt(index),
            symbol,
        ],
    ),
);

function encodePack7Controls(input: Uint8Array): string {
    const symbols = packTo7BitSymbols(input);
    const chunks: string[] = [];
    let current = '';

    for (let index = 0; index < symbols.length; index += 1) {
        const symbol = symbols[index] as number;
        const escaped = PACK7_CONTROL_ESCAPE_BY_SYMBOL.get(symbol);

        if (escaped !== undefined) {
            current += '~' + escaped;
        } else {
            current += String.fromCharCode(symbol);
        }

        if (current.length >= 16384) {
            chunks.push(current);
            current = '';
        }
    }

    if (current.length > 0) {
        chunks.push(current);
    }

    return chunks.join('');
}

function decodePack7Controls(
    encoded: string,
    expectedLength: number,
): Uint8Array {
    const symbols = new Uint8Array(
        Math.ceil(expectedLength * 8 / 7),
    );
    let symbolOffset = 0;

    for (let index = 0; index < encoded.length; index += 1) {
        let symbol = encoded.charCodeAt(index);

        if (symbol === PACK7_CONTROL_ESCAPE_CODE) {
            index += 1;

            if (index >= encoded.length) {
                throw new Error(
                    'Pack7 controls ended after escape prefix.',
                );
            }

            const escapedCode = encoded.charCodeAt(index);
            const restored =
                PACK7_CONTROL_SYMBOL_BY_ESCAPE.get(
                    escapedCode,
                );

            if (restored === undefined) {
                throw new Error(
                    `Invalid Pack7 control escape at ${index}.`,
                );
            }

            symbol = restored;
        }

        if (symbol > 127) {
            throw new Error(
                `Invalid Pack7 symbol ${symbol} at ${index}.`,
            );
        }

        symbols[symbolOffset] = symbol;
        symbolOffset += 1;
    }

    return unpack7BitSymbols(
        symbols.subarray(0, symbolOffset),
        expectedLength,
    );
}

const PACK7_PRINTABLE_DECODE_TABLE = createDecodeTable(
    PACK7_PRINTABLE_DIRECT,
);

function encodePack7Printable(input: Uint8Array): string {
    const symbols = packTo7BitSymbols(input);
    const chunks: string[] = [];
    let current = '';
    const directCount = PACK7_PRINTABLE_DIRECT.length;

    for (let index = 0; index < symbols.length; index += 1) {
        const symbol = symbols[index] as number;

        if (symbol < directCount) {
            current += PACK7_PRINTABLE_DIRECT[symbol] as string;
        } else {
            current +=
                PACK7_PRINTABLE_ESCAPE
                + (PACK7_PRINTABLE_DIRECT[
                    symbol - directCount
                ] as string);
        }

        if (current.length >= 16384) {
            chunks.push(current);
            current = '';
        }
    }

    if (current.length > 0) {
        chunks.push(current);
    }

    return chunks.join('');
}

function decodePack7Printable(
    encoded: string,
    expectedLength: number,
): Uint8Array {
    const symbols = new Uint8Array(
        Math.ceil(expectedLength * 8 / 7),
    );
    let symbolOffset = 0;
    const directCount = PACK7_PRINTABLE_DIRECT.length;
    const escapeCode = PACK7_PRINTABLE_ESCAPE.charCodeAt(0);

    for (let index = 0; index < encoded.length; index += 1) {
        let code = encoded.charCodeAt(index);
        let escaped = false;

        if (code === escapeCode) {
            escaped = true;
            index += 1;

            if (index >= encoded.length) {
                throw new Error(
                    'Pack7 printable ended after escape prefix.',
                );
            }

            code = encoded.charCodeAt(index);
        }

        const decoded = code < PACK7_PRINTABLE_DECODE_TABLE.length
            ? PACK7_PRINTABLE_DECODE_TABLE[code] as number
            : -1;

        if (decoded < 0) {
            throw new Error(
                `Invalid Pack7 printable character at ${index}.`,
            );
        }

        const symbol = escaped
            ? directCount + decoded
            : decoded;

        if (symbol > 127) {
            throw new Error(
                `Invalid Pack7 printable symbol ${symbol}.`,
            );
        }

        symbols[symbolOffset] = symbol;
        symbolOffset += 1;
    }

    return unpack7BitSymbols(
        symbols.subarray(0, symbolOffset),
        expectedLength,
    );
}

function auditEncodedText(encoded: string): SafetyAudit {
    let controlCharacterCount = 0;
    let delCharacterCount = 0;
    let nonAsciiCharacterCount = 0;
    let backslashCount = 0;
    let quoteCount = 0;
    let apostropheCount = 0;
    let ampersandCount = 0;
    let backtickCount = 0;
    let unicodeLineSeparatorCount = 0;
    let unicodeParagraphSeparatorCount = 0;

    for (let index = 0; index < encoded.length; index += 1) {
        const code = encoded.charCodeAt(index);

        if (code < 32) {
            controlCharacterCount += 1;
        } else if (code === 127) {
            delCharacterCount += 1;
        }

        if (code > 127) {
            nonAsciiCharacterCount += 1;
        }

        switch (code) {
            case 34:
                quoteCount += 1;
                break;
            case 38:
                ampersandCount += 1;
                break;
            case 39:
                apostropheCount += 1;
                break;
            case 92:
                backslashCount += 1;
                break;
            case 96:
                backtickCount += 1;
                break;
            case 0x2028:
                unicodeLineSeparatorCount += 1;
                break;
            case 0x2029:
                unicodeParagraphSeparatorCount += 1;
                break;
            default:
                break;
        }
    }

    return {
        asciiOnly: nonAsciiCharacterCount === 0,
        printableAsciiOnly:
            controlCharacterCount === 0
            && delCharacterCount === 0
            && nonAsciiCharacterCount === 0,
        containsLessThan: encoded.includes('<'),
        containsEndScript: /<\/script/i.test(encoded),
        containsNull: encoded.includes('\u0000'),
        containsLf: encoded.includes('\n'),
        containsCr: encoded.includes('\r'),
        containsTab: encoded.includes('\t'),
        containsFormFeed: encoded.includes('\f'),
        controlCharacterCount,
        delCharacterCount,
        nonAsciiCharacterCount,
        backslashCount,
        quoteCount,
        apostropheCount,
        ampersandCount,
        backtickCount,
        unicodeLineSeparatorCount,
        unicodeParagraphSeparatorCount,
    };
}

function buildBrowserDecoderSource(
    id: string,
): string {
    if (id === 'base64') {
        return String.raw`
function decodePayload(text, expectedLength) {
    var binary = atob(text);
    var output = new Uint8Array(binary.length);
    var index;

    for (index = 0; index < binary.length; index += 1) {
        output[index] = binary.charCodeAt(index);
    }

    if (output.length !== expectedLength) {
        throw new Error(
            'Base64 length mismatch: '
            + output.length
            + ' !== '
            + expectedLength
        );
    }

    return output;
}`;
    }

    if (id === 'base85') {
        return String.raw`
var BASE85_ALPHABET = ${JSON.stringify(BASE85_ALPHABET)};
var BASE85_TABLE = (function () {
    var table = new Int16Array(128);
    var index;

    for (index = 0; index < table.length; index += 1) {
        table[index] = -1;
    }

    for (index = 0; index < BASE85_ALPHABET.length; index += 1) {
        table[BASE85_ALPHABET.charCodeAt(index)] = index;
    }

    return table;
})();

function decodePayload(text, expectedLength) {
    var output = new Uint8Array(expectedLength);
    var outputOffset = 0;
    var offset;

    for (offset = 0; offset < text.length; offset += 5) {
        var groupLength = Math.min(5, text.length - offset);
        var value = 0;
        var digitIndex;

        for (digitIndex = 0; digitIndex < 5; digitIndex += 1) {
            var digit = 84;

            if (digitIndex < groupLength) {
                var code = text.charCodeAt(offset + digitIndex);
                digit = code < BASE85_TABLE.length
                    ? BASE85_TABLE[code]
                    : -1;

                if (digit < 0) {
                    throw new Error('Invalid Base85 character.');
                }
            }

            value = value * 85 + digit;
        }

        var bytesToWrite = groupLength === 5
            ? 4
            : groupLength - 1;
        var byteIndex;

        for (
            byteIndex = 0;
            byteIndex < bytesToWrite
                && outputOffset < expectedLength;
            byteIndex += 1
        ) {
            output[outputOffset] =
                Math.floor(value / Math.pow(256, 3 - byteIndex))
                & 255;
            outputOffset += 1;
        }
    }

    if (outputOffset !== expectedLength) {
        throw new Error('Base85 decoded length mismatch.');
    }

    return output;
}`;
    }

    if (id === 'base91') {
        return String.raw`
var BASE91_ALPHABET = ${JSON.stringify(BASE91_ALPHABET)};
var BASE91_TABLE = (function () {
    var table = new Int16Array(128);
    var index;

    for (index = 0; index < table.length; index += 1) {
        table[index] = -1;
    }

    for (index = 0; index < BASE91_ALPHABET.length; index += 1) {
        table[BASE91_ALPHABET.charCodeAt(index)] = index;
    }

    return table;
})();

function decodePayload(text, expectedLength) {
    var output = new Uint8Array(expectedLength);
    var outputOffset = 0;
    var bitQueue = 0;
    var bitCount = 0;
    var value = -1;
    var index;

    for (index = 0; index < text.length; index += 1) {
        var code = text.charCodeAt(index);
        var decoded = code < BASE91_TABLE.length
            ? BASE91_TABLE[code]
            : -1;

        if (decoded < 0) {
            throw new Error('Invalid Base91 character.');
        }

        if (value < 0) {
            value = decoded;
            continue;
        }

        value += decoded * 91;
        bitQueue |= value << bitCount;
        bitCount += (value & 8191) > 88 ? 13 : 14;

        while (bitCount > 7) {
            if (outputOffset >= expectedLength) {
                throw new Error('Base91 decoded too many bytes.');
            }

            output[outputOffset] = bitQueue & 255;
            outputOffset += 1;
            bitQueue >>>= 8;
            bitCount -= 8;
        }

        value = -1;
    }

    if (value >= 0 && outputOffset < expectedLength) {
        output[outputOffset] =
            (bitQueue | (value << bitCount)) & 255;
        outputOffset += 1;
    }

    if (outputOffset !== expectedLength) {
        throw new Error('Base91 decoded length mismatch.');
    }

    return output;
}`;
    }

    if (id === 'pack7-controls') {
        return String.raw`
var PACK7_CONTROL_SYMBOLS = ${JSON.stringify(
            [...PACK7_CONTROL_ESCAPED_SYMBOLS],
        )};

function decodePayload(text, expectedLength) {
    var output = new Uint8Array(expectedLength);
    var outputOffset = 0;
    var bitQueue = 0;
    var bitCount = 0;
    var index;

    for (index = 0; index < text.length; index += 1) {
        var symbol = text.charCodeAt(index);

        if (symbol === 126) {
            index += 1;

            if (index >= text.length) {
                throw new Error('Pack7 ended after escape prefix.');
            }

            var escapeIndex = text.charCodeAt(index) - 65;

            if (
                escapeIndex < 0
                || escapeIndex >= PACK7_CONTROL_SYMBOLS.length
            ) {
                throw new Error('Invalid Pack7 control escape.');
            }

            symbol = PACK7_CONTROL_SYMBOLS[escapeIndex];
        }

        bitQueue |= symbol << bitCount;
        bitCount += 7;

        while (bitCount >= 8 && outputOffset < expectedLength) {
            output[outputOffset] = bitQueue & 255;
            outputOffset += 1;
            bitQueue >>>= 8;
            bitCount -= 8;
        }
    }

    if (outputOffset !== expectedLength) {
        throw new Error('Pack7 controls decoded length mismatch.');
    }

    return output;
}`;
    }

    if (id === 'pack7-printable') {
        return String.raw`
var PACK7_DIRECT = ${JSON.stringify(PACK7_PRINTABLE_DIRECT)};
var PACK7_ESCAPE_CODE = ${PACK7_PRINTABLE_ESCAPE.charCodeAt(0)};
var PACK7_TABLE = (function () {
    var table = new Int16Array(128);
    var index;

    for (index = 0; index < table.length; index += 1) {
        table[index] = -1;
    }

    for (index = 0; index < PACK7_DIRECT.length; index += 1) {
        table[PACK7_DIRECT.charCodeAt(index)] = index;
    }

    return table;
})();

function decodePayload(text, expectedLength) {
    var output = new Uint8Array(expectedLength);
    var outputOffset = 0;
    var bitQueue = 0;
    var bitCount = 0;
    var directCount = PACK7_DIRECT.length;
    var index;

    for (index = 0; index < text.length; index += 1) {
        var code = text.charCodeAt(index);
        var escaped = false;

        if (code === PACK7_ESCAPE_CODE) {
            escaped = true;
            index += 1;

            if (index >= text.length) {
                throw new Error('Pack7 printable ended after escape.');
            }

            code = text.charCodeAt(index);
        }

        var decoded = code < PACK7_TABLE.length
            ? PACK7_TABLE[code]
            : -1;

        if (decoded < 0) {
            throw new Error('Invalid Pack7 printable character.');
        }

        var symbol = escaped
            ? directCount + decoded
            : decoded;

        if (symbol > 127) {
            throw new Error('Invalid Pack7 printable symbol.');
        }

        bitQueue |= symbol << bitCount;
        bitCount += 7;

        while (bitCount >= 8 && outputOffset < expectedLength) {
            output[outputOffset] = bitQueue & 255;
            outputOffset += 1;
            bitQueue >>>= 8;
            bitCount -= 8;
        }
    }

    if (outputOffset !== expectedLength) {
        throw new Error('Pack7 printable decoded length mismatch.');
    }

    return output;
}`;
    }

    throw new Error(`Unknown browser decoder: ${id}`);
}

function buildBrowserBenchmarkHtml(
    candidate: CandidateDefinition,
    encoded: string,
    expectedLength: number,
    expectedAdler32: number,
    browserIterations: number,
): string {
    const decoderSource = candidate.browserDecoderSource;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${candidate.name} Browser Benchmark</title>
<style>
body{font-family:monospace;white-space:pre-wrap;padding:16px;background:#111;color:#eee}
.ok{color:#8f8}.error{color:#f88}
</style>
</head>
<body>
<h1>${candidate.name}</h1>
<div id="status">准备测试……</div>
<pre id="result"></pre>
${DATA_SCRIPT_PREFIX}${encoded}${DATA_SCRIPT_SUFFIX}
<script>
(function () {
'use strict';
${decoderSource}

function adler32(bytes) {
    var MOD_ADLER = 65521;
    var a = 1;
    var b = 0;
    var index = 0;

    while (index < bytes.length) {
        var end = Math.min(index + 5552, bytes.length);

        while (index < end) {
            a += bytes[index];
            b += a;
            index += 1;
        }

        a %= MOD_ADLER;
        b %= MOD_ADLER;
    }

    return ((b << 16) | a) >>> 0;
}

function median(values) {
    var sorted = values.slice().sort(function (a, b) {
        return a - b;
    });
    var middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
}

function run() {
    var status = document.getElementById('status');
    var result = document.getElementById('result');

    try {
        var text = document.getElementById('payload').textContent || '';
        var expectedLength = ${expectedLength};
        var expectedAdler32 = ${expectedAdler32 >>> 0};
        var iterations = ${browserIterations};

        /* 预热与首次完整校验。 */
        var warmup = decodePayload(text, expectedLength);
        var actualAdler32 = adler32(warmup);

        if (actualAdler32 !== expectedAdler32) {
            throw new Error(
                '校验失败：Adler32 '
                + actualAdler32
                + ' !== '
                + expectedAdler32
            );
        }

        var times = [];
        var index;

        for (index = 0; index < iterations; index += 1) {
            var start = performance.now();
            var decoded = decodePayload(text, expectedLength);
            var elapsed = performance.now() - start;

            if (decoded.length !== expectedLength) {
                throw new Error('解码长度不一致。');
            }

            times.push(elapsed);
        }

        var sum = 0;
        var min = times[0];
        var max = times[0];

        for (index = 0; index < times.length; index += 1) {
            sum += times[index];
            min = Math.min(min, times[index]);
            max = Math.max(max, times[index]);
        }

        var domUtf8Bytes = 'TextEncoder unavailable';

        if (typeof TextEncoder !== 'undefined') {
            domUtf8Bytes = new TextEncoder().encode(text).length;
        }

        status.className = 'ok';
        status.textContent = 'PASS：HTML 解析后数据完整，解码校验通过。';
        result.textContent = [
            'candidate: ${candidate.id}',
            'userAgent: ' + navigator.userAgent,
            'encoded JS characters: ' + text.length,
            'DOM UTF-8 bytes: ' + domUtf8Bytes,
            'decoded bytes: ' + expectedLength,
            'iterations: ' + iterations,
            'min ms: ' + min.toFixed(3),
            'median ms: ' + median(times).toFixed(3),
            'average ms: ' + (sum / times.length).toFixed(3),
            'max ms: ' + max.toFixed(3),
            'Adler32: ' + actualAdler32,
            '',
            'raw times: ' + JSON.stringify(times)
        ].join('\n');
    } catch (error) {
        status.className = 'error';
        status.textContent = 'FAIL';
        result.textContent = error && error.stack
            ? error.stack
            : String(error);
    }
}

setTimeout(run, 50);
})();
</script>
</body>
</html>`;
}

function isProbablyHtml(
    inputPath: string,
    content: Uint8Array,
): boolean {
    if (/\.html?$/i.test(inputPath)) {
        return true;
    }

    const prefix = Buffer.from(
        content.buffer,
        content.byteOffset,
        Math.min(content.byteLength, 256),
    ).toString('utf8').toLowerCase();

    return (
        prefix.includes('<!doctype html')
        || prefix.includes('<html')
    );
}

function isBase64DataCharacterCode(
    code: number,
): boolean {
    return (
        (code >= 65 && code <= 90)
        || (code >= 97 && code <= 122)
        || (code >= 48 && code <= 57)
        || code === 43
        || code === 47
    );
}

function extractLargestBase64FromHtml(
    html: string,
): {
    encoded: string;
    bytes: Uint8Array;
} {
    /*
     * 当前稳定 HTML 中 Solid Brotli 是一个超长连续 Base64 字符串。
     *
     * 不使用 /[A-Za-z0-9+/]{4096,}/g 或 matchAll：
     * 对数 MB 的连续匹配，某些 Node/V8 版本会在 RegExpStringIterator
     * 内触发 Maximum call stack size exceeded。这里改为严格 O(n) 的
     * charCodeAt 扫描，内存开销固定，也不依赖 pack-compressed.ts
     * 中保存 payload 的变量名。
     */
    const minimumCandidateLength = 4096;
    let bestStart = -1;
    let bestEnd = -1;
    let index = 0;

    while (index < html.length) {
        if (!isBase64DataCharacterCode(html.charCodeAt(index))) {
            index += 1;
            continue;
        }

        const start = index;

        while (
            index < html.length
            && isBase64DataCharacterCode(html.charCodeAt(index))
        ) {
            index += 1;
        }

        /* Base64 padding 只能位于候选末尾，最多两个等号。 */
        let end = index;

        if (index < html.length && html.charCodeAt(index) === 61) {
            index += 1;
            end = index;

            if (index < html.length && html.charCodeAt(index) === 61) {
                index += 1;
                end = index;
            }
        }

        const length = end - start;

        if (
            length >= minimumCandidateLength
            && length > bestEnd - bestStart
        ) {
            bestStart = start;
            bestEnd = end;
        }
    }

    if (bestStart < 0 || bestEnd <= bestStart) {
        throw new Error(
            'HTML 中没有找到长度至少 4096 的连续 Base64 数据。'
            + '请确认输入是当前 Base64 压缩版 HTML。',
        );
    }

    const best = html.slice(bestStart, bestEnd);

    if (best.length % 4 !== 0) {
        throw new Error(
            `找到的最长 Base64 候选长度不是 4 的倍数：${best.length}。`
            + '这通常表示 payload 被换行、转义或平台重写。',
        );
    }

    const decoded = Buffer.from(best, 'base64');
    const normalizedInput = best.endsWith('==')
        ? best.slice(0, -2)
        : best.endsWith('=')
            ? best.slice(0, -1)
            : best;
    const roundTrip = decoded.toString('base64');
    const normalizedRoundTrip = roundTrip.endsWith('==')
        ? roundTrip.slice(0, -2)
        : roundTrip.endsWith('=')
            ? roundTrip.slice(0, -1)
            : roundTrip;

    if (normalizedInput !== normalizedRoundTrip) {
        throw new Error(
            '找到的最长字符串不能稳定地按 Base64 往返，拒绝继续分析。',
        );
    }

    return {
        encoded: best,
        bytes: new Uint8Array(
            decoded.buffer,
            decoded.byteOffset,
            decoded.byteLength,
        ),
    };
}

async function loadPayload(
    inputPath: string,
    inputMode: 'auto' | 'binary' | 'base64' | 'html',
): Promise<LoadedPayload> {
    const content = await readFile(inputPath);

    if (
        inputMode === 'html'
        || (
            inputMode === 'auto'
            && isProbablyHtml(inputPath, content)
        )
    ) {
        const html = content.toString('utf8');
        const extracted = extractLargestBase64FromHtml(html);

        return {
            bytes: extracted.bytes,
            sourceMode: 'html-base64',
            sourceDescription:
                '从 HTML 中提取最长的连续 Base64 字符串并解码',
            matchedBase64Characters: extracted.encoded.length,
        };
    }

    if (
        inputMode === 'base64'
        || (
            inputMode === 'auto'
            && /\.(?:b64|base64)$/i.test(inputPath)
        )
    ) {
        const encoded = content
            .toString('ascii')
            .replace(/\s+/g, '');
        const decoded = Buffer.from(encoded, 'base64');

        return {
            bytes: new Uint8Array(
                decoded.buffer,
                decoded.byteOffset,
                decoded.byteLength,
            ),
            sourceMode: 'base64',
            sourceDescription: '读取 Base64 文本并解码',
            matchedBase64Characters: encoded.length,
        };
    }

    return {
        bytes: new Uint8Array(
            content.buffer,
            content.byteOffset,
            content.byteLength,
        ),
        sourceMode: 'binary',
        sourceDescription: '直接读取二进制输入',
    };
}

function parseIntegerOption(
    value: string | undefined,
    fallback: number,
    minimum: number,
): number {
    if (value === undefined) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed < minimum) {
        throw new Error(
            `Invalid integer option: ${value}`,
        );
    }

    return parsed;
}

function parseArguments(): {
    inputPath: string;
    outputDirectory: string;
    iterations: number;
    browserIterations: number;
    inputMode: 'auto' | 'binary' | 'base64' | 'html';
} {
    const positional: string[] = [];
    let iterations = 3;
    let browserIterations = 5;
    let inputMode:
        'auto' | 'binary' | 'base64' | 'html' = 'auto';

    for (const argument of process.argv.slice(2)) {
        if (argument.startsWith('--iterations=')) {
            iterations = parseIntegerOption(
                argument.slice('--iterations='.length),
                3,
                1,
            );
            continue;
        }

        if (argument.startsWith('--browser-iterations=')) {
            browserIterations = parseIntegerOption(
                argument.slice('--browser-iterations='.length),
                5,
                1,
            );
            continue;
        }

        if (argument.startsWith('--input-mode=')) {
            const value = argument.slice('--input-mode='.length);

            if (
                value !== 'auto'
                && value !== 'binary'
                && value !== 'base64'
                && value !== 'html'
            ) {
                throw new Error(
                    `Unknown input mode: ${value}`,
                );
            }

            inputMode = value;
            continue;
        }

        positional.push(argument);
    }

    const inputPath = positional[0];

    if (!inputPath) {
        throw new Error(
            'Usage: npx tsx src/analyze-text-encoding.ts '
            + '<compressed.html|payload.br|payload.b64> '
            + '[output-directory] '
            + '[--iterations=3] '
            + '[--browser-iterations=5] '
            + '[--input-mode=auto|binary|base64|html]',
        );
    }

    return {
        inputPath: path.resolve(inputPath),
        outputDirectory: path.resolve(
            positional[1]
            ?? './dist/encoding-benchmark',
        ),
        iterations,
        browserIterations,
        inputMode,
    };
}

function buildMarkdownReport(
    inputPath: string,
    loaded: LoadedPayload,
    inputSha256: string,
    reports: CandidateReport[],
): string {
    const lines: string[] = [
        '# Binary-to-text encoding benchmark',
        '',
        `- Input: \`${inputPath}\``,
        `- Source mode: ${loaded.sourceMode}`,
        `- Source description: ${loaded.sourceDescription}`,
        `- Binary payload: ${loaded.bytes.byteLength} bytes (${formatBytes(loaded.bytes.byteLength)})`,
        `- SHA-256: \`${inputSha256}\``,
        '',
        '## Size and speed',
        '',
        '| Encoding | UTF-8 payload | Overhead | Saved vs Base64 | Node encode median | Node decode median | Reliability |',
        '|---|---:|---:|---:|---:|---:|---|',
    ];

    for (const report of reports) {
        lines.push(
            `| ${report.name}`
            + ` | ${formatBytes(report.payloadUtf8Bytes)}`
            + ` | ${report.overheadPercent.toFixed(2)}%`
            + ` | ${report.savedVsBase64Percent.toFixed(2)}%`
            + ` | ${report.encodeTiming.medianMs.toFixed(3)} ms`
            + ` | ${report.decodeTiming.medianMs.toFixed(3)} ms`
            + ` | ${report.reliability} |`,
        );
    }

    lines.push(
        '',
        '## Safety audit',
        '',
        '| Encoding | Printable ASCII only | `<` | `</script>` | C0 controls | DEL | Non-ASCII | JS literal bytes |',
        '|---|---:|---:|---:|---:|---:|---:|---:|',
    );

    for (const report of reports) {
        lines.push(
            `| ${report.name}`
            + ` | ${report.safety.printableAsciiOnly ? 'yes' : 'no'}`
            + ` | ${report.safety.containsLessThan ? 'yes' : 'no'}`
            + ` | ${report.safety.containsEndScript ? 'yes' : 'no'}`
            + ` | ${report.safety.controlCharacterCount}`
            + ` | ${report.safety.delCharacterCount}`
            + ` | ${report.safety.nonAsciiCharacterCount}`
            + ` | ${formatBytes(report.jsStringLiteralUtf8Bytes)} |`,
        );
    }

    lines.push(
        '',
        '## Interpretation rules',
        '',
        '1. Production candidates must pass every generated browser page on desktop Chromium, Android WebView, iOS WKWebView, and the target ad-platform preview/validator.',
        '2. A candidate containing C0 or DEL control characters remains experimental even if a local browser passes.',
        '3. Compare `payloadUtf8Bytes`, not JavaScript `string.length`.',
        '4. The payload must be stored in a non-executable `<script type="application/octet-stream">` data block. Putting dense text in a JavaScript string literal adds quote/backslash/control-character escaping overhead.',
        '5. Any browser benchmark checksum failure means the HTML parser, transport, sanitizer, or platform modified the payload.',
        '',
    );

    return lines.join('\n');
}

async function main(): Promise<void> {
    console.log(`[encoding-analyzer] ${ANALYZER_VERSION}`);
    const options = parseArguments();
    const loaded = await loadPayload(
        options.inputPath,
        options.inputMode,
    );

    await mkdir(options.outputDirectory, {
        recursive: true,
    });

    const inputSha256 = sha256(loaded.bytes);
    const expectedAdler32 = adler32(loaded.bytes);

    const candidates: CandidateDefinition[] = [
        {
            id: 'base64',
            name: 'Base64',
            category: 'baseline',
            description:
                '当前基线；纯可打印 ASCII；浏览器使用 atob。',
            reliability: 'baseline',
            encode: encodeBase64,
            decode: decodeBase64,
            browserDecoderSource:
                buildBrowserDecoderSource('base64'),
        },
        {
            id: 'base85',
            name: 'Base85 (script-safe alphabet)',
            category: 'printable-ascii',
            description:
                '4 字节转 5 字符；固定约 25% 膨胀；不含 <、>、&。',
            reliability: 'recommended-candidate',
            encode: encodeBase85,
            decode: decodeBase85,
            browserDecoderSource:
                buildBrowserDecoderSource('base85'),
        },
        {
            id: 'base91',
            name: 'Base91 (script-safe alphabet)',
            category: 'printable-ascii',
            description:
                '可打印 ASCII 高密度候选；不含 <、>、&；变长 13/14-bit 编码。',
            reliability: 'recommended-candidate',
            encode: encodeBase91,
            decode: decodeBase91,
            browserDecoderSource:
                buildBrowserDecoderSource('base91'),
        },
        {
            id: 'pack7-controls',
            name: 'Custom 7-bit with controls',
            category: 'control-ascii',
            description:
                '8-bit 转 7-bit 符号，仅转义 NUL/换行/< 等结构性危险值；仍包含其他 C0 控制字符。',
            reliability: 'experimental',
            encode: encodePack7Controls,
            decode: decodePack7Controls,
            browserDecoderSource:
                buildBrowserDecoderSource('pack7-controls'),
        },
        {
            id: 'pack7-printable',
            name: 'Custom 7-bit printable-only',
            category: 'printable-ascii',
            description:
                '7-bit 符号全部映射为可打印 ASCII；安全但大量符号需要双字符转义。',
            reliability: 'rejected',
            encode: encodePack7Printable,
            decode: decodePack7Printable,
            browserDecoderSource:
                buildBrowserDecoderSource('pack7-printable'),
        },
    ];

    const reports: CandidateReport[] = [];
    let base64PayloadUtf8Bytes = 0;

    console.log('');
    console.log('Binary-to-text encoding benchmark');
    console.log(`Input: ${options.inputPath}`);
    console.log(
        `Payload: ${loaded.bytes.byteLength} bytes (${formatBytes(loaded.bytes.byteLength)})`,
    );
    console.log(`SHA-256: ${inputSha256}`);
    console.log('');

    for (const candidate of candidates) {
        console.log(`[${candidate.name}] encoding...`);

        const encodeBenchmark = benchmark(
            () => candidate.encode(loaded.bytes),
            options.iterations,
        );
        const encoded = encodeBenchmark.lastResult;

        console.log(`[${candidate.name}] decoding...`);

        const decodeBenchmark = benchmark(
            () => candidate.decode(
                encoded,
                loaded.bytes.byteLength,
            ),
            options.iterations,
        );

        const decoded = decodeBenchmark.lastResult;
        const roundTripOk = equalBytes(
            loaded.bytes,
            decoded,
        );

        if (!roundTripOk) {
            throw new Error(
                `${candidate.name} round-trip verification failed.`,
            );
        }

        const payloadUtf8Bytes = Buffer.byteLength(
            encoded,
            'utf8',
        );

        if (candidate.id === 'base64') {
            base64PayloadUtf8Bytes = payloadUtf8Bytes;
        }

        const dataScript =
            DATA_SCRIPT_PREFIX
            + encoded
            + DATA_SCRIPT_SUFFIX;

        const browserHtml = buildBrowserBenchmarkHtml(
            candidate,
            encoded,
            loaded.bytes.byteLength,
            expectedAdler32,
            options.browserIterations,
        );

        const browserFileName =
            `browser-${candidate.id}.html`;

        await writeFile(
            path.join(
                options.outputDirectory,
                browserFileName,
            ),
            browserHtml,
            'utf8',
        );

        const safety = auditEncodedText(encoded);
        const savedVsBase64Bytes =
            base64PayloadUtf8Bytes > 0
                ? base64PayloadUtf8Bytes - payloadUtf8Bytes
                : 0;

        const report: CandidateReport = {
            id: candidate.id,
            name: candidate.name,
            category: candidate.category,
            description: candidate.description,
            reliability: candidate.reliability,
            encodedCharacters: encoded.length,
            payloadUtf8Bytes,
            dataScriptUtf8Bytes: Buffer.byteLength(
                dataScript,
                'utf8',
            ),
            jsStringLiteralUtf8Bytes: Buffer.byteLength(
                JSON.stringify(encoded),
                'utf8',
            ),
            browserBenchmarkHtmlBytes: Buffer.byteLength(
                browserHtml,
                'utf8',
            ),
            ratioToBinaryPercent: round(
                payloadUtf8Bytes
                / loaded.bytes.byteLength
                * 100,
            ),
            overheadPercent: round(
                (
                    payloadUtf8Bytes
                    / loaded.bytes.byteLength
                    - 1
                ) * 100,
            ),
            savedVsBase64Bytes,
            savedVsBase64Percent:
                base64PayloadUtf8Bytes > 0
                    ? round(
                        savedVsBase64Bytes
                        / base64PayloadUtf8Bytes
                        * 100,
                    )
                    : 0,
            encodeTiming: encodeBenchmark.timing,
            decodeTiming: decodeBenchmark.timing,
            roundTripOk,
            decodedSha256: sha256(decoded),
            safety,
            browserBenchmarkFile: browserFileName,
        };

        reports.push(report);

        console.log(
            `  UTF-8: ${payloadUtf8Bytes} bytes (${formatBytes(payloadUtf8Bytes)})`,
        );
        console.log(
            `  overhead: ${report.overheadPercent.toFixed(2)}%`,
        );
        console.log(
            `  saved vs Base64: ${report.savedVsBase64Percent.toFixed(2)}%`,
        );
        console.log(
            `  encode median: ${report.encodeTiming.medianMs.toFixed(3)} ms`,
        );
        console.log(
            `  decode median: ${report.decodeTiming.medianMs.toFixed(3)} ms`,
        );
        console.log(
            `  printable ASCII only: ${safety.printableAsciiOnly}`,
        );
        console.log(
            `  controls: ${safety.controlCharacterCount}, DEL: ${safety.delCharacterCount}`,
        );
        console.log('');
    }

    const reportJson = {
        generatedAt: new Date().toISOString(),
        input: {
            path: options.inputPath,
            sourceMode: loaded.sourceMode,
            sourceDescription: loaded.sourceDescription,
            matchedBase64Characters:
                loaded.matchedBase64Characters,
            binaryBytes: loaded.bytes.byteLength,
            binarySize: formatBytes(loaded.bytes.byteLength),
            sha256: inputSha256,
            adler32: expectedAdler32,
        },
        benchmark: {
            nodeIterations: options.iterations,
            browserIterations: options.browserIterations,
            outputDirectory: options.outputDirectory,
        },
        alphabets: {
            base85: BASE85_ALPHABET,
            base91: BASE91_ALPHABET,
            pack7PrintableAlphabet:
                SCRIPT_PRINTABLE_ALPHABET,
            pack7ControlEscapedSymbols:
                [...PACK7_CONTROL_ESCAPED_SYMBOLS],
        },
        candidates: reports,
    };

    await writeFile(
        path.join(
            options.outputDirectory,
            'encoding-report.json',
        ),
        JSON.stringify(reportJson, null, 2),
        'utf8',
    );

    await writeFile(
        path.join(
            options.outputDirectory,
            'encoding-report.md',
        ),
        buildMarkdownReport(
            options.inputPath,
            loaded,
            inputSha256,
            reports,
        ),
        'utf8',
    );

    console.table(
        reports.map((report) => ({
            encoding: report.name,
            utf8Bytes: report.payloadUtf8Bytes,
            overhead: `${report.overheadPercent.toFixed(2)}%`,
            savedVsBase64:
                `${report.savedVsBase64Percent.toFixed(2)}%`,
            encodeMedianMs:
                report.encodeTiming.medianMs.toFixed(3),
            decodeMedianMs:
                report.decodeTiming.medianMs.toFixed(3),
            printableOnly:
                report.safety.printableAsciiOnly,
            reliability: report.reliability,
        })),
    );

    console.log('');
    console.log(
        `Reports written to: ${options.outputDirectory}`,
    );
    console.log(
        'Open each browser-*.html in the actual Android WebView, '
        + 'iOS WKWebView, and ad-platform preview before choosing.',
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
