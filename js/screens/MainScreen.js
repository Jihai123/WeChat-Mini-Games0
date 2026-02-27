'use strict';
// MainScreen.js — main menu: title, high score, daily reward, play button

const Storage    = require('../Storage');
const DailyReward = require('../DailyReward');
const AdService  = require('../AdService');
const { roundRect, drawButton, drawGradientBg, hitTest } = require('../utils');

const KEY_HIGH_SCORE  = 'wg_high_score';
const KEY_PLAYER_DATA = 'wg_player_data';

// Static star positions so they don't flicker between frames
const STARS = Array.from({ length: 40 }, (_, i) => ({
  x: ((i * 173.7 + 11) % 1) , // will be scaled in draw()
  y: ((i * 97.3  + 43) % 1) ,
  r: (i % 4 === 0) ? 2 : 1,
  xi: (i * 173.7 + 11),
  yi: (i * 97.3  + 43),
}));

class MainScreen {
  constructor(game) {
    this.game = game;
    this.W    = game.W;
    this.H    = game.H;

    this._dailyState   = null;
    this._toast        = '';
    this._toastTimer   = 0;
    this._claimedStreak = 0;

    // Touch handler references (must be stored to unregister correctly)
    this._onTouchEnd = this._onTouchEnd.bind(this);
  }

  init() {
    this._dailyState = DailyReward.getState();
    AdService.showBanner(this.game.sysInfo);
    wx.onTouchEnd(this._onTouchEnd);
  }

  destroy() {
    wx.offTouchEnd(this._onTouchEnd);
  }

  update(dt) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this._toast = '';
    }
    // Refresh daily state every frame (msUntilReset countdown)
    if (this._toastTimer <= 0) {
      this._dailyState = DailyReward.getState();
    }
  }

  // ---------------------------------------------------------------------------
  // Touch
  // ---------------------------------------------------------------------------

  _onTouchEnd(e) {
    const t  = e.changedTouches[0];
    const tx = t.clientX;
    const ty = t.clientY;
    const W  = this.W;
    const H  = this.H;

    // ── Play button ──────────────────────────────────────────────────
    const playW = 220, playH = 64, playY = H * 0.56;
    if (hitTest(tx, ty, (W - playW) / 2, playY, playW, playH)) {
      this.game.showGame();
      return;
    }

    // ── Daily reward button ──────────────────────────────────────────
    if (this._dailyState.canClaim) {
      const drW = 220, drH = 54, drY = H * 0.73;
      if (hitTest(tx, ty, (W - drW) / 2, drY, drW, drH)) {
        const streak = DailyReward.claim();
        if (streak !== false) {
          this.game.pendingBonusSpawns += DailyReward.spawnsPerClaim;
          this._claimedStreak = streak;
          this._toast = `签到成功！连续 ${streak} 天  下局 +${DailyReward.spawnsPerClaim} 道具`;
          this._toastTimer = 3.0;
          this._dailyState = DailyReward.getState();
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  draw(ctx, W, H) {
    // Background
    drawGradientBg(ctx, W, H, '#0f0c29', '#24243e');

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const s of STARS) {
      ctx.beginPath();
      ctx.arc((s.xi % W), (s.yi % (H * 0.55)), s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Title ────────────────────────────────────────────────────────
    const titleSize = Math.floor(H * 0.063);
    ctx.fillStyle    = '#FFD700';
    ctx.font         = `bold ${titleSize}px Arial`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = '#FFD700';
    ctx.shadowBlur   = 22;
    ctx.fillText('黄金时雨', W / 2, H * 0.11);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font      = `${Math.floor(H * 0.027)}px Arial`;
    ctx.fillText('接住金币，躲开炸弹！', W / 2, H * 0.175);

    // ── Stats ────────────────────────────────────────────────────────
    const highScore = Storage.get(KEY_HIGH_SCORE, 0);
    const pd        = Storage.get(KEY_PLAYER_DATA, null);
    const games     = pd ? (pd.totalGamesPlayed || 0) : 0;

    if (highScore > 0) {
      ctx.fillStyle = '#FFFFFF';
      ctx.font      = `bold ${Math.floor(H * 0.032)}px Arial`;
      ctx.fillText(`最高分  ${highScore.toLocaleString()}`, W / 2, H * 0.265);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font      = `${Math.floor(H * 0.022)}px Arial`;
      ctx.fillText(`已玩 ${games} 局`, W / 2, H * 0.313);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font      = `${Math.floor(H * 0.028)}px Arial`;
      ctx.fillText('还没玩过？来挑战吧！', W / 2, H * 0.28);
    }

    // ── Daily reward card ────────────────────────────────────────────
    this._drawDailyCard(ctx, W, H);

    // ── Play button ──────────────────────────────────────────────────
    drawButton(ctx, W, H * 0.56, 220, 64, '开始游戏', '#00C853', '#FFFFFF', Math.floor(H * 0.034));

    // ── Daily claim button (shown only when available) ───────────────
    if (this._dailyState.canClaim) {
      drawButton(ctx, W, H * 0.73, 220, 54, '领取每日奖励', '#FF6F00', '#FFFFFF', Math.floor(H * 0.026));
    }

    // ── Toast ────────────────────────────────────────────────────────
    if (this._toast && this._toastTimer > 0) {
      ctx.fillStyle    = '#00E676';
      ctx.font         = `bold ${Math.floor(H * 0.026)}px Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._toast, W / 2, H * 0.685);
    }

    // ── Version ──────────────────────────────────────────────────────
    ctx.fillStyle    = 'rgba(255,255,255,0.2)';
    ctx.font         = `${Math.floor(H * 0.018)}px Arial`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('v1.0.0', W / 2, H - 16);
  }

  _drawDailyCard(ctx, W, H) {
    const cardW = 280, cardH = 74, cardX = (W - cardW) / 2, cardY = H * 0.38;

    // Card background
    ctx.fillStyle   = 'rgba(255,255,255,0.07)';
    ctx.strokeStyle = 'rgba(255,215,0,0.28)';
    ctx.lineWidth   = 1;
    roundRect(ctx, cardX, cardY, cardW, cardH, 14);
    ctx.fill();
    ctx.stroke();

    // Title
    ctx.fillStyle    = '#FFD700';
    ctx.font         = `bold ${Math.floor(H * 0.026)}px Arial`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('每日签到', W / 2, cardY + 22);

    // Subtitle
    const state = this._dailyState;
    ctx.font = `${Math.floor(H * 0.022)}px Arial`;
    if (state.streak > 0 && !state.canClaim) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`连续签到 ${state.streak} 天`, W / 2, cardY + 52);
    } else if (state.canClaim) {
      ctx.fillStyle = '#69F0AE';
      ctx.fillText('今日奖励待领取！', W / 2, cardY + 52);
    } else {
      const h = Math.floor(state.msUntilReset / 3_600_000);
      const m = Math.floor((state.msUntilReset % 3_600_000) / 60_000);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(`${h} 小时 ${m} 分后重置`, W / 2, cardY + 52);
    }
  }
}

module.exports = MainScreen;
