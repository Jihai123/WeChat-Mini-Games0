import {
  _decorator, Component, Node, Label, ProgressBar, Button,
  tween, Vec3, Color, color,
} from 'cc';
import { EventBus, GameEvents } from '../utils/EventBus';
import { GameManager } from '../core/GameManager';
import { DEFAULT_GAME_CONFIG } from '../data/GameConfig';

const { ccclass, property } = _decorator;

/**
 * GameSceneUI — reactive HUD layer.
 *
 * Subscribes to EventBus events rather than polling managers each frame.
 * All animation (score pop, combo flash, near-miss banner) is driven by
 * cc.tween so it doesn't block the update loop.
 *
 * Node path assumptions (ARCHITECTURE.md GameScene UI_Root):
 *   ScoreDisplay/ScoreLabel     → scoreLabel
 *   ComboDisplay/ComboLabel     → comboLabel
 *   ComboDisplay/ComboMultiplierLabel → multiplierLabel
 *   TimerBar                    → timerBar (ProgressBar)
 *   BtnPause                    → btnPause
 */
@ccclass('GameSceneUI')
export class GameSceneUI extends Component {
  @property(Label)
  scoreLabel: Label | null = null;

  @property(Label)
  comboLabel: Label | null = null;

  @property(Label)
  multiplierLabel: Label | null = null;

  @property(ProgressBar)
  timerBar: ProgressBar | null = null;

  @property(Button)
  btnPause: Button | null = null;

  /** Overlay node shown for near-miss feedback (assign in inspector). */
  @property(Node)
  nearMissOverlay: Node | null = null;

  /** Overlay node shown when a new high score is beaten mid-game. */
  @property(Node)
  newHighScoreOverlay: Node | null = null;

  private _totalTime: number = DEFAULT_GAME_CONFIG.sessionDurationSeconds;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    EventBus.on(GameEvents.SCORE_UPDATED,    this._onScoreUpdated,    this);
    EventBus.on(GameEvents.COMBO_UPDATED,    this._onComboUpdated,    this);
    EventBus.on(GameEvents.COMBO_RESET,      this._onComboReset,      this);
    EventBus.on(GameEvents.TIMER_TICK,       this._onTimerTick,       this);
    EventBus.on(GameEvents.NEAR_MISS,        this._onNearMiss,        this);
    EventBus.on(GameEvents.HIGH_SCORE_BEATEN, this._onHighScoreBeaten, this);
    EventBus.on(GameEvents.FAIL_SOFT_ACTIVE, this._onFailSoft,        this);

    this.btnPause?.node.on(Button.EventType.CLICK, this._onPauseClicked, this);

    // Initialise display
    if (this.scoreLabel)      this.scoreLabel.string      = '0';
    if (this.comboLabel)      this.comboLabel.string      = '';
    if (this.multiplierLabel) this.multiplierLabel.string = '';
    if (this.timerBar)        this.timerBar.progress      = 1;

    if (this.nearMissOverlay)    this.nearMissOverlay.active    = false;
    if (this.newHighScoreOverlay) this.newHighScoreOverlay.active = false;
  }

  onDestroy(): void {
    EventBus.off(GameEvents.SCORE_UPDATED,    this._onScoreUpdated,    this);
    EventBus.off(GameEvents.COMBO_UPDATED,    this._onComboUpdated,    this);
    EventBus.off(GameEvents.COMBO_RESET,      this._onComboReset,      this);
    EventBus.off(GameEvents.TIMER_TICK,       this._onTimerTick,       this);
    EventBus.off(GameEvents.NEAR_MISS,        this._onNearMiss,        this);
    EventBus.off(GameEvents.HIGH_SCORE_BEATEN, this._onHighScoreBeaten, this);
    EventBus.off(GameEvents.FAIL_SOFT_ACTIVE, this._onFailSoft,        this);
    this.btnPause?.node.off(Button.EventType.CLICK, this._onPauseClicked, this);
  }

  // ------------------------------------------------------------------
  // Event handlers
  // ------------------------------------------------------------------

  private _onScoreUpdated(payload: { score: number; delta: number }): void {
    if (this.scoreLabel) {
      this.scoreLabel.string = payload.score.toString();
    }
    // Punch-scale animation on positive delta
    if (payload.delta > 0 && this.scoreLabel) {
      tween(this.scoreLabel.node)
        .to(0.06, { scale: new Vec3(1.3, 1.3, 1) })
        .to(0.10, { scale: new Vec3(1.0, 1.0, 1) })
        .start();
    }
  }

  private _onComboUpdated(payload: { combo: number; multiplier: number; label: string }): void {
    if (this.comboLabel) {
      this.comboLabel.string = payload.combo >= 3
        ? (payload.label || `×${payload.combo}`)
        : '';
    }
    if (this.multiplierLabel) {
      this.multiplierLabel.string = payload.multiplier > 1
        ? `×${payload.multiplier.toFixed(1)}`
        : '';
    }
    // Flash the combo label when a new tier is reached
    if (payload.combo > 1 && this.comboLabel) {
      tween(this.comboLabel.node)
        .to(0.08, { scale: new Vec3(1.4, 1.4, 1) })
        .to(0.12, { scale: new Vec3(1.0, 1.0, 1) })
        .start();
    }
  }

  private _onComboReset(_payload: unknown): void {
    if (this.comboLabel)      this.comboLabel.string      = '';
    if (this.multiplierLabel) this.multiplierLabel.string = '';
  }

  private _onTimerTick(payload: { remaining: number; total: number }): void {
    if (this.timerBar) {
      this.timerBar.progress = payload.remaining / payload.total;
    }
    // Turn timer bar red when < 10 s remain
    if (payload.remaining <= 10 && this.timerBar) {
      // Pulsing scale to draw attention
      tween(this.timerBar.node)
        .to(0.25, { scale: new Vec3(1.05, 1.05, 1) })
        .to(0.25, { scale: new Vec3(1.00, 1.00, 1) })
        .start();
    }
  }

  private _onNearMiss(_payload: unknown): void {
    // Near-miss banner: shown briefly at the END of the game in ResultScene,
    // but we can also hint it here if SESSION_END fires before scene swap
    // (the ResultSceneUI handles the full banner; here we do a brief flash)
    if (this.nearMissOverlay) {
      this.nearMissOverlay.active = true;
      this.scheduleOnce(() => {
        if (this.nearMissOverlay) this.nearMissOverlay.active = false;
      }, 2.0);
    }
  }

  private _onHighScoreBeaten(_payload: unknown): void {
    if (this.newHighScoreOverlay) {
      this.newHighScoreOverlay.active = true;
      // Fade out after 2 s, then hide
      tween(this.newHighScoreOverlay)
        .delay(2.0)
        .call(() => { if (this.newHighScoreOverlay) this.newHighScoreOverlay.active = false; })
        .start();
    }
  }

  private _onFailSoft(payload: { active: boolean }): void {
    // Subtle visual cue (optional: tint the background, etc.)
    // Keep it non-intrusive — the player should feel helped, not patronised
    console.log('[GameSceneUI] Fail-soft active:', payload.active);
  }

  // ------------------------------------------------------------------
  // Pause button
  // ------------------------------------------------------------------

  private _onPauseClicked(): void {
    GameManager.instance?.pause();
  }
}
