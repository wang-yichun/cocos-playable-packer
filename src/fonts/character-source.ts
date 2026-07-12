import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".txt"]);
const ROOT_NAMES = new Set(["languages", "locales", "translations", "i18n"]);

/**
 * 运行时常见的动态字符。它们不一定直接出现在多语言表中，例如分数、
 * 百分比和倒计时，但加入字体子集的体积成本很低。
 */
export const DEFAULT_SAFE_CHARACTERS = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  "　，。！？：；（）【】《》“”‘’、…—·￥€£¥₩%+−×÷=",
].join("");

export interface CharacterSourceFileReport {
  file: string;
  extractedStrings: number;
  extractedCharacters: number;
}

export interface ExtractedCharacterSet {
  text: string;
  codePoints: number[];
  sourceFiles: CharacterSourceFileReport[];
  extractedStringCount: number;
  extractedCharacterCount: number;
  safeCharacterCount: number;
}

type TokenKind = "identifier" | "string" | "template" | "number" | "punctuation" | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_$]/.test(character);
}

function isIdentifierPart(character: string): boolean {
  return /[A-Za-z0-9_$]/.test(character);
}

function hexadecimalValue(character: string): number {
  const value = Number.parseInt(character, 16);
  return Number.isNaN(value) ? -1 : value;
}

function decodeEscape(source: string, index: number): { value: string; next: number } {
  const character = source[index];
  if (character === undefined) {
    return { value: "", next: index };
  }

  const simple: Readonly<Record<string, string>> = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    "0": "\0",
    "\\": "\\",
    "'": "'",
    '"': '"',
    "`": "`",
  };
  const simpleValue = simple[character];
  if (simpleValue !== undefined) {
    return { value: simpleValue, next: index + 1 };
  }

  if (character === "\n") {
    return { value: "", next: index + 1 };
  }
  if (character === "\r") {
    return {
      value: "",
      next: source[index + 1] === "\n" ? index + 2 : index + 1,
    };
  }

  if (character === "x") {
    const digits = source.slice(index + 1, index + 3);
    if (digits.length === 2 && [...digits].every((digit) => hexadecimalValue(digit) >= 0)) {
      return {
        value: String.fromCodePoint(Number.parseInt(digits, 16)),
        next: index + 3,
      };
    }
  }

  if (character === "u") {
    if (source[index + 1] === "{") {
      const closing = source.indexOf("}", index + 2);
      if (closing >= 0) {
        const digits = source.slice(index + 2, closing);
        const codePoint = Number.parseInt(digits, 16);
        if (
          digits.length > 0
          && [...digits].every((digit) => hexadecimalValue(digit) >= 0)
          && codePoint <= 0x10ffff
        ) {
          return { value: String.fromCodePoint(codePoint), next: closing + 1 };
        }
      }
    } else {
      const digits = source.slice(index + 1, index + 5);
      if (digits.length === 4 && [...digits].every((digit) => hexadecimalValue(digit) >= 0)) {
        return {
          value: String.fromCodePoint(Number.parseInt(digits, 16)),
          next: index + 5,
        };
      }
    }
  }

  return { value: character, next: index + 1 };
}

function readQuotedString(
  source: string,
  start: number,
  quote: "'" | '"',
): { value: string; end: number } {
  let value = "";
  let index = start + 1;

  while (index < source.length) {
    const character = source[index];
    if (character === quote) {
      return { value, end: index + 1 };
    }
    if (character === "\\") {
      const decoded = decodeEscape(source, index + 1);
      value += decoded.value;
      index = decoded.next;
      continue;
    }
    if (character === undefined) {
      break;
    }
    value += character;
    index += 1;
  }

  throw new Error(`字符串缺少结束引号，位置 ${start}。`);
}

