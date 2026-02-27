'use strict';
// utils.js — shared canvas drawing helpers

/**
 * Draw a rounded rectangle path (WeChat Canvas may not support ctx.roundRect).
 * Call ctx.fill() or ctx.stroke() after this.
 */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/**
 * Draw a centered pill button and its label.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W        — canvas width (button will be centred)
 * @param {number} y        — button top y
 * @param {number} btnW     — button width
 * @param {number} btnH     — button height
 * @param {string} label    — button text
 * @param {string} bgColor  — fill colour
 * @param {string} textColor
 * @param {number} fontSize
 */
function drawButton(ctx, W, y, btnW, btnH, label, bgColor, textColor, fontSize) {
  const x = (W - btnW) / 2;
  ctx.shadowColor = bgColor;
  ctx.shadowBlur  = 18;
  ctx.fillStyle   = bgColor;
  roundRect(ctx, x, y, btnW, btnH, btnH / 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle    = textColor;
  ctx.font         = `bold ${fontSize}px Arial`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W / 2, y + btnH / 2);
}

/**
 * Fill canvas with a top-to-bottom linear gradient.
 */
function drawGradientBg(ctx, W, H, topColor, bottomColor) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

/**
 * Returns true if point (px, py) lies inside the rect [x, y, w, h].
 */
function hitTest(px, py, x, y, w, h) {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

module.exports = { roundRect, drawButton, drawGradientBg, hitTest };
