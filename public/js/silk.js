/* ═══════════════════════════════════════════════════════════════
   3 · E-03.2 SILK — k-fold symmetric drawing

   The thing that makes this read as silk rather than as a marker is
   not the symmetry. It is that a stroke is not one line: it is
   several fine strands, each held at a perpendicular offset that
   scales with how fast the pointer is moving. Move slowly and they
   bunch into a single bright filament; move fast and they fan into
   a ribbon of hair. Everything else here is bookkeeping.

   Strokes are stored as normalised point lists rather than pixels,
   and the canvas is re-rendered from that history. That one
   decision is what buys undo, theme-switching without losing the
   drawing, resizing without resampling a bitmap, and export at four
   times the screen resolution.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import {
  ink, makeLayer, mulberry32, clamp, TAU, isLight, announce
} from './shell.js';
import {
  GRADIENTS, GRADIENT_OPTIONS, hexToHsl, mixHsl, css, blendFor,
  withSymmetry as symmetry, paintPaper
} from './silkkit.js';
import { getStroke } from '../vendor/perfect-freehand.mjs';

let stage, paint, live, base;
let W = 0, H = 0, DPR = 1, S = 1, CX = 0, CY = 0;

let strokes = [];
let redoStack = [];
let current = null;
let drawing = false;
let guideUntil = 0;
let idleSince = 0;
let autoPhase = 0;
let saveTimer = 0;
let lastPt = null;
let liveDirty = false;

const LS_KEY = 'sheet-e03-silk';
const MAX_STROKES = 300;
const BAKE_TO = 150;

const state = {
  brush: 'silk',
  k: 6,
  mirror: true,
  wedge: false,
  size: 1,
  strands: 5,
  spread: 1,
  colorMode: 'gradient',
  hue: 195,
  hueRate: 0.05,
  gradient: 'ultra',
  colA: '#5ce1ff',
  colB: '#ff5cc8',
  gradRate: 0.6,
  guides: true,
  autodraw: true
};

/* ═══════════════════════════════════════════════════════════════
   Geometry — normalised space
   Points are stored relative to the centre and scaled by half the
   short edge, so a drawing survives every resize intact.
   ═══════════════════════════════════════════════════════════════ */
function computeFrame(w, h) {
  W = w; H = h;
  CX = w / 2; CY = h / 2;
  S = Math.min(w, h) / 2;
}

function toNorm(x, y) {
  let nx = (x - CX) / S, ny = (y - CY) / S;
  if (state.wedge) {
    // Fold everything into one wedge, so the k copies tile the disc
    // without a stroke ever crossing its own reflection.
    const k = Math.max(1, state.k);
    const wedge = TAU / k;
    let a = Math.atan2(ny, nx), r = Math.hypot(nx, ny);
    a = ((a % wedge) + wedge) % wedge;
    if (state.mirror && a > wedge / 2) a = wedge - a;
    nx = Math.cos(a) * r; ny = Math.sin(a) * r;
  }
  return [nx, ny];
}

/* The symmetry frame. Bound at call time rather than captured,
   because exportPNG() temporarily moves the centre to the middle of
   a canvas three times the size. */
const frame = { cx: 0, cy: 0 };
const withSymmetry = (g, k, mirror, fn) => {
  frame.cx = CX; frame.cy = CY;
  symmetry(g, frame, k, mirror, fn);
};

/* ═══════════════════════════════════════════════════════════════
   Colour
   ═══════════════════════════════════════════════════════════════ */
function colorAt(stroke, p) {
  switch (stroke.colorMode) {
    case 'gradient': {
      // Oscillate rather than ramp, so a stroke of any length reads as
      // a gradient instead of ending wherever it happened to stop.
      // Cosine, not sine: this has to start at exactly colour A and
      // sweep to B. Starting mid-sweep means someone who picks green
      // to pink sees neither green nor pink on a short stroke, only
      // the muddy middle — which is the one thing they did not choose.
      const t = 0.5 - 0.5 * Math.cos(p[3] * stroke.gradRate * 0.0016);
      return mixHsl(stroke.gradA, stroke.gradB, t);
    }
    case 'fixed': return [stroke.hue, 92, 63];
    case 'angle': {
      const a = Math.atan2(p[1], p[0]) * 180 / Math.PI;
      return [((a % 360) + 360) % 360, 92, 63];
    }
    case 'speed': return [clamp(200 - p[2] * 90, 0, 360), 92, 63];
    case 'blueprint': {
      const inks = [197, 27, 145, 6];       // accent, safety, go, redline
      return [inks[Math.floor(p[3] / 900) % inks.length], 92, 63];
    }
    default: return [(stroke.hue + stroke.hueRate * p[3]) % 360, 92, 63];
  }
}

