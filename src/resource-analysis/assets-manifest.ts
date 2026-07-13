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

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBundleName(value: Record<string, unknown>): string | null {
  const userData = value.userData;
  if (typeof userData !== "object" || userData === null || Array.isArray(userData)) {
    return null;
  }
  const record = userData as Record<string, unknown>;
  return stringField(record.bundleName) ?? stringField(record.bundle);
}

async function readMetaSummary(metaPath: string): Promise<MetaSummary | null> {
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { uuid: null, importer: null, bundleName: null };
    }
    const record = parsed as Record<string, unknown>;
    return {
      uuid: stringField(record.uuid),
      importer: stringField(record.importer),
      bundleName: readBundleName(record),
    };
  } catch {
    return null;
  }
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function walkFiles(root: string, current: string, output: string[]): Promise<void> {
  const items = await readdir(current, { withFileTypes: true });
  for (const item of items) {
    const absolutePath = path.join(current, item.name);
    if (item.isDirectory()) {
      await walkFiles(root, absolutePath, output);
      continue;
    }
    if (!item.isFile() || item.name.endsWith(".meta")) {
      continue;
    }
    output.push(normalizePath(path.relative(root, absolutePath)));
  }
}

export async function createAssetsManifest(projectDirectory: string): Promise<AssetsManifest> {
  const projectRoot = path.resolve(projectDirectory);
  const assetsRoot = path.join(projectRoot, "assets");
  const assetsStat = await stat(assetsRoot).catch(() => null);
  if (!assetsStat?.isDirectory()) {
    throw new Error(`未找到 Cocos assets 目录：${assetsRoot}`);
  }

  const relativePaths: string[] = [];
  await walkFiles(assetsRoot, assetsRoot, relativePaths);
  relativePaths.sort((left, right) => left.localeCompare(right));

  const entries: AssetsManifestEntry[] = [];
  let totalBytes = 0;
  let metaCount = 0;

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(assetsRoot, relativePath);
    const fileStat = await stat(absolutePath);
    const metaAbsolutePath = `${absolutePath}.meta`;
    const meta = await readMetaSummary(metaAbsolutePath);
    if (meta !== null) {
      metaCount += 1;
    }
    totalBytes += fileStat.size;
    entries.push({
      path: normalizePath(path.posix.join("assets", relativePath)),
      extension: path.extname(relativePath).toLowerCase() || "[none]",
      bytes: fileStat.size,
      sha256: await sha256File(absolutePath),
      modifiedAt: fileStat.mtime.toISOString(),
      metaPath: meta === null
        ? null
        : normalizePath(path.posix.join("assets", `${relativePath}.meta`)),
      uuid: meta?.uuid ?? null,
      importer: meta?.importer ?? null,
      bundleName: meta?.bundleName ?? null,
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
