import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { injectChannelDownloadBridge } from "./channel-download-bridge.js";
import type {
  ChannelBuildConfig,
  ChannelDeliveryFormat,
} from "./channel-profile.js";
import { HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID } from "../encoding/html-safe-7bit.js";
import { calculateCrc32 } from "../web/zip-extractor.js";

export interface ChannelDownloadArtifact {
  body: Buffer;
  contentType: string;
  fileName: string;
  deliveryFormat: ChannelDeliveryFormat;
  entries: readonly string[];
  entryBytes: Readonly<Record<string, number>>;
  sha256: string;
  htmlBytes: number;
}

interface ZipEntry {
  name: string;
  content: Buffer;
}

interface ScriptBlock {
  start: number;
  end: number;
  attributes: string;
  body: string;
}

interface FacebookSplitResult {
  indexHtml: string;
  resourceJavaScript: string;
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DEFLATE_METHOD = 8;
const ZIP_STORE_METHOD = 0;
const ZIP_VERSION_NEEDED = 20;
const ZIP_DOS_DATE_1980_01_01 = 0x0021;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createDeterministicZip(entries: readonly ZipEntry[]): Buffer {
  if (entries.length < 1 || entries.length > 65_535) {
    throw new Error(`ZIP 文件数量无效：${entries.length}`);
  }

  const names = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    if (!/^[A-Za-z0-9._-]+$/.test(entry.name)) {
      throw new Error(`ZIP 条目名称不安全：${entry.name}`);
    }
    if (names.has(entry.name)) {
      throw new Error(`ZIP 条目名称重复：${entry.name}`);
    }
    names.add(entry.name);

    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.content, { level: 9 });
    const useDeflate = deflated.length < entry.content.length;
    const compressed = useDeflate ? deflated : entry.content;
    const method = useDeflate ? ZIP_DEFLATE_METHOD : ZIP_STORE_METHOD;
    const crc32 = calculateCrc32(entry.content);

    if (compressed.length > 0xffff_ffff || entry.content.length > 0xffff_ffff) {
      throw new Error(`ZIP 条目过大：${entry.name}`);
    }

    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE_1980_01_01, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
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
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    name.copy(centralHeader, 46);

    localParts.push(localHeader, compressed);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + compressed.length;
  }

  const localDirectory = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  if (localDirectory.length > 0xffff_ffff || centralDirectory.length > 0xffff_ffff) {
    throw new Error("ZIP 总体积超过经典 ZIP 上限。");
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localDirectory.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localDirectory, centralDirectory, end]);
}

function scanScriptBlocks(html: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    blocks.push({
      start: match.index,
      end: match.index + match[0].length,
      attributes: match[1] ?? "",
      body: match[2] ?? "",
    });
  }

  return blocks;
}

function safeJavaScriptString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function createHtml7PayloadBootstrap(payload: string): string {
  return `(function () {\n` +
    `  var element = document.createElement("script");\n` +
    `  element.id = ${JSON.stringify(HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID)};\n` +
    `  element.type = "application/x-playable-payload";\n` +
    `  element.textContent = ${safeJavaScriptString(payload)};\n` +
    `  (document.head || document.documentElement).appendChild(element);\n` +
    `})();`;
}

export function splitFacebookHtml(sourceHtml: string): FacebookSplitResult {
  const scripts = scanScriptBlocks(sourceHtml);
  const runtime = [...scripts].reverse().find((block) => {
    if (/\bsrc\s*=/i.test(block.attributes)) {
      return false;
    }
    return block.body.includes("window.__PACK_ARCHIVE__=")
      || block.body.includes("async function boot()")
      || block.body.includes("function boot()");
  });

  if (runtime === undefined) {
    throw new Error("Facebook 交付无法定位 Playable 主运行时 script。");
  }

  const payload = [...scripts]
    .reverse()
    .find(
      (block) => block.end <= runtime.start
        && block.attributes.includes(HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID),
    );

  if (sourceHtml.includes(HTML_SAFE_7BIT_PAYLOAD_ELEMENT_ID) && payload === undefined) {
    throw new Error("Facebook 交付检测到 HTML7 Payload，但无法定位 Payload script。");
  }

  if (payload !== undefined && sourceHtml.slice(payload.end, runtime.start).trim().length > 0) {
    throw new Error("Facebook 交付要求 HTML7 Payload 与主运行时 script 相邻。");
  }

  const resourceParts: string[] = [
    "/* Cocos Playable Packer Facebook resource */",
  ];
  if (payload !== undefined) {
    resourceParts.push(createHtml7PayloadBootstrap(payload.body));
  }
  resourceParts.push(runtime.body);

  const replacementStart = payload?.start ?? runtime.start;
  const indexHtml = sourceHtml.slice(0, replacementStart)
    + '<script src="res.js"></script>'
    + sourceHtml.slice(runtime.end);
  const resourceJavaScript = `${resourceParts.join("\n\n")}\n`;

  if (!indexHtml.includes('<script src="res.js"></script>')) {
    throw new Error("Facebook 交付没有生成 res.js 引用。");
  }
  if (resourceJavaScript.trim().length === 0) {
    throw new Error("Facebook res.js 为空。");
  }

  return { indexHtml, resourceJavaScript };
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

  if (config.platform === "Facebook") {
    const split = splitFacebookHtml(html);
    const indexBuffer = Buffer.from(split.indexHtml, "utf8");
    const resourceBuffer = Buffer.from(split.resourceJavaScript, "utf8");
    const entries = [
      { name: "index.html", content: indexBuffer },
      { name: "res.js", content: resourceBuffer },
    ] as const;
    const body = createDeterministicZip(entries);
    return {
      body,
      contentType: "application/zip",
      fileName: "facebook-playable.zip",
      deliveryFormat: "zip-html-res-js",
      entries: entries.map((entry) => entry.name),
      entryBytes: {
        "index.html": indexBuffer.length,
        "res.js": resourceBuffer.length,
      },
      sha256: sha256(body),
      htmlBytes: indexBuffer.length,
    };
  }

  const htmlBuffer = Buffer.from(html, "utf8");
  if (config.platform === "Liftoff") {
    const entries = [{ name: "index.html", content: htmlBuffer }] as const;
    const body = createDeterministicZip(entries);
    return {
      body,
      contentType: "application/zip",
      fileName: "liftoff-playable.zip",
      deliveryFormat: "zip-single-html",
      entries: ["index.html"],
      entryBytes: { "index.html": htmlBuffer.length },
      sha256: sha256(body),
      htmlBytes: htmlBuffer.length,
    };
  }

  return {
    body: htmlBuffer,
    contentType: "text/html; charset=utf-8",
    fileName: "game.html",
    deliveryFormat: "single-html",
    entries: ["game.html"],
    entryBytes: { "game.html": htmlBuffer.length },
    sha256: sha256(htmlBuffer),
    htmlBytes: htmlBuffer.length,
  };
}
