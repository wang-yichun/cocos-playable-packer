---
name: cocos-playable-pipeline
description: Package, validate, debug, and extend Cocos Creator web-mobile playable ads for Meta/Facebook and other delivery channels. Use when working on playable export pipelines, channel adapters, embedded Cocos resources, CTA/lifecycle bridges, sandbox compatibility, or channel certification tests.
---

# Cocos Playable Pipeline

Use this skill to treat a playable ad as three coordinated layers:

1. A channel-neutral game API (`PlayableFacade`) for CTA, lifecycle, and event calls.
2. A shared embedded Cocos runtime that maps archive resources into the browser.
3. A channel profile containing packaging rules, bridge functions, and validators.

## Core workflow

1. Inspect the Creator web-mobile output, build settings, entry module, bundles, and launch scene before changing the loader.
2. Keep game code dependent on `PlayableFacade`; keep platform SDK names and redirects inside the channel adapter.
3. Build an archive with a stable root entry, embedded resources, and no runtime network dependency.
4. Select resource transport per channel capability. Use Data URI for image resources in restrictive or sandboxed previews when Blob URL load events are unreliable.
5. Let Cocos decode engine-specific formats such as `.cconb`. Replace the transport that supplies bytes, not the parser that understands them.
6. Validate the artifact statically, then run it in the target preview. A successful Brotli decode or engine initialization is not proof that the launch scene loaded.
7. Preserve stage logs and resource counters until the target channel has loaded and interacted with the scene.

## Debug in this order

Check these stages in sequence and stop at the first failed stage:

`archive decode → SystemJS/runtime → import map → module registration → engine preload → bundles → launch scene → DOM/image/media decode → CTA bridge`

Use these signals:

- archive byte length matches the declared uncompressed length;
- no unmapped fetch or XHR requests;
- `internal` and `main` bundles complete;
- `LoadScene` and scene activation complete;
- every image has a load or error result;
- the CTA bridge reports one successful native invocation.

If the game is `paused:false` but the scene is still null, inspect the pending scene/resource callback. A first-frame recovery may be scoped to a channel profile, but it must not hide a missing Bundle or decoder error.

## Adding a channel

Add a channel profile rather than branching game code. A profile should define:

- package format and entry-file rules;
- byte and file-count limits;
- allowed resource transport and compression fallback;
- CTA and lifecycle bridge implementation;
- external-network and redirect policy;
- static validators and a small delivery fixture.

Keep channel-specific facts in the matching reference file. Read [channel-profile.md](references/channel-profile.md) for the profile shape and [meta-playable.md](references/meta-playable.md) for Meta constraints.

## Verification

Run type checking and the focused Creator/channel self-tests after changes. Then export the exact release archive into the demo project and test that installed copy. Use [testing-checklist.md](references/testing-checklist.md) for the full matrix.

Do not treat a platform Preview warning as authoritative without checking the actual artifact size, file list, browser logs, scene activation, and CTA interaction.
