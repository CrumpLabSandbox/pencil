// Pencil physics + page-op expansion. Pure module: shared by the browser app and tools/pencil.mjs.
// All lengths are millimetres. Page origin is top-left, y down.
import { FONTS } from './font.js';

export const PAGE = { w: 148, h: 210, margin: 12, rule: 8, firstRule: 24 };

const TAN = Math.tan((11 * Math.PI) / 180); // half-angle of a sharpened point
export const PENCIL = {
  length: 175,          // a new pencil
  half: 87.5,           // the notepad project ends when the pencil is this long
  minWidth: 0.25,       // flat on a freshly sharpened tip
  maxWidth: 1.8,        // worn to the wood: must sharpen
  overgrind: 0.5,       // extra length a sharpener chews off each time
  K: 6e-5,              // graphite film laid down per pass at pressure 1 (mm) — a soft lead
  sat: 7e-4,            // graphite a mm² of paper tooth can hold (mm³)
  eraser: 12,           // eraser length
  eraserWidth: 5,
  eraseArea: 1e-4,      // eraser worn per mm² rubbed
  eraseGraphite: 0.4,   // eraser worn per mm³ of graphite lifted
  eraseLift: 0.9,       // fraction of graphite an eraser pass removes
  maxPageStroke: 400000 // hand-cramp guard: mm of stroke one page may attempt
};

const coneVol = (wear) => (Math.PI * TAN * TAN * wear ** 3) / 3;
const wearOf = (vol) => Math.cbrt((3 * vol) / (Math.PI * TAN * TAN));
const WEAR0 = PENCIL.minWidth / (2 * TAN);
const WEAR_MAX = PENCIL.maxWidth / (2 * TAN);

export const newPencil = () => ({ length: PENCIL.length, worn: coneVol(WEAR0), eraser: PENCIL.eraser, sharpenings: 0, graphite: 0, distance: 0 });
export const tipWidth = (s) => 2 * wearOf(s.worn) * TAN;
export const sharpness = (s) => 1 - (tipWidth(s) - PENCIL.minWidth) / (PENCIL.maxWidth - PENCIL.minWidth);
export const usedFraction = (s) => (PENCIL.length - s.length) / PENCIL.length;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- simulation

// Runs actions against one sheet of paper, producing drawable items.
// Item: {t:'s'|'e'|'x', p:[x,y,x,y...], w, a, l, st:[length, worn, eraser]}
export class Sim {
  constructor(state, { stopAt = PENCIL.half } = {}) {
    this.s = { ...state };
    this.stopAt = stopAt;
    this.stopped = this.s.length <= stopAt;
    this.grid = new Float32Array(PAGE.w * PAGE.h); // graphite per mm² cell
    this.stamp = new Uint32Array(PAGE.w * PAGE.h);
    this.stampId = 0;
    this.items = [];
    this.start = { ...state };
    this.stats = { strokeMm: 0, graphite: 0, sharpenings: 0, autoSharpenings: 0, erasedMm2: 0, erasedGraphite: 0 };
    this.last = [PAGE.w / 2, PAGE.h / 2];
  }

  snap() { return [this.s.length, this.s.worn, this.s.eraser]; }
  cell(x, y) { return clamp(Math.floor(y), 0, PAGE.h - 1) * PAGE.w + clamp(Math.floor(x), 0, PAGE.w - 1); }

