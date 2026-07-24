function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`设备预览入口缺少插入点：${search.slice(0, 100)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function addDevicePreviewSimulator(html: string): string {
  html = replaceOnce(
    html,
    '<a id="previewLink" class="action" target="_blank" rel="noopener">在线试玩</a>',
    `<a id="previewLink" class="action" target="_blank" rel="noopener">在线试玩</a>
        <button id="devicePreviewButton" type="button">模拟真机预览</button>`,
  );

  html = replaceOnce(
    html,
    "    const startPreviewButton = document.getElementById('startPreviewButton');",
    `    const startPreviewButton = document.getElementById('startPreviewButton');
    const devicePreviewButton = document.getElementById('devicePreviewButton');`,
  );

  html = replaceOnce(
    html,
    "    selectAllChannelsButton.addEventListener('click', () => {",
    `    function openDevicePreviewPage() {
      if (!completedPreviewUrl || completedPlatforms.length === 0) return;
      const channel = completedPlatforms.includes('Preview') ? 'Preview' : completedPlatforms[0];
      const playableUrl = new URL(completedPreviewUrl, window.location.href);
      playableUrl.searchParams.set('channel', channel);
      const devicePreviewUrl = new URL('/device-preview', window.location.href);
      devicePreviewUrl.searchParams.set('source', playableUrl.pathname + playableUrl.search + playableUrl.hash);
      window.open(devicePreviewUrl.href, '_blank', 'noopener');
    }

    devicePreviewButton.addEventListener('click', openDevicePreviewPage);

    selectAllChannelsButton.addEventListener('click', () => {`,
  );

  return html;
}
