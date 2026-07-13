import { createResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-ui.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main(): void {
  const html = createResourceAnalysisWebMvpIndexHtml();

  assert(html.includes('id="packFeatureTab"'), "应保留 Playable 打包选项卡。");
  assert(html.includes('id="analysisFeatureTab"'), "应生成资源体检选项卡。");
  assert(html.includes('id="resourceAnalysisPanel"'), "应生成资源体检面板。");
  assert(html.includes('id="analysisZipFile"'), "应提供 Web Mobile ZIP 输入。");
  assert(html.includes('id="analysisManifestFile"'), "应提供可选资源清单输入。");
  assert(html.includes('id="downloadManifestCmdButton"'), "应提供工程扫描 CMD 下载入口。");
  assert(html.includes("未在本次构建中发现"), "报告应使用审慎的未进入构建措辞。");
  assert(html.includes("percentOfBuildBytes"), "报告应包含构建体积百分比图示。");
  assert(html.includes("includedPercentByBytes"), "报告应包含源资源进入构建比例图示。");

  console.log("resource analysis UI self-test passed");
}

main();
