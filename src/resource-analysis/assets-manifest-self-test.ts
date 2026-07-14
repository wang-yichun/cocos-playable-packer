import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAssetsManifest } from "./assets-manifest.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocos-assets-manifest-"));
  try {
    const imageDirectory = path.join(root, "assets", "ui");
    await mkdir(imageDirectory, { recursive: true });
    await writeFile(`${imageDirectory}.meta`, JSON.stringify({
      importer: "directory",
      userData: { isBundle: true, bundleName: "ui-bundle" },
    }), "utf8");
    await writeFile(path.join(imageDirectory, "button.png"), Buffer.from([1, 2, 3, 4]));
    await writeFile(path.join(imageDirectory, "button.png.meta"), JSON.stringify({
      uuid: "12345678-1234-1234-1234-123456789abc",
      importer: "image",
      userData: {},
    }), "utf8");

    const resourcesDirectory = path.join(root, "assets", "resources");
    await mkdir(resourcesDirectory, { recursive: true });
    await writeFile(path.join(resourcesDirectory, "data.json"), "{}", "utf8");
    await writeFile(path.join(resourcesDirectory, "data.json.meta"), JSON.stringify({
      uuid: "22345678-1234-1234-1234-123456789abc",
      importer: "json",
    }), "utf8");
    await writeFile(path.join(root, "assets", "orphan.txt"), "hello", "utf8");

    const manifest = await createAssetsManifest(root);
    assert(manifest.resourceCount === 3, "应扫描三个非 meta 资源。");
    assert(manifest.metaCount === 2, "应识别两个资源 meta 文件。");
    assert(manifest.missingMetaCount === 1, "应识别一个缺少 meta 的资源。");

    const image = manifest.entries.find((entry) => entry.path === "assets/ui/button.png");
    assert(image !== undefined, "应保留 assets 相对路径。");
    assert(image.uuid === "12345678-1234-1234-1234-123456789abc", "应读取 UUID。");
    assert(image.importer === "image", "应读取 importer。");
    assert(image.bundleName === "ui-bundle", "应继承目录 Bundle 名称。");
    assert(image.sha256.length === 64, "应生成 SHA-256。");

    const resource = manifest.entries.find((entry) => entry.path === "assets/resources/data.json");
    assert(resource?.bundleName === "resources", "应识别 Cocos resources 特殊 Bundle。");
    console.log("assets manifest self-test passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
