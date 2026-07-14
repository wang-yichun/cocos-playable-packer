import { randomUUID } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  createAssetsManifestUploaderCmd,
  createAssetsManifestUploaderModule,
} from "../resource-analysis/assets-manifest-uploader.js";
import { ResourceAnalysisWebManager } from "../resource-analysis/resource-analysis-web-manager.js";
import { startLoadingScreenWebMvpServer } from "./loading-screen-web-server.js";
import { createResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-ui.js";
import type { RunningWebMvpServer, WebMvpServerOptions } from "./web-mvp-server.js";

const MAX_ANALYSIS_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_ANALYSIS_MANIFEST_BYTES = 16 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
  downloadName: string | null = null,
): void {
  const headers: Record<string, string | number> = {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (downloadName !== null) {
    headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
  }
  response.writeHead(statusCode, headers);
  response.end(body);
}

function requestError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  sendJson(response, statusCode, { error: { code, message } });
}

async function readTextBody(request: IncomingMessage, maximumBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBytes) throw new Error(`请求体超过限制 ${maximumBytes} B。`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function saveZipBody(
  request: IncomingMessage,
  incomingDirectory: string,
): Promise<string> {
  const contentLengthHeader = request.headers["content-length"];
  const contentLength = contentLengthHeader === undefined ? null : Number(contentLengthHeader);
  if (
    contentLength !== null
    && (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_ANALYSIS_ZIP_BYTES)
  ) {
    throw new Error(`ZIP 大小必须在 1 B 到 ${MAX_ANALYSIS_ZIP_BYTES} B 之间。`);
  }

  await mkdir(incomingDirectory, { recursive: true });
  const id = randomUUID();
  const finalPath = path.join(incomingDirectory, `${id}.zip`);
  const temporaryPath = `${finalPath}.uploading`;
  const file = await open(temporaryPath, "wx");
  let bytes = 0;
  let header = Buffer.alloc(0);
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_ANALYSIS_ZIP_BYTES) {
        throw new Error(`ZIP 大小超过限制 ${MAX_ANALYSIS_ZIP_BYTES} B。`);
      }
      if (header.length < 4) header = Buffer.concat([header, buffer]).subarray(0, 4);
      await file.write(buffer);
    }
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await file.close();
  if (
    bytes === 0
    || header.length < 4
    || ![0x04034b50, 0x06054b50].includes(header.readUInt32LE(0))
  ) {
    await rm(temporaryPath, { force: true });
    throw new Error("上传内容不是有效的 ZIP 文件。");
  }
  await rename(temporaryPath, finalPath);
  return finalPath;
}

function analysisJobPath(pathname: string, suffix = ""): string | null {
  const pattern = suffix.length === 0
    ? /^\/api\/resource-analysis\/jobs\/([0-9a-f-]{36})$/i
    : new RegExp(`^/api/resource-analysis/jobs/([0-9a-f-]{36})/${suffix}$`, "i");
  return pattern.exec(pathname)?.[1] ?? null;
}

function reportArtifact(pathname: string): { jobId: string; format: "json" | "html" } | null {
  const match = /^\/artifacts\/resource-analysis\/([0-9a-f-]{36})\/report\.(json|html)$/i.exec(pathname);
  const jobId = match?.[1];
  const extension = match?.[2]?.toLowerCase();
  if (jobId === undefined || (extension !== "json" && extension !== "html")) return null;
  return { jobId, format: extension };
}

function requestBaseUrl(request: IncomingMessage): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" && forwardedProto.length > 0
    ? forwardedProto.split(",", 1)[0]?.trim() ?? "http"
    : "http";
  const host = request.headers.host ?? "127.0.0.1";
  return `${protocol}://${host}`;
}

