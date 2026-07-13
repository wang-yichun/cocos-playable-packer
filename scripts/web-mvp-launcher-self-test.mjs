import assert from "node:assert/strict";
import path from "node:path";

import {
  collectLanIPv4,
  createLauncherAccessUrls,
  DEFAULT_WEB_MVP_HOST,
  DEFAULT_WEB_MVP_PORT,
  formatHttpUrl,
  isWildcardHost,
  normalizeLauncherHost,
  normalizeLauncherState,
  parseLauncherPort,
  resolveLauncherPaths,
} from "./web-mvp-launcher-lib.mjs";

assert.equal(normalizeLauncherHost(undefined), DEFAULT_WEB_MVP_HOST);
assert.equal(normalizeLauncherHost(" 127.0.0.1 "), "127.0.0.1");
assert.equal(parseLauncherPort(undefined), DEFAULT_WEB_MVP_PORT);
assert.equal(parseLauncherPort("5173"), 5173);
assert.throws(() => parseLauncherPort("0"), /1 to 65535/);
assert.throws(() => parseLauncherPort("abc"), /1 to 65535/);
assert.equal(isWildcardHost("0.0.0.0"), true);
assert.equal(isWildcardHost("::"), true);
assert.equal(isWildcardHost("127.0.0.1"), false);
assert.equal(formatHttpUrl("127.0.0.1", 4173), "http://127.0.0.1:4173");
assert.equal(formatHttpUrl("::1", 4173), "http://[::1]:4173");

const interfaces = {
  Ethernet: [
    { address: "192.168.1.20", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false },
  ],
  WiFi: [
    { address: "10.0.0.8", family: 4, internal: false },
    { address: "192.168.1.20", family: "IPv4", internal: false },
  ],
  Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  LinkLocal: [{ address: "169.254.10.2", family: "IPv4", internal: false }],
};
assert.deepEqual(collectLanIPv4(interfaces), ["10.0.0.8", "192.168.1.20"]);
assert.deepEqual(createLauncherAccessUrls("0.0.0.0", 4173, interfaces), {
  localUrl: "http://127.0.0.1:4173",
  lanUrls: ["http://10.0.0.8:4173", "http://192.168.1.20:4173"],
  allUrls: [
    "http://127.0.0.1:4173",
    "http://10.0.0.8:4173",
    "http://192.168.1.20:4173",
  ],
});
assert.deepEqual(createLauncherAccessUrls("127.0.0.1", 5173, interfaces), {
  localUrl: "http://127.0.0.1:5173",
  lanUrls: [],
  allUrls: ["http://127.0.0.1:5173"],
});

const paths = resolveLauncherPaths(path.resolve("C:/test/project"));
assert.match(paths.stateFile.replaceAll("\\", "/"), /\.packer-web\/launcher\/service\.json$/);
assert.equal(normalizeLauncherState(null), null);
assert.equal(normalizeLauncherState({ schemaVersion: 1 }), null);
assert.notEqual(normalizeLauncherState({
  schemaVersion: 1,
  pid: 123,
  projectRoot: "C:/test/project",
  host: "0.0.0.0",
  port: 4173,
  url: "http://127.0.0.1:4173",
  logFile: "C:/test/project/.packer-web/launcher/web-mvp.log",
  startedAt: "2026-07-13T00:00:00.000Z",
}), null);

console.log("Web MVP launcher self-test passed.");
