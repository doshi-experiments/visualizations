/* ═══════════════════════════════════════════════════════════════
   9 · E-03.4 HARMONOGRAPH — drawing with a pendulum

   A Victorian harmonograph is a drawing machine: a pen on one
   pendulum, a table on another, and the figure is whatever their
   two rhythms agree on. This one gives you the pendulum and lets
   you hold it. Your pointer is the pivot. A hundred and forty
   double pendulums hang off it, each started a hundred-millionth
   of a radian from the last, and their lower bobs are the ink.

   ── The thing that makes it a tool rather than a toy ──

   A pendulum whose pivot is dragged around is not the fixed-pivot
   system next door in Divergence. It is in an accelerating frame,
   and every mass in it feels a pseudo-force −a. Leave that out and
   the bobs are towed along rigidly, arriving wherever your hand
   arrives, never swinging: the brush is dead in the hand. Put it
   in and gravity becomes a vector that tilts and stretches as you
   accelerate, so a flick of the wrist lashes them and a steady
   glide does not excite them at all — which is both the correct
   physics and, it turns out, the correct feel. effectiveGravity()
   in pendulum.js does the work.

   ── Why the fold is free ──

   withSymmetry rotates about the centre of the sheet, so each of
   the k copies carries its own rotated "down". That is a
   deliberate lie about physics in the service of the image — a
   kaleidoscope's gravity — and it is what lets one ensemble be
   integrated and then drawn k×2 times. The cost of the simulation
   does not depend on the fold at all, which is the only reason
   140 pendulums at 24-fold is affordable.

   ── The ink ──

   Line width and alpha fall off with tip speed, the same
   exponential rule that makes E-03.2 read as silk rather than as
   a marker. A double pendulum's tip speed varies enormously
   inside a single swing, so the trace thickens at the cusps where
   it turns and thins to nothing through the fast sweeps. That is
   the whole reason this exhibit belongs beside Silk.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import {
  ink, makeLayer, clamp, TAU, isLight, isRunning, setRunning,
  announce, getQuality, fmtTime
} from './shell.js';
import { rk4, effectiveGravity } from './pendulum.js';
import {
  GRADIENTS, GRADIENT_OPTIONS, hexToHsl, mixHsl, css, blendFor,
  withSymmetry, paintPaper
} from './silkkit.js';

const DT = 1 / 240;              // seconds per RK4 step — fixed
const MAX_SUBSTEPS = 12;
const MAX_UNDO = 3;              // bitmaps, and they are not small
const OMEGA_CAP = 120;           // rad/s — the last line of defence

let stage, paint, sprite;
let W = 0, H = 0, CX = 0, CY = 0;
let armScale = 60;
let gridOnSheet = true;
let lastLight = null;            // so repaint() can tell a theme flip from a resize
let sheetPaper = '';             // the paper colour this sheet was actually painted in

/* Ensemble */
let y = null;                    // Float64Array, 4 per pendulum
let prevX = null, prevY = null;  // last tip, in draw space (relative to centre)
let N = 0;
let live = false;                // an ensemble is swinging and inking
let tailLeft = 0;                // seconds of follow-through remaining
let simT = 0, acc = 0;
let strokeCount = 0;
let meanTip = 0;

/* Pivot, in draw space */
let pvx = 0, pvy = 0;            // where the pivot is
let tgx = 0, tgy = 0;            // where the pointer says it should be
let vx = 0, vy = 0, ax = 0, ay = 0;
let drawing = false;

/* Symmetry recorded at stroke start, so changing the fold mid-air
   cannot rewrite what is already down. */
let strokeK = 6, strokeMirror = true;
let guideUntil = 0;

let undoStack = [];
const frame = { cx: 0, cy: 0 };
const P = { l1: 1, l2: 1, m1: 1, m2: 1, g: 9.81, damp: 0.08 };

const state = {
  k: 6,
  mirror: true,
  guides: true,

  count: 140,
  epsExp: -8,
  armPct: 26,
  armRatio: 1,
  massRatio: 1,
  gravity: 9.81,
  damp: 0.08,
  tail: 2.5,
  timeScale: 1,

  colorMode: 'fan',
  gradient: 'ultra',
  colA: '#5ce1ff',
  colB: '#ff5cc8',
  size: 1,
  glow: 1,
  persistence: 1,

  rods: true,
  bobs: true,
  pivot: true
};

