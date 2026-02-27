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
import { AchievementManager } from '../retention/AchievementManager';
import { DailyMissionManager } from '../retention/DailyMissionManager';

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
   * Optional toast node for achievement/mission unlock notifications.
   * If null the feature silently degrades — data is still tracked.
   * Expects a child Label named 'ToastLabel' (or any Label component).
   */
  @property(Node) unlockToastNode:   Node  | null = null;

  /**
   * Score-doubler button node reference.
   * Force-hidden in V1 (ships in V2 after approval).
   * Node kept so Inspector wiring is preserved across deploys.
   */
  @property(Button) btnDoubleScore:  Button | null = null;

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

    // Schedule achievement + mission unlock toasts after the score count-up finishes
    this.scheduleOnce(() => this._showPendingUnlocks(), COUNT_UP_DURATION_S + 0.8);
  }

  onDestroy(): void {
    this.btnRetry?.node.off(Button.EventType.CLICK,        this._onRetry,        this);
    this.btnWatchAdRetry?.node.off(Button.EventType.CLICK, this._onWatchAdRetry, this);
    // btnDoubleScore: V2 feature — not wired in V1
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
    // btnDoubleScore: V2 feature — not wired in V1 (changes final score via ad, PM constraint)
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
          // Track impression so we can calculate rewarded-retry CTR:
          // CTR = ad_reward_granted(source=retry_bonus) / rewarded_btn_shown
          AnalyticsService.instance?.track('rewarded_btn_shown', { placement: 'retry_bonus' });
        }
      }, 1.5);
    }

    // btnDoubleScore: force-hidden in V1 — score doubler ships in V2
    if (this.btnDoubleScore) this.btnDoubleScore.node.active = false;
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
        this.adRetryStatusLabel.string = '看完广告才能再玩哦~';
      }
      this._setRetryButtonsEnabled(true);

    } else {
      // Ad unavailable — fall back to direct retry so player is never blocked
      if (this.adRetryStatusLabel) {
        this.adRetryStatusLabel.string = '广告暂不可用，直接开始';
      }
      this.scheduleOnce(() => void this._safeLoadScene(SceneNames.GAME), 0.8);
    }
  }

  // ------------------------------------------------------------------
  // Achievement & mission unlock notifications
  // ------------------------------------------------------------------

  /**
   * Build and play a queue of unlock toast messages.
   * Achievements fire first, then mission completions, one every 2.2 s.
   * Each toast scales in, holds, then fades — giving the player a clear
   * moment to read the reward before the next one appears.
   *
   * If `unlockToastNode` is not wired in the Inspector the feature degrades
   * gracefully (notifications are skipped, data is already saved by GameManager).
   */
  private _showPendingUnlocks(): void {
    if (!this.isValid) return;

    const queue: Array<{ icon: string; text: string }> = [];

    // Achievement unlocks
    for (const ach of AchievementManager.lastSessionUnlocked) {
      queue.push({
        icon: ach.icon,
        text: `成就解锁！${ach.icon} ${ach.title}\n${ach.description}\n+${ach.rewardSpawns} 下局道具`,
      });
    }
    // Daily mission completions
    for (const m of DailyMissionManager.lastSessionCompleted) {
      const completedCount = DailyMissionManager.instance?.completedCount ?? 0;
      queue.push({
        icon: '✅',
        text: `任务完成！✅\n${m.description}\n今日进度 ${completedCount}/3`,
      });
    }
    // All-missions bonus notification
    if (DailyMissionManager.instance?.allCompleted &&
        DailyMissionManager.lastSessionCompleted.length > 0) {
      queue.push({
        icon: '🎁',
        text: '今日任务全部完成！🎁\n下局获得额外奖励道具！',
      });
    }

    if (queue.length === 0) return;

    // Show each toast with a 2.2 s gap
    queue.forEach((item, idx) => {
      this.scheduleOnce(() => {
        if (this.isValid) this._showUnlockToast(item.text);
      }, idx * 2.2);
    });
  }

  /**
   * Display a single unlock toast on `unlockToastNode`.
   * Uses a scale-in + hold + scale-out tween sequence.
   */
  private _showUnlockToast(text: string): void {
    if (!this.unlockToastNode) return;

    // Update label text
    const label = this.unlockToastNode.getComponentInChildren(Label);
    if (label) label.string = text;

    // Animate: hidden → scale-in → hold → scale-out
    this.unlockToastNode.active = true;
    this.unlockToastNode.setScale(this._v0);

    tween(this.unlockToastNode)
      .to(0.20, { scale: this._v1_2 }, { easing: 'backOut' })
      .to(0.08, { scale: this._v1_0 })
      .delay(1.8)
      .to(0.18, { scale: this._v0 })
      .call(() => { if (this.unlockToastNode) this.unlockToastNode.active = false; })
      .start();
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
    this.adRetryStatusLabel.string = ready ? '' : '广告加载中…';
    // Check again after 2 s in case the ad loads asynchronously
    this.scheduleOnce(() => {
      if (!this.adRetryStatusLabel || !this.btnWatchAdRetry) return;
      const isReady = AdManager.instance?.isRewardedAdReady ?? false;
      this.adRetryStatusLabel.string = isReady ? '' : '广告暂不可用';
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
