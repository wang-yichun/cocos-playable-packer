import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

type LocalAction =
  | "processed-compressed"
  | "cache-compressed"
  | string;

interface PngInfo {
  width: number;
  height: number;
}

interface LocalResult {
  action: LocalAction;
  sourceSha256: string;
  sourceBytes: number;
  finalBytes: number;
  outputSha256: string | null;
  outputPath: string | null;
  png: PngInfo;
  message?: string;
}

interface BenchmarkFileEntry {
  relativePath: string;
  duplicateSource: boolean;
  sourceSha256: string;
  sourceBytes: number;
  png: PngInfo;
  local: LocalResult;
}

interface BenchmarkReport {
  schemaVersion: number;
  tool: string;
  startedAt: string;
  completedAt: string;
  buildDirectory: string;
  cacheDirectory: string;
  options: {
    profileKey: string;
  };
  summary: {
    scannedPngFiles: number;
    uniqueSourceImages: number;
    localCompressedUnique: number;
    localNoBenefitUnique: number;
    localSkippedBelowMinBytesUnique: number;
    localSkippedByLimitUnique: number;
    localFailedUnique: number;
    localCacheInvalidUnique: number;
    localPolicyComplete: boolean;
    localFinalBytesForAllFiles: number;
    localSavedBytesForAllFiles: number;
    localSavedPercentForAllFiles: number;
  };
  files: BenchmarkFileEntry[];
}

type PlanAction = "apply" | "already-applied" | "keep-source";

interface PlanEntry {
  relativePath: string;
  action: PlanAction;
  sourceSha256: string;
  sourceBytes: number;
  currentSha256: string;
  currentBytes: number;
  outputSha256: string | null;
  outputBytes: number;
  targetPath: string;
  candidatePath: string | null;
  backupPath: string | null;
}

interface ApplyManifest {
  schemaVersion: 1;
  tool: "squoosh-apply-build-png-cache";
  status: "preview" | "applied" | "rolled-back" | "failed";
  createdAt: string;
  completedAt: string | null;
  buildDirectory: string;
  reportPath: string;
  profileKey: string;
  backupDirectory: string;
  confirm: boolean;
  summary: {
    reportFiles: number;
    apply: number;
    alreadyApplied: number;
    keepSource: number;
    sourceBytesBefore: number;
    finalBytesAfter: number;
    savedBytes: number;
    savedPercent: number;
  };
  entries: PlanEntry[];
  error?: string;
}

interface CliOptions {
  buildDirectory: string;
  reportPath: string | null;
  confirm: boolean;
}

const COMPRESSED_ACTIONS = new Set<string>([
  "processed-compressed",
  "cache-compressed",
]);