/* ═══════════════════════════════════════════════════════════════
   Geometry and parameters
   ═══════════════════════════════════════════════════════════════ */
function syncParams() {
  P.l2 = state.armRatio;
  P.m2 = state.massRatio;
  P.g = state.gravity;
  P.damp = state.damp;
}

function layout(w, h) {
  W = w; H = h;
  CX = w / 2; CY = h / 2;
  frame.cx = CX; frame.cy = CY;
  // armPct is the pendulum's full reach as a percentage of half the
  // short edge, so the brush is the same size on any screen.
  const reachPx = (Math.min(w, h) / 2) * (state.armPct / 100);
  armScale = Math.max(6, reachPx / (1 + state.armRatio));
}

/* ═══════════════════════════════════════════════════════════════
   The ensemble
   ═══════════════════════════════════════════════════════════════ */
function build() {
  syncParams();
  N = clamp(state.count | 0, 1, 400);
  y = new Float64Array(N * 4);
  prevX = new Float64Array(N);
  prevY = new Float64Array(N);

  /* Hanging dead straight is a fixed point: with no drive, nothing
     would happen until the hand moved, and a brush that is inert
     for its first half second feels broken. So they start already
     off vertical and already falling. */
  const eps = Math.pow(10, state.epsExp);
  const a1 = 32 * Math.PI / 180, a2 = -22 * Math.PI / 180;
  for (let i = 0; i < N; i++) {
    y[i * 4] = a1 + i * eps;      // only θ₁ is perturbed, and only just
    y[i * 4 + 1] = 0;
    y[i * 4 + 2] = a2;
    y[i * 4 + 3] = 0;
  }
  seedPrev();
}

function tipOf(i, ox, oy, out) {
  const b = i * 4;
  out[0] = ox + (Math.sin(y[b]) * P.l1 + Math.sin(y[b + 2]) * P.l2) * armScale;
  out[1] = oy + (Math.cos(y[b]) * P.l1 + Math.cos(y[b + 2]) * P.l2) * armScale;
}

const scratch = [0, 0];
function seedPrev() {
  for (let i = 0; i < N; i++) {
    tipOf(i, pvx, pvy, scratch);
    prevX[i] = scratch[0]; prevY[i] = scratch[1];
  }
}

/* Separation in the full phase space, not just θ₁ — the same
   measure Divergence uses, because it is the same quantity: the
   width of the fan you are painting with. */
function separation() {
  if (N < 2) return 0;
  let s = 0;
  for (let i = 0; i < 4; i++) { const d = y[i] - y[4 + i]; s += d * d; }
  return Math.sqrt(s);
}

/* ═══════════════════════════════════════════════════════════════
   Colour
   ═══════════════════════════════════════════════════════════════ */
const BLUEPRINT = [197, 27, 145, 6];   // accent, safety, go, redline
const currentGradient = () => GRADIENTS[state.gradient] || [state.colA, state.colB];

function bucketColour(b, B, v) {
  const t = B < 2 ? 0 : b / (B - 1);
  switch (state.colorMode) {
    case 'gradient':
      return mixHsl(hexToHsl(currentGradient()[0]), hexToHsl(currentGradient()[1]), t);
    case 'speed':
      return [clamp(200 - v * 90, 0, 360), 92, 63];
    case 'blueprint':
      return [BLUEPRINT[b % BLUEPRINT.length], 92, 63];
    default:                         // 'fan' — the Divergence rainbow
      return [t * 330, 88, 64];
  }
}

/* Buckets are contiguous slices of the fan, so their members move
   almost identically until they decohere — which is what makes it
   honest to give a whole bucket one width and one alpha instead of
   asking the rasteriser for 140 separate stroke styles. */
function bucketCount() {
  const q = getQuality();
  const base = q >= 2 ? 24 : q === 1 ? 12 : 6;
  return Math.max(1, Math.min(base, N));
}

/* ═══════════════════════════════════════════════════════════════
   Painting
   ═══════════════════════════════════════════════════════════════ */
