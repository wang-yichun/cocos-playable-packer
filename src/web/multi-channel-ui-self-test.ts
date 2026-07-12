import assert from "node:assert/strict";
import { Script } from "node:vm";

import { CHANNEL_PLATFORMS } from "../channel/channel-profile.js";
import { createChannelWebMvpIndexHtml } from "./web-channel-ui.js";

const html = createChannelWebMvpIndexHtml();
const channelCheckboxes = html.match(
  /<input\s+type="checkbox"\s+name="channelPlatform"\s+value="[^"]+"\s+checked>/g,
) ?? [];
assert.equal(channelCheckboxes.length, CHANNEL_PLATFORMS.length);
for (const platform of CHANNEL_PLATFORMS) {
  assert.match(
    html,
    new RegExp(
      `<input\\s+type="checkbox"\\s+name="channelPlatform"\\s+value="${platform}"\\s+checked>`,
    ),
  );
}
assert.match(html, /目标渠道（可多选）/);
assert.match(html, /默认全选/);
assert.match(html, /选择试玩渠道/);
assert.match(html, /下载渠道合集 ZIP/);

const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.notEqual(inlineScriptMatch, null);
const inlineScript = inlineScriptMatch?.[1] ?? "";
new Script(inlineScript);
assert.match(inlineScript, /\?download=1&bundle=1/);
assert.match(inlineScript, /reportLink\.href = job\.links\.report \+ '\?download=1&bundle=1'/);
assert.match(inlineScript, /previewChannelDialog\.showModal\(\)/);
assert.match(inlineScript, /channel=' \+ encodeURIComponent\(previewChannelSelect\.value\)/);
assert.match(inlineScript, /platforms: channelPlatforms/);
assert.match(inlineScript, /至少需要选择一个目标渠道/);

console.log("Multi-channel Web UI self-test passed.");
