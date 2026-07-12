import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createChannelReport } from "../channel/channel-profile.js";
import type { BuildPlayableFunction } from "./web-job-manager.js";
import { WebJobManager } from "./web-job-manager.js";
import { createChannelWebMvpIndexHtml } from "./web-channel-ui.js";

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;

export interface WebMvpServerOptions {
  host?: string;
  port?: number;
  rootDirectory?: string;
  projectRoot?: string;
  buildPlayableImpl?: BuildPlayableFunction;
}

export interface RunningWebMvpServer {
  server: Server;
  manager: WebJobManager;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
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
  contentType = "text/plain; charset=utf-8",
): void {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function requestError(response: ServerResponse, statusCode: number, code: string, message: string): void {
  sendJson(response, statusCode, {
    error: { code, message },
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_JSON_BYTES) {
      throw new Error(`JSON 请求体超过限制 ${MAX_JSON_BYTES} B。`);
    }
    chunks.push(buffer);
  }
  if (bytes === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function saveUpload(
  request: IncomingMessage,
  manager: WebJobManager,
): Promise<{ uploadId: string; bytes: number; createdAt: string }> {
  const contentLengthValue = request.headers["content-length"];
  const contentLength = contentLengthValue === undefined ? null : Number(contentLengthValue);
  if (
    contentLength !== null
    && (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES)
  ) {
    throw new Error(`ZIP 大小必须在 1 B 到 ${MAX_UPLOAD_BYTES} B 之间。`);
  }

  const uploadId = randomUUID();
  const finalPath = manager.createUploadPath(uploadId);
  const temporaryPath = `${finalPath}.uploading`;
  const file = await open(temporaryPath, "wx");
  let bytes = 0;
  let header = Buffer.alloc(0);

  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_UPLOAD_BYTES) {
        throw new Error(`ZIP 大小超过限制 ${MAX_UPLOAD_BYTES} B。`);
      }
      if (header.length < 4) {
        header = Buffer.concat([header, buffer]).subarray(0, 4);
      }
      await file.write(buffer);
    }
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  await file.close();
  if (bytes === 0) {
    await rm(temporaryPath, { force: true });
    throw new Error("上传的 ZIP 为空。");
  }
  if (
    header.length < 4
    || ![0x04034b50, 0x06054b50].includes(header.readUInt32LE(0))
  ) {
    await rm(temporaryPath, { force: true });
    throw new Error("上传内容不是有效的 ZIP 文件头。");
  }

  await rename(temporaryPath, finalPath);
  return manager.registerUpload(uploadId, finalPath, bytes);
}

function jobIdFromPath(pathname: string, suffix = ""): string | null {
  const pattern = suffix.length === 0
    ? /^\/api\/jobs\/([0-9a-f-]{36})$/i
    : new RegExp(`^/api/jobs/([0-9a-f-]{36})/${suffix}$`, "i");
  return pattern.exec(pathname)?.[1] ?? null;
}

function artifactMatch(pathname: string): { jobId: string; artifact: "html" | "report" } | null {
  const match = /^\/artifacts\/([0-9a-f-]{36})\/(game\.html|report\.json)$/i.exec(pathname);
  if (match === null) {
    return null;
  }
  const jobId = match[1];
  const fileName = match[2];
  if (jobId === undefined || fileName === undefined) {
    return null;
  }
  return {
    jobId,
    artifact: fileName.toLowerCase() === "game.html" ? "html" : "report",
  };
}

function previewJobId(pathname: string): string | null {
  return /^\/preview\/([0-9a-f-]{36})\/?$/i.exec(pathname)?.[1] ?? null;
}

async function sendFile(
  response: ServerResponse,
  filePath: string,
  contentType: string,
  downloadName: string | null,
): Promise<void> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    requestError(response, 404, "ARTIFACT_NOT_FOUND", "构建产物不存在。");
    return;
  }
  const body = await readFile(filePath);
  const headers: Record<string, string | number> = {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (downloadName !== null) {
    headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
  }
  response.writeHead(200, headers);
  response.end(body);
}

