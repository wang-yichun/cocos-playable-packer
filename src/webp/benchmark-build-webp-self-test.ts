import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { detectImageMimeType } from "../images/image-content-type.js";
import { benchmarkBuildWebp } from "./benchmark-build-webp.js";

const root = await mkdtemp(path.join(tmpdir(), "webp-benchmark-"));
const input = path.join(root, "input");
const output = path.join(root, "output");
await mkdir(path.join(input, "assets"), { recursive: true });
await writeFile(path.join(input, "index.html"), "<!doctype html>");
const width = 128;
const height = 128;
const pixels = Buffer.alloc(width * height * 4);
for (let index = 0; index < width * height; index += 1) {
  pixels[index * 4] = index % 256;
  pixels[index * 4 + 1] = Math.floor(index / width) % 256;
  pixels[index * 4 + 2] = (index * 17) % 256;
  pixels[index * 4 + 3] = index % 5 === 0 ? 128 : 255;
}
await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(path.join(input, "assets", "sprite.png"));
await sharp(pixels, { raw: { width, height, channels: 4 } }).jpeg({ quality: 95 }).toFile(path.join(input, "assets", "photo.jpg"));
await benchmarkBuildWebp({ inputDirectory: input, outputDirectory: output, pngQuality: 80, jpegQuality: 80 });
const report = JSON.parse(await readFile(path.join(output, "webp-benchmark-report.json"), "utf8")) as { summary: { scannedImages: number; appliedImages: number }; files: Array<{ path: string; appliedToBuildCopy: boolean }> };
assert.equal(report.summary.scannedImages, 2);
assert.ok(report.summary.appliedImages >= 1);
for (const file of report.files.filter(item => item.appliedToBuildCopy)) {
  const converted = await readFile(path.join(output, "web-mobile", ...file.path.split("/")));
  assert.equal(detectImageMimeType(converted), "image/webp");
}
assert.match(await readFile(path.join(output, "webp-preview.html"), "utf8"), /WebP 批量基准/);
console.log("WebP 批量基准自测通过");
