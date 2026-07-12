interface CmapSubtable {
  format: number;
  offset: number;
  length: number;
}

const SFNT_SIGNATURES = new Set([0x00010000, 0x4f54544f, 0x74727565, 0x74797031]);

function ensureRange(buffer: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`字体 ${label} 超出文件范围：offset=${offset}, length=${length}`);
  }
}

function readUInt16(buffer: Buffer, offset: number, label: string): number {
  ensureRange(buffer, offset, 2, label);
  return buffer.readUInt16BE(offset);
}

function readInt16(buffer: Buffer, offset: number, label: string): number {
  ensureRange(buffer, offset, 2, label);
  return buffer.readInt16BE(offset);
}

function readUInt32(buffer: Buffer, offset: number, label: string): number {
  ensureRange(buffer, offset, 4, label);
  return buffer.readUInt32BE(offset);
}

export function validateSfnt(buffer: Buffer): void {
  if (buffer.length < 12) {
    throw new Error(`字体文件过短：${buffer.length} B`);
  }
  const signature = readUInt32(buffer, 0, "SFNT signature");
  if (!SFNT_SIGNATURES.has(signature)) {
    throw new Error(`不支持的 SFNT 签名：0x${signature.toString(16).padStart(8, "0")}`);
  }

  const numTables = readUInt16(buffer, 4, "SFNT table count");
  ensureRange(buffer, 12, numTables * 16, "SFNT table directory");
}

function findTable(buffer: Buffer, tag: string): { offset: number; length: number } | null {
  validateSfnt(buffer);
  const numTables = readUInt16(buffer, 4, "SFNT table count");
  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = 12 + index * 16;
    const recordTag = buffer.toString("ascii", recordOffset, recordOffset + 4);
    if (recordTag !== tag) {
      continue;
    }
    const offset = readUInt32(buffer, recordOffset + 8, `${tag} offset`);
    const length = readUInt32(buffer, recordOffset + 12, `${tag} length`);
    ensureRange(buffer, offset, length, `${tag} table`);
    return { offset, length };
  }
  return null;
}

function collectCmapSubtables(buffer: Buffer): CmapSubtable[] {
  const cmap = findTable(buffer, "cmap");
  if (cmap === null) {
    throw new Error("字体缺少 cmap 字符映射表。");
  }

  const numTables = readUInt16(buffer, cmap.offset + 2, "cmap subtable count");
  ensureRange(buffer, cmap.offset + 4, numTables * 8, "cmap encoding records");
  const result: CmapSubtable[] = [];

  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = cmap.offset + 4 + index * 8;
    const platformId = readUInt16(buffer, recordOffset, "cmap platform");
    const encodingId = readUInt16(buffer, recordOffset + 2, "cmap encoding");
    const relativeOffset = readUInt32(buffer, recordOffset + 4, "cmap subtable offset");
    const subtableOffset = cmap.offset + relativeOffset;

    const unicodeCompatible = platformId === 0
      || (platformId === 3 && (encodingId === 0 || encodingId === 1 || encodingId === 10));
    if (!unicodeCompatible || subtableOffset < cmap.offset || subtableOffset >= cmap.offset + cmap.length) {
      continue;
    }

    const format = readUInt16(buffer, subtableOffset, "cmap format");
    let length: number;
    if (format === 12 || format === 13) {
      length = readUInt32(buffer, subtableOffset + 4, `cmap format ${format} length`);
    } else {
      length = readUInt16(buffer, subtableOffset + 2, `cmap format ${format} length`);
    }
    ensureRange(buffer, subtableOffset, length, `cmap format ${format}`);
    result.push({ format, offset: subtableOffset, length });
  }

  if (result.length === 0) {
    throw new Error("字体没有可识别的 Unicode cmap 子表。");
  }

  return result.sort((left, right) => {
    const rank = (format: number): number => format === 12 ? 0 : format === 4 ? 1 : format === 13 ? 2 : 3;
    return rank(left.format) - rank(right.format);
  });
}