function fadeAmount() {
  if (state.persistence >= 0.995) return 0;
  return Math.pow(10, -3.3 * state.persistence);
}

function repaper() {
  const g = paint.ctx;
  paint.clear();
  // With a fade running, a wash over the whole sheet would eat the
  // drafting grid unevenly. Cleaner to have drawn no grid at all
  // than a half-digested one, so the grid is a paint-mode feature.
  paintPaper(g, W, H, { grid: fadeAmount() === 0 });
  // Remembered because reink() needs to know what colour the paper
  // *was*, and by the time it runs the theme has already moved on.
  sheetPaper = ink('paper-0');
}

/* Ageing an *opaque* layer cannot use destination-out — that would
   punch holes through to nothing. Washing with the paper colour
   converges on exactly the paper colour instead of asymptotically
   near it, so there is no residue to go glaring on the light sheet;
   this is the one case where the naive fade is the correct one. */
function ageSheet() {
  const a = fadeAmount();
  if (a <= 0) return;
  const g = paint.ctx;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = a;
  g.fillStyle = ink('paper-0');
  g.fillRect(0, 0, paint.canvas.width, paint.canvas.height);
  g.restore();
}

/* One frame of physics, laying ink as it goes.

   Loops are pendulum-outer, substep-inner. The pendulums are
   uncoupled, so this is legal, and it means each one's ink for the
   whole frame is a single continuous subpath — no per-substep
   interleaving that would leave every segment its own stub with a
   visible notch at the joins. */
function integrate(dtSec) {
  acc += dtSec;
  let S = 0;
  while (acc >= DT && S < MAX_SUBSTEPS) { acc -= DT; S++; }
  if (S === MAX_SUBSTEPS) acc = 0;
  if (S === 0) return;

  simT += S * DT;

  /* The pivot's path across this frame, sampled per substep. The
     240Hz integrator seeing a 60Hz staircase would read as four
     impulses per frame rather than a smooth drag. */
  const px = [], py = [];
  for (let s = 1; s <= S; s++) {
    const t = s / S;
    px.push(pvx + (tgx - pvx) * t);
    py.push(pvy + (tgy - pvy) * t);
  }

  /* Acceleration is held constant across the frame, so the frame
     rotation φ is too — which is what makes the coordinate shift
     below exact within a step rather than an approximation. */
  const eg = effectiveGravity(ax / armScale, ay / armScale,
                              state.gravity, state.gravity * 8);
  P.g = eg.G;
  const phi = eg.phi;

  const B = bucketCount();
  if (sumLen.length !== B) { sumLen = new Float64Array(B); count = new Int32Array(B); }
  else { sumLen.fill(0); count.fill(0); }
  const paths = new Array(B);
  for (let b = 0; b < B; b++) paths[b] = new Path2D();

  for (let i = 0; i < N; i++) {
    const b4 = i * 4;
    const bi = Math.min(B - 1, (i * B / N) | 0);
    const path = paths[bi];
    let lx = prevX[i], ly = prevY[i];
    path.moveTo(lx, ly);

    for (let s = 0; s < S; s++) {
      y[b4] -= phi; y[b4 + 2] -= phi;
      rk4(y, b4, DT, P);
      y[b4] += phi; y[b4 + 2] += phi;

      // Belt and braces on top of the gravity clamp: a pendulum that
      // has somehow been spun up past this is about to become NaN and
      // take the rest of the frame with it.
      if (y[b4 + 1] > OMEGA_CAP) y[b4 + 1] = OMEGA_CAP;
      else if (y[b4 + 1] < -OMEGA_CAP) y[b4 + 1] = -OMEGA_CAP;
      if (y[b4 + 3] > OMEGA_CAP) y[b4 + 3] = OMEGA_CAP;
      else if (y[b4 + 3] < -OMEGA_CAP) y[b4 + 3] = -OMEGA_CAP;

      tipOf(i, px[s], py[s], scratch);
      const tx = scratch[0], ty = scratch[1];
      path.lineTo(tx, ty);
      sumLen[bi] += Math.hypot(tx - lx, ty - ly);
      count[bi]++;
      lx = tx; ly = ty;
    }
    prevX[i] = lx; prevY[i] = ly;
  }

  pvx = tgx; pvy = tgy;
  strokeInk(paths, B);
}

