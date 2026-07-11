export const HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID = "__PACK_HTML7_PAYLOAD__";

/**
 * Values that are never emitted as raw ASCII inside the script-data payload.
 */
export const HTML_SAFE_7BIT_ESCAPED_VALUES = new Uint8Array([
  0,   // NUL: script-data parsing replaces it with U+FFFD.
  9,   // TAB: commonly rewritten by formatters.
  10,  // LF: line-ending and formatter risk.
  12,  // FF: HTML whitespace / formatter risk.
  13,  // CR: HTML preprocessing normalizes it to LF.
  26,  // SUB: historically treated as text EOF by some tooling.
  60,  // <: enters the script-data less-than-sign state.
  127, // DEL: control character commonly filtered by text tooling.
]);

/**
 * 1024 two-byte UTF-8 code points are selected from these ranges.
 *
 * Selection rules:
 * - each code point is individually stable under NFC and NFKC;
 * - no controls, format characters, surrogates, private-use characters,
 *   unassigned characters, separators, or combining marks;
 * - all code points are <= U+07FF, so each occupies exactly two UTF-8 bytes.
 */
const ESCAPE_CODE_POINT_RANGES = [
  [161, 167], [169, 169], [171, 172], [174, 174], [176, 177],
  [182, 183], [187, 187], [191, 305], [308, 318], [321, 328],
  [330, 382], [384, 451], [461, 496], [500, 687], [697, 727],
  [734, 735], [741, 767], [880, 883], [885, 887], [891, 893],
  [895, 895], [902, 902], [904, 906], [908, 908], [910, 929],
  [931, 975], [983, 1007], [1011, 1011], [1014, 1016],
  [1018, 1154], [1162, 1327], [1329, 1366], [1369, 1386],
] as const;

function createEscapeCodePoints(): Uint16Array {
  const output = new Uint16Array(1024);
  let outputIndex = 0;

  for (const [start, end] of ESCAPE_CODE_POINT_RANGES) {
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      if (outputIndex >= output.length) {
        break;
      }
      output[outputIndex] = codePoint;
      outputIndex += 1;
    }
  }

  if (outputIndex !== output.length) {
    throw new Error(`HTML-safe 7-bit 转义码点数量错误：${outputIndex}`);
  }

  return output;
}

const ESCAPE_CODE_POINTS = createEscapeCodePoints();

const ESCAPE_TOKEN_BY_CODE_POINT = (() => {
  const table = new Int16Array(0x800);
  table.fill(-1);

  for (let token = 0; token < ESCAPE_CODE_POINTS.length; token += 1) {
    const codePoint = ESCAPE_CODE_POINTS[token];
    if (codePoint === undefined) {
      throw new Error(`HTML-safe 7-bit 转义码点索引越界：${token}`);
    }
    table[codePoint] = token;
  }

  return table;
})();

const ESCAPE_MARKER_BY_VALUE = (() => {
  const table = new Int8Array(128);
  table.fill(-1);

  for (let marker = 0; marker < HTML_SAFE_7BIT_ESCAPED_VALUES.length; marker += 1) {
    const value = HTML_SAFE_7BIT_ESCAPED_VALUES[marker];
    if (value === undefined) {
      throw new Error(`HTML-safe 7-bit 转义值索引越界：${marker}`);
    }
    table[value] = marker;
  }

  return table;
})();

function unpackBytesTo7BitValues(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(Math.ceil(bytes.byteLength * 8 / 7));
  let outputIndex = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  for (const byte of bytes) {
    bitBuffer |= byte << bitCount;
    bitCount += 8;

    while (bitCount >= 7) {
      output[outputIndex] = bitBuffer & 0x7f;
      outputIndex += 1;
      bitBuffer >>>= 7;
      bitCount -= 7;
    }
  }

  if (bitCount > 0) {
    output[outputIndex] = bitBuffer & 0x7f;
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
  if (!Number.isSafeInteger(originalLength) || originalLength < 0) {
    throw new Error(`HTML-safe 7-bit 原始长度无效：${originalLength}`);
  }

  const output = new Uint8Array(originalLength);
  let outputIndex = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  for (const value of values) {
    if (value > 0x7f) {
      throw new Error(`HTML-safe 7-bit 值越界：${value}`);
    }

    bitBuffer |= value << bitCount;
    bitCount += 7;

    while (bitCount >= 8 && outputIndex < originalLength) {
      output[outputIndex] = bitBuffer & 0xff;
      outputIndex += 1;
      bitBuffer >>>= 8;
      bitCount -= 8;
    }

    if (outputIndex === originalLength) {
      break;
    }
  }

  if (outputIndex !== originalLength) {
    throw new Error(
      `HTML-safe 7-bit 数据长度不足：期望 ${originalLength} 字节，实际 ${outputIndex} 字节。`,
    );
  }

  return output;
}

function appendCodePoint(
  chunks: string[],
  buffer: Uint16Array,
  state: { index: number },
  codePoint: number,
): void {
  buffer[state.index] = codePoint;
  state.index += 1;

  if (state.index === buffer.length) {
    chunks.push(String.fromCharCode(...buffer));
    state.index = 0;
  }
}

export function encodeHtmlSafe7Bit(bytes: Uint8Array): string {
  const values = unpackBytesTo7BitValues(bytes);
  const chunks: string[] = [];
  const codeUnits = new Uint16Array(16_384);
  const state = { index: 0 };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw new Error(`HTML-safe 7-bit 值索引越界：${index}`);
    }

    const marker = ESCAPE_MARKER_BY_VALUE[value];
    if (marker === undefined || marker < 0) {
      appendCodePoint(chunks, codeUnits, state, value);
      continue;
    }

    const nextValue = values[index + 1] ?? 0;
    if (index + 1 < values.length) {
      index += 1;
    }

    const token = marker * 128 + nextValue;
    const codePoint = ESCAPE_CODE_POINTS[token];
    if (codePoint === undefined) {
      throw new Error(`HTML-safe 7-bit 转义 token 无效：${token}`);
    }

    appendCodePoint(chunks, codeUnits, state, codePoint);
  }

  if (state.index > 0) {
    chunks.push(String.fromCharCode(...codeUnits.subarray(0, state.index)));
  }

  return chunks.join("");
}

