import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { inspectJpeg } from "./optimize-build-jpegs.js";

type PlanAction =
  | "apply"
  | "keep-below-threshold"
  | "keep-source"
  | "already-applied";

type JsonObject = Record<string, unknown>;

interface CliOptions {
  buildDirectory: string;
  reportPath: string;
  confirm: boolean;
  minimumSavingsBytes: number;
  minimumSavingsPercent: number;
}

interface JpegReportFile {
  relativePath: string;
  currentSha256: string;
  currentBytes: number;
  action: string;
  finalBytes: number;
  savedBytes: number;
  savedPercent: number;
  outputSha256: string | null;
}

interface JpegOptimizerReport {
  tool: "squoosh-build-jpeg-optimizer";
  status: "preview" | "applied";
  buildDirectory: string;
  cacheDirectory: string;
  options: {
    quality: number;
    profileKey: string;
  };
  files: JpegReportFile[];
}

interface PlanEntry {
  relativePath: string;
  action: PlanAction;
  currentSha256: string;
  currentBytes: number;
  finalBytes: number;
  savedBytes: number;
  savedPercent: number;
  targetPath: string;
  candidatePath: string | null;
  backupPath: string | null;
}

interface ApplyManifest {
  schemaVersion: 1;
  tool: "squoosh-apply-build-jpeg-cache";
  status: "preview" | "applied" | "rolled-back" | "failed";
  createdAt: string;
  completedAt: string | null;
  buildDirectory: string;
  reportPath: string;
  profileKey: string;
  backupDirectory: string | null;
  confirm: boolean;
  policy: {
    minimumSavingsBytes: number;
    minimumSavingsPercent: number;
  };
  summary: {
    reportFiles: number;
    apply: number;
    keepBelowThreshold: number;
    keepSource: number;
    alreadyApplied: number;
    sourceBytesBefore: number;
    finalBytesAfter: number;
    savedBytes: number;
    savedPercent: number;
  };
  entries: PlanEntry[];
  error?: string;
}

const COMPRESSED_ACTIONS = new Set([
  "processed-compressed",
  "cache-compressed",
]);

function usage(): string {
  return [
    "应用 Squoosh JPEG 缓存",
    "",
    "npm run squoosh:apply-build-jpegs -- <构建目录> --report=<报告> [--confirm]",
    "",
    "选项：",
    "  --min-savings-bytes=128    最低绝对收益，默认 128 B",
    "  --min-savings-percent=1    最低相对收益，默认 1%",
    "",
    "只有同时达到两个门槛的有损 JPEG 输出才会替换源文件。",
  ].join("\n");
}

function integer(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return parsed;
}

