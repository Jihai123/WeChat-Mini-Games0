import { _decorator, Component, sys } from 'cc';
import { EventBus, GameEvents } from '../utils/EventBus';
import { AnalyticsService } from './AnalyticsService';
import { WeChatService } from './WeChatService';

const { ccclass, property } = _decorator;

// ---------------------------------------------------------------------------
// Ad unit IDs — replace with your actual WeChat MP platform unit IDs.
// Format: 'adunit-xxxxxxxxxxxxxxxxxx'
// ---------------------------------------------------------------------------
const REWARDED_VIDEO_AD_UNIT_ID = 'adunit-000000000000001';
const BANNER_AD_UNIT_ID         = 'adunit-000000000000002';

// After an ad error, wait this many seconds before allowing another load attempt.
const ERROR_COOLDOWN_S = 30;

// WeChat injects wx into the global scope in Mini Game runtime.
declare const wx: any;

// ---------------------------------------------------------------------------
// Public result type for showRewardedAd()
// ---------------------------------------------------------------------------

/** Result returned by showRewardedAd(). Never throws — always resolves. */
export const enum AdRewardResult {
  /** User watched the complete video. Grant the reward. */
  GRANTED     = 'GRANTED',
  /** User closed the video before it finished. Do NOT grant reward. WeChat review requires this. */
  SKIPPED     = 'SKIPPED',
  /** Ad was not available (load failure, network, inventory). Graceful fallback — still let player play. */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Internal loading state machine for the rewarded video ad instance. */
const enum AdState {
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

  // ---------------------------------------------------------------------------
  // Banner internals
  // ---------------------------------------------------------------------------
  private _bannerAd:       any       = null; // wx.BannerAd instance
  private _bannerVisible:  boolean   = false;
  private _systemInfo:     { windowWidth: number; windowHeight: number } | null = null;

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
    }
  }

  onDestroy(): void {
    if (AdManager._instance === this) AdManager._instance = null;
    this._destroyRewardedAd();
    this.destroyBanner();
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
      // Editor / devtools fallback — simulate a full watch for testing
      console.log(`[AdManager] Dev env: simulating rewarded ad (${source})`);
      return AdRewardResult.GRANTED;
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
    if (!this._isWxEnv) return;

    // Re-show existing banner if it was hidden
    if (this._bannerAd) {
      if (!this._bannerVisible) {
        this._bannerAd.show().catch(() => { /* silently ignore */ });
        this._bannerVisible = true;
      }
      return;
    }

    const w = this._systemInfo?.windowWidth ?? 320;
    const h = this._systemInfo?.windowHeight ?? 568;

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
  // Rewarded video — Private
  // ---------------------------------------------------------------------------

  private _initRewardedAd(): void {
    if (!this._isWxEnv || this._adState === AdState.LOADING) return;

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

    const resolver = this._pendingResolve;
    this._pendingResolve = null;
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
}
