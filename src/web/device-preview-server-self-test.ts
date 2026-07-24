import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startEnhancedResourceAnalysisWebMvpServer } from "./resource-analysis-enhanced-web-server.js";

const root = await mkdtemp(path.join(os.tmpdir(), "device-preview-web-"));
const server = await startEnhancedResourceAnalysisWebMvpServer({
  host: "127.0.0.1",
  port: 0,
  rootDirectory: path.join(root, ".packer-web"),
  projectRoot: root,
});

try {
  const response = await fetch(`${server.url}/device-preview?source=${encodeURIComponent("/preview/test?channel=Preview")}`);
  assert.equal(response.ok, true);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  assert.match(html, /模拟真机预览/);
  assert.match(html, /id="devicePreviewFrame"/);
  assert.match(html, /height: 100dvh/);
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}

console.log("Device preview server self-test passed.");
