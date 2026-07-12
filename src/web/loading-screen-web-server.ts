import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  applyLoadingScreenToArtifact,
  normalizeLoadingScreenConfig,
  type LoadingScreenArtifactResult,
  type NormalizedLoadingScreenConfig,
} from "./loading-screen.js";
import { createLoadingScreenWebMvpIndexHtml } from "./loading-screen-ui.js";
import {
  startWebMvpServer,
  type RunningWebMvpServer,
  type WebMvpServerOptions,
} from "./web-mvp-server.js";

const MAX_LOADING_JOB_JSON_BYTES = 128 * 1024;

type JsonObject = Record<string, unknown>;

interface StoredLoadingScreenConfig extends NormalizedLoadingScreenConfig {
  logoDataUrl: string | null;
}

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

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_LOADING_JOB_JSON_BYTES) {
      throw new Error(`JSON 请求体超过限制 ${MAX_LOADING_JOB_JSON_BYTES} B。`);
    }
    chunks.push(buffer);
  }
  return bytes === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function jobIdFromStatusPath(pathname: string): string | null {
  return /^\/api\/jobs\/([0-9a-f-]{36})$/i.exec(pathname)?.[1] ?? null;
}

function jobIdFromArtifactPath(pathname: string): string | null {
  return /^(?:\/artifacts|\/preview)\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname)?.[1] ?? null;
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

export async function startLoadingScreenWebMvpServer(
  options: WebMvpServerOptions = {},
): Promise<RunningWebMvpServer> {
  const running = await startWebMvpServer(options);
  const requestListeners = running.server.listeners("request");
  if (requestListeners.length !== 1) {
    await running.close();
    throw new Error(`Web MVP request 监听器数量异常：${requestListeners.length}`);
  }
  const originalRequestListener = requestListeners[0] as RequestListener;
  running.server.removeListener("request", originalRequestListener);

  const loadingConfigs = new Map<string, StoredLoadingScreenConfig>();
  const appliedArtifacts = new Map<string, LoadingScreenArtifactResult>();
  const pendingApplications = new Map<string, Promise<LoadingScreenArtifactResult | null>>();

  function publicLoadingScreen(jobId: string): Record<string, unknown> | undefined {
    const config = loadingConfigs.get(jobId);
    if (config === undefined) {
      return undefined;
    }
    return {
      enabled: config.enabled,
      logoBytes: config.logoBytes,
      logoMimeType: config.logoMimeType,
    };
  }

  function decorateJob(
    job: ReturnType<typeof running.manager.getJob>,
  ): Record<string, unknown> | null {
    if (job === null) {
      return null;
    }
    const loadingScreen = publicLoadingScreen(job.id);
    const applied = appliedArtifacts.get(job.id);
    return {
      ...job,
      config: {
        ...job.config,
        ...(loadingScreen === undefined ? {} : { loadingScreen }),
      },
      outputBytes: applied?.outputBytes ?? job.outputBytes,
      outputSha256: applied?.outputSha256 ?? job.outputSha256,
    };
  }

  async function ensureLoadingScreenApplied(
    jobId: string,
  ): Promise<LoadingScreenArtifactResult | null> {
    const existing = appliedArtifacts.get(jobId);
    if (existing !== undefined) {
      return existing;
    }
    const pending = pendingApplications.get(jobId);
    if (pending !== undefined) {
      return pending;
    }

    const operation = (async (): Promise<LoadingScreenArtifactResult | null> => {
      const config = loadingConfigs.get(jobId);
      if (config === undefined || !config.enabled) {
        return null;
      }
      const htmlFile = running.manager.getArtifactPath(jobId, "html");
      const reportFile = running.manager.getArtifactPath(jobId, "report");
      if (htmlFile === null || reportFile === null) {
        return null;
      }
      const result = await applyLoadingScreenToArtifact(htmlFile, reportFile, config);
      appliedArtifacts.set(jobId, result);
      config.logoDataUrl = null;
      return result;
    })();

    pendingApplications.set(jobId, operation);
    try {
      return await operation;
    } finally {
      pendingApplications.delete(jobId);
    }
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/") {
      sendHtml(response, createLoadingScreenWebMvpIndexHtml(running.versionInfo));
      return;
    }

    if (method === "POST" && pathname === "/api/jobs") {
      const body = await readJsonBody(request);
      if (!isJsonObject(body) || typeof body.uploadId !== "string") {
        requestError(response, 400, "INVALID_REQUEST", "请求体必须包含 uploadId。");
        return;
      }
      const rawConfig = body.config;
      const configObject = isJsonObject(rawConfig) ? { ...rawConfig } : rawConfig;
      const loadingScreen = normalizeLoadingScreenConfig(
        isJsonObject(rawConfig) ? rawConfig.loadingScreen : undefined,
      );
      if (isJsonObject(configObject)) {
        delete configObject.loadingScreen;
      }
      const job = running.manager.createJob(body.uploadId, configObject);
      if (loadingScreen !== undefined) {
        loadingConfigs.set(job.id, { ...loadingScreen });
      }
      sendJson(response, 202, { job: decorateJob(job) });
      return;
    }

    const statusJobId = jobIdFromStatusPath(pathname);
    if (method === "GET" && statusJobId !== null) {
      const job = running.manager.getJob(statusJobId);
      if (job === null) {
        requestError(response, 404, "JOB_NOT_FOUND", "任务不存在。");
        return;
      }
      if (job.status === "succeeded") {
        await ensureLoadingScreenApplied(statusJobId);
      }
      sendJson(response, 200, { job: decorateJob(running.manager.getJob(statusJobId)) });
      return;
    }

    const artifactJobId = jobIdFromArtifactPath(pathname);
    if (method === "GET" && artifactJobId !== null) {
      await ensureLoadingScreenApplied(artifactJobId);
    }

    originalRequestListener(request, response);
  }

  running.server.on("request", (request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        requestError(response, 400, "REQUEST_FAILED", message);
      } else {
        response.destroy(error instanceof Error ? error : new Error(message));
      }
    });
  });

  return running;
}

async function main(): Promise<void> {
  const server = await startLoadingScreenWebMvpServer({
    host: process.env.PLAYABLE_WEB_HOST ?? "127.0.0.1",
    port: parsePort(process.env.PLAYABLE_WEB_PORT, 4173),
    rootDirectory: process.env.PLAYABLE_WEB_ROOT,
    projectRoot: process.cwd(),
  });
  console.log("Cocos Playable Packer Web MVP");
  console.log("----------------------------");
  console.log(`版本：v${server.versionInfo.appVersion} / Build ${server.versionInfo.buildShortSha}`);
  console.log(`地址：${server.url}`);
  console.log(`数据目录：${server.manager.rootDirectory}`);
  console.log("加载界面：支持内嵌 Logo 与蓝色进度条");
}

const entryFile = process.argv[1];
if (entryFile !== undefined && import.meta.url === pathToFileURL(entryFile).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