/* ═══════════════════════════════════════════════════════════════
   Brushes
   ═══════════════════════════════════════════════════════════════ */

/* The silk brush, drawn one segment at a time so it can be laid
   down live and replayed identically. Strand offsets are fixed for
   the whole stroke and derived from its seed, which is why an undo
   redraws exactly what was there. */
function silkSegment(g, stroke, i, light) {
  const p0 = stroke.pts[i - 1], p1 = stroke.pts[i];
  const x0 = p0[0] * S, y0 = p0[1] * S, x1 = p1[0] * S, y1 = p1[1] * S;
  let dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const ox = -dy / len, oy = dx / len;

  /* v is in pixels per millisecond. Drawing by hand runs roughly
     0.1 (careful) to 3 (a flick), so the falloff is tuned across
     that decade — and made exponential rather than linear, because
     a linear ramp hits its floor at everyday speeds and then throws
     away every distinction above it. Slow strokes come out thick and
     bright, fast ones thin and faint, and the strands fan as they go. */
  const v = p1[2];
  const spread = (1 + v * 6) * stroke.spread * stroke.size;
  const width = clamp(2.6 * Math.exp(-v * 0.5), 0.5, 2.6) * stroke.size;
  const alpha = clamp(0.48 * Math.exp(-v * 0.75), 0.05, 0.48);
  const col = colorAt(stroke, p1);

  g.globalCompositeOperation = blendFor('silk', light);
  g.strokeStyle = css(col, alpha, light);
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  for (let s = 0; s < stroke.offsets.length; s++) {
    const o = stroke.offsets[s] * spread;
    g.moveTo(x0 + ox * o, y0 + oy * o);
    g.lineTo(x1 + ox * o, y1 + oy * o);
  }
  g.stroke();
}

function spraySegment(g, stroke, i, light) {
  const p1 = stroke.pts[i];
  const x1 = p1[0] * S, y1 = p1[1] * S;
  const col = colorAt(stroke, p1);
  const rad = (3 + p1[2] * 90) * stroke.size;
  g.globalCompositeOperation = blendFor('spray', light);
  g.fillStyle = css(col, 0.4, light);
  const r = stroke.rng;
  for (let n = 0; n < 6; n++) {
    const a = r() * TAU, d = Math.sqrt(r()) * rad;
    g.beginPath();
    g.arc(x1 + Math.cos(a) * d, y1 + Math.sin(a) * d, 0.7 * stroke.size, 0, TAU);
    g.fill();
  }
}

function chainSegment(g, stroke, i, light) {
  const p1 = stroke.pts[i];
  const x1 = p1[0] * S, y1 = p1[1] * S;
  const col = colorAt(stroke, p1);
  const reach = 34 * stroke.size;
  g.globalCompositeOperation = blendFor('chain', light);
  g.strokeStyle = css(col, 0.3, light);
  g.lineWidth = 0.7 * stroke.size;
  g.beginPath();
  for (let j = Math.max(0, i - 42); j < i; j += 2) {
    const q = stroke.pts[j];
    const qx = q[0] * S, qy = q[1] * S;
    const d = Math.hypot(qx - x1, qy - y1);
    if (d < reach) { g.moveTo(x1, y1); g.lineTo(qx, qy); }
  }
  g.stroke();
}

/* Ribbon and ink use perfect-freehand, which turns the pointer path
   into a pressure-variable outline instead of a stroked line. The
   whole outline changes as points arrive, so these are drawn as one
   filled shape rather than incrementally. */
function outlineFor(stroke, done) {
  const pts = stroke.pts.map(p => [p[0] * S, p[1] * S, p[4]]);
  return getStroke(pts, {
    size: (stroke.brush === 'ink' ? 9 : 15) * stroke.size,
    thinning: 0.62,
    smoothing: 0.6,
    streamline: 0.42,
    simulatePressure: !stroke.hasPressure,
    last: done
  });
}

