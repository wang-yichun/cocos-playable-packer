import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { normalizeChannelPlatform } from "./channel-profile.js";
import { validateChannelArtifactFile } from "./channel-spec-validation-file.js";

interface ParsedArguments {
  inputFile: string;
  platform: string;
  reportFile: string;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const args = argv.filter((value) => value !== "--");
  const inputFile = args.find((value) => !value.startsWith("--"));
  const platformOption = args.find((value) => value.startsWith("--platform="));
  const reportOption = args.find((value) => value.startsWith("--report="));

  if (inputFile === undefined || platformOption === undefined) {
    throw new Error(
      "用法：npm run channel:validate -- \"<产物.html|产物.zip>\" --platform=<渠道> [--report=<报告.json>]",
    );
  }

  const platform = platformOption.slice("--platform=".length).trim();
  if (platform.length === 0) {
    throw new Error("--platform 不能为空。");
  }

  const reportFile = reportOption === undefined
    ? `${path.resolve(inputFile)}.channel-validation.json`
    : path.resolve(reportOption.slice("--report=".length));

  return {
    inputFile,
    platform,
    reportFile,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  const platform = normalizeChannelPlatform(args.platform);
  const result = await validateChannelArtifactFile(args.inputFile, platform);
  const output = {
    inputFile: result.inputFile,
    entries: result.entries,
    ...result.report,
  };

  await mkdir(path.dirname(args.reportFile), { recursive: true });
  await writeFile(
    args.reportFile,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );

  console.log("渠道规范校验完成");
  console.log("----------------");
  console.log(`渠道：${platform}`);
  console.log(`产物：${result.inputFile}`);
  console.log(`格式：${result.report.actualFormat}`);
  console.log(`大小：${result.report.artifactBytes} B`);
  console.log(`文件：${result.report.entryCount}`);
  console.log(`错误：${result.report.errorCount}`);
  console.log(`警告：${result.report.warningCount}`);

  for (const issue of result.report.issues) {
    const location = issue.file === undefined ? "" : ` [${issue.file}]`;
    console.log(
      `${issue.severity === "error" ? "ERROR" : "WARN"} ${issue.code}${location}: ${issue.message}`,
    );
  }

  console.log(`报告：${args.reportFile}`);
  if (!result.report.valid) {
    process.exitCode = 1;
  }
}

const entryFile = process.argv[1];
if (entryFile !== undefined && import.meta.url === pathToFileURL(entryFile).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
