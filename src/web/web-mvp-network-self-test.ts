import assert from "node:assert/strict";

import {
  createWebMvpAccessUrls,
  isWildcardWebMvpHost,
  normalizeWebMvpHost,
  parseWebMvpPort,
  type WebMvpNetworkInterfaces,
} from "./web-mvp-network.js";

const interfaces: WebMvpNetworkInterfaces = {
  Ethernet: [
    { address: "192.168.1.42", family: "IPv4", internal: false },
    { address: "fe80::1234", family: "IPv6", internal: false },
  ],
  VPN: [
    { address: "10.0.0.8", family: 4, internal: false },
    { address: "192.168.1.42", family: "IPv4", internal: false },
  ],
  Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
};

assert.equal(normalizeWebMvpHost(undefined), "0.0.0.0");
assert.equal(normalizeWebMvpHost("  "), "0.0.0.0");
assert.equal(normalizeWebMvpHost(" 127.0.0.1 "), "127.0.0.1");
assert.equal(parseWebMvpPort(undefined), 4173);
assert.equal(parseWebMvpPort("0"), 0);
assert.equal(parseWebMvpPort(" 5173 "), 5173);
assert.throws(() => parseWebMvpPort("-1"), /0 到 65535/);
assert.throws(() => parseWebMvpPort("65536"), /0 到 65535/);
assert.throws(() => parseWebMvpPort("abc"), /0 到 65535/);
assert.equal(isWildcardWebMvpHost("0.0.0.0"), true);
assert.equal(isWildcardWebMvpHost("::"), true);
assert.equal(isWildcardWebMvpHost("127.0.0.1"), false);
assert.deepEqual(createWebMvpAccessUrls("0.0.0.0", 4173, interfaces), [
  "http://127.0.0.1:4173",
  "http://10.0.0.8:4173",
  "http://192.168.1.42:4173",
]);
assert.deepEqual(createWebMvpAccessUrls("::", 4173, interfaces), [
  "http://[::1]:4173",
  "http://10.0.0.8:4173",
  "http://192.168.1.42:4173",
]);
assert.deepEqual(createWebMvpAccessUrls("127.0.0.1", 4173, interfaces), [
  "http://127.0.0.1:4173",
]);
assert.deepEqual(createWebMvpAccessUrls("fe80::1", 4173, interfaces), [
  "http://[fe80::1]:4173",
]);

console.log("Web MVP network self-test passed.");
