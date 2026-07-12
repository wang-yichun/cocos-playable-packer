import assert from "node:assert/strict";

import { createChannelWebMvpIndexHtml } from "./web-channel-ui.js";
import {
  createFallbackWebVersionInfo,
  parseFfmpegVersion,
  type WebVersionInfo,
} from "./web-version-info.js";

assert.equal(
  parseFfmpegVersion("ffmpeg version 7.1.1-full_build-www.gyan.dev Copyright"),
  "7.1.1-full_build-www.gyan.dev",
);
assert.equal(parseFfmpegVersion("unexpected output"), null);
assert.equal(parseFfmpegVersion(null), null);

const fallback = createFallbackWebVersionInfo();
assert.equal(fallback.copyrightName, "wang-yichun");
assert.match(fallback.nodeVersion, /^v\d+/);

const versionInfo: WebVersionInfo = {
  appVersion: "1.2.3",
  buildSha: "abcdef1234567890",
  buildShortSha: "abcdef12",
  buildDate: "2026-07-12T12:00:00+08:00",
  generatedAt: "2026-07-12T12:05:00.000Z",
  nodeVersion: "v22.20.0",
  ffmpegVersion: "7.1.1",
  components: [
    { name: "sharp", version: "0.35.3" },
    { name: "@jsquash/webp", version: "1.5.0" },
  ],
  copyrightYear: 2026,
  copyrightName: "wang-yichun",
};

const html = createChannelWebMvpIndexHtml(versionInfo);
assert.match(html, /Cocos Playable Packer v1\.2\.3/);
assert.match(html, /Build abcdef12/);
assert.match(html, /Node\.js v22\.20\.0/);
assert.match(html, /FFmpeg<\/dt><dd>7\.1\.1/);
assert.match(html, /sharp<\/dt><dd>0\.35\.3/);
assert.match(html, /@jsquash\/webp/);
assert.match(html, /© 2026 wang-yichun\. All rights reserved\./);
assert.match(html, /版本与许可/);
assert.match(html, /与 Cocos 官方无隶属或授权关系/);
assert.match(html, /class="app-footer"/);

const escapedHtml = createChannelWebMvpIndexHtml({
  ...versionInfo,
  copyrightName: "<script>alert(1)</script>",
});
assert.doesNotMatch(escapedHtml, /<script>alert\(1\)<\/script>/);
assert.match(escapedHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

console.log("Web version footer self-test passed.");
