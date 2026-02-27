'use strict';
// ResultScreen.js — post-round result: score display, stats, retry / home

const AdService  = require('../AdService');
const DailyReward = require('../DailyReward');
const { roundRect, drawButton, drawGradientBg, hitTest } = require('../utils');

// Duration of the score count-up animation (seconds)
const COUNT_UP_S = 1.4;

class ResultScreen {
  constructor(game, data) {
    this.game = game;
    this.W    = game.W;
    this.H    = game.H;

    // Session data from GameScreen
    this.score      = data.score      || 0;
    this.highScore  = data.highScore  || 0;
    this.isNewHigh  = data.isNewHigh  || false;
    this.catches    = data.catches    || 0;
    this.maxCombo   = data.maxCombo   || 0;

    // Animated score display
    this._displayScore  = 0;
    this._countUpTimer  = 0;
    this._countUpDone   = false;

    // Daily reward state (show claim button if not yet claimed today)
    this._dailyState    = null;

    // Ad state
    this._adWaiting     = false;
    this._adMsg         = '';

    // Toast
    this._toast         = '';
    this._toastTimer    = 0;

    // Pulse animation for new-high-score
    this._pulseTimer    = 0;

    // Touch
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

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(dt) {
    // Score count-up
    if (!this._countUpDone) {
      this._countUpTimer += dt;
      const t     = Math.min(this._countUpTimer / COUNT_UP_S, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this._displayScore = Math.floor(eased * this.score);
      if (t >= 1) {
        this._countUpDone  = true;
        this._displayScore = this.score;
      }
    }

    // New-high-score pulse
    if (this.isNewHigh && this._countUpDone) {
      this._pulseTimer += dt;
    }

    // Toast
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this._toast = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Touch
  // ---------------------------------------------------------------------------

  _onTouchEnd(e) {
    if (this._adWaiting) return; // block while ad is loading

    const t  = e.changedTouches[0];
    const tx = t.clientX;
    const ty = t.clientY;
    const W  = this.W;
    const H  = this.H;

    const btnW = 200, btnH = 58;

    // ── Retry (play again) ────────────────────────────────────────────
    const retryY = H * 0.73;
    if (hitTest(tx, ty, (W - btnW) / 2, retryY, btnW, btnH)) {
      this.game.showGame();
      return;
    }

    // ── Home ─────────────────────────────────────────────────────────
    const homeY = H * 0.82;
    if (hitTest(tx, ty, (W - btnW) / 2, homeY, btnW, btnH)) {
      this.game.showMain();
      return;
    }

    // ── Watch Ad to Retry ─────────────────────────────────────────────
    const adRetryY = H * 0.64;
    if (hitTest(tx, ty, (W - btnW) / 2, adRetryY, btnW, btnH)) {
      if (!AdService.rewardedReady) {
        this._showToast('广告暂不可用，请直接重试');
        return;
      }
      this._adWaiting = true;
      this._adMsg     = '广告加载中…';
      AdService.showRewarded((granted) => {
        this._adWaiting = false;
        this._adMsg     = '';
        if (granted) {
          // Reward: 5 bonus spawns in the next round
          this.game.pendingBonusSpawns += 5;
          this.game.showGame();
        } else {
          this._showToast('看完广告才能领取奖励哦~');
        }
      });
      return;
    }

    // ── Daily reward claim ────────────────────────────────────────────
    if (this._dailyState && this._dailyState.canClaim) {
      const drY = H * 0.535;
      if (hitTest(tx, ty, (W - btnW) / 2, drY, btnW, 50)) {
        const streak = DailyReward.claim();
        if (streak !== false) {
          this.game.pendingBonusSpawns += DailyReward.spawnsPerClaim;
          this._showToast(`签到成功！连续 ${streak} 天  下局 +${DailyReward.spawnsPerClaim} 道具`);
          this._dailyState = DailyReward.getState();
        }
      }
    }
  }

  _showToast(msg) {
    this._toast      = msg;
    this._toastTimer = 2.8;
  }

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  draw(ctx, W, H) {
    // Background
    drawGradientBg(ctx, W, H, '#0f0c29', '#24243e');

    // ── Result card ───────────────────────────────────────────────────
    const cardW = Math.min(W - 40, 320);
    const cardX = (W - cardW) / 2;
    const cardY = H * 0.06;
    const cardH = H * 0.44;

    ctx.fillStyle   = 'rgba(255,255,255,0.07)';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1;
    roundRect(ctx, cardX, cardY, cardW, cardH, 20);
    ctx.fill();
    ctx.stroke();

    // ── Round over label ──────────────────────────────────────────────
    ctx.fillStyle    = 'rgba(255,255,255,0.5)';
    ctx.font         = `${Math.floor(H * 0.025)}px Arial`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('本局结算', W / 2, cardY + 26);

    // ── Animated score ────────────────────────────────────────────────
    const scoreSize  = Math.floor(H * 0.085);
    const pulse      = this.isNewHigh && this._countUpDone
      ? 1 + 0.04 * Math.sin(this._pulseTimer * 5)
      : 1;

    ctx.save();
    ctx.translate(W / 2, cardY + cardH * 0.33);
    ctx.scale(pulse, pulse);
    ctx.fillStyle    = this.isNewHigh ? '#FFD700' : '#FFFFFF';
    ctx.font         = `bold ${scoreSize}px Arial`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    if (this.isNewHigh) {
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur  = 24;
    }
    ctx.fillText(this._displayScore.toLocaleString(), 0, 0);
    ctx.shadowBlur   = 0;
    ctx.restore();

    // New high-score badge
    if (this.isNewHigh && this._countUpDone) {
      ctx.fillStyle    = '#FFD700';
      ctx.font         = `bold ${Math.floor(H * 0.026)}px Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('新纪录！', W / 2, cardY + cardH * 0.56);
    } else {
      ctx.fillStyle    = 'rgba(255,255,255,0.45)';
      ctx.font         = `${Math.floor(H * 0.022)}px Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`最高分  ${this.highScore.toLocaleString()}`, W / 2, cardY + cardH * 0.56);
    }

    // ── Stats row ─────────────────────────────────────────────────────
    const statY = cardY + cardH * 0.76;
    ctx.fillStyle    = 'rgba(255,255,255,0.6)';
    ctx.font         = `${Math.floor(H * 0.022)}px Arial`;
    ctx.textBaseline = 'middle';

    ctx.textAlign = 'left';
    ctx.fillText(`接住  ${this.catches} 个金币`, cardX + 24, statY);
    ctx.textAlign = 'right';
    ctx.fillText(
      this.maxCombo >= 2 ? `最高 x${this.maxCombo} combo` : '暂无连击',
      cardX + cardW - 24, statY
    );

    // ── Daily reward row (if available) ──────────────────────────────
    if (this._dailyState && this._dailyState.canClaim) {
      drawButton(ctx, W, H * 0.535, 200, 50, '领取每日奖励', '#FF6F00', '#FFFFFF', Math.floor(H * 0.024));
    }

    // ── Ad retry button ────────────────────────────────────────────────
    if (this._adWaiting) {
      ctx.fillStyle    = 'rgba(255,255,255,0.5)';
      ctx.font         = `${Math.floor(H * 0.024)}px Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._adMsg, W / 2, H * 0.64 + 25);
    } else {
      const adLabel = AdService.rewardedReady
        ? '看广告 下局 +5 金币'
        : '广告暂不可用';
      const adColor = AdService.rewardedReady ? '#7B61FF' : '#555577';
      drawButton(ctx, W, H * 0.64, 200, 58, adLabel, adColor, '#FFFFFF', Math.floor(H * 0.024));
    }

    // ── Retry & Home buttons ──────────────────────────────────────────
    drawButton(ctx, W, H * 0.73, 200, 58, '再玩一局', '#00C853', '#FFFFFF', Math.floor(H * 0.028));
    drawButton(ctx, W, H * 0.82, 200, 58, '返回主页', 'rgba(255,255,255,0.12)', '#FFFFFF', Math.floor(H * 0.028));

    // ── Toast ─────────────────────────────────────────────────────────
    if (this._toast && this._toastTimer > 0) {
      ctx.fillStyle    = '#69F0AE';
      ctx.font         = `bold ${Math.floor(H * 0.024)}px Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._toast, W / 2, H * 0.497);
    }
  }
}

module.exports = ResultScreen;
