# Cocos runtime notes

## Embedded resource contract

The browser-facing runtime should provide one virtual resource lookup used by fetch, XHR, script loading, image loading, and CSS URL rewriting. Normalize slashes, remove query/hash when looking up archive entries, and report unmapped requests instead of silently falling back to the network.

Use the browser's native Cocos downloader for format-specific decoding. In particular, `.cconb` is not a generic ArrayBuffer asset: Cocos must receive its bytes through the normal downloader/parser path.

## Browser compatibility

- Brotli support varies. Attempt native `DecompressionStream('brotli')`, catch unsupported-format errors, and use the embedded JavaScript decoder.
- Blob URLs can be valid yet fail to produce image load callbacks inside an ad-preview iframe. A Data URI image handler is a reliable fallback for small embedded images.
- Meta's iframe may deny Gamepad APIs. Wrap `navigator.getGamepads()` and return an empty list when the permission policy throws.
- Avoid `eval`, dynamic external script loading, JS redirects, and runtime fetches to origins outside the archive.

## Startup interpretation

`archive:ready`, `entry:import`, and Cocos `Init Project` only prove that progressively earlier phases completed. The definitive startup signals are `LoadScene`, scene activation, a non-null `director.getScene()`, and an interactive frame.

When a scene is stuck, inspect Bundle completion, scene config lookup, pending XHR/image callbacks, and decoder errors before adding a recovery path. Keep any first-frame workaround guarded by a channel capability rather than making it universal by default.
