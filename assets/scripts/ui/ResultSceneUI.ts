import {
  _decorator, Component, Node, Label, Button,
  director, tween, Vec3,
} from 'cc';
import { SceneNames } from '../enums/SceneNames';
import { GameManager } from '../core/GameManager';
import { WeChatService } from '../services/WeChatService';
import { AnalyticsService } from '../services/AnalyticsService';
import { AdManager, AdRewardResult } from '../services/AdManager';
import { AdPlacementManager } from '../monetization/AdPlacementManager';
import { ResultSceneBinder } from '../bindings/SceneBinder';
import { ISessionResult } from '../interfaces/IScoreData';
import { EventBus, GameEvents } from '../utils/EventBus';
import { STORAGE_KEYS } from '../data/GameConfig';

const { ccclass, property } = _decorator;

// Duration of the score count-up animation in seconds
const COUNT_UP_DURATION_S = 1.2;

/**
 * ResultSceneUI — full production result screen.
 *
 * Displays:
 *  - Animated score count-up
 *  - New high-score celebration (pulse + FX node)
 *  - Near-miss banner with exact point gap ("Only 8 pts away!")
 *  - Session stats: catches, max combo
 *
 * Buttons:
 *  btnRetry              — play again immediately (no ad)
 *  btnWatchAdRetry       — OPTIONAL: watch a rewarded video then play again
 *                          (button clearly labelled "Watch Ad to Play Again")
 *                          WeChat review: ad is 100% optional, no content gating
 *  btnShare              — voluntary share (no reward tied to sharing)
 *  btnHome               — return to MainScene
 *
 * Ad flow (btnWatchAdRetry):
 *  1. Disable both retry buttons while ad plays
 *  2. Call AdManager.showRewardedAd('retry_bonus')
 *  3. AdRewardResult.GRANTED  → load GameScene
 *  4. AdRewardResult.SKIPPED  → re-enable buttons, show "Watch full ad to claim"
 *  5. AdRewardResult.UNAVAILABLE → silently fall back (load GameScene anyway,
 *     no reward shown — we never block the player from playing)
 *
 * WeChat review compliance:
 *  ✅ Share is voluntary — tapping Share does NOT gate any content
 *  ✅ Ad button label clearly says "Watch Ad" — no dark patterns
 *  ✅ No reward is shown before ad completion (res.isEnded check in AdManager)
 *  ✅ Ad unavailability gracefully falls back to direct retry
 *
 * Node assumptions (Inspector assignment, ResultScene/Canvas):
 *   finalScoreLabel      — animated score display
 *   highScoreLabel       — "Best: XXXX"
 *   catchesLabel         — "XX coins caught"
 *   maxComboLabel        — "Max combo ×N" (hidden if combo < 2)
 *   btnRetry             — direct retry button
 *   btnWatchAdRetry      — optional ad-retry button (can be null if not used)
 *   adRetryStatusLabel   — status text next to ad button ("Ad loading…", etc.)
 *   btnShare             — share button (clearly optional)
 *   btnHome              — home button
 *   nearMissBanner       — "So Close!" node (hidden by default)
 *   newHighScoreFX       — celebration FX node (hidden by default)
 *   scoreCard            — the card container (entrance animation target)
 */
@ccclass('ResultSceneUI')
export class ResultSceneUI extends Component {
  // ----- Score display -----
  @property(Label) finalScoreLabel:  Label | null = null;
  @property(Label) highScoreLabel:   Label | null = null;
  @property(Label) catchesLabel:     Label | null = null;
  @property(Label) maxComboLabel:    Label | null = null;

  // ----- Navigation buttons -----
  @property(Button) btnRetry:        Button | null = null;

  /**
   * Optional rewarded-ad retry button.
   * Label in scene MUST read "Watch Ad to Play Again" or similar.
   * If this property is null the ad retry feature is simply disabled.
   */
  @property(Button) btnWatchAdRetry: Button | null = null;

  /** Status text shown next to the ad button ("Loading ad…", "Ad unavailable"). */
  @property(Label) adRetryStatusLabel: Label | null = null;

  @property(Button) btnShare:        Button | null = null;
  @property(Button) btnHome:         Button | null = null;