async function sendChannelReport(
  response: ServerResponse,
  reportFile: string,
  manager: WebJobManager,
  jobId: string,
  downloadRequested: boolean,
): Promise<void> {
  const info = await stat(reportFile).catch(() => null);
  const job = manager.getJob(jobId);
  if (!info?.isFile() || job === null) {
    requestError(response, 404, "ARTIFACT_NOT_FOUND", "构建报告不存在。");
    return;
  }
  const parsed = JSON.parse(await readFile(reportFile, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    requestError(response, 500, "REPORT_INVALID", "构建报告根节点必须是对象。");
    return;
  }
  const report = parsed as Record<string, unknown>;
  report.channel = createChannelReport(job.config.channel);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (downloadRequested) {
    headers["Content-Disposition"] = "attachment; filename=\"game.report.json\"";
  }
  response.writeHead(200, headers);
  response.end(body);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  manager: WebJobManager,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/") {
    sendText(response, 200, createChannelWebMvpIndexHtml(), "text/html; charset=utf-8");
    return;
  }
  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (method === "POST" && pathname === "/api/uploads") {
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/zip" && contentType !== "application/octet-stream") {
      requestError(
        response,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "上传接口只接受 application/zip 或 application/octet-stream。",
      );
      return;
    }
    const upload = await saveUpload(request, manager);
    sendJson(response, 201, { upload });
    return;
  }
  if (method === "POST" && pathname === "/api/jobs") {
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      requestError(response, 400, "INVALID_REQUEST", "请求体必须是 JSON 对象。");
      return;
    }
    const source = body as Record<string, unknown>;
    if (typeof source.uploadId !== "string") {
      requestError(response, 400, "INVALID_REQUEST", "缺少 uploadId。");
      return;
    }
    const job = manager.createJob(source.uploadId, source.config);
    sendJson(response, 202, { job });
    return;
  }

  const getJobId = jobIdFromPath(pathname);
  if (method === "GET" && getJobId !== null) {
    const job = manager.getJob(getJobId);
    if (job === null) {
      requestError(response, 404, "JOB_NOT_FOUND", "任务不存在。");
      return;
    }
    sendJson(response, 200, { job });
    return;
  }

  const cancelJobId = jobIdFromPath(pathname, "cancel");
  if (method === "POST" && cancelJobId !== null) {
    const job = manager.cancelJob(cancelJobId);
    if (job === null) {
      requestError(response, 404, "JOB_NOT_FOUND", "任务不存在。");
      return;
    }
    sendJson(response, 200, { job });
    return;
  }

  const artifact = artifactMatch(pathname);
  if (method === "GET" && artifact !== null) {
    const filePath = manager.getArtifactPath(artifact.jobId, artifact.artifact);
    if (filePath === null) {
      requestError(response, 404, "ARTIFACT_NOT_FOUND", "任务尚未完成或构建产物不存在。");
      return;
    }
    const downloadRequested = url.searchParams.get("download") === "1";
    if (artifact.artifact === "report") {
      await sendChannelReport(response, filePath, manager, artifact.jobId, downloadRequested);
      return;
    }
    await sendFile(
      response,
      filePath,
      "text/html; charset=utf-8",
      downloadRequested ? "game.html" : null,
    );
    return;
  }

  const previewId = previewJobId(pathname);
  if (method === "GET" && previewId !== null) {
    const filePath = manager.getArtifactPath(previewId, "html");
    if (filePath === null) {
      requestError(response, 404, "PREVIEW_NOT_FOUND", "任务尚未完成或试玩文件不存在。");
      return;
    }
    await sendFile(response, filePath, "text/html; charset=utf-8", null);
    return;
  }

  requestError(response, 404, "NOT_FOUND", "接口不存在。");
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("端口必须是 0 到 65535 之间的整数。");
  }
  return port;
}

export async function startWebMvpServer(
  options: WebMvpServerOptions = {},
): Promise<RunningWebMvpServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4173;
  const manager = new WebJobManager({
    rootDirectory: options.rootDirectory ?? path.join(process.cwd(), ".packer-web"),
    projectRoot: options.projectRoot ?? process.cwd(),
    buildPlayableImpl: options.buildPlayableImpl,
  });
  await manager.initialize();

  const server = createServer((request, response) => {
    void handleRequest(request, response, manager).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        requestError(response, 400, "REQUEST_FAILED", message);
      } else {
        response.destroy(error instanceof Error ? error : new Error(message));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("无法确定 Web MVP 服务监听地址。");
  }
  const port = address.port;
  return {
    server,
    manager,
    host,
    port,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
}

async function main(): Promise<void> {
  const server = await startWebMvpServer({
    host: process.env.PLAYABLE_WEB_HOST ?? "127.0.0.1",
    port: parsePort(process.env.PLAYABLE_WEB_PORT, 4173),
    rootDirectory: process.env.PLAYABLE_WEB_ROOT,
    projectRoot: process.cwd(),
  });
  console.log("Cocos Playable Packer Web MVP");
  console.log("----------------------------");
  console.log(`地址：${server.url}`);
  console.log(`数据目录：${server.manager.rootDirectory}`);
}

const entryFile = process.argv[1];
if (entryFile !== undefined && import.meta.url === pathToFileURL(entryFile).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
