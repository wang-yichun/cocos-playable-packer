import assert from "node:assert/strict";
import { Script } from "node:vm";

import { createPlayableBuildReportWebMvpIndexHtml } from "./playable-build-report-ui.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";

const html = createPlayableBuildReportWebMvpIndexHtml(createFallbackWebVersionInfo());

for (const id of [
  "viewReportButton",
  "reportLink",
  "buildReportDialog",
  "buildReportContent",
  "reportDialogDownloadLink",
  "closeBuildReportButton",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`));
}

assert.match(html, />查看报告<\/button>/);
assert.match(html, />下载 JSON 报告<\/a>/);
assert.match(html, /优化后资源构成/);
assert.match(html, /压缩前后对比/);
assert.match(html, /流水线耗时/);
assert.match(html, /本次构建配置/);
assert.match(html, /渠道交付/);
assert.match(html, /无法可靠拆分最终 HTML 内的类别占比/);
assert.doesNotMatch(html, />下载报告<\/a>/);

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);

assert.match(inlineScript, /viewReportButton\.disabled = false/);
assert.match(inlineScript, /url\.searchParams\.delete\('download'\)/);
assert.match(inlineScript, /fetch\(reportUrl\.pathname \+ reportUrl\.search/);
assert.match(inlineScript, /renderReportDonut/);
assert.match(inlineScript, /renderReportComparisons/);
assert.match(inlineScript, /renderReportTimings/);
assert.match(inlineScript, /renderReportDeliveries/);
assert.match(
  inlineScript,
  /reportLink\.href = job\.links\.report \+ '\?download=1&bundle=1'/,
);

console.log("Playable human-readable build report UI self-test passed.");