  /**
   * Optional score-doubler button.
   * Label MUST read "Watch Ad to Double Score" (or similar).
   * Hidden after the ad is watched or if score is 0.
   */
  @property(Button) btnDoubleScore:  Button | null = null;

  /** Status text next to the doubler button ("Tap to double your score!", etc.) */
  @property(Label)  doubleScoreStatusLabel: Label | null = null;

  // ----- Feedback nodes -----
  @property(Node) nearMissBanner:    Node | null = null;
  @property(Node) newHighScoreFX:    Node | null = null;

  /** Card container — used for entrance scale animation. */
  @property(Node) scoreCard:         Node | null = null;

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------
  private _binder: ResultSceneBinder | null = null;
  private _adInFlight: boolean = false;
  private _countUpCb: ((dt: number) => void) | null = null;

  // Pre-allocated Vec3s to avoid GC in tween builders
  private readonly _v1_0  = new Vec3(1.0, 1.0, 1);
  private readonly _v1_2  = new Vec3(1.2, 1.2, 1);
  private readonly _v1_5  = new Vec3(1.5, 1.5, 1);
  private readonly _v0    = new Vec3(0.0, 0.0, 1);
  private readonly _v0_85 = new Vec3(0.85, 0.85, 1);

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    // Find sibling ResultSceneBinder if present (same node or scene root)
    this._binder = this.getComponent(ResultSceneBinder)
      ?? this.node.scene?.getComponentInChildren(ResultSceneBinder)
      ?? null;

    const result = GameManager.lastSessionResult;
    if (!result) {
      // No result data: navigate home safely
      console.warn('[ResultSceneUI] No session result found — returning to Main');
      this.scheduleOnce(() => this._safeLoadScene(SceneNames.MAIN), 0.1);
      return;
    }

