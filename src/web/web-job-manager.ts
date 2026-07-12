import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { buildPlayable } from "../service/build-playable-service.js";
import type {
  BuildPlayableRequest,
  BuildPlayableResult,
  BuildPlayableServiceOptions,
  PlayableBuildServiceEvent,
} from "../service/build-playable-types.js";
import {
  createWebBuildRequest,
  normalizeWebBuildConfig,
  type NormalizedWebBuildConfig,
} from "./web-build-config.js";
import {
  extractZipArchive,
  findWebMobileRoot,
  type ZipExtractionLimits,
} from "./zip-extractor.js";

export type WebJobStatus =
  | "queued"
  | "extracting"
  | "building"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface WebUploadReceipt {
  uploadId: string;
  bytes: number;
  createdAt: string;
}

export interface WebJobResultLinks {
  html: string;
  report: string;
  preview: string;
}

export interface PublicWebJob {
  id: string;
  status: WebJobStatus;
  message: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  config: NormalizedWebBuildConfig;
  outputBytes: number | null;
  outputSha256: string | null;
  error: {
    code: string;
    message: string;
  } | null;
  recentLogs: readonly string[];
  links: WebJobResultLinks | null;
}

interface StoredUpload extends WebUploadReceipt {
  filePath: string;
}

interface InternalWebJob extends Omit<PublicWebJob, "recentLogs"> {
  recentLogs: string[];
  uploadPath: string;
  jobDirectory: string;
  extractionDirectory: string;
  outputFile: string;
  reportFile: string;
  abortController: AbortController;
}

export type BuildPlayableFunction = (
  request: BuildPlayableRequest,
  options?: BuildPlayableServiceOptions,
) => Promise<BuildPlayableResult>;

export interface WebJobManagerOptions {
  rootDirectory: string;
  projectRoot?: string;
  buildPlayableImpl?: BuildPlayableFunction;
  zipLimits?: Partial<ZipExtractionLimits>;
  maxRecentLogs?: number;
}

function timestamp(): string {
  return new Date().toISOString();
}

