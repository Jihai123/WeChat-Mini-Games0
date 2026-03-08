'use strict';
// AdService.js — WeChat banner + rewarded video ad lifecycle manager
//
// ⚠️  Fill in real ad unit IDs from WeChat MP → 流量主 → 广告单元 before submission.
//     Leaving them blank makes ads silently unavailable (safe for development).

const AD_UNIT_REWARDED = ''; // wx.RewardedVideoAd unit ID
const AD_UNIT_BANNER   = ''; // wx.BannerAd unit ID

const IS_WX = typeof wx !== 'undefined';

const AdService = {
  _rewardedAd:      null,
  _rewardedReady:   false,
  _rewardedCb:      null,
  _bannerAd:        null,

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  init() {
    if (!IS_WX || !AD_UNIT_REWARDED) return;
    this._loadRewarded();
  },

  // ---------------------------------------------------------------------------
  // Rewarded video
  // ---------------------------------------------------------------------------

  _loadRewarded() {
    if (!IS_WX || !AD_UNIT_REWARDED) return;
    try {
      this._rewardedAd = wx.createRewardedVideoAd({ adUnitId: AD_UNIT_REWARDED });

      this._rewardedAd.onLoad(() => {
        this._rewardedReady = true;
        console.log('[AdService] Rewarded ad loaded.');
      });

      this._rewardedAd.onError((err) => {
        console.warn('[AdService] Rewarded ad error:', err);
        this._rewardedReady = false;
      });

      // onClose fires when user closes the ad (watched or skipped)
      this._rewardedAd.onClose((res) => {
        this._rewardedReady = false;
        // Reload for next show
        setTimeout(() => this._loadRewarded(), 1000);

        const granted = !!(res && res.isEnded === true);
        if (this._rewardedCb) {
          this._rewardedCb(granted);
          this._rewardedCb = null;
        }
      });
    } catch (e) {
      console.warn('[AdService] createRewardedVideoAd failed:', e);
    }
  },

  /**
   * Show the rewarded video.
   * @param {function(boolean):void} callback  called with true if user finished watching
   */
  showRewarded(callback) {
    if (!IS_WX || !this._rewardedReady || !this._rewardedAd) {
      callback && callback(false);
      return;
    }
    this._rewardedCb = callback;
    this._rewardedAd.show().catch((err) => {
      console.warn('[AdService] rewardedAd.show() failed:', err);
      if (this._rewardedCb) {
        this._rewardedCb(false);
        this._rewardedCb = null;
      }
    });
  },

  get rewardedReady() { return this._rewardedReady; },

  // ---------------------------------------------------------------------------
  // Banner
  // ---------------------------------------------------------------------------

  /**
   * Create and display a bottom-anchored banner.
   * @param {{ windowWidth:number, windowHeight:number }} sysInfo
   */
  showBanner(sysInfo) {
    if (!IS_WX || !AD_UNIT_BANNER) return;
    if (this._bannerAd) return; // already shown
    try {
      const W = sysInfo.windowWidth;
      const H = sysInfo.windowHeight;

      this._bannerAd = wx.createBannerAd({
        adUnitId: AD_UNIT_BANNER,
        style: { left: 0, top: H - 100, width: W, height: 100 },
      });

      this._bannerAd.onResize((res) => {
        if (!this._bannerAd) return;
        this._bannerAd.style.top  = H - res.height;
        this._bannerAd.style.left = (W - res.width) / 2;
      });

      this._bannerAd.onError((err) => {
        console.warn('[AdService] Banner error:', err);
        this._bannerAd = null;
      });

      this._bannerAd.show().catch(() => { this._bannerAd = null; });
    } catch (e) {
      console.warn('[AdService] createBannerAd failed:', e);
    }
  },

  destroyBanner() {
    if (!this._bannerAd) return;
    try { this._bannerAd.destroy(); } catch (e) { /* ignore */ }
    this._bannerAd = null;
  },
};

module.exports = AdService;