function drawOutline(g, stroke, light, done) {
  const o = outlineFor(stroke, done);
  if (o.length < 3) return;
  const mid = stroke.pts[Math.floor(stroke.pts.length / 2)] || stroke.pts[0];
  const col = colorAt(stroke, mid);
  g.globalCompositeOperation = blendFor(stroke.brush, light);
  g.fillStyle = css(col, stroke.brush === 'ink' ? 0.95 : 0.5, light);
  g.beginPath();
  g.moveTo(o[0][0], o[0][1]);
  for (let i = 1; i < o.length; i++) g.lineTo(o[i][0], o[i][1]);
  g.closePath();
  g.fill();
}

const INCREMENTAL = { silk: silkSegment, spray: spraySegment, chain: chainSegment };

/* ═══════════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════════ */
function renderStroke(g, stroke, light, done = true) {
  const fn = INCREMENTAL[stroke.brush];
  withSymmetry(g, stroke.k, stroke.mirror, gg => {
    // Reset per copy so every copy is identical — that is the point.
    stroke.rng = mulberry32(stroke.seed);
    if (fn) for (let i = 1; i < stroke.pts.length; i++) fn(gg, stroke, i, light);
    else drawOutline(gg, stroke, light, done);
  });
  g.globalCompositeOperation = 'source-over';
}

function renderAll() {
  const g = paint.ctx;
  const light = isLight();
  paint.clear();
  paintPaper(g, W, H);
  if (base && base.width) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(base, 0, 0, paint.canvas.width, paint.canvas.height);
    g.restore();
  }
  for (const s of strokes) renderStroke(g, s, light);
}

/* Keep memory bounded without throwing away the ability to undo:
   the oldest strokes are flattened into a bitmap and dropped from
   the list, so undo depth stays useful but history does not grow
   without limit. */
function bakeIfNeeded() {
  if (strokes.length <= MAX_STROKES) return;
  const light = isLight();
  if (!base) base = document.createElement('canvas');
  if (base.width !== paint.canvas.width || base.height !== paint.canvas.height) {
    const old = base;
    base = document.createElement('canvas');
    base.width = paint.canvas.width; base.height = paint.canvas.height;
    if (old.width) base.getContext('2d').drawImage(old, 0, 0, base.width, base.height);
  }
  const bg = base.getContext('2d');
  bg.save();
  bg.setTransform(DPR, 0, 0, DPR, 0, 0);
  const cut = strokes.length - BAKE_TO;
  for (let i = 0; i < cut; i++) renderStroke(bg, strokes[i], light);
  bg.restore();
  strokes.splice(0, cut);
}

/* ═══════════════════════════════════════════════════════════════
   Input
   ═══════════════════════════════════════════════════════════════ */
const currentGradient = () =>
  GRADIENTS[state.gradient] || [state.colA, state.colB];

function beginStroke(x, y, pressure, hasPressure) {
  redoStack.length = 0;
  const [nx, ny] = toNorm(x, y);
  const seed = (Math.random() * 1e9) | 0;
  const rng = mulberry32(seed);
  const offsets = [];
  const n = Math.max(1, state.strands | 0);
  for (let i = 0; i < n; i++) offsets.push(n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 + (rng() - 0.5) * 0.35);

  current = {
    brush: state.brush,
    k: state.k, mirror: state.mirror, wedge: state.wedge,
    size: state.size,
    spread: state.spread,
    colorMode: state.colorMode,
    hue: state.colorMode === 'fixed' ? state.hue : (state.hue + Math.random() * 40) % 360,
    hueRate: state.hueRate,
    gradRate: state.gradRate,
    gradA: hexToHsl(currentGradient()[0]),
    gradB: hexToHsl(currentGradient()[1]),
    seed, offsets, rng: mulberry32(seed),
    hasPressure,
    t0: performance.now(),
    pts: [[nx, ny, 0, 0, pressure]]
  };
  lastPt = { x, y, t: current.t0 };
  drawing = true;
}

