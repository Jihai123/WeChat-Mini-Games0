import { _decorator, Component } from 'cc';

const { ccclass } = _decorator;

// WeChat Mini Game runtime injects `wx` into the global scope.
declare const wx: any;

/**
 * PrivacyManager — WeChat 2023 privacy compliance helper.
 *
 * Since 2023-09-15 all Mini Programs MUST obtain explicit user consent before
 * collecting any personal data.  Calling wx.getUserProfile() or similar APIs
 * without prior consent will fail silently or throw, causing automatic rejection.
 *
 * Usage (must be called before any personal data collection):
 *   const granted = await PrivacyManager.ensureConsent();
 *   if (granted) { ... call wx.getUserProfile etc. }
 *
 * Design:
 *  - Consent result is cached for the lifetime of the app session.
 *  - Never throws — always resolves with a boolean.
 *  - Falls back to `true` in non-wx environments (editor / devtools).
 *
 * Reference: https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/
 */
@ccclass('PrivacyManager')
export class PrivacyManager extends Component {
  private static _instance: PrivacyManager | null = null;

  /** Cache: once granted in this session we skip redundant wx API calls. */
  private static _consentGranted: boolean = false;

  static get instance(): PrivacyManager | null { return PrivacyManager._instance; }

  onLoad(): void  { PrivacyManager._instance = this; }
  onDestroy(): void {
    if (PrivacyManager._instance === this) PrivacyManager._instance = null;
  }

  /**
   * Ensure WeChat privacy consent has been obtained.
   *
   *  - Non-wx environment (editor/devtools):   resolves true immediately.
   *  - Consent already granted this session:   resolves true immediately.
   *  - needAuthorization === false:             user already agreed; resolves true.
   *  - needAuthorization === true:              shows wx privacy popup, waits for user.
   *  - Any error (user declined / API issue):   resolves false — caller must handle.
   *
   * @returns true if consent is confirmed, false if denied or unavailable.
   */
  static async ensureConsent(): Promise<boolean> {
    if (PrivacyManager._consentGranted) return true;

    // In Cocos Creator preview or desktop build there is no wx global
    if (typeof wx === 'undefined') {
      PrivacyManager._consentGranted = true;
      return true;
    }

    try {
      const setting: { needAuthorization: boolean; privacyContractName: string } =
        await new Promise((resolve, reject) => {
          wx.getUserPrivacySetting({
            success: resolve,
            fail:    reject,
          });
        });

      if (!setting.needAuthorization) {
        // User already agreed in a previous session
        PrivacyManager._consentGranted = true;
        return true;
      }

      // Show the mandatory WeChat privacy authorization popup
      await new Promise<void>((resolve, reject) => {
        wx.requirePrivacyAuthorize({
          success: () => resolve(),
          fail:    (err: any) => reject(err),
        });
      });

      PrivacyManager._consentGranted = true;
      return true;
    } catch (e) {
      // User declined or wx.getUserPrivacySetting unavailable on this platform version
      console.warn('[PrivacyManager] Privacy consent not granted:', e);
      return false;
    }
  }

  /** Reset the cached consent flag (for testing only — do not call in production). */
  static resetConsent(): void {
    PrivacyManager._consentGranted = false;
  }
}
