import assert from "node:assert/strict";

import {
  applyOverviewResourceLayout,
  renderOverviewResourceInsights,
  type OverviewReportData,
} from "./resource-analysis-overview-report.js";

const report: OverviewReportData = {
  buildBytes: 1_000_000,
  buildExtensions: [
    { extension: ".json", fileCount: 4, bytes: 600_000, percentOfBuildBytes: 60 },
    { extension: ".js", fileCount: 2, bytes: 300_000, percentOfBuildBytes: 30 },
    { extension: ".png", fileCount: 5, bytes: 100_000, percentOfBuildBytes: 10 },
  ],
  sourceCategories: [
    {
      category: "image",
      sourceCount: 10,
      sourceBytes: 500_000,
      includedCount: 8,
      includedBytes: 400_000,
      notInBuildCount: 2,
      notInBuildBytes: 100_000,
      notAssessableCount: 0,
      notAssessableBytes: 0,
      includedPercentByCount: 80,
      includedPercentByBytes: 80,
    },
  ],
};

const section = renderOverviewResourceInsights(report);
assert.match(section, /构建与源资源概况/);
assert.match(section, /overview-insights-grid/);
assert.match(section, /aria-label="构建资源体积构成饼图"/);
assert.match(section, /\.json/);
assert.match(section, /60\.00%/);
assert.match(section, /源资源进入构建比例/);
assert.match(section, /图片/);

const sourceHtml = `<style></style><section class="report-tab-panel" data-report-panel="overview"><h2>构建资源体积构成</h2><div>旧构成</div><h2>图片与音频优化前后对比</h2><div>保留优化内容</div><h2>源资源进入构建比例</h2><div>旧比例</div></section><section class="report-tab-panel" data-report-panel="attention" hidden></section>`;
const applied = applyOverviewResourceLayout(report, sourceHtml);
assert.match(applied, /overview-pie-svg/);
assert.match(applied, /保留优化内容/);
assert.doesNotMatch(applied, /旧构成/);
assert.doesNotMatch(applied, /旧比例/);
assert.match(applied, /@media\(max-width:920px\)/);
assert.match(
  applied,
  /<\/section>\s*<section class="report-tab-panel" data-report-panel="attention" hidden>/,
  "概况和需人工关注面板必须保持为同级 section。",
);
assert.equal(
  (applied.match(/<section class="report-tab-panel"/g) ?? []).length,
  2,
  "概况重排不应丢失或嵌套报告面板。",
);

console.log("resource analysis overview report self-test passed");