function extendStroke(x, y, pressure) {
  if (!current) return;
  const now = performance.now();
  const [nx, ny] = toNorm(x, y);
  const dt = Math.max(1, now - lastPt.t);
  const v = Math.hypot(x - lastPt.x, y - lastPt.y) / dt;   // px per ms
  const prev = current.pts[current.pts.length - 1];
  if (Math.hypot(nx - prev[0], ny - prev[1]) * S < 0.7) return;

  current.pts.push([nx, ny, v, now - current.t0, pressure]);
  lastPt = { x, y, t: now };

  // Silk-family brushes lay down as they go; outline brushes are
  // previewed whole on the live layer and committed on release.
  const fn = INCREMENTAL[current.brush];
  if (fn) {
    const light = isLight();
    const i = current.pts.length - 1;
    withSymmetry(paint.ctx, current.k, current.mirror,
                 gg => fn(gg, current, i, light));
    paint.ctx.globalCompositeOperation = 'source-over';
  }
}

function endStroke() {
  if (!current) return;
  drawing = false;
  live.clear();
  if (current.pts.length > 1) {
    if (!INCREMENTAL[current.brush]) renderStroke(paint.ctx, current, isLight(), true);
    strokes.push(current);
    bakeIfNeeded();
    // Idle self-drawing is a screensaver, not the visitor's work —
    // it renders and undoes normally but is never written to storage,
    // so nobody comes back to a sheet they did not draw.
    if (!current.auto) scheduleSave();
  }
  current = null;
  idleSince = performance.now();
}

/* ═══════════════════════════════════════════════════════════════
   Persistence — quantised, debounced, and never allowed to throw
   ═══════════════════════════════════════════════════════════════ */
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}

function save() {
  try {
    const q = n => Math.round(n * 1000) / 1000;
    const data = {
      v: 1,
      s: strokes.slice(-120).map(s => ({
        b: s.brush, k: s.k, m: s.mirror ? 1 : 0, w: s.wedge ? 1 : 0,
        z: s.size, sp: s.spread, c: s.colorMode, h: Math.round(s.hue), r: s.hueRate,
        gr: s.gradRate, ga: s.gradA, gb: s.gradB,
        e: s.seed, o: s.offsets.map(q), p: s.hasPressure ? 1 : 0,
        pts: s.pts.map(p => [q(p[0]), q(p[1]), q(p[2]), Math.round(p[3]), q(p[4])])
      }))
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    // Quota, private mode, or a browser that throws on any access.
    // A drawing that does not survive a reload is a small loss; an
    // exception here would take the whole exhibit down.
  }
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !Array.isArray(data.s)) return;
    strokes = data.s.map(s => ({
      brush: s.b, k: s.k, mirror: !!s.m, wedge: !!s.w, size: s.z,
      spread: s.sp == null ? 1 : s.sp,
      colorMode: s.c, hue: s.h, hueRate: s.r, seed: s.e,
      gradRate: s.gr == null ? 0.6 : s.gr,
      gradA: s.ga || [200, 90, 62], gradB: s.gb || [320, 90, 62],
      offsets: s.o, hasPressure: !!s.p, rng: mulberry32(s.e), t0: 0,
      pts: s.pts
    }));
  } catch (e) { strokes = []; }
}

/* ═══════════════════════════════════════════════════════════════
   Export

   Re-rendering from history rather than scaling the visible canvas
   is what makes a genuinely 4× file possible.

   Note: the download below works on the deployed site. Inside a
   sandboxed artifact viewer, downloads that a page starts itself
   are inert — if this page is ever published that way, this button
   has to fall back to opening the image in a new tab.
   ═══════════════════════════════════════════════════════════════ */
