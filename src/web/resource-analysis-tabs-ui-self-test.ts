import assert from "node:assert/strict";

import { createTabbedResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-tabs-ui.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";

const html = createTabbedResourceAnalysisWebMvpIndexHtml(createFallbackWebVersionInfo());

assert.match(html, /id="analysisPayloadEncoding" type="checkbox"/);
assert.doesNotMatch(html, /id="analysisPayloadEncoding"[^>]*\schecked(?:\s|>)/);
assert.match(html, /计算 Playable Payload 编码体积/);
assert.match(html, /分析时间会明显延长/);
assert.match(html, /measurePayloadEncoding: analysisPayloadEncodingInput\.checked/);
assert.match(html, /measurePayloadEncoding=' \+ \(analysisPayloadEncodingInput\.checked/);
assert.match(html, /最终单 HTML（/);
assert.match(html, /finalHtmlCard\('base64'\)/);
assert.match(html, /finalHtmlCard\('base91'\)/);
assert.match(html, /finalHtmlCard\('html7'\)/);
assert.match(html, /data-analysis-subtab/);
assert.match(html, /压缩收益明细/);

console.log("resource analysis tabs UI self-test passed");
