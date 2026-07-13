import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface AssetsManifestEntry {
  path: string;
  extension: string;
  bytes: number;
  sha256: string;
  modifiedAt: string;
  metaPath: string | null;
  uuid: string | null;
  importer: string | null;
  bundleName: string | null;
}

export interface AssetsManifest {
  version: 1;
  generatedAt: string;
  projectName: string;
  assetsRoot: string;
  resourceCount: number;
  totalBytes: number;
  metaCount: number;
  missingMetaCount: number;
  entries: AssetsManifestEntry[];
}

interface MetaSummary {
  uuid: string | null;
  importer: string | null;
  bundleName: string | null;
}

interface DiscoveredAsset {
  relativePath: string;
  inheritedBundleName: string | null;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function userDataRecord(value: Record<string, unknown>): Record<string, unknown> | null {
  const userData = value.userData;
  return typeof userData === "object" && userData !== null && !Array.isArray(userData)
    ? userData as Record<string, unknown>
    : null;
}

function readBundleName(value: Record<string, unknown>): string | null {
  const record = userDataRecord(value);
  return record === null ? null : stringField(record.bundleName) ?? stringField(record.bundle);
}

async function readMetaRecord(metaPath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return null;
  }
}

async function readMetaSummary(metaPath: string): Promise<MetaSummary | null> {
  const record = await readMetaRecord(metaPath);
  if (record === null) return null;
  return {
    uuid: stringField(record.uuid),
    importer: stringField(record.importer),
    bundleName: readBundleName(record),
  };
}

async function readDirectoryBundleName(directoryPath: string): Promise<string | null> {
  const record = await readMetaRecord(`${directoryPath}.meta`);
  if (record === null) return null;
  const userData = userDataRecord(record);
  if (userData === null) return null;
  const configuredName = stringField(userData.bundleName) ?? stringField(userData.bundle);
  if (configuredName !== null) return configuredName;
  return userData.isBundle === true ? path.basename(directoryPath) : null;
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function walkFiles(
  root: string,
  current: string,
  inheritedBundleName: string | null,
  output: DiscoveredAsset[],
): Promise<void> {
  const relativeDirectory = normalizePath(path.relative(root, current));
  let currentBundleName = inheritedBundleName;
  if (relativeDirectory.length > 0) {
    currentBundleName = await readDirectoryBundleName(current)
      ?? (relativeDirectory === "resources" ? "resources" : inheritedBundleName);
  }

  const items = await readdir(current, { withFileTypes: true });
  for (const item of items) {
    const absolutePath = path.join(current, item.name);
    if (item.isDirectory()) {
      await walkFiles(root, absolutePath, currentBundleName, output);
      continue;
    }
    if (!item.isFile() || item.name.endsWith(".meta")) continue;
    output.push({
      relativePath: normalizePath(path.relative(root, absolutePath)),
      inheritedBundleName: currentBundleName,
    });
  }
}

export async function createAssetsManifest(projectDirectory: string): Promise<AssetsManifest> {
  const projectRoot = path.resolve(projectDirectory);
  const assetsRoot = path.join(projectRoot, "assets");
  const assetsStat = await stat(assetsRoot).catch(() => null);
  if (!assetsStat?.isDirectory()) {
    throw new Error(`未找到 Cocos assets 目录：${assetsRoot}`);
  }

  const discovered: DiscoveredAsset[] = [];
  await walkFiles(assetsRoot, assetsRoot, null, discovered);
  discovered.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const entries: AssetsManifestEntry[] = [];
  let totalBytes = 0;
  let metaCount = 0;

  for (const asset of discovered) {
    const absolutePath = path.join(assetsRoot, asset.relativePath);
    const fileStat = await stat(absolutePath);
    const metaAbsolutePath = `${absolutePath}.meta`;
    const meta = await readMetaSummary(metaAbsolutePath);
    if (meta !== null) metaCount += 1;
    totalBytes += fileStat.size;
    entries.push({
      path: normalizePath(path.posix.join("assets", asset.relativePath)),
      extension: path.extname(asset.relativePath).toLowerCase() || "[none]",
      bytes: fileStat.size,
      sha256: await sha256File(absolutePath),
      modifiedAt: fileStat.mtime.toISOString(),
      metaPath: meta === null
        ? null
        : normalizePath(path.posix.join("assets", `${asset.relativePath}.meta`)),
      uuid: meta?.uuid ?? null,
      importer: meta?.importer ?? null,
      bundleName: meta?.bundleName ?? asset.inheritedBundleName,
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectName: path.basename(projectRoot),
    assetsRoot: "assets",
    resourceCount: entries.length,
    totalBytes,
    metaCount,
    missingMetaCount: entries.length - metaCount,
    entries,
  };
}
