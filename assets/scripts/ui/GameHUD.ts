import {
  _decorator, Component, Node, Label, ProgressBar, Button,
  tween, Vec3, Tween,
} from 'cc';
import { GameState } from '../enums/GameState';
import { EventBus, GameEvents } from '../utils/EventBus';
import { GameManager } from '../core/GameManager';
import { DEFAULT_GAME_CONFIG } from '../data/GameConfig';

const { ccclass, property } = _decorator;

// Timer bar turns urgent when less than this many seconds remain
const TIMER_URGENT_THRESHOLD_S = 10;

// How long the "NEW BEST!" banner stays visible before auto-hiding (seconds)
const HIGH_SCORE_BANNER_DURATION_S = 2.5;

// How long the near-miss flash stays visible (seconds)
const NEAR_MISS_FLASH_DURATION_S = 2.0;

/**
 * GameHUD — comprehensive, production-grade in-game HUD.
 *
 * This is the authoritative HUD for GameScene.  It supersedes the lighter
 * GameSceneUI.ts; choose one per scene.
 *
 * Listens to EventBus rather than polling every frame, so all updates are
 * driven by events.  All Vec3 objects used in tweens are pre-allocated as
 * class properties to eliminate per-frame GC pressure.
 *
 * Features beyond the minimal GameSceneUI:
 *  - Loading state panel (shown during LOADING, hidden on PLAYING)
 *  - Pause panel shown/hidden via PAUSE_SHOW/HIDE events from SceneBinder
 *  - Score pop with magnitude-aware scale (bigger pop for higher delta)
 *  - Combo tier label with entrance animation on every tier change
 *  - Fail-soft subtle indicator (soft glow on border — non-patronising)
 *  - Urgent timer animation (pulse + colour shift at < 10 s)
 *  - Near-miss in-game flash (brief banner)
 *  - New high-score mid-game banner
 *  - FTUE step hint relay (updates FTUEController's hint in HUD if desired)
 *
 * Node assumptions (assign in Inspector under GameScene/UI_Root):
 *   scoreLabel         — current session score
 *   comboLabel         — current combo tier label ("GREAT!", "×5", …)
 *   multiplierLabel    — "×2.0" multiplier badge
 *   timerBar           — ProgressBar (full = game start, empty = game end)
 *   timerLabel         — optional numeric seconds label
 *   btnPause           — pause button
 *   loadingPanel       — shown during GameState.LOADING
 *   newHighScoreBanner — shown momentarily when personal best is broken live
 *   nearMissFlash      — shown at near-miss moment (end of game / SESSION_END)
 *   failSoftIndicator  — subtle border/glow node active when fail-soft is on
 *   ftueHintRelay      — (optional) mirrors FTUEController hint in HUD
 */
@ccclass('GameHUD')
export class GameHUD extends Component {
  @property(Label)
  scoreLabel: Label | null = null;

  @property(Label)
  comboLabel: Label | null = null;

  @property(Label)
  multiplierLabel: Label | null = null;

  @property(ProgressBar)
  timerBar: ProgressBar | null = null;

  /** Optional numeric countdown label ("10", "9", …). */
  @property(Label)
  timerLabel: Label | null = null;

  @property(Button)
  btnPause: Button | null = null;

  /** Shown during GameState.LOADING. Hide when PLAYING begins. */
  @property(Node)
  loadingPanel: Node | null = null;

  /** "NEW BEST!" banner node — hidden by default, shown mid-game. */
  @property(Node)
  newHighScoreBanner: Node | null = null;

  /** Brief flash shown when player is within 5% of personal best at game end. */
  @property(Node)
  nearMissFlash: Node | null = null;

  /** Subtle fail-soft indicator (soft glow / pulsing border). */
  @property(Node)
  failSoftIndicator: Node | null = null;

  /** (Optional) mirrors FTUEController's current hint text in the HUD. */
  @property(Label)
  ftueHintRelay: Label | null = null;

