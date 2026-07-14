import type { RequestListener } from "node:http";

import { createOverviewResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-overview-ui.js";
import { startResourceAnalysisWebMvpServer } from "./resource-analysis-web-server.js";
import type { RunningWebMvpServer, WebMvpServerOptions } from "./web-mvp-server.js";

export async function startEnhancedResourceAnalysisWebMvpServer(
  options: WebMvpServerOptions = {},
): Promise<RunningWebMvpServer> {
  const running = await startResourceAnalysisWebMvpServer(options);
  const listeners = running.server.listeners("request");
  if (listeners.length !== 1) {
    await running.close();
    throw new Error(`增强资源体检 request 监听器数量异常：${listeners.length}`);
  }
  const originalListener = listeners[0] as RequestListener;
  running.server.removeListener("request", originalListener);
  running.server.on("request", (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    if (method === "GET" && url.pathname === "/") {
      const body = createOverviewResourceAnalysisWebMvpIndexHtml(running.versionInfo);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(body);
      return;
    }
    originalListener(request, response);
  });
  return running;
}
