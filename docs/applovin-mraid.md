# AppLovin / MRAID 生命周期适配

本阶段在现有渠道下载桥基础上增加 MRAID 生命周期控制，优先用于 AppLovin，同时由 IronSource、Liftoff 和 Unity Profile 复用。

## 已实现

当目标渠道使用 MRAID 时，输出 HTML 会：

1. 在 Cocos 运行时启动前设置延迟启动标记；
2. 等待 `mraid` 就绪；
3. 监听 `ready`、`viewableChange`、`sizeChange` 和 `audioVolumeChange`；
4. 第一次收到 `viewableChange(true)` 后调用一次 `window.__runGame()`；
5. 下载按钮优先调用 `mraid.open(storeUrl)`；
6. 在没有真实 MRAID 宿主时回退到配置的商店地址；
7. 将尺寸和音量状态写入全局变量，并在 Cocos 全局接口存在时转发事件。

运行时启动采用幂等保护。即使渠道重复发送 `ready` 或 `viewableChange(true)`，Cocos 入口也只会执行一次。

## 状态和事件

页面会维护：

```text
window.__PLAYABLE_VIEWABLE__
window.__PLAYABLE_SCREEN_SIZE__
window.__PLAYABLE_AUDIO_VOLUME__
window.volumeAudio
window.volumeSwitch
```

并派发：

```text
playable-runtime-ready
playable-game-started
playable-viewable-change
playable-size-change
playable-audio-volume-change
```

当 `window.cc.view.emit` 可用时，同时转发：

```text
canvas-resize
 audioVolumeChange
```

## 本地 MRAID 模拟器

选择 AppLovin、IronSource、Liftoff 或 Unity 后，通过 Web 页面点击“在线试玩”，右上角会出现 MRAID 模拟面板。

模拟器初始状态：

```text
state = loading
viewable = false
volume = 100
```

因此游戏不会立即启动。

推荐测试步骤：

1. 点击“仅 Ready”：游戏仍不应启动；
2. 点击“设为可见”：游戏开始启动；
3. 再次点击“设为可见”：游戏不能重复启动；
4. 点击“静音”和“音量 100”：检查游戏音频逻辑和控制台；
5. 点击“设为不可见”再恢复可见：游戏不应重新初始化；
6. 进入游戏下载按钮：应打开配置的商店地址。

也可以点击“Ready + 可见”直接完成快速启动。

控制台可直接调用：

```js
window.__MRAID_SIMULATOR__.ready();
window.__MRAID_SIMULATOR__.setViewable(true);
window.__MRAID_SIMULATOR__.setViewable(false);
window.__MRAID_SIMULATOR__.setVolume(0);
window.__MRAID_SIMULATOR__.setVolume(100);
window.__MRAID_SIMULATOR__.setSize(720, 1080);
window.__MRAID_SIMULATOR__.snapshot();
```

模拟器只在 `/preview/` 在线试玩路由且页面中不存在真实 `window.mraid` 时启用。下载得到的正式 HTML 不会主动创建该模拟面板。

## 真实 AppLovin 环境

在真实 AppLovin 宿主中：

- 使用宿主提供的 `window.mraid`；
- 不覆盖真实 MRAID 对象；
- `mraid.getState() === "loading"` 时等待 `ready`；
- 广告变为可见后启动游戏；
- 下载使用 `mraid.open()`。

本地模拟通过不等同于 AppLovin 官方 Validator 通过。正式投放前仍需验证：

- 宿主是否按预期提供 MRAID；
- 首次可见时游戏能否启动；
- 隐藏和恢复时是否存在音频或逻辑异常；
- 横竖屏及尺寸变化；
- 商店跳转；
- 包体和外部请求规则。

## 测试命令

```powershell
npm run typecheck
npm run test:web-mvp
npm run web:mvp
```

预期包含：

```text
MRAID channel adapter self-test passed.
```

## 当前边界

本阶段尚未实现：

- AppLovin 专用 Analytics 事件映射；
- 渠道官方 Validator 自动化；
- Liftoff ZIP 包装；
- Unity `mraid.js` 占位规则的最终确认；
- Google / Facebook 的 `index.html + res.js` 输出。