/* Per-bucket accumulators, held across frames so a 60Hz loop is not
   handing the collector three fresh typed arrays a second. */
let sumLen = new Float64Array(0);
let count = new Int32Array(0);

function strokeInk(paths, B) {
  const light = isLight();
  const blend = blendFor('silk', light);
  const g = paint.ctx;

  // px per ms, which is the range Silk's falloff constants are tuned
  // across: about 0.1 for a careful hand and 3 for a flick.
  const perMs = DT * 1000;
  const cols = new Array(B);
  const widths = new Float64Array(B);
  const alphas = new Float64Array(B);
  let vSum = 0, vN = 0;

  for (let b = 0; b < B; b++) {
    if (!count[b]) continue;
    const v = (sumLen[b] / count[b]) / perMs;
    vSum += v; vN++;
    widths[b] = clamp(2.6 * Math.exp(-v * 0.5), 0.5, 2.6) * state.size;
    alphas[b] = clamp(0.48 * Math.exp(-v * 0.75), 0.05, 0.48) * state.glow;
    cols[b] = bucketColour(b, B, v);
  }
  meanTip = vN ? vSum / vN : 0;

  withSymmetry(g, frame, strokeK, strokeMirror, gg => {
    gg.globalCompositeOperation = blend;
    gg.lineCap = 'round';
    gg.lineJoin = 'round';
    for (let b = 0; b < B; b++) {
      if (!count[b]) continue;
      gg.lineWidth = widths[b];
      gg.strokeStyle = css(cols[b], alphas[b], light);
      gg.stroke(paths[b]);
    }
  });
  g.globalCompositeOperation = 'source-over';
}

/* ═══════════════════════════════════════════════════════════════
   The machine, drawn over its own drawing
   ═══════════════════════════════════════════════════════════════ */