  stroke(pts, pressure = 0.8) {
    if (this.stopped || pts.length < 2) return;
    const s = this.s, pr = clamp(pressure, 0.1, 1.6);
    let chunk = [pts[0][0], pts[0][1]], len = 0, fsum = 0, wsum = 0, n = 0;
    const flush = () => {
      if (n) {
        const f = fsum / n;
        this.items.push({ t: 's', p: chunk.map(r2), w: r2(wsum / n), a: r2(Math.min(0.95, 0.32 + 0.5 * pr) * (0.25 + 0.75 * f)), l: r2(len), st: this.snap() });
      }
      chunk = chunk.slice(-2); len = 0; fsum = 0; wsum = 0; n = 0;
    };
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const seg = Math.hypot(bx - ax, by - ay);
      if (!(seg > 0)) continue;
      const steps = Math.ceil(seg / 0.5), ds = seg / steps;
      for (let k = 1; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps, y = ay + ((by - ay) * k) / steps;
        const c = this.cell(x, y);
        const f = Math.max(0, 1 - this.grid[c] / PENCIL.sat); // saturated tooth takes no more graphite
        const w = tipWidth(s);
        const dV = PENCIL.K * w * pr * ds * f;
        const wear0 = wearOf(s.worn);
        this.grid[c] += dV; s.worn += dV; s.graphite += dV; s.distance += ds;
        const wear1 = wearOf(s.worn);
        s.length -= wear1 - wear0;
        this.stats.graphite += dV; this.stats.strokeMm += ds;
        len += ds; fsum += f; wsum += w; n++;
        if (k === steps || len >= 2.5) chunk.push(x, y);
        this.last = [x, y];
        if (len >= 2.5) flush();
        if (wear1 >= WEAR_MAX) { flush(); this.sharpen(true); }
        if (s.length <= this.stopAt) { flush(); this.stopped = true; return; }
      }
    }
    flush();
  }

  // Returns false if the point is already sharp (the sharpener just spins).
  sharpen(auto = false) {
    if (this.stopped) return false;
    if (!auto && tipWidth(this.s) < 0.4) return false;
    this.s.length -= PENCIL.overgrind + WEAR0;
    this.s.worn = coneVol(WEAR0);
    this.s.sharpenings++;
    this.stats.sharpenings++;
    if (auto) this.stats.autoSharpenings++;
    this.items.push({ t: 'x', p: this.last.map(r2), auto, st: this.snap() });
    if (this.s.length <= this.stopAt) this.stopped = true;
    return true;
  }

  erase(pts) {
    if (this.stopped || this.s.eraser <= 0 || pts.length < 2) return;
    const s = this.s, R = PENCIL.eraserWidth / 2, id = ++this.stampId;
    let chunk = [pts[0][0], pts[0][1]], len = 0;
    const flush = () => {
      if (chunk.length >= 4) this.items.push({ t: 'e', p: chunk.map(r2), w: PENCIL.eraserWidth, l: r2(len), st: this.snap() });
      chunk = chunk.slice(-2); len = 0;
    };
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const seg = Math.hypot(bx - ax, by - ay);
      if (!(seg > 0)) continue;
      const steps = Math.ceil(seg), ds = seg / steps;
      for (let k = 1; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps, y = ay + ((by - ay) * k) / steps;
        for (let cy = Math.floor(y - R); cy <= y + R; cy++) {
          for (let cx = Math.floor(x - R); cx <= x + R; cx++) {
            if (cx < 0 || cy < 0 || cx >= PAGE.w || cy >= PAGE.h) continue;
            if ((cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > R * R) continue;
            const c = cy * PAGE.w + cx;
            if (this.stamp[c] === id) continue;
            this.stamp[c] = id;
            const lifted = this.grid[c] * PENCIL.eraseLift;
            this.grid[c] -= lifted;
            s.eraser -= PENCIL.eraseArea + lifted * PENCIL.eraseGraphite;
            this.stats.erasedMm2++; this.stats.erasedGraphite += lifted;
          }
        }
        len += ds;
        if (k === steps || len >= 4) chunk.push(x, y);
        this.last = [x, y];
        if (len >= 4) flush();
        if (s.eraser <= 0) { s.eraser = 0; flush(); return; }
      }
    }
    flush();
  }

  run(action) {
    if (action.t === 's') this.stroke(action.p, action.pr);
    else if (action.t === 'e') this.erase(action.p);
    else if (action.t === 'x') this.sharpen(false);
  }

  // Fraction of the sheet's tooth that is holding graphite.
  coverage() {
    let dark = 0;
    for (let i = 0; i < this.grid.length; i++) dark += Math.min(1, this.grid[i] / PENCIL.sat);
    return dark / this.grid.length;
  }
}

export function simulate(actions, state, opts) {
  const sim = new Sim(state, opts);
  for (const a of actions) sim.run(a);
  return sim;
}

