import { readFile } from "node:fs/promises";
import path from "node:path";

import { runPlayableBuild } from "../core/index.js";
import {
  parseCreatorWorkerRequest,
  serializeCreatorWorkerMessage,
  type CreatorWorkerMessage,
} from "./protocol.js";

function write(message: CreatorWorkerMessage): void {
  process.stdout.write(serializeCreatorWorkerMessage(message));
}

async function main(): Promise<void> {
  const requestFile = process.argv[2];
  if (requestFile === undefined) {
    throw new TypeError("缺少 Creator Worker 请求文件路径。");
  }

  const request = parseCreatorWorkerRequest(
    JSON.parse(await readFile(path.resolve(requestFile), "utf8")) as unknown,
  );
  write({ type: "ready", taskId: request.taskId, pid: process.pid });

  const result = await runPlayableBuild(request.build, {
    runtime: {
      packageRoot: request.packageRoot,
      host: "creator",
      tempRoot: request.tempRoot,
      nodeExecutable: request.nodeExecutable,
      environment: request.environment,
      onEvent(event) {
        write({ type: "event", taskId: request.taskId, event });
      },
    },
  });

  write({ type: "result", taskId: request.taskId, result });
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
