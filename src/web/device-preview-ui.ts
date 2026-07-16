function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`设备预览 UI 缺少插入点：${search.slice(0, 100)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function addDevicePreviewSimulator(html: string): string {
  html = replaceOnce(
    html,
    "    .version-legal { grid-column: 1 / -1; }\n  </style>",
    `    .version-legal { grid-column: 1 / -1; }
    #devicePreviewButton { background: #0f766e; }
    .device-preview-dialog { width: min(1180px, calc(100vw - 24px)); max-width: none; height: min(820px, calc(100vh - 24px)); padding: 0; overflow: hidden; }
    .device-preview-layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); height: 100%; }
    .device-preview-sidebar { overflow: auto; padding: 20px; border-right: 1px solid #374151; background: #111827; }
    .device-preview-sidebar h2 { margin-bottom: 4px; }
    .device-preview-sidebar h3 { margin: 20px 0 8px; font-size: 13px; color: #9ca3af; }
    .device-preview-list { display: grid; gap: 8px; }
    .device-preview-option { width: 100%; text-align: left; background: #1f2937; border: 1px solid #374151; }
    .device-preview-option.active { border-color: #60a5fa; background: #1d4ed8; }
    .device-preview-orientation { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .device-preview-stage { min-width: 0; display: flex; flex-direction: column; background: #030712; }
    .device-preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #374151; background: #111827; }
    .device-preview-meta { color: #9ca3af; font-size: 13px; }
    .device-preview-canvas { position: relative; flex: 1; min-height: 0; overflow: hidden; display: grid; place-items: center; padding: 24px; }
    .device-shell { position: relative; flex: none; padding: 10px; border-radius: calc(var(--device-radius) + 10px); background: #0b0f19; box-shadow: 0 24px 70px rgba(0,0,0,.55); transform: scale(var(--device-scale)); transform-origin: center; }
    .device-screen { position: relative; overflow: hidden; width: var(--device-width); height: var(--device-height); border-radius: var(--device-radius); background: #000; }
    .device-screen iframe { display: block; width: 100%; height: 100%; border: 0; background: #000; }
    .device-cutout { position: absolute; z-index: 3; top: 9px; left: 50%; transform: translateX(-50%); width: var(--cutout-width); height: var(--cutout-height); border-radius: 999px; background: #05070a; pointer-events: none; }
    .device-home-indicator { position: absolute; z-index: 3; left: 50%; bottom: 7px; transform: translateX(-50%); width: 34%; height: 5px; border-radius: 999px; background: rgba(255,255,255,.78); pointer-events: none; }
    .device-safe-area { position: absolute; z-index: 2; inset: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left); border: 1px dashed rgba(34,197,94,.9); pointer-events: none; }
    @media (max-width: 760px) { .device-preview-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); } .device-preview-sidebar { border-right: 0; border-bottom: 1px solid #374151; } .device-preview-list { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  </style>`,
  );

  html = replaceOnce(
    html,
    '<a id="previewLink" class="action" target="_blank" rel="noopener">在线试玩</a>',
    `<a id="previewLink" class="action" target="_blank" rel="noopener">在线试玩</a>
        <button id="devicePreviewButton" type="button">模拟真机预览</button>`,
  );

  html = replaceOnce(
    html,
    "  </dialog>",
    `  </dialog>
  <dialog id="devicePreviewDialog" class="device-preview-dialog">
    <div class="device-preview-layout">
      <aside class="device-preview-sidebar">
        <h2>模拟真机预览</h2>
        <div class="device-preview-meta">用于检查长宽比、横竖屏、圆角和安全区域遮挡。</div>
        <h3>设备</h3>
        <div id="devicePreviewList" class="device-preview-list"></div>
        <h3>方向</h3>
        <div class="device-preview-orientation">
          <button type="button" data-device-orientation="portrait">竖屏</button>
          <button type="button" class="secondary" data-device-orientation="landscape">横屏</button>
        </div>
        <h3>显示</h3>
        <label class="check-row"><input id="deviceSafeAreaToggle" type="checkbox" checked><span>显示安全区域</span></label>
      </aside>
      <section class="device-preview-stage">
        <div class="device-preview-toolbar">
          <div id="devicePreviewMeta" class="device-preview-meta"></div>
          <div class="row">
            <button id="devicePreviewReloadButton" class="secondary" type="button">刷新游戏</button>
            <button id="devicePreviewCloseButton" class="secondary" type="button">关闭</button>
          </div>
        </div>
        <div id="devicePreviewCanvas" class="device-preview-canvas">
          <div id="deviceShell" class="device-shell">
            <div id="deviceScreen" class="device-screen">
              <iframe id="devicePreviewFrame" title="Playable 设备预览"></iframe>
              <div id="deviceCutout" class="device-cutout"></div>
              <div id="deviceSafeArea" class="device-safe-area"></div>
              <div id="deviceHomeIndicator" class="device-home-indicator"></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </dialog>`,
  );

  html = replaceOnce(
    html,
    "    const startPreviewButton = document.getElementById('startPreviewButton');",
    `    const startPreviewButton = document.getElementById('startPreviewButton');
    const devicePreviewButton = document.getElementById('devicePreviewButton');
    const devicePreviewDialog = document.getElementById('devicePreviewDialog');
    const devicePreviewList = document.getElementById('devicePreviewList');
    const devicePreviewCanvas = document.getElementById('devicePreviewCanvas');
    const deviceShell = document.getElementById('deviceShell');
    const deviceScreen = document.getElementById('deviceScreen');
    const devicePreviewFrame = document.getElementById('devicePreviewFrame');
    const deviceCutout = document.getElementById('deviceCutout');
    const deviceSafeArea = document.getElementById('deviceSafeArea');
    const deviceSafeAreaToggle = document.getElementById('deviceSafeAreaToggle');
    const deviceHomeIndicator = document.getElementById('deviceHomeIndicator');
    const devicePreviewMeta = document.getElementById('devicePreviewMeta');
    const devicePreviewReloadButton = document.getElementById('devicePreviewReloadButton');
    const devicePreviewCloseButton = document.getElementById('devicePreviewCloseButton');`,
  );

  html = replaceOnce(
    html,
    "    selectAllChannelsButton.addEventListener('click', () => {",
    `    const devicePresets = [
      { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, radius: 18, safe: [20, 0, 0, 0], cutout: null, home: false },
      { id: 'iphone-15', name: 'iPhone 15', width: 393, height: 852, radius: 48, safe: [59, 0, 34, 0], cutout: [126, 37], home: true },
      { id: 'pixel-8', name: 'Pixel 8', width: 412, height: 915, radius: 34, safe: [32, 0, 24, 0], cutout: [18, 18], home: true },
      { id: 'galaxy-s24', name: 'Galaxy S24', width: 360, height: 780, radius: 32, safe: [28, 0, 20, 0], cutout: [14, 14], home: true },
      { id: 'ipad-mini', name: 'iPad mini', width: 744, height: 1133, radius: 28, safe: [24, 0, 20, 0], cutout: null, home: true },
      { id: 'ipad', name: 'iPad 10.9', width: 820, height: 1180, radius: 24, safe: [24, 0, 20, 0], cutout: null, home: true },
    ];
    let selectedDevice = devicePresets[1];
    let selectedOrientation = 'portrait';
    let selectedDeviceChannel = 'Preview';

    function renderDevicePresetButtons() {
      devicePreviewList.innerHTML = '';
      for (const preset of devicePresets) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'device-preview-option' + (preset.id === selectedDevice.id ? ' active' : '');
        button.textContent = preset.name;
        button.addEventListener('click', () => { selectedDevice = preset; renderDevicePresetButtons(); updateDevicePreview(); });
        devicePreviewList.appendChild(button);
      }
    }

    function buildDevicePreviewUrl() {
      if (!completedPreviewUrl) return 'about:blank';
      const separator = completedPreviewUrl.includes('?') ? '&' : '?';
      return completedPreviewUrl + separator + 'channel=' + encodeURIComponent(selectedDeviceChannel);
    }

    function updateDevicePreview() {
      const landscape = selectedOrientation === 'landscape';
      const width = landscape ? selectedDevice.height : selectedDevice.width;
      const height = landscape ? selectedDevice.width : selectedDevice.height;
      const safe = selectedDevice.safe;
      const safeTop = landscape ? safe[3] : safe[0];
      const safeRight = landscape ? safe[0] : safe[1];
      const safeBottom = landscape ? safe[1] : safe[2];
      const safeLeft = landscape ? safe[2] : safe[3];
      deviceShell.style.setProperty('--device-width', width + 'px');
      deviceShell.style.setProperty('--device-height', height + 'px');
      deviceShell.style.setProperty('--device-radius', selectedDevice.radius + 'px');
      deviceShell.style.setProperty('--safe-top', safeTop + 'px');
      deviceShell.style.setProperty('--safe-right', safeRight + 'px');
      deviceShell.style.setProperty('--safe-bottom', safeBottom + 'px');
      deviceShell.style.setProperty('--safe-left', safeLeft + 'px');
      const cutout = selectedDevice.cutout;
      deviceShell.style.setProperty('--cutout-width', (cutout ? cutout[0] : 0) + 'px');
      deviceShell.style.setProperty('--cutout-height', (cutout ? cutout[1] : 0) + 'px');
      deviceCutout.hidden = !cutout;
      deviceHomeIndicator.hidden = !selectedDevice.home;
      deviceSafeArea.hidden = !deviceSafeAreaToggle.checked;
      const availableWidth = Math.max(100, devicePreviewCanvas.clientWidth - 48);
      const availableHeight = Math.max(100, devicePreviewCanvas.clientHeight - 48);
      const scale = Math.min(1, availableWidth / (width + 20), availableHeight / (height + 20));
      deviceShell.style.setProperty('--device-scale', String(scale));
      devicePreviewMeta.textContent = selectedDevice.name + ' · ' + width + ' × ' + height + ' CSS px · ' + (landscape ? '横屏' : '竖屏') + ' · ' + Math.round(scale * 100) + '%';
      document.querySelectorAll('[data-device-orientation]').forEach((button) => {
        const active = button.dataset.deviceOrientation === selectedOrientation;
        button.classList.toggle('secondary', !active);
      });
    }

    function openDevicePreview() {
      if (!completedPreviewUrl || completedPlatforms.length === 0) return;
      selectedDeviceChannel = completedPlatforms.includes('Preview') ? 'Preview' : completedPlatforms[0];
      renderDevicePresetButtons();
      devicePreviewFrame.src = buildDevicePreviewUrl();
      devicePreviewDialog.showModal();
      requestAnimationFrame(updateDevicePreview);
    }

    devicePreviewButton.addEventListener('click', openDevicePreview);
    devicePreviewCloseButton.addEventListener('click', () => devicePreviewDialog.close());
    devicePreviewReloadButton.addEventListener('click', () => { devicePreviewFrame.src = buildDevicePreviewUrl(); });
    deviceSafeAreaToggle.addEventListener('change', updateDevicePreview);
    document.querySelectorAll('[data-device-orientation]').forEach((button) => button.addEventListener('click', () => {
      selectedOrientation = button.dataset.deviceOrientation;
      updateDevicePreview();
    }));
    window.addEventListener('resize', () => { if (devicePreviewDialog.open) updateDevicePreview(); });

    selectAllChannelsButton.addEventListener('click', () => {`,
  );

  return html;
}
