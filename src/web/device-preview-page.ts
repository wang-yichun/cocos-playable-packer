export function createDevicePreviewPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>模拟真机预览 · Cocos Playable Packer</title>
  <style>
    :root { font-family: Inter, "Segoe UI", sans-serif; color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #030712; color: #e5e7eb; }
    button { border: 0; border-radius: 8px; padding: 9px 13px; background: #2563eb; color: #fff; font: inherit; cursor: pointer; }
    button.secondary { background: #374151; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .device-preview-app { display: grid; grid-template-columns: 280px minmax(0, 1fr); width: 100%; height: 100dvh; min-height: 0; }
    .device-preview-sidebar { min-height: 0; overflow: auto; padding: 22px 18px; border-right: 1px solid #263244; background: #111827; }
    .device-preview-sidebar h1 { margin: 0 0 6px; font-size: 20px; }
    .device-preview-sidebar p { margin: 0; color: #94a3b8; font-size: 13px; line-height: 1.55; }
    .device-preview-sidebar h2 { margin: 22px 0 9px; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .device-preview-list { display: grid; gap: 8px; }
    .device-preview-option { width: 100%; text-align: left; background: #1f2937; border: 1px solid #374151; }
    .device-preview-option.active { border-color: #60a5fa; background: #1d4ed8; }
    .device-preview-orientation { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .device-preview-check { display: flex; align-items: center; gap: 9px; min-height: 38px; color: #cbd5e1; font-size: 14px; }
    .device-preview-main { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; background: #030712; }
    .device-preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 62px; padding: 10px 18px; border-bottom: 1px solid #263244; background: #0f172a; }
    .device-preview-meta { min-width: 0; color: #cbd5e1; font-size: 13px; overflow-wrap: anywhere; }
    .device-preview-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .device-preview-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; display: grid; place-items: center; padding: 24px; }
    .device-preview-viewport { position: relative; flex: none; }
    .device-shell { position: absolute; top: 0; left: 0; padding: 10px; border-radius: calc(var(--device-radius) + 10px); background: #070b12; box-shadow: 0 30px 90px rgba(0,0,0,.62); transform: scale(var(--device-scale)); transform-origin: top left; }
    .device-screen { position: relative; overflow: hidden; width: var(--device-width); height: var(--device-height); border-radius: var(--device-radius); background: #000; }
    .device-screen iframe { display: block; width: 100%; height: 100%; border: 0; background: #000; }
    .device-cutout { position: absolute; z-index: 3; top: 9px; left: 50%; transform: translateX(-50%); width: var(--cutout-width); height: var(--cutout-height); border-radius: 999px; background: #05070a; pointer-events: none; }
    .device-home-indicator { position: absolute; z-index: 3; left: 50%; bottom: 7px; transform: translateX(-50%); width: 34%; height: 5px; border-radius: 999px; background: rgba(255,255,255,.78); pointer-events: none; }
    .device-safe-area { position: absolute; z-index: 2; inset: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left); border: 1px dashed rgba(34,197,94,.95); pointer-events: none; }
    .device-preview-error { max-width: 620px; padding: 18px 20px; border: 1px solid #7f1d1d; border-radius: 12px; background: #450a0a; color: #fecaca; line-height: 1.6; }
    @media (max-width: 780px) {
      .device-preview-app { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
      .device-preview-sidebar { max-height: 250px; border-right: 0; border-bottom: 1px solid #263244; }
      .device-preview-list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="device-preview-app">
    <aside class="device-preview-sidebar">
      <h1>模拟真机预览</h1>
      <p>切换设备或方向时会重新启动游戏，确保 Cocos 按当前 iframe 视口初始化。</p>
      <h2>设备</h2>
      <div id="devicePreviewList" class="device-preview-list"></div>
      <h2>方向</h2>
      <div class="device-preview-orientation">
        <button type="button" data-device-orientation="portrait">竖屏</button>
        <button type="button" class="secondary" data-device-orientation="landscape">横屏</button>
      </div>
      <h2>显示</h2>
      <label class="device-preview-check"><input id="deviceSafeAreaToggle" type="checkbox" checked><span>显示安全区域</span></label>
    </aside>
    <main class="device-preview-main">
      <header class="device-preview-toolbar">
        <div id="devicePreviewMeta" class="device-preview-meta">正在准备预览……</div>
        <div class="device-preview-actions">
          <button id="devicePreviewReloadButton" class="secondary" type="button">刷新游戏</button>
          <button id="devicePreviewBackButton" class="secondary" type="button">返回门面</button>
        </div>
      </header>
      <section id="devicePreviewStage" class="device-preview-stage">
        <div id="devicePreviewViewport" class="device-preview-viewport">
          <div id="deviceShell" class="device-shell">
            <div class="device-screen">
              <iframe id="devicePreviewFrame" title="Playable 设备预览"></iframe>
              <div id="deviceCutout" class="device-cutout"></div>
              <div id="deviceSafeArea" class="device-safe-area"></div>
              <div id="deviceHomeIndicator" class="device-home-indicator"></div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
  <script>
    const devicePresets = [
      { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, radius: 18, safe: [20, 0, 0, 0], cutout: null, home: false },
      { id: 'iphone-15', name: 'iPhone 15', width: 393, height: 852, radius: 48, safe: [59, 0, 34, 0], cutout: [126, 37], home: true },
      { id: 'pixel-8', name: 'Pixel 8', width: 412, height: 915, radius: 34, safe: [32, 0, 24, 0], cutout: [18, 18], home: true },
      { id: 'galaxy-s24', name: 'Galaxy S24', width: 360, height: 780, radius: 32, safe: [28, 0, 20, 0], cutout: [14, 14], home: true },
      { id: 'ipad-mini', name: 'iPad mini', width: 744, height: 1133, radius: 28, safe: [24, 0, 20, 0], cutout: null, home: true },
      { id: 'ipad', name: 'iPad 10.9', width: 820, height: 1180, radius: 24, safe: [24, 0, 20, 0], cutout: null, home: true },
    ];

    const devicePreviewList = document.getElementById('devicePreviewList');
    const devicePreviewStage = document.getElementById('devicePreviewStage');
    const devicePreviewViewport = document.getElementById('devicePreviewViewport');
    const deviceShell = document.getElementById('deviceShell');
    const devicePreviewFrame = document.getElementById('devicePreviewFrame');
    const deviceCutout = document.getElementById('deviceCutout');
    const deviceSafeArea = document.getElementById('deviceSafeArea');
    const deviceSafeAreaToggle = document.getElementById('deviceSafeAreaToggle');
    const deviceHomeIndicator = document.getElementById('deviceHomeIndicator');
    const devicePreviewMeta = document.getElementById('devicePreviewMeta');
    const devicePreviewReloadButton = document.getElementById('devicePreviewReloadButton');
    const devicePreviewBackButton = document.getElementById('devicePreviewBackButton');

    const parameters = new URLSearchParams(window.location.search);
    const sourceParameter = parameters.get('source') || '';
    let playableUrl = null;
    try {
      const candidate = new URL(sourceParameter, window.location.origin);
      if (candidate.origin === window.location.origin && candidate.pathname.startsWith('/')) playableUrl = candidate;
    } catch {}

    let selectedDevice = devicePresets[1];
    let selectedOrientation = 'portrait';
    let reloadGeneration = 0;

    function renderDevicePresetButtons() {
      devicePreviewList.innerHTML = '';
      for (const preset of devicePresets) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'device-preview-option' + (preset.id === selectedDevice.id ? ' active' : '');
        button.textContent = preset.name;
        button.addEventListener('click', () => {
          if (selectedDevice.id === preset.id) return;
          selectedDevice = preset;
          renderDevicePresetButtons();
          applyDeviceLayout(true);
        });
        devicePreviewList.appendChild(button);
      }
    }

    function calculateDeviceGeometry() {
      const landscape = selectedOrientation === 'landscape';
      const width = landscape ? selectedDevice.height : selectedDevice.width;
      const height = landscape ? selectedDevice.width : selectedDevice.height;
      const safe = selectedDevice.safe;
      return {
        landscape: landscape,
        width: width,
        height: height,
        safeTop: landscape ? safe[3] : safe[0],
        safeRight: landscape ? safe[0] : safe[1],
        safeBottom: landscape ? safe[1] : safe[2],
        safeLeft: landscape ? safe[2] : safe[3],
      };
    }

    function updateScale(geometry) {
      const outerWidth = geometry.width + 20;
      const outerHeight = geometry.height + 20;
      const availableWidth = Math.max(120, devicePreviewStage.clientWidth - 48);
      const availableHeight = Math.max(120, devicePreviewStage.clientHeight - 48);
      const scale = Math.min(1, availableWidth / outerWidth, availableHeight / outerHeight);
      deviceShell.style.setProperty('--device-scale', String(scale));
      devicePreviewViewport.style.width = Math.max(1, outerWidth * scale) + 'px';
      devicePreviewViewport.style.height = Math.max(1, outerHeight * scale) + 'px';
      return scale;
    }

    function reloadPlayable() {
      if (!playableUrl) return;
      const generation = ++reloadGeneration;
      devicePreviewFrame.src = 'about:blank';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (generation !== reloadGeneration) return;
        devicePreviewFrame.src = playableUrl.href;
      }));
    }

    function applyDeviceLayout(reload) {
      const geometry = calculateDeviceGeometry();
      deviceShell.style.setProperty('--device-width', geometry.width + 'px');
      deviceShell.style.setProperty('--device-height', geometry.height + 'px');
      deviceShell.style.setProperty('--device-radius', selectedDevice.radius + 'px');
      deviceShell.style.setProperty('--safe-top', geometry.safeTop + 'px');
      deviceShell.style.setProperty('--safe-right', geometry.safeRight + 'px');
      deviceShell.style.setProperty('--safe-bottom', geometry.safeBottom + 'px');
      deviceShell.style.setProperty('--safe-left', geometry.safeLeft + 'px');
      const cutout = selectedDevice.cutout;
      deviceShell.style.setProperty('--cutout-width', (cutout ? cutout[0] : 0) + 'px');
      deviceShell.style.setProperty('--cutout-height', (cutout ? cutout[1] : 0) + 'px');
      deviceCutout.hidden = !cutout;
      deviceHomeIndicator.hidden = !selectedDevice.home;
      deviceSafeArea.hidden = !deviceSafeAreaToggle.checked;
      const scale = updateScale(geometry);
      devicePreviewMeta.textContent = selectedDevice.name + ' · ' + geometry.width + ' × ' + geometry.height + ' CSS px · ' + (geometry.landscape ? '横屏' : '竖屏') + ' · ' + Math.round(scale * 100) + '%';
      document.querySelectorAll('[data-device-orientation]').forEach((button) => {
        const active = button.dataset.deviceOrientation === selectedOrientation;
        button.classList.toggle('secondary', !active);
      });
      if (reload) reloadPlayable();
    }

    function showInvalidSource() {
      devicePreviewStage.innerHTML = '<div class="device-preview-error"><strong>无法打开模拟预览。</strong><br>预览来源缺失或不是当前门面服务中的地址。请返回打包页面，在构建成功后重新点击“模拟真机预览”。</div>';
      devicePreviewReloadButton.disabled = true;
      devicePreviewMeta.textContent = '没有有效的 Playable 预览地址';
    }

    document.querySelectorAll('[data-device-orientation]').forEach((button) => button.addEventListener('click', () => {
      const orientation = button.dataset.deviceOrientation || 'portrait';
      if (orientation === selectedOrientation) return;
      selectedOrientation = orientation;
      applyDeviceLayout(true);
    }));
    deviceSafeAreaToggle.addEventListener('change', () => applyDeviceLayout(false));
    devicePreviewReloadButton.addEventListener('click', reloadPlayable);
    devicePreviewBackButton.addEventListener('click', () => {
      if (window.history.length > 1) window.history.back();
      else window.close();
    });
    window.addEventListener('resize', () => applyDeviceLayout(false));

    if (!playableUrl) {
      showInvalidSource();
    } else {
      renderDevicePresetButtons();
      applyDeviceLayout(true);
    }
  </script>
</body>
</html>`;
}