function parseArgs(argv: string[]): CliOptions {
  const args = argv.filter((arg) => arg !== "--");
  let buildDirectory: string | null = null;
  let reportPath: string | null = null;
  let confirm = false;

  for (const arg of args) {
    if (arg === "--confirm") {
      confirm = true;
      continue;
    }

    if (arg.startsWith("--report=")) {
      reportPath = arg.slice("--report=".length);
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`无法识别的参数：${arg}`);
    }

    if (buildDirectory !== null) {
      throw new Error(`只允许传入一个构建目录，额外参数：${arg}`);
    }

    buildDirectory = arg;
  }

  if (buildDirectory === null) {
    throw new Error(
      [
        "缺少构建目录。",
        "示例：",
        'npm run squoosh:apply-build-pngs -- -- "./web-mobile"',
      ].join("\n"),
    );
  }

  return {
    buildDirectory: path.resolve(buildDirectory),
    reportPath: reportPath === null ? null : path.resolve(reportPath),
    confirm,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(2)} KiB`;
  }

  return `${(kib / 1024).toFixed(2)} MiB`;
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
}

async function findLatestReport(projectRoot: string): Promise<string> {
  const baseDirectory = path.join(
    projectRoot,
    ".squoosh-cache",
    "build-pngs",
  );

  if (!(await exists(baseDirectory))) {
    throw new Error(`找不到 Squoosh 缓存目录：${baseDirectory}`);
  }

  const profileDirectories = await readdir(baseDirectory, {
    withFileTypes: true,
  });

  const candidates: Array<{ filePath: string; modifiedMs: number }> = [];

  for (const entry of profileDirectories) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = path.join(
      baseDirectory,
      entry.name,
      "reports",
      "latest.json",
    );

    if (!(await exists(candidate))) {
      continue;
    }

    const candidateStat = await stat(candidate);
    candidates.push({
      filePath: candidate,
      modifiedMs: candidateStat.mtimeMs,
    });
  }

  candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);

  const latest = candidates[0];
  if (latest === undefined) {
    throw new Error(
      `没有找到任何 reports/latest.json：${baseDirectory}`,
    );
  }

  return latest.filePath;
}

async function loadReport(reportPath: string): Promise<BenchmarkReport> {
  const raw = await readFile(reportPath, "utf8");
  const report = JSON.parse(raw) as BenchmarkReport;

  if (report.tool !== "squoosh-build-png-benchmark") {
    throw new Error(
      `报告类型不正确：${report.tool ?? "unknown"}`,
    );
  }

  if (!Array.isArray(report.files)) {
    throw new Error("报告缺少 files 数组。");
  }

  return report;
}

function validateReportPolicy(report: BenchmarkReport): void {
  const summary = report.summary;

  if (!summary.localPolicyComplete) {
    throw new Error(
      "当前报告不是完整策略结果。请先使用 --all 生成完整基准缓存。",
    );
  }

  const blockingValues = [
    ["localSkippedBelowMinBytesUnique", summary.localSkippedBelowMinBytesUnique],
    ["localSkippedByLimitUnique", summary.localSkippedByLimitUnique],
    ["localFailedUnique", summary.localFailedUnique],
    ["localCacheInvalidUnique", summary.localCacheInvalidUnique],
  ] as const;

  const blocking = blockingValues.filter(([, value]) => value !== 0);

  if (blocking.length > 0) {
    throw new Error(
      [
        "报告仍包含不可应用状态：",
        ...blocking.map(([name, value]) => `- ${name}: ${value}`),
      ].join("\n"),
    );
  }
}

async function findExistingCandidatePath(
  projectRoot: string,
  report: BenchmarkReport,
  entry: BenchmarkFileEntry,
): Promise<string> {
  const outputSha256 = entry.local.outputSha256;

  if (outputSha256 === null) {
    throw new Error(
      `${entry.relativePath} 缺少 outputSha256。`,
    );
  }

  const candidates: string[] = [];

  if (entry.local.outputPath !== null) {
    candidates.push(path.resolve(entry.local.outputPath));
  }

  candidates.push(
    path.join(
      path.resolve(report.cacheDirectory),
      "files",
      outputSha256.slice(0, 2),
      `${outputSha256}.png`,
    ),
  );

  candidates.push(
    path.join(
      projectRoot,
      ".squoosh-cache",
      "build-pngs",
      report.options.profileKey,
      "files",
      outputSha256.slice(0, 2),
      `${outputSha256}.png`,
    ),
  );

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      `${entry.relativePath} 找不到缓存输出。`,
      ...candidates.map((candidate) => `- ${candidate}`),
    ].join("\n"),
  );
}

async function buildPlan(
  projectRoot: string,
  buildDirectory: string,
  report: BenchmarkReport,
  backupDirectory: string,
): Promise<PlanEntry[]> {
  const plan: PlanEntry[] = [];
  const errors: string[] = [];

  for (const entry of report.files) {
    const relativePath = entry.relativePath.replaceAll("/", path.sep);
    const targetPath = path.resolve(buildDirectory, relativePath);

    if (!targetPath.startsWith(`${buildDirectory}${path.sep}`)) {
      errors.push(`${entry.relativePath} 解析后超出构建目录。`);
      continue;
    }

    if (!(await exists(targetPath))) {
      errors.push(`${entry.relativePath} 在构建目录中不存在。`);
      continue;
    }

    const targetStat = await stat(targetPath);
    const currentSha256 = await hashFile(targetPath);

    if (
      entry.local.outputSha256 === null ||
      !COMPRESSED_ACTIONS.has(entry.local.action)
    ) {
      if (
        currentSha256 !== entry.sourceSha256 ||
        targetStat.size !== entry.sourceBytes
      ) {
        errors.push(
          `${entry.relativePath} 应保留原图，但当前文件已发生变化。`,
        );
        continue;
      }

      plan.push({
        relativePath: entry.relativePath,
        action: "keep-source",
        sourceSha256: entry.sourceSha256,
        sourceBytes: entry.sourceBytes,
        currentSha256,
        currentBytes: targetStat.size,
        outputSha256: null,
        outputBytes: entry.sourceBytes,
        targetPath,
        candidatePath: null,
        backupPath: null,
      });
      continue;
    }

    if (currentSha256 === entry.local.outputSha256) {
      if (targetStat.size !== entry.local.finalBytes) {
        errors.push(
          `${entry.relativePath} SHA 已是缓存输出，但文件大小不一致。`,
        );
        continue;
      }

      plan.push({
        relativePath: entry.relativePath,
        action: "already-applied",
        sourceSha256: entry.sourceSha256,
        sourceBytes: entry.sourceBytes,
        currentSha256,
        currentBytes: targetStat.size,
        outputSha256: entry.local.outputSha256,
        outputBytes: entry.local.finalBytes,
        targetPath,
        candidatePath: null,
        backupPath: null,
      });
      continue;
    }

    if (
      currentSha256 !== entry.sourceSha256 ||
      targetStat.size !== entry.sourceBytes
    ) {
      errors.push(
        [
          `${entry.relativePath} 当前文件不是报告中的原图，也不是已应用输出。`,
          `  报告原图：${entry.sourceSha256} / ${entry.sourceBytes} B`,
          `  当前文件：${currentSha256} / ${targetStat.size} B`,
        ].join("\n"),
      );
      continue;
    }

    const candidatePath = await findExistingCandidatePath(
      projectRoot,
      report,
      entry,
    );

    const candidateStat = await stat(candidatePath);
    const candidateSha256 = await hashFile(candidatePath);

    if (candidateSha256 !== entry.local.outputSha256) {
      errors.push(
        `${entry.relativePath} 缓存 SHA 校验失败：${candidatePath}`,
      );
      continue;
    }

    if (candidateStat.size !== entry.local.finalBytes) {
      errors.push(
        `${entry.relativePath} 缓存大小校验失败：${candidatePath}`,
      );
      continue;
    }

    const backupPath = path.resolve(
      backupDirectory,
      entry.relativePath.replaceAll("/", path.sep),
    );

    plan.push({
      relativePath: entry.relativePath,
      action: "apply",
      sourceSha256: entry.sourceSha256,
      sourceBytes: entry.sourceBytes,
      currentSha256,
      currentBytes: targetStat.size,
      outputSha256: candidateSha256,
      outputBytes: candidateStat.size,
      targetPath,
      candidatePath,
      backupPath,
    });
  }

  if (errors.length > 0) {
    throw new Error(
      [
        `应用计划校验失败，共 ${errors.length} 项：`,
        ...errors.slice(0, 20).map((error) => `- ${error}`),
        ...(errors.length > 20
          ? [`- 其余 ${errors.length - 20} 项已省略。`]
          : []),
      ].join("\n"),
    );
  }

  return plan;
}

async function replaceFileAtomically(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const directory = path.dirname(targetPath);
  const suffix = `${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  const newPath = path.join(
    directory,
    `.${path.basename(targetPath)}.squoosh-new-${suffix}`,
  );
  const oldPath = path.join(
    directory,
    `.${path.basename(targetPath)}.squoosh-old-${suffix}`,
  );

  await copyFile(sourcePath, newPath);

  let movedOld = false;
  try {
    await rename(targetPath, oldPath);
    movedOld = true;

    await rename(newPath, targetPath);
    await rm(oldPath, { force: true });
  } catch (error) {
    await rm(newPath, { force: true }).catch(() => undefined);

    if (movedOld && !(await exists(targetPath)) && (await exists(oldPath))) {
      await rename(oldPath, targetPath).catch(() => undefined);
    }

    throw error;
  } finally {
    await rm(oldPath, { force: true }).catch(() => undefined);
  }
}

