'use strict';
// Game.js — main game controller: canvas setup, screen manager, RAF loop

const AdService = require('./AdService');

class Game {
  constructor() {
    // System info (logical pixels — touch coords match these)
    this.sysInfo = wx.getSystemInfoSync();
    this.W = this.sysInfo.windowWidth;
    this.H = this.sysInfo.windowHeight;

    // Main canvas: set to logical pixel dimensions so touch coords align
    this.canvas = wx.createCanvas();
    this.canvas.width  = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');

    this._screen   = null;
    this._lastTs   = 0;
    this._raf      = this._loop.bind(this);

    // Bonus spawns from daily reward carry over into the next round
    this.pendingBonusSpawns = 0;

    AdService.init();
  }

  start() {
    requestAnimationFrame(this._raf);
    this._setScreen(this._makeMain());
  }

  // ---------------------------------------------------------------------------
  // Screen transitions
  // ---------------------------------------------------------------------------

  showMain() {
    AdService.destroyBanner();
    this._setScreen(this._makeMain());
  }

  showGame() {
    AdService.destroyBanner();
    this._setScreen(this._makeGame());
  }

  /**
   * @param {{ score:number, highScore:number, isNewHigh:boolean,
   *           catches:number, maxCombo:number }} data
   */
  showResult(data) {
    this._setScreen(this._makeResult(data));
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _makeMain()       { return new (require('./screens/MainScreen'))(this); }
  _makeGame()       { return new (require('./screens/GameScreen'))(this); }
  _makeResult(data) { return new (require('./screens/ResultScreen'))(this, data); }

  _setScreen(screen) {
    if (this._screen) this._screen.destroy();
    this._screen = screen;
    this._screen.init();
  }

  _loop(ts) {
    // Skip first frame to avoid a huge dt spike
    if (this._lastTs === 0) {
      this._lastTs = ts;
      requestAnimationFrame(this._raf);
      return;
    }

    const dt = Math.min((ts - this._lastTs) / 1000, 0.05); // cap at 50 ms
    this._lastTs = ts;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    if (this._screen) {
      this._screen.update(dt);
      this._screen.draw(ctx, this.W, this.H);
    }

    requestAnimationFrame(this._raf);
  }
}

module.exports = Game;
