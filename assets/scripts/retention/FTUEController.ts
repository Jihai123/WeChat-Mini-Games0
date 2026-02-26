import {
  _decorator, Component, Node, Label, tween, Vec3, repeat,
  Tween,
} from 'cc';
import { GameState } from '../enums/GameState';
import { EventBus, GameEvents } from '../utils/EventBus';
import { WeChatService } from '../services/WeChatService';
import { AnalyticsService } from '../services/AnalyticsService';
import { HookController } from '../gameplay/HookController';
import { DEFAULT_GAME_CONFIG, FTUE_GUARANTEED_CATCHES } from '../data/GameConfig';

const { ccclass, property } = _decorator;

// Storage key — once true, FTUE overlay is never shown again
const FTUE_DONE_KEY = 'wg_ftue_done';

// During FTUE the hook swings slower so beginners can aim comfortably
const FTUE_HOOK_SPEED_MULTIPLIER = 0.55;

// FTUE step definitions (step index → hint text)
const FTUE_HINTS: readonly string[] = [
  'Tap anywhere to drop the hook!',              // Step 0 — before first tap
  'Great! Try to catch the big gold coin!',       // Step 1 — after first tap
  'You got it! Keep catching coins!',             // Step 2 — after first catch
  `Catch ${FTUE_GUARANTEED_CATCHES} coins to complete training!`, // Step 3
];

/**
 * FTUEController — first-time user experience tutorial overlay.
 *
 * Workflow:
 *  1. onLoad checks storage; if FTUE already done → immediately disables self.
 *  2. Listens for GAME_STATE_CHANGE { next: PLAYING } to initialise the flow.
 *  3. Slows the hook swing via HookController.setSwingSpeed().
 *  4. Steps through FTUE_HINTS in response to HOOK_MISS (first tap) and
 *     FTUE_CATCH events (each guaranteed bonus_gold catch).
 *  5. After FTUE_GUARANTEED_CATCHES catches: emits FTUE_COMPLETE, hides overlay,
 *     restores normal hook speed, saves completion flag.
 *
 * Node assumptions (assign in Inspector under GameScene/FTUE_Overlay):
 *   ftueOverlay      — root container (active = false initially)
 *   hintLabel        — Label node displaying current hint text
 *   tapIndicator     — Node with animated "tap" icon (bounces up/down)
 *   catchCounter     — Label showing "X / 3 catches"
 *
 * Anti-annoyance design:
 *  - Overlay is non-blocking; player can play freely underneath it.
 *  - Never shown on second+ play (persisted to storage).
 *  - If player catches a coin before completing the hint step, step advances
 *    naturally without forcing them to read everything first.
 */
@ccclass('FTUEController')
export class FTUEController extends Component {
  @property(Node)
  ftueOverlay: Node | null = null;

  @property(Label)
  hintLabel: Label | null = null;

  @property(Node)
  tapIndicator: Node | null = null;

  @property(Label)
  catchCounter: Label | null = null;

  /** Direct reference to HookController for speed adjustment (same scene). */
  @property(HookController)
  hookController: HookController | null = null;

  // ------------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------------

  private _active:      boolean = false;
  private _step:        number  = 0;
  private _catches:     number  = 0;
  private _tapTween:    Tween<Node> | null = null;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    // If FTUE was completed in a previous session, do nothing
    const done = WeChatService.instance?.loadFromStorage<boolean>(FTUE_DONE_KEY);
    if (done) {
      this.enabled = false; // Disable Component.update + all scheduling
      return;
    }

    EventBus.on(GameEvents.GAME_STATE_CHANGE, this._onStateChange, this);
    EventBus.on(GameEvents.HOOK_MISS,         this._onHookMiss,    this);
    EventBus.on(GameEvents.FTUE_CATCH,        this._onFTUECatch,   this);

