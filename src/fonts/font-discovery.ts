import { createHash } from "node:crypto";
import { open, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { validateSfnt } from "./sfnt.js";

const SFNT_SIGNATURES = new Set([
  0x00010000,
  0x4f54544f, // OTTO
  0x74727565, // true
  0x74797031, // typ1
]);

export interface DiscoveredFontFile {
  absolutePath: string;
  relativePath: string;
  bytes: number;
  sha256: string;
  extension: string;
}

function portable(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function hasSupportedSfntSignature(header: Buffer): boolean {
  return header.length >= 4 && SFNT_SIGNATURES.has(header.readUInt32BE(0));
}

async function readHeader(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const result = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

export async function discoverBuildFonts(
  buildDirectory: string,
): Promise<DiscoveredFontFile[]> {
  const fonts: DiscoveredFontFile[] = [];

  async function visit(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const header = await readHeader(absolutePath);
      if (!hasSupportedSfntSignature(header)) {
        continue;
      }

      const buffer = await readFile(absolutePath);
      try {
        validateSfnt(buffer);
      } catch (error) {
        throw new Error(
          `检测到字体签名但 SFNT 校验失败：${absolutePath}\n${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      fonts.push({
        absolutePath,
        relativePath: portable(path.relative(buildDirectory, absolutePath)),
        bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        extension: path.extname(entry.name).toLowerCase(),
      });
    }
  }

  await visit(buildDirectory);
  return fonts.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}
