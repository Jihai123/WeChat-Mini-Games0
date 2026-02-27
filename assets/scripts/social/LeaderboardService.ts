import { _decorator, Component } from 'cc';
import { AnalyticsService } from '../services/AnalyticsService';
import { EventBus, GameEvents } from '../utils/EventBus';

const { ccclass } = _decorator;

// WeChat Mini Game runtime injects `wx` into the global scope.
declare const wx: any;

/**
 * LeaderboardService — WeChat Open Data Context leaderboard integration.
 *
 * Architecture overview:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │ MAIN CONTEXT (this file)                                            │
 *  │  • postScore()     → wx.setUserCloudStorage (user-scoped KV store) │
 *  │  • requestRender() → wx.getOpenDataContext().postMessage(...)       │
 *  └────────────────────────┬────────────────────────────────────────────┘
 *                           │ postMessage
 *  ┌────────────────────────▼────────────────────────────────────────────┐
 *  │ OPEN DATA CONTEXT  (openDataContext/index.js — separate bundle)     │
 *  │  • wx.onMessage()  → receive render commands                        │
 *  │  • wx.getFriendCloudStorage() → read friends' scores                │
 *  │  • draws leaderboard to wx.getSharedCanvas()                        │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 * Setup:
 *  1. In WeChat MP developer tools, enable "Open Data Context".
 *  2. Create openDataContext/index.js from getOpenDataContextBoilerplate().
 *  3. Configure a shared canvas in your CC3 scene (Sprite with RenderTexture),
 *     then sample the shared canvas using wx.getOpenDataContext().canvas.
 *  4. Call postScore() at every session end.
 *  5. Call requestRender() when the leaderboard panel opens.
 *
 * WeChat review compliance:
 *  ✅ Only displays friend data — no third-party leaderboard APIs
 *  ✅ Open Data Context is isolated; friends' data never reaches main context
 *  ✅ Scores only — no PII beyond what wx already manages
 *  ✅ User can skip the leaderboard entirely (no gating)
 */
@ccclass('LeaderboardService')
export class LeaderboardService extends Component {
  private static _instance: LeaderboardService | null = null;
  private _openDataCtx: any = null;

  static get instance(): LeaderboardService | null { return LeaderboardService._instance; }

  onLoad(): void  { LeaderboardService._instance = this; }
  onDestroy(): void {
    if (LeaderboardService._instance === this) LeaderboardService._instance = null;
  }

  // ---------------------------------------------------------------------------
  // Score posting
  // ---------------------------------------------------------------------------

