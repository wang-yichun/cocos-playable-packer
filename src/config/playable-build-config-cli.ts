import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveBuildArguments } from "./unified-build-config.js";

function usage(): string {
  return [
    "统一配置入口：",
    "  npm run playable:build -- --config=./playable.config.json",
    "",
    "命令行参数优先于配置文件：",
    "  npm run playable:build -- --config=./playable.config.json ./web-mobile ./dist/game.html --png-quality=70",
    "",
    "未指定 --config 时，原有命令行用法保持不变。",
  ].join("\n");
}

async function runExistingPipeline(args: readonly string[]): Promise<void> {
  const scriptPath = path.join(
    process.cwd(),
    "src",
    "pipeline",
    "build-playable-image-quality-cli.ts",
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
        windowsHide: false,
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `Playable 构建流水线退出码：${String(code)}`
            : `Playable 构建流水线被信号 ${signal} 终止。`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const originalArgs = process.argv.slice(2);
  if (originalArgs.includes("--config-help")) {
    console.log(usage());
    return;
  }

  const resolved = await resolveBuildArguments(originalArgs);
  if (resolved.configFile !== null) {
    console.log(`使用统一配置：${resolved.configFile}`);
  }
  await runExistingPipeline(resolved.argv);
}

const entryFile = process.argv[1];
if (
  entryFile !== undefined &&
  import.meta.url === pathToFileURL(entryFile).href
) {
  main().catch((error: unknown) => {
    console.error("");
    console.error("统一构建配置处理失败");
    console.error("--------------------");
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
