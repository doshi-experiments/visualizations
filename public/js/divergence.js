/* ═══════════════════════════════════════════════════════════════
   4 · E-03.3 DIVERGENCE — double pendulums, a billionth apart

   Matter.js is loaded on this page and is deliberately not used
   here. Its constraint solver is soft and iterative, and the
   numerical damping that comes with it is precisely the thing that
   would destroy the demonstration: pendulums that lose energy
   converge on the bottom instead of diverging, and the Lyapunov
   exponent you would measure would be the solver's, not the
   system's. So the equations of motion are integrated directly
   with RK4 — about forty lines, and honest.

   The exponent is the point. Every pendulum here obeys the same
   deterministic law with almost the same initial condition, and
   they still come apart. λ is the rate at which they do, and
   ln(1/ε)/λ is how long determinism stays useful.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import {
  ink, makeLayer, clamp, TAU, fmtTime, fmtFixed, isLight, setRunning, isRunning,
  safeRect
} from './shell.js';
import { makeTrails } from './trails.js';
import { rk4, energy } from './pendulum.js';

const DT = 1 / 240;              // seconds per RK4 step — fixed
const MAX_SUBSTEPS = 12;

let stage, sprite, trails;
let W = 0, H = 0;
let px = 0, py = 0, armScale = 100;

let y = null;                    // Float64Array, 4 per pendulum
let prevX = null, prevY = null;  // last bob-2 position, for trail segments
let N = 0;
let simT = 0, acc = 0;
let E0 = 0, drift = 0;
let samples = [];                // {t, d} phase-space separation
let sampleAcc = 0;
let lambda = NaN, lamR2 = 0;

const state = {
  count: 120,
  epsExp: -9,
  theta1: 120,
  theta2: 150,
  armRatio: 1,
  massRatio: 1,
  gravity: 9.81,
  timeScale: 1,
  trails: 0.72,
  colorMode: 'index',
  rods: true,
  bobs: true
};

const L1 = () => 1;
const L2 = () => state.armRatio;

/* One params object, mutated in place rather than rebuilt, so the
   hot path in pendulum.js sees a single stable shape. damp is 0 and
   stays 0: a pendulum that loses energy converges on the bottom
   instead of diverging, and there would be nothing left to measure. */
const P = { l1: 1, l2: 1, m1: 1, m2: 1, g: 9.81, damp: 0 };

function syncParams() {
  P.l2 = state.armRatio;
  P.m2 = state.massRatio;
  P.g = state.gravity;
}

const energyOf = base => energy(y, base, P);

/* ═══════════════════════════════════════════════════════════════
   Lifecycle
   ═══════════════════════════════════════════════════════════════ */
function build() {
  syncParams();
  N = clamp(state.count | 0, 1, 500);
  y = new Float64Array(N * 4);
  prevX = new Float64Array(N);
  prevY = new Float64Array(N);

  const eps = Math.pow(10, state.epsExp);
  const a1 = state.theta1 * Math.PI / 180;
  const a2 = state.theta2 * Math.PI / 180;
  for (let i = 0; i < N; i++) {
    y[i * 4] = a1 + i * eps;      // only θ₁ is perturbed, and only just
    y[i * 4 + 1] = 0;
    y[i * 4 + 2] = a2;
    y[i * 4 + 3] = 0;
  }

  simT = 0; acc = 0; sampleAcc = 0;
  samples = [];
  lambda = NaN; lamR2 = 0;
  E0 = energyOf(0); drift = 0;
  if (trails) trails.clear();
  seedPrev();
}

function seedPrev() {
  for (let i = 0; i < N; i++) {
    const p = bob2(i);
    prevX[i] = p.x; prevY[i] = p.y;
  }
}

function layout(w, h) {
  W = w; H = h;
  const r = safeRect(w, h);
  px = r.x + r.w / 2;
  py = r.y + r.h * 0.34;
  const reach = L1() + L2();
  armScale = Math.max(30, Math.min(r.w / 2, r.h * 0.62) / reach);
}

function bob2(i) {
  const b = i * 4;
  const x1 = Math.sin(y[b]) * L1(), yy1 = Math.cos(y[b]) * L1();
  return {
    x: px + (x1 + Math.sin(y[b + 2]) * L2()) * armScale,
    y: py + (yy1 + Math.cos(y[b + 2]) * L2()) * armScale
  };
}

/* Separation in the full phase space, not just θ₁ — two pendulums
   can cross in angle while their velocities are far apart. */
