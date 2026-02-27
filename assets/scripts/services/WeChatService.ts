import { _decorator, Component, sys } from 'cc';
import { IWeChatAdapter, IUserInfoResult, IShareOptions } from '../interfaces/IWeChatAdapter';

const { ccclass } = _decorator;

// WeChat Mini Game runtime injects `wx` into the global scope.
// Declare it loosely-typed so TypeScript does not complain in an editor build.
declare const wx: any;

/**
 * WeChatService — single boundary between game logic and the wx API.
 *
 * Design (adapter pattern):
 *  - All wx calls are funnelled through this class.
 *  - When running in Cocos Creator's preview (non-wx env) every method
 *    falls back to safe no-ops or sys.localStorage so the game runs
 *    in desktop mode without modification.
 *  - Inject a mock implementation of IWeChatAdapter during unit tests.
 */
@ccclass('WeChatService')
export class WeChatService extends Component implements IWeChatAdapter {
  private static _instance: WeChatService | null = null;
  private _isWxEnv: boolean = false;

  static get instance(): WeChatService | null { return WeChatService._instance; }

  onLoad(): void {
    WeChatService._instance = this;
    this._isWxEnv = typeof wx !== 'undefined';
  }

  onDestroy(): void {
    if (WeChatService._instance === this) WeChatService._instance = null;
  }

  // ---------- User ----------

  getUserInfo(): Promise<IUserInfoResult> {
    if (!this._isWxEnv) {
      return Promise.resolve({
        nickName: 'Player', avatarUrl: '', gender: 0,
        city: '', province: '', country: '',
      });
    }
    return new Promise((resolve, reject) => {
      wx.getUserProfile({
        desc: '用于显示您的游戏昵称',
        success: (res: any) => resolve(res.userInfo as IUserInfoResult),
        fail:    (err: any) => reject(err),
      });
    });
  }

  // ---------- Social ----------

  shareAppMessage(options: IShareOptions): void {
    if (!this._isWxEnv) return;
    wx.shareAppMessage({
      title:    options.title,
      imageUrl: options.imageUrl,
      query:    options.query ?? '',
    });
  }

  // ---------- Ads ----------

  showInterstitialAd(adUnitId: string): Promise<void> {
    if (!this._isWxEnv) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        const ad = wx.createInterstitialAd({ adUnitId });
        ad.onLoad(() => ad.show().finally(resolve));
        ad.onError(() => resolve());
        ad.load();
      } catch { resolve(); }
    });
  }

  createBannerAd(adUnitId: string, style: object): void {
    console.warn('[WeChatService] createBannerAd is deprecated — use AdManager.showBanner() instead.');
    if (!this._isWxEnv) return;
    try {
      const ad = wx.createBannerAd({ adUnitId, style });
      ad.show();
    } catch { /* silently ignore */ }
  }

  destroyBannerAd(): void {
    console.warn('[WeChatService] destroyBannerAd is a no-op — use AdManager.destroyBanner() instead.');
    // Banner lifecycle is managed by AdManager; kept here for interface completeness.
  }

  // ---------- Storage ----------

  saveToStorage(key: string, data: unknown): void {
    const value = JSON.stringify(data);
    try {
      if (this._isWxEnv) wx.setStorageSync(key, value);
      else                sys.localStorage.setItem(key, value);
    } catch (e) {
      console.warn('[WeChatService] saveToStorage error:', e);
    }
  }

  loadFromStorage<T>(key: string): T | null {
    try {
      const raw = this._isWxEnv
        ? wx.getStorageSync(key)
        : sys.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  removeFromStorage(key: string): void {
    try {
      if (this._isWxEnv) wx.removeStorageSync(key);
      else                sys.localStorage.removeItem(key);
    } catch { /* silently ignore */ }
  }

  // ---------- Haptics ----------

  vibrateShort(): void {
    if (this._isWxEnv) try { wx.vibrateShort({ type: 'medium' }); } catch { }
  }

  vibrateLong(): void {
    if (this._isWxEnv) try { wx.vibrateLong(); } catch { }
  }

  // ---------- Analytics ----------

  reportEvent(eventId: string, data: Record<string, string | number>): void {
    if (!this._isWxEnv) return;
    try { wx.reportEvent(eventId, data); } catch { }
  }

  // ---------- System ----------

  getSystemInfo(): Promise<Record<string, unknown>> {
    if (!this._isWxEnv) return Promise.resolve({ platform: 'devtools' });
    return new Promise((resolve) => {
      wx.getSystemInfo({ success: resolve, fail: () => resolve({}) });
    });
  }
}
