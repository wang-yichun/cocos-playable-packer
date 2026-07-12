import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { detectImageMimeType } from "../images/image-content-type.js";
import { optimizeBuildWebp } from "./optimize-build-webp.js";

const root = await mkdtemp(path.join(tmpdir(), "webp-optimize-"));
const build = path.join(root, "web-mobile");
const image = path.join(build, "assets", "sprite.png");
await mkdir(path.dirname(image), { recursive: true });
const pixels = Buffer.alloc(128 * 128 * 4);
for (let index = 0; index < 128 * 128; index += 1) {
  pixels[index * 4] = index % 256;
  pixels[index * 4 + 1] = Math.floor(index / 128) % 256;
  pixels[index * 4 + 2] = (index * 19) % 256;
  pixels[index * 4 + 3] = index % 3 === 0 ? 120 : 255;
}
await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).png().toFile(image);
const before = await readFile(image);
const preview = await optimizeBuildWebp({ buildDirectory: build, pngQuality: 80, jpegQuality: 75, confirm: false, reportFile: path.join(root, "preview.json") });
assert.equal((preview.summary as { wouldOptimizeImages: number }).wouldOptimizeImages, 1);
assert.equal(detectImageMimeType(await readFile(image)), "image/png");
const applied = await optimizeBuildWebp({ buildDirectory: build, pngQuality: 80, jpegQuality: 75, confirm: true, reportFile: path.join(root, "applied.json") });
assert.equal((applied.summary as { optimizedImages: number }).optimizedImages, 1);
const after = await readFile(image);
assert.equal(detectImageMimeType(after), "image/webp");
assert.ok(after.byteLength < before.byteLength);
console.log("WebP 构建优化自测通过");
