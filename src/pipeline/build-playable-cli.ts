import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

type PayloadEncoding = "base64" | "base91" | "html7";
type JsonObject = Record<string, unknown>;

interface CliOptions {
  payloadEncoding: PayloadEncoding;
  passthroughArgs: string[];
  outputArgumentIndex: number;
  outputFile: string;
  keepWorkspaceRequested: boolean;
}

const PAYLOAD_SCRIPTS: Readonly<Record<Exclude<PayloadEncoding, "base64">, string>> = {
  base91: "src/encoding/reencode-brotli-html.ts",
  html7: "src/encoding/reencode-brotli-html7.ts",
};

function usage(): string {
  return [
    "Playable 全流程构建",
    "",
    "npm run playable:build -- <web-mobile目录> <输出HTML> --image-mode=squoosh --payload-encoding=base64",
    "npm run playable:build -- <web-mobile目录> <输出HTML> --image-mode=squoosh --payload-encoding=base91",
    "npm run playable:build -- <web-mobile目录> <输出HTML> --image-mode=squoosh --payload-encoding=html7",
    "",
    "Payload 编码：",
    "  base64  默认模式，兼容性最高",
    "  base91  高密度可打印 ASCII，已通过实机验证",
    "  html7   HTML-safe 7-bit 极限模式，渠道发布前需单独验证",
    "",
    "未指定 --payload-encoding 时默认使用 base64。",
    "其他参数原样转发给原有 playable:build 流程。",
  ].join("\n");
}

function parsePayloadEncoding(value: string): PayloadEncoding {
  if (value === "base64" || value === "base91" || value === "html7") {
    return value;
  }

  throw new Error(`无效 Payload 编码：${value}`);
}