function separation() {
  if (N < 2) return 0;
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const d = y[i] - y[4 + i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function fitLambda() {
  // Only the exponential window: below this the separation is at
  // roundoff, above it the attractor is bounded and the growth
  // saturates, and fitting either end flatters the exponent.
  const lo = Math.pow(10, state.epsExp) * 20, hi = 0.5;
  const pts = samples.filter(s => s.d > lo && s.d < hi).map(s => [s.t, Math.log(s.d)]);
  if (pts.length < 6) { lambda = NaN; lamR2 = 0; return; }
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  const n = pts.length;
  for (const [x, v] of pts) { sx += x; sy += v; sxx += x * x; sxy += x * v; syy += v * v; }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) { lambda = NaN; return; }
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  let ssRes = 0;
  for (const [x, v] of pts) { const e = v - (a + b * x); ssRes += e * e; }
  const ssTot = syy - sy * sy / n;
  lambda = b;
  lamR2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : 0;
}

/* ═══════════════════════════════════════════════════════════════
   Exhibit
   ═══════════════════════════════════════════════════════════════ */
const exhibit = {
  id: 'chaos',
  code: 'E-03.3',
  name: 'Divergence',
  title: 'Divergence',
  state,
  hint: 'They all obey the same law. Watch the moment they stop agreeing.',

  controls: [
    { type: 'group', label: 'Run', children: [
      { type: 'button', key: 'toggle', label: 'Play / Pause', primary: true },
      { type: 'button', key: 'reset', label: 'Reset' }
    ] },

    { type: 'group', label: 'Ensemble', children: [
      { type: 'range', key: 'count', label: 'Pendulums', min: 1, max: 500, step: 1 },
      { type: 'range', key: 'epsExp', label: 'Separation ε', min: -12, max: -2, step: 1,
        fmt: v => '10' + String(v).replace('-', '⁻').replace(/\d/g,
          d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]) + ' rad' },
      { type: 'range', key: 'theta1', label: 'Upper angle', min: 0, max: 180, step: 1,
        fmt: v => v + '°' },
      { type: 'range', key: 'theta2', label: 'Lower angle', min: 0, max: 180, step: 1,
        fmt: v => v + '°' }
    ] },

    { type: 'group', label: 'Physics', children: [
      { type: 'range', key: 'armRatio', label: 'Arm ratio L₂/L₁', min: 0.3, max: 1.8, step: 0.01,
        fmt: v => v.toFixed(2) },
      { type: 'range', key: 'massRatio', label: 'Mass ratio m₂/m₁', min: 0.2, max: 3, step: 0.01,
        fmt: v => v.toFixed(2) },
      { type: 'range', key: 'gravity', label: 'Gravity', min: 1, max: 25, step: 0.1,
        fmt: v => v.toFixed(1) },
      { type: 'range', key: 'timeScale', label: 'Speed', min: 0.1, max: 3, step: 0.05,
        fmt: v => v.toFixed(2) + '×' }
    ] },

    { type: 'group', label: 'Drawing', children: [
      { type: 'select', key: 'colorMode', label: 'Colour', options: [
        { value: 'index', label: 'By index — rainbow' },
        { value: 'mono',  label: 'Blueprint' }
      ] },
      { type: 'range', key: 'trails', label: 'Trail persistence', min: 0, max: 1, step: 0.01,
        fmt: v => v < 0.02 ? 'off' : v > 0.99 ? 'forever' : (v * 100).toFixed(0) + '%' },
      { type: 'toggle', key: 'rods', label: 'Show rods' },
      { type: 'toggle', key: 'bobs', label: 'Show bobs' }
    ] }
  ],

  init(ctx) {
    stage = ctx.stage;
    trails = makeTrails(stage);
    sprite = makeLayer(stage);
    layout(ctx.w, ctx.h);
    build();
  },

  resize(w, h, dpr) {
    layout(w, h);
    trails.fit(w, h, dpr);
    sprite.fit(w, h, dpr);
    seedPrev();
  },

  onSet(key) {
    if (key === 'count' || key === 'epsExp' ||
        key === 'theta1' || key === 'theta2') build();
    else if (key === 'armRatio' || key === 'massRatio' || key === 'gravity') {
      syncParams();
      E0 = energyOf(0);
      layout(W, H);
      seedPrev();
    }
  },

  onAction(key) {
    if (key === 'reset') build();
    else if (key === 'toggle') setRunning(!isRunning());
  },

  frame(dt, running) {
    if (running) {
      acc += (dt / 1000) * state.timeScale;
      let n = 0;
      while (acc >= DT && n < MAX_SUBSTEPS) {
        for (let i = 0; i < N; i++) rk4(y, i * 4, DT, P);
        simT += DT; acc -= DT; n++;
      }
      if (n === MAX_SUBSTEPS) acc = 0;

      drift = E0 !== 0 ? (energyOf(0) - E0) / Math.abs(E0) : 0;

      sampleAcc += dt;
      if (sampleAcc > 60 && N > 1) {
        sampleAcc = 0;
        samples.push({ t: simT, d: Math.max(1e-18, separation()) });
        if (samples.length > 800) samples.splice(0, 200);
        fitLambda();
      }
    }
    draw();
  },

  repaint() { draw(); },

  telemetry() {
    const horizon = (isFinite(lambda) && lambda > 0)
      ? Math.log(1 / Math.pow(10, state.epsExp)) / lambda : NaN;
    return {
      rows: [
        ['Pendulums', String(N)],
        ['Sim time', fmtTime(simT * 1000)],
        ['Separation', N > 1 ? separation().toExponential(1) : '—'],
        ['λ', isFinite(lambda) ? fmtFixed(lambda, 3) + ' /s' : '—'],
        ['Horizon', isFinite(horizon) ? fmtFixed(horizon, 1) + ' s' : '—'],
        ['Energy drift', (drift * 100).toFixed(4) + '%']
      ],
      progress: null,
      note: N < 2
        ? 'One pendulum on its own is just a pendulum. Raise the count to see divergence.'
        : (isFinite(lambda) && lamR2 > 0.9
            ? `Separation is growing as e^${lambda.toFixed(2)}ᵗ. From ε it takes about ` +
              `<b>${horizon.toFixed(1)}s</b> before prediction is worthless.`
            : null),
      aria: `${N} double pendulums, separation ${N > 1 ? separation().toExponential(1) : 'n/a'}.`
    };
  },

  chartInfo() {
    return {
      title: 'Separation',
      scale: 'log |Δ|',
      foot: isFinite(lambda)
        ? `λ <b>${lambda.toFixed(3)}</b> /s · R² ${lamR2.toFixed(3)}`
        : 'Waiting for the separation to leave roundoff.'
    };
  },

  drawChart(g, w, h) { chart(g, w, h); },

  destroy() { y = null; }
};

