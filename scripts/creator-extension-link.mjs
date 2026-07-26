import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptFile), "..");
const GIT_EXCLUDE_MARKER = "# cocos-playable-packer managed Creator extension link";
const GIT_EXCLUDE_PATTERN = "/extensions/cocos-playable-packer";
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

async function resolveGitDirectory(projectRoot) {
  const dotGitPath = path.join(projectRoot, ".git");
  const info = await lstat(dotGitPath).catch(() => null);
  if (info?.isDirectory()) {
    return dotGitPath;
  }
  if (!info?.isFile()) {
    return null;
  }

  const content = await readFile(dotGitPath, "utf8").catch(() => "");
  const match = /^gitdir:\s*(.+)\s*$/im.exec(content);
  return match?.[1] === undefined
    ? null
    : path.resolve(projectRoot, match[1]);
}

async function localGitExcludeFile(projectRoot) {
  const gitDirectory = await resolveGitDirectory(projectRoot);
  return gitDirectory === null
    ? null
    : path.join(gitDirectory, "info", "exclude");
}

async function ensureLocalGitExclude(projectRoot) {
  const excludeFile = await localGitExcludeFile(projectRoot);
  if (excludeFile === null) {
    return null;
  }

  const current = await readFile(excludeFile, "utf8").catch(() => "");
  if (
    current.split(/\r?\n/).some((line) => line.trim() === GIT_EXCLUDE_PATTERN)
  ) {
    return excludeFile;
  }

  const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  await mkdir(path.dirname(excludeFile), { recursive: true });
  await writeFile(
    excludeFile,
    `${prefix}${GIT_EXCLUDE_MARKER}\n${GIT_EXCLUDE_PATTERN}\n`,
    "utf8",
  );
  return excludeFile;
}

async function removeManagedLocalGitExclude(projectRoot) {
  const excludeFile = await localGitExcludeFile(projectRoot);
  if (excludeFile === null) {
    return null;
  }

  const current = await readFile(excludeFile, "utf8").catch(() => null);
  if (current === null || !current.includes(GIT_EXCLUDE_MARKER)) {
    return excludeFile;
  }

  const lines = current.split(/\r?\n/);
  const filtered = [];
  let skipPattern = false;
  for (const line of lines) {
    if (line.trim() === GIT_EXCLUDE_MARKER) {
      skipPattern = true;
      continue;
    }
    if (skipPattern && line.trim() === GIT_EXCLUDE_PATTERN) {
      skipPattern = false;
      continue;
    }
    skipPattern = false;
    filtered.push(line);
  }
  const normalized = filtered.join("\n").replace(/^\n+|\n+$/g, "");
  await writeFile(excludeFile, normalized.length === 0 ? "" : `${normalized}\n`, "utf8");
  return excludeFile;
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
      const gitExcludeFile = await ensureLocalGitExclude(normalizedProjectRoot);
      return { status: "already-linked", source, target, gitExcludeFile };
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

  const gitExcludeFile = await ensureLocalGitExclude(normalizedProjectRoot);
  return { status: "linked", source, target, gitExcludeFile };
}

export async function unlinkCreatorExtension(projectRoot) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const target = extensionTargetForProject(normalizedProjectRoot);
  const info = await lstat(target).catch(() => null);
  if (info === null) {
    const gitExcludeFile = await removeManagedLocalGitExclude(normalizedProjectRoot);
    return { status: "not-linked", target, gitExcludeFile };
  }
  if (!info.isSymbolicLink()) {
    throw new Error(`目标是普通目录，拒绝删除：${target}`);
  }
  await rm(target, { force: true });
  const gitExcludeFile = await removeManagedLocalGitExclude(normalizedProjectRoot);
  return { status: "unlinked", target, gitExcludeFile };
}

export async function creatorExtensionLinkStatus(projectRoot) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const target = extensionTargetForProject(normalizedProjectRoot);
  const targetExists = await exists(target);
  const excludeFile = await localGitExcludeFile(normalizedProjectRoot);
  const excludeContent = excludeFile === null
    ? ""
    : await readFile(excludeFile, "utf8").catch(() => "");
  return {
    target,
    exists: targetExists,
    linkedTo: targetExists ? await linkedTarget(target) : null,
    gitExcludeFile: excludeFile,
    locallyIgnored: excludeContent
      .split(/\r?\n/)
      .some((line) => line.trim() === GIT_EXCLUDE_PATTERN),
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
    console.log(`本地 Git 排除：${result.gitExcludeFile ?? "未检测到 Git 仓库"}`);
    return;
  }

  if (command === "unlink") {
    const result = await unlinkCreatorExtension(projectRoot);
    console.log(result.status === "not-linked" ? "Creator 插件链接不存在。" : "Creator 插件链接已移除。 ");
    console.log(`项目链接：${result.target}`);
    console.log(`本地 Git 排除已清理：${result.gitExcludeFile ?? "未检测到 Git 仓库"}`);
    return;
  }

  const result = await creatorExtensionLinkStatus(projectRoot);
  console.log(`项目链接：${result.target}`);
  console.log(`状态：${result.exists ? "存在" : "不存在"}`);
  console.log(`实际目标：${result.linkedTo ?? "-"}`);
  console.log(`本地 Git 排除：${result.locallyIgnored ? "已启用" : "未启用"}`);
  console.log(`排除文件：${result.gitExcludeFile ?? "-"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