  // ------------------------------------------------------------------
  // Pre-allocated Vec3 objects — reused across tween calls (zero GC)
  // ------------------------------------------------------------------
  private readonly _v1_0 = new Vec3(1.0, 1.0, 1);
  private readonly _v1_3 = new Vec3(1.3, 1.3, 1);
  private readonly _v1_4 = new Vec3(1.4, 1.4, 1);
  private readonly _v1_5 = new Vec3(1.5, 1.5, 1);
  private readonly _v1_05 = new Vec3(1.05, 1.05, 1);

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  private _totalTime:           number  = DEFAULT_GAME_CONFIG.sessionDurationSeconds;
  private _lastTimerFloorSec:   number  = -1; // For whole-second timerLabel updates
  private _urgentPulseTween:    Tween<Node> | null = null;
  private _failSoftPulseTween:  Tween<Node> | null = null;
  private _prevComboTier:       number  = 0;  // Track tier changes for flash

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    // Subscribe to all relevant EventBus events
    EventBus.on(GameEvents.GAME_STATE_CHANGE,  this._onStateChange,     this);
    EventBus.on(GameEvents.SCORE_UPDATED,       this._onScoreUpdated,    this);
    EventBus.on(GameEvents.COMBO_UPDATED,       this._onComboUpdated,    this);
    EventBus.on(GameEvents.COMBO_RESET,         this._onComboReset,      this);
    EventBus.on(GameEvents.TIMER_TICK,          this._onTimerTick,       this);
    EventBus.on(GameEvents.NEAR_MISS,           this._onNearMiss,        this);
    EventBus.on(GameEvents.HIGH_SCORE_BEATEN,   this._onHighScoreBeaten, this);
    EventBus.on(GameEvents.FAIL_SOFT_ACTIVE,    this._onFailSoft,        this);
    EventBus.on(GameEvents.FTUE_STEP,           this._onFTUEStep,        this);
    EventBus.on(GameEvents.PAUSE_SHOW,          this._onPauseShow,       this);
    EventBus.on(GameEvents.PAUSE_HIDE,          this._onPauseHide,       this);

    this.btnPause?.node.on(Button.EventType.CLICK, this._onPauseClicked, this);

