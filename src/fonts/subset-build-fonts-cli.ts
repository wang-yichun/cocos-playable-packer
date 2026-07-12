import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { discoverBuildFonts } from "./font-discovery.js";
import {
  parseFontSubsetArguments,
  runFontSubset,
} from "./subset-build-fonts.js";
import { validateSfnt } from "./sfnt.js";

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(filePath, { force: true });
  await rename(temporaryPath, filePath);
}

async function replaceAtomically(
  targetPath: string,
  output: Buffer,
  backupPath: string,
): Promise<void> {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(targetPath, backupPath);
  await writeFile(temporaryPath, output);

  try {
    await rm(targetPath, { force: true });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await copyFile(backupPath, targetPath).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2);
  const options = parseFontSubsetArguments(rawArguments);
  const discovered = await discoverBuildFonts(options.buildDirectory);
  const token = `${process.pid}-${Date.now()}`;
  const mirrorDirectory = path.join(
    options.cacheRootDirectory,
    ".font-discovery",
    token,
  );
  const mirrorToOriginal = new Map<string, (typeof discovered)[number]>();

  await mkdir(mirrorDirectory, { recursive: true });

  try {
    for (const [index, font] of discovered.entries()) {
      const mirrorName = `${index.toString().padStart(4, "0")}-${font.sha256.slice(0, 16)}.ttf`;
      await copyFile(font.absolutePath, path.join(mirrorDirectory, mirrorName));
      mirrorToOriginal.set(mirrorName, font);
    }

    const coreReport = await runFontSubset({
      ...options,
      buildDirectory: mirrorDirectory,
      confirm: false,
    });

    const mappedFiles = coreReport.files.map((file) => {
      const original = mirrorToOriginal.get(file.relativePath);
      if (original === undefined) {
        throw new Error(`字体镜像映射缺失：${file.relativePath}`);
      }
      return {
        ...file,
        relativePath: original.relativePath,
        detectedExtension: original.extension || "<none>",
      };
    });

    let filesReplaced = 0;
    let backupDirectory: string | null = null;
    const applied: Array<{ target: string; backup: string }> = [];

    if (options.confirm) {
      backupDirectory = path.join(
        coreReport.cacheDirectory,
        "backups",
        timestamp(),
      );

      try {
        for (const file of mappedFiles) {
          if (
            file.outputSha256 === null
            || file.action === "already-applied"
            || file.finalBytes >= file.currentBytes
          ) {
            continue;
          }

          const original = discovered.find(
            (candidate) => candidate.relativePath === file.relativePath,
          );
          if (original === undefined) {
            throw new Error(`找不到待替换字体：${file.relativePath}`);
          }

          const current = await readFile(original.absolutePath);
          if (
            current.length !== original.bytes
            || sha256(current) !== original.sha256
          ) {
            throw new Error(
              `应用前字体已经变化，请重新预览：${original.relativePath}`,
            );
          }

          const outputPath = path.join(
            coreReport.cacheDirectory,
            "outputs",
            `${file.currentSha256}.ttf`,
          );
          const output = await readFile(outputPath);
          validateSfnt(output);
          if (
            output.length !== file.finalBytes
            || sha256(output) !== file.outputSha256
          ) {
            throw new Error(`字体缓存输出校验失败：${outputPath}`);
          }

          const backupPath = path.join(
            backupDirectory,
            ...original.relativePath.split("/"),
          );
          await replaceAtomically(original.absolutePath, output, backupPath);
          applied.push({ target: original.absolutePath, backup: backupPath });
          filesReplaced += 1;
        }
      } catch (error) {
        for (const item of applied.reverse()) {
          await copyFile(item.backup, item.target).catch(() => undefined);
        }
        throw error;
      }
    }

    const extensionCounts = Object.fromEntries(
      [...new Set(discovered.map((font) => font.extension || "<none>"))]
        .sort()
        .map((extension) => [
          extension,
          discovered.filter(
            (font) => (font.extension || "<none>") === extension,
          ).length,
        ]),
    );

    const finalReport = {
      ...coreReport,
      status: options.confirm ? "applied" : "preview",
      completedAt: new Date().toISOString(),
      buildDirectory: options.buildDirectory,
      backupDirectory,
      options: {
        ...coreReport.options,
        confirm: options.confirm,
      },
      discovery: {
        mode: "sfnt-signature",
        extensions: extensionCounts,
      },
      summary: {
        ...coreReport.summary,
        scannedFontFiles: discovered.length,
        filesReplaced,
      },
      files: mappedFiles,
    };

    const reportsDirectory = path.join(coreReport.cacheDirectory, "reports");
    await writeJson(path.join(reportsDirectory, `${timestamp()}.json`), finalReport);
    await writeJson(path.join(reportsDirectory, "latest.json"), finalReport);

    console.log("");
    console.log("字体文件头扫描完成");
    console.log("------------------");
    console.log(`实际构建目录：${options.buildDirectory}`);
    console.log(`识别字体数量：${discovered.length}`);
    console.log(`扩展名分布：${JSON.stringify(extensionCounts)}`);
    console.log(`实际替换数量：${filesReplaced}`);
    console.log(`报告：${path.join(reportsDirectory, "latest.json")}`);

    if (discovered.length === 0) {
      console.warn(
        "未发现 SFNT/TrueType/OpenType 字体文件。该构建可能使用系统字体、位图字体，或字体已被封装进其他资源容器。",
      );
    }
  } finally {
    await rm(mirrorDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );

    const discoveryRoot = path.dirname(mirrorDirectory);
    const discoveryInfo = await stat(discoveryRoot).catch(() => null);
    if (discoveryInfo?.isDirectory()) {
      const entries = await import("node:fs/promises").then(({ readdir }) =>
        readdir(discoveryRoot),
      );
      if (entries.length === 0) {
        await rm(discoveryRoot, { recursive: true, force: true });
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error("");
  console.error("字体子集化失败");
  console.error("--------------");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