function createManifest(
  reportPath: string,
  report: BenchmarkReport,
  buildDirectory: string,
  backupDirectory: string,
  confirm: boolean,
  plan: PlanEntry[],
): ApplyManifest {
  const sourceBytesBefore = plan.reduce(
    (total, entry) => total + entry.sourceBytes,
    0,
  );
  const finalBytesAfter = plan.reduce(
    (total, entry) => total + entry.outputBytes,
    0,
  );
  const savedBytes = sourceBytesBefore - finalBytesAfter;

  return {
    schemaVersion: 1,
    tool: "squoosh-apply-build-png-cache",
    status: confirm ? "failed" : "preview",
    createdAt: new Date().toISOString(),
    completedAt: null,
    buildDirectory,
    reportPath,
    profileKey: report.options.profileKey,
    backupDirectory,
    confirm,
    summary: {
      reportFiles: plan.length,
      apply: plan.filter((entry) => entry.action === "apply").length,
      alreadyApplied: plan.filter(
        (entry) => entry.action === "already-applied",
      ).length,
      keepSource: plan.filter((entry) => entry.action === "keep-source")
        .length,
      sourceBytesBefore,
      finalBytesAfter,
      savedBytes,
      savedPercent:
        sourceBytesBefore === 0
          ? 0
          : (savedBytes / sourceBytesBefore) * 100,
    },
    entries: plan,
  };
}

