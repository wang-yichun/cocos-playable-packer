import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

type Mode = "none" | "tinypng" | "squoosh";
type TinyMode = { type: "all" } | { type: "limit"; limit: number };

interface Options {
  buildDirectory: string;
  mode: Mode;
  preview: boolean;
  tinyMode: TinyMode | null;
  minBytes: number | null;
  quality: number;
  colours: number;
  effort: number;
  dither: number;
  oxipngLevel: number;
}

interface ReportFile {
  relativePath: string;
  sourceSha256: string;
  local: {
    action: string;
    outputSha256: string | null;
  };
}

interface SquooshReport {
  tool: "squoosh-build-png-benchmark";
  completedAt: string;
  options: {
    profileKey: string;
  };
  summary: {
    localPolicyComplete: boolean;
    localSkippedBelowMinBytesUnique: number;
    localSkippedByLimitUnique: number;
    localFailedUnique: number;
    localCacheInvalidUnique: number;
  };
  files: ReportFile[];
}

interface BuildFile {
  relativePath: string;
  absolutePath: string;
  sha256: string;
}

const COMPRESSED_ACTIONS = new Set([
  "processed-compressed",
  "cache-compressed",
]);

function usage(): string {
  return [
    "统一构建图片优化入口",
    "",
    "npm run images:optimize -- -- <构建目录> --mode=none",
    "npm run images:optimize -- -- <构建目录> --mode=tinypng --all",
    "npm run images:optimize -- -- <构建目录> --mode=tinypng --limit=5",
    "npm run images:optimize -- -- <构建目录> --mode=squoosh [--preview]",
    "",
    "Squoosh 参数：",
    "  --quality=80 --colours=256 --effort=10",
    "  --dither=0.5 --oxipng-level=3 --min-bytes=0",
  ].join("\n");
}

function integer(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return result;
}