export async function startResourceAnalysisWebMvpServer(
  options: WebMvpServerOptions = {},
): Promise<RunningWebMvpServer> {
  const running = await startLoadingScreenWebMvpServer(options);
  const listeners = running.server.listeners("request");
  if (listeners.length !== 1) {
    await running.close();
    throw new Error(`Web MVP request 监听器数量异常：${listeners.length}`);
  }
  const originalListener = listeners[0] as RequestListener;
  running.server.removeListener("request", originalListener);

  const analysisManager = new ResourceAnalysisWebManager({
    rootDirectory: running.manager.rootDirectory,
    projectRoot: options.projectRoot,
  });
  await analysisManager.initialize();
  const incomingDirectory = path.join(analysisManager.rootDirectory, "resource-analysis", "incoming");

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/") {
      sendText(
        response,
        200,
        createResourceAnalysisWebMvpIndexHtml(running.versionInfo),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (method === "POST" && pathname === "/api/resource-analysis/jobs") {
      const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/zip" && contentType !== "application/octet-stream") {
        requestError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "资源体检只接受 ZIP 文件。");
        return;
      }
      const temporaryZip = await saveZipBody(request, incomingDirectory);
      const job = await analysisManager.createJob(temporaryZip);
      sendJson(response, 201, { job });
      return;
    }

    const getJobId = analysisJobPath(pathname);
    if (method === "GET" && getJobId !== null) {
      const job = analysisManager.getJob(getJobId);
      if (job === null) {
        requestError(response, 404, "ANALYSIS_JOB_NOT_FOUND", "资源体检任务不存在。");
        return;
      }
      sendJson(response, 200, { job });
      return;
    }

    const manifestJobId = analysisJobPath(pathname, "manifest");
    if (method === "POST" && manifestJobId !== null) {
      const token = typeof request.headers["x-analysis-upload-token"] === "string"
        ? request.headers["x-analysis-upload-token"]
        : undefined;
      if (token !== undefined && !analysisManager.validateUploadToken(manifestJobId, token)) {
        requestError(response, 403, "INVALID_UPLOAD_TOKEN", "资源清单上传令牌无效或已过期。");
        return;
      }
      const body = await readTextBody(request, MAX_ANALYSIS_MANIFEST_BYTES);
      const job = await analysisManager.saveManifest(manifestJobId, body);
      sendJson(response, 200, { job });
      return;
    }

    const startJobId = analysisJobPath(pathname, "start");
    if (method === "POST" && startJobId !== null) {
      const text = await readTextBody(request, 64 * 1024);
      const parsed = text.length === 0 ? {} : JSON.parse(text) as unknown;
      if (!isJsonObject(parsed)) {
        requestError(response, 400, "INVALID_REQUEST", "启动参数必须是 JSON 对象。");
        return;
      }
      const requireManifest = parsed.requireManifest === true;
      const measurePayloadEncoding = parsed.measurePayloadEncoding === true;
      const job = analysisManager.start(startJobId, requireManifest, measurePayloadEncoding);
      sendJson(response, 202, { job });
      return;
    }

    const cmdJobId = analysisJobPath(pathname, "assets-manifest.cmd");
    if (method === "GET" && cmdJobId !== null) {
      const token = analysisManager.getUploadToken(cmdJobId);
      const job = analysisManager.getJob(cmdJobId);
      if (token === null || job === null || job.status !== "waiting") {
        requestError(response, 404, "CMD_NOT_AVAILABLE", "工程扫描 CMD 不存在或已失效。");
        return;
      }
      const measurePayloadEncoding = url.searchParams.get("measurePayloadEncoding") === "1";
      const baseUrl = requestBaseUrl(request);
      const moduleUrl = `${baseUrl}/api/resource-analysis/jobs/${cmdJobId}/assets-manifest-uploader.mjs?token=${encodeURIComponent(token)}&measurePayloadEncoding=${measurePayloadEncoding ? "1" : "0"}`;
      const cmd = createAssetsManifestUploaderCmd(moduleUrl, `cocos-assets-manifest-${cmdJobId.slice(0, 8)}`);
      sendText(response, 200, cmd, "application/octet-stream", "upload-assets-manifest.cmd");
      return;
    }

    const moduleJobId = analysisJobPath(pathname, "assets-manifest-uploader.mjs");
    if (method === "GET" && moduleJobId !== null) {
      const token = url.searchParams.get("token") ?? undefined;
      if (!analysisManager.validateUploadToken(moduleJobId, token)) {
        requestError(response, 403, "INVALID_UPLOAD_TOKEN", "扫描器下载令牌无效或已过期。");
        return;
      }
      const measurePayloadEncoding = url.searchParams.get("measurePayloadEncoding") === "1";
      const baseUrl = requestBaseUrl(request);
      const module = createAssetsManifestUploaderModule(
        `${baseUrl}/api/resource-analysis/jobs/${moduleJobId}/manifest`,
        `${baseUrl}/api/resource-analysis/jobs/${moduleJobId}/start`,
        token ?? "",
        measurePayloadEncoding,
      );
      sendText(response, 200, module, "text/javascript; charset=utf-8");
      return;
    }

    const report = reportArtifact(pathname);
    if (method === "GET" && report !== null) {
      const reportFile = analysisManager.getReportPath(report.jobId, report.format);
      const info = reportFile === null ? null : await stat(reportFile).catch(() => null);
      if (reportFile === null || !info?.isFile()) {
        requestError(response, 404, "ANALYSIS_REPORT_NOT_FOUND", "资源体检报告尚未生成。");
        return;
      }
      const body = await readFile(reportFile, "utf8");
      const isDownload = url.searchParams.get("download") === "1";
      sendText(
        response,
        200,
        body,
        report.format === "html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
        isDownload
          ? report.format === "html"
            ? "resource-analysis.html"
            : "resource-analysis.json"
          : null,
      );
      return;
    }

    originalListener(request, response);
  }

  running.server.on("request", (request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        requestError(response, 400, "RESOURCE_ANALYSIS_REQUEST_FAILED", message);
      } else {
        response.destroy(error instanceof Error ? error : new Error(message));
      }
    });
  });

  return running;
}
