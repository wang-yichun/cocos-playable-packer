import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMLINK = 0o120000;

export type ZipValidationErrorCode =
  | "INVALID_ZIP"
  | "UNSUPPORTED_ZIP"
  | "ZIP_LIMIT_EXCEEDED"
  | "UNSAFE_ZIP_PATH"
  | "ZIP_INTEGRITY_ERROR"
  | "WEB_MOBILE_ROOT_NOT_FOUND";

export class ZipValidationError extends Error {
  readonly code: ZipValidationErrorCode;

  constructor(code: ZipValidationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ZipValidationError";
    this.code = code;
  }
}

export interface ZipExtractionLimits {
  maxArchiveBytes: number;
  maxExtractedBytes: number;
  maxFileCount: number;
  maxSingleFileBytes: number;
  maxPathDepth: number;
}

export interface ZipExtractionResult {
  archiveBytes: number;
  extractedBytes: number;
  fileCount: number;
}

export const DEFAULT_ZIP_EXTRACTION_LIMITS: Readonly<ZipExtractionLimits> = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxExtractedBytes: 512 * 1024 * 1024,
  maxFileCount: 5_000,
  maxSingleFileBytes: 128 * 1024 * 1024,
  maxPathDepth: 24,
};

interface CentralDirectoryEntry {
  name: string;
  normalizedPath: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  if (archive.length < 22) {
    throw new ZipValidationError("INVALID_ZIP", "ZIP 文件过短。");
  }
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw new ZipValidationError("INVALID_ZIP", "ZIP 缺少中央目录结束记录。");
}

function decodeEntryName(buffer: Buffer, utf8: boolean): string {
  const decoded = buffer.toString(utf8 ? "utf8" : "utf8");
  if (decoded.includes("\0")) {
    throw new ZipValidationError("UNSAFE_ZIP_PATH", "ZIP 文件名包含 NUL 字符。");
  }
  return decoded;
}

function normalizeEntryPath(name: string, maxPathDepth: number): string {
  const slashPath = name.replace(/\\/g, "/");
  if (
    slashPath.startsWith("/")
    || slashPath.startsWith("//")
    || /^[a-zA-Z]:/.test(slashPath)
  ) {
    throw new ZipValidationError("UNSAFE_ZIP_PATH", `ZIP 包含绝对路径：${name}`);
  }

  const segments = slashPath.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new ZipValidationError("UNSAFE_ZIP_PATH", `ZIP 包含路径穿越：${name}`);
  }
  const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  for (const segment of segments) {
    if (
      segment.includes(":")
      || segment.endsWith(".")
      || segment.endsWith(" ")
      || windowsReserved.test(segment)
    ) {
      throw new ZipValidationError("UNSAFE_ZIP_PATH", `ZIP 包含不安全文件名：${name}`);
    }
  }
  if (segments.length > maxPathDepth) {
    throw new ZipValidationError(
      "ZIP_LIMIT_EXCEEDED",
      `ZIP 路径层级超过限制 ${maxPathDepth}：${name}`,
    );
  }
  if (segments.length === 0) {
    return "";
  }
  return segments.join("/");
}

