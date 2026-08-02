import { _decorator, Component, Event, Label } from "cc";

import { PlayableFacade } from "./PlayableFacade";

const { ccclass, property } = _decorator;

/**
 * CocosDemo 的按钮事件控制器。
 * 将本组件挂到 Canvas 或演示面板根节点，然后在 Button 的 Click Events
 * 中选择下面的公开方法。statusLabel 为可选项，用于展示本地预览结果。
 */
@ccclass("PlayableDemoController")
export class PlayableDemoController extends Component {

  @property({ type: Label, tooltip: "可选：显示按钮调用结果。" })
  public statusLabel: Label | null = null;

  @property({ type: Label, tooltip: "可选：显示渠道。" })
  public channelLabel: Label | null = null;

  @property({ type: Label, tooltip: "可选：显示渠道。" })
  public orientationLabel: Label | null = null;

  @property({ type: Label, tooltip: "可选：显示宿主可见性。" })
  public viewableLabel: Label | null = null;

  @property({ type: Label, tooltip: "可选：显示宿主尺寸。" })
  public screenSizeLabel: Label | null = null;

  @property({ type: Label, tooltip: "可选：显示宿主音量。" })
  public volumeLabel: Label | null = null;

  private readonly unsubscribers: Array<() => void> = [];

  protected onLoad(): void {
    console.info(`[PlayableDemoController] onLoad`);
    if (this.channelLabel !== null) {
      this.channelLabel.string = `Channel: ${PlayableFacade.getChannel()}`;
    }
    if (this.orientationLabel !== null) {
      this.orientationLabel.string = `Orientation: ${PlayableFacade.getOrientation()}`;
    }
    this.renderPlayableState();
    this.unsubscribers.push(
      PlayableFacade.onViewableChange(() => this.renderPlayableState()),
      PlayableFacade.onScreenSizeChange(() => this.renderPlayableState()),
      PlayableFacade.onAudioVolumeChange(() => this.renderPlayableState()),
    );
  }

  protected onDestroy(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }

  /** 绑定到任意“CTA / Install / Download”按钮。 */
  public onCtaClick(): void {
    const invoked = PlayableFacade.cta();
    this.showResult("CTA", invoked);
  }

  /** 绑定到“开始游戏”按钮，或在实际游戏第一帧交互时调用。 */
  public onGameStartClick(): void {
    const invoked = PlayableFacade.gameStart();
    this.showResult("Game Start", invoked);
  }

  /** 绑定到“结束游戏”按钮，或在结算页出现时调用。 */
  public onGameEndClick(): void {
    const invoked = PlayableFacade.gameEnd();
    this.showResult("Game End", invoked);
  }

  /** 绑定到“游戏已准备好”按钮；正式游戏通常在加载完成时自动调用。 */
  public onGameReadyClick(): void {
    const invoked = PlayableFacade.gameReady();
    this.showResult("Game Ready", invoked);
  }

  /**
   * 绑定到事件演示按钮。
   * 在 Button 的 Click Events 的 CustomEventData 中填写事件名，例如
   * "tutorial_complete" 或 "level_complete"。
   */
  public onTrackClick(_event: Event, eventName: string): void {
    const normalizedEventName = eventName.trim() || "demo_event";
    const invoked = PlayableFacade.track(normalizedEventName);
    this.showResult(`Track: ${normalizedEventName}`, invoked);
  }

  private showResult(action: string, invoked: boolean): void {
    const message = invoked
      ? `${action}: channel bridge invoked`
      : `${action}: local preview (no channel bridge)`;
    if (this.statusLabel !== null) {
      this.statusLabel.string = message;
    }
    console.info(`[CocosDemo] ${message}`);
  }

  private renderPlayableState(): void {
    const size = PlayableFacade.getScreenSize();
    if (this.viewableLabel !== null) {
      this.viewableLabel.string = `Viewable: ${PlayableFacade.isViewable()}`;
    }
    if (this.screenSizeLabel !== null) {
      this.screenSizeLabel.string = size === null
        ? "Size: unknown"
        : `Size: ${size.width} × ${size.height}`;
    }
    if (this.volumeLabel !== null) {
      this.volumeLabel.string = `Volume: ${PlayableFacade.getAudioVolume()}%`;
    }
  }
}
