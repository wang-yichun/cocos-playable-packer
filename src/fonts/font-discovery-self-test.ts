import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  discoverBuildFonts,
  hasSupportedSfntSignature,
} from "./font-discovery.js";

async function main(): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "font-discovery-"));
  try {
    const nested = path.join(directory, "assets", "native", "ab");
    await mkdir(nested, { recursive: true });

    const sfnt = Buffer.alloc(12);
    sfnt.writeUInt32BE(0x00010000, 0);
    sfnt.writeUInt16BE(0, 4);

    await writeFile(path.join(nested, "font-resource.bin"), sfnt);
    await writeFile(path.join(nested, "not-a-font.ttf"), "plain text");
    await writeFile(path.join(nested, "data.json"), "{}");

    assert.equal(hasSupportedSfntSignature(sfnt), true);
    assert.equal(hasSupportedSfntSignature(Buffer.from("OTTO")), true);
    assert.equal(hasSupportedSfntSignature(Buffer.from("wOFF")), false);

    const fonts = await discoverBuildFonts(directory);
    assert.equal(fonts.length, 1);
    assert.equal(fonts[0]?.relativePath, "assets/native/ab/font-resource.bin");
    assert.equal(fonts[0]?.extension, ".bin");
    assert.equal(fonts[0]?.bytes, 12);

    console.log("Font signature discovery self-test passed.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
