import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  CreatorBuildConfiguration,
  CreatorBuildTask,
} from "../shared/types.js";
import {
  startBuildWorker,
  type RunningBuildWorker,
  type WorkerClientEvent,
} from "./build-worker-client.js";

const MAX_TASK_LOG_LINES = 400;

interface StartTaskOptions {
  packageRoot: string;
  tempRoot: string;
  nodeExecutable: string;
  projectName: string;
  configuration: CreatorBuildConfiguration;
}

function idleTask(): CreatorBuildTask {
  return {
    id: "",
    status: "idle",
    startedAt: null,
    finishedAt: null,
    inputDirectory: "",
    outputFile: "",
    reportFile: null,
    stage: null,
    progress: null,
    error: null,
    logs: [],
  };
}

function cloneTask(task: CreatorBuildTask): CreatorBuildTask {
  return { ...task, logs: [...task.logs] };
}

export class CreatorBuildTaskManager {
  private task: CreatorBuildTask = idleTask();
  private worker: RunningBuildWorker | null = null;
  private cancelRequested = false;

  current(): CreatorBuildTask {
    return cloneTask(this.task);
  }

  private appendLog(message: string): void {
    const logs = [...this.task.logs, `[${new Date().toISOString()}] ${message}`];
    this.task = {
      ...this.task,
      logs: logs.slice(-MAX_TASK_LOG_LINES),
    };
  }

  private handleWorkerMessage(event: WorkerClientEvent): void {
    if (event.type === "stderr") {
      this.appendLog(`[stderr] ${String(event.value)}`);
      return;
    }
    if (event.type === "invalid-output") {
      this.appendLog(`[非 JSON 输出] ${String(event.value)}`);
      return;
    }

    const message = event.value as Record<string, unknown>;
    if (event.type === "ready") {
      this.task = { ...this.task, status: "running", stage: "starting" };
      this.appendLog(`Worker 已启动，PID ${String(message.pid ?? "unknown")}`);
      return;
    }
    if (event.type === "event") {
      const coreEvent = message.event as Record<string, unknown> | undefined;
      if (coreEvent?.type === "state") {
        this.task = {
          ...this.task,
          stage: typeof coreEvent.stage === "string" ? coreEvent.stage : this.task.stage,
        };
        this.appendLog(typeof coreEvent.message === "string" ? coreEvent.message : "阶段状态已更新");
      } else if (coreEvent?.type === "log" && typeof coreEvent.line === "string") {
        this.appendLog(coreEvent.line);
      }
      return;
    }
    if (event.type === "result") {
      const result = message.result as Record<string, unknown> | undefined;
      this.task = {
        ...this.task,
        status: "succeeded",
        stage: "succeeded",
        finishedAt: new Date().toISOString(),
        outputFile: typeof result?.outputFile === "string" ? result.outputFile : this.task.outputFile,
        reportFile: typeof result?.reportFile === "string" ? result.reportFile : null,
        error: null,
      };
      this.appendLog("构建完成。");
      return;
    }
    if (event.type === "error") {
      const workerError = message.error as Record<string, unknown> | undefined;
      const errorMessage = typeof workerError?.message === "string"
        ? workerError.message
        : "Worker 返回未知错误。";
      this.task = {
        ...this.task,
        status: this.cancelRequested ? "cancelled" : "failed",
        stage: this.cancelRequested ? "cancelled" : "failed",
        finishedAt: new Date().toISOString(),
        error: errorMessage,
      };
      this.appendLog(errorMessage);
    }
  }

  async start(options: StartTaskOptions): Promise<CreatorBuildTask> {
    if (this.task.status === "starting" || this.task.status === "running") {
      throw new Error("已有 Creator 构建任务正在运行。请先等待完成或取消当前任务。");
    }

    const id = randomUUID();
    this.cancelRequested = false;
    this.task = {
      id,
      status: "starting",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      inputDirectory: path.resolve(options.configuration.inputDirectory),
      outputFile: path.resolve(options.configuration.outputFile),
      reportFile: null,
      stage: "starting",
      progress: null,
      error: null,
      logs: [],
    };
    this.appendLog("正在启动外部 Node.js Worker。 ");

    try {
      this.worker = await startBuildWorker({
        taskId: id,
        packageRoot: options.packageRoot,
        tempRoot: options.tempRoot,
        nodeExecutable: options.nodeExecutable,
        projectName: options.projectName,
        configuration: options.configuration,
        onMessage: (event) => this.handleWorkerMessage(event),
      });
      this.worker.child.once("error", (error) => {
        this.task = {
          ...this.task,
          status: "failed",
          stage: "failed",
          finishedAt: new Date().toISOString(),
          error: error.message,
        };
        this.appendLog(`Worker 启动失败：${error.message}`);
      });
      this.worker.child.once("exit", (code, signal) => {
        if (this.task.status === "starting" || this.task.status === "running") {
          const cancelled = this.cancelRequested;
          this.task = {
            ...this.task,
            status: cancelled ? "cancelled" : "failed",
            stage: cancelled ? "cancelled" : "failed",
            finishedAt: new Date().toISOString(),
            error: cancelled ? null : `Worker 异常退出：code=${String(code)}, signal=${String(signal)}`,
          };
          this.appendLog(cancelled ? "任务已取消。" : this.task.error ?? "Worker 异常退出。");
        }
        const worker = this.worker;
        this.worker = null;
        void worker?.cleanup();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.task = {
        ...this.task,
        status: "failed",
        stage: "failed",
        finishedAt: new Date().toISOString(),
        error: message,
      };
      this.appendLog(`无法启动 Worker：${message}`);
    }

    return this.current();
  }

  cancel(): CreatorBuildTask {
    if (this.task.status !== "starting" && this.task.status !== "running") {
      return this.current();
    }
    this.cancelRequested = true;
    this.appendLog("正在取消构建任务。");
    this.worker?.cancel();
    return this.current();
  }
}
