import assert from "node:assert/strict";

import { createOverviewResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-overview-ui.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";

const html = createOverviewResourceAnalysisWebMvpIndexHtml(createFallbackWebVersionInfo());

assert.match(html, /analysis-overview-columns/);
assert.match(html, /analysis-pie-svg/);
assert.match(html, /analysisPiePath/);
assert.match(html, /analysisBuildPieSlices/);
assert.match(html, /renderOverviewInsights\(report\)/);
assert.match(html, /构建与源资源概况/);
assert.match(html, /主要扩展名以扇形占比展示/);
assert.match(html, /源资源进入构建比例/);
assert.match(html, /@media \(max-width: 920px\)/);

console.log("resource analysis overview UI self-test passed");
