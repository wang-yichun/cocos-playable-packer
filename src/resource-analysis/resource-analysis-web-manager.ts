import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { extractZipArchive, findWebMobileRoot } from "../web/zip-extractor.js";
import type { AssetsManifest } from "./assets-manifest.js";
import {
  analyzeJointResources,
  readAssetsManifest,
} from "./joint-resource-analysis.js";
import {
  createResourceAnalysisHtmlReport,
  type CompleteResourceAnalysisReport,
} from "./resource-analysis-report.js";
import { analyzeResourceOptimization } from "./resource-optimization-estimates.js";

export type ResourceAnalysisJobStatus =
  | "waiting"
  | "extracting"
  | "analyzing"
  | "succeeded"
  | "failed";

export interface PublicResourceAnalysisJob {
  id: string;
  status: ResourceAnalysisJobStatus;
  message: string;
  createdAt: string;
  completedAt: string | null;
  hasManifest: boolean;
  mode: "build-only" | "joint" | null;
  error: { code: string; message: string } | null;
  summary: {
    buildFileCount: number;
    buildBytes: number;
    includedCount: number;
    notInBuildCount: number;
    notAssessableCount: number;
    assessableIncludedPercentByCount: number | null;
    assessableIncludedPercentByBytes: number | null;
    estimatedSavingsBytesMin: number;
    estimatedSavingsBytesMax: number;
    totalBuildSavingsPercentMin: number;
    totalBuildSavingsPercentMax: number;
  } | null;
  links: { report: string; htmlReport: string; manifestCmd: string };
}

interface InternalResourceAnalysisJob extends Omit<PublicResourceAnalysisJob, "links"> {
  directory: string;
  zipFile: string;
  manifestFile: string;
  reportFile: string;
  htmlReportFile: string;
  uploadToken: string;
  tokenExpiresAt: number;
}

export interface ResourceAnalysisWebManagerOptions {
  rootDirectory: string;
  tokenLifetimeMs?: number;
}

function now(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneJob(job: InternalResourceAnalysisJob): PublicResourceAnalysisJob {
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    hasManifest: job.hasManifest,
    mode: job.mode,
    error: job.error === null ? null : { ...job.error },
    summary: job.summary === null ? null : { ...job.summary },
    links: {
      report: `/artifacts/resource-analysis/${job.id}/report.json`,
      htmlReport: `/artifacts/resource-analysis/${job.id}/report.html`,
      manifestCmd: `/api/resource-analysis/jobs/${job.id}/assets-manifest.cmd`,
    },
  };
}

function emptyManifest(projectName: string): AssetsManifest {
  return {
    version: 1,
    generatedAt: now(),
    projectName,
    assetsRoot: "assets",
    resourceCount: 0,
    totalBytes: 0,
    metaCount: 0,
    missingMetaCount: 0,
    entries: [],
  };
}

export class ResourceAnalysisWebManager {
  readonly rootDirectory: string;
  readonly jobsDirectory: string;

  private readonly tokenLifetimeMs: number;
  private readonly jobs = new Map<string, InternalResourceAnalysisJob>();

  constructor(options: ResourceAnalysisWebManagerOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory);
    this.jobsDirectory = path.join(this.rootDirectory, "resource-analysis", "jobs");
    this.tokenLifetimeMs = options.tokenLifetimeMs ?? 30 * 60 * 1000;
  }

  async initialize(): Promise<void> {
    await mkdir(this.jobsDirectory, { recursive: true });
  }

  async createJob(zipFile: string): Promise<PublicResourceAnalysisJob> {
    const zipStat = await stat(zipFile).catch(() => null);
    if (!zipStat?.isFile() || zipStat.size <= 0) {
      throw new Error("资源分析 ZIP 不存在或为空。");
    }
    const id = randomUUID();
    const directory = path.join(this.jobsDirectory, id);
    await mkdir(path.join(directory, "input"), { recursive: true });
    const finalZip = path.join(directory, "input", "web-mobile.zip");
    await copyFile(zipFile, finalZip);
    await rm(zipFile, { force: true });

    const job: InternalResourceAnalysisJob = {
      id,
      status: "waiting",
      message: "构建 ZIP 已接收，可进行基础分析或补充工程资源清单。",
      createdAt: now(),
      completedAt: null,
      hasManifest: false,
      mode: null,
      error: null,
      summary: null,
      directory,
      zipFile: finalZip,
      manifestFile: path.join(directory, "input", "assets-manifest.json"),
      reportFile: path.join(directory, "output", "resource-analysis.json"),
      htmlReportFile: path.join(directory, "output", "resource-analysis.html"),
      uploadToken: randomUUID(),
      tokenExpiresAt: Date.now() + this.tokenLifetimeMs,
    };
    this.jobs.set(id, job);
    return cloneJob(job);
  }

  getJob(jobId: string): PublicResourceAnalysisJob | null {
    const job = this.jobs.get(jobId);
    return job === undefined ? null : cloneJob(job);
  }

  getUploadToken(jobId: string): string | null {
    const job = this.jobs.get(jobId);
    return job === undefined ? null : job.uploadToken;
  }

  validateUploadToken(jobId: string, token: string | undefined): boolean {
    const job = this.jobs.get(jobId);
    return job !== undefined
      && job.status === "waiting"
      && Date.now() <= job.tokenExpiresAt
      && token === job.uploadToken;
  }

  async saveManifest(jobId: string, body: string): Promise<PublicResourceAnalysisJob> {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error("资源分析任务不存在。");
    if (job.status !== "waiting") throw new Error("任务已经开始，不能再上传资源清单。");
    await mkdir(path.dirname(job.manifestFile), { recursive: true });
    await writeFile(job.manifestFile, body, "utf8");
    await readAssetsManifest(job.manifestFile);
    job.hasManifest = true;
    job.message = "工程资源清单已接收，可以开始完整分析。";
    job.uploadToken = randomUUID();
    job.tokenExpiresAt = 0;
    return cloneJob(job);
  }

  start(jobId: string, requireManifest: boolean): PublicResourceAnalysisJob {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error("资源分析任务不存在。");
    if (job.status !== "waiting") throw new Error("资源分析任务已经开始或结束。");
    if (requireManifest && !job.hasManifest) {
      throw new Error("完整分析必须先上传 assets-manifest.json。");
    }
    job.mode = job.hasManifest ? "joint" : "build-only";
    void this.run(job);
    return cloneJob(job);
  }

  getReportPath(jobId: string, format: "json" | "html" = "json"): string | null {
    const job = this.jobs.get(jobId);
    if (job?.status !== "succeeded") return null;
    return format === "html" ? job.htmlReportFile : job.reportFile;
  }

  private async run(job: InternalResourceAnalysisJob): Promise<void> {
    try {
      job.status = "extracting";
      job.message = "正在校验并解压 Web Mobile ZIP。";
      const extractionDirectory = path.join(job.directory, "source");
      await extractZipArchive(job.zipFile, extractionDirectory);
      const buildRoot = await findWebMobileRoot(extractionDirectory);

      job.status = "analyzing";
      job.message = job.hasManifest
        ? "正在关联源资源，并实测图片、估算音频优化空间。"
        : "正在分析构建资源，并实测图片、估算音频优化空间。";
      const manifest = job.hasManifest
        ? await readAssetsManifest(job.manifestFile)
        : emptyManifest(path.basename(buildRoot));
      const joint = await analyzeJointResources(buildRoot, manifest);
      joint.buildRoot = path.basename(buildRoot);
      const optimization = await analyzeResourceOptimization(buildRoot, joint);
      const report: CompleteResourceAnalysisReport = { ...joint, optimization };
      const html = createResourceAnalysisHtmlReport(report);
      await mkdir(path.dirname(job.reportFile), { recursive: true });
      await Promise.all([
        writeFile(job.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
        writeFile(job.htmlReportFile, html, "utf8"),
      ]);

      job.status = "succeeded";
      job.message = job.hasManifest ? "完整资源体检完成。" : "构建资源基础体检完成。";
      job.completedAt = now();
      job.summary = {
        buildFileCount: report.buildFileCount,
        buildBytes: report.buildBytes,
        includedCount: report.includedCount,
        notInBuildCount: report.notInBuildCount,
        notAssessableCount: report.notAssessableCount,
        assessableIncludedPercentByCount: report.assessableIncludedPercentByCount,
        assessableIncludedPercentByBytes: report.assessableIncludedPercentByBytes,
        estimatedSavingsBytesMin: report.optimization.estimatedSavingsBytesMin,
        estimatedSavingsBytesMax: report.optimization.estimatedSavingsBytesMax,
        totalBuildSavingsPercentMin: report.optimization.totalBuildSavingsPercentMin,
        totalBuildSavingsPercentMax: report.optimization.totalBuildSavingsPercentMax,
      };
    } catch (error) {
      job.status = "failed";
      job.message = "资源体检失败。";
      job.completedAt = now();
      job.error = { code: "RESOURCE_ANALYSIS_FAILED", message: errorMessage(error) };
    }
  }
}
