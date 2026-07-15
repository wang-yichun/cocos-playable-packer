import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ChannelPlatform } from "./channel-profile.js";
import {
  validateChannelArtifact,
  type ChannelArtifactFormat,
  type ChannelArtifactValidationReport,
} from "./channel-spec-validation.js";
import { extractZipArchive } from "../web/zip-extractor.js";

export interface ChannelArtifactFileValidationResult {
  inputFile: string;
  entries: readonly string[];
  report: ChannelArtifactValidationReport;
}

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".htm",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".xml",
]);

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

async function collectFiles(
  root: string,
  current: string,
  output: string[],
): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, absolutePath, output);
    } else if (entry.isFile()) {
      output.push(normalizePath(path.relative(root, absolutePath)));
    }
  }
}

function detectZipFormat(entries: readonly string[]): ChannelArtifactFormat {
  const lower = entries.map((entry) => entry.toLowerCase());
  if (entries.length === 1 && lower[0] === "index.html") {
    return "zip-single-html";
  }
  if (lower.includes("index.html") && lower.includes("res.js")) {
    return "zip-html-res-js";
  }
  return "zip-other";
}

async function readTextFiles(
  root: string,
  entries: readonly string[],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!TEXT_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      continue;
    }
    files[entry] = await readFile(
      path.join(root, ...entry.split("/")),
      "utf8",
    );
  }
  return files;
}

export async function validateChannelArtifactFile(
  inputFile: string,
  platform: ChannelPlatform,
): Promise<ChannelArtifactFileValidationResult> {
  const absoluteInput = path.resolve(inputFile);
  const inputInfo = await stat(absoluteInput).catch(() => null);
  if (!inputInfo?.isFile() || inputInfo.size <= 0) {
    throw new Error(`渠道产物不存在、不是文件或为空：${absoluteInput}`);
  }

  const extension = path.extname(absoluteInput).toLowerCase();
  if (extension === ".html" || extension === ".htm") {
    const name = path.basename(absoluteInput);
    const report = validateChannelArtifact({
      platform,
      deliveryFormat: "single-html",
      artifactBytes: inputInfo.size,
      entries: [name],
      textFiles: {
        [name]: await readFile(absoluteInput, "utf8"),
      },
    });
    return {
      inputFile: absoluteInput,
      entries: [name],
      report,
    };
  }

  if (extension !== ".zip") {
    throw new Error(`渠道规范校验只支持 HTML 或 ZIP：${absoluteInput}`);
  }

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "channel-spec-validation-"),
  );
  try {
    await extractZipArchive(absoluteInput, temporaryRoot, {
      maxArchiveBytes: 128 * 1024 * 1024,
      maxExtractedBytes: 512 * 1024 * 1024,
      maxFileCount: 10_000,
      maxSingleFileBytes: 128 * 1024 * 1024,
      maxPathDepth: 24,
    });

    const entries: string[] = [];
    await collectFiles(temporaryRoot, temporaryRoot, entries);
    entries.sort((left, right) => left.localeCompare(right));

    const report = validateChannelArtifact({
      platform,
      deliveryFormat: detectZipFormat(entries),
      artifactBytes: inputInfo.size,
      entries,
      textFiles: await readTextFiles(temporaryRoot, entries),
    });
    return {
      inputFile: absoluteInput,
      entries,
      report,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
