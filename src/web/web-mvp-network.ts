import { networkInterfaces } from "node:os";

export interface WebMvpNetworkAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

export type WebMvpNetworkInterfaces = Readonly<
  Record<string, readonly WebMvpNetworkAddress[] | undefined>
>;

export function normalizeWebMvpHost(value: string | undefined): string {
  const host = value?.trim();
  return host === undefined || host.length === 0 ? "0.0.0.0" : host;
}

export function parseWebMvpPort(value: string | undefined, fallback = 4173): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PLAYABLE_WEB_PORT 必须是 0 到 65535 之间的整数。");
  }
  return port;
}

export function isWildcardWebMvpHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function collectLanIpv4Addresses(interfaces: WebMvpNetworkInterfaces): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === "IPv4" || entry.family === 4;
      if (isIpv4 && !entry.internal && entry.address !== "0.0.0.0") {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function createWebMvpAccessUrls(
  host: string,
  port: number,
  interfaces: WebMvpNetworkInterfaces = networkInterfaces(),
): readonly string[] {
  if (host === "0.0.0.0") {
    return [
      `http://127.0.0.1:${port}`,
      ...collectLanIpv4Addresses(interfaces).map((address) => `http://${address}:${port}`),
    ];
  }
  if (host === "::") {
    return [
      `http://[::1]:${port}`,
      ...collectLanIpv4Addresses(interfaces).map((address) => `http://${address}:${port}`),
    ];
  }
  return [`http://${formatHostForUrl(host)}:${port}`];
}