function parseArguments(argv: readonly string[]): CliOptions {
  const args = argv.filter((argument) => argument !== "--");

  if (args.includes("-h") || args.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }

  let payloadEncoding: PayloadEncoding = "base64";
  let payloadEncodingSpecified = false;
  const passthroughArgs: string[] = [];
  const positionalIndexes: number[] = [];

  for (const argument of args) {
    if (argument.startsWith("--payload-encoding=")) {
      if (payloadEncodingSpecified) {
        throw new Error("--payload-encoding 只能指定一次。");
      }

      payloadEncoding = parsePayloadEncoding(
        argument.slice("--payload-encoding=".length),
      );
      payloadEncodingSpecified = true;
      continue;
    }

    const index = passthroughArgs.length;
    passthroughArgs.push(argument);

    if (!argument.startsWith("-")) {
      positionalIndexes.push(index);
    }
  }

  if (positionalIndexes.length !== 2) {
    throw new Error(`${usage()}\n\n必须提供输入目录和输出 HTML。`);
  }

  const outputArgumentIndex = positionalIndexes[1];
  if (outputArgumentIndex === undefined) {
    throw new Error("无法确定输出 HTML 参数位置。");
  }

  const outputArgument = passthroughArgs[outputArgumentIndex];
  if (outputArgument === undefined) {
    throw new Error("缺少输出 HTML 参数。");
  }

  const outputFile = path.resolve(outputArgument);
  if (path.extname(outputFile).toLowerCase() !== ".html") {
    throw new Error(`输出文件必须是 .html：${outputFile}`);
  }

  return {
    payloadEncoding,
    passthroughArgs,
    outputArgumentIndex,
    outputFile,
    keepWorkspaceRequested: passthroughArgs.includes("--keep-workspace"),
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

async function runTypeScript(
  projectRoot: string,
  relativeScript: string,
  argumentsList: readonly string[],
): Promise<void> {
  const scriptPath = path.join(projectRoot, ...relativeScript.split("/"));
  if (!(await exists(scriptPath))) {
    throw new Error(`缺少脚本：${scriptPath}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...argumentsList],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: "inherit",
        windowsHide: false,
      },
    );

    child.once("error", reject);
    child.once(
      "exit",
      (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            signal === null
              ? `${relativeScript} 退出码：${String(code)}`
              : `${relativeScript} 被信号 ${signal} 终止。`,
          ),
        );
      },
    );
  });
}

function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".report.json");
}

function encodingReportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".encoding-report.json");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(filePath: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isJsonObject(parsed)) {
    throw new Error(`JSON 根节点必须是对象：${filePath}`);
  }
  return parsed;
}

function requireObject(parent: JsonObject, key: string, source: string): JsonObject {
  const value = parent[key];
  if (!isJsonObject(value)) {
    throw new Error(`${source} 缺少对象字段：${key}`);
  }
  return value;
}

function requireString(parent: JsonObject, key: string, source: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${source} 缺少字符串字段：${key}`);
  }
  return value;
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator * 100;
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function promotePair(
  tempOutputFile: string,
  outputFile: string,
  tempReportFile: string,
  reportFile: string,
): Promise<void> {
  const token = `${process.pid}-${Date.now()}`;
  const outputBackup = `${outputFile}.previous-${token}`;
  const reportBackup = `${reportFile}.previous-${token}`;
  let outputBackedUp = false;
  let reportBackedUp = false;
  let outputPromoted = false;
  let reportPromoted = false;

  try {
    await rm(outputBackup, { force: true });
    await rm(reportBackup, { force: true });

    if (await exists(outputFile)) {
      await rename(outputFile, outputBackup);
      outputBackedUp = true;
    }

    if (await exists(reportFile)) {
      await rename(reportFile, reportBackup);
      reportBackedUp = true;
    }

    await rename(tempOutputFile, outputFile);
    outputPromoted = true;
    await rename(tempReportFile, reportFile);
    reportPromoted = true;

    await rm(outputBackup, { force: true });
    await rm(reportBackup, { force: true });
  } catch (error) {
    if (reportPromoted) {
      await rm(reportFile, { force: true }).catch(() => undefined);
    }
    if (outputPromoted) {
      await rm(outputFile, { force: true }).catch(() => undefined);
    }
    if (reportBackedUp && (await exists(reportBackup))) {
      await rename(reportBackup, reportFile).catch(() => undefined);
    }
    if (outputBackedUp && (await exists(outputBackup))) {
      await rename(outputBackup, outputFile).catch(() => undefined);
    }
    throw error;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const projectRoot = process.cwd();
  const wrapperStartedAt = performance.now();
  const outputDirectory = path.dirname(options.outputFile);
  const outputStem = path.basename(options.outputFile, path.extname(options.outputFile));
  const token = `${process.pid}-${Date.now()}`;
  const tempBase64File = path.join(
    outputDirectory,
    `.${outputStem}.base64-${token}.html`,
  );
  const tempEncodedFile = path.join(
    outputDirectory,
    `.${outputStem}.${options.payloadEncoding}-${token}.html`,
  );
  const finalTempFile =
    options.payloadEncoding === "base64" ? tempBase64File : tempEncodedFile;
  const coreReportFile = reportPathForOutput(tempBase64File);
  const encodingReportFile = encodingReportPathForOutput(tempEncodedFile);
  const finalReportFile = reportPathForOutput(options.outputFile);
  const tempFinalReportFile = `${finalReportFile}.tmp-${token}`;

  await mkdir(outputDirectory, { recursive: true });

  const coreArgs = [...options.passthroughArgs];
  coreArgs[options.outputArgumentIndex] = tempBase64File;
  if (!options.keepWorkspaceRequested) {
    coreArgs.push("--keep-workspace");
  }

  console.log("Payload 编码流水线");
  console.log("----------------");
  console.log(`Payload 编码：${options.payloadEncoding}`);
  if (options.payloadEncoding === "html7") {
    console.warn("提示：HTML7 为极限模式，正式投放前应在目标渠道验证文件未被重新编码。\n");
  }

  let payloadEncodingMs = 0;
  let runDirectory: string | null = null;

  try {
    await runTypeScript(
      projectRoot,
      "src/pipeline/build-playable.ts",
      coreArgs,
    );

    if (options.payloadEncoding !== "base64") {
      const encodingStart = performance.now();
      await runTypeScript(
        projectRoot,
        PAYLOAD_SCRIPTS[options.payloadEncoding],
        [tempBase64File, tempEncodedFile, "--iterations=1"],
      );
      payloadEncodingMs = performance.now() - encodingStart;
    }

    const finalInfo = await stat(finalTempFile).catch(() => null);
    const base64Info = await stat(tempBase64File).catch(() => null);
    if (!finalInfo?.isFile() || finalInfo.size === 0) {
      throw new Error(`没有生成有效的最终 HTML：${finalTempFile}`);
    }
    if (!base64Info?.isFile() || base64Info.size === 0) {
      throw new Error(`没有生成有效的 Base64 基线 HTML：${tempBase64File}`);
    }

    const coreReport = await readJsonObject(coreReportFile);
    const coreOutput = requireObject(coreReport, "output", coreReportFile);
    const coreTiming = requireObject(coreReport, "timingMs", coreReportFile);
    const coreWorkspace = requireObject(coreReport, "workspace", coreReportFile);
    runDirectory = requireString(coreWorkspace, "runDirectory", coreReportFile);
    const projectReportFile = requireString(
      coreOutput,
      "projectReportFile",
      coreReportFile,
    );
    const rawEncodingReport =
      options.payloadEncoding === "base64"
        ? null
        : await readJsonObject(encodingReportFile);
    const encodingDetails =
      rawEncodingReport === null
        ? null
        : {
            tool: rawEncodingReport.tool ?? null,
            generatedAt: rawEncodingReport.generatedAt ?? null,
            payload: rawEncodingReport.payload ?? null,
          };
    const savedBytes = base64Info.size - finalInfo.size;
    const finalSha256 = await hashFile(finalTempFile);

    const report: JsonObject = {
      ...coreReport,
      schemaVersion: 2,
      completedAt: new Date().toISOString(),
      workspace: {
        ...coreWorkspace,
        kept: options.keepWorkspaceRequested,
      },
      payloadEncoding: {
        mode: options.payloadEncoding,
        base64HtmlBytes: base64Info.size,
        outputHtmlBytes: finalInfo.size,
        savedBytes,
        savedPercent: percentage(savedBytes, base64Info.size),
        details: encodingDetails,
      },
      output: {
        ...coreOutput,
        file: options.outputFile,
        bytes: finalInfo.size,
        sha256: finalSha256,
        reportFile: finalReportFile,
        projectReportFile,
      },
      timingMs: {
        ...coreTiming,
        payloadEncoding: payloadEncodingMs,
        total: performance.now() - wrapperStartedAt,
      },
    };

    await writeJson(tempFinalReportFile, report);
    await promotePair(
      finalTempFile,
      options.outputFile,
      tempFinalReportFile,
      finalReportFile,
    );
    await writeJson(projectReportFile, report);

    if (!options.keepWorkspaceRequested) {
      await rm(runDirectory, { recursive: true, force: true });
    }

    console.log("");
    console.log("Payload 编码流水线完成");
    console.log("----------------------");
    console.log(`编码模式：${options.payloadEncoding}`);
    console.log(`Base64 基线：${formatBytes(base64Info.size)}`);
    console.log(`最终 HTML：${formatBytes(finalInfo.size)}`);
    console.log(
      `编码层减少：${formatBytes(savedBytes)} (${percentage(savedBytes, base64Info.size).toFixed(2)}%)`,
    );
    console.log(`SHA-256：${finalSha256}`);
    console.log(`输出：${options.outputFile}`);
    console.log(`报告：${finalReportFile}`);
    console.log(`工作区：${options.keepWorkspaceRequested ? "已保留" : "已清理"}`);
  } catch (error) {
    if (runDirectory === null && (await exists(coreReportFile))) {
      try {
        const coreReport = await readJsonObject(coreReportFile);
        const coreWorkspace = requireObject(coreReport, "workspace", coreReportFile);
        runDirectory = requireString(coreWorkspace, "runDirectory", coreReportFile);
      } catch {
        // 核心报告不完整时保留原始错误。
      }
    }

    if (runDirectory !== null) {
      await writeJson(path.join(runDirectory, "failure.json"), {
        schemaVersion: 2,
        tool: "playable-build-payload-wrapper",
        status: "failed",
        failedAt: new Date().toISOString(),
        payloadEncoding: options.payloadEncoding,
        outputFile: options.outputFile,
        runDirectory,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      }).catch(() => undefined);
      console.error(`失败工作区已保留：${runDirectory}`);
    }

    throw error;
  } finally {
    await rm(tempBase64File, { force: true }).catch(() => undefined);
    await rm(tempEncodedFile, { force: true }).catch(() => undefined);
    await rm(coreReportFile, { force: true }).catch(() => undefined);
    await rm(encodingReportFile, { force: true }).catch(() => undefined);
    await rm(tempFinalReportFile, { force: true }).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error("");
  console.error("Payload 编码流水线失败");
  console.error("----------------------");
  console.error(
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
  process.exitCode = 1;
});
