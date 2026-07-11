import { spawn } from "node:child_process";
import path from "node:path";

const rawArguments = process.argv
  .slice(2)
  .filter((argument: string) => argument !== "--");

let jpegQuality = 80;
let jpegQualitySpecified = false;
const forwardedArguments: string[] = [];

for (const argument of rawArguments) {
  if (argument.startsWith("--jpeg-quality=")) {
    if (jpegQualitySpecified) {
      throw new Error("--jpeg-quality 只能指定一次。");
    }
    const value = Number(argument.slice("--jpeg-quality=".length));
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new Error("--jpeg-quality 必须是 1 到 100 之间的整数。");
    }
    jpegQuality = value;
    jpegQualitySpecified = true;
    continue;
  }

  forwardedArguments.push(
    argument.startsWith("--image-mode=")
      ? `--mode=${argument.slice("--image-mode=".length)}`
      : argument,
  );
}

const imageMode = forwardedArguments
  .find((argument) => argument.startsWith("--mode="))
  ?.slice("--mode=".length);
const preview = forwardedArguments.includes("--preview");
const buildDirectory = forwardedArguments.find(
  (argument) => !argument.startsWith("-"),
);

if (jpegQualitySpecified && imageMode !== "squoosh") {
  throw new Error("--jpeg-quality 只适用于 Squoosh 模式。");
}

async function runTypeScript(
  relativeScript: string,
  argumentsList: readonly string[],
  description: string,
): Promise<void> {
  const scriptPath = path.join(
    process.cwd(),
    ...relativeScript.split("/"),
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...argumentsList],
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
            ? `${description} 退出码：${String(code)}`
            : `${description} 被信号 ${signal} 终止。`,
        ),
      );
    });
  });
}

await runTypeScript(
  "src/images/optimize-build-images.ts",
  forwardedArguments,
  "构建图片 PNG/TinyPNG 流程",
);

if (imageMode === "squoosh") {
  if (buildDirectory === undefined) {
    throw new Error("Squoosh JPEG 优化缺少构建目录。");
  }

  await runTypeScript(
    "src/squoosh/optimize-build-jpegs-cli.ts",
    [
      buildDirectory,
      `--quality=${jpegQuality}`,
      preview ? "--preview" : "--confirm",
    ],
    "Squoosh JPEG 优化",
  );
}
