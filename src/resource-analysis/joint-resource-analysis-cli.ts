import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { extractZipArchive, findWebMobileRoot } from "../web/zip-extractor.js";
import { analyzeJointResources, readAssetsManifest } from "./joint-resource-analysis.js";
import { createClarifiedResourceAnalysisHtmlReport } from "./resource-analysis-clarified-report.js";
import {
  enrichGeneratedNativeSourceMappings,
  finalizeResourceOptimization,
} from "./resource-analysis-finalize.js";
import type { CompleteResourceAnalysisReport } from "./resource-analysis-report.js";
import { analyzeResourceOptimization } from "./resource-optimization-estimates.js";

function normalizedArgs(argv: readonly string[]): string[] {
  return argv.filter((value) => value !== "--");
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function main(): Promise<void> {
  const args = normalizedArgs(process.argv.slice(2));
  const zipFile = args[0];
  const manifestFile = args[1];
  const outputFile = args[2];
  if (zipFile === undefined || manifestFile === undefined || outputFile === undefined) {
    throw new Error(
      "用法：npm run analyze:joint -- <web-mobile.zip> <assets-manifest.json> <输出报告.json>",
    );
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "cocos-joint-analysis-"));
  try {
    const extractionDirectory = path.join(temporaryDirectory, "source");
    const extraction = await extractZipArchive(path.resolve(zipFile), extractionDirectory);
    const buildRoot = await findWebMobileRoot(extractionDirectory);
    const manifest = await readAssetsManifest(path.resolve(manifestFile));
    const joint = await analyzeJointResources(buildRoot, manifest);
    const generatedMappingCount = await enrichGeneratedNativeSourceMappings(buildRoot, joint);
    joint.buildRoot = path.basename(buildRoot);
    const measuredOptimization = await analyzeResourceOptimization(buildRoot, joint);
    const optimization = finalizeResourceOptimization(joint, measuredOptimization);
    const report: CompleteResourceAnalysisReport = { ...joint, optimization };

    const resolvedOutput = path.resolve(outputFile);
    const htmlOutput = resolvedOutput.replace(/\.json$/i, ".html");
    const resolvedHtmlOutput = htmlOutput === resolvedOutput ? `${resolvedOutput}.html` : htmlOutput;
    await mkdir(path.dirname(resolvedOutput), { recursive: true });
    await Promise.all([
      writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
      writeFile(resolvedHtmlOutput, createClarifiedResourceAnalysisHtmlReport(report), "utf8"),
    ]);

    console.log("Cocos 工程与构建资源联合分析完成");
    console.log("--------------------------------");
    console.log(`ZIP 文件数量：${extraction.fileCount}`);
    console.log(`Web Mobile 原始大小：${formatMiB(report.buildBytes)}`);
    console.log(`源资源数量：${report.sourceResourceCount}`);
    console.log(`确认进入构建：${report.includedCount}`);
    console.log(`未在本次构建中发现：${report.notInBuildCount}`);
    console.log(`无法通过 UUID 判断：${report.notAssessableCount}`);
    console.log(`生成资源路径补充：${generatedMappingCount}`);
    console.log(`可评估资源数量覆盖：${report.assessableIncludedPercentByCount ?? 0}%`);
    console.log(`可评估资源体积覆盖：${report.assessableIncludedPercentByBytes ?? 0}%`);
    console.log(
      `Web Mobile 原始体积预计减少：${report.optimization.totalBuildSavingsPercentMin}%–${report.optimization.totalBuildSavingsPercentMax}%`,
    );
    console.log("提示：上述百分比不等于最终 Brotli Payload 或单 HTML 的降幅。");
    console.log(`图片实测候选：${report.optimization.measuredImageCount}`);
    console.log(`音频参数估算候选：${report.optimization.parameterEstimatedAudioCount}`);
    console.log(`JSON 报告：${resolvedOutput}`);
    console.log(`HTML 报告：${resolvedHtmlOutput}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const entryFile = process.argv[1];
if (entryFile !== undefined && import.meta.url === pathToFileURL(entryFile).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
