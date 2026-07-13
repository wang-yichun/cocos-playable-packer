#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  calculatePathBytes,
  collectCleanupTargets,
  removeCleanupTargets,
} from "./clean-generated-lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const flags = new Set(process.argv.slice(2));
const apply = flags.has("--apply");
const unknownFlags = [...flags].filter((flag) => flag !== "--apply");

if (unknownFlags.length > 0) {
  throw new Error(`Unknown option: ${unknownFlags.join(", ")}. Supported option: --apply.`);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function printTargets(targets) {
  let totalBytes = 0;
  for (const target of targets) {
    const bytes = calculatePathBytes(target.absolutePath);
    totalBytes += bytes;
    console.log(`- ${target.relativePath} (${formatBytes(bytes)})`);
  }
  console.log("");
  console.log(`Targets: ${targets.length}`);
  console.log(`Estimated size: ${formatBytes(totalBytes)}`);
}

function stopManagedWebMvp() {
  const launcher = path.join(projectRoot, "scripts", "web-mvp-launcher.mjs");
  if (!existsSync(launcher)) {
    return;
  }
  const result = spawnSync(process.execPath, [launcher, "stop"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error("Unable to stop Web MVP safely. Stop it manually, then run cleanup again.");
  }
}

console.log("Cocos Playable Packer Generated File Cleanup");
console.log("--------------------------------------------");
console.log(`Project: ${projectRoot}`);
console.log(`Mode: ${apply ? "apply" : "preview"}`);
console.log("");

let targets = collectCleanupTargets(projectRoot);
if (targets.length === 0) {
  console.log("Nothing to clean.");
  process.exit(0);
}

printTargets(targets);

if (!apply) {
  console.log("Preview only. No files were deleted.");
  console.log("Run `npm run clean:generated:apply` to delete these generated files.");
  process.exit(0);
}

stopManagedWebMvp();
targets = collectCleanupTargets(projectRoot);
removeCleanupTargets(projectRoot, targets);

console.log("");
console.log(`Deleted ${targets.length} generated paths.`);
console.log("Preserved: .env, .env.example, node_modules, source files, configs, and documentation.");