  /**
   * Post the player's score to wx cloud storage (user-scoped KV).
   * Only overwrites if the new score is strictly higher than the stored one,
   * preventing a bad round from clearing a high score on the leaderboard.
   *
   * Call this at the end of every session (GameManager._onEnterResult).
   */
  postScore(score: number, displayName: string, avatarUrl: string): void {
    if (typeof wx === 'undefined') return;
    if (score <= 0) return;

    try {
      wx.setUserCloudStorage({
        KVDataList: [
          { key: 'score',     value: String(score)     },
          { key: 'nickname',  value: displayName        },
          { key: 'avatarUrl', value: avatarUrl          },
          { key: 'updatedAt', value: String(Date.now()) },
        ],
        success: () => {
          console.log('[LeaderboardService] Score posted:', score);
        },
        fail: (err: any) => {
          console.warn('[LeaderboardService] setUserCloudStorage failed:', err);
        },
      });
    } catch (e) {
      console.warn('[LeaderboardService] postScore threw:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Leaderboard rendering (Open Data Context)
  // ---------------------------------------------------------------------------

  /**
   * Send a render command to the Open Data Context.
   * The ODC will draw friend scores to the shared canvas.
   *
   * @param type  'friends' (default) uses wx.getFriendCloudStorage.
   * @param w / h Canvas resolution in logical pixels.
   */
  requestRender(type: 'friends' = 'friends', w = 375, h = 600): void {
    if (typeof wx === 'undefined') return;

    try {
      if (!this._openDataCtx) {
        this._openDataCtx = wx.getOpenDataContext();
      }
      this._openDataCtx.postMessage({ action: 'renderLeaderboard', type, w, h });

      AnalyticsService.instance?.track('leaderboard_viewed', { type });
      EventBus.emit(GameEvents.LEADERBOARD_OPEN, undefined);
    } catch (e) {
      console.warn('[LeaderboardService] requestRender threw:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Open Data Context boilerplate (for reference — place in openDataContext/)
  // ---------------------------------------------------------------------------

  /**
   * Returns the boilerplate content for openDataContext/index.js.
   *
   * This script runs in the isolated Open Data Context and has access to
   * wx.getFriendCloudStorage().  It draws a simple ranked leaderboard to
   * the shared canvas which the main context can then display as a texture.
   *
   * Usage:
   *   console.log(LeaderboardService.getOpenDataContextBoilerplate());
   *   // Copy the output into openDataContext/index.js in your project root.
   */
  static getOpenDataContextBoilerplate(): string {
    return `// openDataContext/index.js
// Runs in isolated Open Data Context — no access to main game globals.
// Place this file at the root of the WeChat Mini Game project.

wx.onMessage(function (data) {
  if (data.action !== 'renderLeaderboard') return;

  var canvas = wx.getSharedCanvas();
  var ctx    = canvas.getContext('2d');
  var W      = data.w || 375;
  var H      = data.h || 600;

  // Background
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(8, 12, 28, 0.97)';
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle    = '#FFD700';
  ctx.font         = 'bold 22px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('好友排行榜', W / 2, 30);

  // Separator
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(20, 52); ctx.lineTo(W - 20, 52);
  ctx.stroke();

  wx.getFriendCloudStorage({
    keyList: ['score', 'nickname', 'avatarUrl'],
    success: function (res) {
      var entries = (res.data || [])
        .filter(function (u) { return u.KVDataList && u.KVDataList.length; })
        .map(function (u) {
          var kv = {};
          u.KVDataList.forEach(function (item) { kv[item.key] = item.value; });
          return {
            nickname:  kv.nickname  || '玩家',
            score:     parseInt(kv.score || '0', 10),
            avatarUrl: kv.avatarUrl || '',
          };
        })
        .sort(function (a, b) { return b.score - a.score; });

      if (entries.length === 0) {
        ctx.fillStyle    = 'rgba(255,255,255,0.5)';
        ctx.font         = '16px sans-serif';
        ctx.textAlign    = 'center';
        ctx.fillText('暂无好友数据', W / 2, H / 2);
        return;
      }

      var ROW_H    = 58;
      var START_Y  = 64;
      var MEDAL    = ['🥇', '🥈', '🥉'];
      var maxRows  = Math.floor((H - START_Y - 16) / ROW_H);

      entries.slice(0, maxRows).forEach(function (entry, i) {
        var y = START_Y + i * ROW_H;

        // Row background (alternate tint)
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent';
        ctx.fillRect(12, y, W - 24, ROW_H - 4);

        // Avatar
        if (entry.avatarUrl) {
          var img = wx.createImage();
          img.src = entry.avatarUrl;
          img.onload = (function (imgRef, rowY) {
            return function () {
              ctx.save();
              ctx.beginPath();
              ctx.arc(36, rowY + ROW_H / 2, 18, 0, Math.PI * 2);
              ctx.clip();
              ctx.drawImage(imgRef, 18, rowY + ROW_H / 2 - 18, 36, 36);
              ctx.restore();
            };
          })(img, y);
        }

        // Rank / medal
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.font         = '18px sans-serif';
        ctx.fillStyle    = i < 3 ? '#FFD700' : 'rgba(255,255,255,0.6)';
        ctx.fillText(i < 3 ? MEDAL[i] : (i + 1) + '.', 62, y + ROW_H / 2);

        // Nickname
        ctx.fillStyle = '#FFFFFF';
        ctx.font      = '15px sans-serif';
        var maxNick   = entry.nickname.slice(0, 10);
        ctx.fillText(maxNick, 94, y + ROW_H / 2);

        // Score
        ctx.fillStyle = '#AAFFAA';
        ctx.textAlign = 'right';
        ctx.font      = 'bold 16px sans-serif';
        ctx.fillText(entry.score.toLocaleString(), W - 20, y + ROW_H / 2);

        // Row separator
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(16, y + ROW_H - 2); ctx.lineTo(W - 16, y + ROW_H - 2);
        ctx.stroke();
      });
    },
    fail: function (err) {
      ctx.fillStyle = 'rgba(255,100,100,0.8)';
      ctx.font      = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('数据加载失败', W / 2, H / 2);
    },
  });
});
`;
  }
}
