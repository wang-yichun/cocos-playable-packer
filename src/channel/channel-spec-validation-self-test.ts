import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createChannelDownloadArtifact } from "./liftoff-delivery.js";
import {
  TEST_ANDROID_STORE_URL,
  TEST_IOS_STORE_URL,
  type ChannelPlatform,
} from "./channel-profile.js";
import { validateChannelArtifactFile } from "./channel-spec-validation-file.js";
import { validateChannelArtifact } from "./channel-spec-validation.js";

const sourceHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
window.__PACK_ARCHIVE__={"v":1,"c":"br","e":"base64","n":0,"b":""};
(function () {
    async function boot() {
        window.__channelValidationTest = true;
    }
    boot().catch(
        function (error) {
            console.error(error);
        }
    );
})();
</script>
</body></html>`;

function config(platform: ChannelPlatform) {
  return {
    platform,
    androidStoreUrl: TEST_ANDROID_STORE_URL,
    iosStoreUrl: TEST_IOS_STORE_URL,
  };
}

function issueCodes(report: ReturnType<typeof validateChannelArtifact>): string[] {
  return report.issues.map((issue) => issue.code);
}

const invalidMoloco = validateChannelArtifact({
  platform: "Moloco",
  deliveryFormat: "zip-single-html",
  artifactBytes: 5_100_000,
  entries: ["index.html"],
  textFiles: {
    "index.html": [
      '<script src="https://example.com/runtime.js"></script>',
      '<script src="mraid.js"></script>',
      "<script>new XMLHttpRequest()</script>",
    ].join("\n"),
  },
});
assert.equal(invalidMoloco.valid, false);
assert.deepEqual(
  new Set(issueCodes(invalidMoloco)),
  new Set([
    "ARTIFACT_SIZE_EXCEEDED",
    "DELIVERY_FORMAT_MISMATCH",
    "EXTERNAL_RESOURCE_REFERENCE",
    "MOLOCO_CTA_MISSING",
    "MRAID_SCRIPT_BUNDLED",
    "XMLHTTPREQUEST_PRESENT",
  ]),
);

const googleWithoutMeta = validateChannelArtifact({
  platform: "Google",
  deliveryFormat: "zip-html-res-js",
  artifactBytes: 4_000_000,
  entries: ["index.html", "res.js"],
  textFiles: {
    "index.html": [
      '<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>',
      "<script>ExitApi.exit()</script>",
    ].join("\n"),
    "res.js": "",
  },
});
assert.equal(googleWithoutMeta.valid, true);
assert.ok(issueCodes(googleWithoutMeta).includes("GOOGLE_AD_META_MISSING"));

const oversizedGoogle = validateChannelArtifact({
  platform: "Google",
  deliveryFormat: "zip-html-res-js",
  artifactBytes: 4_000_000,
  entries: Array.from({ length: 513 }, (_, index) => (
    index === 0 ? "index.html" : index === 1 ? "res.js" : `asset-${index}.bin`
  )),
  textFiles: {
    "index.html": [
      '<meta name="ad.orientation" content="portrait">',
      '<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>',
      "<script>ExitApi.exit()</script>",
    ].join("\n"),
    "res.js": "",
  },
});
assert.equal(oversizedGoogle.valid, false);
assert.ok(issueCodes(oversizedGoogle).includes("ENTRY_COUNT_EXCEEDED"));

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "channel-spec-validation-test-"),
);
try {
  const cases = [
    {
      platform: "AppLovin" as const,
      expectedIssue: "AUDIO_POLICY_REQUIRES_RUNTIME_TEST",
    },
    {
      platform: "Google" as const,
      expectedIssue: "GOOGLE_AD_META_MISSING",
    },
    {
      platform: "Liftoff" as const,
      expectedIssue: "LIFTOFF_CTA_ARGUMENT_REQUIRES_TEST",
    },
    {
      platform: "Unity" as const,
      expectedIssue: "UNITY_DEVICE_TEST_REQUIRED",
    },
    {
      platform: "Moloco" as const,
      expectedIssue: "MOLOCO_JAVASCRIPT_REDIRECT_PRESENT",
    },
  ];

  for (const testCase of cases) {
    const artifact = createChannelDownloadArtifact(
      sourceHtml,
      config(testCase.platform),
    );
    const artifactFile = path.join(temporaryRoot, artifact.fileName);
    await writeFile(artifactFile, artifact.body);

    const result = await validateChannelArtifactFile(
      artifactFile,
      testCase.platform,
    );
    assert.equal(
      result.report.valid,
      true,
      `${testCase.platform} 当前生成产物不应出现确定性规范错误。`,
    );
    assert.equal(result.report.actualFormat, artifact.deliveryFormat);
    assert.ok(
      result.report.issues.some((issue) => issue.code === testCase.expectedIssue),
      `${testCase.platform} 应保留待人工验证警告 ${testCase.expectedIssue}。`,
    );
  }

  const facebookArtifact = createChannelDownloadArtifact(
    sourceHtml,
    config("Facebook"),
  );
  const facebookFile = path.join(temporaryRoot, facebookArtifact.fileName);
  await writeFile(facebookFile, facebookArtifact.body);
  const facebook = await validateChannelArtifactFile(facebookFile, "Facebook");
  assert.equal(facebook.report.valid, true);
  assert.ok(issueCodes(facebook.report).includes("OFFICIAL_SPEC_UNVERIFIED"));

  const ironSourceArtifact = createChannelDownloadArtifact(
    sourceHtml,
    config("IronSource"),
  );
  const ironSourceFile = path.join(temporaryRoot, ironSourceArtifact.fileName);
  await writeFile(ironSourceFile, ironSourceArtifact.body);
  const ironSource = await validateChannelArtifactFile(
    ironSourceFile,
    "IronSource",
  );
  assert.equal(ironSource.report.valid, true);
  assert.ok(issueCodes(ironSource.report).includes("OFFICIAL_SPEC_UNVERIFIED"));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Channel specification validation self-test passed.");
