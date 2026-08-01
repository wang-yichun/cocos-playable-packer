import { access, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import {
  createChannelDownloadArtifact,
  createFacebookEncodedAssetMapArtifact,
  createFacebookSingleHtmlArtifact,
  createGoogleSingleHtmlArtifact,
  injectGoogleOrientationMeta,
} from "../channel/liftoff-delivery.js";
import { validateChannelArtifactFile } from "../channel/channel-spec-validation-file.js";

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
    const selectedChannels = request.build.channels ?? [];
    let result = await runPlayableBuild(request.build, {
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

    const sourceHtml = await readFile(result.outputFile, "utf8");
    const outputDirectory = path.dirname(result.outputFile);
    const generatedArtifacts: Array<{ fileName: string; body: Buffer; sha256: string }> = [];

    if (selectedChannels.includes("Facebook")) {
      const facebookConfig = {
        platform: "Facebook" as const,
        androidStoreUrl: request.build.androidStoreUrl ?? null,
        iosStoreUrl: request.build.iosStoreUrl ?? null,
      };
      const artifact = request.build.facebookArtifactFormat === "single-html"
        ? createFacebookSingleHtmlArtifact(sourceHtml, facebookConfig)
        : createFacebookEncodedAssetMapArtifact(sourceHtml, facebookConfig);
      const facebookOutputFile = path.join(outputDirectory, artifact.fileName);
      await writeFile(facebookOutputFile, artifact.body);
      const validation = await validateChannelArtifactFile(facebookOutputFile, "Facebook");
      const validationReportFile = `${facebookOutputFile}.channel-validation.json`;
      await writeFile(validationReportFile, `${JSON.stringify({
        inputFile: validation.inputFile,
        entries: validation.entries,
        ...validation.report,
      }, null, 2)}\n`, "utf8");
      if (!validation.report.valid) {
        throw new Error(`Meta / Facebook 渠道包校验失败：${validation.report.issues.map((issue) => issue.message).join("；")}`);
      }
      generatedArtifacts.push({ fileName: facebookOutputFile, body: artifact.body, sha256: artifact.sha256 });
      write({ type: "event", taskId: request.taskId, event: {
        type: "log", stream: "stdout", timestamp: new Date().toISOString(), elapsedMs: result.durationMs,
        line: `已生成 Meta / Facebook 渠道包：${facebookOutputFile}；校验报告：${validationReportFile}`,
      }});
    }

    if (selectedChannels.includes("Google")) {
      const googleConfig = {
        platform: "Google" as const,
        androidStoreUrl: request.build.androidStoreUrl ?? null,
        iosStoreUrl: request.build.iosStoreUrl ?? null,
      };
      const googleHtml = injectGoogleOrientationMeta(
        sourceHtml,
        request.build.googleOrientation ?? "portrait",
      );
      const artifact = request.build.googleArtifactFormat === "single-html"
        ? createGoogleSingleHtmlArtifact(googleHtml, googleConfig)
        : createChannelDownloadArtifact(googleHtml, googleConfig);
      const googleOutputFile = path.join(outputDirectory, artifact.fileName);
      await writeFile(googleOutputFile, artifact.body);
      const validation = await validateChannelArtifactFile(googleOutputFile, "Google");
      const validationReportFile = `${googleOutputFile}.channel-validation.json`;
      await writeFile(validationReportFile, `${JSON.stringify({
        inputFile: validation.inputFile,
        entries: validation.entries,
        ...validation.report,
      }, null, 2)}\n`, "utf8");
      if (!validation.report.valid && request.build.googleArtifactFormat !== "single-html") {
        throw new Error(`Google Ads 渠道包校验失败：${validation.report.issues.map((issue) => issue.message).join("；")}`);
      }
      generatedArtifacts.push({ fileName: googleOutputFile, body: artifact.body, sha256: artifact.sha256 });
      write({ type: "event", taskId: request.taskId, event: {
        type: "log", stream: "stdout", timestamp: new Date().toISOString(), elapsedMs: result.durationMs,
        line: request.build.googleArtifactFormat === "single-html"
          ? `已生成 Google Ads 单 HTML 测试产物：${googleOutputFile}；校验报告：${validationReportFile}`
          : `已生成 Google Ads 渠道包：${googleOutputFile}；校验报告：${validationReportFile}`,
      }});
    }

    if (selectedChannels.includes("AppLovin")) {
      const appLovinConfig = {
        platform: "AppLovin" as const,
        androidStoreUrl: request.build.androidStoreUrl ?? null,
        iosStoreUrl: request.build.iosStoreUrl ?? null,
      };
      const artifact = createChannelDownloadArtifact(sourceHtml, appLovinConfig);
      const appLovinOutputFile = path.join(outputDirectory, artifact.fileName);
      await writeFile(appLovinOutputFile, artifact.body);
      const validation = await validateChannelArtifactFile(appLovinOutputFile, "AppLovin");
      const validationReportFile = `${appLovinOutputFile}.channel-validation.json`;
      await writeFile(validationReportFile, `${JSON.stringify({
        inputFile: validation.inputFile,
        entries: validation.entries,
        ...validation.report,
      }, null, 2)}\n`, "utf8");
      if (!validation.report.valid) {
        throw new Error(`AppLovin 渠道包校验失败：${validation.report.issues.map((issue) => issue.message).join("；")}`);
      }
      generatedArtifacts.push({ fileName: appLovinOutputFile, body: artifact.body, sha256: artifact.sha256 });
      write({ type: "event", taskId: request.taskId, event: {
        type: "log", stream: "stdout", timestamp: new Date().toISOString(), elapsedMs: result.durationMs,
        line: `已生成 AppLovin 渠道包：${appLovinOutputFile}；校验报告：${validationReportFile}`,
      }});
    }

    const latestArtifact = generatedArtifacts.at(-1);
    if (latestArtifact !== undefined) {
      result = {
        ...result,
        outputFile: latestArtifact.fileName,
        outputBytes: latestArtifact.body.length,
        outputSha256: latestArtifact.sha256,
      };
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