function clonePublicJob(job: InternalWebJob): PublicWebJob {
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    config: { ...job.config },
    outputBytes: job.outputBytes,
    outputSha256: job.outputSha256,
    error: job.error === null ? null : { ...job.error },
    recentLogs: [...job.recentLogs],
    links: job.links === null ? null : { ...job.links },
  };
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "WEB_JOB_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WebJobManager {
  readonly rootDirectory: string;
  readonly uploadDirectory: string;
  readonly jobsDirectory: string;

  private readonly projectRoot: string;
  private readonly buildPlayableImpl: BuildPlayableFunction;
  private readonly zipLimits: Partial<ZipExtractionLimits>;
  private readonly maxRecentLogs: number;
  private readonly uploads = new Map<string, StoredUpload>();
  private readonly jobs = new Map<string, InternalWebJob>();
  private readonly queue: string[] = [];
  private draining = false;

  constructor(options: WebJobManagerOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory);
    this.uploadDirectory = path.join(this.rootDirectory, "uploads");
    this.jobsDirectory = path.join(this.rootDirectory, "jobs");
    this.projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    this.buildPlayableImpl = options.buildPlayableImpl ?? buildPlayable;
    this.zipLimits = { ...options.zipLimits };
    this.maxRecentLogs = options.maxRecentLogs ?? 200;
    if (
      !Number.isInteger(this.maxRecentLogs)
      || this.maxRecentLogs < 1
      || this.maxRecentLogs > 10_000
    ) {
      throw new Error("maxRecentLogs 必须是 1 到 10000 之间的整数。");
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.uploadDirectory, { recursive: true });
    await mkdir(this.jobsDirectory, { recursive: true });
  }

  createUploadPath(uploadId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) {
      throw new Error("uploadId 格式无效。");
    }
    return path.join(this.uploadDirectory, `${uploadId}.zip`);
  }

  registerUpload(uploadId: string, filePath: string, bytes: number): WebUploadReceipt {
    if (!Number.isInteger(bytes) || bytes <= 0) {
      throw new Error("上传文件大小无效。");
    }
    const receipt: StoredUpload = {
      uploadId,
      filePath: path.resolve(filePath),
      bytes,
      createdAt: timestamp(),
    };
    this.uploads.set(uploadId, receipt);
    return {
      uploadId: receipt.uploadId,
      bytes: receipt.bytes,
      createdAt: receipt.createdAt,
    };
  }

  createJob(uploadId: string, rawConfig?: unknown): PublicWebJob {
    const upload = this.uploads.get(uploadId);
    if (upload === undefined) {
      throw new Error("上传不存在、已被使用或服务已重启，请重新上传 ZIP。");
    }
    const config = normalizeWebBuildConfig(rawConfig);
    const id = randomUUID();
    const jobDirectory = path.join(this.jobsDirectory, id);
    const outputFile = path.join(jobDirectory, "output", "game.html");
    const reportFile = outputFile.replace(/\.html$/i, ".report.json");
    const job: InternalWebJob = {
      id,
      status: "queued",
      message: "任务已进入队列。",
      createdAt: timestamp(),
      startedAt: null,
      completedAt: null,
      config,
      outputBytes: null,
      outputSha256: null,
      error: null,
      recentLogs: [],
      links: null,
      uploadPath: upload.filePath,
      jobDirectory,
      extractionDirectory: path.join(jobDirectory, "source"),
      outputFile,
      reportFile,
      abortController: new AbortController(),
    };
    this.uploads.delete(uploadId);
    this.jobs.set(id, job);
    this.queue.push(id);
    void this.drainQueue();
    return clonePublicJob(job);
  }

  getJob(jobId: string): PublicWebJob | null {
    const job = this.jobs.get(jobId);
    return job === undefined ? null : clonePublicJob(job);
  }

  getArtifactPath(jobId: string, artifact: "html" | "report"): string | null {
    const job = this.jobs.get(jobId);
    if (job === undefined || job.status !== "succeeded") {
      return null;
    }
    return artifact === "html" ? job.outputFile : job.reportFile;
  }

  cancelJob(jobId: string): PublicWebJob | null {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      return null;
    }
    if (job.status === "queued") {
      const index = this.queue.indexOf(jobId);
      if (index >= 0) {
        this.queue.splice(index, 1);
      }
      job.status = "cancelled";
      job.message = "任务已取消。";
      job.completedAt = timestamp();
      void rm(job.uploadPath, { force: true });
      return clonePublicJob(job);
    }
    if (job.status === "extracting" || job.status === "building") {
      job.message = "正在取消任务。";
      job.abortController.abort();
    }
    return clonePublicJob(job);
  }

  private appendLog(job: InternalWebJob, line: string): void {
    job.recentLogs.push(line);
    if (job.recentLogs.length > this.maxRecentLogs) {
      job.recentLogs.splice(0, job.recentLogs.length - this.maxRecentLogs);
    }
  }

  private handleBuildEvent(job: InternalWebJob, event: PlayableBuildServiceEvent): void {
    if (event.type === "log") {
      this.appendLog(job, `[${event.stream}] ${event.line}`);
      return;
    }
    job.message = event.message;
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const nextId = this.queue.shift();
        if (nextId === undefined) {
          break;
        }
        const job = this.jobs.get(nextId);
        if (job === undefined || job.status !== "queued") {
          continue;
        }
        await this.runJob(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runJob(job: InternalWebJob): Promise<void> {
    job.startedAt = timestamp();
    try {
      await mkdir(job.jobDirectory, { recursive: true });
      job.status = "extracting";
      job.message = "正在校验并解压 ZIP。";
      const extraction = await extractZipArchive(
        job.uploadPath,
        job.extractionDirectory,
        this.zipLimits,
      );
      this.appendLog(
        job,
        `ZIP 解压完成：${extraction.fileCount} 个文件，${extraction.extractedBytes} B。`,
      );
      if (job.abortController.signal.aborted) {
        throw Object.assign(new Error("任务已取消。"), { code: "ABORTED" });
      }

      const inputDirectory = await findWebMobileRoot(job.extractionDirectory);
      job.status = "building";
      job.message = job.config.buildMode === "raw-single-html"
        ? "正在仅合并为未压缩单 HTML。"
        : "正在构建并优化单 HTML Playable。";
      const request = createWebBuildRequest(
        inputDirectory,
        job.outputFile,
        `web-${job.id.slice(0, 8)}`,
        job.config,
      );
      const result = await this.buildPlayableImpl(request, {
        projectRoot: this.projectRoot,
        scriptPath: job.config.buildMode === "raw-single-html"
          ? path.join(this.projectRoot, "src", "web", "raw-single-html-cli.ts")
          : undefined,
        signal: job.abortController.signal,
        onEvent: (event) => this.handleBuildEvent(job, event),
      });
      const reportInfo = await stat(result.reportFile).catch(() => null);
      if (!reportInfo?.isFile() || reportInfo.size === 0) {
        throw new Error(`构建报告不存在：${result.reportFile}`);
      }

      job.status = "succeeded";
      job.message = job.config.buildMode === "raw-single-html"
        ? "未压缩单 HTML 合并完成。"
        : "Playable 优化构建完成。";
      job.outputBytes = result.outputBytes;
      job.outputSha256 = result.outputSha256;
      job.completedAt = timestamp();
      job.links = {
        html: `/artifacts/${job.id}/game.html`,
        report: `/artifacts/${job.id}/report.json`,
        preview: `/preview/${job.id}/`,
      };
    } catch (error) {
      const cancelled = job.abortController.signal.aborted || errorCode(error) === "ABORTED";
      job.status = cancelled ? "cancelled" : "failed";
      job.message = cancelled ? "任务已取消。" : "Playable 构建失败。";
      job.completedAt = timestamp();
      job.error = {
        code: cancelled ? "ABORTED" : errorCode(error),
        message: errorMessage(error),
      };
      this.appendLog(job, `[error] ${errorMessage(error)}`);
    } finally {
      await rm(job.uploadPath, { force: true }).catch(() => undefined);
      await rm(job.extractionDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
