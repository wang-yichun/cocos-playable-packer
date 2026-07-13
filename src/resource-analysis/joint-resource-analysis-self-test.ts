import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AssetsManifest } from "./assets-manifest.js";
import { analyzeJointResources, normalizeCocosUuid } from "./joint-resource-analysis.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocos-joint-analysis-"));
  try {
    const buildRoot = path.join(root, "web-mobile");
    const bundleRoot = path.join(buildRoot, "assets", "main");
    await mkdir(path.join(bundleRoot, "native", "97"), { recursive: true });
    await writeFile(
      path.join(bundleRoot, "native", "97", "9777e831-ec2a-464d-a5f4-95bcfd390e72.png"),
      Buffer.from([1, 2]),
    );
    await writeFile(path.join(bundleRoot, "config.json"), JSON.stringify({
      name: "main",
      uuids: ["97d+gx7CpGTaX0lbz9OQ5y", "12345678-1234-1234-1234-123456789abc"],
    }), "utf8");
    await writeFile(path.join(buildRoot, "application.js"), "console.log('ok')", "utf8");

    const manifest: AssetsManifest = {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      projectName: "fixture",
      assetsRoot: "assets",
      resourceCount: 4,
      totalBytes: 100,
      metaCount: 4,
      missingMetaCount: 0,
      entries: [
        { path: "assets/a.png", extension: ".png", bytes: 40, sha256: "a", modifiedAt: "", metaPath: "assets/a.png.meta", uuid: "9777e831-ec2a-464d-a5f4-95bcfd390e72", importer: "image", bundleName: null },
        { path: "assets/b.prefab", extension: ".prefab", bytes: 30, sha256: "b", modifiedAt: "", metaPath: "assets/b.prefab.meta", uuid: "12345678-1234-1234-1234-123456789abc", importer: "prefab", bundleName: null },
        { path: "assets/c.png", extension: ".png", bytes: 20, sha256: "c", modifiedAt: "", metaPath: "assets/c.png.meta", uuid: "22345678-1234-1234-1234-123456789abc", importer: "image", bundleName: null },
        { path: "assets/code.ts", extension: ".ts", bytes: 10, sha256: "d", modifiedAt: "", metaPath: "assets/code.ts.meta", uuid: "32345678-1234-1234-1234-123456789abc", importer: "typescript", bundleName: null },
      ],
    };

    assert(
      normalizeCocosUuid("97d+gx7CpGTaX0lbz9OQ5y") === "9777e831-ec2a-464d-a5f4-95bcfd390e72",
      "应解码 Cocos 压缩 UUID。",
    );
    const result = await analyzeJointResources(buildRoot, manifest);
    assert(result.includedCount === 2, "应识别两个已进入构建的源资源。");
    assert(result.notInBuildCount === 1, "应识别一个未进入构建的源资源。");
    assert(result.notAssessableCount === 1, "脚本应归为无法通过 UUID 判断。");
    assert(result.assessableIncludedPercentByCount === 66.67, "应计算可评估资源的数量占比。");
    assert(result.buildBundles[0]?.name === "main", "应识别 main Bundle。");
    const direct = result.mappings.find((mapping) => mapping.path === "assets/a.png");
    assert(direct?.evidence === "build-path", "应优先记录直接构建路径证据。");
    const packed = result.mappings.find((mapping) => mapping.path === "assets/b.prefab");
    assert(packed?.evidence === "bundle-config", "应识别 Bundle 配置证据。");
    console.log("joint resource analysis self-test passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
