'use strict';
// GameScreen.js — 45-second falling-objects catching gameplay

const Storage = require('../Storage');
const { roundRect, drawGradientBg } = require('../utils');

// ── Constants ────────────────────────────────────────────────────────────────

const GAME_DURATION  = 45;   // seconds
const BASKET_W       = 150;
const BASKET_H       = 28;
const COIN_RADIUS    = 18;
const BOMB_RADIUS    = 20;

// Points per coin catch (multiplied by combo, capped at ×5)
const COIN_BASE_PTS  = 10;
// Points lost on bomb catch
const BOMB_PENALTY   = 20;

// Difficulty ramps at these elapsed-seconds thresholds
const TIERS = [
  { start:  0, interval: 1.2, speed: 170, bombChance: 0.00 }, // Easy
  { start: 15, interval: 0.9, speed: 240, bombChance: 0.18 }, // Normal
  { start: 30, interval: 0.65, speed: 320, bombChance: 0.32 }, // Hard
];

const KEY_HIGH_SCORE  = 'wg_high_score';
const KEY_PLAYER_DATA = 'wg_player_data';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTier(elapsed) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (elapsed >= TIERS[i].start) return TIERS[i];
  }
  return TIERS[0];
}

// ── Screen ───────────────────────────────────────────────────────────────────

class GameScreen {
  constructor(game) {
    this.game = game;
    this.W    = game.W;
    this.H    = game.H;

    // Game state
    this.timeLeft   = GAME_DURATION;
    this.score      = 0;
    this.combo      = 0;
    this.maxCombo   = 0;
    this.catches    = 0;

    // Basket (X = left edge)
    this.basketX    = (this.W - BASKET_W) / 2;
    this.basketY    = this.H - 90;

    // Falling objects array: { x, y, radius, speed, isBomb, opacity }
    this.objects    = [];
    this.spawnTimer = 0;

    // Visual effects
    this._bombFlash = 0; // seconds remaining for screen red flash
    this._catchFx   = []; // { x, y, text, life, maxLife }

    // Pre-compute bonus objects from daily reward
    this._bonusObjects = game.pendingBonusSpawns;
    game.pendingBonusSpawns = 0; // consume

    // State machine: 'countdown' → 'playing' → 'done'
    this._phase       = 'countdown';
    this._countdown   = 3; // 3-2-1 before game starts

    // Touch
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove  = this._onTouchMove.bind(this);
  }

  init() {
    wx.onTouchStart(this._onTouchStart);
    wx.onTouchMove(this._onTouchMove);
  }

  destroy() {
    wx.offTouchStart(this._onTouchStart);
    wx.offTouchMove(this._onTouchMove);
  }

  // ---------------------------------------------------------------------------
  // Touch: basket follows finger horizontally
  // ---------------------------------------------------------------------------

  _moveBasket(clientX) {
    this.basketX = Math.max(0, Math.min(this.W - BASKET_W, clientX - BASKET_W / 2));
  }

  _onTouchStart(e) { this._moveBasket(e.touches[0].clientX); }
  _onTouchMove(e)  { this._moveBasket(e.touches[0].clientX); }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(dt) {
    // ── Countdown phase ──────────────────────────────────────────────
    if (this._phase === 'countdown') {
      this._countdown -= dt;
      if (this._countdown <= 0) {
        this._phase = 'playing';
        // Inject bonus objects from daily reward as early spawns
        for (let i = 0; i < this._bonusObjects; i++) {
          this._spawnCoin(getTier(0), /* forced= */true);
        }
      }
      return;
    }

    if (this._phase === 'done') return;

    // ── Playing phase ────────────────────────────────────────────────
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const elapsed = GAME_DURATION - this.timeLeft;
    const tier    = getTier(elapsed);

    // Spawn
    this.spawnTimer += dt;
    if (this.spawnTimer >= tier.interval) {
      this.spawnTimer -= tier.interval;
      if (Math.random() < tier.bombChance) {
        this._spawnBomb(tier);
      } else {
        this._spawnCoin(tier);
      }
    }

    // Update objects
    const bLeft  = this.basketX;
    const bRight = this.basketX + BASKET_W;
    const bTop   = this.basketY;
    const bBot   = this.basketY + BASKET_H;

    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      obj.y += obj.speed * dt;

      // Catch detection (circle vs rect, simplified to bounding-box)
      if (
        obj.y + obj.radius > bTop &&
        obj.y - obj.radius < bBot &&
        obj.x + obj.radius > bLeft &&
        obj.x - obj.radius < bRight
      ) {
        this._onCatch(obj);
        this.objects.splice(i, 1);
        continue;
      }

      // Miss (off screen)
      if (obj.y - obj.radius > this.H) {
        if (!obj.isBomb) {
          // Break combo on coin miss
          if (this.combo > 0) {
            this.combo = 0;
          }
        }
        this.objects.splice(i, 1);
      }
    }

