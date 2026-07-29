# Testing checklist

## Static checks

- root entry exists and has the required name;
- archive entries use safe names and stay within the file-count limit;
- artifact byte size is below the channel limit;
- no external `http(s)` resource URLs remain;
- no JavaScript redirect patterns remain;
- required CTA bridge call is present;
- Brotli archive length and checksum match the build report.

## Runtime checks

- test the exact release archive installed into the CocosDemo project;
- capture archive, runtime, SystemJS, Bundle, and scene stage logs;
- confirm `fetchUnmapped === 0` and `xhrUnmapped === 0`;
- confirm `internal` and `main` Bundle loads complete;
- confirm the launch scene becomes non-null and activates;
- confirm all image/media callbacks complete without decode errors;
- click CTA and verify the channel bridge reports success;
- exercise game-ready, game-start, game-end, and one event call in the demo.

## Regression principle

Test a normal browser preview and the target platform preview. A local `game.html` can succeed while the platform iframe fails because CSP, permissions policy, Blob loading, frame scheduling, or file-size validation differs.
