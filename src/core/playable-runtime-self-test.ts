import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PlayableCoreError,
  playableCoreApi,
  type PlayableBuildEvent,
} from "./index.js";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "playable-core-runtime-"));
const originalCwd = process.cwd();

try {
  const packageRoot = path.join(temporaryRoot, "package-root");
  const outsideCwd = path.join(temporaryRoot, "outside-cwd");
  const inputDirectory = path.join(temporaryRoot, "web-mobile");
  const outputFile = path.join(temporaryRoot, "dist", "runtime.html");
  const relativeScriptPath = path.join("runtime", "mock-pipeline.mjs");
  const scriptPath = path.join(packageRoot, relativeScriptPath);
  const expectedTempRoot = path.join(packageRoot, "host-temp");

  await mkdir(path.dirname(scriptPath), { recursive: true });
  await mkdir(outsideCwd, { recursive: true });
  await mkdir(inputDirectory, { recursive: true });
  await writeFile(
    scriptPath,
    [
      'import { mkdir, writeFile } from "node:fs/promises";',
      'import path from "node:path";',
      'const inputDirectory = process.argv[2];',
      'const outputFile = process.argv[3];',
      'if (!inputDirectory || !outputFile) throw new Error("missing paths");',
      'await mkdir(path.dirname(outputFile), { recursive: true });',
      'await writeFile(outputFile, "<html><body>runtime test</body></html>", "utf8");',
      'const reportFile = outputFile.replace(/\\.html$/i, ".report.json");',
      'const report = {',
      '  output: { sha256: "' + "1".repeat(64) + '" },',
      '  runtime: {',
      '    cwd: process.cwd(),',
      '    inputDirectory,',
      '    host: process.env.PLAYABLE_PACKER_RUNTIME_HOST,',
      '    packageRoot: process.env.PLAYABLE_PACKER_PACKAGE_ROOT,',
      '    tempRoot: process.env.PLAYABLE_PACKER_TEMP_ROOT,',
      '    runtimeEnv: process.env.RUNTIME_CONTEXT_TEST,',
      '    buildEnv: process.env.BUILD_OPTIONS_TEST,',
      '  },',
      '};',
      'await writeFile(reportFile, JSON.stringify(report), "utf8");',
      'console.log("portable runtime pipeline completed");',
    ].join("\n"),
    "utf8",
  );

  process.chdir(outsideCwd);

  const defaultRuntime = playableCoreApi.resolveRuntime(undefined);
  assert.equal(defaultRuntime.packageRoot, outsideCwd);
  assert.equal(defaultRuntime.host, "cli");
  assert.equal(defaultRuntime.tempRoot, null);
  assert.equal(defaultRuntime.nodeExecutable, process.execPath);

  const runtimeEvents: PlayableBuildEvent[] = [];
  const buildEvents: PlayableBuildEvent[] = [];
  const runtimeController = new AbortController();
  const serviceOptions = playableCoreApi.createServiceOptions({
    runtime: {
      packageRoot,
      host: "creator",
      tempRoot: "host-temp",
      nodeExecutable: process.execPath,
      environment: {
        RUNTIME_CONTEXT_TEST: "runtime",
        SHARED_RUNTIME_TEST: "runtime-value",
      },
      signal: runtimeController.signal,
      onEvent(event) {
        runtimeEvents.push(event);
      },
    },
    scriptPath: relativeScriptPath,
    environment: {
      BUILD_OPTIONS_TEST: "build",
      SHARED_RUNTIME_TEST: "build-value",
    },
    onEvent(event) {
      buildEvents.push(event);
    },
  });

  assert.equal(serviceOptions.projectRoot, packageRoot);
  assert.equal(serviceOptions.nodeExecutable, process.execPath);
  assert.equal(serviceOptions.scriptPath, relativeScriptPath);
  assert.equal(serviceOptions.signal, runtimeController.signal);
  assert.equal(serviceOptions.environment?.PLAYABLE_PACKER_RUNTIME_HOST, "creator");
  assert.equal(serviceOptions.environment?.PLAYABLE_PACKER_PACKAGE_ROOT, packageRoot);
  assert.equal(serviceOptions.environment?.PLAYABLE_PACKER_TEMP_ROOT, expectedTempRoot);
  assert.equal(serviceOptions.environment?.RUNTIME_CONTEXT_TEST, "runtime");
  assert.equal(serviceOptions.environment?.BUILD_OPTIONS_TEST, "build");
  assert.equal(serviceOptions.environment?.SHARED_RUNTIME_TEST, "build-value");

  const result = await playableCoreApi.build(
    {
      inputDirectory,
      outputFile,
      image: { mode: "none" },
    },
    {
      runtime: {
        packageRoot,
        host: "creator",
        tempRoot: "host-temp",
        environment: { RUNTIME_CONTEXT_TEST: "runtime" },
        onEvent(event) {
          runtimeEvents.push(event);
        },
      },
      scriptPath: relativeScriptPath,
      environment: { BUILD_OPTIONS_TEST: "build" },
      onEvent(event) {
        buildEvents.push(event);
      },
    },
  );

  assert.equal(result.outputFile, outputFile);
  assert.equal(result.outputSha256, "1".repeat(64));
  const runtimeReport = result.report.runtime as Record<string, unknown>;
  assert.equal(runtimeReport.cwd, packageRoot);
  assert.equal(runtimeReport.inputDirectory, inputDirectory);
  assert.equal(runtimeReport.host, "creator");
  assert.equal(runtimeReport.packageRoot, packageRoot);
  assert.equal(runtimeReport.tempRoot, expectedTempRoot);
  assert.equal(runtimeReport.runtimeEnv, "runtime");
  assert.equal(runtimeReport.buildEnv, "build");
  for (const events of [runtimeEvents, buildEvents]) {
    assert.ok(events.some((event) => event.type === "state" && event.stage === "running"));
    assert.ok(events.some((event) => event.type === "state" && event.stage === "succeeded"));
    assert.ok(
      events.some(
        (event) => event.type === "log" && event.line === "portable runtime pipeline completed",
      ),
    );
  }

  const abortedController = new AbortController();
  abortedController.abort();
  await assert.rejects(
    playableCoreApi.build(
      {
        inputDirectory,
        outputFile: path.join(temporaryRoot, "dist", "cancelled.html"),
        image: { mode: "none" },
      },
      {
        runtime: {
          packageRoot,
          host: "creator",
          signal: abortedController.signal,
        },
        scriptPath: relativeScriptPath,
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PlayableCoreError);
      assert.equal(error.code, "ABORTED");
      return true;
    },
  );
} finally {
  process.chdir(originalCwd);
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Playable core runtime self-test passed.");
