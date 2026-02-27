import { _decorator, Component, sys } from 'cc';
import { EventBus, GameEvents } from '../utils/EventBus';
import { AnalyticsService } from './AnalyticsService';
import { WeChatService } from './WeChatService';
import { FLAG_ADS_ENABLED, FLAG_INTERSTITIAL_ADS } from '../data/FeatureFlags';

const { ccclass, property } = _decorator;

// ---------------------------------------------------------------------------
// ⚠️  Replace with real ad unit IDs from WeChat MP → Monetisation → Ad Units BEFORE submission.
// Using placeholder values will cause ad load failures and may trigger review rejection.
// ---------------------------------------------------------------------------
const REWARDED_VIDEO_AD_UNIT_ID = '';  // wx.RewardedVideoAd
const BANNER_AD_UNIT_ID         = '';  // wx.BannerAd
const INTERSTITIAL_AD_UNIT_ID   = '';  // wx.InterstitialAd (shown at round breaks)

// After an ad error, wait this many seconds before allowing another load attempt.
const ERROR_COOLDOWN_S = 30;

// WeChat injects wx into the global scope in Mini Game runtime.
declare const wx: any;

// ---------------------------------------------------------------------------
// Public result type for showRewardedAd()
// ---------------------------------------------------------------------------

/** Result returned by showRewardedAd(). Never throws — always resolves. */
export enum AdRewardResult {
  /** User watched the complete video. Grant the reward. */
  GRANTED     = 'GRANTED',
  /** User closed the video before it finished. Do NOT grant reward. WeChat review requires this. */
  SKIPPED     = 'SKIPPED',
  /** Ad was not available (load failure, network, inventory). Graceful fallback — still let player play. */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Internal loading state machine for the rewarded video ad instance. */
enum AdState {
  UNLOADED  = 'UNLOADED',
  LOADING   = 'LOADING',
  READY     = 'READY',
  SHOWING   = 'SHOWING',
  COOLING   = 'COOLING', // Post-error cooldown
}

/**
 * AdManager — centralised WeChat ad lifecycle manager.
 *
 * Responsibilities:
 *  - Rewarded video: load once, reuse, reload after each show.
 *    showRewardedAd() never throws; always resolves with AdRewardResult.
 *  - Banner: create on demand, show/hide per scene, destroy on scene exit.
 *
 * WeChat review compliance:
 *  ✅ Rewarded video only shown on explicit player tap (no auto-show)
 *  ✅ res.isEnded strictly checked — reward denied if false
 *  ✅ Banner only shown on non-gameplay screens (result / main)
 *  ✅ Ad buttons clearly labelled (enforced via property slots, not this file)
 *  ✅ No reward gating — ads are always optional
 *  ✅ Full error boundary — ad unavailability never blocks gameplay
 *
 * Usage:
 *   AdManager.instance?.showRewardedAd('retry_bonus')
 *     .then(result => { if (result === AdRewardResult.GRANTED) { ... } });
 *
 *   AdManager.instance?.showBanner();    // ResultScene onLoad
 *   AdManager.instance?.destroyBanner(); // ResultScene onDestroy
 */
@ccclass('AdManager')
export class AdManager extends Component {
  private static _instance: AdManager | null = null;

  // ---------------------------------------------------------------------------
  // Rewarded video internals
  // ---------------------------------------------------------------------------
  private _rewardedAd:     any       = null; // wx.RewardedVideoAd instance
  private _adState:        AdState   = AdState.UNLOADED;
  private _cooldownTimer:  number    = 0;
  private _isWxEnv:        boolean   = false;

  // Pending promise resolver — set when show() is called, resolved by onClose
  private _pendingResolve: ((r: AdRewardResult) => void) | null = null;
  private _destroyed:      boolean                              = false;

  // ---------------------------------------------------------------------------
  // Banner internals
  // ---------------------------------------------------------------------------
  private _bannerAd:       any       = null; // wx.BannerAd instance
  private _bannerVisible:  boolean   = false;
  private _systemInfo:     { windowWidth: number; windowHeight: number } | null = null;

  // ---------------------------------------------------------------------------
  // Interstitial internals
  // ---------------------------------------------------------------------------
  private _interstitialAd:      any     = null; // wx.InterstitialAd instance
  private _interstitialReady:   boolean = false;
  private _interstitialResolve: (() => void) | null = null;

