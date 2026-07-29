# Meta/Facebook playable reference

Meta playable uploads commonly require:

- a ZIP whose `index.html` is at the archive root, or one self-contained HTML file;
- the HTML/ZIP artifact under 5 MB;
- no external network resource loading;
- no JavaScript redirects and no `mraid.js` dependency;
- `FbPlayableAd.onCTAClick()` when a user action opens the app store;
- a bounded archive file count (Meta documentation and UI commonly enforce 100 files);
- simple Latin file names when the uploader reports archive-name failures.

The ad objective must be an app promotion objective with an app selected. Preview pages can show a stale or inaccurate size warning; verify the local artifact byte size and the other validation rows, then confirm actual preview rendering and CTA activation.

Use the Meta bridge only for the CTA action. Do not call `window.open`, store URLs, or platform SDK names from game components.
