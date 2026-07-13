import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  createAssetsManifestUploaderCmd,
  createAssetsManifestUploaderModule,
} from "./assets-manifest-uploader.js";

const execFileAsync = promisify(execFile);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const manifestUrl = "http://127.0.0.1:4173/api/resource-analysis/jobs/test/manifest";
  const startUrl = "http://127.0.0.1:4173/api/resource-analysis/jobs/test/start";
  const token = "single-use-token";
  const module = createAssetsManifestUploaderModule(manifestUrl, startUrl, token);
  const cmd = createAssetsManifestUploaderCmd(
    "http://127.0.0.1:4173/scanner.mjs?token=single-use-token",
    "fixture-scanner",
  );

  assert(module.includes(manifestUrl), "扫描器应绑定资源清单上传接口。");
  assert(module.includes(startUrl), "扫描器应在上传后启动完整分析。");
  assert(module.includes(token), "扫描器应携带一次性上传令牌。");
  assert(module.includes('path.join(projectRoot, "assets")'), "扫描器只能从项目 assets 目录开始扫描。");
  assert(module.includes("sha256File"), "扫描器应计算资源 SHA-256。");
  assert(module.includes('path.join(process.cwd(), "assets-manifest.json")'), "扫描器应在项目根目录保留 assets-manifest.json。");
  assert(module.includes("本地清单已生成"), "扫描器应提示本地清单路径。");
  assert(!module.includes("formData.append"), "扫描器不应上传资源二进制文件。");
  assert(cmd.includes('cd /d "%~dp0"'), "CMD 应以自身所在目录作为 Cocos 项目根目录。");
  assert(cmd.includes("%SCANNER%"), "CMD 应正确引用临时扫描器路径。");
  assert(cmd.includes("del /q"), "CMD 应在结束后删除临时扫描器。");

  const root = await mkdtemp(path.join(os.tmpdir(), "assets-uploader-test-"));
  try {
    const moduleFile = path.join(root, "scanner.mjs");
    await writeFile(moduleFile, module, "utf8");
    await execFileAsync(process.execPath, ["--check", moduleFile]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("assets manifest uploader self-test passed");
}

void main();