export function decodeHtmlSafe7Bit(
  encoded: string,
  originalLength: number,
): Uint8Array {
  const values = new Uint8Array(encoded.length * 2);
  let valueCount = 0;

  for (let index = 0; index < encoded.length; index += 1) {
    const codePoint = encoded.charCodeAt(index);

    if (codePoint <= 0x7f) {
      const marker = ESCAPE_MARKER_BY_VALUE[codePoint];
      if (marker !== undefined && marker >= 0) {
        throw new Error(
          `HTML-safe 7-bit Payload 含未转义保留值 ${codePoint}，位置 ${index}。`,
        );
      }
      values[valueCount] = codePoint;
      valueCount += 1;
      continue;
    }

    const token = codePoint < ESCAPE_TOKEN_BY_CODE_POINT.length
      ? ESCAPE_TOKEN_BY_CODE_POINT[codePoint]
      : -1;
    if (token === undefined || token < 0) {
      throw new Error(
        `HTML-safe 7-bit Payload 含未知转义码点 U+${codePoint.toString(16)}，位置 ${index}。`,
      );
    }

    const marker = token >>> 7;
    const escapedValue = HTML_SAFE_7BIT_ESCAPED_VALUES[marker];
    if (escapedValue === undefined) {
      throw new Error(`HTML-safe 7-bit 转义 marker 无效：${marker}`);
    }

    values[valueCount] = escapedValue;
    valueCount += 1;
    values[valueCount] = token & 0x7f;
    valueCount += 1;
  }

  return pack7BitValuesToBytes(
    values.subarray(0, valueCount),
    originalLength,
  );
}

export function createHtmlSafe7BitBrowserDecoderSource(): string {
  return String.raw`    function decodeHtmlSafe7Bit(elementId, originalLength) {
        var element = document.getElementById(elementId);
        if (!element) {
            throw new Error('HTML-safe 7-bit Payload element not found: ' + elementId);
        }
        var encoded = element.textContent || '';
        var escaped = [0, 9, 10, 12, 13, 26, 60, 127];
        var ranges = ${JSON.stringify(ESCAPE_CODE_POINT_RANGES)};
        var reverse = new Int16Array(2048);
        reverse.fill(-1);
        var token = 0;
        for (var rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
            for (
                var codePoint = ranges[rangeIndex][0];
                codePoint <= ranges[rangeIndex][1] && token < 1024;
                codePoint += 1
            ) {
                reverse[codePoint] = token++;
            }
        }
        if (token !== 1024) {
            throw new Error('HTML-safe 7-bit escape table size mismatch: ' + token);
        }
        var values = new Uint8Array(encoded.length * 2);
        var valueCount = 0;
        for (var index = 0; index < encoded.length; index += 1) {
            var current = encoded.charCodeAt(index);
            if (current <= 127) {
                if (
                    current === 0
                    || current === 9
                    || current === 10
                    || current === 12
                    || current === 13
                    || current === 26
                    || current === 60
                    || current === 127
                ) {
                    throw new Error('HTML-safe 7-bit raw reserved value at ' + index);
                }
                values[valueCount++] = current;
                continue;
            }
            var decodedToken = current < reverse.length
                ? reverse[current]
                : -1;
            if (decodedToken === undefined || decodedToken < 0) {
                throw new Error('HTML-safe 7-bit invalid escape at ' + index);
            }
            values[valueCount++] = escaped[decodedToken >>> 7];
            values[valueCount++] = decodedToken & 127;
        }
        var output = new Uint8Array(originalLength);
        var outputIndex = 0;
        var bitBuffer = 0;
        var bitCount = 0;
        for (var valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
            bitBuffer |= values[valueIndex] << bitCount;
            bitCount += 7;
            while (bitCount >= 8 && outputIndex < originalLength) {
                output[outputIndex++] = bitBuffer & 255;
                bitBuffer >>>= 8;
                bitCount -= 8;
            }
            if (outputIndex === originalLength) {
                break;
            }
        }
        if (outputIndex !== originalLength) {
            throw new Error(
                'HTML-safe 7-bit length mismatch: expected '
                + originalLength
                + ', got '
                + outputIndex
            );
        }
        element.textContent = '';
        if (element.parentNode) {
            element.parentNode.removeChild(element);
        }
        console.log(
            '[Playable Packer] HTML-safe 7-bit 解码完成：'
            + (output.byteLength / 1024 / 1024).toFixed(2)
            + ' MB'
        );
        return output;
    }

`;
}
