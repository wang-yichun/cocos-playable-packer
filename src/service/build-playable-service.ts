import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  createBuildPlayableArguments,
  normalizeBuildPlayableRequest,
  reportPathForOutput,
} from "./build-playable-request.js";
import {
  PlayableBuildServiceError,
  type BuildPlayableRequest,
  type BuildPlayableResult,
  type BuildPlayableServiceOptions,
  type NormalizedBuildPlayableRequest,
  type PlayableBuildLogStream,
  type PlayableBuildStage,
} from "./build-playable-types.js";

interface JsonObject {
  [key: string]: unknown;
}

interface PipelineCommand {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  scriptPath: string;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(parent: JsonObject, key: string, source: string): JsonObject {
  const value = parent[key];
  if (!isJsonObject(value)) {
    throw new PlayableBuildServiceError(
      "REPORT_INVALID",
      `${source} 缺少对象字段：${key}`,
    );
  }
  return value;
}

function requireString(parent: JsonObject, key: string, source: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PlayableBuildServiceError(
      "REPORT_INVALID",
      `${source} 缺少字符串字段：${key}`,
    );
  }
  return value;
}

function createPipelineCommand(
  normalized: NormalizedBuildPlayableRequest,
  options: BuildPlayableServiceOptions,
): PipelineCommand {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const requestedScriptPath =
    options.scriptPath ??
    path.join("src", "pipeline", "build-playable-image-quality-cli.ts");
  const scriptPath = path.isAbsolute(requestedScriptPath)
    ? requestedScriptPath
    : path.resolve(projectRoot, requestedScriptPath);
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const scriptArgs = createBuildPlayableArguments(normalized);
  const args = scriptPath.toLowerCase().endsWith(".ts")
    ? ["--import", "tsx", scriptPath, ...scriptArgs]
    : [scriptPath, ...scriptArgs];

  return {
    command: nodeExecutable,
    args,
    cwd: projectRoot,
    env: {
      ...process.env,
      ...options.environment,
    },
    scriptPath,
  };
}

function appendCapturedLog(
  capturedLogs: string[],
  line: string,
  maximum: number,
): void {
  capturedLogs.push(line);
  if (capturedLogs.length > maximum) {
    capturedLogs.splice(0, capturedLogs.length - maximum);
  }
}

function attachLineReader(
  child: ChildProcess,
  streamName: PlayableBuildLogStream,
  startedAtMs: number,
  capturedLogs: string[],
  maximum: number,
  onEvent: BuildPlayableServiceOptions["onEvent"],
): void {
  const stream = streamName === "stdout" ? child.stdout : child.stderr;
  if (stream === null) {
    return;
  }

  stream.setEncoding("utf8");
  let pending = "";
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      appendCapturedLog(capturedLogs, `[${streamName}] ${line}`, maximum);
      onEvent?.({
        type: "log",
        stream: streamName,
        timestamp: new Date().toISOString(),
        elapsedMs: performance.now() - startedAtMs,
        line,
      });
    }
  });
  stream.on("end", () => {
    if (pending.length === 0) {
      return;
    }
    appendCapturedLog(capturedLogs, `[${streamName}] ${pending}`, maximum);
    onEvent?.({
      type: "log",
      stream: streamName,
      timestamp: new Date().toISOString(),
      elapsedMs: performance.now() - startedAtMs,
      line: pending,
    });
  });
}

function terminateProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    killer.unref();
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function emitState(
  onEvent: BuildPlayableServiceOptions["onEvent"],
  startedAtMs: number,
  stage: PlayableBuildStage,
  message: string,
): void {
  onEvent?.({
    type: "state",
    stage,
    timestamp: new Date().toISOString(),
    elapsedMs: performance.now() - startedAtMs,
    message,
  });
}

async function verifyInputAndCommand(
  normalized: NormalizedBuildPlayableRequest,
  command: PipelineCommand,
): Promise<void> {
  const inputInfo = await stat(normalized.inputDirectory).catch(() => null);
  if (!inputInfo?.isDirectory()) {
    throw new PlayableBuildServiceError(
      "INPUT_NOT_FOUND",
      `输入目录不存在或不是目录：${normalized.inputDirectory}`,
    );
  }

  await access(command.scriptPath).catch((error: unknown) => {
    throw new PlayableBuildServiceError(
      "PIPELINE_SCRIPT_NOT_FOUND",
      `缺少 Playable Pipeline 脚本：${command.scriptPath}`,
      { cause: error },
    );
  });

  await mkdir(path.dirname(normalized.outputFile), { recursive: true });
}

