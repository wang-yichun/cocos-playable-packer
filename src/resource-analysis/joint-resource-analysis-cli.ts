import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { extractZipArchive, findWebMobileRoot } from "../web/zip-extractor.js";
import { analyzeJointResources, readAssetsManifest } from "./joint-resource-analysis.js";
import { measurePayloadEncodingBenchmark } from "./payload-encoding-benchmark.js";
import {
  enrichGeneratedNativeSourceMappings,
  finalizeResourceOptimization,
} from "./resource-analysis-finalize.js";
import {
  createFinalResourceAnalysisHtmlReport,
  type FinalResourceAnalysisReport,
} from "./resource-analysis-final-report.js";
import { analyzeResourceOptimization } from "./resource-optimization-estimates.js";
import { analyzeSourceRedundancy } from "./source-redundancy-analysis.js";

function normalizedArgs(argv: readonly string[]): string[] {
  return argv.filter((value) => value !== "--");
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? formatMiB(bytes) : formatKiB(bytes);
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
    const redundancy = analyzeSourceRedundancy(manifest, joint);
    console.log("正在实际测量 Brotli、Base64、Base91 与 HTML7 Payload 体积……");
    const payloadEncoding = await measurePayloadEncodingBenchmark(
      buildRoot,
      path.join(temporaryDirectory, "payload-benchmark"),
      joint.buildBytes,
      process.cwd(),
    );
    const report: FinalResourceAnalysisReport = {
      ...joint,
      optimization,
      redundancy,
      payloadEncoding,
    };

    const resolvedOutput = path.resolve(outputFile);
    const htmlOutput = resolvedOutput.replace(/\.json$/i, ".html");
    const resolvedHtmlOutput = htmlOutput === resolvedOutput ? `${resolvedOutput}.html` : htmlOutput;
    await mkdir(path.dirname(resolvedOutput), { recursive: true });
    await Promise.all([
      writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
      writeFile(resolvedHtmlOutput, createFinalResourceAnalysisHtmlReport(report), "utf8"),
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
    console.log(`完全重复资源组：${report.redundancy.duplicateGroupCount}`);
    console.log(`工程理论重复字节：${formatKiB(report.redundancy.redundantProjectBytes)}`);
    console.log("提示：工程理论重复字节不等于最终构建或单 HTML 可减少的字节。");
    if (report.payloadEncoding.status === "measured") {
      console.log(`Brotli Q11 二进制：${formatBytes(report.payloadEncoding.brotliBytes ?? 0)}`);
      for (const item of report.payloadEncoding.encodings) {
        console.log(`${item.encoding.toUpperCase()} 单 HTML：${formatBytes(item.htmlBytes)}；占 Web Mobile ${item.htmlPercentOfBuildBytes}%`);
      }
    } else {
      console.log(`Payload 编码测量不可用：${report.payloadEncoding.warnings.join("；")}`);
    }
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
