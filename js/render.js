// Canvas drawing: graphite items onto the sheet, and the pencil itself.
import { PENCIL, tipWidth } from './engine.js';

const GRAPHITE = '#25252b';

// ctx is expected to be scaled so 1 unit = 1 mm.
export function drawItem(ctx, it) {
  if (it.t === 'x') return;
  const p = it.p;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.lineJoin = 'round';
  if (it.t === 's') {
    // a little unevenness, keyed to position so a redraw looks identical
    const grain = 0.88 + 0.24 * (((p[0] * 12.9898 + p[1] * 78.233) % 1 + 1) % 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(1, it.a * grain);
    ctx.strokeStyle = GRAPHITE;
    ctx.lineCap = it.l < 1 ? 'round' : 'butt';
    ctx.lineWidth = it.w;
  } else {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.88;
    ctx.lineCap = 'round';
    ctx.lineWidth = it.w;
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

const CONE = 15, FERRULE = 9, R = 3.6; // mm

// Draws a pencil lying along +x with its writing tip at the origin. 1 unit = 1 mm.
export function pencilShape(ctx, state) {
  const len = Math.max(CONE + FERRULE + 4, state.length);
  const bodyEnd = len - FERRULE, tip = Math.max(0.15, tipWidth(state) / 2);
  const leadEnd = CONE * 0.3;
  const yAt = (x) => tip + ((R - tip) * x) / CONE;
  // wood cone
  ctx.beginPath();
  ctx.moveTo(leadEnd, -yAt(leadEnd)); ctx.lineTo(CONE, -R); ctx.lineTo(CONE, R); ctx.lineTo(leadEnd, yAt(leadEnd));
  ctx.closePath(); ctx.fillStyle = '#e3bf8f'; ctx.fill();
  // lead
  ctx.beginPath();
  ctx.moveTo(0, -tip); ctx.lineTo(leadEnd, -yAt(leadEnd)); ctx.lineTo(leadEnd, yAt(leadEnd)); ctx.lineTo(0, tip);
  ctx.closePath(); ctx.fillStyle = '#33333a'; ctx.fill();
  // painted body: three visible faces of the hexagon
  const faces = [['#d99a1c', -R, -R / 3], ['#f4bd2f', -R / 3, R / 3], ['#c98a12', R / 3, R]];
  for (const [fill, y0, y1] of faces) {
    ctx.fillStyle = fill;
    ctx.fillRect(CONE, y0, bodyEnd - CONE, y1 - y0);
  }
  // ferrule
  ctx.fillStyle = '#b9bcc2'; ctx.fillRect(bodyEnd, -R - 0.15, FERRULE, 2 * R + 0.3);
  ctx.fillStyle = '#8d9097';
  for (const x of [1.2, 2.6, FERRULE - 2.6, FERRULE - 1.2]) ctx.fillRect(bodyEnd + x, -R - 0.15, 0.6, 2 * R + 0.3);
  // eraser: 12 mm new, about half of it stands proud of the ferrule
  const er = Math.max(0, state.eraser) * 0.55;
  if (er > 0.05) {
    ctx.fillStyle = '#e58a8f';
    ctx.beginPath();
    ctx.roundRect(len, -R + 0.2, er, 2 * R - 0.4, [0, Math.min(1.6, er), Math.min(1.6, er), 0]);
    ctx.fill();
  }
  return len + er;
}

// mode: 'write' (tip on paper), 'erase' (eraser on paper), 'sharpen' (tip in a sharpener)
export function drawPencilAt(ctx, x, y, state, mode = 'write', angle = -58) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 6; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 5;
  if (mode === 'erase') {
    const total = Math.max(CONE + FERRULE + 4, state.length) + Math.max(0, state.eraser) * 0.55;
    ctx.translate(total, 0); ctx.scale(-1, 1);
  }
  pencilShape(ctx, state);
  if (mode === 'sharpen') {
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#5b6f86';
    ctx.beginPath(); ctx.roundRect(-9, -8, 21, 16, 2.5); ctx.fill();
    ctx.fillStyle = '#c9d2dc'; ctx.fillRect(-6, -5.5, 15, 2.2);
    ctx.strokeStyle = '#e3bf8f'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const a = (performance.now() / 90 + i * 1.3) % 6.28;
      ctx.beginPath(); ctx.arc(-12 - i * 1.4, Math.sin(a) * 6, 2.2, a, a + 2.4); ctx.stroke();
    }
  }
  ctx.restore();
}

// The gauge: a full-length ghost, the pencil as it is now, and the project's stop mark. 1 unit = 1 mm.
export function drawGauge(ctx, state, { mark = null } = {}) {
  const total = PENCIL.length + PENCIL.eraser * 0.55, lenNow = Math.max(CONE + FERRULE + 4, state.length);
  ctx.save();
  // right-align: the eraser end stays put while the tip recedes
  ctx.translate(PENCIL.length - lenNow, 0);
  pencilShape(ctx, state);
  ctx.restore();
  ctx.save();
  ctx.setLineDash([1.5, 1.5]); ctx.lineWidth = 0.4; ctx.strokeStyle = 'rgba(60,50,40,0.45)';
  ctx.strokeRect(0, -R, PENCIL.length - lenNow - 0.6 > 0 ? PENCIL.length - lenNow - 0.6 : 0, 2 * R);
  if (mark != null) {
    ctx.setLineDash([]); ctx.strokeStyle = '#b3261e'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(PENCIL.length - mark, -R - 3); ctx.lineTo(PENCIL.length - mark, R + 3); ctx.stroke();
  }
  ctx.restore();
  return total;
}
