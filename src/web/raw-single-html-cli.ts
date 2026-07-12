import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

function reportPathForOutput(outputFile: string): string {
  return outputFile.replace(/\.html$/i, ".report.json");
}

async function runRawPacker(inputDirectory: string, outputFile: string): Promise<void> {
  const rawPackerScript = path.resolve(process.cwd(), "src", "pack-uncompressed.ts");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", rawPackerScript, inputDirectory, outputFile],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    },
  );

  await new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      reject(new Error(`无法启动未压缩单 HTML 打包器：${error.message}`, { cause: error }));
    });
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `未压缩单 HTML 打包器退出码：${String(exitCode)}`
            : `未压缩单 HTML 打包器被信号 ${signal} 终止。`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const inputArgument = process.argv[2];
  const outputArgument = process.argv[3];
  if (inputArgument === undefined || outputArgument === undefined) {
    throw new Error("用法：raw-single-html-cli.ts <输入目录> <输出 HTML>");
  }

  const inputDirectory = path.resolve(inputArgument);
  const outputFile = path.resolve(outputArgument);
  if (path.extname(outputFile).toLowerCase() !== ".html") {
    throw new Error(`输出文件必须是 .html：${outputFile}`);
  }

  const inputInfo = await stat(inputDirectory).catch(() => null);
  if (!inputInfo?.isDirectory()) {
    throw new Error(`输入目录不存在或不是目录：${inputDirectory}`);
  }

  const startedAt = new Date().toISOString();
  const startedAtMs = performance.now();
  await mkdir(path.dirname(outputFile), { recursive: true });

  console.log("未压缩单 HTML 模式");
  console.log("------------------");
  console.log(`输入：${inputDirectory}`);
  console.log(`输出：${outputFile}`);
  console.log("图片、音频、Brotli 和 Payload 压缩均已关闭。");
  console.log("");

  await runRawPacker(inputDirectory, outputFile);

  const outputInfo = await stat(outputFile).catch(() => null);
  if (!outputInfo?.isFile() || outputInfo.size === 0) {
    throw new Error(`未压缩打包器没有生成有效 HTML：${outputFile}`);
  }

  const outputBuffer = await readFile(outputFile);
  const outputSha256 = createHash("sha256").update(outputBuffer).digest("hex");
  const reportFile = reportPathForOutput(outputFile);
  const completedAt = new Date().toISOString();
  const durationMs = performance.now() - startedAtMs;
  const report = {
    schemaVersion: 1,
    buildMode: "raw-single-html",
    startedAt,
    completedAt,
    input: {
      directory: inputDirectory,
    },
    processing: {
      imageOptimization: false,
      audioOptimization: false,
      brotliCompression: false,
      payloadEncoding: null,
      description: "仅合并为单 HTML，不执行资源压缩。",
    },
    output: {
      file: outputFile,
      bytes: outputInfo.size,
      sha256: outputSha256,
      reportFile,
    },
    timingMs: {
      total: durationMs,
    },
  };

  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("");
  console.log("未压缩单 HTML 服务包装完成");
  console.log(`最终 HTML：${outputInfo.size} B`);
  console.log(`SHA-256：${outputSha256}`);
  console.log(`报告：${reportFile}`);
}

void main().catch((error: unknown) => {
  console.error("未压缩单 HTML 构建失败：", error);
  process.exitCode = 1;
});
