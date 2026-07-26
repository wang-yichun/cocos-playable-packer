import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CreatorBuildConfiguration } from "../shared/types.js";

export interface WorkerClientEvent {
  type: "ready" | "event" | "result" | "error" | "stderr" | "invalid-output";
  value: unknown;
}

export interface BuildWorkerClientOptions {
  taskId: string;
  packageRoot: string;
  tempRoot: string;
  nodeExecutable: string;
  configuration: CreatorBuildConfiguration;
  projectName: string;
  onMessage: (event: WorkerClientEvent) => void;
}

export interface RunningBuildWorker {
  child: ChildProcess;
  requestFile: string;
  cancel(): void;
  cleanup(): Promise<void>;
}

function imageRequest(configuration: CreatorBuildConfiguration) {
  if (configuration.imageMode === "squoosh" || configuration.imageMode === "webp") {
    return {
      mode: configuration.imageMode,
      pngQuality: configuration.pngQuality ?? 80,
      jpegQuality: configuration.jpegQuality ?? 80,
    };
  }
  if (configuration.imageMode === "tinypng") {
    return { mode: "tinypng" as const, scope: { type: "all" as const } };
  }
  return { mode: "none" as const };
}

function buildRequest(configuration: CreatorBuildConfiguration, projectName: string) {
  return {
    inputDirectory: configuration.inputDirectory,
    outputFile: configuration.outputFile,
    image: imageRequest(configuration),
    audio: configuration.audioEnabled ? { bitrateKbps: configuration.audioBitrateKbps } : null,
    payloadEncoding: configuration.payloadEncoding,
    loadingScreen: {
      enabled: configuration.loadingScreenEnabled,
      logoDataUrl: configuration.loadingLogoDataUrl ?? null,
    },
    projectName,
  };
}

function workerEnvironment(configuration: CreatorBuildConfiguration, packageRoot: string, tempRoot: string): NodeJS.ProcessEnv {
  const tinyPngApiKey = configuration.tinyPngApiKey?.trim();
  return {
    ...process.env,
    PLAYABLE_PACKER_RUNTIME_HOST: "creator",
    PLAYABLE_PACKER_PACKAGE_ROOT: packageRoot,
    PLAYABLE_PACKER_TEMP_ROOT: tempRoot,
    ...(configuration.imageMode === "tinypng" && tinyPngApiKey
      ? { TINYPNG_API_KEY: tinyPngApiKey }
      : {}),
  };
}

function consumeLines(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) onLine(line);
    }
  };
}

export async function startBuildWorker(options: BuildWorkerClientOptions): Promise<RunningBuildWorker> {
  const workerScript = path.join(options.packageRoot, "dist", "creator-worker", "playable-build-worker.js");
  await access(workerScript);
  await mkdir(options.tempRoot, { recursive: true });
  const requestFile = path.join(options.tempRoot, `${options.taskId}.request.json`);
  await writeFile(requestFile, JSON.stringify({
    protocolVersion: 1,
    taskId: options.taskId,
    packageRoot: options.packageRoot,
    tempRoot: options.tempRoot,
    nodeExecutable: options.nodeExecutable,
    build: buildRequest(options.configuration, options.projectName),
  }, null, 2), "utf8");

  const child = spawn(options.nodeExecutable, [workerScript, requestFile, options.taskId], {
    cwd: options.packageRoot,
    env: workerEnvironment(options.configuration, options.packageRoot, options.tempRoot),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdout?.on("data", consumeLines((line) => {
    try {
      const message = JSON.parse(line) as { type?: unknown };
      const type = typeof message.type === "string" ? message.type : "invalid-output";
      options.onMessage({
        type: type === "ready" || type === "event" || type === "result" || type === "error" ? type : "invalid-output",
        value: message,
      });
    } catch {
      options.onMessage({ type: "invalid-output", value: line });
    }
  }));
  child.stderr?.on("data", consumeLines((line) => options.onMessage({ type: "stderr", value: line })));

  return {
    child,
    requestFile,
    cancel() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.stdin?.write(`${JSON.stringify({ type: "cancel", taskId: options.taskId })}\n`);
    },
    async cleanup() { await rm(requestFile, { force: true }); },
  };
}