/* ═══════════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════════ */
const HB = 36;   // hue buckets, so 500 pendulums cost 36 draw calls

function hueOf(i) {
  return state.colorMode === 'mono' ? -1 : (i / Math.max(1, N)) * 330;
}

function draw() {
  const light = isLight();
  const g = sprite.ctx;

  /* trails on the lower bob */
  const wantTrails = state.trails > 0.02;
  if (wantTrails) {
    const t = trails.ctx;
    trails.fade(trails.fadeFor(state.trails));
    const paths = new Array(HB).fill(null);
    let mono = null;
    for (let i = 0; i < N; i++) {
      const p = bob2(i);
      const hue = hueOf(i);
      let path;
      if (hue < 0) path = (mono || (mono = new Path2D()));
      else {
        const bi = clamp((hue / (360 / HB)) | 0, 0, HB - 1);
        path = paths[bi] || (paths[bi] = new Path2D());
      }
      path.moveTo(prevX[i], prevY[i]);
      path.lineTo(p.x, p.y);
      prevX[i] = p.x; prevY[i] = p.y;
    }
    t.lineWidth = 1.2; t.lineCap = 'round'; t.globalAlpha = 0.75;
    for (let b = 0; b < HB; b++) {
      if (!paths[b]) continue;
      t.strokeStyle = `hsl(${(b * (360 / HB)).toFixed(0)} 88% ${light ? 44 : 64}%)`;
      t.stroke(paths[b]);
    }
    if (mono) { t.strokeStyle = ink('accent'); t.stroke(mono); }
    t.globalAlpha = 1;
  } else {
    trails.fade(1);
    seedPrev();
  }

  /* rods and bobs */
  g.clearRect(0, 0, W, H);

  g.save();
  g.fillStyle = ink('ink-dim');
  g.beginPath(); g.arc(px, py, 3, 0, TAU); g.fill();

  if (state.rods || state.bobs) {
    const rods = new Array(HB).fill(null);
    const bobs = new Array(HB).fill(null);
    let monoRod = null, monoBob = null;

    for (let i = 0; i < N; i++) {
      const b = i * 4;
      const x1 = px + Math.sin(y[b]) * L1() * armScale;
      const y1 = py + Math.cos(y[b]) * L1() * armScale;
      const p = bob2(i);
      const hue = hueOf(i);
      const bi = hue < 0 ? -1 : clamp((hue / (360 / HB)) | 0, 0, HB - 1);

      if (state.rods) {
        const path = bi < 0 ? (monoRod || (monoRod = new Path2D()))
                            : (rods[bi] || (rods[bi] = new Path2D()));
        path.moveTo(px, py); path.lineTo(x1, y1); path.lineTo(p.x, p.y);
      }
      if (state.bobs) {
        const path = bi < 0 ? (monoBob || (monoBob = new Path2D()))
                            : (bobs[bi] || (bobs[bi] = new Path2D()));
        const r = N > 120 ? 1.6 : 3;
        path.moveTo(p.x + r, p.y);
        path.arc(p.x, p.y, r, 0, TAU);
      }
    }

    g.lineWidth = N > 200 ? 0.6 : 1;
    g.globalAlpha = N > 200 ? 0.4 : N > 60 ? 0.6 : 0.9;
    for (let b = 0; b < HB; b++) {
      const col = `hsl(${(b * (360 / HB)).toFixed(0)} 88% ${light ? 42 : 66}%)`;
      if (rods[b]) { g.strokeStyle = col; g.stroke(rods[b]); }
    }
    if (monoRod) { g.strokeStyle = ink('accent'); g.stroke(monoRod); }
    g.globalAlpha = 1;
    for (let b = 0; b < HB; b++) {
      const col = `hsl(${(b * (360 / HB)).toFixed(0)} 88% ${light ? 42 : 66}%)`;
      if (bobs[b]) { g.fillStyle = col; g.fill(bobs[b]); }
    }
    if (monoBob) { g.fillStyle = ink('accent'); g.fill(monoBob); }
  }
  g.restore();
}

