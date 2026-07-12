import assert from "node:assert/strict";
import path from "node:path";

import {
  DEFAULT_SAFE_CHARACTERS,
  extractLocalizedStrings,
} from "./character-source.js";
import { parseFontSubsetArguments } from "./subset-build-fonts.js";
import {
  codePointsToText,
  supportedCodePoints,
  validateSfnt,
} from "./sfnt.js";

function createTestFont(): Buffer {
  const tableOffset = 28;
  const cmapLength = 52;
  const buffer = Buffer.alloc(tableOffset + cmapLength);

  buffer.writeUInt32BE(0x00010000, 0);
  buffer.writeUInt16BE(1, 4);
  buffer.write("cmap", 12, "ascii");
  buffer.writeUInt32BE(tableOffset, 20);
  buffer.writeUInt32BE(cmapLength, 24);

  buffer.writeUInt16BE(0, tableOffset);
  buffer.writeUInt16BE(1, tableOffset + 2);
  buffer.writeUInt16BE(3, tableOffset + 4);
  buffer.writeUInt16BE(10, tableOffset + 6);
  buffer.writeUInt32BE(12, tableOffset + 8);

  const subtable = tableOffset + 12;
  buffer.writeUInt16BE(12, subtable);
  buffer.writeUInt16BE(0, subtable + 2);
  buffer.writeUInt32BE(40, subtable + 4);
  buffer.writeUInt32BE(0, subtable + 8);
  buffer.writeUInt32BE(2, subtable + 12);

  buffer.writeUInt32BE(65, subtable + 16);
  buffer.writeUInt32BE(65, subtable + 20);
  buffer.writeUInt32BE(1, subtable + 24);
  buffer.writeUInt32BE(0x4e2d, subtable + 28);
  buffer.writeUInt32BE(0x4e2d, subtable + 32);
  buffer.writeUInt32BE(2, subtable + 36);

  return buffer;
}

function main(): void {
  const source = [
    "const unrelated = 'DO_NOT_INCLUDE';",
    "const win = window as any;",
    "win.languages = {",
    "  en: { common: { playnow: 'Play Now' } },",
    "  zh: { common: { playnow: '立即游玩' } },",
    "};",
  ].join("\n");
  const strings = extractLocalizedStrings(source, "locales.ts");
  assert.deepEqual(strings, ["Play Now", "立即游玩"]);
  assert.ok(!strings.join("").includes("playnow"));
  assert.ok(!strings.join("").includes("DO_NOT_INCLUDE"));

  const alternateSource = [
    "// window.locales = { ignored: 'COMMENT_VALUE' };",
    "window['locales'] = {",
    "  en: { message: 'Line\\nBreak' },",
    "  zh: { escaped: '\\u4e2d' },",
    "  dynamic: { message: `Hello ${playerName}!` },",
    "};",
  ].join("\n");
  assert.deepEqual(
    extractLocalizedStrings(alternateSource, "alternate.ts"),
    ["Line\nBreak", "中", "Hello !"],
  );

  assert.ok(DEFAULT_SAFE_CHARACTERS.includes("0"));
  assert.ok(DEFAULT_SAFE_CHARACTERS.includes("%"));

  const options = parseFontSubsetArguments([
    "./build/web-mobile",
    "--characters=./characters",
    "--min-savings-bytes=256",
    "--min-savings-percent=2.5",
    "--confirm",
  ]);
  assert.equal(options.buildDirectory, path.resolve("./build/web-mobile"));
  assert.equal(options.charactersDirectory, path.resolve("./characters"));
  assert.equal(options.minSavingsBytes, 256);
  assert.equal(options.minSavingsPercent, 2.5);
  assert.equal(options.confirm, true);
  assert.throws(
    () => parseFontSubsetArguments(["build", "--preview", "--confirm"]),
    /只能指定一个/,
  );

  const font = createTestFont();
  validateSfnt(font);
  const requested = [65, 66, 0x4e2d];
  const supported = supportedCodePoints(font, requested);
  assert.deepEqual([...supported], [65, 0x4e2d]);
  assert.equal(codePointsToText(supported), "A中");
  assert.throws(() => validateSfnt(Buffer.from("invalid")), /过短|签名/);

  console.log("Font subsetting self-test passed.");
}

main();