function supportsFormat0(buffer: Buffer, subtable: CmapSubtable, codePoint: number): boolean {
  if (codePoint < 0 || codePoint > 255 || subtable.length < 262) {
    return false;
  }
  return buffer[subtable.offset + 6 + codePoint] !== 0;
}

function supportsFormat4(buffer: Buffer, subtable: CmapSubtable, codePoint: number): boolean {
  if (codePoint < 0 || codePoint > 0xffff) {
    return false;
  }

  const segCount = readUInt16(buffer, subtable.offset + 6, "format 4 segCountX2") / 2;
  if (!Number.isInteger(segCount) || segCount <= 0) {
    return false;
  }

  const endCodes = subtable.offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  ensureRange(buffer, idRangeOffsets, segCount * 2, "format 4 arrays");

  for (let index = 0; index < segCount; index += 1) {
    const endCode = readUInt16(buffer, endCodes + index * 2, "format 4 endCode");
    if (codePoint > endCode) {
      continue;
    }
    const startCode = readUInt16(buffer, startCodes + index * 2, "format 4 startCode");
    if (codePoint < startCode) {
      return false;
    }

    const delta = readInt16(buffer, idDeltas + index * 2, "format 4 idDelta");
    const rangeOffsetPosition = idRangeOffsets + index * 2;
    const rangeOffset = readUInt16(buffer, rangeOffsetPosition, "format 4 idRangeOffset");
    let glyphId: number;

    if (rangeOffset === 0) {
      glyphId = (codePoint + delta) & 0xffff;
    } else {
      const glyphPosition = rangeOffsetPosition + rangeOffset + (codePoint - startCode) * 2;
      if (glyphPosition + 2 > subtable.offset + subtable.length) {
        return false;
      }
      glyphId = readUInt16(buffer, glyphPosition, "format 4 glyphId");
      if (glyphId !== 0) {
        glyphId = (glyphId + delta) & 0xffff;
      }
    }
    return glyphId !== 0;
  }

  return false;
}

function supportsFormat12Or13(
  buffer: Buffer,
  subtable: CmapSubtable,
  codePoint: number,
): boolean {
  if (codePoint < 0 || codePoint > 0x10ffff) {
    return false;
  }
  const groupCount = readUInt32(buffer, subtable.offset + 12, "cmap group count");
  const groupsOffset = subtable.offset + 16;
  ensureRange(buffer, groupsOffset, groupCount * 12, "cmap groups");

  let low = 0;
  let high = groupCount - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const groupOffset = groupsOffset + middle * 12;
    const start = readUInt32(buffer, groupOffset, "cmap group start");
    const end = readUInt32(buffer, groupOffset + 4, "cmap group end");
    if (codePoint < start) {
      high = middle - 1;
    } else if (codePoint > end) {
      low = middle + 1;
    } else {
      const startGlyph = readUInt32(buffer, groupOffset + 8, "cmap group glyph");
      return subtable.format === 13
        ? startGlyph !== 0
        : startGlyph + (codePoint - start) !== 0;
    }
  }
  return false;
}

export function supportedCodePoints(
  buffer: Buffer,
  requestedCodePoints: readonly number[],
): Set<number> {
  const subtables = collectCmapSubtables(buffer);
  const supported = new Set<number>();

  for (const codePoint of requestedCodePoints) {
    for (const subtable of subtables) {
      let present = false;
      if (subtable.format === 0) {
        present = supportsFormat0(buffer, subtable, codePoint);
      } else if (subtable.format === 4) {
        present = supportsFormat4(buffer, subtable, codePoint);
      } else if (subtable.format === 12 || subtable.format === 13) {
        present = supportsFormat12Or13(buffer, subtable, codePoint);
      }
      if (present) {
        supported.add(codePoint);
        break;
      }
    }
  }

  return supported;
}

export function codePointsToText(codePoints: Iterable<number>): string {
  return String.fromCodePoint(...codePoints);
}
