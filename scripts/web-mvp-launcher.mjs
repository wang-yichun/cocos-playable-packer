#!/usr/bin/env node

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  createLauncherAccessUrls,
  normalizeLauncherHost,
  normalizeLauncherState,
  parseLauncherPort,
  resolveLauncherPaths,
} from "./web-mvp-launcher-lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const launcherPaths = resolveLauncherPaths(projectRoot);
const action = process.argv[2] ?? "start";
const flags = new Set(process.argv.slice(3));
const noOpen = flags.has("--no-open") || process.env.PLAYABLE_WEB_NO_OPEN === "1";

function printHeader() {
  console.log("Cocos Playable Packer Web MVP Launcher");
  console.log("--------------------------------------");
}

function readLauncherState() {
  if (!existsSync(launcherPaths.stateFile)) {
    return null;
  }
  try {
    return normalizeLauncherState(JSON.parse(readFileSync(launcherPaths.stateFile, "utf8")));
  } catch {
    return null;
  }
}

function writeLauncherState(state) {
  mkdirSync(launcherPaths.stateDirectory, { recursive: true });
  const temporaryFile = `${launcherPaths.stateFile}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporaryFile, launcherPaths.stateFile);
}

function removeLauncherState() {
  rmSync(launcherPaths.stateFile, { force: true });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function runNpm(args, options = {}) {
  if (process.platform === "win32") {
    const command = ["npm", ...args].join(" ");
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
      cwd: projectRoot,
      windowsHide: true,
      ...options,
    });
  }
  return spawnSync("npm", args, { cwd: projectRoot, ...options });
}

function ensureNpmAvailable() {
  const result = runNpm(["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error("npm is unavailable. Install Node.js 22 and reopen this launcher.");
  }
  console.log(`Node.js: ${process.version}`);
  console.log(`npm: ${String(result.stdout).trim()}`);
}

function ensureDependencies() {
  const executable = process.platform === "win32"
    ? path.join(projectRoot, "node_modules", ".bin", "tsx.cmd")
    : path.join(projectRoot, "node_modules", ".bin", "tsx");
  if (existsSync(executable)) {
    console.log("Dependencies: ready");
    return;
  }

  console.log("Dependencies: missing; running npm ci...");
  const result = runNpm(["ci"], { stdio: "inherit" });
  if (result.error || result.status !== 0 || !existsSync(executable)) {
    throw new Error("npm ci failed or the local tsx executable is still missing.");
  }
  console.log("Dependencies: installed");
}

function hasFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

async function healthIsReady(url, timeoutMs = 1_500) {
  try {
    const response = await fetch(`${url}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    return payload?.status === "ok";
  } catch {
    return false;
  }
}

async function waitForHealth(url, timeoutMs, expectedReady) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthIsReady(url) === expectedReady) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return await healthIsReady(url) === expectedReady;
}

function tcpHostForListener(host) {
  const normalized = host.trim().toLowerCase();
  if (normalized === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (normalized === "::" || normalized === "[::]") {
    return "::1";
  }
  return host.replace(/^\[|\]$/g, "");
}

async function tcpPortIsOpen(host, port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: tcpHostForListener(host), port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function showAccessInformation(host, port) {
  const urls = createLauncherAccessUrls(host, port, os.networkInterfaces());
  console.log(`Local: ${urls.localUrl}`);
  for (const url of urls.lanUrls) {
    console.log(`LAN: ${url}`);
  }
  if (host === "0.0.0.0" && urls.lanUrls.length === 0) {
    console.log("LAN: no external IPv4 address detected; check ipconfig.");
  }
  return urls;
}

function openBrowser(url) {
  if (noOpen) {
    console.log("Browser: skipped (--no-open)");
    return;
  }

  let command;
  let args;
  if (process.platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    console.log("Browser: opened");
  } catch {
    console.log(`Browser: could not open automatically; use ${url}`);
  }
}

function tailLog(lineCount = 30) {
  if (!existsSync(launcherPaths.logFile)) {
    return "";
  }
  const lines = readFileSync(launcherPaths.logFile, "utf8").split(/\r?\n/);
  return lines.slice(-lineCount).join("\n").trim();
}

async function spawnService(host, port) {
  mkdirSync(launcherPaths.stateDirectory, { recursive: true });
  appendFileSync(
    launcherPaths.logFile,
    `\n[launcher ${new Date().toISOString()}] starting Web MVP on ${host}:${port}\n`,
    "utf8",
  );
  const logDescriptor = openSync(launcherPaths.logFile, "a");
  const environment = {
    ...process.env,
    PLAYABLE_WEB_HOST: host,
    PLAYABLE_WEB_PORT: String(port),
  };

  let child;
  try {
    child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run web:mvp"], {
          cwd: projectRoot,
          env: environment,
          detached: true,
          stdio: ["ignore", logDescriptor, logDescriptor],
          windowsHide: true,
        })
      : spawn("npm", ["run", "web:mvp"], {
          cwd: projectRoot,
          env: environment,
          detached: true,
          stdio: ["ignore", logDescriptor, logDescriptor],
        });

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } finally {
    closeSync(logDescriptor);
  }

  if (!Number.isInteger(child.pid)) {
    throw new Error("The Web MVP process did not return a PID.");
  }
  child.unref();
  return child.pid;
}