function parseCentralDirectory(
  archive: Buffer,
  limits: ZipExtractionLimits,
): CentralDirectoryEntry[] {
  const eocdOffset = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentLength = archive.readUInt16LE(eocdOffset + 20);

  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || entriesOnDisk !== totalEntries
  ) {
    throw new ZipValidationError("UNSUPPORTED_ZIP", "暂不支持分卷 ZIP。");
  }
  if (
    totalEntries === ZIP64_SENTINEL_16
    || centralDirectorySize === ZIP64_SENTINEL_32
    || centralDirectoryOffset === ZIP64_SENTINEL_32
  ) {
    throw new ZipValidationError("UNSUPPORTED_ZIP", "暂不支持 ZIP64。");
  }
  if (totalEntries > limits.maxFileCount) {
    throw new ZipValidationError(
      "ZIP_LIMIT_EXCEEDED",
      `ZIP 条目数量 ${totalEntries} 超过限制 ${limits.maxFileCount}。`,
    );
  }
  if (eocdOffset + 22 + commentLength > archive.length) {
    throw new ZipValidationError("INVALID_ZIP", "ZIP 结束记录长度无效。");
  }
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    throw new ZipValidationError("INVALID_ZIP", "ZIP 中央目录范围无效。");
  }

  const entries: CentralDirectoryEntry[] = [];
  const seenPaths = new Set<string>();
  let offset = centralDirectoryOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipValidationError("INVALID_ZIP", `ZIP 中央目录第 ${index + 1} 项无效。`);
    }

    const versionMadeBy = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const crc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLengthForEntry = archive.readUInt16LE(offset + 32);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const endOffset = offset + 46 + fileNameLength + extraLength + commentLengthForEntry;

    if (endOffset > archive.length) {
      throw new ZipValidationError("INVALID_ZIP", "ZIP 中央目录条目越界。");
    }
    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw new ZipValidationError("UNSUPPORTED_ZIP", "暂不支持加密 ZIP。");
    }
    if (compressedSize === ZIP64_SENTINEL_32 || uncompressedSize === ZIP64_SENTINEL_32) {
      throw new ZipValidationError("UNSUPPORTED_ZIP", "暂不支持 ZIP64 文件条目。");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new ZipValidationError(
        "UNSUPPORTED_ZIP",
        `ZIP 使用了不支持的压缩方法：${compressionMethod}`,
      );
    }

    const nameBuffer = archive.subarray(offset + 46, offset + 46 + fileNameLength);
    const name = decodeEntryName(nameBuffer, (flags & UTF8_FLAG) !== 0);
    const normalizedPath = normalizeEntryPath(name, limits.maxPathDepth);
    const hostSystem = versionMadeBy >>> 8;
    const unixMode = hostSystem === 3 ? externalAttributes >>> 16 : 0;
    const unixType = unixMode & UNIX_FILE_TYPE_MASK;
    const isDirectory = name.endsWith("/") || unixType === UNIX_DIRECTORY;

    if (unixType === UNIX_SYMLINK) {
      throw new ZipValidationError("UNSAFE_ZIP_PATH", `ZIP 包含符号链接：${name}`);
    }
    if (!isDirectory && normalizedPath.length === 0) {
      throw new ZipValidationError("UNSAFE_ZIP_PATH", "ZIP 包含空文件名。");
    }
    if (normalizedPath.length > 0) {
      const key = normalizedPath.toLowerCase();
      if (seenPaths.has(key)) {
        throw new ZipValidationError("UNSAFE_ZIP_PATH", `ZIP 包含重复路径：${normalizedPath}`);
      }
      seenPaths.add(key);
    }
    if (!isDirectory) {
      if (uncompressedSize > limits.maxSingleFileBytes) {
        throw new ZipValidationError(
          "ZIP_LIMIT_EXCEEDED",
          `ZIP 单文件 ${normalizedPath} 解压后大小超过限制。`,
        );
      }
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > limits.maxExtractedBytes) {
        throw new ZipValidationError(
          "ZIP_LIMIT_EXCEEDED",
          `ZIP 解压后总体积超过限制 ${limits.maxExtractedBytes} B。`,
        );
      }
    }

    entries.push({
      name,
      normalizedPath,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      crc32,
      localHeaderOffset,
      isDirectory,
    });
    offset = endOffset;
  }

  return entries;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const tableValue = CRC32_TABLE[(crc ^ byte) & 0xff];
    if (tableValue === undefined) {
      throw new Error("CRC32 表索引异常。");
    }
    crc = tableValue ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function resolveSafeOutputPath(rootDirectory: string, relativePath: string): string {
  const root = path.resolve(rootDirectory);
  const output = path.resolve(root, ...relativePath.split("/"));
  const prefix = `${root}${path.sep}`;
  if (output !== root && !output.startsWith(prefix)) {
    throw new ZipValidationError("UNSAFE_ZIP_PATH", `ZIP 输出路径越界：${relativePath}`);
  }
  return output;
}

