import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAssetsManifest } from "./assets-manifest.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocos-assets-manifest-"));
  try {
    const imageDirectory = path.join(root, "assets", "ui");
    await mkdir(imageDirectory, { recursive: true });
    await writeFile(path.join(imageDirectory, "button.png"), Buffer.from([1, 2, 3, 4]));
    await writeFile(
      path.join(imageDirectory, "button.png.meta"),
      JSON.stringify({
        uuid: "12345678-1234-1234-1234-123456789abc",
        importer: "image",
        userData: { bundleName: "main" },
      }),
      "utf8",
    );
    await writeFile(path.join(root, "assets", "orphan.txt"), "hello", "utf8");

    const manifest = await createAssetsManifest(root);
    assert(manifest.resourceCount === 2, "应扫描两个非 meta 资源。");
    assert(manifest.metaCount === 1, "应识别一个 meta 文件。");
    assert(manifest.missingMetaCount === 1, "应识别一个缺少 meta 的资源。");

    const image = manifest.entries.find((entry) => entry.path === "assets/ui/button.png");
    assert(image !== undefined, "应保留 assets 相对路径。");
    assert(image.uuid === "12345678-1234-1234-1234-123456789abc", "应读取 UUID。");
    assert(image.importer === "image", "应读取 importer。");
    assert(image.bundleName === "main", "应读取 Bundle 名称。");
    assert(image.sha256.length === 64, "应生成 SHA-256。");

    console.log("assets manifest self-test passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