    // Hide overlay until gameplay starts
    if (this.ftueOverlay) this.ftueOverlay.active = false;
  }

  onDestroy(): void {
    EventBus.off(GameEvents.GAME_STATE_CHANGE, this._onStateChange, this);
    EventBus.off(GameEvents.HOOK_MISS,         this._onHookMiss,    this);
    EventBus.off(GameEvents.FTUE_CATCH,        this._onFTUECatch,   this);
    this._stopTapAnimation();
  }

  // ------------------------------------------------------------------
  // Event handlers
  // ------------------------------------------------------------------

  private _onStateChange(payload: { prev: GameState; next: GameState }): void {
    if (payload.next === GameState.PLAYING && !this._active) {
      this._beginFTUE();
    }
  }

  /** First tap is detected via a HOOK_MISS (hook dropped but nothing caught yet). */
  private _onHookMiss(_payload: unknown): void {
    if (!this._active || this._step !== 0) return;
    this._advanceStep(1);
  }

  /** ObjectSpawner emits FTUE_CATCH after each guaranteed bonus_gold is caught. */
  private _onFTUECatch(payload: { remaining: number }): void {
    if (!this._active) return;
    this._catches++;
    this._updateCatchCounter();

    const remaining = payload.remaining;

    if (remaining === 0) {
      // All guaranteed catches achieved — finish FTUE
      this._completeFTUE();
    } else if (this._step < 3) {
      // Advance to "keep catching" prompt after the first catch
      this._advanceStep(this._step < 2 ? 2 : 3);
    }
  }

  // ------------------------------------------------------------------
  // FTUE flow
  // ------------------------------------------------------------------

  private _beginFTUE(): void {
    this._active  = true;
    this._step    = 0;
    this._catches = 0;

    // Slow down hook so beginner can aim
    const slowSpeed = DEFAULT_GAME_CONFIG.hookBaseSpeed * FTUE_HOOK_SPEED_MULTIPLIER;
    this.hookController?.setSwingSpeed(slowSpeed);

    // Show overlay
    if (this.ftueOverlay) this.ftueOverlay.active = true;
    this._updateHint(0);
    this._updateCatchCounter();
    this._startTapAnimation();
  }

  private _advanceStep(nextStep: number): void {
    if (nextStep <= this._step) return; // Never go backwards
    this._step = nextStep;
    this._updateHint(this._step);

    // Stop tap animation after first interaction
    if (this._step >= 1) this._stopTapAnimation();
  }

  private _completeFTUE(): void {
    this._active = false;

    // Restore normal hook speed
    this.hookController?.setSwingSpeed(DEFAULT_GAME_CONFIG.hookBaseSpeed);

    // Hide overlay with a quick fade-out scale
    if (this.ftueOverlay) {
      tween(this.ftueOverlay)
        .to(0.3, { scale: new Vec3(1.1, 1.1, 1) })
        .to(0.2, { scale: new Vec3(0.0, 0.0, 1) })
        .call(() => {
          if (this.ftueOverlay) this.ftueOverlay.active = false;
        })
        .start();
    }

    // Persist completion so FTUE never shows again
    WeChatService.instance?.saveToStorage(FTUE_DONE_KEY, true);

    // Emit for analytics and any other listeners (e.g., SceneBinder)
    EventBus.emit(GameEvents.FTUE_COMPLETE, undefined);
    AnalyticsService.instance?.track('ftue_complete', { catches: this._catches });

    // Clean up listeners — FTUE is done for this install
    EventBus.off(GameEvents.GAME_STATE_CHANGE, this._onStateChange, this);
    EventBus.off(GameEvents.HOOK_MISS,         this._onHookMiss,    this);
    EventBus.off(GameEvents.FTUE_CATCH,        this._onFTUECatch,   this);
    this.enabled = false;
  }

  // ------------------------------------------------------------------
  // UI helpers
  // ------------------------------------------------------------------

  private _updateHint(step: number): void {
    if (!this.hintLabel) return;
    const safeStep = Math.min(step, FTUE_HINTS.length - 1);
    this.hintLabel.string = FTUE_HINTS[safeStep];

    // Emit for any other listeners (e.g., analytics)
    EventBus.emit(GameEvents.FTUE_STEP, { step: safeStep, hint: FTUE_HINTS[safeStep] });

    // Bounce-in animation for text update
    tween(this.hintLabel.node)
      .to(0.07, { scale: new Vec3(1.15, 1.15, 1) })
      .to(0.10, { scale: new Vec3(1.00, 1.00, 1) })
      .start();
  }

  private _updateCatchCounter(): void {
    if (!this.catchCounter) return;
    this.catchCounter.string = `${this._catches} / ${FTUE_GUARANTEED_CATCHES}`;
  }

  /**
   * Looping bounce animation on the tap indicator arrow.
   * Uses a stable reference so it can be stopped cleanly.
   * Allocates Vec3 objects once (reused by tween builder).
   */
  private _startTapAnimation(): void {
    if (!this.tapIndicator) return;
    this._stopTapAnimation();

    const up   = new Vec3(0,  18, 0);
    const down = new Vec3(0, -18, 0);

    this._tapTween = tween(this.tapIndicator)
      .by(0.45, { position: up },   { easing: 'sineOut' })
      .by(0.45, { position: down }, { easing: 'sineIn'  })
      .union()
      .repeatForever()
      .start() as Tween<Node>;
  }

  private _stopTapAnimation(): void {
    if (this._tapTween) {
      this._tapTween.stop();
      this._tapTween = null;
    }
    if (this.tapIndicator) {
      this.tapIndicator.setPosition(0, 0, 0);
    }
  }
}
