import assert from "node:assert/strict";
import { Script } from "node:vm";

import { createDevicePreviewPageHtml } from "./device-preview-page.js";
import { createOverviewResourceAnalysisWebMvpIndexHtml } from "./resource-analysis-overview-ui.js";

function compileInlineScripts(html: string): void {
  const inlineScripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
  assert.ok(inlineScripts.length > 0, "页面缺少可检查的内联脚本。");
  for (const match of inlineScripts) new Script(match[1] ?? "");
}

const mainHtml = createOverviewResourceAnalysisWebMvpIndexHtml();
assert.match(mainHtml, /id="devicePreviewButton"[^>]*>模拟真机预览</);
assert.equal((mainHtml.match(/id="devicePreviewButton"/g) ?? []).length, 1);
assert.doesNotMatch(mainHtml, /id="devicePreviewDialog"/);
assert.match(mainHtml, /new URL\('\/device-preview'/);
assert.match(mainHtml, /devicePreviewUrl\.searchParams\.set\('source'/);
assert.match(mainHtml, /window\.open\(devicePreviewUrl\.href, '_blank', 'noopener'\)/);
compileInlineScripts(mainHtml);

const previewHtml = createDevicePreviewPageHtml();
assert.match(previewHtml, /<title>模拟真机预览 · Cocos Playable Packer<\/title>/);
assert.match(previewHtml, /height: 100dvh/);
assert.match(previewHtml, /id="devicePreviewStage"/);
assert.match(previewHtml, /id="devicePreviewViewport"/);
assert.match(previewHtml, /iPhone SE/);
assert.match(previewHtml, /iPhone 15/);
assert.match(previewHtml, /Pixel 8/);
assert.match(previewHtml, /Galaxy S24/);
assert.match(previewHtml, /iPad mini/);
assert.match(previewHtml, /data-device-orientation="portrait"/);
assert.match(previewHtml, /data-device-orientation="landscape"/);
assert.match(previewHtml, /devicePreviewFrame\.src = 'about:blank'/);
assert.match(previewHtml, /applyDeviceLayout\(true\)/);
assert.match(previewHtml, /devicePreviewViewport\.style\.width/);
assert.match(previewHtml, /devicePreviewViewport\.style\.height/);
assert.match(previewHtml, /candidate\.origin === window\.location\.origin/);
compileInlineScripts(previewHtml);

console.log("Device preview Web UI self-test passed.");