// ---------------------------------------------------------------- op expansion

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pathLength = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };

function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

// A hand never draws a perfect line: add slow sideways drift.
function humanize(pts, amp, rng) {
  if (!(amp > 0) || pts.length < 2) return pts;
  const rs = resample(pts, 1.5);
  let phase1 = rng() * 6.28, phase2 = rng() * 6.28, d = 0;
  return rs.map((p, i) => {
    const q = rs[Math.min(i + 1, rs.length - 1)], o = rs[Math.max(i - 1, 0)];
    const dx = q[0] - o[0], dy = q[1] - o[1], n = Math.hypot(dx, dy) || 1;
    if (i) d += Math.hypot(p[0] - rs[i - 1][0], p[1] - rs[i - 1][1]);
    const off = amp * (Math.sin(d / 9 + phase1) * 0.6 + Math.sin(d / 3.7 + phase2) * 0.4);
    return [p[0] - (dy / n) * off, p[1] + (dx / n) * off];
  });
}

function catmull(pts, closed) {
  if (pts.length < 3) return pts;
  const P = (i) => closed ? pts[(i + pts.length) % pts.length] : pts[clamp(i, 0, pts.length - 1)];
  const out = [], last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(closed ? out[0] : pts[pts.length - 1]);
  return out;
}

const ellipsePts = (cx, cy, rx, ry, rot = 0, a0 = 0, a1 = 360) => {
  const n = Math.max(8, Math.ceil((Math.abs(a1 - a0) / 360) * 2 * Math.PI * Math.max(rx, ry) / 1.2));
  const cr = Math.cos((rot * Math.PI) / 180), sr = Math.sin((rot * Math.PI) / 180), out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180, x = rx * Math.cos(a), y = ry * Math.sin(a);
    out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  return out;
};

// region: {rect:[x,y,w,h]} | {circle:[cx,cy,r]} | {ellipse:[cx,cy,rx,ry]} | {polygon:[[x,y],...]}
function regionOf(op) {
  const g = op.region ?? op;
  if (g.rect || (g.w != null && g.h != null && g.x != null)) {
    const [x, y, w, h] = g.rect ?? [g.x, g.y, g.w, g.h];
    return { box: [x, y, x + w, y + h], has: (px, py) => px >= x && px <= x + w && py >= y && py <= y + h };
  }
  if (g.circle || g.ellipse) {
    const [cx, cy, rx, ry = rx] = g.circle ?? g.ellipse;
    return { box: [cx - rx, cy - ry, cx + rx, cy + ry], has: (px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1 };
  }
  if (g.polygon) {
    const poly = g.polygon, xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    return {
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      has: (px, py) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i], [xj, yj] = poly[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      }
    };
  }
  return null;
}

function hatchLines(region, angle, spacing, rng) {
  const [x0, y0, x1, y1] = region.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const R = Math.hypot(x1 - x0, y1 - y0) / 2 + 1, a = (angle * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a), out = [];
  let flip = false;
  for (let o = -R; o <= R; o += spacing) {
    const runs = [];
    let run = null;
    for (let t = -R; t <= R; t += 0.5) {
      const x = cx + ux * t - uy * o, y = cy + uy * t + ux * o;
      if (region.has(x, y)) { if (!run) run = [[x, y], [x, y]]; else run[1] = [x, y]; }
      else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    if (flip) runs.reverse();
    for (const r of runs) {
      const j = () => (rng() - 0.5) * 0.6;
      const seg = [[r[0][0] + j(), r[0][1] + j()], [r[1][0] + j(), r[1][1] + j()]];
      if (Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) < 0.4) continue;
      out.push(flip ? seg.reverse() : seg);
    }
    flip = !flip;
  }
  return out;
}

const SUBS = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '--', '…': '...', '\t': ' ' };