    // Visual effects decay
    this._bombFlash = Math.max(0, this._bombFlash - dt);
    this._catchFx = this._catchFx.filter(fx => {
      fx.life -= dt;
      return fx.life > 0;
    });

    // Game over
    if (this.timeLeft <= 0 && this._phase === 'playing') {
      this._phase = 'done';
      this._onGameOver();
    }
  }

  _spawnCoin(tier, forced) {
    const r  = COIN_RADIUS;
    const x  = r + Math.random() * (this.W - r * 2);
    const sp = tier.speed * (0.75 + Math.random() * 0.5);
    this.objects.push({ x, y: -r, radius: r, speed: sp, isBomb: false });
  }

  _spawnBomb(tier) {
    const r  = BOMB_RADIUS;
    const x  = r + Math.random() * (this.W - r * 2);
    const sp = tier.speed * (0.7 + Math.random() * 0.4);
    this.objects.push({ x, y: -r, radius: r, speed: sp, isBomb: true });
  }

  _onCatch(obj) {
    if (obj.isBomb) {
      this.score      = Math.max(0, this.score - BOMB_PENALTY);
      this.combo      = 0;
      this._bombFlash = 0.35;
      this._catchFx.push({ x: obj.x, y: obj.y, text: '-20', life: 0.8, maxLife: 0.8, color: '#FF5555' });
    } else {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      const mult = Math.min(this.combo, 5);
      const pts  = COIN_BASE_PTS * mult;
      this.score += pts;
      this.catches++;
      const label = mult > 1 ? `+${pts} x${mult}` : `+${pts}`;
      this._catchFx.push({ x: obj.x, y: obj.y, text: label, life: 0.8, maxLife: 0.8, color: '#FFD700' });
    }
  }

  _onGameOver() {
    // Persist results
    const prevHigh   = Storage.get(KEY_HIGH_SCORE, 0);
    const isNewHigh  = this.score > prevHigh;
    if (isNewHigh) Storage.set(KEY_HIGH_SCORE, this.score);

    const pd = Storage.get(KEY_PLAYER_DATA, { totalGamesPlayed: 0 });
    pd.totalGamesPlayed = (pd.totalGamesPlayed || 0) + 1;
    Storage.set(KEY_PLAYER_DATA, pd);

    // Brief pause, then show result
    setTimeout(() => {
      this.game.showResult({
        score:      this.score,
        highScore:  Math.max(this.score, prevHigh),
        isNewHigh,
        catches:    this.catches,
        maxCombo:   this.maxCombo,
      });
    }, 600);
  }

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  draw(ctx, W, H) {
    // Background
    drawGradientBg(ctx, W, H, '#0d0d2b', '#1a1a3e');

    // Bomb flash overlay
    if (this._bombFlash > 0) {
      ctx.fillStyle = `rgba(220,0,0,${this._bombFlash * 0.45})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Countdown overlay
    if (this._phase === 'countdown') {
      this._drawCountdown(ctx, W, H);
      return; // don't draw gameplay yet
    }

    // Objects
    for (const obj of this.objects) {
      this._drawObject(ctx, obj);
    }

    // Catch FX (floating score text)
    for (const fx of this._catchFx) {
      const alpha = fx.life / fx.maxLife;
      const rise  = (1 - alpha) * 40;
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = fx.color;
      ctx.font        = `bold ${Math.floor(H * 0.03)}px Arial`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fx.text, fx.x, fx.y - rise);
    }
    ctx.globalAlpha = 1;

    // Basket
    this._drawBasket(ctx);

    // HUD
    this._drawHUD(ctx, W, H);
  }

  _drawObject(ctx, obj) {
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.radius, 0, Math.PI * 2);

    if (obj.isBomb) {
      // Bomb: dark red with glow
      ctx.fillStyle   = '#CC2200';
      ctx.shadowColor = '#FF4400';
      ctx.shadowBlur  = 14;
      ctx.fill();
      ctx.shadowBlur  = 0;
      // Cross symbol
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth   = 2.5;
      const r = obj.radius * 0.48;
      ctx.beginPath();
      ctx.moveTo(obj.x - r, obj.y - r);
      ctx.lineTo(obj.x + r, obj.y + r);
      ctx.moveTo(obj.x + r, obj.y - r);
      ctx.lineTo(obj.x - r, obj.y + r);
      ctx.stroke();
    } else {
      // Coin: gold with glow
      ctx.fillStyle   = '#FFD700';
      ctx.shadowColor = '#FFAA00';
      ctx.shadowBlur  = 18;
      ctx.fill();
      ctx.shadowBlur  = 0;
      // Inner circle highlight
      ctx.beginPath();
      ctx.arc(obj.x - obj.radius * 0.2, obj.y - obj.radius * 0.2, obj.radius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
  }

  _drawBasket(ctx) {
    const bx = this.basketX;
    const by = this.basketY;

    ctx.shadowColor = '#00E5FF';
    ctx.shadowBlur  = 16;
    ctx.fillStyle   = this._bombFlash > 0.1 ? '#FF6666' : '#FFFFFF';
    roundRect(ctx, bx, by, BASKET_W, BASKET_H, BASKET_H / 2);
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Centre groove decoration
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(bx + BASKET_W * 0.35, by + BASKET_H / 2);
    ctx.lineTo(bx + BASKET_W * 0.65, by + BASKET_H / 2);
    ctx.stroke();
  }

  _drawHUD(ctx, W, H) {
    ctx.shadowBlur   = 0;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';

    // ── Timer bar ──────────────────────────────────────────────────
    const barW = W - 40;
    const ratio = this.timeLeft / GAME_DURATION;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, 20, 18, barW, 10, 5);
    ctx.fill();

    ctx.fillStyle = ratio > 0.35 ? '#00E676' : (ratio > 0.18 ? '#FFD600' : '#FF5252');
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur  = 8;
    roundRect(ctx, 20, 18, barW * ratio, 10, 5);
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Timer text
    ctx.fillStyle = '#FFFFFF';
    ctx.font      = `bold ${Math.floor(H * 0.025)}px Arial`;
    ctx.fillText(`${Math.ceil(this.timeLeft)}s`, W / 2, 33);

    // ── Score ──────────────────────────────────────────────────────
    ctx.fillStyle    = '#FFD700';
    ctx.font         = `bold ${Math.floor(H * 0.048)}px Arial`;
    ctx.shadowColor  = '#FFD700';
    ctx.shadowBlur   = 12;
    ctx.textBaseline = 'top';
    ctx.fillText(this.score.toLocaleString(), W / 2, 52);
    ctx.shadowBlur   = 0;

    // ── Combo ──────────────────────────────────────────────────────
    if (this.combo >= 2) {
      const hue = (this.combo * 22) % 360;
      ctx.fillStyle    = `hsl(${hue}, 100%, 68%)`;
      ctx.font         = `bold ${Math.floor(H * 0.03)}px Arial`;
      ctx.textBaseline = 'top';
      ctx.fillText(`x${this.combo} COMBO`, W / 2, 104);
    }

    // ── Difficulty label (first 3 s of each tier) ──────────────────
    const elapsed = GAME_DURATION - this.timeLeft;
    let tierLabel = '';
    if (elapsed >= 30 && elapsed < 33) tierLabel = '!! 危险 !!';
    else if (elapsed >= 15 && elapsed < 18) tierLabel = '! 加速 !';
    if (tierLabel) {
      ctx.fillStyle    = '#FF5252';
      ctx.font         = `bold ${Math.floor(H * 0.03)}px Arial`;
      ctx.textBaseline = 'top';
      ctx.fillText(tierLabel, W / 2, 140);
    }
  }

  _drawCountdown(ctx, W, H) {
    const num = Math.ceil(this._countdown);
    ctx.fillStyle    = 'rgba(255,255,255,0.9)';
    ctx.font         = `bold ${Math.floor(H * 0.18)}px Arial`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = '#FFD700';
    ctx.shadowBlur   = 30;
    ctx.fillText(num > 0 ? String(num) : 'GO!', W / 2, H / 2);
    ctx.shadowBlur   = 0;

    ctx.fillStyle    = 'rgba(255,255,255,0.55)';
    ctx.font         = `${Math.floor(H * 0.03)}px Arial`;
    ctx.fillText('滑动手指移动接球板', W / 2, H * 0.65);
    if (this.game.pendingBonusSpawns > 0 || this._bonusObjects > 0) {
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`本局额外 +${this._bonusObjects} 金币！`, W / 2, H * 0.70);
    }
  }
}

module.exports = GameScreen;
