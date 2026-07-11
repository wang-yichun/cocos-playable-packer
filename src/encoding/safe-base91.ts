export const SAFE_BASE91_ALPHABET =
  "!#$%&'()*+,-./0123456789:;=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~";

if (SAFE_BASE91_ALPHABET.length !== 91) {
  throw new Error(`Safe Base91 字母表长度错误：${SAFE_BASE91_ALPHABET.length}`);
}

const SAFE_BASE91_DECODE_TABLE = (() => {
  const table = new Int16Array(128);
  table.fill(-1);

  for (let index = 0; index < SAFE_BASE91_ALPHABET.length; index += 1) {
    table[SAFE_BASE91_ALPHABET.charCodeAt(index)] = index;
  }

  return table;
})();

/**
 * 将任意二进制编码为只包含单字节可打印 ASCII 的 Safe Base91。
 *
 * 字母表排除了双引号、反斜杠和小于号，因此可以直接放进：
 *
 * window.__PACK_ARCHIVE__ = { b: "..." };
 */
export function encodeSafeBase91(bytes: Uint8Array): string {
  const output = new Uint8Array(Math.ceil(bytes.byteLength * 16 / 13) + 2);
  let outputIndex = 0;
  let bitBuffer = 0;
  let bitCount = 0;

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

      output[outputIndex] = SAFE_BASE91_ALPHABET.charCodeAt(value % 91);
      outputIndex += 1;
      output[outputIndex] = SAFE_BASE91_ALPHABET.charCodeAt(Math.floor(value / 91));
      outputIndex += 1;
    }
  }

  if (bitCount > 0) {
    output[outputIndex] = SAFE_BASE91_ALPHABET.charCodeAt(bitBuffer % 91);
    outputIndex += 1;

    if (bitCount > 7 || bitBuffer > 90) {
      output[outputIndex] = SAFE_BASE91_ALPHABET.charCodeAt(
        Math.floor(bitBuffer / 91),
      );
      outputIndex += 1;
    }
  }

  return Buffer.from(output.subarray(0, outputIndex)).toString("ascii");
}

export function decodeSafeBase91(encoded: string): Uint8Array {
  const output = new Uint8Array(Math.ceil(encoded.length * 14 / 16) + 1);
  let outputIndex = 0;
  let value = -1;
  let bitBuffer = 0;
  let bitCount = 0;

  for (let index = 0; index < encoded.length; index += 1) {
    const code = encoded.charCodeAt(index);
    const decodedValue =
      code < SAFE_BASE91_DECODE_TABLE.length
        ? SAFE_BASE91_DECODE_TABLE[code]
        : -1;

    if (decodedValue === undefined || decodedValue < 0) {
      throw new Error(`Safe Base91 非法字符，位置 ${index}。`);
    }

    if (value < 0) {
      value = decodedValue;
      continue;
    }

    value += decodedValue * 91;
    bitBuffer |= value << bitCount;
    bitCount += (value & 8191) > 88 ? 13 : 14;

    while (bitCount > 7) {
      output[outputIndex] = bitBuffer & 255;
      outputIndex += 1;
      bitBuffer >>>= 8;
      bitCount -= 8;
    }

    value = -1;
  }

  if (value >= 0) {
    output[outputIndex] = (bitBuffer | value << bitCount) & 255;
    outputIndex += 1;
  }

  return output.subarray(0, outputIndex);
}

/**
 * 注入最终 HTML 的浏览器端解码器。
 * 保持 ES2017 级语法，兼容常见移动 WebView。
 */
export function createSafeBase91BrowserDecoderSource(): string {
  return `    function decodeSafeBase91(encoded) {\n` +
    `        var startedAt = performance.now();\n` +
    `        var alphabet = ${JSON.stringify(SAFE_BASE91_ALPHABET)};\n` +
    `        var table = new Int16Array(128);\n` +
    `        table.fill(-1);\n` +
    `        var index;\n` +
    `        for (index = 0; index < alphabet.length; index += 1) {\n` +
    `            table[alphabet.charCodeAt(index)] = index;\n` +
    `        }\n` +
    `        var output = new Uint8Array(Math.ceil(encoded.length * 14 / 16) + 1);\n` +
    `        var outputIndex = 0;\n` +
    `        var value = -1;\n` +
    `        var bitBuffer = 0;\n` +
    `        var bitCount = 0;\n` +
    `        for (index = 0; index < encoded.length; index += 1) {\n` +
    `            var code = encoded.charCodeAt(index);\n` +
    `            var decodedValue = code < table.length ? table[code] : -1;\n` +
    `            if (decodedValue < 0) {\n` +
    `                throw new Error('Safe Base91 非法字符，位置 ' + index + '。');\n` +
    `            }\n` +
    `            if (value < 0) {\n` +
    `                value = decodedValue;\n` +
    `                continue;\n` +
    `            }\n` +
    `            value += decodedValue * 91;\n` +
    `            bitBuffer |= value << bitCount;\n` +
    `            bitCount += (value & 8191) > 88 ? 13 : 14;\n` +
    `            while (bitCount > 7) {\n` +
    `                output[outputIndex] = bitBuffer & 255;\n` +
    `                outputIndex += 1;\n` +
    `                bitBuffer >>>= 8;\n` +
    `                bitCount -= 8;\n` +
    `            }\n` +
    `            value = -1;\n` +
    `        }\n` +
    `        if (value >= 0) {\n` +
    `            output[outputIndex] = (bitBuffer | value << bitCount) & 255;\n` +
    `            outputIndex += 1;\n` +
    `        }\n` +
    `        var result = output.subarray(0, outputIndex);\n` +
    `        console.log('[Playable Packer] Safe Base91 解码完成：', ` +
    `            (result.byteLength / 1024 / 1024).toFixed(2) + ' MB，', ` +
    `            (performance.now() - startedAt).toFixed(2) + ' ms');\n` +
    `        return result;\n` +
    `    }\n\n`;
}