function layoutText(op, cursor, rng, warn) {
  const font = FONTS[op.font === 'script' ? 'script' : 'print'];
  const size = clamp(op.size ?? 7, 2, 60), sc = size / 1000;
  const x0 = op.x ?? PAGE.margin, maxW = op.width ?? PAGE.w - PAGE.margin - x0;
  const lh = op.lineHeight ?? (size <= 8.5 ? PAGE.rule : size * 1.25);
  const text = String(op.text ?? '').replace(/[‘’“”–—…\t]/g, (c) => SUBS[c]);
  const adv = (word) => [...word].reduce((s, ch) => s + (font[ch] ?? font['?'])[0] * sc, 0);
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const trial = line ? `${line} ${word}` : word;
      if (line && adv(trial) > maxW) { lines.push(line); line = word; } else line = trial;
    }
    lines.push(line);
  }
  const strokes = [];
  let y = op.y ?? cursor, written = 0;
  for (const line of lines) {
    if (y > PAGE.h - 4) { warn(`write: ran off the bottom of the page; ${lines.length - written} line(s) dropped`); break; }
    let x = x0 + (rng() - 0.5) * 0.8;
    for (const ch of line) {
      const [a, glyph] = font[ch] ?? font['?'];
      const dy = (rng() - 0.5) * 0.35, slant = (rng() - 0.5) * 0.06, gs = sc * (1 + (rng() - 0.5) * 0.05);
      for (const st of glyph) {
        strokes.push(st.split(' ').map((pt) => {
          const [gx, gy] = pt.split(',').map(Number);
          return [x + gx * gs + gy * gs * slant, y + dy - gy * gs];
        }));
      }
      x += a * sc;
    }
    y += lh; written++;
  }
  if (op.rot) {
    // tilt the whole block about its starting point, for words jotted at an angle
    const a = (op.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), oy = op.y ?? cursor;
    for (const st of strokes) for (const p of st) {
      const dx = p[0] - x0, dy = p[1] - oy;
      p[0] = x0 + dx * c - dy * s; p[1] = oy + dx * s + dy * c;
    }
    return { strokes, cursor, lines: written };
  }
  return { strokes, cursor: y, lines: written };
}

