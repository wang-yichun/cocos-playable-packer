import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertSafeCleanupTarget,
  collectCleanupTargets,
  removeCleanupTargets,
} from "./clean-generated-lib.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "playable-cleanup-"));

function write(relativePath, content = "test") {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

try {
  write(".env", "TINYPNG_API_KEY=keep");
  write(".env.example", "TINYPNG_API_KEY=");
  write("package.json", "{}");
  write("node_modules/example/index.js");
  write("configs/game.json", "{}");
  write("workspaces/game/config.json", "{}");

  write(".packer-web/launcher/service.json", "{}");
  write(".tinypng-cache/cache.json", "{}");
  write(".squoosh-cache/cache.bin");
  write("dist/game.html");
  write("web-mobile/index.html");
  write("compression-report.json", "{}");
  write("module-report.json", "{}");
  write("launcher.log", "log");
  write("workspaces/game/runs/run.json", "{}");
  write("workspaces/game/reports/report.json", "{}");
  write("workspaces/game/preview/index.html");
  write("workspaces/game/backups/file.png");
  write("workspaces/game/manifests/applications/a.json", "{}");
  write("workspaces/game/manifests/restores/r.json", "{}");
  write("workspaces/game/manifests/latest-application.json", "{}");
  write("workspaces/game/manifests/latest-restore.json", "{}");

  const targets = collectCleanupTargets(root);
  const relativeTargets = new Set(
    targets.map((target) => target.relativePath.replaceAll("\\", "/")),
  );

  assert.equal(relativeTargets.has(".packer-web"), true);
  assert.equal(relativeTargets.has("compression-report.json"), true);
  assert.equal(relativeTargets.has("launcher.log"), true);
  assert.equal(relativeTargets.has("workspaces/game/runs"), true);
  assert.equal(relativeTargets.has("workspaces/game/manifests/latest-restore.json"), true);
  assert.equal(relativeTargets.has(".env"), false);
  assert.equal(relativeTargets.has("node_modules"), false);
  assert.throws(() => assertSafeCleanupTarget(root, root), /outside the project root/);
  assert.throws(() => assertSafeCleanupTarget(root, path.dirname(root)), /outside the project root/);

  removeCleanupTargets(root, targets);

  assert.equal(existsSync(path.join(root, ".packer-web")), false);
  assert.equal(existsSync(path.join(root, "compression-report.json")), false);
  assert.equal(existsSync(path.join(root, "workspaces/game/runs")), false);
  assert.equal(existsSync(path.join(root, ".env")), true);
  assert.equal(existsSync(path.join(root, ".env.example")), true);
  assert.equal(existsSync(path.join(root, "node_modules/example/index.js")), true);
  assert.equal(existsSync(path.join(root, "configs/game.json")), true);
  assert.equal(existsSync(path.join(root, "workspaces/game/config.json")), true);

  console.log("Generated cleanup self-test passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
