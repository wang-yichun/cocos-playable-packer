import assert from "node:assert/strict";

import { createRedundancyResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-redundancy-ui.js";

const html = createRedundancyResourceAnalysisWebMvpIndexHtml();
assert.match(html, /完全重复的工程资源/);
assert.match(html, /工程理论重复字节/);
assert.match(html, /renderSourceRedundancySection/);
assert.match(html, /redundancyClassificationLabel/);
assert.match(html, /不等于最终构建、Brotli Payload 或单 HTML/);
assert.match(html, /renderOptimizationSection\(report\)[\s\S]*renderSourceRedundancySection\(report\)/);

console.log("resource analysis redundancy UI self-test passed");
