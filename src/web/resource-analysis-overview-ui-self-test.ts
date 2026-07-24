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
assert.match(html, /id="viewBuildReportButton"/);
assert.match(html, />查看报告<\/button>/);
assert.match(html, />下载 JSON 报告<\/a>/);
assert.match(html, /id="buildReportDialog"/);
assert.match(html, /只展示本次构建已经实际产生并写入 JSON 的数据/);
assert.match(html, /function renderBuildReport\(report\)/);
assert.match(html, /function buildReportOptimizationSection/);
assert.match(html, /function buildReportTimingSection/);
assert.match(html, /function buildReportDeliveriesSection/);
assert.match(html, /completedReportUrl = job\.links\.report \+ '\?bundle=1'/);
assert.doesNotMatch(html, /估算其他压缩模式/);

console.log("resource analysis overview UI self-test passed");
