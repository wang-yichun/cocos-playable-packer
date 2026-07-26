import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPlayableBuild } from "../core/index.js";
import {
  applyLoadingScreenToArtifact,
  normalizeLoadingScreenConfig,
} from "../web/loading-screen.js";
import {
  parseCreatorWorkerControlMessage,
  parseCreatorWorkerRequest,
  serializeCreatorWorkerMessage,
  type CreatorWorkerMessage,
  type CreatorWorkerRequest,
} from "./protocol.js";

function write(message: CreatorWorkerMessage): void {
  process.stdout.write(serializeCreatorWorkerMessage(message));
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureTinyPngEnvCompatibility(
  request: CreatorWorkerRequest,
): Promise<(() => Promise<void>) | null> {
  if (request.build.image.mode !== "tinypng") {
    return null;
  }

  const apiKey = process.env.TINYPNG_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const envFile = path.join(request.packageRoot, ".env");
  if (await exists(envFile)) {
    return null;
  }

  try {
    await writeFile(
      envFile,
      "# Temporary compatibility file created by the Creator Worker.\n",
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return null;
    }
    throw error;
  }

  return async () => {
    await rm(envFile, { force: true });
  };
}

function listenForCancellation(taskId: string, controller: AbortController): void {
  process.stdin.setEncoding("utf8");
  let pending = "";
  process.stdin.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const command = parseCreatorWorkerControlMessage(JSON.parse(line) as unknown);
        if (command.type === "cancel" && command.taskId === taskId) controller.abort();
      } catch {
        // Control input is host-owned. Ignore malformed messages without corrupting stdout JSONL.
      }
    }
  });
}

async function main(): Promise<void> {
  const requestFile = process.argv[2];
  if (requestFile === undefined) {
    throw new TypeError("缺少 Creator Worker 请求文件路径。");
  }

  const request = parseCreatorWorkerRequest(
    JSON.parse(await readFile(path.resolve(requestFile), "utf8")) as unknown,
  );
  const cancellation = new AbortController();
  listenForCancellation(request.taskId, cancellation);
  write({ type: "ready", taskId: request.taskId, pid: process.pid });

  const cleanupTinyPngEnv = await ensureTinyPngEnvCompatibility(request);
  try {
    const result = await runPlayableBuild(request.build, {
      runtime: {
        packageRoot: request.packageRoot,
        host: "creator",
        tempRoot: request.tempRoot,
        nodeExecutable: request.nodeExecutable,
        environment: {
          ...process.env,
          ...request.environment,
        },
        signal: cancellation.signal,
        onEvent(event) {
          write({ type: "event", taskId: request.taskId, event });
        },
      },
    });

    const loadingScreen = normalizeLoadingScreenConfig(request.build.loadingScreen);
    if (loadingScreen?.enabled) {
      await applyLoadingScreenToArtifact(result.outputFile, result.reportFile, loadingScreen);
    }

    write({ type: "result", taskId: request.taskId, result });
  } finally {
    await cleanupTinyPngEnv?.();
  }
}

main().catch((error: unknown) => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const taskId = process.argv[3] ?? "unknown";
  write({
    type: "error",
    taskId,
    error: {
      code: typeof (normalized as Error & { code?: unknown }).code === "string"
        ? String((normalized as Error & { code?: unknown }).code)
        : "BUILD_FAILED",
      message: normalized.message,
      stack: normalized.stack ?? null,
    },
  });
  process.exitCode = 1;
});