function exportPNG(scale = 3) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale);
  cv.height = Math.round(H * scale);
  const g = cv.getContext('2d');
  const light = isLight();

  const sS = S, sCX = CX, sCY = CY;
  S = sS * scale; CX = sCX * scale; CY = sCY * scale;
  g.setTransform(1, 0, 0, 1, 0, 0);
  paintPaper(g, cv.width, cv.height);
  if (base && base.width) g.drawImage(base, 0, 0, cv.width, cv.height);
  for (const s of strokes) renderStroke(g, s, light);
  S = sS; CX = sCX; CY = sCY;

  cv.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `silk-${state.k}fold-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    announce('Image saved.');
  }, 'image/png');
}

/* ═══════════════════════════════════════════════════════════════
   Exhibit
   ═══════════════════════════════════════════════════════════════ */
const exhibit = {
  id: 'silk',
  code: 'E-03.2',
  name: 'Silk',
  title: 'Silk',
  state,
  autorun: true,
  hint: 'Draw anywhere. Symmetry is applied as you go.',

  controls: [
    { type: 'group', label: 'Symmetry', children: [
      { type: 'range', key: 'k', label: 'Fold', min: 1, max: 24, step: 1,
        fmt: v => v + '×' },
      { type: 'toggle', key: 'mirror', label: 'Mirror' },
      { type: 'toggle', key: 'wedge', label: 'Kaleidoscope wedge' },
      { type: 'toggle', key: 'guides', label: 'Show guides' }
    ] },

    { type: 'group', label: 'Brush', children: [
      { type: 'select', key: 'brush', label: 'Type', options: [
        { value: 'silk',   label: 'Silk — strands' },
        { value: 'ribbon', label: 'Ribbon — tapered' },
        { value: 'ink',    label: 'Ink — opaque' },
        { value: 'spray',  label: 'Spray' },
        { value: 'chain',  label: 'Chain — web' }
      ] },
      { type: 'range', key: 'size', label: 'Size', min: 0.3, max: 3, step: 0.05,
        fmt: v => v.toFixed(2) + '×' },
      { type: 'range', key: 'strands', label: 'Strands', min: 1, max: 14, step: 1,
        when: s => s.brush === 'silk' },
      { type: 'range', key: 'spread', label: 'Strand spread', min: 0.1, max: 3, step: 0.05,
        when: s => s.brush === 'silk', fmt: v => v.toFixed(2) + '×' }
    ] },

    { type: 'group', label: 'Colour', children: [
      { type: 'select', key: 'colorMode', label: 'Mode', options: [
        { value: 'gradient',  label: 'Gradient' },
        { value: 'drift',     label: 'Drift over time' },
        { value: 'fixed',     label: 'Fixed hue' },
        { value: 'angle',     label: 'By angle' },
        { value: 'speed',     label: 'By speed' },
        { value: 'blueprint', label: 'Blueprint inks' }
      ] },
      { type: 'range', key: 'hue', label: 'Hue', min: 0, max: 359, step: 1,
        when: s => s.colorMode === 'fixed' || s.colorMode === 'drift',
        fmt: v => v + '°' },
      { type: 'range', key: 'hueRate', label: 'Drift rate', min: 0, max: 0.3, step: 0.005,
        when: s => s.colorMode === 'drift', fmt: v => v.toFixed(3) + '°/ms' },
      { type: 'select', key: 'gradient', label: 'Gradient',
        when: s => s.colorMode === 'gradient', options: GRADIENT_OPTIONS },
      { type: 'color', key: 'colA', label: 'From',
        when: s => s.colorMode === 'gradient' && s.gradient === 'custom' },
      { type: 'color', key: 'colB', label: 'To',
        when: s => s.colorMode === 'gradient' && s.gradient === 'custom' },
      { type: 'range', key: 'gradRate', label: 'Gradient speed', min: 0.05, max: 2, step: 0.05,
        when: s => s.colorMode === 'gradient', fmt: v => v.toFixed(2) + '×' }
    ] },

    { type: 'group', label: 'Sheet', children: [
      { type: 'toggle', key: 'autodraw', label: 'Draw itself when idle' },
      { type: 'button', key: 'undo', label: 'Undo' },
      { type: 'button', key: 'redo', label: 'Redo' },
      { type: 'button', key: 'png', label: 'Save PNG', primary: true },
      { type: 'button', key: 'clear', label: 'Clear', danger: true }
    ] }
  ],

  init(ctx) {
    stage = ctx.stage;
    paint = makeLayer(stage, { alpha: false });   // see paintPaper()
    live = makeLayer(stage);
    stage.classList.add('grab');
    stage.style.touchAction = 'none';
    strokes = []; redoStack = []; base = null; current = null;
    load();
    idleSince = performance.now();
    attachPointer();
  },

  resize(w, h, dpr) {
    DPR = dpr;
    computeFrame(w, h);
    paint.fit(w, h, dpr);
    live.fit(w, h, dpr);
    renderAll();
  },

  onSet(key) {
    if (key === 'k' || key === 'mirror') guideUntil = performance.now() + 900;
  },

  onAction(key) {
    if (key === 'undo') {
      if (!strokes.length) return;
      redoStack.push(strokes.pop());
      renderAll(); scheduleSave();
      announce('Undone. ' + strokes.length + ' strokes remain.');
    } else if (key === 'redo') {
      if (!redoStack.length) return;
      strokes.push(redoStack.pop());
      renderAll(); scheduleSave();
    } else if (key === 'clear') {
      redoStack = strokes.slice(-40).reverse();
      strokes = []; base = null;
      renderAll(); scheduleSave();
      announce('Cleared. Undo restores the last strokes.');
    } else if (key === 'png') {
      exportPNG(3);
    } else if (key === 'reset') {
      this.onAction('clear');
    }
  },

  frame(dt) {
    const now = performance.now();
    const g = live.ctx;
    const preview = drawing && current &&
                    !INCREMENTAL[current.brush] && current.pts.length > 1;
    const guides = state.guides && now < guideUntil;

    // Clearing a full-size canvas sixty times a second for nothing is
    // a real battery cost on a sheet that is idle most of the time.
    if (preview || guides || liveDirty) {
      live.clear();
      liveDirty = preview || guides;
    }
    if (preview) renderStroke(g, current, isLight(), false);
    if (guides) drawGuides(g, (guideUntil - now) / 900);

    if (state.autodraw && !drawing && now - idleSince > 20000) autoDraw(dt);
  },

  repaint() { renderAll(); },

  telemetry() {
    return {
      rows: [
        ['Fold', state.k + (state.mirror ? ' × mirror' : '')],
        ['Strokes', String(strokes.length)],
        ['Copies', String(state.k * (state.mirror ? 2 : 1))],
        ['Brush', state.brush]
      ],
      progress: null,
      note: strokes.length === 0
        ? 'Draw anywhere on the sheet. Undo is non-destructive — the drawing is stored as strokes, not pixels.'
        : null,
      aria: `Symmetric drawing surface, ${state.k}-fold` +
            (state.mirror ? ' mirrored' : '') + `, ${strokes.length} strokes.`
    };
  },

  destroy() {
    clearTimeout(saveTimer);
    save();
    detachPointer();
    stage.classList.remove('grab');
    stage.style.touchAction = '';
  }
};

function drawGuides(g, fade) {
  const k = Math.max(1, state.k | 0);
  g.save();
  g.globalAlpha = clamp(fade, 0, 1) * 0.5;
  g.strokeStyle = ink('accent');
  g.setLineDash([3, 5]);
  g.lineWidth = 1;
  const r = Math.hypot(W, H);
  for (let i = 0; i < k; i++) {
    const a = i * TAU / k;
    g.beginPath();
    g.moveTo(CX, CY);
    g.lineTo(CX + Math.cos(a) * r, CY + Math.sin(a) * r);
    g.stroke();
  }
  g.setLineDash([]);
  g.restore();
}

/* A slow rose curve, so an idle sheet is never a blank one. */
function autoDraw(dt) {
  autoPhase += dt * 0.0013;
  const t = autoPhase;
  const r = (0.30 + 0.26 * Math.sin(t * 0.7)) * S;
  const x = CX + Math.cos(t * 2.3) * r;
  const y = CY + Math.sin(t * 3.1) * r;
  if (!current) { beginStroke(x, y, 0.5, false); current.auto = true; }
  else if (current.pts.length > 900) { endStroke(); idleSince = performance.now() - 19000; }
  else extendStroke(x, y, 0.5);
}

/* ═══════════════════════════════════════════════════════════════
   Pointer — coalesced events so a 120Hz stylus is not decimated
   ═══════════════════════════════════════════════════════════════ */
let onDown, onMove, onUp;

function attachPointer() {
  const pos = e => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  onDown = e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (current) endStroke();          // the idle auto-stroke, if any
    e.preventDefault();
    const p = pos(e);
    const hasP = e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5;
    beginStroke(p.x, p.y, e.pressure || 0.5, hasP);
    idleSince = performance.now();
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  };

  onMove = e => {
    if (!drawing) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = pos(ev);
      extendStroke(p.x, p.y, ev.pressure || 0.5);
    }
    idleSince = performance.now();
  };

  onUp = () => { if (drawing) endStroke(); };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
}

function detachPointer() {
  stage.removeEventListener('pointerdown', onDown);
  stage.removeEventListener('pointermove', onMove);
  removeEventListener('pointerup', onUp);
  removeEventListener('pointercancel', onUp);
}

export default exhibit;