function decimal(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的数字。`);
  }
  return result;
}

function parseArguments(argv: readonly string[]): Options {
  const args = argv.filter((argument) => argument !== "--");
  let buildDirectory: string | null = null;
  let mode: Mode | null = null;
  let preview = false;
  let tinyMode: TinyMode | null = null;
  let minBytes: number | null = null;
  let quality = 80;
  let colours = 256;
  let effort = 10;
  let dither = 0.5;
  let oxipngLevel = 3;

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--preview") {
      preview = true;
      continue;
    }
    if (argument === "--all") {
      if (tinyMode !== null) {
        throw new Error("--all 与 --limit 不能同时使用。");
      }
      tinyMode = { type: "all" };
      continue;
    }
    if (argument.startsWith("--limit=")) {
      if (tinyMode !== null) {
        throw new Error("--all 与 --limit 不能同时使用。");
      }
      tinyMode = {
        type: "limit",
        limit: integer(
          argument.slice("--limit=".length),
          "--limit",
          0,
          Number.MAX_SAFE_INTEGER,
        ),
      };
      continue;
    }
    if (argument.startsWith("--mode=")) {
      const value = argument.slice("--mode=".length);
      if (value !== "none" && value !== "tinypng" && value !== "squoosh") {
        throw new Error(`无效图片模式：${value}`);
      }
      mode = value;
      continue;
    }
    if (argument.startsWith("--min-bytes=")) {
      minBytes = integer(
        argument.slice("--min-bytes=".length),
        "--min-bytes",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      continue;
    }
    if (argument.startsWith("--quality=")) {
      quality = integer(argument.slice("--quality=".length), "--quality", 0, 100);
      continue;
    }
    if (argument.startsWith("--colours=")) {
      colours = integer(argument.slice("--colours=".length), "--colours", 2, 256);
      continue;
    }
    if (argument.startsWith("--effort=")) {
      effort = integer(argument.slice("--effort=".length), "--effort", 1, 10);
      continue;
    }
    if (argument.startsWith("--dither=")) {
      dither = decimal(argument.slice("--dither=".length), "--dither", 0, 1);
      continue;
    }
    if (argument.startsWith("--oxipng-level=")) {
      oxipngLevel = integer(
        argument.slice("--oxipng-level=".length),
        "--oxipng-level",
        1,
        6,
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

  if (buildDirectory === null || mode === null) {
    throw new Error(`${usage()}\n\n缺少构建目录或 --mode。`);
  }
  if (preview && mode !== "squoosh") {
    throw new Error("--preview 只适用于 Squoosh 模式。");
  }
  if (mode === "tinypng" && tinyMode === null) {
    throw new Error(
      "TinyPNG 模式必须显式指定 --all 或 --limit=N，避免意外消耗 API 配额。",
    );
  }
  if (mode !== "tinypng" && tinyMode !== null) {
    throw new Error("--all 与 --limit 只适用于 TinyPNG 模式。");
  }
  if (mode === "squoosh" && minBytes !== null && minBytes !== 0) {
    throw new Error(
      "Squoosh 生产应用目前要求 --min-bytes=0，确保完整报告覆盖全部 PNG。",
    );
  }

  return {
    buildDirectory: path.resolve(buildDirectory),
    mode,
    preview,
    tinyMode,
    minBytes,
    quality,
    colours,
    effort,
    dither,
    oxipngLevel,
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

async function validateBuildDirectory(buildDirectory: string): Promise<void> {
  const info = await stat(buildDirectory).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`构建目录不存在：${buildDirectory}`);
  }
  if (!(await exists(path.join(buildDirectory, "index.html")))) {
    throw new Error(`构建目录缺少 index.html：${buildDirectory}`);
  }
}

function portable(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

async function collectPngFiles(buildDirectory: string): Promise<BuildFile[]> {
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        paths.push(absolutePath);
      }
    }
  }

  await visit(buildDirectory);
  paths.sort((left, right) => left.localeCompare(right));

  return Promise.all(
    paths.map(async (absolutePath) => ({
      absolutePath,
      relativePath: portable(path.relative(buildDirectory, absolutePath)),
      sha256: createHash("sha256")
        .update(await readFile(absolutePath))
        .digest("hex"),
    })),
  );
}

function profileKey(options: Options): string {
  const ditherKey = String(options.dither).replace(".", "p").replace("-", "m");
  return [
    `q${options.quality}`,
    `c${options.colours}`,
    `e${options.effort}`,
    `d${ditherKey}`,
    `o${options.oxipngLevel}`,
  ].join("-");
}

function isCompleteReport(value: unknown, expectedProfile: string): value is SquooshReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const report = value as Partial<SquooshReport>;
  const summary = report.summary;
  return (
    report.tool === "squoosh-build-png-benchmark" &&
    report.options?.profileKey === expectedProfile &&
    typeof report.completedAt === "string" &&
    Array.isArray(report.files) &&
    summary?.localPolicyComplete === true &&
    summary.localSkippedBelowMinBytesUnique === 0 &&
    summary.localSkippedByLimitUnique === 0 &&
    summary.localFailedUnique === 0 &&
    summary.localCacheInvalidUnique === 0
  );
}

async function findLatestReport(
  projectRoot: string,
  expectedProfile: string,
): Promise<{ path: string; report: SquooshReport } | null> {
  const reportsDirectory = path.join(
    projectRoot,
    ".squoosh-cache",
    "build-pngs",
    expectedProfile,
    "reports",
  );
  if (!(await exists(reportsDirectory))) {
    return null;
  }

  const candidates: Array<{
    path: string;
    report: SquooshReport;
    completedAt: number;
  }> = [];

  for (const entry of await readdir(reportsDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
      continue;
    }
    const reportPath = path.join(reportsDirectory, entry.name);
    try {
      const parsed: unknown = JSON.parse(await readFile(reportPath, "utf8"));
      if (isCompleteReport(parsed, expectedProfile)) {
        candidates.push({
          path: reportPath,
          report: parsed,
          completedAt: Date.parse(parsed.completedAt) || 0,
        });
      }
    } catch {
      // Ignore incomplete or damaged historical reports.
    }
  }

  candidates.sort((left, right) => right.completedAt - left.completedAt);
  return candidates[0] ?? null;
}

async function loadTinyPngOutputHashes(projectRoot: string): Promise<Set<string>> {
  const indexPath = path.join(
    projectRoot,
    ".tinypng-cache",
    "build-images",
    "index.json",
  );
  if (!(await exists(indexPath))) {
    return new Set();
  }

  try {
    const value: unknown = JSON.parse(await readFile(indexPath, "utf8"));
    if (typeof value !== "object" || value === null) {
      return new Set();
    }
    const map = (value as {
      sourceSha256ByCompressedSha256?: unknown;
    }).sourceSha256ByCompressedSha256;
    if (typeof map !== "object" || map === null) {
      return new Set();
    }
    return new Set(Object.keys(map));
  } catch {
    return new Set();
  }
}

async function runScript(
  projectRoot: string,
  relativeScript: string,
  argumentsList: readonly string[],
  loadEnv: boolean,
): Promise<void> {
  const scriptPath = path.join(projectRoot, ...relativeScript.split("/"));
  if (!(await exists(scriptPath))) {
    throw new Error(`缺少脚本：${scriptPath}`);
  }

  const nodeArguments: string[] = [];
  if (loadEnv) {
    if (!(await exists(path.join(projectRoot, ".env")))) {
      throw new Error("TinyPNG 模式需要项目根目录中的 .env。");
    }
    nodeArguments.push("--env-file=.env");
  }
  nodeArguments.push("--import", "tsx", scriptPath, ...argumentsList);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, nodeArguments, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            signal === null
              ? `${relativeScript} 退出码：${String(code)}`
              : `${relativeScript} 被信号 ${signal} 终止。`,
          ),
        );
      }
    });
  });
}

async function runTinyPng(projectRoot: string, options: Options): Promise<void> {
  const tinyMode = options.tinyMode;
  if (tinyMode === null) {
    throw new Error("内部错误：缺少 TinyPNG 执行模式。");
  }

  const args = [
    options.buildDirectory,
    tinyMode.type === "all" ? "--all" : `--limit=${tinyMode.limit}`,
  ];
  if (options.minBytes !== null) {
    args.push(`--min-bytes=${options.minBytes}`);
  }

  await runScript(
    projectRoot,
    "src/tinypng-build/compress-build-images.ts",
    args,
    true,
  );
}

async function runSquoosh(projectRoot: string, options: Options): Promise<void> {
  const expectedProfile = profileKey(options);
  let latest = await findLatestReport(projectRoot, expectedProfile);
  const current = await collectPngFiles(options.buildDirectory);

  let sourceMatches = 0;
  let outputMatches = 0;
  let unknownMatches = current.length;
  let pathSetMatches = false;

  if (latest !== null) {
    const currentByPath = new Map(current.map((file) => [file.relativePath, file]));
    const reportByPath = new Map(
      latest.report.files.map((file) => [portable(file.relativePath), file]),
    );

    pathSetMatches =
      currentByPath.size === reportByPath.size &&
      [...currentByPath.keys()].every((key) => reportByPath.has(key));

    sourceMatches = 0;
    outputMatches = 0;
    unknownMatches = 0;

    for (const [relativePath, file] of currentByPath) {
      const reported = reportByPath.get(relativePath);
      if (reported === undefined) {
        unknownMatches += 1;
      } else if (file.sha256 === reported.sourceSha256) {
        sourceMatches += 1;
      } else if (
        reported.local.outputSha256 !== null &&
        file.sha256 === reported.local.outputSha256
      ) {
        outputMatches += 1;
      } else {
        unknownMatches += 1;
      }
    }
  }

  const tinyPngHashes = await loadTinyPngOutputHashes(projectRoot);
  const tinyPngMatches = current.filter((file) => tinyPngHashes.has(file.sha256)).length;
  if (tinyPngMatches > 0) {
    throw new Error(
      `检测到 ${tinyPngMatches} 张当前 PNG 来自 TinyPNG 缓存。请重新生成干净 web-mobile 后再使用 Squoosh。`,
    );
  }

  const canReuse =
    latest !== null &&
    pathSetMatches &&
    unknownMatches === 0;

  if (!canReuse) {
    if (outputMatches > 0) {
      throw new Error(
        [
          "检测到部分 PNG 已应用 Squoosh，同时存在新增、缺失或未知内容。",
          "为避免二次有损压缩，请重新生成干净 web-mobile 构建。",
          `已应用：${outputMatches}`,
          `未知：${unknownMatches}`,
        ].join("\n"),
      );
    }

    await runScript(
      projectRoot,
      "src/squoosh/benchmark-build-pngs.ts",
      [
        options.buildDirectory,
        "--all",
        "--min-bytes=0",
        "--no-tinypng-compare",
        `--quality=${options.quality}`,
        `--colours=${options.colours}`,
        `--effort=${options.effort}`,
        `--dither=${options.dither}`,
        `--oxipng-level=${options.oxipngLevel}`,
      ],
      false,
    );

    latest = await findLatestReport(projectRoot, expectedProfile);
    if (latest === null) {
      throw new Error("Squoosh 基准完成后没有生成可应用的完整报告。");
    }
  } else {
    console.log(`复用 Squoosh 缓存：${expectedProfile}`);
    console.log(`匹配原图：${sourceMatches}`);
    console.log(`已应用输出：${outputMatches}`);
  }

  if (latest === null) {
    throw new Error("没有可应用的 Squoosh 完整报告。");
  }

  const applyArgs = [
    options.buildDirectory,
    `--report=${latest.path}`,
  ];
  if (!options.preview) {
    applyArgs.push("--confirm");
  }

  await runScript(
    projectRoot,
    "src/squoosh/apply-build-png-cache.ts",
    applyArgs,
    false,
  );
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const projectRoot = process.cwd();

  await validateBuildDirectory(options.buildDirectory);
  console.log("构建图片优化");
  console.log("------------");
  console.log(`构建目录：${options.buildDirectory}`);
  console.log(`模式：${options.mode}`);

  if (options.mode === "none") {
    console.log("不修改构建图片。");
  } else if (options.mode === "tinypng") {
    await runTinyPng(projectRoot, options);
  } else {
    await runSquoosh(projectRoot, options);
  }
}

main().catch((error: unknown) => {
  console.error("");
  console.error("构建图片优化失败");
  console.error("----------------");
  console.error(
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
  process.exitCode = 1;
});
