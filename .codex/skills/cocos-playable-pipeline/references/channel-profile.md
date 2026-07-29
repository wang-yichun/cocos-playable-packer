# Channel profile design

Represent each delivery target as data plus adapters rather than scattered conditionals.

Recommended fields:

```ts
type ChannelProfile = {
  id: string;
  packageFormat: 'single-html' | 'zip-multi-file';
  entryFile: string;
  maxBytes: number;
  maxFiles?: number;
  allowExternalNetwork: boolean;
  allowJavaScriptRedirect: boolean;
  resourceTransport: 'inline' | 'data-uri' | 'blob' | 'vfs';
  compressionFallback: 'brotli-js' | 'none';
  bridge: ChannelBridge;
};
```

The bridge owns CTA and lifecycle calls. The validator owns file names, archive layout, size, redirects, external URLs, required bridge calls, and file count. A delivery self-test should inspect both the archive entries and the generated entry source.

Keep compatibility workarounds explicit, for example `requiresDataUriImages` or `requiresFirstFrameRecovery`, so a future platform can opt in without inheriting Meta-specific behavior accidentally.