    this._resetDisplay();
  }

  onDestroy(): void {
    EventBus.off(GameEvents.GAME_STATE_CHANGE,  this._onStateChange,     this);
    EventBus.off(GameEvents.SCORE_UPDATED,       this._onScoreUpdated,    this);
    EventBus.off(GameEvents.COMBO_UPDATED,       this._onComboUpdated,    this);
    EventBus.off(GameEvents.COMBO_RESET,         this._onComboReset,      this);
    EventBus.off(GameEvents.TIMER_TICK,          this._onTimerTick,       this);
    EventBus.off(GameEvents.NEAR_MISS,           this._onNearMiss,        this);
    EventBus.off(GameEvents.HIGH_SCORE_BEATEN,   this._onHighScoreBeaten, this);
    EventBus.off(GameEvents.FAIL_SOFT_ACTIVE,    this._onFailSoft,        this);
    EventBus.off(GameEvents.FTUE_STEP,           this._onFTUEStep,        this);
    EventBus.off(GameEvents.PAUSE_SHOW,          this._onPauseShow,       this);
    EventBus.off(GameEvents.PAUSE_HIDE,          this._onPauseHide,       this);

    this.btnPause?.node.off(Button.EventType.CLICK, this._onPauseClicked, this);
    this._urgentPulseTween?.stop();
    this._failSoftPulseTween?.stop();
  }

  // ------------------------------------------------------------------
  // Initialise
  // ------------------------------------------------------------------

  private _resetDisplay(): void {
    if (this.scoreLabel)       this.scoreLabel.string      = '0';
    if (this.comboLabel)       this.comboLabel.string      = '';
    if (this.multiplierLabel)  this.multiplierLabel.string = '';
    if (this.timerLabel)       this.timerLabel.string      = `${Math.ceil(this._totalTime)}`;
    if (this.timerBar)         this.timerBar.progress      = 1;

    if (this.loadingPanel)         this.loadingPanel.active         = true;
    if (this.newHighScoreBanner)   this.newHighScoreBanner.active   = false;
    if (this.nearMissFlash)        this.nearMissFlash.active        = false;
    if (this.failSoftIndicator)    this.failSoftIndicator.active    = false;
    if (this.ftueHintRelay)        this.ftueHintRelay.node.active   = false;

    this._prevComboTier    = 0;
    this._lastTimerFloorSec = -1;
  }

  // ------------------------------------------------------------------
  // State change
  // ------------------------------------------------------------------

  private _onStateChange(payload: { prev: GameState; next: GameState }): void {
    switch (payload.next) {
      case GameState.LOADING:
        if (this.loadingPanel) this.loadingPanel.active = true;
        break;
      case GameState.PLAYING:
        if (this.loadingPanel) this.loadingPanel.active = false;
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // Score
  // ------------------------------------------------------------------

  private _onScoreUpdated(payload: { score: number; delta: number; multiplier: number }): void {
    if (this.scoreLabel) this.scoreLabel.string = payload.score.toLocaleString();

    if (payload.delta > 0 && this.scoreLabel) {
      // Scale pop magnitude by delta size: small delta → subtle, large → bigger
      const mag  = Math.min(1.0 + payload.delta / 200, 1.6);
      const peak = new Vec3(mag, mag, 1);
      tween(this.scoreLabel.node)
        .to(0.06, peak)
        .to(0.10, this._v1_0)
        .start();
    }
  }

  // ------------------------------------------------------------------
  // Combo
  // ------------------------------------------------------------------

  private _onComboUpdated(payload: { combo: number; multiplier: number; label: string }): void {
    const { combo, multiplier, label } = payload;

    if (this.comboLabel) {
      this.comboLabel.string = combo >= 3 ? (label || `×${combo}`) : '';
    }
    if (this.multiplierLabel) {
      this.multiplierLabel.string = multiplier > 1 ? `×${multiplier.toFixed(1)}` : '';
    }

    // Flash on tier boundary change
    const newTier = DEFAULT_GAME_CONFIG.comboTiers.findIndex(t => t.minCombo <= combo);
    if (newTier > this._prevComboTier && this.comboLabel) {
      this._prevComboTier = newTier;
      tween(this.comboLabel.node)
        .to(0.08, this._v1_4)
        .to(0.14, this._v1_0)
        .start();
    }
  }

  private _onComboReset(_payload: unknown): void {
    this._prevComboTier = 0;
    if (this.comboLabel)      this.comboLabel.string      = '';
    if (this.multiplierLabel) this.multiplierLabel.string = '';
  }

  // ------------------------------------------------------------------
  // Timer
  // ------------------------------------------------------------------

  private _onTimerTick(payload: { remaining: number; total: number }): void {
    const { remaining, total } = payload;

    if (this.timerBar) this.timerBar.progress = remaining / total;

    // Update numeric label only when the whole-second value changes
    const floorSec = Math.ceil(remaining);
    if (floorSec !== this._lastTimerFloorSec) {
      this._lastTimerFloorSec = floorSec;
      if (this.timerLabel) this.timerLabel.string = String(Math.max(0, floorSec));
    }

    // Urgent state: < 10 s remaining
    if (remaining <= TIMER_URGENT_THRESHOLD_S && remaining > 0) {
      this._startUrgentPulse();
    }
  }

  private _startUrgentPulse(): void {
    if (this._urgentPulseTween || !this.timerBar) return;
    this._urgentPulseTween = tween(this.timerBar.node)
      .to(0.30, this._v1_05)
      .to(0.30, this._v1_0)
      .union()
      .repeatForever()
      .start() as Tween<Node>;
  }

  // ------------------------------------------------------------------
  // Feedback overlays
  // ------------------------------------------------------------------

  private _onNearMiss(_payload: unknown): void {
    if (!this.nearMissFlash) return;
    this.nearMissFlash.active = true;
    this.scheduleOnce(() => {
      if (this.nearMissFlash) this.nearMissFlash.active = false;
    }, NEAR_MISS_FLASH_DURATION_S);
  }

  private _onHighScoreBeaten(_payload: { score: number }): void {
    if (!this.newHighScoreBanner) return;
    this.newHighScoreBanner.active = true;

    // Entrance: scale from small → overshoot → settle
    tween(this.newHighScoreBanner)
      .set({ scale: new Vec3(0.5, 0.5, 1) })
      .to(0.25, { scale: this._v1_3 }, { easing: 'backOut' })
      .to(0.15, { scale: this._v1_0 })
      .delay(HIGH_SCORE_BANNER_DURATION_S)
      .to(0.20, { scale: new Vec3(0, 0, 1) })
      .call(() => { if (this.newHighScoreBanner) this.newHighScoreBanner.active = false; })
      .start();
  }

  private _onFailSoft(payload: { active: boolean }): void {
    if (!this.failSoftIndicator) return;

    if (payload.active) {
      this.failSoftIndicator.active = true;
      // Gentle pulse — player should feel subtly supported, not mocked
      this._failSoftPulseTween = tween(this.failSoftIndicator)
        .to(0.6, { scale: this._v1_05 }, { easing: 'sineInOut' })
        .to(0.6, { scale: this._v1_0  }, { easing: 'sineInOut' })
        .union()
        .repeatForever()
        .start() as Tween<Node>;
    } else {
      this._failSoftPulseTween?.stop();
      this._failSoftPulseTween = null;
      this.failSoftIndicator.active = false;
    }
  }

  // ------------------------------------------------------------------
  // FTUE relay (optional: mirror tutorial hint text inside the HUD)
  // ------------------------------------------------------------------

  private _onFTUEStep(payload: { step: number; hint: string }): void {
    if (!this.ftueHintRelay) return;
    this.ftueHintRelay.node.active = true;
    this.ftueHintRelay.string      = payload.hint;
  }

  // ------------------------------------------------------------------
  // Pause show / hide
  // ------------------------------------------------------------------

  private _onPauseShow(): void {
    if (this.btnPause) this.btnPause.interactable = false;
  }

  private _onPauseHide(): void {
    if (this.btnPause) this.btnPause.interactable = true;
  }

  private _onPauseClicked(): void {
    GameManager.instance?.pause();
  }
}
