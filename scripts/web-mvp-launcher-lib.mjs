import path from "node:path";

export const DEFAULT_WEB_MVP_HOST = "0.0.0.0";
export const DEFAULT_WEB_MVP_PORT = 4173;

export function normalizeLauncherHost(value) {
  const host = value?.trim();
  return host ? host : DEFAULT_WEB_MVP_HOST;
}

export function parseLauncherPort(value, fallback = DEFAULT_WEB_MVP_PORT) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PLAYABLE_WEB_PORT must be an integer from 1 to 65535.");
  }
  return port;
}

export function isWildcardHost(host) {
  const normalized = host.trim().toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]";
}

export function formatHttpUrl(host, port) {
  const trimmed = host.trim();
  const formattedHost = trimmed.includes(":") && !trimmed.startsWith("[")
    ? `[${trimmed}]`
    : trimmed;
  return `http://${formattedHost}:${port}`;
}

export function collectLanIPv4(networkInterfaces) {
  const addresses = new Set();
  for (const entries of Object.values(networkInterfaces ?? {})) {
    for (const entry of entries ?? []) {
      const family = entry.family;
      const isIPv4 = family === "IPv4" || family === 4;
      if (!isIPv4 || entry.internal || typeof entry.address !== "string") {
        continue;
      }
      const address = entry.address.trim();
      if (
        address.length === 0
        || address.startsWith("127.")
        || address.startsWith("169.254.")
        || address === "0.0.0.0"
      ) {
        continue;
      }
      addresses.add(address);
    }
  }
  return [...addresses].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

export function createLauncherAccessUrls(host, port, networkInterfaces) {
  if (!isWildcardHost(host)) {
    const url = formatHttpUrl(host, port);
    return { localUrl: url, lanUrls: [], allUrls: [url] };
  }

  const localUrl = formatHttpUrl(host.includes(":") ? "::1" : "127.0.0.1", port);
  const lanUrls = collectLanIPv4(networkInterfaces).map((address) => formatHttpUrl(address, port));
  return { localUrl, lanUrls, allUrls: [localUrl, ...lanUrls] };
}

export function resolveLauncherPaths(projectRoot) {
  const stateDirectory = path.join(projectRoot, ".packer-web", "launcher");
  return {
    stateDirectory,
    stateFile: path.join(stateDirectory, "service.json"),
    logFile: path.join(stateDirectory, "web-mvp.log"),
  };
}

export function normalizeLauncherState(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const state = value;
  if (
    state.schemaVersion !== 1
    || !Number.isInteger(state.pid)
    || state.pid <= 0
    || typeof state.projectRoot !== "string"
    || typeof state.host !== "string"
    || !Number.isInteger(state.port)
    || typeof state.url !== "string"
    || typeof state.logFile !== "string"
    || typeof state.startedAt !== "string"
  ) {
    return null;
  }
  return state;
}
