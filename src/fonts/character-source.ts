import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

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

function scriptKindForExtension(extension: string): ts.ScriptKind {
  switch (extension) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function staticPropertyName(node: ts.Expression | ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
}

function assignedRootName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    return staticPropertyName(expression.argumentExpression);
  }
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectValueStrings(expression: ts.Expression, output: string[]): void {
  const current = unwrapExpression(expression);

  if (ts.isStringLiteralLike(current)) {
    output.push(current.text);
    return;
  }

  if (ts.isTemplateExpression(current)) {
    output.push(current.head.text);
    for (const span of current.templateSpans) {
      output.push(span.literal.text);
    }
    return;
  }

  if (ts.isObjectLiteralExpression(current)) {
    for (const property of current.properties) {
      if (ts.isPropertyAssignment(property)) {
        collectValueStrings(property.initializer, output);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        // 动态变量不能在不执行代码的情况下安全展开，故忽略。
      } else if (ts.isSpreadAssignment(property)) {
        collectValueStrings(property.expression, output);
      }
    }
    return;
  }

  if (ts.isArrayLiteralExpression(current)) {
    for (const element of current.elements) {
      if (!ts.isOmittedExpression(element)) {
        collectValueStrings(element, output);
      }
    }
    return;
  }

  if (ts.isConditionalExpression(current)) {
    collectValueStrings(current.whenTrue, output);
    collectValueStrings(current.whenFalse, output);
  }
}

function extractFromTypeScript(sourceText: string, fileName: string): string[] {
  const extension = path.extname(fileName).toLowerCase();
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ESNext,
    true,
    scriptKindForExtension(extension),
  );
  const roots: ts.Expression[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ROOT_NAMES.has(assignedRootName(node.left) ?? "")
    ) {
      roots.push(node.right);
    } else if (
      ts.isVariableDeclaration(node)
      && node.initializer
      && ts.isIdentifier(node.name)
      && ROOT_NAMES.has(node.name.text)
    ) {
      roots.push(node.initializer);
    } else if (ts.isExportAssignment(node)) {
      roots.push(node.expression);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const strings: string[] = [];
  for (const root of roots) {
    collectValueStrings(root, strings);
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
  return extractFromTypeScript(sourceText, fileName);
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
