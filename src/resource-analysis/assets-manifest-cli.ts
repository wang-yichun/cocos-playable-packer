import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createAssetsManifest } from "./assets-manifest.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const projectDirectory = args[0] ?? process.cwd();
  const outputFile = path.resolve(args[1] ?? "./assets-manifest.json");

  const manifest = await createAssetsManifest(projectDirectory);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("Cocos 工程资源清单生成完成");
  console.log("----------------------------");
  console.log(`项目：${manifest.projectName}`);
  console.log(`资源数量：${manifest.resourceCount}`);
  console.log(`资源总大小：${manifest.totalBytes} B`);
  console.log(`Meta 数量：${manifest.metaCount}`);
  console.log(`缺少 Meta：${manifest.missingMetaCount}`);
  console.log(`输出：${outputFile}`);
}

const entryFile = process.argv[1];
if (entryFile !== undefined && import.meta.url === pathToFileURL(entryFile).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