function drawSprite() {
  const g = sprite.ctx;
  g.clearRect(0, 0, W, H);
  const light = isLight();
  const now = performance.now();
  const showGuides = state.guides && now < guideUntil;

  if (showGuides) {
    g.save();
    g.globalAlpha = clamp((guideUntil - now) / 900, 0, 1) * 0.5;
    g.strokeStyle = ink('accent');
    g.setLineDash([3, 5]);
    g.lineWidth = 1;
    const r = Math.hypot(W, H);
    const k = Math.max(1, state.k | 0);
    for (let i = 0; i < k; i++) {
      const a = i * TAU / k;
      g.beginPath();
      g.moveTo(CX, CY);
      g.lineTo(CX + Math.cos(a) * r, CY + Math.sin(a) * r);
      g.stroke();
    }
    g.restore();
  }

  if (!live || !(state.rods || state.bobs || state.pivot)) return;

  const B = bucketCount();
  const rods = new Array(B), bobs = new Array(B), cols = new Array(B);
  for (let b = 0; b < B; b++) {
    rods[b] = new Path2D(); bobs[b] = new Path2D();
    cols[b] = bucketColour(b, B, meanTip);
  }

  const r = N > 120 ? 1.5 : 2.6;
  for (let i = 0; i < N; i++) {
    const b4 = i * 4;
    const bi = Math.min(B - 1, (i * B / N) | 0);
    const x1 = pvx + Math.sin(y[b4]) * P.l1 * armScale;
    const y1 = pvy + Math.cos(y[b4]) * P.l1 * armScale;
    if (state.rods) {
      rods[bi].moveTo(pvx, pvy); rods[bi].lineTo(x1, y1);
      rods[bi].lineTo(prevX[i], prevY[i]);
    }
    if (state.bobs) {
      bobs[bi].moveTo(prevX[i] + r, prevY[i]);
      bobs[bi].arc(prevX[i], prevY[i], r, 0, TAU);
    }
  }

  withSymmetry(g, frame, strokeK, strokeMirror, gg => {
    gg.lineWidth = N > 200 ? 0.6 : 1;
    gg.globalAlpha = N > 200 ? 0.35 : N > 60 ? 0.5 : 0.8;
    for (let b = 0; b < B; b++) {
      gg.strokeStyle = css(cols[b], 1, light);
      if (state.rods) gg.stroke(rods[b]);
    }
    gg.globalAlpha = 1;
    for (let b = 0; b < B; b++) {
      gg.fillStyle = css(cols[b], 1, light);
      if (state.bobs) gg.fill(bobs[b]);
    }
    if (state.pivot) {
      gg.strokeStyle = ink('ink-dim');
      gg.lineWidth = 1;
      gg.beginPath();
      gg.moveTo(pvx - 7, pvy); gg.lineTo(pvx + 7, pvy);
      gg.moveTo(pvx, pvy - 7); gg.lineTo(pvx, pvy + 7);
      gg.stroke();
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   Undo — bitmaps, deliberately

   Silk stores strokes and re-renders, which buys it unlimited undo
   and a genuinely 4× export. That is not available here. Replaying
   one five-second drag means 168,000 RK4 steps and around two
   million rasterised segments; a sheet's worth would take the best
   part of a minute, and a chaotic system cannot be replayed at a
   coarser step because a coarser step is a different system.

   So undo is a small ring of snapshots of the paint layer. Each is
   the full canvas at device resolution — around 20MB on a large
   retina display — which is exactly why it is three deep and not
   thirty. Past that, Clear.
   ═══════════════════════════════════════════════════════════════ */
function snapshot() {
  const c = document.createElement('canvas');
  c.width = paint.canvas.width;
  c.height = paint.canvas.height;
  c.getContext('2d').drawImage(paint.canvas, 0, 0);
  // The stroke count travels with the bitmap, so undoing a Clear
  // puts the tally back where it was rather than off by one.
  undoStack.push({ canvas: c, strokes: strokeCount });
  while (undoStack.length > MAX_UNDO) undoStack.shift();
}

function restore() {
  const snap = undoStack.pop();
  if (!snap) return false;
  const g = paint.ctx;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, paint.canvas.width, paint.canvas.height);
  g.drawImage(snap.canvas, 0, 0, paint.canvas.width, paint.canvas.height);
  g.restore();
  strokeCount = snap.strokes;
  return true;
}

/* ═══════════════════════════════════════════════════════════════
   Theme

   The drawing is a bitmap and the two themes are near-inverses of
   each other: bright ink adding onto dark paper, dark ink
   multiplying onto white. Inverting luminance and then rotating the
   hue back where it was turns one into a fair approximation of the
   other, instantly, with no simulation. It is not what a re-inked
   drawing would look like down to the pixel — the blend modes are
   not each other's inverse — but it is the difference between
   flipping the lights and losing the work.
   ═══════════════════════════════════════════════════════════════ */
const FLIP = 'invert(1) hue-rotate(180deg)';

/* What the filter does to one colour. Asking the browser rather than
   reimplementing the sRGB hue-rotate matrix: it is three lines, and
   it cannot disagree with the filter actually applied to the sheet. */
function sample(colour, filter) {
  const a = document.createElement('canvas'); a.width = a.height = 1;
  const ag = a.getContext('2d');
  ag.fillStyle = colour; ag.fillRect(0, 0, 1, 1);
  if (!filter) return ag.getImageData(0, 0, 1, 1).data;
  const b = document.createElement('canvas'); b.width = b.height = 1;
  const bg = b.getContext('2d');
  bg.filter = filter;
  bg.drawImage(a, 0, 0);
  return bg.getImageData(0, 0, 1, 1).data;
}

function invertInto(g, src, w, h, delta) {
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').drawImage(src, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.filter = FLIP;
  g.clearRect(0, 0, w, h);
  g.drawImage(tmp, 0, 0);
  g.filter = 'none';

  /* The flip alone does not land on the new paper. This sheet's dark
     side is a deep blueprint blue and its light side is nearly
     neutral, and inverting one does not give the other — the blue
     goes missing, and then the next Clear would snap the whole sheet
     back to it. So shift everything by the constant that puts the
     paper exactly on its token: add the positive part, and subtract
     the negative part with `difference`, which is a true subtraction
     everywhere except pixels already darker than the offset itself. */
  if (delta) {
    const pos = delta.map(v => Math.max(0, v));
    const neg = delta.map(v => Math.max(0, -v));
    if (pos[0] || pos[1] || pos[2]) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgb(${pos[0]},${pos[1]},${pos[2]})`;
      g.fillRect(0, 0, w, h);
    }
    if (neg[0] || neg[1] || neg[2]) {
      g.globalCompositeOperation = 'difference';
      g.fillStyle = `rgb(${neg[0]},${neg[1]},${neg[2]})`;
      g.fillRect(0, 0, w, h);
    }
  }
  g.restore();
}

function reink() {
  const cw = paint.canvas.width, ch = paint.canvas.height;
  if (!cw || !ch) return;

  // Where the old paper lands once flipped, versus where the new
  // paper actually is.
  const was = sample(sheetPaper || ink('paper-0'), FLIP);
  const want = sample(ink('paper-0'), null);
  const delta = [Math.round(want[0] - was[0]),
                 Math.round(want[1] - was[1]),
                 Math.round(want[2] - was[2])];

  invertInto(paint.ctx, paint.canvas, cw, ch, delta);
  // The snapshots are in the old polarity too. Flipping them as well
  // costs three canvas draws and means turning the lights on does not
  // quietly cost you your undo history.
  for (const snap of undoStack)
    invertInto(snap.canvas.getContext('2d'), snap.canvas,
               snap.canvas.width, snap.canvas.height, delta);
  sheetPaper = ink('paper-0');
}

/* Export is the paint layer at its own device resolution — on a
   retina display that is already 2×. Silk can offer 3× because it
   re-renders from stored strokes; see the note above for why that
   is not on the table here.

   Downloads a page starts itself are inert inside a sandboxed
   artifact viewer. On the deployed site this works normally; if
   this page is ever published that way, this has to fall back to
   opening the image in a new tab. */
function exportPNG() {
  paint.canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `harmonograph-${state.k}fold-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    announce('Image saved at ' + paint.canvas.width + '×' + paint.canvas.height + '.');
  }, 'image/png');
}

/* ═══════════════════════════════════════════════════════════════
   Exhibit
   ═══════════════════════════════════════════════════════════════ */
const exhibit = {
  id: 'harmonograph',
  code: 'E-03.4',
  name: 'Harmonograph',
  title: 'Harmonograph',
  state,
  autorun: true,
  hint: 'Drag anywhere. The pendulums hang off your cursor — flick to make them lash.',

  controls: [
    { type: 'group', label: 'Symmetry', children: [
      { type: 'range', key: 'k', label: 'Fold', min: 1, max: 24, step: 1,
        fmt: v => v + '×' },
      { type: 'toggle', key: 'mirror', label: 'Mirror' },
      { type: 'toggle', key: 'guides', label: 'Show guides' }
    ] },

    { type: 'group', label: 'Pendulum', children: [
      { type: 'range', key: 'count', label: 'Pendulums', min: 1, max: 400, step: 1 },
      { type: 'range', key: 'epsExp', label: 'Separation ε', min: -12, max: -2, step: 1,
        fmt: v => '10' + String(v).replace('-', '⁻').replace(/\d/g,
          d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]) + ' rad' },
      { type: 'range', key: 'armPct', label: 'Reach', min: 6, max: 70, step: 1,
        fmt: v => v + '%' },
      { type: 'range', key: 'damp', label: 'Damping', min: 0, max: 0.6, step: 0.01,
        fmt: v => v < 0.005 ? 'none' : v.toFixed(2) },
      { type: 'range', key: 'tail', label: 'Follow-through', min: 0, max: 10, step: 0.1,
        fmt: v => v < 0.05 ? 'stop dead' : v.toFixed(1) + 's' },
      { type: 'range', key: 'armRatio', label: 'Arm ratio L₂/L₁', min: 0.3, max: 1.8, step: 0.01,
        fmt: v => v.toFixed(2) },
      { type: 'range', key: 'massRatio', label: 'Mass ratio m₂/m₁', min: 0.2, max: 3, step: 0.01,
        fmt: v => v.toFixed(2) },
      { type: 'range', key: 'gravity', label: 'Gravity', min: 1, max: 25, step: 0.1,
        fmt: v => v.toFixed(1) },
      { type: 'range', key: 'timeScale', label: 'Speed', min: 0.1, max: 3, step: 0.05,
        fmt: v => v.toFixed(2) + '×' }
    ] },

    { type: 'group', label: 'Ink', children: [
      { type: 'select', key: 'colorMode', label: 'Colour', options: [
        { value: 'fan',       label: 'Fan — rainbow across the ensemble' },
        { value: 'gradient',  label: 'Gradient' },
        { value: 'speed',     label: 'By tip speed' },
        { value: 'blueprint', label: 'Blueprint inks' }
      ] },
      { type: 'select', key: 'gradient', label: 'Gradient',
        when: s => s.colorMode === 'gradient', options: GRADIENT_OPTIONS },
      { type: 'color', key: 'colA', label: 'From',
        when: s => s.colorMode === 'gradient' && s.gradient === 'custom' },
      { type: 'color', key: 'colB', label: 'To',
        when: s => s.colorMode === 'gradient' && s.gradient === 'custom' },
      { type: 'range', key: 'size', label: 'Line weight', min: 0.2, max: 3, step: 0.05,
        fmt: v => v.toFixed(2) + '×' },
      { type: 'range', key: 'glow', label: 'Glow', min: 0.2, max: 2.5, step: 0.05,
        fmt: v => v.toFixed(2) + '×' },
      { type: 'range', key: 'persistence', label: 'Persistence', min: 0, max: 1, step: 0.01,
        fmt: v => v > 0.995 ? 'forever' : (v * 100).toFixed(0) + '%' }
    ] },

    { type: 'group', label: 'Machine', children: [
      { type: 'toggle', key: 'rods', label: 'Show rods' },
      { type: 'toggle', key: 'bobs', label: 'Show bobs' },
      { type: 'toggle', key: 'pivot', label: 'Show pivot' }
    ] },

    { type: 'group', label: 'Sheet', children: [
      { type: 'button', key: 'undo', label: 'Undo' },
      { type: 'button', key: 'png', label: 'Save PNG', primary: true },
      { type: 'button', key: 'clear', label: 'Clear', danger: true }
    ] }
  ],

  init(ctx) {
    stage = ctx.stage;
    paint = makeLayer(stage, { alpha: false });   // see paintPaper()
    sprite = makeLayer(stage);
    stage.classList.add('grab');
    stage.style.touchAction = 'none';
    undoStack = [];
    strokeCount = 0; simT = 0; acc = 0; meanTip = 0;
    live = false; drawing = false; tailLeft = 0;
    lastLight = isLight();
    gridOnSheet = fadeAmount() === 0;
    layout(ctx.w, ctx.h);
    pvx = tgx = 0; pvy = tgy = 0;
    build();
    attachPointer();
  },

  resize(w, h, dpr) {
    /* The drawing is a bitmap, so a resize resamples it. Carrying it
       across is the right trade: art that vanishes because someone
       dragged the window edge reads as a bug. */
    let old = null;
    if (paint.canvas.width && paint.canvas.height) {
      old = document.createElement('canvas');
      old.width = paint.canvas.width; old.height = paint.canvas.height;
      old.getContext('2d').drawImage(paint.canvas, 0, 0);
    }
    layout(w, h);
    paint.fit(w, h, dpr);
    sprite.fit(w, h, dpr);
    repaper();
    if (old) {
      const g = paint.ctx;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(old, 0, 0, paint.canvas.width, paint.canvas.height);
      g.restore();
    }
    undoStack = [];
    seedPrev();
  },

  onSet(key) {
    if (key === 'k' || key === 'mirror') {
      guideUntil = performance.now() + 900;
      if (!live) { strokeK = state.k; strokeMirror = state.mirror; }
    } else if (key === 'count' || key === 'epsExp') {
      build();
    } else if (key === 'armPct' || key === 'armRatio') {
      syncParams(); layout(W, H); seedPrev();
    } else if (key === 'massRatio' || key === 'gravity' || key === 'damp') {
      syncParams();
    } else if (key === 'persistence') {
      // The grid is a paint-mode feature; switching modes has to
      // redraw the paper, which means starting a fresh sheet.
      const wantGrid = fadeAmount() === 0;
      if (wantGrid !== gridOnSheet) { gridOnSheet = wantGrid; repaper(); undoStack = []; }
    }
  },

  onAction(key) {
    if (key === 'undo') {
      announce(restore() ? 'Undone. ' + undoStack.length + ' left.'
                         : 'Nothing to undo — undo is three deep here.');
    } else if (key === 'clear' || key === 'reset') {
      snapshot();
      repaper();
      strokeCount = 0; simT = 0;
      announce('Cleared.');
    } else if (key === 'png') {
      exportPNG();
    }
  },

  frame(dt, running) {
    if (running && (drawing || tailLeft > 0)) {
      const dtSec = (dt / 1000) * state.timeScale;

      /* Velocity is smoothed and acceleration is differenced from
         the smoothed velocity, then smoothed again. Raw pointer
         deltas are jittery enough that feeding them in directly
         makes the whole ensemble buzz. */
      const inv = dtSec > 1e-4 ? 1 / dtSec : 0;
      const vx0 = vx, vy0 = vy;
      vx += ((tgx - pvx) * inv - vx) * 0.35;
      vy += ((tgy - pvy) * inv - vy) * 0.35;
      ax += ((vx - vx0) * inv - ax) * 0.35;
      ay += ((vy - vy0) * inv - ay) * 0.35;

      ageSheet();
      integrate(dtSec);

      if (!drawing) {
        tailLeft -= dt / 1000;
        if (tailLeft <= 0) { live = false; tailLeft = 0; }
      }
    }
    drawSprite();
  },

  /* The shell calls repaint() for a theme change, but also after a
     mount and after every resize. Inverting on any of those would
     flip the sheet at exactly the wrong moments, so this asks
     whether the theme actually moved. */
  repaint() {
    const light = isLight();
    if (paint && lastLight !== null && light !== lastLight) reink();
    lastLight = light;
    drawSprite();
  },

  telemetry() {
    return {
      rows: [
        ['Pendulums', String(N)],
        ['Fold', state.k + (state.mirror ? ' × mirror' : '')],
        ['Copies', String(state.k * (state.mirror ? 2 : 1))],
        ['Strokes', String(strokeCount)],
        ['Spread', N > 1 && live ? separation().toExponential(1) : '—'],
        ['Tip speed', meanTip ? meanTip.toFixed(2) + ' px/ms' : '—'],
        ['Sim time', fmtTime(simT * 1000)]
      ],
      progress: null,
      note: strokeCount === 0
        ? 'Drag anywhere. Your pointer is the pivot — the pendulums hang off it, ' +
          'and it is your <b>acceleration</b> that swings them, not your speed. ' +
          'A steady glide barely disturbs them; a flick makes them lash.'
        : null,
      aria: `Pendulum drawing surface, ${state.k}-fold` +
            (state.mirror ? ' mirrored' : '') + `, ${N} pendulums, ` +
            `${strokeCount} strokes.`
    };
  },

  destroy() {
    detachPointer();
    undoStack = [];
    y = null;
    stage.classList.remove('grab');
    stage.style.touchAction = '';
  }
};

/* ═══════════════════════════════════════════════════════════════
   Pointer
   ═══════════════════════════════════════════════════════════════ */
let onDown, onMove, onUp;

function attachPointer() {
  const pos = e => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left - CX, y: e.clientY - r.top - CY };
  };

  onDown = e => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const p = pos(e);

    snapshot();
    strokeCount++;
    strokeK = state.k; strokeMirror = state.mirror;
    pvx = tgx = p.x; pvy = tgy = p.y;
    vx = vy = ax = ay = 0;
    acc = 0;
    build();                       // fresh ensemble, hanging from here
    drawing = true; live = true; tailLeft = 0;

    // Reduced motion means nothing animates unasked. Reaching for the
    // brush is the asking.
    if (!isRunning()) setRunning(true);
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  };

  onMove = e => {
    if (!drawing) return;
    e.preventDefault();
    // On a 120Hz display or a stylus, pointermove outruns rAF. The
    // pivot only needs the newest position — the frame loop derives
    // velocity and acceleration from it, and does its own smoothing
    // there, which is what actually decides how the brush feels.
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    const last = evs && evs.length ? evs[evs.length - 1] : e;
    const p = pos(last);
    tgx = p.x; tgy = p.y;
  };

  onUp = () => {
    if (!drawing) return;
    drawing = false;
    tailLeft = state.tail;
    if (tailLeft <= 0) live = false;
  };

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
