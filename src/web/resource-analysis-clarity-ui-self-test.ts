import assert from "node:assert/strict";

import { createClarifiedResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-clarity-ui.js";

const html = createClarifiedResourceAnalysisWebMvpIndexHtml();
assert.match(html, /预计优化后 Web Mobile/);
assert.match(html, /Web Mobile 原始体积预计减少/);
assert.match(html, /不等同于最终 Brotli Payload 或单 HTML 降幅/);
assert.doesNotMatch(html, />预计总构建减少</);

console.log("resource analysis clarity UI self-test passed");
