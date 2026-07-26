import { access, lstat, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptFile), "..");
export const defaultExtensionSource = path.join(
  repositoryRoot,
  "extensions",
  "cocos-playable-packer",
);

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function requireDirectory(directory, label) {
  const info = await lstat(directory).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`${label}不存在或不是目录：${directory}`);
  }
}

export async function validateCreatorProject(projectRoot) {
  const normalized = path.resolve(projectRoot);
  await requireDirectory(normalized, "Cocos Creator 项目目录");
  await requireDirectory(path.join(normalized, "assets"), "项目 assets 目录");

  const projectPackageFile = path.join(normalized, "package.json");
  const packageJson = JSON.parse(await readFile(projectPackageFile, "utf8"));
  if (typeof packageJson !== "object" || packageJson === null || Array.isArray(packageJson)) {
    throw new Error(`项目 package.json 根节点必须是对象：${projectPackageFile}`);
  }
  return normalized;
}

export function extensionTargetForProject(projectRoot) {
  return path.join(path.resolve(projectRoot), "extensions", "cocos-playable-packer");
}

async function linkedTarget(targetPath) {
  const info = await lstat(targetPath).catch(() => null);
  if (info === null || !info.isSymbolicLink()) {
    return null;
  }
  return realpath(targetPath).catch(() => null);
}

export async function linkCreatorExtension(projectRoot, options = {}) {
  const normalizedProjectRoot = await validateCreatorProject(projectRoot);
  const source = path.resolve(options.source ?? defaultExtensionSource);
  await requireDirectory(source, "Creator 插件源目录");

  const target = extensionTargetForProject(normalizedProjectRoot);
  const existing = await lstat(target).catch(() => null);
  if (existing !== null) {
    const currentTarget = await linkedTarget(target);
    const realSource = await realpath(source);
    if (currentTarget !== null && path.resolve(currentTarget) === path.resolve(realSource)) {
      return { status: "already-linked", source, target };
    }
    throw new Error(
      existing.isSymbolicLink()
        ? `目标位置已有其他链接，请先执行 creator:unlink：${target}`
        : `目标位置已有普通目录，拒绝覆盖：${target}`,
    );
  }

  await mkdir(path.dirname(target), { recursive: true });
  await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
  const resolvedTarget = await realpath(target);
  const resolvedSource = await realpath(source);
  if (path.resolve(resolvedTarget) !== path.resolve(resolvedSource)) {
    await rm(target, { force: true });
    throw new Error(`创建链接后的真实路径不一致：${target}`);
  }

  return { status: "linked", source, target };
}

export async function unlinkCreatorExtension(projectRoot) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const target = extensionTargetForProject(normalizedProjectRoot);
  const info = await lstat(target).catch(() => null);
  if (info === null) {
    return { status: "not-linked", target };
  }
  if (!info.isSymbolicLink()) {
    throw new Error(`目标是普通目录，拒绝删除：${target}`);
  }
  await rm(target, { force: true });
  return { status: "unlinked", target };
}

export async function creatorExtensionLinkStatus(projectRoot) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const target = extensionTargetForProject(normalizedProjectRoot);
  const targetExists = await exists(target);
  return {
    target,
    exists: targetExists,
    linkedTo: targetExists ? await linkedTarget(target) : null,
  };
}

function usage() {
  return [
    "Creator 插件开发链接管理",
    "",
    "npm run creator:link -- <Cocos项目目录>",
    "npm run creator:unlink -- <Cocos项目目录>",
    "npm run creator:link:status -- <Cocos项目目录>",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const command = args[0];
  const projectRoot = args[1];
  if (!command || !projectRoot || !["link", "unlink", "status"].includes(command)) {
    throw new Error(usage());
  }

  if (command === "link") {
    const result = await linkCreatorExtension(projectRoot);
    console.log(result.status === "already-linked" ? "Creator 插件链接已存在。" : "Creator 插件链接已创建。");
    console.log(`源目录：${result.source}`);
    console.log(`项目链接：${result.target}`);
    return;
  }

  if (command === "unlink") {
    const result = await unlinkCreatorExtension(projectRoot);
    console.log(result.status === "not-linked" ? "Creator 插件链接不存在。" : "Creator 插件链接已移除。 ");
    console.log(`项目链接：${result.target}`);
    return;
  }

  const result = await creatorExtensionLinkStatus(projectRoot);
  console.log(`项目链接：${result.target}`);
  console.log(`状态：${result.exists ? "存在" : "不存在"}`);
  console.log(`实际目标：${result.linkedTo ?? "-"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
