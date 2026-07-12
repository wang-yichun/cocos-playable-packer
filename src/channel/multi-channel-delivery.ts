import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import {
  createChannelDownloadArtifact,
  type ChannelDownloadArtifact,
} from "./liftoff-delivery.js";
import {
  CHANNEL_PLATFORMS,
  type ChannelBuildConfig,
  type ChannelPlatform,
} from "./channel-profile.js";
import { calculateCrc32 } from "../web/zip-extractor.js";

interface ZipEntry {
  name: string;
  content: Buffer;
  compression: "store" | "fast-deflate";
}

export interface MultiChannelArtifactEntry {
  platform: ChannelPlatform;
  bundlePath: string;
  artifact: ChannelDownloadArtifact;
}

export interface MultiChannelDownloadArtifact {
  body: Buffer;
  contentType: "application/zip";
  fileName: "playable-channel-bundle.zip";
  sha256: string;
  entries: readonly string[];
  channelArtifacts: readonly MultiChannelArtifactEntry[];
  manifest: Record<string, unknown>;
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DEFLATE_METHOD = 8;
const ZIP_STORE_METHOD = 0;
const ZIP_VERSION_NEEDED = 20;
const ZIP_DOS_DATE_1980_01_01 = 0x0021;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateZipEntryName(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || normalized.endsWith("/")
  ) {
    throw new Error(`ZIP 条目名称无效：${value}`);
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0
        || segment === "."
        || segment === ".."
        || !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    throw new Error(`ZIP 条目名称不安全：${value}`);
  }
  return normalized;
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
    const safeName = validateZipEntryName(entry.name);
    if (names.has(safeName)) {
      throw new Error(`ZIP 条目名称重复：${safeName}`);
    }
    names.add(safeName);

    const name = Buffer.from(safeName, "utf8");
    const deflated = entry.compression === "fast-deflate"
      ? deflateRawSync(entry.content, { level: 1 })
      : entry.content;
    const useDeflate = entry.compression === "fast-deflate"
      && deflated.length < entry.content.length;
    const compressed = useDeflate ? deflated : entry.content;
    const method = useDeflate ? ZIP_DEFLATE_METHOD : ZIP_STORE_METHOD;
    const crc32 = calculateCrc32(entry.content);

    if (compressed.length > 0xffff_ffff || entry.content.length > 0xffff_ffff) {
      throw new Error(`ZIP 条目过大：${safeName}`);
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

function channelSlug(platform: ChannelPlatform): string {
  return platform === "IronSource"
    ? "ironsource"
    : platform.toLowerCase();
}

export function selectedChannelPlatforms(
  config: ChannelBuildConfig & { platforms?: readonly ChannelPlatform[] },
): readonly ChannelPlatform[] {
  const source = config.platforms ?? [config.platform];
  const selected = new Set(source);
  return CHANNEL_PLATFORMS.filter((platform) => selected.has(platform));
}

export function channelConfigForPlatform(
  config: ChannelBuildConfig & { platforms?: readonly ChannelPlatform[] },
  platform: ChannelPlatform,
): ChannelBuildConfig {
  return {
    platform,
    androidStoreUrl: config.androidStoreUrl,
    iosStoreUrl: config.iosStoreUrl,
  };
}

export function createMultiChannelDownloadArtifact(
  sourceHtml: string,
  config: ChannelBuildConfig & { platforms?: readonly ChannelPlatform[] },
): MultiChannelDownloadArtifact {
  const platforms = selectedChannelPlatforms(config);
  if (platforms.length === 0) {
    throw new Error("多渠道交付包至少需要一个渠道。");
  }

  const channelArtifacts: MultiChannelArtifactEntry[] = platforms.map((platform) => {
    const artifact = createChannelDownloadArtifact(
      sourceHtml,
      channelConfigForPlatform(config, platform),
    );
    return {
      platform,
      bundlePath: `channels/${channelSlug(platform)}/${artifact.fileName}`,
      artifact,
    };
  });

  const manifest = {
    schemaVersion: 1,
    tool: "cocos-playable-packer",
    mode: "multi-channel-batch",
    baseBuild: {
      executions: 1,
      htmlBytes: Buffer.byteLength(sourceHtml),
      htmlSha256: sha256(sourceHtml),
    },
    selectedPlatforms: [...platforms],
    reuse: {
      sharedStages: [
        "copy",
        "imageOptimization",
        "audioOptimization",
        "brotliCompression",
        "payloadEncoding",
      ],
      channelSpecificStage: "deliveryPackaging",
      bundleCompressionPolicy: {
        nestedZip: "store",
        htmlAndManifest: "deflate-level-1",
      },
    },
    deliveries: channelArtifacts.map(({ platform, bundlePath, artifact }) => ({
      platform,
      bundlePath,
      fileName: artifact.fileName,
      deliveryFormat: artifact.deliveryFormat,
      mediaType: artifact.contentType,
      entries: [...artifact.entries],
      entryBytes: { ...artifact.entryBytes },
      bytes: artifact.body.length,
      sha256: artifact.sha256,
      htmlBytes: artifact.htmlBytes,
    })),
  } satisfies Record<string, unknown>;

  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const zipEntries: ZipEntry[] = channelArtifacts.map(({ bundlePath, artifact }) => ({
    name: bundlePath,
    content: artifact.body,
    compression: artifact.contentType === "application/zip"
      ? "store"
      : "fast-deflate",
  }));
  zipEntries.push({
    name: "manifest.json",
    content: manifestBuffer,
    compression: "fast-deflate",
  });

  const body = createDeterministicZip(zipEntries);
  return {
    body,
    contentType: "application/zip",
    fileName: "playable-channel-bundle.zip",
    sha256: sha256(body),
    entries: zipEntries.map((entry) => entry.name),
    channelArtifacts,
    manifest,
  };
}
