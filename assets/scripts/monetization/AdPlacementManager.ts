import { _decorator, Component } from 'cc';
import { AdManager } from '../services/AdManager';
import { AnalyticsService } from '../services/AnalyticsService';
import { EventBus, GameEvents } from '../utils/EventBus';

const { ccclass, property } = _decorator;

/**
 * AdPlacementManager — placement strategy orchestrator.
 *
 * Manages the WHERE and WHEN of every ad placement, keeping policy
 * decisions in one place instead of scattered across UI components.
 *
 * Placement catalogue:
 *  ┌──────────────────────┬────────────────────────────────────────────────┐
 *  │ Placement            │ Trigger                                        │
 *  ├──────────────────────┼────────────────────────────────────────────────┤
 *  │ Interstitial         │ Every N rounds at result→game transition       │
 *  │ Score Doubler        │ Once per round on result screen (rewarded)     │
 *  │ Pre-Round Bonus      │ Once per session on main menu (rewarded)       │
 *  │ Daily Ad Bonus       │ Once per day on main menu (rewarded)           │
 *  └──────────────────────┴────────────────────────────────────────────────┘
 *
 * WeChat review compliance:
 *  ✅ Interstitial only shown at natural break (result → next round)
 *  ✅ All rewarded placements are 100% optional user-initiated
 *  ✅ No placement is ever shown automatically or on a timer
 *  ✅ Game always playable without watching any ad
 *
 * Static state survives scene loads — all counters accumulate across rounds
 * within a single app session and reset on cold start.
 *
 * Add this component to a persistent node in each scene that needs ad logic,
 * or keep it on the MainScene and let the static methods work cross-scene.
 */
@ccclass('AdPlacementManager')
export class AdPlacementManager extends Component {
  private static _instance: AdPlacementManager | null = null;

  // ---- Cross-scene counters (static — survive director.loadScene) ----
  private static _roundsThisSession:  number  = 0;
  private static _scoreDoublerUsed:   boolean = false;
  private static _preRoundOfferUsed:  boolean = false;

  /** Configurable via Inspector: show interstitial every N rounds (default 3). */
  @property({ min: 1, step: 1, tooltip: 'Show interstitial ad every N rounds' })
  interstitialGateRounds: number = 3;

  static get instance(): AdPlacementManager | null { return AdPlacementManager._instance; }

  onLoad(): void  { AdPlacementManager._instance = this; }
  onDestroy(): void {
    if (AdPlacementManager._instance === this) AdPlacementManager._instance = null;
  }

  // ---------------------------------------------------------------------------
  // Round lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Call at the beginning of every loading phase (GameManager._onEnterLoading).
   * Increments the round counter and resets per-round placement flags.
   */
  static recordRoundStart(): void {
    AdPlacementManager._roundsThisSession++;
    AdPlacementManager._scoreDoublerUsed = false; // reset per round
  }

  // ---------------------------------------------------------------------------
  // Interstitial placement
  // ---------------------------------------------------------------------------

  /**
   * Returns true when an interstitial is due (every N rounds) AND the ad is loaded.
   * ResultSceneUI calls this before navigating back to GameScene.
   */
  shouldShowInterstitial(): boolean {
    const rounds = AdPlacementManager._roundsThisSession;
    return (
      rounds > 0 &&
      rounds % this.interstitialGateRounds === 0 &&
      AdManager.instance?.isInterstitialReady === true
    );
  }

  /**
   * Show the interstitial ad if one is due.  Resolves when the ad is dismissed.
   * Safe to await — never rejects, resolves immediately if no ad is due.
   */
  async showInterstitialIfDue(): Promise<void> {
    if (!this.shouldShowInterstitial()) return;

    AnalyticsService.instance?.track('interstitial_shown', {
      round: AdPlacementManager._roundsThisSession,
    });
    EventBus.emit(GameEvents.INTERSTITIAL_SHOWN, undefined);

    await AdManager.instance?.showInterstitialAd();
  }

  // ---------------------------------------------------------------------------
  // Score doubler (rewarded)
  // ---------------------------------------------------------------------------

  /** Whether the score doubler is available for the current round. */
  static get scoreDoublerAvailable(): boolean {
    return !AdPlacementManager._scoreDoublerUsed;
  }

  /** Call after the rewarded ad for score doubling returns GRANTED. */
  static markScoreDoublerUsed(): void {
    AdPlacementManager._scoreDoublerUsed = true;
  }

  // ---------------------------------------------------------------------------
  // Pre-round bonus (rewarded, once per session)
  // ---------------------------------------------------------------------------

  /** Whether the pre-round bonus offer is still available this session. */
  static get preRoundOfferAvailable(): boolean {
    return !AdPlacementManager._preRoundOfferUsed;
  }

  /** Call after the pre-round rewarded ad returns GRANTED. */
  static markPreRoundOfferUsed(): void {
    AdPlacementManager._preRoundOfferUsed = true;
  }
}
