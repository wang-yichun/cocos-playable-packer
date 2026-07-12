import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function runRawSingleHtml(
  inputDirectory: string,
  outputFile: string,
): Promise<{ stdout: string; stderr: string }> {
  const scriptPath = path.resolve("src", "web", "raw-single-html-cli.ts");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", scriptPath, inputDirectory, outputFile],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `未压缩自测失败：exit=${String(exitCode)} signal=${String(signal)}\n${stdout}\n${stderr}`,
        ),
      );
    });
  });

  return { stdout, stderr };
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "playable-raw-single-html-"));
try {
  const inputDirectory = path.join(temporaryRoot, "web-mobile");
  const sourceDirectory = path.join(inputDirectory, "src");
  const outputFile = path.join(temporaryRoot, "dist", "game-raw.html");
  await mkdir(sourceDirectory, { recursive: true });

  await writeFile(
    path.join(inputDirectory, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "<head><link rel=\"stylesheet\" href=\"style.css\"></head>",
      "<body><div id=\"GameDiv\"></div><script src=\"index.js\"></script></body>",
      "</html>",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(inputDirectory, "style.css"), "body{margin:0}\n", "utf8");
  await writeFile(
    path.join(sourceDirectory, "import-map.json"),
    `${JSON.stringify({ imports: {} }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(sourceDirectory, "polyfills.bundle.js"),
    "window.__polyfillsLoaded=true;\n",
    "utf8",
  );
  await writeFile(
    path.join(sourceDirectory, "system.bundle.js"),
    "window.System=window.System||{import:async function(){}};\n",
    "utf8",
  );
  await writeFile(
    path.join(inputDirectory, "index.js"),
    "console.log('raw single html test');\n",
    "utf8",
  );

  const execution = await runRawSingleHtml(inputDirectory, outputFile);
  assert.match(execution.stdout, /未压缩单 HTML 已生成/);
  assert.match(execution.stdout, /未压缩单 HTML 服务包装完成/);
  assert.equal(execution.stderr, "");

  const html = await readFile(outputFile, "utf8");
  assert.match(html, /window\.__PACK_FILES__/);
  assert.match(html, /window\.__PACK_BOOT__/);
  assert.match(html, /raw single html test/);

  const reportFile = outputFile.replace(/\.html$/i, ".report.json");
  const report = JSON.parse(await readFile(reportFile, "utf8")) as {
    buildMode?: unknown;
    processing?: Record<string, unknown>;
    output?: Record<string, unknown>;
  };
  assert.equal(report.buildMode, "raw-single-html");
  assert.equal(report.processing?.imageOptimization, false);
  assert.equal(report.processing?.audioOptimization, false);
  assert.equal(report.processing?.brotliCompression, false);
  assert.equal(report.processing?.payloadEncoding, null);
  assert.equal(typeof report.output?.bytes, "number");
  assert.match(String(report.output?.sha256), /^[0-9a-f]{64}$/);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Raw single HTML self-test passed.");