// Turns a page's high-level ops into pencil actions: {t:'s',p,pr} | {t:'e',p} | {t:'x'}.
export function expand(ops, seed = 1) {
  const rng = mulberry32(seed * 7919 + 13), actions = [], warnings = [];
  const warn = (m) => warnings.push(m);
  let cursor = PAGE.firstRule, total = 0, capped = false;
  const clip = (p) => [clamp(p[0], 0.5, PAGE.w - 0.5), clamp(p[1], 0.5, PAGE.h - 0.5)];
  const finite = (...v) => v.every((n) => Number.isFinite(n));

  (ops ?? []).forEach((op, idx) => {
    const tag = `op ${idx} (${op?.op})`;
    if (!op || typeof op.op !== 'string') return warn(`op ${idx}: missing "op"`);
    const pr = op.pressure ?? 0.8, wob = op.wobble ?? 0.2, repeat = clamp(Math.round(op.repeat ?? 1), 1, 40);
    const emit = (pts, amp = wob) => {
      if (capped || pts.length < 2 || !pts.every((p) => finite(p[0], p[1]))) return;
      const out = humanize(pts, amp, rng).map(clip);
      total += pathLength(out);
      if (total > PENCIL.maxPageStroke) { capped = true; return warn(`page stroke limit reached at ${tag}; the rest was dropped (hand cramp)`); }
      actions.push({ t: 's', p: out, pr });
    };
    for (let pass = 0; pass < repeat; pass++) {
      switch (op.op) {
        case 'write': {
          const t = layoutText(op, cursor, rng, warn);
          t.strokes.forEach((s) => emit(s, 0));
          if (pass === repeat - 1) cursor = t.cursor;
          break;
        }
        case 'line': if (!finite(op.x1, op.y1, op.x2, op.y2)) return warn(`${tag}: needs x1,y1,x2,y2`); emit([[op.x1, op.y1], [op.x2, op.y2]]); break;
        case 'polyline': if (!Array.isArray(op.points)) return warn(`${tag}: needs points`); emit(op.closed ? [...op.points, op.points[0]] : op.points); break;
        case 'curve': if (!Array.isArray(op.points)) return warn(`${tag}: needs points`); emit(catmull(op.points, !!op.closed)); break;
        case 'rect': if (!finite(op.x, op.y, op.w, op.h)) return warn(`${tag}: needs x,y,w,h`); emit([[op.x, op.y], [op.x + op.w, op.y], [op.x + op.w, op.y + op.h], [op.x, op.y + op.h], [op.x, op.y]]); break;
        case 'circle': if (!finite(op.cx, op.cy, op.r)) return warn(`${tag}: needs cx,cy,r`); emit(ellipsePts(op.cx, op.cy, op.r, op.r)); break;
        case 'ellipse': if (!finite(op.cx, op.cy, op.rx, op.ry)) return warn(`${tag}: needs cx,cy,rx,ry`); emit(ellipsePts(op.cx, op.cy, op.rx, op.ry, op.rot ?? 0)); break;
        case 'arc': if (!finite(op.cx, op.cy, op.r, op.from, op.to)) return warn(`${tag}: needs cx,cy,r,from,to`); emit(ellipsePts(op.cx, op.cy, op.r, op.r, 0, op.from, op.to)); break;
        case 'spiral': {
          if (!finite(op.cx, op.cy, op.r1)) return warn(`${tag}: needs cx,cy,r1`);
          const turns = clamp(op.turns ?? 5, 0.25, 200), r0 = op.r0 ?? 0, n = Math.ceil(turns * 60), pts = [];
          for (let i = 0; i <= n; i++) { const a = (i / 60) * 2 * Math.PI, r = r0 + ((op.r1 - r0) * i) / n; pts.push([op.cx + r * Math.cos(a), op.cy + r * Math.sin(a)]); }
          emit(pts);
          break;
        }
        case 'hatch': {
          const region = regionOf(op);
          if (!region) return warn(`${tag}: needs a region`);
          const spacing = clamp(op.spacing ?? 1, 0.15, 50), angle = op.angle ?? 45;
          hatchLines(region, angle, spacing, rng).forEach((l) => emit(l, 0));
          if (op.cross) hatchLines(region, angle + 90, spacing, rng).forEach((l) => emit(l, 0));
          break;
        }
        case 'scribble': {
          const region = regionOf(op);
          if (!region) return warn(`${tag}: needs a region`);
          const [x0, y0, x1, y1] = region.box, n = clamp(Math.ceil((op.length ?? 500) / 9), 3, 20000), pts = [];
          for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
            const p = [x0 + rng() * (x1 - x0), y0 + rng() * (y1 - y0)];
            const prev = pts[pts.length - 1];
            if (!region.has(p[0], p[1]) || (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 16)) continue;
            pts.push(p); i++;
          }
          emit(catmull(pts, false), 0);
          break;
        }
        case 'stipple': {
          const region = regionOf(op);
          if (!region) return warn(`${tag}: needs a region`);
          const [x0, y0, x1, y1] = region.box, n = clamp(Math.round(op.count ?? 100), 1, 20000);
          for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
            const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0);
            if (!region.has(x, y)) continue;
            emit([[x, y], [x + 0.3, y + 0.2], [x, y + 0.3]], 0); i++;
          }
          break;
        }
        case 'erase': {
          if (!finite(op.x, op.y, op.w, op.h)) return warn(`${tag}: needs x,y,w,h`);
          const pts = [], step = PENCIL.eraserWidth * 0.8;
          for (let y = op.y + step / 2, i = 0; y < op.y + op.h + step / 2; y += step, i++) {
            const yy = Math.min(y, op.y + op.h), row = [[op.x, yy], [op.x + op.w, yy]];
            pts.push(...(i % 2 ? row.reverse() : row));
          }
          if (pts.length >= 2) actions.push({ t: 'e', p: pts.map(clip) });
          break;
        }
        case 'sharpen': actions.push({ t: 'x' }); break;
        default: return warn(`${tag}: unknown op`);
      }
    }
  });
  return { actions, warnings };
}

// One-stop: ops + pencil state in, simulated sheet out.
export function runPage(ops, state, seed, opts) {
  const { actions, warnings } = expand(ops, seed);
  const sim = simulate(actions, state, opts);
  return { sim, warnings };
}
