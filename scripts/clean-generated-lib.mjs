import {
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";

export const ROOT_DIRECTORY_TARGETS = Object.freeze([
  ".packer-web",
  ".tinypng-cache",
  ".squoosh-cache",
  "dist",
  "web-mobile",
]);

export const ROOT_FILE_TARGETS = Object.freeze([
  "scan-report.json",
  "compression-report.json",
  "entry-report.json",
  "module-report.json",
  "resource-optimization-report.json",
  "solid-compression-report.json",
  "encoding-report.json",
  "webp-benchmark-report.json",
  "audio-analysis-report.json",
  "audio-benchmark-report.json",
]);

export const WORKSPACE_DIRECTORY_TARGETS = Object.freeze([
  "runs",
  "reports",
  "preview",
  "backups",
  path.join("manifests", "applications"),
  path.join("manifests", "restores"),
]);

export const WORKSPACE_FILE_TARGETS = Object.freeze([
  path.join("manifests", "latest-application.json"),
  path.join("manifests", "latest-restore.json"),
]);

function isPathInsideRoot(projectRoot, targetPath) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative.length > 0
    && !relative.startsWith(`..${path.sep}`)
    && relative !== ".."
    && !path.isAbsolute(relative);
}

export function assertSafeCleanupTarget(projectRoot, targetPath) {
  if (!isPathInsideRoot(projectRoot, targetPath)) {
    throw new Error(`Refusing to clean path outside the project root: ${targetPath}`);
  }
}

function addExistingTarget(projectRoot, relativePath, targets) {
  const absolutePath = path.resolve(projectRoot, relativePath);
  assertSafeCleanupTarget(projectRoot, absolutePath);
  if (existsSync(absolutePath)) {
    targets.set(absolutePath, {
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath) || ".",
    });
  }
}

export function collectCleanupTargets(projectRoot) {
  const root = path.resolve(projectRoot);
  const targets = new Map();

  for (const relativePath of ROOT_DIRECTORY_TARGETS) {
    addExistingTarget(root, relativePath, targets);
  }
  for (const relativePath of ROOT_FILE_TARGETS) {
    addExistingTarget(root, relativePath, targets);
  }

  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".log")) {
        addExistingTarget(root, entry.name, targets);
      }
    }
  }

  const workspacesRoot = path.join(root, "workspaces");
  if (existsSync(workspacesRoot)) {
    for (const workspace of readdirSync(workspacesRoot, { withFileTypes: true })) {
      if (!workspace.isDirectory()) {
        continue;
      }
      const workspaceRelative = path.join("workspaces", workspace.name);
      for (const relativePath of WORKSPACE_DIRECTORY_TARGETS) {
        addExistingTarget(root, path.join(workspaceRelative, relativePath), targets);
      }
      for (const relativePath of WORKSPACE_FILE_TARGETS) {
        addExistingTarget(root, path.join(workspaceRelative, relativePath), targets);
      }
    }
  }

  return [...targets.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en"));
}

export function calculatePathBytes(targetPath) {
  if (!existsSync(targetPath)) {
    return 0;
  }
  const info = lstatSync(targetPath);
  if (info.isSymbolicLink()) {
    return info.size;
  }
  if (!info.isDirectory()) {
    return info.size;
  }

  let bytes = 0;
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    bytes += calculatePathBytes(path.join(targetPath, entry.name));
  }
  return bytes;
}

export function removeCleanupTargets(projectRoot, targets) {
  const root = path.resolve(projectRoot);
  for (const target of targets) {
    assertSafeCleanupTarget(root, target.absolutePath);
    rmSync(target.absolutePath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}
