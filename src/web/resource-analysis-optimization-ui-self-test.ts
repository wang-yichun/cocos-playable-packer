import assert from "node:assert/strict";

import { createResourceOptimizationWebMvpIndexHtml } from "./resource-analysis-optimization-ui.js";

const html = createResourceOptimizationWebMvpIndexHtml();
assert.match(html, /图片与音频优化估算/);
assert.match(html, /打开完整 HTML 报告/);
assert.match(html, /下载 HTML 报告/);
assert.match(html, /report\.html/);
assert.match(html, /estimateKind === 'measured'/);
assert.match(html, /对总构建影响/);
assert.match(html, /generated-group/);
assert.match(html, /可能关联的源图片组/);
assert.match(html, /不是一对一映射/);
assert.match(html, /Web Mobile 原始体积预计减少/);

console.log("resource analysis optimization UI self-test passed");
