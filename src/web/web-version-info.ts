import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface WebComponentVersion {
  name: string;
  version: string;
}

export interface WebVersionInfo {
  appVersion: string;
  buildSha: string;
  buildShortSha: string;
  buildDate: string | null;
  generatedAt: string;
  nodeVersion: string;
  ffmpegVersion: string | null;
  components: readonly WebComponentVersion[];
  copyrightYear: number;
  copyrightName: string;
}

interface PackageManifest {
  version?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

const CORE_COMPONENTS = [
  "typescript",
  "sharp",
  "@jsquash/webp",
  "@jsquash/jpeg",
  "@jsquash/oxipng",
  "brotli-compress",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function declaredVersion(manifest: PackageManifest, packageName: string): string | null {
  const value = manifest.dependencies?.[packageName] ?? manifest.devDependencies?.[packageName];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value.trim().replace(/^[~^]/, "");
}

async function installedVersion(projectRoot: string, packageName: string): Promise<string | null> {
  const packageJson = await readJsonFile(
    path.join(projectRoot, "node_modules", ...packageName.split("/"), "package.json"),
  );
  return typeof packageJson?.version === "string" ? packageJson.version : null;
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        cwd,
        windowsHide: true,
        timeout: 3_000,
        maxBuffer: 256 * 1024,
      },
      (error, stdout) => {
        if (error !== null) {
          resolve(null);
          return;
        }
        const value = String(stdout).trim();
        resolve(value.length > 0 ? value : null);
      },
    );
  });
}

export function parseFfmpegVersion(output: string | null): string | null {
  if (output === null) {
    return null;
  }
  const firstLine = output.split(/\r?\n/, 1)[0] ?? "";
  return /^ffmpeg version\s+([^\s]+)/i.exec(firstLine)?.[1] ?? null;
}

export function createFallbackWebVersionInfo(): WebVersionInfo {
  const now = new Date();
  return {
    appVersion: "dev",
    buildSha: "unknown",
    buildShortSha: "unknown",
    buildDate: null,
    generatedAt: now.toISOString(),
    nodeVersion: process.version,
    ffmpegVersion: null,
    components: [],
    copyrightYear: now.getUTCFullYear(),
    copyrightName: "wang-yichun",
  };
}

export async function loadWebVersionInfo(projectRoot: string): Promise<WebVersionInfo> {
  const manifestRecord = await readJsonFile(path.join(projectRoot, "package.json"));
  const manifest = (manifestRecord ?? {}) as PackageManifest;
  const appVersion = typeof manifest.version === "string" ? manifest.version : "dev";

  const [gitSha, gitDate, ffmpegOutput] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], projectRoot),
    runCommand("git", ["show", "-s", "--format=%cI", "HEAD"], projectRoot),
    runCommand("ffmpeg", ["-version"], projectRoot),
  ]);

  const components: WebComponentVersion[] = [];
  for (const packageName of CORE_COMPONENTS) {
    const version = await installedVersion(projectRoot, packageName)
      ?? declaredVersion(manifest, packageName);
    if (version !== null) {
      components.push({ name: packageName, version });
    }
  }

  const now = new Date();
  const buildSha = gitSha ?? "unknown";
  return {
    appVersion,
    buildSha,
    buildShortSha: buildSha === "unknown" ? buildSha : buildSha.slice(0, 8),
    buildDate: gitDate,
    generatedAt: now.toISOString(),
    nodeVersion: process.version,
    ffmpegVersion: parseFfmpegVersion(ffmpegOutput),
    components,
    copyrightYear: now.getUTCFullYear(),
    copyrightName: "wang-yichun",
  };
}