async function readResult(
  normalized: NormalizedBuildPlayableRequest,
  startedAt: string,
  startedAtMs: number,
): Promise<BuildPlayableResult> {
  const reportFile = reportPathForOutput(normalized.outputFile);
  const outputInfo = await stat(normalized.outputFile).catch(() => null);
  if (!outputInfo?.isFile() || outputInfo.size === 0) {
    throw new PlayableBuildServiceError(
      "OUTPUT_MISSING",
      `Pipeline 未生成有效 HTML：${normalized.outputFile}`,
    );
  }

  let report: unknown;
  try {
    report = JSON.parse(await readFile(reportFile, "utf8")) as unknown;
  } catch (error) {
    throw new PlayableBuildServiceError(
      "REPORT_INVALID",
      `无法读取 Pipeline 报告：${reportFile}`,
      { cause: error },
    );
  }
  if (!isJsonObject(report)) {
    throw new PlayableBuildServiceError(
      "REPORT_INVALID",
      `Pipeline 报告根节点必须是对象：${reportFile}`,
    );
  }

  const output = requireObject(report, "output", reportFile);
  const outputSha256 = requireString(output, "sha256", reportFile);
  return {
    status: "succeeded",
    outputFile: normalized.outputFile,
    reportFile,
    outputBytes: outputInfo.size,
    outputSha256,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: performance.now() - startedAtMs,
    report,
  };
}

export async function buildPlayable(
  request: BuildPlayableRequest,
  options: BuildPlayableServiceOptions = {},
): Promise<BuildPlayableResult> {
  const startedAt = new Date().toISOString();
  const startedAtMs = performance.now();
  const capturedLogs: string[] = [];
  const maxCapturedLogLines = options.maxCapturedLogLines ?? 200;
  if (
    !Number.isInteger(maxCapturedLogLines)
    || maxCapturedLogLines < 0
    || maxCapturedLogLines > 100_000
  ) {
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      "maxCapturedLogLines 必须是 0 到 100000 之间的整数。",
    );
  }

  if (isSignalAborted(options.signal)) {
    throw new PlayableBuildServiceError("ABORTED", "Playable 构建已取消。");
  }

  emitState(options.onEvent, startedAtMs, "validating", "正在验证构建请求。");

  let normalized: NormalizedBuildPlayableRequest;
  let command: PipelineCommand;
  try {
    normalized = normalizeBuildPlayableRequest(request);
    command = createPipelineCommand(normalized, options);
    await verifyInputAndCommand(normalized, command);
  } catch (error) {
    emitState(options.onEvent, startedAtMs, "failed", "构建请求验证失败。");
    if (error instanceof PlayableBuildServiceError) {
      throw error;
    }
    throw new PlayableBuildServiceError(
      "INVALID_REQUEST",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }

  if (isSignalAborted(options.signal)) {
    emitState(options.onEvent, startedAtMs, "cancelled", "Playable 构建已取消。");
    throw new PlayableBuildServiceError("ABORTED", "Playable 构建已取消。");
  }

  emitState(options.onEvent, startedAtMs, "running", "Playable Pipeline 已启动。");

  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: command.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  attachLineReader(
    child,
    "stdout",
    startedAtMs,
    capturedLogs,
    maxCapturedLogLines,
    options.onEvent,
  );
  attachLineReader(
    child,
    "stderr",
    startedAtMs,
    capturedLogs,
    maxCapturedLogLines,
    options.onEvent,
  );

  let aborted = false;
  const abortHandler = (): void => {
    aborted = true;
    emitState(options.onEvent, startedAtMs, "cancelled", "正在终止 Playable Pipeline。");
    terminateProcessTree(child);
  };
  options.signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", (error: Error) => {
        reject(
          new PlayableBuildServiceError(
            "PIPELINE_START_FAILED",
            `无法启动 Playable Pipeline：${error.message}`,
            { cause: error, capturedLogs },
          ),
        );
      });
      child.once("exit", (exitCode, signal) => {
        if (aborted) {
          reject(
            new PlayableBuildServiceError("ABORTED", "Playable 构建已取消。", {
              exitCode,
              signal,
              capturedLogs,
            }),
          );
          return;
        }
        if (exitCode === 0) {
          resolve();
          return;
        }
        reject(
          new PlayableBuildServiceError(
            "PIPELINE_FAILED",
            signal === null
              ? `Playable Pipeline 退出码：${String(exitCode)}`
              : `Playable Pipeline 被信号 ${signal} 终止。`,
            { exitCode, signal, capturedLogs },
          ),
        );
      });
    });

    if (aborted || isSignalAborted(options.signal)) {
      throw new PlayableBuildServiceError("ABORTED", "Playable 构建已取消。", {
        capturedLogs,
      });
    }

    emitState(options.onEvent, startedAtMs, "finalizing", "正在读取输出和构建报告。");
    const result = await readResult(normalized, startedAt, startedAtMs);
    emitState(options.onEvent, startedAtMs, "succeeded", "Playable 构建完成。");
    return result;
  } catch (error) {
    if (error instanceof PlayableBuildServiceError) {
      if (error.code !== "ABORTED") {
        emitState(options.onEvent, startedAtMs, "failed", error.message);
      }
      throw error;
    }
    emitState(options.onEvent, startedAtMs, "failed", "Playable 构建失败。");
    throw new PlayableBuildServiceError(
      "PIPELINE_FAILED",
      error instanceof Error ? error.message : String(error),
      { cause: error, capturedLogs },
    );
  } finally {
    options.signal?.removeEventListener("abort", abortHandler);
  }
}