    this._wireButtons();
    this._populateStats(result);
    this._runEntranceAnimation(result);
    // _updateAdButtonStatus() is called inside _wireButtons() after a 1.5 s delay
  }

  onDestroy(): void {
    this.btnRetry?.node.off(Button.EventType.CLICK,        this._onRetry,        this);
    this.btnWatchAdRetry?.node.off(Button.EventType.CLICK, this._onWatchAdRetry, this);
    this.btnDoubleScore?.node.off(Button.EventType.CLICK,  this._onDoubleScore,  this);
    this.btnShare?.node.off(Button.EventType.CLICK,        this._onShare,        this);
    this.btnHome?.node.off(Button.EventType.CLICK,         this._onHome,         this);
  }

  // ------------------------------------------------------------------
  // Population
  // ------------------------------------------------------------------

  private _populateStats(result: ISessionResult): void {
    const sd = result.scoreData;

    if (this.highScoreLabel) {
      this.highScoreLabel.string = `Best: ${sd.highScore.toLocaleString()}`;
    }
    if (this.catchesLabel) {
      this.catchesLabel.string = `${sd.objectsCaught} coin${sd.objectsCaught !== 1 ? 's' : ''} caught`;
    }
    if (this.maxComboLabel) {
      if (sd.maxComboReached >= 2) {
        this.maxComboLabel.string = `Max combo ×${sd.maxComboReached}`;
        this.maxComboLabel.node.active = true;
      } else {
        this.maxComboLabel.node.active = false;
      }
    }

    // Near-miss: within 5% of personal best (but didn't beat it)
    if (!result.isNewHighScore && sd.highScore > 0) {
      const ratio = sd.currentScore / sd.highScore;
      if (ratio >= 0.95) {
        this._showNearMiss(sd.currentScore, sd.highScore);
      }
    }
  }

  // ------------------------------------------------------------------
  // Entrance animation
  // ------------------------------------------------------------------

  private _runEntranceAnimation(result: ISessionResult): void {
    // Score card slides + scales in
    if (this.scoreCard) {
      this.scoreCard.setScale(this._v0_85);
      tween(this.scoreCard)
        .to(0.4, { scale: this._v1_0 }, { easing: 'backOut' })
        .start();
    }

    // Count-up animation for final score
    if (this.finalScoreLabel) {
      this._animateCountUp(result.scoreData.currentScore);
    }

    // New high-score celebration fires after the count-up finishes
    if (result.isNewHighScore) {
      this.scheduleOnce(() => this._celebrateNewHighScore(), COUNT_UP_DURATION_S);
    }
  }

  // ------------------------------------------------------------------
  // Special feedback
  // ------------------------------------------------------------------

  private _showNearMiss(score: number, highScore: number): void {
    if (!this.nearMissBanner) return;
    this.nearMissBanner.active = true;

    // Update copy with exact gap
    const label = this.nearMissBanner.getComponentInChildren(Label);
    if (label) {
      const gap = highScore - score;
      label.string = `So close! Only ${gap.toLocaleString()} pts from your best!`;
    }

    // Slide in from above
    const dest = this.nearMissBanner.position.clone();
    this.nearMissBanner.setPosition(dest.x, dest.y + 220, 0);
    tween(this.nearMissBanner)
      .to(0.45, { position: dest }, { easing: 'backOut' })
      .start();
  }

  private _celebrateNewHighScore(): void {
    if (this.newHighScoreFX) this.newHighScoreFX.active = true;

    if (this.finalScoreLabel) {
      // Double-pulse celebration on the score label
      tween(this.finalScoreLabel.node)
        .to(0.12, this._v1_5)
        .to(0.18, this._v1_0)
        .to(0.08, this._v1_2)
        .to(0.12, this._v1_0)
        .start();
    }
  }

  /**
   * Ease-out cubic count-up.
   * Sets finalScoreLabel to '0' immediately so there is no flash of old text.
   * Uses Component.schedule to avoid per-frame new object allocation.
   */
  private _animateCountUp(finalScore: number): void {
    if (!this.finalScoreLabel) return;
    if (finalScore === 0) { this.finalScoreLabel.string = '0'; return; }

    this.finalScoreLabel.string = '0';
    let elapsed = 0;
    const label = this.finalScoreLabel;

    // Use a stored reference so we can unschedule only this callback.
    // unscheduleAllCallbacks() must NOT be used here — it would cancel the
    // 2-second ad-status check scheduled by _updateAdButtonStatus().
    this._countUpCb = (dt: number) => {
      elapsed += dt;
      const t     = Math.min(elapsed / COUNT_UP_DURATION_S, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      label.string = Math.floor(eased * finalScore).toLocaleString();
      if (t >= 1 && this._countUpCb) {
        this.unschedule(this._countUpCb);
        this._countUpCb = null;
      }
    };
    this.schedule(this._countUpCb, 0 /* every frame */);
  }

  // ------------------------------------------------------------------
  // Button wiring
  // ------------------------------------------------------------------

  private _wireButtons(): void {
    this.btnRetry?.node.on(Button.EventType.CLICK,        this._onRetry,        this);
    this.btnWatchAdRetry?.node.on(Button.EventType.CLICK, this._onWatchAdRetry, this);
    this.btnDoubleScore?.node.on(Button.EventType.CLICK,  this._onDoubleScore,  this);
    this.btnShare?.node.on(Button.EventType.CLICK,        this._onShare,        this);
    this.btnHome?.node.on(Button.EventType.CLICK,         this._onHome,         this);

    // Hide the ad-retry CTA initially; reveal after 1.5 s so the near-miss banner
    // finishes animating first — prevents a dark-pattern pairing of emotional copy
    // with an ad call-to-action (WeChat review concern).
    if (this.btnWatchAdRetry) {
      this.btnWatchAdRetry.node.active = false;
      this.scheduleOnce(() => {
        if (this.btnWatchAdRetry) {
          this.btnWatchAdRetry.node.active = true;
          this._updateAdButtonStatus();
        }
      }, 1.5);
    }

    // Score doubler: hide initially, reveal after count-up completes (1.2 s + 0.3 s buffer).
    // Only shown if score > 0 and the doubler hasn't been used this round.
    const result = GameManager.lastSessionResult;
    if (this.btnDoubleScore) {
      const eligible = (result?.scoreData.currentScore ?? 0) > 0 && AdPlacementManager.scoreDoublerAvailable;
      this.btnDoubleScore.node.active = false;
      if (eligible) {
        this.scheduleOnce(() => {
          if (this.btnDoubleScore && AdPlacementManager.scoreDoublerAvailable) {
            this.btnDoubleScore.node.active = true;
            if (this.doubleScoreStatusLabel) {
              this.doubleScoreStatusLabel.string = '广告看完可获得双倍分！';
            }
          }
        }, COUNT_UP_DURATION_S + 0.5);
      }
    }
  }

  // ------------------------------------------------------------------
  // Button handlers
  // ------------------------------------------------------------------

  private _onRetry(): void {
    AnalyticsService.instance?.track('retry_clicked', { withAd: false });
    void this._safeLoadScene(SceneNames.GAME);
  }

  /**
   * Rewarded-ad retry flow.
   *
   * WeChat review checklist for this method:
   *  ✅ Only called on explicit user tap (Button.EventType.CLICK)
   *  ✅ Never auto-called
   *  ✅ Ad result strictly respected (no reward on SKIPPED)
   *  ✅ UNAVAILABLE falls back gracefully (still lets player retry)
   *  ✅ Buttons re-enabled if flow fails or is cancelled
   */
  private async _onWatchAdRetry(): Promise<void> {
    if (this._adInFlight) return; // Prevent double-tap during ad

    this._adInFlight = true;
    this._setRetryButtonsEnabled(false);
    if (this.adRetryStatusLabel) this.adRetryStatusLabel.string = '';

    const result = await AdManager.instance?.showRewardedAd('retry_bonus')
      ?? AdRewardResult.UNAVAILABLE;

    if (!this.isValid) return; // Component destroyed while ad was showing
    this._adInFlight = false;

    if (result === AdRewardResult.GRANTED) {
      // Full ad watched — proceed to game
      AnalyticsService.instance?.track('retry_clicked', { withAd: true });
      void this._safeLoadScene(SceneNames.GAME);

    } else if (result === AdRewardResult.SKIPPED) {
      // Player closed early — inform gently, do NOT navigate (WeChat policy)
      if (this.adRetryStatusLabel) {
        this.adRetryStatusLabel.string = 'Watch the full ad to play again';
      }
      this._setRetryButtonsEnabled(true);

    } else {
      // Ad unavailable — fall back to direct retry so player is never blocked
      if (this.adRetryStatusLabel) {
        this.adRetryStatusLabel.string = 'Ad unavailable — starting game';
      }
      this.scheduleOnce(() => void this._safeLoadScene(SceneNames.GAME), 0.8);
    }
  }

  /**
   * Score doubler flow — watch a full rewarded video to multiply the saved score by 2.
   *
   * WeChat review checklist:
   *  ✅ Only called on explicit user tap
   *  ✅ Never granted on SKIPPED (res.isEnded strictly enforced in AdManager)
   *  ✅ Does not prevent the player from proceeding without watching
   *  ✅ Button hidden after first use (once per round)
   */
  private async _onDoubleScore(): Promise<void> {
    if (!AdPlacementManager.scoreDoublerAvailable || this._adInFlight) return;

    this._adInFlight = true;
    if (this.btnDoubleScore) this.btnDoubleScore.interactable = false;
    if (this.doubleScoreStatusLabel) this.doubleScoreStatusLabel.string = '广告加载中…';

    const result = await AdManager.instance?.showRewardedAd('score_double')
      ?? AdRewardResult.UNAVAILABLE;

    if (!this.isValid) return;
    this._adInFlight = false;

    if (result === AdRewardResult.GRANTED) {
      AdPlacementManager.markScoreDoublerUsed();
      this._applyScoreDouble();
    } else if (result === AdRewardResult.SKIPPED) {
      if (this.btnDoubleScore) this.btnDoubleScore.interactable = true;
      if (this.doubleScoreStatusLabel) this.doubleScoreStatusLabel.string = '看完广告才能获得双倍！';
    } else {
      // Ad unavailable — hide the button so it doesn't frustrate the player
      if (this.btnDoubleScore) this.btnDoubleScore.node.active = false;
    }
  }

  /** Multiply the current session score by 2, re-animate the counter, update storage. */
  private _applyScoreDouble(): void {
    const sr = GameManager.lastSessionResult;
    if (!sr) return;

    const original = sr.scoreData.currentScore;
    const doubled  = original * 2;

    sr.scoreData.currentScore = doubled;

    // Update high score if the doubled value beats the stored record
    if (doubled > sr.scoreData.highScore) {
      sr.scoreData.highScore = doubled;
      sr.isNewHighScore      = true;
      WeChatService.instance?.saveToStorage(STORAGE_KEYS.HIGH_SCORE, doubled);

      if (this.highScoreLabel) {
        this.highScoreLabel.string = `Best: ${doubled.toLocaleString()}`;
      }
    }

    // Re-animate count-up with the doubled figure
    EventBus.emit(GameEvents.SCORE_DOUBLED, { original, doubled });
    this._animateCountUp(doubled);

    // Hide doubler button — consumed
    if (this.btnDoubleScore)       this.btnDoubleScore.node.active = false;
    if (this.doubleScoreStatusLabel) this.doubleScoreStatusLabel.string = '';

    AnalyticsService.instance?.track('score_doubled', { original, doubled });

    // Celebrate if this is now a new high score
    if (sr.isNewHighScore) {
      this.scheduleOnce(() => this._celebrateNewHighScore(), COUNT_UP_DURATION_S + 0.1);
    }
  }

  private _onShare(): void {
    // Share is ALWAYS voluntary — the button does nothing except trigger the
    // native wx share sheet.  No reward, badge, or content is gated behind it.
    const score = GameManager.lastSessionResult?.scoreData.currentScore ?? 0;
    WeChatService.instance?.shareAppMessage({
      title: `我刚才得了${score.toLocaleString()}分！你能超过我吗？`,
      query: `score=${score}`,
    });
    AnalyticsService.instance?.track('share_clicked', { score });
    AnalyticsService.instance?.flush();
  }

  private _onHome(): void {
    void this._safeLoadScene(SceneNames.MAIN);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** Lock / unlock both retry buttons symmetrically. */
  private _setRetryButtonsEnabled(enabled: boolean): void {
    if (this.btnRetry)        this.btnRetry.interactable        = enabled;
    if (this.btnWatchAdRetry) this.btnWatchAdRetry.interactable = enabled;
  }

  /** Update the ad button hint text based on whether ad is preloaded. */
  private _updateAdButtonStatus(): void {
    if (!this.adRetryStatusLabel || !this.btnWatchAdRetry) return;
    const ready = AdManager.instance?.isRewardedAdReady ?? false;
    this.adRetryStatusLabel.string = ready ? '' : 'Loading ad…';
    // Check again after 2 s in case the ad loads asynchronously
    this.scheduleOnce(() => {
      if (!this.adRetryStatusLabel || !this.btnWatchAdRetry) return;
      const isReady = AdManager.instance?.isRewardedAdReady ?? false;
      this.adRetryStatusLabel.string = isReady ? '' : 'Ad unavailable';
    }, 2.0);
  }

  /**
   * Scene transition with interstitial gate + error boundary.
   * If navigating to GameScene and an interstitial is due, shows it first.
   * Notifies ResultSceneBinder to start the timeout watchdog and destroy the banner.
   */
  private async _safeLoadScene(sceneName: string): Promise<void> {
    // Show interstitial at natural break (result → retry) if one is due.
    // Only gated for game-scene navigation — never on Home.
    if (sceneName === SceneNames.GAME) {
      await AdPlacementManager.instance?.showInterstitialIfDue();
      if (!this.isValid) return; // Scene may have been unloaded during interstitial
    }

    this._binder?.beginSceneTransition(sceneName);
    try {
      director.loadScene(sceneName, (err) => {
        if (err) {
          console.error(`[ResultSceneUI] Failed to load ${sceneName}:`, err);
          this._setRetryButtonsEnabled(true);
          if (this.adRetryStatusLabel) this.adRetryStatusLabel.string = 'Load failed — tap to retry';
        }
      });
    } catch (e) {
      console.error(`[ResultSceneUI] loadScene(${sceneName}) threw:`, e);
      this._setRetryButtonsEnabled(true);
    }
  }
}
