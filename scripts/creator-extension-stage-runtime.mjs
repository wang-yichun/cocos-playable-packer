import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptFile), "..");
const extensionRoot = path.join(repositoryRoot, "extensions", "cocos-playable-packer");
const runtimeRoot = path.join(extensionRoot, "runtime");

async function requireDirectory(target, label) {
  await access(target).catch(() => {
    throw new Error(`${label} does not exist. Build the package before staging the Creator runtime: ${target}`);
  });
}

await requireDirectory(path.join(repositoryRoot, "src"), "Pipeline source");
await requireDirectory(path.join(repositoryRoot, "dist"), "Compiled pipeline");
await mkdir(runtimeRoot, { recursive: true });

for (const directory of ["src", "dist"]) {
  const target = path.join(runtimeRoot, directory);
  await rm(target, { recursive: true, force: true });
  await cp(path.join(repositoryRoot, directory), target, { recursive: true });
}

console.log(`Creator extension runtime staged at ${runtimeRoot}`);