function inspectWindowsCommandLine(pid) {
  if (process.platform !== "win32") {
    return null;
  }
  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($null -ne $p) { [Console]::Out.Write($p.CommandLine) }`;
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const commandLine = String(result.stdout).trim();
  return commandLine.length === 0 ? null : commandLine;
}

async function terminateProcessTree(pid) {
  if (!processExists(pid)) {
    return;
  }

  if (process.platform === "win32") {
    const commandLine = inspectWindowsCommandLine(pid);
    if (commandLine !== null && !commandLine.toLowerCase().includes("web:mvp")) {
      throw new Error(`PID ${pid} no longer belongs to the Web MVP launcher; refusing to terminate it.`);
    }
    const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error || ![0, 128].includes(result.status ?? -1)) {
      throw new Error(`Failed to terminate Web MVP process tree (PID ${pid}).`);
    }
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
  const deadline = Date.now() + 5_000;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (processExists(pid)) {
    process.kill(-pid, "SIGKILL");
  }
}

async function start() {
  const host = normalizeLauncherHost(process.env.PLAYABLE_WEB_HOST);
  const port = parseLauncherPort(process.env.PLAYABLE_WEB_PORT);
  const requestedUrls = createLauncherAccessUrls(host, port, os.networkInterfaces());

  if (await healthIsReady(requestedUrls.localUrl)) {
    console.log("Status: already running");
    showAccessInformation(host, port);
    openBrowser(requestedUrls.localUrl);
    return;
  }

  const existingState = readLauncherState();
  if (existingState !== null && processExists(existingState.pid)) {
    const ready = await waitForHealth(existingState.url, 10_000, true);
    if (ready) {
      console.log(`Status: already running (PID ${existingState.pid})`);
      showAccessInformation(existingState.host, existingState.port);
      console.log(`Log: ${existingState.logFile}`);
      openBrowser(existingState.url);
      return;
    }
    throw new Error(
      `Managed process PID ${existingState.pid} is alive but the health endpoint is unavailable. Run stop-web-mvp.cmd, then try again.`,
    );
  }
  if (existingState !== null) {
    console.log(`State: removed stale PID ${existingState.pid}`);
    removeLauncherState();
  }

  if (await tcpPortIsOpen(host, port)) {
    throw new Error(`Port ${port} is already occupied by another service.`);
  }

  ensureNpmAvailable();
  ensureDependencies();
  console.log(`FFmpeg: ${hasFfmpeg() ? "available" : "not found (audio compression will be unavailable)"}`);

  const pid = await spawnService(host, port);
  const state = {
    schemaVersion: 1,
    pid,
    projectRoot,
    host,
    port,
    url: requestedUrls.localUrl,
    logFile: launcherPaths.logFile,
    startedAt: new Date().toISOString(),
  };
  writeLauncherState(state);

  if (!await waitForHealth(state.url, 30_000, true)) {
    await terminateProcessTree(pid).catch(() => undefined);
    removeLauncherState();
    const log = tailLog();
    throw new Error(
      `Web MVP did not become healthy within 30 seconds.${log ? `\n\nRecent log:\n${log}` : ""}`,
    );
  }

  console.log(`Status: started (PID ${pid})`);
  showAccessInformation(host, port);
  console.log(`Log: ${launcherPaths.logFile}`);
  console.log("Closing this launcher window will not stop the service.");
  openBrowser(state.url);
}

async function stop() {
  const state = readLauncherState();
  if (state === null) {
    const host = normalizeLauncherHost(process.env.PLAYABLE_WEB_HOST);
    const port = parseLauncherPort(process.env.PLAYABLE_WEB_PORT);
    const url = createLauncherAccessUrls(host, port, os.networkInterfaces()).localUrl;
    if (await healthIsReady(url)) {
      throw new Error(
        `Web MVP is reachable at ${url}, but it was not started by this launcher. Stop its terminal with Ctrl+C.`,
      );
    }
    console.log("Status: not running");
    return;
  }

  if (path.resolve(state.projectRoot) !== projectRoot) {
    throw new Error("Launcher state belongs to a different project directory.");
  }

  if (!processExists(state.pid)) {
    removeLauncherState();
    console.log(`Status: removed stale state for PID ${state.pid}`);
    return;
  }

  console.log(`Stopping PID ${state.pid}...`);
  await terminateProcessTree(state.pid);
  await waitForHealth(state.url, 10_000, false);
  removeLauncherState();
  appendFileSync(
    launcherPaths.logFile,
    `[launcher ${new Date().toISOString()}] stopped Web MVP PID ${state.pid}\n`,
    "utf8",
  );
  console.log("Status: stopped");
  console.log(`Log: ${state.logFile}`);
}

async function status() {
  const state = readLauncherState();
  if (state === null) {
    console.log("Managed state: none");
    return;
  }
  const alive = processExists(state.pid);
  const healthy = await healthIsReady(state.url);
  console.log(`PID: ${state.pid}`);
  console.log(`Process: ${alive ? "alive" : "not running"}`);
  console.log(`Health: ${healthy ? "ready" : "unavailable"}`);
  console.log(`URL: ${state.url}`);
  console.log(`Log: ${state.logFile}`);
}

async function main() {
  printHeader();
  switch (action) {
    case "start":
      await start();
      break;
    case "stop":
      await stop();
      break;
    case "status":
      await status();
      break;
    default:
      throw new Error(`Unknown action: ${action}. Use start, stop, or status.`);
  }
}

main().catch((error) => {
  console.error("");
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
