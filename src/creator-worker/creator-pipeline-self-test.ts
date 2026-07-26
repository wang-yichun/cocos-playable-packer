import assert from "node:assert/strict";

import {
  CREATOR_WORKER_PROTOCOL_VERSION,
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

console.log("Creator Worker protocol self-test passed.");
