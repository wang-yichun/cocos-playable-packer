import assert from "node:assert/strict";
import { Script } from "node:vm";

import { createPlayableBuildReportWebMvpIndexHtml } from "./playable-build-report-ui.js";
import {
  repairBuildReportInlineScript,
  simplifyBuildReportSettingsLayout,
  supportRawSingleHtmlBuildReport,
} from "./web-preset-help-ui.js";
import { createFallbackWebVersionInfo } from "./web-version-info.js";

const rawHtml = createPlayableBuildReportWebMvpIndexHtml(createFallbackWebVersionInfo());
const html = simplifyBuildReportSettingsLayout(
  supportRawSingleHtmlBuildReport(
    repairBuildReportInlineScript(rawHtml),
  ),
);

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
assert.match(html, /\.report-setting-row \{/);
assert.doesNotMatch(html, /grid-template-columns: repeat\(4, minmax\(130px, 1fr\)\)/);

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);

assert.match(inlineScript, /String\.fromCharCode\(92\)/);
assert.doesNotMatch(inlineScript, /\.replace\(\/\\\/g/);
assert.match(inlineScript, /<dl class="report-settings">/);
assert.match(inlineScript, /class="report-setting-row"/);
assert.doesNotMatch(inlineScript, /<article class="report-setting">/);
assert.match(inlineScript, /viewReportButton\.disabled = false/);
assert.match(inlineScript, /url\.searchParams\.delete\('download'\)/);
assert.match(inlineScript, /fetch\(reportUrl\.pathname \+ reportUrl\.search/);
assert.match(inlineScript, /renderReportDonut/);
assert.match(inlineScript, /renderReportComparisons/);
assert.match(inlineScript, /renderReportTimings/);
assert.match(inlineScript, /renderReportDeliveries/);
assert.match(inlineScript, /report\.buildMode === 'raw-single-html'/);
assert.match(inlineScript, /value === null \|\| value === undefined \|\| value === ''/);
assert.match(
  inlineScript,
  /reportLink\.href = job\.links\.report \+ '\?download=1&bundle=1'/,
);

const rendererStart = inlineScript.indexOf("    function reportObject");
const rendererEnd = inlineScript.indexOf("    function buildReportJsonUrl");
assert.ok(rendererStart >= 0);
assert.ok(rendererEnd > rendererStart);
const rendererSource = inlineScript.slice(rendererStart, rendererEnd);

function renderFixture(report: unknown): string {
  const context: Record<string, unknown> = {
    report,
    renderedHtml: "",
    optionalNull: undefined,
    optionalEmpty: undefined,
  };
  new Script(`
    const buildReportContent = { innerHTML: '' };
${rendererSource}
    optionalNull = reportOptionalNumber(null);
    optionalEmpty = reportOptionalNumber('');
    renderBuildReport(report);
    renderedHtml = buildReportContent.innerHTML;
  `).runInNewContext(context);
  assert.equal(context.optionalNull, null);
  assert.equal(context.optionalEmpty, null);
  return String(context.renderedHtml);
}

const rawReportHtml = renderFixture({
  schemaVersion: 1,
  buildMode: "raw-single-html",
  startedAt: "2026-07-25T00:00:00.000Z",
  completedAt: "2026-07-25T00:00:01.500Z",
  input: {
    directory: "D:\\Projects\\game\\build\\web-mobile",
  },
  processing: {
    imageOptimization: false,
    audioOptimization: false,
    brotliCompression: false,
    payloadEncoding: null,
  },
  output: {
    file: "D:\\Projects\\game\\dist\\game.html",
    bytes: 25_600_000,
    sha256: "a".repeat(64),
  },
  timingMs: {
    total: 1_500,
  },
});

assert.match(rawReportHtml, /实际输出 · 未压缩单 HTML · 图片未处理/);
assert.match(rawReportHtml, />未记录</);
assert.match(rawReportHtml, />不适用</);
assert.match(rawReportHtml, /图片压缩未执行/);
assert.match(rawReportHtml, /Brotli 压缩/);
assert.match(rawReportHtml, /未生成 Brotli 数据块/);
assert.doesNotMatch(rawReportHtml, /实际输出 · Base64/);
assert.doesNotMatch(rawReportHtml, /raw-js/);
assert.doesNotMatch(rawReportHtml, /减少 0\.00%/);

const optimizedReportHtml = renderFixture({
  schemaVersion: 3,
  tool: "playable-build",
  status: "succeeded",
  startedAt: "2026-07-25T00:00:00.000Z",
  completedAt: "2026-07-25T00:00:03.000Z",
  project: { key: "game", explicitName: null },
  input: {
    directory: "D:\\Projects\\game\\build\\web-mobile",
    fileCount: 100,
    totalBytes: 10_000,
    imageCount: 20,
    imageBytes: 4_000,
    audioCount: 5,
    audioBytes: 2_000,
  },
  imageOptimization: {
    mode: "squoosh",
    beforeBytes: 4_000,
    afterBytes: 2_000,
    savedBytes: 2_000,
    savedPercent: 50,
    settings: { pngQuality: 80, jpegQuality: 80 },
  },
  audioOptimization: {
    enabled: false,
    targetBitrateKbps: null,
    preserveChannels: true,
    beforeBytes: 2_000,
    afterBytes: 2_000,
    savedBytes: 0,
    savedPercent: 0,
  },
  payloadEncoding: {
    mode: "base64",
    base64HtmlBytes: 8_000,
    outputHtmlBytes: 8_000,
    savedBytes: 0,
    savedPercent: 0,
  },
  brotliFallback: { mode: "raw-js" },
  output: {
    file: "D:\\Projects\\game\\dist\\game.html",
    bytes: 8_000,
    sha256: "b".repeat(64),
  },
  timingMs: {
    imageOptimization: 1_000,
    packaging: 1_000,
    total: 3_000,
  },
});

assert.match(optimizedReportHtml, /实际输出 · base64 · squoosh/);
assert.match(optimizedReportHtml, /Squoosh（PNG 量化 \+ OxiPNG \/ MozJPEG）/);
assert.match(optimizedReportHtml, /Brotli 回退/);
assert.match(optimizedReportHtml, /raw-js/);
assert.match(optimizedReportHtml, /减少 20\.00%/);

console.log("Playable human-readable build report UI self-test passed.");
