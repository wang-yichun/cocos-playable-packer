import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { injectChannelDownloadBridge } from "./channel-download-bridge.js";
import type { ChannelBuildConfig } from "./channel-profile.js";
import { calculateCrc32 } from "../web/zip-extractor.js";

export interface ChannelDownloadArtifact {
  body: Buffer;
  contentType: string;
  fileName: string;
  deliveryFormat: "single-html" | "zip-single-html";
  entries: readonly string[];
  sha256: string;
  htmlBytes: number;
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DEFLATE_METHOD = 8;
const ZIP_STORE_METHOD = 0;
const ZIP_VERSION_NEEDED = 20;
const ZIP_DOS_DATE_1980_01_01 = 0x0021;

function createSingleFileZip(entryName: string, content: Buffer): Buffer {
  const name = Buffer.from(entryName, "utf8");
  const deflated = deflateRawSync(content, { level: 9 });
  const useDeflate = deflated.length < content.length;
  const compressed = useDeflate ? deflated : content;
  const method = useDeflate ? ZIP_DEFLATE_METHOD : ZIP_STORE_METHOD;
  const crc32 = calculateCrc32(content);

  const localHeader = Buffer.alloc(30 + name.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
  localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(ZIP_DOS_DATE_1980_01_01, 12);
  localHeader.writeUInt32LE(crc32, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);
  name.copy(localHeader, 30);

  const centralHeader = Buffer.alloc(46 + name.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
  centralHeader.writeUInt16LE(ZIP_VERSION_NEEDED, 6);
  centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  centralHeader.writeUInt16LE(method, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(ZIP_DOS_DATE_1980_01_01, 14);
  centralHeader.writeUInt32LE(crc32, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);
  name.copy(centralHeader, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralHeader.length, 12);
  end.writeUInt32LE(localHeader.length + compressed.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, compressed, centralHeader, end]);
}

export function createChannelHtml(
  sourceHtml: string,
  config: ChannelBuildConfig,
): string {
  return injectChannelDownloadBridge(sourceHtml, config);
}

export function createChannelDownloadArtifact(
  sourceHtml: string,
  config: ChannelBuildConfig,
): ChannelDownloadArtifact {
  const html = createChannelHtml(sourceHtml, config);
  const htmlBuffer = Buffer.from(html, "utf8");

  if (config.platform === "Liftoff") {
    const body = createSingleFileZip("index.html", htmlBuffer);
    return {
      body,
      contentType: "application/zip",
      fileName: "liftoff-playable.zip",
      deliveryFormat: "zip-single-html",
      entries: ["index.html"],
      sha256: createHash("sha256").update(body).digest("hex"),
      htmlBytes: htmlBuffer.length,
    };
  }

  return {
    body: htmlBuffer,
    contentType: "text/html; charset=utf-8",
    fileName: "game.html",
    deliveryFormat: "single-html",
    entries: ["game.html"],
    sha256: createHash("sha256").update(htmlBuffer).digest("hex"),
    htmlBytes: htmlBuffer.length,
  };
}
