import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CREATOR_WORKER_PROTOCOL_VERSION,
  parseCreatorWorkerControlMessage,
  parseCreatorWorkerRequest,
  serializeCreatorWorkerMessage,
} from "./protocol.js";

const request = parseCreatorWorkerRequest({
  protocolVersion: CREATOR_WORKER_PROTOCOL_VERSION,
  taskId: "task-1",
  packageRoot: "C:/packer",
  nodeExecutable: "C:/node/node.exe",
  build: {
    inputDirectory: "C:/game/build/web-mobile",
    outputFile: "C:/game/build/playable/game.html",
    image: { mode: "squoosh" },
    audio: null,
    payloadEncoding: "html7",
  },
});
assert.equal(request.taskId, "task-1");
assert.equal(request.build.payloadEncoding, "html7");

const tinyPngRequest = parseCreatorWorkerRequest({
  protocolVersion: CREATOR_WORKER_PROTOCOL_VERSION,
  taskId: "task-tinypng",
  packageRoot: "C:/packer",
  nodeExecutable: "C:/node/node.exe",
  build: {
    inputDirectory: "C:/game/build/web-mobile",
    outputFile: "C:/game/build/playable/game.html",
    image: { mode: "tinypng", scope: { type: "all" } },
    audio: null,
    payloadEncoding: "html7",
  },
});
assert.equal(tinyPngRequest.build.image.mode, "tinypng");

assert.deepEqual(
  parseCreatorWorkerControlMessage({ type: "cancel", taskId: "task-1" }),
  { type: "cancel", taskId: "task-1" },
);
assert.throws(() => parseCreatorWorkerControlMessage({ type: "cancel", taskId: "" }), /控制消息/);

assert.throws(() => parseCreatorWorkerRequest(null), /必须是对象/);
assert.throws(() => parseCreatorWorkerRequest({ protocolVersion: 999 }), /协议版本/);
assert.throws(() => parseCreatorWorkerRequest({
  protocolVersion: 1,
  taskId: "",
  packageRoot: "C:/packer",
  nodeExecutable: "node",
  build: {},
}), /taskId/);

const line = serializeCreatorWorkerMessage({
  type: "ready",
  taskId: "task-1",
  pid: 123,
});
assert.equal(line.endsWith("\n"), true);
assert.deepEqual(JSON.parse(line), {
  type: "ready",
  taskId: "task-1",
  pid: 123,
});

const workerSource = await readFile(
  new URL("./playable-build-worker.ts", import.meta.url),
  "utf8",
);
assert.match(workerSource, /ensureTinyPngEnvCompatibility/);
assert.match(workerSource, /request\.build\.image\.mode !== "tinypng"/);
assert.match(workerSource, /process\.env\.TINYPNG_API_KEY/);
assert.match(workerSource, /path\.join\(request\.packageRoot, "\.env"\)/);
assert.match(workerSource, /flag: "wx"/);
assert.match(workerSource, /await cleanupTinyPngEnv\?\.\(\)/);
assert.match(workerSource, /listenForCancellation/);
assert.match(workerSource, /signal: cancellation\.signal/);

console.log("Creator Worker protocol self-test passed.");