async function writeManifest(
  manifestPath: string,
  manifest: ApplyManifest,
): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function applyPlan(
  plan: PlanEntry[],
  manifest: ApplyManifest,
  manifestPath: string,
): Promise<void> {
  const applied: PlanEntry[] = [];

  try {
    for (const entry of plan) {
      if (
        entry.action !== "apply" ||
        entry.candidatePath === null ||
        entry.backupPath === null
      ) {
        continue;
      }

      await mkdir(path.dirname(entry.backupPath), { recursive: true });
      await copyFile(entry.targetPath, entry.backupPath);
      await replaceFileAtomically(entry.candidatePath, entry.targetPath);

      const finalStat = await stat(entry.targetPath);
      const finalSha256 = await hashFile(entry.targetPath);

      if (
        finalSha256 !== entry.outputSha256 ||
        finalStat.size !== entry.outputBytes
      ) {
        throw new Error(
          `${entry.relativePath} 替换后校验失败。`,
        );
      }

      applied.push(entry);
    }

    manifest.status = "applied";
    manifest.completedAt = new Date().toISOString();
    await writeManifest(manifestPath, manifest);
  } catch (error) {
    const rollbackErrors: string[] = [];

    for (const entry of applied.reverse()) {
      if (entry.backupPath === null) {
        continue;
      }

      try {
        await replaceFileAtomically(entry.backupPath, entry.targetPath);
      } catch (rollbackError) {
        rollbackErrors.push(
          `${entry.relativePath}: ${String(rollbackError)}`,
        );
      }
    }

    manifest.status =
      rollbackErrors.length === 0 ? "rolled-back" : "failed";
    manifest.completedAt = new Date().toISOString();
    manifest.error = [
      String(error),
      ...(rollbackErrors.length > 0
        ? ["回滚错误：", ...rollbackErrors]
        : ["已自动回滚本轮已替换文件。"]),
    ].join("\n");

    await writeManifest(manifestPath, manifest);
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();

  if (!(await exists(options.buildDirectory))) {
    throw new Error(
      `构建目录不存在：${options.buildDirectory}`,
    );
  }

  const reportPath =
    options.reportPath ?? (await findLatestReport(projectRoot));
  const report = await loadReport(reportPath);
  validateReportPolicy(report);

  const timestamp = createTimestamp();
  const profileCacheDirectory = path.join(
    projectRoot,
    ".squoosh-cache",
    "build-pngs",
    report.options.profileKey,
  );
  const backupDirectory = path.join(
    profileCacheDirectory,
    "backups",
    timestamp,
  );
  const manifestPath = path.join(
    profileCacheDirectory,
    "apply-manifests",
    `apply-${timestamp}.json`,
  );

  console.log("Squoosh 构建 PNG 应用预检");
  console.log("-------------------------");
  console.log(`构建目录：${options.buildDirectory}`);
  console.log(`基准报告：${reportPath}`);
  console.log(`配置档案：${report.options.profileKey}`);

  const plan = await buildPlan(
    projectRoot,
    options.buildDirectory,
    report,
    backupDirectory,
  );

  const manifest = createManifest(
    reportPath,
    report,
    options.buildDirectory,
    backupDirectory,
    options.confirm,
    plan,
  );

  await writeManifest(manifestPath, manifest);

  console.log(`报告文件数量：${manifest.summary.reportFiles}`);
  console.log(`可应用：${manifest.summary.apply}`);
  console.log(`已应用：${manifest.summary.alreadyApplied}`);
  console.log(`保留原图：${manifest.summary.keepSource}`);
  console.log(
    `应用前体积：${formatBytes(manifest.summary.sourceBytesBefore)}`,
  );
  console.log(
    `应用后体积：${formatBytes(manifest.summary.finalBytesAfter)}`,
  );
  console.log(
    `预计减少：${formatBytes(manifest.summary.savedBytes)} ` +
      `(${manifest.summary.savedPercent.toFixed(2)}%)`,
  );
  console.log(`备份目录：${backupDirectory}`);
  console.log(`应用清单：${manifestPath}`);

  if (!options.confirm) {
    console.log("");
    console.log("当前仅生成计划，没有修改构建目录。");
    console.log("确认后重新执行同一命令并追加 --confirm。");
    return;
  }

  await applyPlan(plan, manifest, manifestPath);

  console.log("");
  console.log("Squoosh 构建 PNG 已应用");
  console.log("----------------------");
  console.log(`实际替换：${manifest.summary.apply}`);
  console.log(`已经应用：${manifest.summary.alreadyApplied}`);
  console.log(`完整备份：${backupDirectory}`);
  console.log(`应用清单：${manifestPath}`);
}

main().catch((error: unknown) => {
  console.error("");
  console.error("Squoosh 构建 PNG 应用失败");
  console.error("-------------------------");
  console.error(
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
  process.exitCode = 1;
});