function chart(g, w, h) {
  const pad = { l: 24, r: 4, t: 5, b: 13 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const dim = ink('ink-dim'), line = ink('line-2');

  g.save();
  g.strokeStyle = line; g.lineWidth = 1;
  g.strokeRect(pad.l + .5, pad.t + .5, iw, ih);

  if (samples.length < 2) {
    g.fillStyle = dim; g.font = '9px ui-monospace,monospace';
    g.fillText('waiting', pad.l + 6, pad.t + 16);
    g.restore(); return;
  }

  const tMax = Math.max(0.5, samples[samples.length - 1].t);
  const lo = state.epsExp - 0.5, hi = 1.2;          // decades of |Δ|
  const X = t => pad.l + (t / tMax) * iw;
  const Y = d => {
    const v = clamp(Math.log10(Math.max(1e-18, d)), lo, hi);
    return pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  };

  g.strokeStyle = line; g.globalAlpha = 0.6;
  g.font = '8px ui-monospace,monospace'; g.fillStyle = dim;
  for (let d = Math.ceil(lo); d <= hi; d += 3) {
    const yy = Y(Math.pow(10, d));
    g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(pad.l + iw, yy); g.stroke();
    g.fillText('1e' + d, 1, yy + 3);
  }
  g.globalAlpha = 1;

  if (isFinite(lambda)) {
    const first = samples.find(s => s.d > Math.pow(10, state.epsExp) * 20);
    if (first) {
      const a = Math.log(first.d) - lambda * first.t;
      g.strokeStyle = ink('safety'); g.setLineDash([3, 3]); g.globalAlpha = 0.8;
      g.beginPath();
      g.moveTo(X(0), Y(Math.exp(a)));
      g.lineTo(X(tMax), Y(Math.exp(a + lambda * tMax)));
      g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
    }
  }

  g.strokeStyle = ink('accent'); g.lineWidth = 1.5;
  g.beginPath();
  samples.forEach((s, i) => i ? g.lineTo(X(s.t), Y(s.d)) : g.moveTo(X(s.t), Y(s.d)));
  g.stroke();

  g.fillStyle = dim; g.font = '8px ui-monospace,monospace';
  g.fillText(tMax.toFixed(0) + 's', pad.l + iw - 16, h - 3);
  g.restore();
}

export default exhibit;
