import {
    mkdir,
    readFile,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

interface PackedArchive {
    v?: number;
    c?: string;
    u?: number;
    b: string;
}

interface CliOptions {
    inputPath: string;
    outputDirectory: string;
    inputMode: 'auto' | 'html' | 'base64' | 'binary';
    iterations: number;
}

interface TimingResult {
    averageMs: number;
    minimumMs: number;
    maximumMs: number;
}

interface CandidateResult {
    id: string;
    name: string;
    container: 'javascript-string' | 'html-attribute';
    characterCount: number;
    encodedUtf8Bytes: number;
    embeddedPayloadBytes: number;
    decoderEstimateBytes: number;
    estimatedHtmlBytes: number | null;
    estimatedHtmlSize: string | null;
    ratioToBinary: number;
    overheadPercentage: number;
    savedVsBase64Bytes: number;
    savedVsBase64Percentage: number;
    encodeTiming: TimingResult;
    decodeTiming: TimingResult;
    roundTripOk: boolean;
    compatibility: 'high' | 'medium' | 'experimental';
    notes: string[];
}

interface EncodingReport {
    generatedAt: string;
    inputPath: string;
    inputMode: CliOptions['inputMode'];
    sourceHtmlBytes: number | null;
    sourceHtmlSize: string | null;
    binaryBytes: number;
    binarySize: string;
    iterations: number;
    candidates: CandidateResult[];
    recommendation: {
        safest: string;
        smallest: string;
        conclusion: string;
    };
}

const ARCHIVE_MARKER =
    'window.__PACK_ARCHIVE__=';

/**
 * 91 个可打印 ASCII 字符。
 *
 * 排除了：
 * - 双引号：避免 JSON/JS 字符串转义；
 * - 反斜杠：避免 JSON/JS 字符串转义；
 * - 小于号：从根源上避免 </script>。
 */
const SAFE_BASE91_ALPHABET = (() => {
    let result = '';

    for (let code = 33; code <= 126; code += 1) {
        const character =
            String.fromCharCode(code);

        if (
            character === '"'
            || character === '\\'
            || character === '<'
        ) {
            continue;
        }

        result += character;
    }

    if (result.length !== 91) {
        throw new Error(
            `Safe Base91 字母表长度错误：${result.length}`,
        );
    }

    return result;
})();

const SAFE_BASE91_DECODE_TABLE = (() => {
    const table = new Int16Array(128);
    table.fill(-1);

    for (
        let index = 0;
        index < SAFE_BASE91_ALPHABET.length;
        index += 1
    ) {
        table[
            SAFE_BASE91_ALPHABET.charCodeAt(index)
        ] = index;
    }

    return table;
})();

/**
 * Base122 参考方案使用的不可直接输出字符。
 * 这些字符会通过一个两字节 UTF-8 序列携带两个 7-bit 块。
 */
const BASE122_ILLEGALS = [
    0,
    10,
    13,
    34,
    38,
    92,
] as const;

const BASE122_SHORTENED = 0b111;

function parseCliOptions(): CliOptions {
    const positional: string[] = [];

    let inputMode: CliOptions['inputMode'] =
        'auto';

    let iterations = 3;

    for (
        let index = 2;
        index < process.argv.length;
        index += 1
    ) {
        const argument = process.argv[index];

        if (!argument) {
            continue;
        }

        if (argument.startsWith('--input-mode=')) {
            const value = argument.slice(
                '--input-mode='.length,
            );

            if (
                value !== 'auto'
                && value !== 'html'
                && value !== 'base64'
                && value !== 'binary'
            ) {
                throw new Error(
                    `无效的 --input-mode：${value}`,
                );
            }

            inputMode = value;
            continue;
        }

        if (argument.startsWith('--iterations=')) {
            const value = Number(
                argument.slice(
                    '--iterations='.length,
                ),
            );

            if (
                !Number.isInteger(value)
                || value < 1
                || value > 20
            ) {
                throw new Error(
                    '--iterations 必须是 1～20 的整数。',
                );
            }

            iterations = value;
            continue;
        }

        positional.push(argument);
    }

    return {
        inputPath:
            positional[0]
            ?? './dist/game-compressed.html',

        outputDirectory:
            positional[1]
            ?? './dist/encoding-benchmark',

        inputMode,
        iterations,
    };
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(
        bytes / 1024 / 1024
    ).toFixed(2)} MB`;
}

function percentage(
    numerator: number,
    denominator: number,
): number {
    if (denominator === 0) {
        return 0;
    }

    return Number(
        (
            numerator
            / denominator
            * 100
        ).toFixed(3),
    );
}

function scanBalancedJsonObject(
    source: string,
    startIndex: number,
): string {
    let index = startIndex;

    while (
        index < source.length
        && /\s/.test(source[index] ?? '')
    ) {
        index += 1;
    }

    if (source[index] !== '{') {
        throw new Error(
            '没有在 __PACK_ARCHIVE__ 标记后找到 JSON 对象。',
        );
    }

    const objectStart = index;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (
        ;
        index < source.length;
        index += 1
    ) {
        const character = source[index];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (character === '\\') {
                escaped = true;
                continue;
            }

            if (character === '"') {
                inString = false;
            }

            continue;
        }

        if (character === '"') {
            inString = true;
            continue;
        }

        if (character === '{') {
            depth += 1;
            continue;
        }

        if (character === '}') {
            depth -= 1;

            if (depth === 0) {
                return source.slice(
                    objectStart,
                    index + 1,
                );
            }
        }
    }

    throw new Error(
        '__PACK_ARCHIVE__ JSON 对象没有正常结束。',
    );
}

function extractArchiveFromHtml(
    html: string,
): PackedArchive {
    const markerIndex =
        html.indexOf(ARCHIVE_MARKER);

    if (markerIndex < 0) {
        throw new Error(
            'HTML 中没有找到 window.__PACK_ARCHIVE__。',
        );
    }

    const objectSource =
        scanBalancedJsonObject(
            html,
            markerIndex
                + ARCHIVE_MARKER.length,
        );

    const parsed = JSON.parse(
        objectSource,
    ) as Partial<PackedArchive>;

    if (typeof parsed.b !== 'string') {
        throw new Error(
            '__PACK_ARCHIVE__.b 不是字符串。',
        );
    }

    return parsed as PackedArchive;
}

async function loadPayload(
    options: CliOptions,
): Promise<{
    bytes: Uint8Array;
    htmlBytes: number | null;
}> {
    const absoluteInputPath =
        path.resolve(options.inputPath);

    const input = await readFile(
        absoluteInputPath,
    );

    let mode = options.inputMode;

    if (mode === 'auto') {
        const extension = path.extname(
            absoluteInputPath,
        ).toLowerCase();

        if (
            extension === '.html'
            || extension === '.htm'
        ) {
            mode = 'html';
        } else if (
            extension === '.txt'
            || extension === '.b64'
            || extension === '.base64'
        ) {
            mode = 'base64';
        } else {
            mode = 'binary';
        }
    }

    if (mode === 'html') {
        const html = input.toString('utf8');
        const archive =
            extractArchiveFromHtml(html);

        return {
            bytes: Buffer.from(
                archive.b,
                'base64',
            ),
            htmlBytes: input.byteLength,
        };
    }

    if (mode === 'base64') {
        const text = input
            .toString('utf8')
            .replace(/\s+/g, '');

        return {
            bytes: Buffer.from(
                text,
                'base64',
            ),
            htmlBytes: null,
        };
    }

    return {
        bytes: input,
        htmlBytes: null,
    };
}

function measure<T>(
    iterations: number,
    callback: () => T,
): {
    value: T;
    timing: TimingResult;
} {
    const times: number[] = [];
    let value: T | undefined;

    for (
        let iteration = 0;
        iteration < iterations;
        iteration += 1
    ) {
        const startedAt =
            performance.now();

        value = callback();

        times.push(
            performance.now()
            - startedAt,
        );
    }

    if (value === undefined) {
        throw new Error(
            '基准测试没有产生结果。',
        );
    }

    const total = times.reduce(
        (sum, current) =>
            sum + current,
        0,
    );

    return {
        value,
        timing: {
            averageMs: Number(
                (total / times.length)
                    .toFixed(3),
            ),
            minimumMs: Number(
                Math.min(...times)
                    .toFixed(3),
            ),
            maximumMs: Number(
                Math.max(...times)
                    .toFixed(3),
            ),
        },
    };
}

function equalBytes(
    left: Uint8Array,
    right: Uint8Array,
): boolean {
    if (left.byteLength !== right.byteLength) {
        return false;
    }

    for (
        let index = 0;
        index < left.byteLength;
        index += 1
    ) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
}

function encodeBase64(
    bytes: Uint8Array,
): string {
    return Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
    ).toString('base64');
}

function decodeBase64(
    encoded: string,
): Uint8Array {
    return Buffer.from(
        encoded,
        'base64',
    );
}

function encodeSafeBase91(
    bytes: Uint8Array,
): string {
    let bitBuffer = 0;
    let bitCount = 0;
    const output: string[] = [];

    for (const byte of bytes) {
        bitBuffer |= byte << bitCount;
        bitCount += 8;

        if (bitCount > 13) {
            let value = bitBuffer & 8191;

            if (value > 88) {
                bitBuffer >>>= 13;
                bitCount -= 13;
            } else {
                value = bitBuffer & 16383;
                bitBuffer >>>= 14;
                bitCount -= 14;
            }

            output.push(
                SAFE_BASE91_ALPHABET[
                    value % 91
                ] ?? '',
                SAFE_BASE91_ALPHABET[
                    Math.floor(value / 91)
                ] ?? '',
            );
        }
    }

    if (bitCount > 0) {
        output.push(
            SAFE_BASE91_ALPHABET[
                bitBuffer % 91
            ] ?? '',
        );

        if (
            bitCount > 7
            || bitBuffer > 90
        ) {
            output.push(
                SAFE_BASE91_ALPHABET[
                    Math.floor(
                        bitBuffer / 91,
                    )
                ] ?? '',
            );
        }
    }

    return output.join('');
}

function decodeSafeBase91(
    encoded: string,
): Uint8Array {
    const output: number[] = [];

    let value = -1;
    let bitBuffer = 0;
    let bitCount = 0;

    for (
        let index = 0;
        index < encoded.length;
        index += 1
    ) {
        const code = encoded.charCodeAt(index);
        const decodedValue =
            code < SAFE_BASE91_DECODE_TABLE.length
                ? SAFE_BASE91_DECODE_TABLE[code]
                : -1;

        if (decodedValue === undefined || decodedValue < 0) {
            throw new Error(
                `Safe Base91 非法字符，位置 ${index}。`,
            );
        }

        if (value < 0) {
            value = decodedValue;
            continue;
        }

        value += decodedValue * 91;
        bitBuffer |= value << bitCount;

        bitCount +=
            (value & 8191) > 88
                ? 13
                : 14;

        while (bitCount > 7) {
            output.push(
                bitBuffer & 255,
            );

            bitBuffer >>>= 8;
            bitCount -= 8;
        }

        value = -1;
    }

    if (value >= 0) {
        output.push(
            (
                bitBuffer
                | value << bitCount
            ) & 255,
        );
    }

    return Uint8Array.from(output);
}

function unpackBytesTo7BitValues(
    bytes: Uint8Array,
): Uint8Array {
    const outputLength = Math.ceil(
        bytes.byteLength * 8 / 7,
    );

    const output =
        new Uint8Array(outputLength);

    let outputIndex = 0;
    let bitBuffer = 0;
    let bitCount = 0;

    for (const byte of bytes) {
        bitBuffer |= byte << bitCount;
        bitCount += 8;

        while (bitCount >= 7) {
            output[outputIndex] =
                bitBuffer & 0x7f;

            outputIndex += 1;
            bitBuffer >>>= 7;
            bitCount -= 7;
        }
    }

    if (bitCount > 0) {
        output[outputIndex] =
            bitBuffer & 0x7f;

        outputIndex += 1;
    }

    return outputIndex === output.length
        ? output
        : output.subarray(0, outputIndex);
}

function pack7BitValuesToBytes(
    values: Uint8Array,
    originalLength: number,
): Uint8Array {
    const output =
        new Uint8Array(originalLength);

    let outputIndex = 0;
    let bitBuffer = 0;
    let bitCount = 0;

    for (const value of values) {
        bitBuffer |= value << bitCount;
        bitCount += 7;

        while (
            bitCount >= 8
            && outputIndex < originalLength
        ) {
            output[outputIndex] =
                bitBuffer & 255;

            outputIndex += 1;
            bitBuffer >>>= 8;
            bitCount -= 8;
        }
    }

    if (outputIndex !== originalLength) {
        throw new Error(
            '7-bit 数据长度不足，无法恢复原始字节。',
        );
    }

    return output;
}

function valuesToString(
    values: Uint8Array,
    offset: number,
): string {
    const chunks: string[] = [];
    const chunkSize = 16_384;

    for (
        let start = 0;
        start < values.length;
        start += chunkSize
    ) {
        const end = Math.min(
            start + chunkSize,
            values.length,
        );

        const codes = new Array<number>(
            end - start,
        );

        for (
            let index = start;
            index < end;
            index += 1
        ) {
            codes[index - start] =
                (values[index] ?? 0)
                + offset;
        }

        chunks.push(
            String.fromCharCode(...codes),
        );
    }

    return chunks.join('');
}

function stringToValues(
    encoded: string,
    offset: number,
): Uint8Array {
    const output =
        new Uint8Array(encoded.length);

    for (
        let index = 0;
        index < encoded.length;
        index += 1
    ) {
        const value =
            encoded.charCodeAt(index)
            - offset;

        if (value < 0 || value > 127) {
            throw new Error(
                `7-bit 字符越界，位置 ${index}。`,
            );
        }

        output[index] = value;
    }

    return output;
}

function encodeDirect7Bit(
    bytes: Uint8Array,
): string {
    return valuesToString(
        unpackBytesTo7BitValues(bytes),
        0,
    );
}

function decodeDirect7Bit(
    encoded: string,
    originalLength: number,
): Uint8Array {
    return pack7BitValuesToBytes(
        stringToValues(encoded, 0),
        originalLength,
    );
}

function encodeOffset7Bit(
    bytes: Uint8Array,
): string {
    return valuesToString(
        unpackBytesTo7BitValues(bytes),
        32,
    );
}

function decodeOffset7Bit(
    encoded: string,
    originalLength: number,
): Uint8Array {
    return pack7BitValuesToBytes(
        stringToValues(encoded, 32),
        originalLength,
    );
}

function encodeBase122(
    bytes: Uint8Array,
): Uint8Array {
    const values =
        unpackBytesTo7BitValues(bytes);

    const output: number[] = [];

    for (
        let index = 0;
        index < values.length;
        index += 1
    ) {
        const value = values[index] ?? 0;
        const illegalIndex =
            BASE122_ILLEGALS.indexOf(
                value as never,
            );

        if (illegalIndex < 0) {
            output.push(value);
            continue;
        }

        let nextValue =
            values[index + 1];

        let marker = illegalIndex;

        if (nextValue === undefined) {
            marker = BASE122_SHORTENED;
            nextValue = value;
        } else {
            index += 1;
        }

        let firstByte = 0b11000010;
        let secondByte = 0b10000000;

        firstByte |=
            (marker & 0b111) << 2;

        firstByte |=
            (nextValue & 0b01000000)
                ? 1
                : 0;

        secondByte |=
            nextValue & 0b00111111;

        output.push(
            firstByte,
            secondByte,
        );
    }

    return Uint8Array.from(output);
}

function decodeBase122(
    encodedUtf8: Uint8Array,
    originalLength: number,
): Uint8Array {
    const decodedValues: number[] = [];

    for (
        let index = 0;
        index < encodedUtf8.length;
        index += 1
    ) {
        const byte = encodedUtf8[index] ?? 0;

        if (byte <= 127) {
            decodedValues.push(byte);
            continue;
        }

        const secondByte =
            encodedUtf8[index + 1];

        if (secondByte === undefined) {
            throw new Error(
                'Base122 两字节序列不完整。',
            );
        }

        index += 1;

        const marker =
            (byte >>> 2) & 0b111;

        const nextValue =
            ((byte & 1) << 6)
            | (secondByte & 0b00111111);

        if (marker !== BASE122_SHORTENED) {
            const restoredIllegal =
                BASE122_ILLEGALS[marker];

            if (restoredIllegal === undefined) {
                throw new Error(
                    `Base122 非法标记：${marker}`,
                );
            }

            decodedValues.push(
                restoredIllegal,
            );
        }

        decodedValues.push(nextValue);
    }

    return pack7BitValuesToBytes(
        Uint8Array.from(decodedValues),
        originalLength,
    );
}

function escapeScriptStringLiteral(
    encoded: string,
): string {
    return JSON.stringify(encoded)
        .replace(/<\/script/gi, '<\\/script')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function createCandidateResult(
    options: {
        id: string;
        name: string;
        container:
            CandidateResult['container'];
        characterCount: number;
        encodedUtf8Bytes: number;
        embeddedPayloadBytes: number;
        decoderEstimateBytes: number;
        binaryBytes: number;
        sourceHtmlBytes: number | null;
        currentBase64LiteralBytes: number;
        encodeTiming: TimingResult;
        decodeTiming: TimingResult;
        roundTripOk: boolean;
        compatibility:
            CandidateResult['compatibility'];
        notes: string[];
        base64EmbeddedBytes: number;
    },
): CandidateResult {
    const estimatedHtmlBytes =
        options.sourceHtmlBytes === null
            ? null
            : options.sourceHtmlBytes
                - options.currentBase64LiteralBytes
                + options.embeddedPayloadBytes
                + options.decoderEstimateBytes;

    return {
        id: options.id,
        name: options.name,
        container: options.container,
        characterCount:
            options.characterCount,
        encodedUtf8Bytes:
            options.encodedUtf8Bytes,
        embeddedPayloadBytes:
            options.embeddedPayloadBytes,
        decoderEstimateBytes:
            options.decoderEstimateBytes,
        estimatedHtmlBytes,
        estimatedHtmlSize:
            estimatedHtmlBytes === null
                ? null
                : formatBytes(
                    estimatedHtmlBytes,
                ),
        ratioToBinary: percentage(
            options.embeddedPayloadBytes,
            options.binaryBytes,
        ),
        overheadPercentage: Number(
            (
                percentage(
                    options.embeddedPayloadBytes,
                    options.binaryBytes,
                )
                - 100
            ).toFixed(3),
        ),
        savedVsBase64Bytes:
            options.base64EmbeddedBytes
            - options.embeddedPayloadBytes
            - options.decoderEstimateBytes,
        savedVsBase64Percentage:
            percentage(
                options.base64EmbeddedBytes
                - options.embeddedPayloadBytes
                - options.decoderEstimateBytes,
                options.base64EmbeddedBytes,
            ),
        encodeTiming:
            options.encodeTiming,
        decodeTiming:
            options.decodeTiming,
        roundTripOk:
            options.roundTripOk,
        compatibility:
            options.compatibility,
        notes: options.notes,
    };
}

async function analyze(
    options: CliOptions,
): Promise<EncodingReport> {
    const absoluteInputPath =
        path.resolve(options.inputPath);

    const {
        bytes,
        htmlBytes,
    } = await loadPayload(options);

    console.log(
        `输入二进制：${formatBytes(bytes.byteLength)}`,
    );

    const base64Encoded = measure(
        options.iterations,
        () => encodeBase64(bytes),
    );

    const base64Literal =
        escapeScriptStringLiteral(
            base64Encoded.value,
        );

    const base64EmbeddedBytes =
        Buffer.byteLength(
            base64Literal,
            'utf8',
        );

    const base64Decoded = measure(
        options.iterations,
        () => decodeBase64(
            base64Encoded.value,
        ),
    );

    const candidates: CandidateResult[] = [];

    candidates.push(
        createCandidateResult({
            id: 'base64',
            name: 'Base64（当前方案）',
            container: 'javascript-string',
            characterCount:
                base64Encoded.value.length,
            encodedUtf8Bytes:
                Buffer.byteLength(
                    base64Encoded.value,
                    'utf8',
                ),
            embeddedPayloadBytes:
                base64EmbeddedBytes,
            decoderEstimateBytes: 0,
            binaryBytes: bytes.byteLength,
            sourceHtmlBytes: htmlBytes,
            currentBase64LiteralBytes:
                base64EmbeddedBytes,
            encodeTiming:
                base64Encoded.timing,
            decodeTiming:
                base64Decoded.timing,
            roundTripOk:
                equalBytes(
                    bytes,
                    base64Decoded.value,
                ),
            compatibility: 'high',
            notes: [
                '全部为 ASCII，可安全放入 JavaScript 字符串。',
                '浏览器原生 atob 可用，兼容性最高。',
            ],
            base64EmbeddedBytes,
        }),
    );

    console.log('正在测试 Safe Base91...');

    const base91Encoded = measure(
        options.iterations,
        () => encodeSafeBase91(bytes),
    );

    const base91Literal =
        escapeScriptStringLiteral(
            base91Encoded.value,
        );

    const base91Decoded = measure(
        options.iterations,
        () => decodeSafeBase91(
            base91Encoded.value,
        ),
    );

    candidates.push(
        createCandidateResult({
            id: 'safe-base91',
            name: 'Safe Base91',
            container: 'javascript-string',
            characterCount:
                base91Encoded.value.length,
            encodedUtf8Bytes:
                Buffer.byteLength(
                    base91Encoded.value,
                    'utf8',
                ),
            embeddedPayloadBytes:
                Buffer.byteLength(
                    base91Literal,
                    'utf8',
                ),
            decoderEstimateBytes: 700,
            binaryBytes: bytes.byteLength,
            sourceHtmlBytes: htmlBytes,
            currentBase64LiteralBytes:
                base64EmbeddedBytes,
            encodeTiming:
                base91Encoded.timing,
            decodeTiming:
                base91Decoded.timing,
            roundTripOk:
                equalBytes(
                    bytes,
                    base91Decoded.value,
                ),
            compatibility: 'high',
            notes: [
                '只使用可打印单字节 ASCII。',
                '排除了双引号、反斜杠和小于号，避免字符串转义和 </script> 风险。',
                '需要自定义 JavaScript 解码循环，速度通常慢于原生 atob。',
            ],
            base64EmbeddedBytes,
        }),
    );

    console.log('正在测试直接 7-bit + JSON 转义...');

    const direct7Encoded = measure(
        options.iterations,
        () => encodeDirect7Bit(bytes),
    );

    const direct7Literal =
        escapeScriptStringLiteral(
            direct7Encoded.value,
        );

    const direct7Decoded = measure(
        options.iterations,
        () => decodeDirect7Bit(
            direct7Encoded.value,
            bytes.byteLength,
        ),
    );

    candidates.push(
        createCandidateResult({
            id: 'direct-7bit-json',
            name: '直接 7-bit 控制字符 + JSON 转义',
            container: 'javascript-string',
            characterCount:
                direct7Encoded.value.length,
            encodedUtf8Bytes:
                Buffer.byteLength(
                    direct7Encoded.value,
                    'utf8',
                ),
            embeddedPayloadBytes:
                Buffer.byteLength(
                    direct7Literal,
                    'utf8',
                ),
            decoderEstimateBytes: 450,
            binaryBytes: bytes.byteLength,
            sourceHtmlBytes: htmlBytes,
            currentBase64LiteralBytes:
                base64EmbeddedBytes,
            encodeTiming:
                direct7Encoded.timing,
            decodeTiming:
                direct7Decoded.timing,
            roundTripOk:
                equalBytes(
                    bytes,
                    direct7Decoded.value,
                ),
            compatibility: 'experimental',
            notes: [
                '理论上每字符承载 7 bit，但大量控制字符必须写成 JSON 转义。',
                '实际 HTML 字节数通常显著大于理论 8/7。',
                '不建议作为最终方案。',
            ],
            base64EmbeddedBytes,
        }),
    );

    console.log('正在测试偏移 7-bit UTF-8 字符串...');

    const offset7Encoded = measure(
        options.iterations,
        () => encodeOffset7Bit(bytes),
    );

    const offset7Literal =
        escapeScriptStringLiteral(
            offset7Encoded.value,
        );

    const offset7Decoded = measure(
        options.iterations,
        () => decodeOffset7Bit(
            offset7Encoded.value,
            bytes.byteLength,
        ),
    );

    candidates.push(
        createCandidateResult({
            id: 'offset-7bit-json',
            name: '7-bit 值偏移到 U+0020～U+009F',
            container: 'javascript-string',
            characterCount:
                offset7Encoded.value.length,
            encodedUtf8Bytes:
                Buffer.byteLength(
                    offset7Encoded.value,
                    'utf8',
                ),
            embeddedPayloadBytes:
                Buffer.byteLength(
                    offset7Literal,
                    'utf8',
                ),
            decoderEstimateBytes: 450,
            binaryBytes: bytes.byteLength,
            sourceHtmlBytes: htmlBytes,
            currentBase64LiteralBytes:
                base64EmbeddedBytes,
            encodeTiming:
                offset7Encoded.timing,
            decodeTiming:
                offset7Decoded.timing,
            roundTripOk:
                equalBytes(
                    bytes,
                    offset7Decoded.value,
                ),
            compatibility: 'experimental',
            notes: [
                '避开了大部分 C0 控制字符。',
                'U+0080～U+009F 在 UTF-8 中占两个字节，破坏了理论压缩率。',
                '仍包含需要 JavaScript 转义的字符。',
            ],
            base64EmbeddedBytes,
        }),
    );

    console.log('正在测试 Base122 / 7-bit UTF-8...');

    const base122Encoded = measure(
        options.iterations,
        () => encodeBase122(bytes),
    );

    const base122Decoded = measure(
        options.iterations,
        () => decodeBase122(
            base122Encoded.value,
            bytes.byteLength,
        ),
    );

    const base122WrapperBytes =
        Buffer.byteLength(
            '<div id="__PACK_B122__" hidden data-p=""></div>',
            'utf8',
        );

    candidates.push(
        createCandidateResult({
            id: 'base122-attribute',
            name: 'Base122 / 7-bit UTF-8（HTML 属性）',
            container: 'html-attribute',
            characterCount:
                new TextDecoder('utf8')
                    .decode(
                        base122Encoded.value,
                    ).length,
            encodedUtf8Bytes:
                base122Encoded.value.byteLength,
            embeddedPayloadBytes:
                base122Encoded.value.byteLength
                + base122WrapperBytes,
            decoderEstimateBytes: 550,
            binaryBytes: bytes.byteLength,
            sourceHtmlBytes: htmlBytes,
            currentBase64LiteralBytes:
                base64EmbeddedBytes,
            encodeTiming:
                base122Encoded.timing,
            decodeTiming:
                base122Decoded.timing,
            roundTripOk:
                equalBytes(
                    bytes,
                    base122Decoded.value,
                ),
            compatibility: 'experimental',
            notes: [
                '最接近真正的 8/7 体积目标。',
                '不能直接作为普通 JavaScript 字符串处理，适合写入 HTML 属性并通过 DOM 读取。',
                '包含控制字符和非常规 UTF-8 字符，复制、格式化、平台二次处理可能破坏数据。',
                '需要在 Android WebView、WKWebView 和各广告平台做真实文件验证。',
            ],
            base64EmbeddedBytes,
        }),
    );

    const validCandidates = candidates.filter(
        candidate => candidate.roundTripOk,
    );

    const smallest = [...validCandidates].sort(
        (left, right) =>
            left.embeddedPayloadBytes
            + left.decoderEstimateBytes
            - (
                right.embeddedPayloadBytes
                + right.decoderEstimateBytes
            ),
    )[0];

    if (!smallest) {
        throw new Error(
            '没有通过回环校验的编码方案。',
        );
    }

    return {
        generatedAt:
            new Date().toISOString(),
        inputPath: absoluteInputPath,
        inputMode: options.inputMode,
        sourceHtmlBytes: htmlBytes,
        sourceHtmlSize:
            htmlBytes === null
                ? null
                : formatBytes(htmlBytes),
        binaryBytes: bytes.byteLength,
        binarySize:
            formatBytes(bytes.byteLength),
        iterations: options.iterations,
        candidates,
        recommendation: {
            safest: 'safe-base91',
            smallest: smallest.id,
            conclusion:
                '先以实际 HTML 字节数和解码耗时筛选。'
                + '只有 Base122 明显领先且真实平台文件验证通过时，'
                + '才值得替换当前 Base64；否则优先 Safe Base91。',
        },
    };
}

function printReport(
    report: EncodingReport,
): void {
    console.log('');
    console.log('文本编码基准测试完成');
    console.log(
        `二进制 Payload：${report.binarySize}`,
    );

    if (report.sourceHtmlSize) {
        console.log(
            `当前 HTML：${report.sourceHtmlSize}`,
        );
    }

    console.log('');

    console.table(
        report.candidates.map(candidate => ({
            方案: candidate.name,
            容器:
                candidate.container
                === 'javascript-string'
                    ? 'JS字符串'
                    : 'HTML属性',
            嵌入体积:
                formatBytes(
                    candidate.embeddedPayloadBytes,
                ),
            二进制开销:
                `${candidate.overheadPercentage}%`,
            比Base64节省:
                candidate.savedVsBase64Bytes >= 0
                    ? formatBytes(
                        candidate.savedVsBase64Bytes,
                    )
                    : `-${formatBytes(
                        -candidate.savedVsBase64Bytes,
                    )}`,
            预计HTML:
                candidate.estimatedHtmlSize
                ?? '-',
            编码ms:
                candidate.encodeTiming.averageMs,
            解码ms:
                candidate.decodeTiming.averageMs,
            回环:
                candidate.roundTripOk
                    ? '通过'
                    : '失败',
            兼容性:
                candidate.compatibility,
        })),
    );

    console.log('');
    console.log(
        `安全优先候选：${report.recommendation.safest}`,
    );
    console.log(
        `纯体积最小候选：${report.recommendation.smallest}`,
    );
    console.log(
        report.recommendation.conclusion,
    );
}

async function main(): Promise<void> {
    const options = parseCliOptions();

    const report = await analyze(options);

    const absoluteOutputDirectory =
        path.resolve(options.outputDirectory);

    await mkdir(
        absoluteOutputDirectory,
        {
            recursive: true,
        },
    );

    const reportPath = path.join(
        absoluteOutputDirectory,
        'encoding-report.json',
    );

    await writeFile(
        reportPath,
        JSON.stringify(
            report,
            null,
            2,
        ),
        'utf8',
    );

    printReport(report);

    console.log('');
    console.log(
        `报告已写入：${reportPath}`,
    );
}

void main().catch(error => {
    console.error(
        '文本编码分析失败：',
        error,
    );

    process.exitCode = 1;
});
