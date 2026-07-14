import assert from "node:assert/strict";

import { createBuildFilesResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-build-files-ui.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";

const html = createBuildFilesResourceAnalysisWebMvpIndexHtml(createFallbackWebVersionInfo());

assert.match(html, /构建产物大文件排行/);
assert.match(html, /大型构建脚本/);
assert.match(html, /大型构建 JSON/);
assert.match(html, /大型构建二进制/);
assert.match(html, /mappedBuildBytes/);
assert.match(html, /largestBuildFiles/);
assert.match(html, /需人工关注/);
assert.match(html, /data-analysis-subtab/);

console.log("resource analysis build files UI self-test passed");
