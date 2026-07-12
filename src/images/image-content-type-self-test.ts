import assert from "node:assert/strict";
import { detectImageMimeType } from "./image-content-type.js";

assert.equal(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
assert.equal(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
assert.equal(detectImageMimeType(Buffer.from("RIFF0000WEBP", "ascii")), "image/webp");
assert.equal(detectImageMimeType(Buffer.from("not-image", "ascii")), null);
console.log("图片内容 MIME 检测自测通过");