function skipQuotedString(source: string, start: number, quote: "'" | '"' | "`"): number {
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function skipTemplateExpression(source: string, start: number): number {
  let index = start;
  let depth = 1;
  while (index < source.length && depth > 0) {
    const character = source[index];
    if (character === "'" || character === '"' || character === "`") {
      index = skipQuotedString(source, index, character);
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const closing = source.indexOf("*/", index + 2);
      index = closing < 0 ? source.length : closing + 2;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    }
    index += 1;
  }
  return index;
}

function readTemplate(source: string, start: number): { value: string; end: number } {
  let value = "";
  let index = start + 1;

  while (index < source.length) {
    const character = source[index];
    if (character === "`") {
      return { value, end: index + 1 };
    }
    if (character === "\\") {
      const decoded = decodeEscape(source, index + 1);
      value += decoded.value;
      index = decoded.next;
      continue;
    }
    if (character === "$" && source[index + 1] === "{") {
      index = skipTemplateExpression(source, index + 2);
      continue;
    }
    if (character === undefined) {
      break;
    }
    value += character;
    index += 1;
  }

  throw new Error(`模板字符串缺少结束反引号，位置 ${start}。`);
}

function tokenizeTypeScript(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    if (character === undefined) {
      break;
    }

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const closing = source.indexOf("*/", index + 2);
      index = closing < 0 ? source.length : closing + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      const result = readQuotedString(source, index, character);
      tokens.push({ kind: "string", value: result.value, start: index, end: result.end });
      index = result.end;
      continue;
    }
    if (character === "`") {
      const result = readTemplate(source, index);
      tokens.push({ kind: "template", value: result.value, start: index, end: result.end });
      index = result.end;
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < source.length) {
        const next = source[index];
        if (next === undefined || !isIdentifierPart(next)) {
          break;
        }
        index += 1;
      }
      tokens.push({
        kind: "identifier",
        value: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    if (/[0-9]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9A-Fa-f_xX.]/.test(source[index] ?? "")) {
        index += 1;
      }
      tokens.push({ kind: "number", value: source.slice(start, index), start, end: index });
      continue;
    }

    const start = index;
    const three = source.slice(index, index + 3);
    if (three === "...") {
      tokens.push({ kind: "punctuation", value: three, start, end: index + 3 });
      index += 3;
      continue;
    }
    tokens.push({ kind: "punctuation", value: character, start, end: index + 1 });
    index += 1;
  }

  tokens.push({ kind: "eof", value: "", start: source.length, end: source.length });
  return tokens;
}

function isRootAssignment(tokens: readonly Token[], index: number): number | null {
  const current = tokens[index];
  const next = tokens[index + 1];
  const afterNext = tokens[index + 2];

  if (
    current?.kind === "identifier"
    && ROOT_NAMES.has(current.value)
    && next?.value === "="
    && afterNext?.value === "{"
  ) {
    return index + 2;
  }

  if (
    current?.kind === "identifier"
    && next?.value === "."
    && afterNext?.kind === "identifier"
    && ROOT_NAMES.has(afterNext.value)
    && tokens[index + 3]?.value === "="
    && tokens[index + 4]?.value === "{"
  ) {
    return index + 4;
  }

  if (
    current?.kind === "identifier"
    && next?.value === "["
    && afterNext?.kind === "string"
    && ROOT_NAMES.has(afterNext.value)
    && tokens[index + 3]?.value === "]"
    && tokens[index + 4]?.value === "="
    && tokens[index + 5]?.value === "{"
  ) {
    return index + 5;
  }

  return null;
}

function skipExpression(tokens: readonly Token[], start: number): number {
  let index = start;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined || token.kind === "eof") {
      return index;
    }
    if (token.value === "(") roundDepth += 1;
    else if (token.value === ")" && roundDepth > 0) roundDepth -= 1;
    else if (token.value === "[") squareDepth += 1;
    else if (token.value === "]" && squareDepth > 0) squareDepth -= 1;
    else if (token.value === "{") curlyDepth += 1;
    else if (token.value === "}" && curlyDepth > 0) curlyDepth -= 1;

    if (
      roundDepth === 0
      && squareDepth === 0
      && curlyDepth === 0
      && (token.value === "," || token.value === "}" || token.value === "]")
    ) {
      return index;
    }
    index += 1;
  }
  return index;
}

function collectValue(tokens: readonly Token[], start: number, output: string[]): number {
  const token = tokens[start];
  if (token === undefined) {
    return start;
  }

  if (token.kind === "string" || token.kind === "template") {
    if (token.value.length > 0) {
      output.push(token.value);
    }
    return start + 1;
  }

  if (token.value === "{") {
    return collectObjectValues(tokens, start, output);
  }
  if (token.value === "[") {
    let index = start + 1;
    while (index < tokens.length && tokens[index]?.value !== "]") {
      if (tokens[index]?.value === ",") {
        index += 1;
        continue;
      }
      if (tokens[index]?.value === "...") {
        index = collectValue(tokens, index + 1, output);
        continue;
      }
      index = collectValue(tokens, index, output);
      if (tokens[index]?.value === ",") {
        index += 1;
      }
    }
    return tokens[index]?.value === "]" ? index + 1 : index;
  }

  return skipExpression(tokens, start);
}