  static get instance(): AdManager | null { return AdManager._instance; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onLoad(): void {
    AdManager._instance = this;
    this._isWxEnv = typeof wx !== 'undefined';

    if (this._isWxEnv) {
      // Pre-fetch system info once so banner sizing is instant
      wx.getSystemInfo({
        success: (res: any) => {
          this._systemInfo = { windowWidth: res.windowWidth, windowHeight: res.windowHeight };
        },
        fail: () => { /* use default sizing */ },
      });
      this._initRewardedAd();
      if (FLAG_INTERSTITIAL_ADS) this._initInterstitialAd(); // V2 only
    }
  }

  onDestroy(): void {
    if (AdManager._instance === this) AdManager._instance = null;
    this._destroyed = true;
    this._destroyRewardedAd();
    this.destroyBanner();
    this._destroyInterstitialAd();
  }

  update(dt: number): void {
    if (this._adState !== AdState.COOLING) return;
    this._cooldownTimer -= dt;
    if (this._cooldownTimer <= 0) {
      this._adState = AdState.UNLOADED;
      this._initRewardedAd(); // Retry load after cooldown
    }
  }

  // ---------------------------------------------------------------------------
  // Rewarded Video — Public API
  // ---------------------------------------------------------------------------

  /**
   * Show the rewarded video ad.
   *
   * @param source  Analytics label identifying where the ad was triggered
   *                (e.g. 'retry_bonus', 'score_multiplier').
   * @returns       Promise<AdRewardResult> — always resolves, never rejects.
   *
   * IMPORTANT (WeChat review): caller must ONLY trigger this on an explicit
   * user gesture (button tap).  Never call from a timer or auto-show logic.
   */
  async showRewardedAd(source: string): Promise<AdRewardResult> {
    if (!this._isWxEnv) {
      // Editor / devtools — return UNAVAILABLE so the fallback path is exercised
      console.log(`[AdManager] Dev env: rewarded ad unavailable (${source})`);
      return AdRewardResult.UNAVAILABLE;
    }

    if (this._adState === AdState.SHOWING) {
      // Guard against double-tap
      return AdRewardResult.UNAVAILABLE;
    }

    if (this._adState !== AdState.READY) {
      console.warn(`[AdManager] Rewarded ad not ready (state: ${this._adState})`);
      return AdRewardResult.UNAVAILABLE;
    }

    return new Promise<AdRewardResult>((resolve) => {
      this._pendingResolve = resolve;
      this._adState = AdState.SHOWING;

      // Analytics: ad impression
      AnalyticsService.instance?.track('ad_shown', { source, type: 'rewarded' });

      this._rewardedAd
        .show()
        .then(() => {
          // Ad is now displayed — result comes back via onClose callback
        })
        .catch((err: any) => {
          console.warn('[AdManager] rewardedAd.show() failed:', err);
          this._resolvePending(AdRewardResult.UNAVAILABLE, source);
        });
    });
  }

  /** Whether the rewarded ad is preloaded and ready to show instantly. */
  get isRewardedAdReady(): boolean { return this._adState === AdState.READY; }

  // ---------------------------------------------------------------------------
  // Banner — Public API
  // ---------------------------------------------------------------------------

  /**
   * Create and display a bottom-anchored banner ad.
   * Safe to call multiple times — only one instance is maintained.
   * Call destroyBanner() in the scene's onDestroy to release resources.
   */
  showBanner(): void {
    if (!this._isWxEnv || !FLAG_ADS_ENABLED) return;

    // Re-show existing banner if it was hidden
    if (this._bannerAd) {
      if (!this._bannerVisible) {
        this._bannerAd.show().catch(() => { /* silently ignore */ });
        this._bannerVisible = true;
      }
      return;
    }

    let w = this._systemInfo?.windowWidth;
    let h = this._systemInfo?.windowHeight;
    if (w === undefined || h === undefined) {
      try {
        const si = wx.getSystemInfoSync();
        w = si.windowWidth  ?? 320;
        h = si.windowHeight ?? 568;
      } catch {
        w = w ?? 320;
        h = h ?? 568;
      }
    }

    try {
      this._bannerAd = wx.createBannerAd({
        adUnitId: BANNER_AD_UNIT_ID,
        // type: 'fixed' ensures consistent placement
        style: {
          left:   0,
          top:    h - 100, // Temporary; corrected by onResize
          width:  w,
          height: 100,
        },
      });

      // Reposition after the actual ad size is known
      this._bannerAd.onResize((res: { width: number; height: number }) => {
        if (!this._bannerAd) return;
        const currentH = this._systemInfo?.windowHeight ?? h;
        this._bannerAd.style.top  = currentH - res.height;
        this._bannerAd.style.left = (w - res.width) / 2;
      });

      this._bannerAd.onError((err: any) => {
        console.warn('[AdManager] Banner error:', err);
        // Do NOT re-throw — banner failure must never affect gameplay
        this._bannerAd = null;
        this._bannerVisible = false;
      });

      this._bannerAd.show().catch(() => {
        this._bannerAd   = null;
        this._bannerVisible = false;
      });

      this._bannerVisible = true;
    } catch (e) {
      console.warn('[AdManager] createBannerAd failed:', e);
    }
  }

  /** Hide the banner without destroying the ad object (cheaper than destroy+recreate). */
  hideBanner(): void {
    if (!this._bannerAd || !this._bannerVisible) return;
    try {
      this._bannerAd.hide();
      this._bannerVisible = false;
    } catch { /* ignore */ }
  }

  /**
   * Destroy the banner ad object and release wx memory.
   * Must be called in onDestroy of every scene that showed a banner.
   */
  destroyBanner(): void {
    if (!this._bannerAd) return;
    try {
      this._bannerAd.destroy();
    } catch { /* ignore */ }
    this._bannerAd    = null;
    this._bannerVisible = false;
  }

  // ---------------------------------------------------------------------------
  // Interstitial — Public API
  // ---------------------------------------------------------------------------

  /**
   * Whether an interstitial ad is loaded and ready to display.
   * Always false when FLAG_INTERSTITIAL_ADS = false (V1 mode).
   */
  get isInterstitialReady(): boolean { return FLAG_INTERSTITIAL_ADS && this._interstitialReady; }

  /**
   * Show the interstitial ad.
   * Resolves when the player closes the ad (or immediately if unavailable).
   *
   * IMPORTANT (WeChat review): only show at a natural game break — never
   * during gameplay or on app launch.  AdPlacementManager.showInterstitialIfDue()
   * enforces the every-N-rounds gate.
   */
  showInterstitialAd(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this._isWxEnv || !this._interstitialAd || !this._interstitialReady) {
        resolve();
        return;
      }

      this._interstitialReady   = false;
      this._interstitialResolve = resolve;

      AnalyticsService.instance?.track('ad_shown', { type: 'interstitial' });

      this._interstitialAd.show().catch((err: any) => {
        console.warn('[AdManager] Interstitial show failed:', err);
        this._interstitialResolve?.();
        this._interstitialResolve = null;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Rewarded video — Private
  // ---------------------------------------------------------------------------

  private _initRewardedAd(): void {
    if (!this._isWxEnv || !FLAG_ADS_ENABLED || this._adState === AdState.LOADING) return;

    try {
      this._rewardedAd = wx.createRewardedVideoAd({
        adUnitId: REWARDED_VIDEO_AD_UNIT_ID,
      });
    } catch (e) {
      console.warn('[AdManager] createRewardedVideoAd failed:', e);
      this._enterCooldown();
      return;
    }

    // Register callbacks once on the persistent ad object
    this._rewardedAd.onLoad(() => {
      this._adState = AdState.READY;
      console.log('[AdManager] Rewarded ad loaded and ready.');
    });

    this._rewardedAd.onError((err: any) => {
      console.warn('[AdManager] Rewarded ad error:', err);
      // If an error fires while showing, resolve the pending promise
      if (this._adState === AdState.SHOWING) {
        this._resolvePending(AdRewardResult.UNAVAILABLE, 'error');
      }
      this._enterCooldown();
    });

    // -----------------------------------------------------------------------
    // onClose: the critical WeChat review checkpoint.
    // res.isEnded MUST be checked — granting reward when isEnded === false
    // will cause your app to fail review.
    // -----------------------------------------------------------------------
    this._rewardedAd.onClose((res: { isEnded: boolean }) => {
      if (res && res.isEnded === true) {
        this._resolvePending(AdRewardResult.GRANTED, 'watched_full');
      } else {
        // User swiped away / closed early — no reward per WeChat policy
        this._resolvePending(AdRewardResult.SKIPPED, 'closed_early');
      }
      // Reload for the next show
      this._adState = AdState.UNLOADED;
      this._loadRewardedAd();
    });

    this._loadRewardedAd();
  }

  private _loadRewardedAd(): void {
    if (!this._rewardedAd) return;
    this._adState = AdState.LOADING;
    this._rewardedAd.load().catch((err: any) => {
      console.warn('[AdManager] rewardedAd.load() rejected:', err);
      this._enterCooldown();
    });
  }

  private _resolvePending(result: AdRewardResult, source: string): void {
    if (this._adState === AdState.SHOWING) {
      this._adState = AdState.UNLOADED;
    }

    const resolver = this._pendingResolve;
    this._pendingResolve = null;

    // Guard: component was destroyed while the ad was showing (forced scene unload).
    // Skip EventBus emissions to prevent phantom events on a dead component.
    if (this._destroyed) {
      resolver?.(result);
      return;
    }

    if (result === AdRewardResult.GRANTED) {
      EventBus.emit(GameEvents.AD_REWARD_GRANTED, { source });
      AnalyticsService.instance?.track('ad_reward_granted', { source });
    } else if (result === AdRewardResult.SKIPPED) {
      EventBus.emit(GameEvents.AD_REWARD_DENIED, { reason: 'skipped' });
      AnalyticsService.instance?.track('ad_reward_denied', { source, reason: 'skipped' });
    } else {
      EventBus.emit(GameEvents.AD_REWARD_DENIED, { reason: 'failed' });
      AnalyticsService.instance?.track('ad_reward_denied', { source, reason: 'failed' });
    }

    resolver?.(result);
  }

  private _enterCooldown(): void {
    this._adState       = AdState.COOLING;
    this._cooldownTimer = ERROR_COOLDOWN_S;
  }

  private _destroyRewardedAd(): void {
    if (!this._rewardedAd) return;
    // wx.RewardedVideoAd does not have a destroy() method; just null the reference
    // so callbacks are no longer reachable
    this._rewardedAd = null;
    this._adState    = AdState.UNLOADED;
    // Resolve any pending show promise so callers don't hang
    if (this._pendingResolve) {
      this._pendingResolve(AdRewardResult.UNAVAILABLE);
      this._pendingResolve = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Interstitial — Private
  // ---------------------------------------------------------------------------

  private _initInterstitialAd(): void {
    if (!this._isWxEnv || !INTERSTITIAL_AD_UNIT_ID || this._interstitialAd) return;

    try {
      this._interstitialAd = wx.createInterstitialAd({ adUnitId: INTERSTITIAL_AD_UNIT_ID });

      this._interstitialAd.onLoad(() => {
        this._interstitialReady = true;
        console.log('[AdManager] Interstitial ad loaded and ready.');
      });

      this._interstitialAd.onError((err: any) => {
        console.warn('[AdManager] Interstitial error:', err);
        this._interstitialReady = false;
        // Resolve any waiting caller so the game is never blocked
        this._interstitialResolve?.();
        this._interstitialResolve = null;
        // Retry load after a short delay
        this.scheduleOnce(() => this._interstitialAd?.load?.(), 30);
      });

      this._interstitialAd.onClose(() => {
        this._interstitialReady = false;
        // Notify awaiting caller that the ad has been dismissed
        this._interstitialResolve?.();
        this._interstitialResolve = null;
        // Pre-load for the next round
        this._interstitialAd?.load?.();
      });

      this._interstitialAd.load();
    } catch (e) {
      console.warn('[AdManager] createInterstitialAd failed:', e);
    }
  }

  private _destroyInterstitialAd(): void {
    // Resolve any pending promise so callers don't hang on scene unload
    this._interstitialResolve?.();
    this._interstitialResolve = null;
    this._interstitialAd      = null;
    this._interstitialReady   = false;
  }
}
