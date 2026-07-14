import assert from "node:assert/strict";

import { explainBuildArtifact } from "./build-artifact-explanations.js";

assert.equal(explainBuildArtifact("cocos-js/cc.js", ".js", []).kind, "cocos-engine-runtime");
assert.equal(
  explainBuildArtifact("cocos-js/bullet.release.asm-C9Akztuy.js", ".js", []).kind,
  "bullet-physics-runtime",
);
assert.equal(
  explainBuildArtifact("assets/main/index.js", ".js", []).kind,
  "project-bundle-script",
);
assert.equal(
  explainBuildArtifact("assets/main/import/02/026a1f16f.json", ".json", []).kind,
  "cocos-serialized-import",
);
assert.equal(
  explainBuildArtifact("assets/resources/native/1d/1d2fe10d0.png", ".png", []).kind,
  "generated-texture-or-atlas",
);
assert.equal(
  explainBuildArtifact("src/assets/scripts/libs/crypto-js/crypto-js.js", ".js", []).kind,
  "project-or-third-party-library",
);
assert.equal(
  explainBuildArtifact(
    "assets/main/native/97/example.bin",
    ".bin",
    ["assets/Art3/hero.fbx"],
  ).kind,
  "mapped-source-resource",
);
assert.equal(
  explainBuildArtifact("misc/runtime.data", ".data", []).confidence,
  "low",
);

console.log("build artifact explanations self-test passed");
