import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  creatorExtensionLinkStatus,
  extensionTargetForProject,
  linkCreatorExtension,
  unlinkCreatorExtension,
  validateCreatorProject,
} from "./creator-extension-link.mjs";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "creator-extension-link-"));
try {
  const projectRoot = path.join(temporaryRoot, "game143");
  const source = path.join(temporaryRoot, "extension-source");
  const excludeFile = path.join(projectRoot, ".git", "info", "exclude");
  await mkdir(path.join(projectRoot, "assets"), { recursive: true });
  await mkdir(path.dirname(excludeFile), { recursive: true });
  await mkdir(source, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    `${JSON.stringify({ name: "game143", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(excludeFile, "# user excludes\n/local-only/\n", "utf8");
  await writeFile(path.join(source, "package.json"), "{}\n", "utf8");

  assert.equal(await validateCreatorProject(projectRoot), path.resolve(projectRoot));
  const target = extensionTargetForProject(projectRoot);

  const linked = await linkCreatorExtension(projectRoot, { source });
  assert.equal(linked.status, "linked");
  assert.equal(linked.target, target);
  assert.equal(linked.gitExcludeFile, excludeFile);
  assert.equal(await realpath(target), await realpath(source));
  const linkedExclude = await readFile(excludeFile, "utf8");
  assert.match(linkedExclude, /# user excludes/);
  assert.match(linkedExclude, /\/local-only\//);
  assert.match(linkedExclude, /cocos-playable-packer managed Creator extension link/);
  assert.match(linkedExclude, /\/extensions\/cocos-playable-packer\//);

  const alreadyLinked = await linkCreatorExtension(projectRoot, { source });
  assert.equal(alreadyLinked.status, "already-linked");
  const repeatedExclude = await readFile(excludeFile, "utf8");
  assert.equal(
    repeatedExclude.match(/\/extensions\/cocos-playable-packer\//g)?.length,
    1,
  );

  const status = await creatorExtensionLinkStatus(projectRoot);
  assert.equal(status.exists, true);
  assert.equal(status.locallyIgnored, true);
  assert.equal(status.gitExcludeFile, excludeFile);
  assert.equal(path.resolve(status.linkedTo), path.resolve(await realpath(source)));

  const unlinked = await unlinkCreatorExtension(projectRoot);
  assert.equal(unlinked.status, "unlinked");
  const unlinkedStatus = await creatorExtensionLinkStatus(projectRoot);
  assert.equal(unlinkedStatus.exists, false);
  assert.equal(unlinkedStatus.locallyIgnored, false);
  const remainingExclude = await readFile(excludeFile, "utf8");
  assert.match(remainingExclude, /# user excludes/);
  assert.match(remainingExclude, /\/local-only\//);
  assert.doesNotMatch(remainingExclude, /cocos-playable-packer managed/);
  assert.doesNotMatch(remainingExclude, /\/extensions\/cocos-playable-packer\//);

  const notLinked = await unlinkCreatorExtension(projectRoot);
  assert.equal(notLinked.status, "not-linked");

  await mkdir(target, { recursive: true });
  await assert.rejects(
    linkCreatorExtension(projectRoot, { source }),
    /普通目录，拒绝覆盖/,
  );
  await assert.rejects(
    unlinkCreatorExtension(projectRoot),
    /普通目录，拒绝删除/,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Creator extension link manager self-test passed.");