function collectObjectValues(tokens: readonly Token[], start: number, output: string[]): number {
  let index = start + 1;

  while (index < tokens.length && tokens[index]?.value !== "}") {
    if (tokens[index]?.value === "," || tokens[index]?.value === ";") {
      index += 1;
      continue;
    }
    if (tokens[index]?.value === "...") {
      index = collectValue(tokens, index + 1, output);
      continue;
    }

    if (tokens[index]?.value === "[") {
      index = skipExpression(tokens, index + 1);
      if (tokens[index]?.value === "]") {
        index += 1;
      }
    } else {
      index += 1;
    }

    if (tokens[index]?.value === "?") {
      index += 1;
    }
    if (tokens[index]?.value !== ":") {
      index = skipExpression(tokens, index);
      if (tokens[index]?.value === ",") {
        index += 1;
      }
      continue;
    }

    index = collectValue(tokens, index + 1, output);
    if (tokens[index]?.value === "," || tokens[index]?.value === ";") {
      index += 1;
    }
  }

  return tokens[index]?.value === "}" ? index + 1 : index;
}

function extractFromTypeScript(sourceText: string): string[] {
  const tokens = tokenizeTypeScript(sourceText);
  const strings: string[] = [];
  const rootIndexes = new Set<number>();

  for (let index = 0; index < tokens.length; index += 1) {
    const rootIndex = isRootAssignment(tokens, index);
    if (rootIndex !== null) {
      rootIndexes.add(rootIndex);
    }
  }

  for (const rootIndex of rootIndexes) {
    collectObjectValues(tokens, rootIndex, strings);
  }

  return strings.filter((value) => value.length > 0);
}

function extractFromJson(sourceText: string, fileName: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceText) as unknown;
  } catch (error) {
    throw new Error(
      `无法解析字符源 JSON：${fileName}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const strings: string[] = [];
  function visit(value: unknown): void {
    if (typeof value === "string") {
      strings.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
    } else if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value)) {
        visit(item);
      }
    }
  }
  visit(parsed);
  return strings;
}

export function extractLocalizedStrings(sourceText: string, fileName: string): string[] {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".txt") {
    return sourceText.length === 0 ? [] : [sourceText];
  }
  if (extension === ".json") {
    return extractFromJson(sourceText, fileName);
  }
  return extractFromTypeScript(sourceText);
}

function sortedCodePoints(texts: readonly string[]): number[] {
  const values = new Set<number>();
  for (const text of texts) {
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined && codePoint !== 0xfeff) {
        values.add(codePoint);
      }
    }
  }
  return [...values].sort((left, right) => left - right);
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (
        entry.isFile()
        && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(absolutePath);
      }
    }
  }

  await visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function extractCharacterSet(
  charactersDirectory: string,
  safeCharacters = DEFAULT_SAFE_CHARACTERS,
): Promise<ExtractedCharacterSet> {
  const resolvedDirectory = path.resolve(charactersDirectory);
  const info = await stat(resolvedDirectory).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`字符源目录不存在：${resolvedDirectory}`);
  }

  const files = await collectSourceFiles(resolvedDirectory);
  if (files.length === 0) {
    throw new Error(`字符源目录中没有可处理的 TS/JS/JSON/TXT 文件：${resolvedDirectory}`);
  }

  const allStrings: string[] = [];
  const sourceFiles: CharacterSourceFileReport[] = [];

  for (const filePath of files) {
    const sourceText = await readFile(filePath, "utf8");
    const strings = extractLocalizedStrings(sourceText, filePath);
    allStrings.push(...strings);
    sourceFiles.push({
      file: path.relative(resolvedDirectory, filePath).split(path.sep).join("/"),
      extractedStrings: strings.length,
      extractedCharacters: [...strings.join("")].length,
    });
  }

  if (allStrings.length === 0) {
    throw new Error(
      `没有从字符源目录提取到多语言内容。TS 文件需要把语言对象赋给 languages/locales/translations/i18n：${resolvedDirectory}`,
    );
  }

  const extractedCodePoints = sortedCodePoints(allStrings);
  const safeCodePoints = sortedCodePoints([safeCharacters]);
  const codePoints = sortedCodePoints([...allStrings, safeCharacters]);

  return {
    text: String.fromCodePoint(...codePoints),
    codePoints,
    sourceFiles,
    extractedStringCount: allStrings.length,
    extractedCharacterCount: extractedCodePoints.length,
    safeCharacterCount: safeCodePoints.length,
  };
}