function decimal(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的数字。`);
  }
  return parsed;
}

export function parseJpegApplyArguments(
  argv: readonly string[],
): CliOptions {
  const args = argv.filter((argument) => argument !== "--");
  let buildDirectory: string | null = null;
  let reportPath: string | null = null;
  let confirm = false;
  let minimumSavingsBytes = 128;
  let minimumSavingsPercent = 1;

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--confirm") {
      confirm = true;
      continue;
    }
    if (argument.startsWith("--report=")) {
      reportPath = argument.slice("--report=".length);
      continue;
    }
    if (argument.startsWith("--min-savings-bytes=")) {
      minimumSavingsBytes = integer(
        argument.slice("--min-savings-bytes=".length),
        "--min-savings-bytes",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      continue;
    }
    if (argument.startsWith("--min-savings-percent=")) {
      minimumSavingsPercent = decimal(
        argument.slice("--min-savings-percent=".length),
        "--min-savings-percent",
        0,
        100,
      );
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`无法识别的参数：${argument}`);
    }
    if (buildDirectory !== null) {
      throw new Error(`只允许传入一个构建目录，额外参数：${argument}`);
    }
    buildDirectory = argument;
  }

  if (buildDirectory === null || reportPath === null) {
    throw new Error(`${usage()}\n\n缺少构建目录或 --report。`);
  }

  return {
    buildDirectory: path.resolve(buildDirectory),
    reportPath: path.resolve(reportPath),
    confirm,
    minimumSavingsBytes,
    minimumSavingsPercent,
  };
}

export function hasMeaningfulJpegSavings(
  savedBytes: number,
  savedPercent: number,
  minimumSavingsBytes: number,
  minimumSavingsPercent: number,
): boolean {
  return (
    savedBytes >= minimumSavingsBytes &&
    savedPercent >= minimumSavingsPercent
  );
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator * 100;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function replaceFile(
  temporaryPath: string,
  targetPath: string,
): Promise<void> {
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String(error.code)
      : "";
    if (code !== "EEXIST" && code !== "EPERM") {
      throw error;
    }
    await rm(targetPath, { force: true });
    await rename(temporaryPath, targetPath);
  }
}

async function writeBufferAtomically(
  filePath: string,
  buffer: Buffer,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, buffer);
    await replaceFile(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeJsonAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeBufferAtomically(
    filePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  );
}

function requireJpegReport(value: unknown, source: string): JpegOptimizerReport {
  if (!isJsonObject(value) || value.tool !== "squoosh-build-jpeg-optimizer") {
    throw new Error(`报告类型不正确：${source}`);
  }
  const report = value as unknown as JpegOptimizerReport;
  if (
    !Array.isArray(report.files) ||
    typeof report.buildDirectory !== "string" ||
    typeof report.cacheDirectory !== "string" ||
    typeof report.options?.profileKey !== "string"
  ) {
    throw new Error(`JPEG 报告结构不完整：${source}`);
  }
  return report;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function createPlan(
  options: CliOptions,
  report: JpegOptimizerReport,
  backupDirectory: string,
): Promise<PlanEntry[]> {
  const entries: PlanEntry[] = [];

  for (const file of report.files) {
    const targetPath = path.join(
      options.buildDirectory,
      ...file.relativePath.split("/"),
    );
    const targetInfo = await stat(targetPath).catch(() => null);
    if (!targetInfo?.isFile() || targetInfo.size !== file.currentBytes) {
      throw new Error(`JPEG 当前文件体积已变化：${file.relativePath}`);
    }
    const targetBuffer = await readFile(targetPath);
    if (sha256(targetBuffer) !== file.currentSha256) {
      throw new Error(`JPEG 当前文件 SHA 已变化：${file.relativePath}`);
    }

    if (file.action === "already-applied") {
      entries.push({
        relativePath: file.relativePath,
        action: "already-applied",
        currentSha256: file.currentSha256,
        currentBytes: file.currentBytes,
        finalBytes: file.currentBytes,
        savedBytes: 0,
        savedPercent: 0,
        targetPath,
        candidatePath: null,
        backupPath: null,
      });
      continue;
    }

    if (!COMPRESSED_ACTIONS.has(file.action) || file.outputSha256 === null) {
      entries.push({
        relativePath: file.relativePath,
        action: "keep-source",
        currentSha256: file.currentSha256,
        currentBytes: file.currentBytes,
        finalBytes: file.currentBytes,
        savedBytes: 0,
        savedPercent: 0,
        targetPath,
        candidatePath: null,
        backupPath: null,
      });
      continue;
    }

    if (!hasMeaningfulJpegSavings(
      file.savedBytes,
      file.savedPercent,
      options.minimumSavingsBytes,
      options.minimumSavingsPercent,
    )) {
      entries.push({
        relativePath: file.relativePath,
        action: "keep-below-threshold",
        currentSha256: file.currentSha256,
        currentBytes: file.currentBytes,
        finalBytes: file.currentBytes,
        savedBytes: 0,
        savedPercent: 0,
        targetPath,
        candidatePath: null,
        backupPath: null,
      });
      continue;
    }

    const candidatePath = path.join(
      report.cacheDirectory,
      "outputs",
      `${file.currentSha256}.jpg`,
    );
    const candidateInfo = await stat(candidatePath).catch(() => null);
    if (!candidateInfo?.isFile() || candidateInfo.size !== file.finalBytes) {
      throw new Error(`JPEG 缓存候选体积无效：${file.relativePath}`);
    }
    const candidateBuffer = await readFile(candidatePath);
    if (sha256(candidateBuffer) !== file.outputSha256) {
      throw new Error(`JPEG 缓存候选 SHA 无效：${file.relativePath}`);
    }
    const sourceMetadata = inspectJpeg(targetBuffer);
    const candidateMetadata = inspectJpeg(candidateBuffer);
    if (
      sourceMetadata.width !== candidateMetadata.width ||
      sourceMetadata.height !== candidateMetadata.height
    ) {
      throw new Error(`JPEG 缓存候选尺寸不一致：${file.relativePath}`);
    }

    entries.push({
      relativePath: file.relativePath,
      action: "apply",
      currentSha256: file.currentSha256,
      currentBytes: file.currentBytes,
      finalBytes: file.finalBytes,
      savedBytes: file.savedBytes,
      savedPercent: file.savedPercent,
      targetPath,
      candidatePath,
      backupPath: path.join(
        backupDirectory,
        ...file.relativePath.split("/"),
      ),
    });
  }

  return entries;
}

async function applyPlan(entries: readonly PlanEntry[]): Promise<void> {
  const applied: PlanEntry[] = [];
  try {
    for (const entry of entries) {
      if (
        entry.action !== "apply" ||
        entry.candidatePath === null ||
        entry.backupPath === null
      ) {
        continue;
      }
      await mkdir(path.dirname(entry.backupPath), { recursive: true });
      await copyFile(entry.targetPath, entry.backupPath);
      await writeBufferAtomically(
        entry.targetPath,
        await readFile(entry.candidatePath),
      );
      applied.push(entry);
    }
  } catch (error) {
    for (const entry of applied.reverse()) {
      if (entry.backupPath !== null) {
        await copyFile(entry.backupPath, entry.targetPath).catch(() => undefined);
      }
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseJpegApplyArguments(process.argv.slice(2));
  const rawReport: unknown = JSON.parse(await readFile(options.reportPath, "utf8"));
  const report = requireJpegReport(rawReport, options.reportPath);
  if (!samePath(report.buildDirectory, options.buildDirectory)) {
    throw new Error(
      `报告构建目录不匹配：${report.buildDirectory} != ${options.buildDirectory}`,
    );
  }

  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[-:.]/g, "");
  const manifestDirectory = path.join(report.cacheDirectory, "manifests");
  const backupDirectory = path.join(
    report.cacheDirectory,
    "backups",
    timestamp,
  );
  const entries = await createPlan(options, report, backupDirectory);
  const sourceBytesBefore = entries.reduce(
    (total, entry) => total + entry.currentBytes,
    0,
  );
  const finalBytesAfter = entries.reduce(
    (total, entry) => total + entry.finalBytes,
    0,
  );
  const savedBytes = sourceBytesBefore - finalBytesAfter;
  const manifest: ApplyManifest = {
    schemaVersion: 1,
    tool: "squoosh-apply-build-jpeg-cache",
    status: options.confirm ? "applied" : "preview",
    createdAt,
    completedAt: null,
    buildDirectory: options.buildDirectory,
    reportPath: options.reportPath,
    profileKey: report.options.profileKey,
    backupDirectory: options.confirm && entries.some((entry) => entry.action === "apply")
      ? backupDirectory
      : null,
    confirm: options.confirm,
    policy: {
      minimumSavingsBytes: options.minimumSavingsBytes,
      minimumSavingsPercent: options.minimumSavingsPercent,
    },
    summary: {
      reportFiles: entries.length,
      apply: entries.filter((entry) => entry.action === "apply").length,
      keepBelowThreshold: entries.filter(
        (entry) => entry.action === "keep-below-threshold",
      ).length,
      keepSource: entries.filter((entry) => entry.action === "keep-source").length,
      alreadyApplied: entries.filter(
        (entry) => entry.action === "already-applied",
      ).length,
      sourceBytesBefore,
      finalBytesAfter,
      savedBytes,
      savedPercent: percentage(savedBytes, sourceBytesBefore),
    },
    entries,
  };

  const latestManifestPath = path.join(manifestDirectory, "latest.json");
  const archiveManifestPath = path.join(
    manifestDirectory,
    `manifest-${timestamp}.json`,
  );

  try {
    if (options.confirm) {
      await applyPlan(entries);
    }
    manifest.completedAt = new Date().toISOString();
    await writeJsonAtomically(latestManifestPath, manifest);
    await writeJsonAtomically(archiveManifestPath, manifest);
  } catch (error) {
    manifest.status = "failed";
    manifest.completedAt = new Date().toISOString();
    manifest.error = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeJsonAtomically(latestManifestPath, manifest).catch(() => undefined);
    throw error;
  }

  console.log("");
  console.log("Squoosh JPEG 应用计划完成");
  console.log("------------------------");
  console.log(`模式：${options.confirm ? "已应用" : "预览"}`);
  console.log(`可应用：${manifest.summary.apply}`);
  console.log(`低收益保留原图：${manifest.summary.keepBelowThreshold}`);
  console.log(`无收益保留原图：${manifest.summary.keepSource}`);
  console.log(`已应用：${manifest.summary.alreadyApplied}`);
  console.log(`预计减少：${savedBytes} B (${manifest.summary.savedPercent.toFixed(2)}%)`);
  console.log(`清单：${latestManifestPath}`);
}

const entryFile = process.argv[1];
if (
  entryFile !== undefined &&
  import.meta.url === pathToFileURL(entryFile).href
) {
  main().catch((error: unknown) => {
    console.error("");
    console.error("Squoosh JPEG 应用失败");
    console.error("--------------------");
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