export async function extractZipArchive(
  archiveFile: string,
  outputDirectory: string,
  providedLimits: Partial<ZipExtractionLimits> = {},
): Promise<ZipExtractionResult> {
  const limits: ZipExtractionLimits = {
    ...DEFAULT_ZIP_EXTRACTION_LIMITS,
    ...providedLimits,
  };
  const archive = await readFile(archiveFile);
  if (archive.length === 0 || archive.length > limits.maxArchiveBytes) {
    throw new ZipValidationError(
      "ZIP_LIMIT_EXCEEDED",
      `ZIP 大小必须在 1 B 到 ${limits.maxArchiveBytes} B 之间。`,
    );
  }

  const entries = parseCentralDirectory(archive, limits);
  await mkdir(outputDirectory, { recursive: true });
  let extractedBytes = 0;
  let fileCount = 0;

  for (const entry of entries) {
    if (entry.normalizedPath.length === 0) {
      continue;
    }
    const outputPath = resolveSafeOutputPath(outputDirectory, entry.normalizedPath);
    if (entry.isDirectory) {
      await mkdir(outputPath, { recursive: true });
      continue;
    }

    const localOffset = entry.localHeaderOffset;
    if (
      localOffset + 30 > archive.length
      || archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER_SIGNATURE
    ) {
      throw new ZipValidationError("INVALID_ZIP", `ZIP 本地文件头无效：${entry.name}`);
    }
    const localFileNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataOffset < 0 || dataEnd > archive.length) {
      throw new ZipValidationError("INVALID_ZIP", `ZIP 文件数据越界：${entry.name}`);
    }

    const compressed = archive.subarray(dataOffset, dataEnd);
    let uncompressed: Buffer;
    try {
      uncompressed = entry.compressionMethod === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed);
    } catch (error) {
      throw new ZipValidationError(
        "ZIP_INTEGRITY_ERROR",
        `ZIP 文件解压失败：${entry.name}`,
        { cause: error },
      );
    }

    if (uncompressed.length !== entry.uncompressedSize) {
      throw new ZipValidationError(
        "ZIP_INTEGRITY_ERROR",
        `ZIP 文件大小校验失败：${entry.name}`,
      );
    }
    if (calculateCrc32(uncompressed) !== entry.crc32) {
      throw new ZipValidationError(
        "ZIP_INTEGRITY_ERROR",
        `ZIP 文件 CRC32 校验失败：${entry.name}`,
      );
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, uncompressed);
    extractedBytes += uncompressed.length;
    fileCount += 1;
  }

  return {
    archiveBytes: archive.length,
    extractedBytes,
    fileCount,
  };
}

async function isRegularFile(filePath: string): Promise<boolean> {
  const info = await stat(filePath).catch(() => null);
  return info?.isFile() === true;
}

export async function findWebMobileRoot(extractionDirectory: string): Promise<string> {
  const directIndex = path.join(extractionDirectory, "index.html");
  if (await isRegularFile(directIndex)) {
    return extractionDirectory;
  }

  const entries = await readdir(extractionDirectory, { withFileTypes: true });
  const candidateDirectories = entries.filter(
    (entry) => entry.isDirectory() && entry.name !== "__MACOSX",
  );
  for (const candidate of candidateDirectories) {
    const candidateDirectory = path.join(extractionDirectory, candidate.name);
    if (await isRegularFile(path.join(candidateDirectory, "index.html"))) {
      if (candidateDirectories.length === 1) {
        return candidateDirectory;
      }
    }
  }

  throw new ZipValidationError(
    "WEB_MOBILE_ROOT_NOT_FOUND",
    "ZIP 根目录或唯一一级子目录中没有找到 index.html。请上传 Cocos web-mobile 构建目录的 ZIP。",
  );
}
