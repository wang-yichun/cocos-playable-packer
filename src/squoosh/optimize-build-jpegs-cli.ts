import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface JpegPipelineOptions {
  buildDirectory: string;
  quality: number;
  confirm: boolean;
  minimumSavingsBytes: number;
  minimumSavingsPercent: number;
}

function usage(): string {
  return [
    "Squoosh 构建 JPEG 优化流水线",
    "",
    "npm run squoosh:optimize-build-jpegs -- <构建目录> [选项]",
    "",
    "选项：",
    "  --quality=80                 MozJPEG 质量，默认 80",
    "  --min-savings-bytes=128      最低绝对收益，默认 128 B",
    "  --min-savings-percent=1      最低相对收益，默认 1%",
    "  --confirm                    应用到构建目录；未指定时只预览",
  ].join("\n");
}

function integer(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return parsed;
}

function decimal(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的数字。`);
  }
  return parsed;
}

export function parseJpegPipelineArguments(
  argv: readonly string[],
): JpegPipelineOptions {
  const args = argv.filter((argument) => argument !== "--");
  let buildDirectory: string | null = null;
  let quality = 80;
  let confirm = false;
  let minimumSavingsBytes = 128;
  let minimumSavingsPercent = 1;

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--confirm") {
      confirm = true;
      continue;
    }
    if (argument === "--preview") {
      confirm = false;
      continue;
    }
    if (argument.startsWith("--quality=")) {
      quality = integer(
        argument.slice("--quality=".length),
        "--quality",
        1,
        100,
      );
      continue;
    }
    if (argument.startsWith("--min-savings-bytes=")) {
      minimumSavingsBytes = integer(
        argument.slice("--min-savings-bytes=".length),
        "--min-savings-bytes",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      continue;
    }
    if (argument.startsWith("--min-savings-percent=")) {
      minimumSavingsPercent = decimal(
        argument.slice("--min-savings-percent=".length),
        "--min-savings-percent",
        0,
        100,
      );
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`无法识别的参数：${argument}`);
    }
    if (buildDirectory !== null) {
      throw new Error(`只允许传入一个构建目录，额外参数：${argument}`);
    }
    buildDirectory = argument;
  }

  if (buildDirectory === null) {
    throw new Error(`${usage()}\n\n缺少构建目录。`);
  }

  return {
    buildDirectory: path.resolve(buildDirectory),
    quality,
    confirm,
    minimumSavingsBytes,
    minimumSavingsPercent,
  };
}

async function runTypeScript(
  projectRoot: string,
  relativeScript: string,
  argumentsList: readonly string[],
): Promise<void> {
  const scriptPath = path.join(projectRoot, ...relativeScript.split("/"));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...argumentsList],
      {
        cwd: projectRoot,
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
            ? `${relativeScript} 退出码：${String(code)}`
            : `${relativeScript} 被信号 ${signal} 终止。`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const options = parseJpegPipelineArguments(process.argv.slice(2));
  const projectRoot = process.cwd();
  const profileKey = `q${options.quality}`;
  const reportPath = path.join(
    projectRoot,
    ".squoosh-cache",
    "build-jpegs",
    profileKey,
    "reports",
    "latest.json",
  );

  await runTypeScript(
    projectRoot,
    "src/squoosh/optimize-build-jpegs.ts",
    [
      options.buildDirectory,
      `--quality=${options.quality}`,
      "--preview",
    ],
  );

  const applyArguments = [
    options.buildDirectory,
    `--report=${reportPath}`,
    `--min-savings-bytes=${options.minimumSavingsBytes}`,
    `--min-savings-percent=${options.minimumSavingsPercent}`,
  ];
  if (options.confirm) {
    applyArguments.push("--confirm");
  }

  await runTypeScript(
    projectRoot,
    "src/squoosh/apply-build-jpeg-cache.ts",
    applyArguments,
  );
}

const entryFile = process.argv[1];
if (
  entryFile !== undefined &&
  import.meta.url === pathToFileURL(entryFile).href
) {
  main().catch((error: unknown) => {
    console.error("");
    console.error("Squoosh JPEG 流水线失败");
    console.error("------------------------");
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
