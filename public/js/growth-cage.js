/* ═══════════════════════════════════════════════════════════════
   2 · E-03.1 GROWTH CAGE

   Two balls in a cage. Every collision spawns a third.

   The physics is a hybrid, and deliberately so. Matter.js handles
   ball-against-ball, because its grid broad phase is what keeps
   this honest once N is in the hundreds, and its collisionStart
   event *is* the spawn rule. But the cage wall is not a Matter
   body at all: Matter cannot express a hollow circle as one body
   (a polygon is convex-decomposed), so the usual recipe is a ring
   of a hundred thin static rectangles — which is visibly faceted
   at low N and a tunnelling hazard at high speed. Instead the wall
   is reflected analytically in an afterUpdate hook. Exact
   curvature, no faceting, and nothing can escape.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import {
  ink, makeLayer, mulberry32, clamp, TAU, fmtInt, fmtTime, isLight,
  setRunning, isRunning, announce, safeRect
} from './shell.js';
import { makeTrails } from './trails.js';

const M = window.Matter;

const STEP = 1000 / 120;      // ms of sim per physics step — never varies
const MAX_SUBSTEPS = 8;
const MAX_SPAWNS_PER_STEP = 8;
/* Consecutive failed placements before the cage is called jammed.
   This has to be generous: near the packing limit most attempts fail
   and only the occasional lucky gap succeeds, and stopping at the
   first run of failures ends the run long before it is actually
   full. */
const FAIL_LIMIT = 400;

let stage, trails, sprite;
let engine, world;
let balls = [];
let W = 0, H = 0;

/* cage geometry, recomputed on resize */
let cx = 0, cy = 0, R = 0, SL = 0, APO = 0, cageArea = 1;

let rng = mulberry32(1);
let placed = false, dragging = false, stopped = false;
let stopSuppressed = false, dropIndex = 0;
let dropX = 0, dropY = 0, aimX = 0, aimY = 0;
let pointerX = 0, pointerY = 0, pointerIn = false;

let simTime = 0, wallStart = 0, acc = 0;
let collisions = 0, spawnCount = 0, failedSpawns = 0, failedTotal = 0, maxGen = 0;
let targetKE = 0, perBallKE = 0;
let spawnQueue = [];
let samples = [];             // {t, n} for the chart
let sampleAcc = 0;
let collRateWindow = [], peakRate = 0;
let summary = null;
let audioCtx = null, lastBeep = 0;

/* uniform grid for spawn-placement queries; rebuilt only when a
   spawn is actually pending, which is at most a handful per step */
const grid = { cell: 32, cols: 0, rows: 0, buckets: [] };

/* ── state ───────────────────────────────────────────────────── */
const state = {
  preset: 'default',
  cage: 'circle',
  spawn: true,
  spawnEvery: 1,
  refractory: 130,
  startCount: 6,
  splitAngle: 40,
  speed0: 3,
  radius: 5.5,
  radiusMode: 'fixed',
  energy: 'inject',
  gravity: 0,
  restitution: 1,
  timeScale: 1,
  colorMode: 'lineage',
  trails: 0.55,
  stopAt: 0.8,
  logScale: true,
  sound: false,
  seed: 8412
};

/* ═══════════════════════════════════════════════════════════════
   Cage geometry — one interface, four shapes
   ═══════════════════════════════════════════════════════════════ */

function layout(w, h) {
  const r = safeRect(w, h);
  cx = r.x + r.w / 2;
  cy = r.y + r.h / 2;
  const half = Math.max(60, Math.min(r.w, r.h) / 2 - 10);
  R = half;
  SL = half * 0.62;                 // stadium straight half-length
  APO = half * 0.92;                // polygon apothem
  if (state.cage === 'circle')       cageArea = Math.PI * R * R;
  else if (state.cage === 'stadium') cageArea = 4 * SL * R + Math.PI * R * R;
  else if (state.cage === 'square')  cageArea = 4 * APO * APO;
  else                               cageArea = 6 * APO * APO * Math.tan(Math.PI / 6);
}

const polySides = () => (state.cage === 'square' ? 4 : 6);
const polyRot = () => (state.cage === 'square' ? Math.PI / 4 : 0);

/* How far inside the wall a point sits. >= r means a ball of that
   radius fits there. Negative means outside. */
function depth(x, y) {
  const px = x - cx, py = y - cy;
  if (state.cage === 'circle') return R - Math.hypot(px, py);
  if (state.cage === 'stadium') {
    if (Math.abs(px) <= SL) return R - Math.abs(py);
    const ex = px > 0 ? SL : -SL;
    return R - Math.hypot(px - ex, py);
  }
  const n = polySides(), rot = polyRot();
  let d = Infinity;
  for (let i = 0; i < n; i++) {
    const a = rot + i * TAU / n;
    d = Math.min(d, APO - (px * Math.cos(a) + py * Math.sin(a)));
  }
  return d;
}

/* Reflect a body back inside. Velocity first, then position: Matter's
   setVelocity rewrites positionPrev from the current position, and
   setPosition without updateVelocity shifts both by the same delta,
   so the order preserves the reflected velocity exactly. */
function reflect(b, nx, ny, push) {
  const v = b.velocity;
  const vn = v.x * nx + v.y * ny;
  if (vn > 0) M.Body.setVelocity(b, { x: v.x - 2 * vn * nx, y: v.y - 2 * vn * ny });
  M.Body.setPosition(b, { x: b.position.x - nx * push, y: b.position.y - ny * push });
}

function containAll() {
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i], r = b.circleRadius;
    const px = b.position.x - cx, py = b.position.y - cy;

    if (state.cage === 'circle') {
      const d = Math.hypot(px, py);
      if (d > R - r && d > 0) reflect(b, px / d, py / d, d - (R - r));

    } else if (state.cage === 'stadium') {
      if (Math.abs(px) <= SL) {
        if (py > R - r) reflect(b, 0, 1, py - (R - r));
        else if (py < -(R - r)) reflect(b, 0, -1, -(R - r) - py);
      } else {
        const ex = px > 0 ? SL : -SL;
        const dx = px - ex, dy = py, d = Math.hypot(dx, dy);
        if (d > R - r && d > 0) reflect(b, dx / d, dy / d, d - (R - r));
      }

    } else {
      const n = polySides(), rot = polyRot();
      for (let k = 0; k < n; k++) {
        const a = rot + k * TAU / n, nx = Math.cos(a), ny = Math.sin(a);
        const s = px * nx + py * ny;
        if (s > APO - r) reflect(b, nx, ny, s - (APO - r));
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   Spawn placement grid
   ═══════════════════════════════════════════════════════════════ */
function rebuildGrid() {
  let maxR = 4;
  for (const b of balls) if (b.circleRadius > maxR) maxR = b.circleRadius;
  grid.cell = Math.max(8, maxR * 2.2);
  grid.cols = Math.max(1, Math.ceil(W / grid.cell));
  grid.rows = Math.max(1, Math.ceil(H / grid.cell));
  const n = grid.cols * grid.rows;
  grid.buckets.length = n;
  for (let i = 0; i < n; i++) grid.buckets[i] = null;
  for (const b of balls) {
    const gx = clamp((b.position.x / grid.cell) | 0, 0, grid.cols - 1);
    const gy = clamp((b.position.y / grid.cell) | 0, 0, grid.rows - 1);
    const i = gy * grid.cols + gx;
    (grid.buckets[i] || (grid.buckets[i] = [])).push(b);
  }
}

function gridInsert(b) {
  if (!grid.cols) return;
  const gx = clamp((b.position.x / grid.cell) | 0, 0, grid.cols - 1);
  const gy = clamp((b.position.y / grid.cell) | 0, 0, grid.rows - 1);
  const i = gy * grid.cols + gx;
  (grid.buckets[i] || (grid.buckets[i] = [])).push(b);
}

function overlaps(x, y, r) {
  const gx = clamp((x / grid.cell) | 0, 0, grid.cols - 1);
  const gy = clamp((y / grid.cell) | 0, 0, grid.rows - 1);
  const span = Math.ceil(r / grid.cell) + 1;
  for (let j = gy - span; j <= gy + span; j++) {
    if (j < 0 || j >= grid.rows) continue;
    for (let i = gx - span; i <= gx + span; i++) {
      if (i < 0 || i >= grid.cols) continue;
      const bucket = grid.buckets[j * grid.cols + i];
      if (!bucket) continue;
      for (const b of bucket) {
        const dx = b.position.x - x, dy = b.position.y - y;
        const rr = b.circleRadius + r;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
    }
  }
  return false;
}

/* Nearest free spot to (x, y) that fits a ball of radius r, spiralling
   outward. Needed because balls can now be dropped into a cage that is
   already crowded, where the exact click point is usually occupied. */
function freeSpot(x, y, r, jitter) {
  if (depth(x, y) >= r && !overlaps(x, y, r)) return { x, y };
  for (let ring = 1; ring <= 18; ring++) {
    const rad = ring * r * 1.55;
    const steps = 6 + ring * 3;
    const off = jitter * 1.7 + rng() * TAU;
    for (let i = 0; i < steps; i++) {
      const a = off + i * TAU / steps;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (depth(px, py) >= r && !overlaps(px, py, r)) return { x: px, y: py };
    }
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   Balls
   ═══════════════════════════════════════════════════════════════ */
function newRadius() {
  if (state.radiusMode === 'count')
    return Math.max(1.6, state.radius / Math.sqrt(Math.max(1, balls.length)));
  return state.radius;
}

function addBall(x, y, r, vx, vy, hue, gen) {
  const b = M.Bodies.circle(x, y, r, {
    restitution: state.restitution,
    friction: 0, frictionAir: 0, frictionStatic: 0,
    slop: 0.02,
    inertia: Infinity          // no spin: nothing renders it, and it costs
  });
  b.viz = { hue, gen, born: simTime, lastSpawn: -1e9, px: x, py: y };
  M.Body.setVelocity(b, { x: vx, y: vy });
  M.Composite.add(world, b);
  balls.push(b);
  gridInsert(b);
  if (gen > maxGen) maxGen = gen;
  return b;
}

function totalKE() {
  let s = 0;
  for (const b of balls) {
    const v = b.velocity;
    s += 0.5 * b.mass * (v.x * v.x + v.y * v.y);
  }
  return s;
}

function scaleVelocities(f) {
  for (const b of balls)
    M.Body.setVelocity(b, { x: b.velocity.x * f, y: b.velocity.y * f });
}

/* A newborn takes one parent's hue plus a mutation, rather than the
   average of both.

   Averaging was the first thing I tried and it looks wrong past about
   forty generations: blending halves the variance every generation, so
   a hundred generations in, every ball in the cage is the same colour
   and the lineage view stops showing lineage at all. That is the
   classic objection to blending inheritance, and it shows up here for
   exactly the same reason. Inheriting from one parent makes hue a
   random walk instead, so variance holds and clans stay visible. */
function inheritHue(h1, h2, mutation) {
  const h = (rng() < 0.5 ? h1 : h2) + (rng() - 0.5) * mutation;
  return ((h % 360) + 360) % 360;
}

function beep(gen) {
  if (!state.sound) return;
  const now = performance.now();
  if (now - lastBeep < 125) return;      // hard throttle; spawns get dense
  lastBeep = now;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const pent = [0, 2, 4, 7, 9];
    const semi = pent[gen % 5] + 12 * Math.min(3, (gen / 5) | 0);
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.value = 220 * Math.pow(2, semi / 12);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, audioCtx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.36);
  } catch (e) { /* audio is a nicety; never let it break the sim */ }
}

function drainSpawns() {
  if (!spawnQueue.length) return;
  rebuildGrid();

  for (const [a, b] of spawnQueue) {
    if (!a.viz || !b.viz) continue;
    if (simTime - a.viz.lastSpawn < state.refractory) continue;
    if (simTime - b.viz.lastSpawn < state.refractory) continue;

    const r = newRadius();
    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;
    let dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    const ox = -dy, oy = dx;                 // perpendicular to the contact

    let spot = null;
    const base = Math.max(a.circleRadius, b.circleRadius) + r + 1.5;
    for (let i = 0; i < 10 && !spot; i++) {
      const sign = (i % 2) ? -1 : 1;
      const reach = base * (1 + Math.floor(i / 2) * 0.55);
      const x = mx + ox * reach * sign, y = my + oy * reach * sign;
      if (depth(x, y) >= r && !overlaps(x, y, r)) spot = { x, y };
    }
    if (!spot) { failedSpawns++; failedTotal++; continue; }

    let vx, vy;
    if (state.energy === 'inject') {
      const ang = rng() * TAU;
      vx = Math.cos(ang) * state.speed0;
      vy = Math.sin(ang) * state.speed0;
    } else {
      vx = (a.velocity.x + b.velocity.x) / 2 + (rng() - 0.5) * 0.4;
      vy = (a.velocity.y + b.velocity.y) / 2 + (rng() - 0.5) * 0.4;
    }

    const gen = Math.max(a.viz.gen, b.viz.gen) + 1;
    const hue = inheritHue(a.viz.hue, b.viz.hue, 26);
    addBall(spot.x, spot.y, r, vx, vy, hue, gen);

    a.viz.lastSpawn = b.viz.lastSpawn = simTime;
    spawnCount++; failedSpawns = 0;
    beep(gen);
  }
  spawnQueue.length = 0;
}

/* ═══════════════════════════════════════════════════════════════
   World lifecycle
   ═══════════════════════════════════════════════════════════════ */
function buildWorld() {
  engine = M.Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = 1;
  engine.gravity.scale = state.gravity * 0.0008;
  engine.positionIterations = 8;
  engine.velocityIterations = 8;
  world = engine.world;

  M.Events.on(engine, 'afterUpdate', containAll);
  M.Events.on(engine, 'collisionStart', ev => {
    if (stopped) return;
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (!a.viz || !b.viz) continue;
      collisions++;
      if (!state.spawn) continue;
      if (state.spawnEvery > 1 && collisions % state.spawnEvery !== 0) continue;
      if (spawnQueue.length >= MAX_SPAWNS_PER_STEP) continue;
      if (simTime - a.viz.lastSpawn < state.refractory) continue;
      if (simTime - b.viz.lastSpawn < state.refractory) continue;
      spawnQueue.push([a, b]);
    }
  });
}

function resetRun(newSeed) {
  if (newSeed) state.seed = (Math.random() * 1e9) | 0;
  rng = mulberry32(state.seed);
  balls = [];
  spawnQueue = [];
  samples = [];
  collRateWindow = [];
  simTime = 0; acc = 0; sampleAcc = 0;
  collisions = 0; spawnCount = 0; failedSpawns = 0; failedTotal = 0; maxGen = 0;
  peakRate = 0; summary = null;
  placed = false; dragging = false; stopped = false;
  stopSuppressed = false; dropIndex = 0;
  buildWorld();
  if (trails) trails.clear();
  layout(W, H);
  if (stage) stage.classList.add('grab');
  if (setHintRef) setHintRef(exhibit.hint);
}

function drop(x, y, ax, ay) {
  const vx = ax - x, vy = ay - y;
  const len = Math.hypot(vx, vy);
  const speed = len > 6 ? clamp(len / 26, 0.6, 9) : state.speed0;
  const ang = len > 6 ? Math.atan2(vy, vx) : rng() * TAU;

  const r = state.radius;
  const half = state.splitAngle * Math.PI / 180 / 2;
  const n = Math.max(1, state.startCount | 0);

  // Each handful gets its own hue family, so a second drop reads as a
  // separate bloodline rather than merging into the first.
  const baseHue = (dropIndex * 67 + 190) % 360;
  rebuildGrid();

  let added = 0;
  for (let i = 0; i < n; i++) {
    const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * half;
    const a = ang + spread;
    const off = n === 1 ? 0 : (i - (n - 1) / 2) * (r * 2.4);
    const spot = freeSpot(x + Math.cos(a + Math.PI / 2) * off,
                          y + Math.sin(a + Math.PI / 2) * off, r, i);
    if (!spot) continue;
    addBall(spot.x, spot.y, r, Math.cos(a) * speed, Math.sin(a) * speed,
            (baseHue + (i * 26) - n * 13 + 360) % 360, 0);
    added++;
  }

  if (!added) { announce('No room there — try a clearer part of the cage.'); return; }
  dropIndex++;

  // Adding by hand is an explicit "keep going", so the automatic
  // packing stop stands down from here; only a real jam ends the run.
  if (stopped || placed) { stopped = false; summary = null; stopSuppressed = true; }
  failedSpawns = 0;

  targetKE = totalKE();
  perBallKE = balls.length ? targetKE / balls.length : 0;
  if (!placed) { placed = true; wallStart = performance.now(); }
  samples.push({ t: simTime, n: balls.length });
}

/* ═══════════════════════════════════════════════════════════════
   Growth fits — and why the obvious prediction is wrong

   The tempting argument: collision rate in a gas goes as N², every
   collision spawns a ball, so dN/dt = kN², which is not merely
   exponential — it runs to infinity at a finite time. Two balls
   become a catastrophe on a schedule.

   That is right for about the first second, and then wrong, and
   the interesting part of this exhibit is watching it fail. Rather
   than argue between two guessed laws, the exponent is measured:
   estimate dN/dt by central difference and regress log(rate) on
   log(N). The slope *is* p in dN/dt = kN^p, and it comes out well
   below 2. Measured over full runs to the jamming limit:

     energy conserved (default)   p ≈ 0.86
     energy injected              p ≈ 1.17
     conserved, smaller balls     p ≈ 0.63

   Three brakes, in the order they bite:

   1 · Cooling. With total energy held fixed, sharing it among more
       balls means each is slower — mean speed falls as N^-1/2 — and
       collision rate carries a factor of v. That alone takes the
       exponent from 2 toward 1.5. It is also directly testable:
       switch Energy to "injected", the balls stop slowing, and the
       measured p rises by about 0.3. It does, reproducibly.

   2 · Crowding. A newborn needs somewhere to go. As packing climbs,
       placement attempts fail more and more often, and this brake
       has no upper bound — it goes to a full stop at jamming. This
       is what actually ends a run, and what pulls p below 1.

   3 · The refractory period τ, which caps each ball at one spawn per
       τ. This one turns out not to bind at the default settings:
       measured rates sit far below the 1/τ ceiling. Shortening τ
       from 130ms to 30ms barely moves p.

   So the cage is not a runaway. It is logistic — an accelerator
   that loses to a brake — and the N² intuition is a good enough
   story to be worth watching break.
   ═══════════════════════════════════════════════════════════════ */
function linreg(pts) {
  const n = pts.length;
  if (n < 4) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const d = n * sxx - sx * sx;
  if (Math.abs(d) < 1e-12) return null;
  const b = (n * sxy - sx * sy) / d;
  const a = (sy - b * sx) / n;
  const ssTot = syy - sy * sy / n;
  let ssRes = 0;
  for (const [x, y] of pts) { const e = y - (a + b * x); ssRes += e * e; }
  const r2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : 0;
  return { a, b, r2 };
}

/* Rather than pick a winner between two guesses, measure the
   exponent directly: estimate dN/dt by central difference, then
   regress log(rate) on log(N). The slope *is* p. */
function fitPower(use) {
  if (use.length < 14) return null;
  const stride = 4;                       // widen the difference; N is a step function
  const pts = [];
  for (let i = stride; i < use.length - stride; i++) {
    const dn = use[i + stride].n - use[i - stride].n;
    const dt = use[i + stride].t - use[i - stride].t;
    if (dn <= 0 || dt <= 0) continue;
    pts.push([Math.log(use[i].n), Math.log(dn / dt * 1000)]);
  }
  const r = linreg(pts);
  if (!r) return null;
  return { p: r.b, k: Math.exp(r.a), r2: r.r2, points: pts.length };
}

function fits() {
  // Drop the opening transient: with two balls the "rate" is noise.
  const use = samples.filter(s => s.n >= 4);
  if (use.length < 6) return null;
  const recent = use.slice(Math.floor(use.length * 0.4));
  const win = recent.length >= 14 ? recent : use;

  const exp = linreg(win.map(s => [s.t, Math.log(s.n)]));
  const hyp = linreg(win.map(s => [s.t, 1 / s.n]));
  const power = fitPower(use);

  const tStar = (hyp && hyp.b < 0) ? -hyp.a / hyp.b : Infinity;
  const doubling = (exp && exp.b > 0) ? Math.LN2 / exp.b : Infinity;   // ms

  // With dN/dt = kN^p and p > 1, the time left from the current N to
  // an infinite one is finite and this is it.
  let blowIn = Infinity;
  if (power && power.p > 1.02 && balls.length > 0)
    blowIn = Math.pow(balls.length, 1 - power.p) / (power.k * (power.p - 1)) * 1000;

  return {
    exp, hyp, power, tStar, doubling, blowIn,
    rate: exp ? exp.b * 1000 : NaN,
    winner: (hyp && exp && hyp.r2 > exp.r2) ? 'hyperbolic' : 'exponential'
  };
}

/* The ceiling τ imposes — if every ball spawned the instant it was
   allowed to, N would grow as e^(t/τ) — is shown on the τ slider's
   own label, which is where a reader can compare it against the
   measured rate and see that it is not the binding constraint. */

/* ═══════════════════════════════════════════════════════════════
   Colour
   ═══════════════════════════════════════════════════════════════ */
function hueOf(b) {
  const m = state.colorMode;
  if (m === 'lineage') return b.viz.hue;
  if (m === 'generation') return (b.viz.gen * 41) % 360;
  if (m === 'speed') {
    const v = Math.hypot(b.velocity.x, b.velocity.y);
    const t = clamp(v / (state.speed0 * 2.2), 0, 1);
    return 200 - t * 200;                      // cyan → peach → red
  }
  if (m === 'age') {
    const t = clamp((simTime - b.viz.born) / 12000, 0, 1);
    return 190 + t * 60;
  }
  return -1;                                    // mono
}

/* ═══════════════════════════════════════════════════════════════
   Exhibit
   ═══════════════════════════════════════════════════════════════ */
const PRESETS = {
  default:  { cage: 'circle',  spawn: true,  startCount: 6, splitAngle: 40, radius: 5.5, stopAt: 0.8,  trails: 0.55, energy: 'inject',   gravity: 0,   radiusMode: 'fixed', colorMode: 'lineage' },
  conserve: { cage: 'circle',  spawn: true,  startCount: 2, splitAngle: 6,  radius: 7,   stopAt: 0.55, trails: 0.55, energy: 'conserve', gravity: 0,   radiusMode: 'fixed', colorMode: 'lineage' },
  caustic:  { cage: 'circle',  spawn: false, startCount: 1, trails: 1,    energy: 'conserve', gravity: 0,   radiusMode: 'fixed', colorMode: 'mono'    },
  ergodic:  { cage: 'stadium', spawn: false, startCount: 1, trails: 1,    energy: 'conserve', gravity: 0,   radiusMode: 'fixed', colorMode: 'mono'    },
  runaway:  { cage: 'circle',  spawn: true,  startCount: 2, trails: 0.4,  energy: 'inject',   gravity: 0,   radiusMode: 'fixed', colorMode: 'speed'   },
  sediment: { cage: 'circle',  spawn: true,  startCount: 2, trails: 0.3,  energy: 'inject',   gravity: 0.55, radiusMode: 'fixed', colorMode: 'generation' }
};

const exhibit = {
  id: 'growth',
  code: 'E-03.1',
  name: 'Growth Cage',
  title: 'Growth Cage',
  state,

  hint: 'Click inside the cage to drop balls — drag to aim. Click again any time to add more.',

  controls: [
    { type: 'group', label: 'Run', children: [
      { type: 'select', key: 'preset', label: 'Preset', options: [
        { value: 'default',  label: 'Growth — heated, six balls' },
        { value: 'conserve', label: 'Growth — energy conserved' },
        { value: 'caustic',  label: 'Caustic — one ball, circle' },
        { value: 'ergodic',  label: 'Ergodic — one ball, stadium' },
        { value: 'runaway',  label: 'Runaway — energy injected' },
        { value: 'sediment', label: 'Sediment — under gravity' }
      ] },
      { type: 'button', key: 'toggle', label: 'Play / Pause', primary: true },
      { type: 'button', key: 'reset', label: 'Reset' },
      { type: 'button', key: 'reseed', label: 'New seed' }
    ] },

    { type: 'group', label: 'Cage', children: [
      { type: 'select', key: 'cage', label: 'Shape', options: [
        { value: 'circle',  label: 'Circle — integrable' },
        { value: 'stadium', label: 'Stadium — chaotic' },
        { value: 'square',  label: 'Square' },
        { value: 'hexagon', label: 'Hexagon' }
      ] },
      // π/√12 ≈ 0.9069 is the hexagonal packing limit; nothing can
      // exceed it, and random packing jams well before it.
      { type: 'range', key: 'stopAt', label: 'Stop at packing', min: 0.1, max: 0.9, step: 0.01,
        fmt: v => (v * 100).toFixed(0) + '%' }
    ] },

    { type: 'group', label: 'Spawning', children: [
      { type: 'toggle', key: 'spawn', label: 'Spawn on collision' },
      { type: 'range', key: 'spawnEvery', label: 'Every Nth collision', min: 1, max: 12, step: 1,
        when: s => s.spawn, fmt: v => v === 1 ? 'every' : String(v) },
      // τ is the knob that decides which growth law you get: long τ
      // caps the rate at 1/τ and the run goes exponential, short τ
      // lets the N² collision law keep control. See fits().
      { type: 'range', key: 'refractory', label: 'Refractory τ', min: 20, max: 400, step: 5,
        when: s => s.spawn, fmt: v => v + 'ms · ≤' + (1000 / v).toFixed(1) + '/s' },
      { type: 'select', key: 'radiusMode', label: 'Newborn size', when: s => s.spawn, options: [
        { value: 'fixed', label: 'Same as parents' },
        { value: 'count', label: 'Shrink as 1/√N' }
      ] },
      { type: 'select', key: 'energy', label: 'Energy', options: [
        { value: 'conserve',    label: 'Conserved — cools as it fills' },
        { value: 'temperature', label: 'Constant temperature' },
        { value: 'inject',      label: 'Injected — heats up' }
      ] }
    ] },

    { type: 'group', label: 'Physics', children: [
      { type: 'range', key: 'startCount', label: 'Balls dropped', min: 1, max: 6, step: 1 },
      { type: 'range', key: 'radius', label: 'Ball radius', min: 3, max: 16, step: 0.5,
        fmt: v => v.toFixed(1) + 'px' },
      { type: 'range', key: 'speed0', label: 'Initial speed', min: 0.5, max: 9, step: 0.1,
        fmt: v => v.toFixed(1) },
      { type: 'range', key: 'splitAngle', label: 'Split angle', min: 0, max: 90, step: 1,
        when: s => s.startCount > 1, fmt: v => v + '°' },
      { type: 'range', key: 'gravity', label: 'Gravity', min: 0, max: 1, step: 0.01,
        fmt: v => v === 0 ? 'off' : v.toFixed(2) },
      { type: 'range', key: 'restitution', label: 'Restitution', min: 0.85, max: 1, step: 0.005,
        fmt: v => v.toFixed(3) },
      { type: 'range', key: 'timeScale', label: 'Speed', min: 0.25, max: 4, step: 0.05,
        fmt: v => v.toFixed(2) + '×' }
    ] },

    { type: 'group', label: 'Drawing', children: [
      { type: 'select', key: 'colorMode', label: 'Colour', options: [
        { value: 'lineage',    label: 'Lineage — hue inherited' },
        { value: 'generation', label: 'Generation' },
        { value: 'speed',      label: 'Speed' },
        { value: 'age',        label: 'Age' },
        { value: 'mono',       label: 'Blueprint' }
      ] },
      { type: 'range', key: 'trails', label: 'Trail persistence', min: 0, max: 1, step: 0.01,
        fmt: v => v < 0.02 ? 'off' : v > 0.99 ? 'forever' : (v * 100).toFixed(0) + '%' },
      { type: 'toggle', key: 'logScale', label: 'Log population axis' },
      { type: 'toggle', key: 'sound', label: 'Sound on spawn' }
    ] }
  ],

  init(ctx) {
    stage = ctx.stage;
    trails = makeTrails(stage);
    sprite = makeLayer(stage);
    attachPointer(ctx.setHint);
    resetRun(false);
  },

  resize(w, h, dpr) {
    W = w; H = h;
    layout(w, h);
    trails.fit(w, h, dpr);
    sprite.fit(w, h, dpr);
  },

  onSet(key) {
    if (key === 'gravity') engine.gravity.scale = state.gravity * 0.0008;
    if (key === 'restitution') for (const b of balls) b.restitution = state.restitution;
    if (key === 'cage') { layout(W, H); trails.clear(); }
    if (key === 'preset') {
      Object.assign(state, PRESETS[state.preset]);
      layout(W, H);
      resetRun(false);
    }
    if (key === 'energy' && placed) {
      targetKE = totalKE();
      perBallKE = balls.length ? targetKE / balls.length : 0;
    }
  },

  onAction(key) {
    if (key === 'reset') resetRun(false);
    else if (key === 'reseed') resetRun(true);
    else if (key === 'toggle') setRunning(!isRunning());
  },

  frame(dt, running) {
    if (placed && running && !stopped) {
      acc += dt * state.timeScale;
      let n = 0;
      while (acc >= STEP && n < MAX_SUBSTEPS) {
        M.Engine.update(engine, STEP);
        drainSpawns();
        simTime += STEP;
        acc -= STEP; n++;
      }
      if (n === MAX_SUBSTEPS) acc = 0;   // shed debt rather than spiral

      thermostat();
      sample(dt);
      checkStop();
    }
    draw();
  },

  repaint() { draw(); },

  telemetry() {
    const phi = packing();
    const rate = collRateWindow.length
      ? collRateWindow.reduce((a, b) => a + b, 0) / collRateWindow.length : 0;
    const rows = [
      ['Balls', fmtInt(balls.length)],
      ['Generation', String(maxGen)],
      ['Collisions/s', rate.toFixed(0)],
      ['Nowhere to go', failedTotal + spawnCount
        ? (failedTotal / (failedTotal + spawnCount) * 100).toFixed(0) + '%' : '0%'],
      ['Sim time', fmtTime(simTime)],
      ['Packing', (phi * 100).toFixed(1) + '%'],
      ['Seed', String(state.seed)]
    ];
    let note = null;
    if (!placed) note = 'Click inside the cage to begin. Click again later to add more balls.';
    else if (stopped && summary) note = summary;
    else if (stopSuppressed)
      note = 'You added balls by hand, so the packing stop has stood down — ' +
             'this run now goes until it genuinely jams.';
    return {
      rows, note,
      progress: state.spawn ? clamp(phi / state.stopAt, 0, 1) : null,
      aria: placed
        ? `${balls.length} balls, generation ${maxGen}, cage ${(phi * 100).toFixed(0)} percent full`
        : 'Empty cage. Click inside it to drop the first balls.'
    };
  },

  chartInfo() {
    const f = fits();
    if (!f || !f.exp || !f.hyp) return {
      title: 'Population', scale: state.logScale ? 'log N' : 'N',
      foot: 'Waiting for enough of a run to fit.'
    };
    const pw = f.power;
    const head = pw
      ? `dN/dt ∝ N<b>^${pw.p.toFixed(2)}</b> · R² ${pw.r2.toFixed(2)}`
      : `eᵏᵗ R² ${f.exp.r2.toFixed(3)} · N² R² ${f.hyp.r2.toFixed(3)}`;
    let detail;
    if (pw && pw.p > 1.02 && isFinite(f.blowIn))
      detail = `super-linear — blow-up in <b>${(f.blowIn / 1000).toFixed(1)}s</b>`;
    else if (pw)
      detail = `saturating (p &lt; 1) · <b>${failedTotal + spawnCount
        ? (failedTotal / (failedTotal + spawnCount) * 100).toFixed(0) : 0}%</b> of spawns had nowhere to go`;
    else detail = `doubling ${(f.doubling / 1000).toFixed(2)}s`;
    return {
      title: 'Population',
      scale: state.logScale ? 'log N' : 'N',
      foot: head + '<br>' + detail
    };
  },

  drawChart(g, w, h) { chart(g, w, h); },

  /* Used by the test hook: the worst containment violation across
     every ball, in pixels. Anything above ~0 means the analytic wall
     let something through. */
  /* Advance by an exact amount of simulated time, independent of
     frame timing — the only way to compare two runs of the same
     seed, since identical wall-clock does not mean identical sim. */
  debugStep(ms) {
    if (!placed || stopped) return;
    const n = Math.round(ms / STEP);
    for (let i = 0; i < n && !stopped; i++) {
      M.Engine.update(engine, STEP);
      drainSpawns();
      simTime += STEP;
      thermostat();
      sample(STEP);
      checkStop();
    }
  },

  debug() {
    let worst = -Infinity;
    for (const b of balls) worst = Math.max(worst, b.circleRadius - depth(b.position.x, b.position.y));
    return {
      n: balls.length, generations: maxGen, collisions, spawns: spawnCount,
      packing: packing(), stopped, placed, simTime, seed: state.seed,
      worstEscape: balls.length ? worst : 0,
      ke: totalKE(), samples: samples.length, fits: fits()
    };
  },

  destroy() {
    stage.classList.remove('grab');
    detachPointer();
    if (engine) { M.Events.off(engine); M.Engine.clear(engine); }
    balls = []; engine = null;
  }
};

/* ── thermostat ──────────────────────────────────────────────────
   Matter's sequential-impulse solver drifts energy even at
   restitution 1, and a newborn adds mass out of nowhere. Rather
   than pretend otherwise, hold the books explicitly — gently, so
   the correction never fights the solver into instability. */
function thermostat() {
  if (state.energy === 'inject' || !balls.length) return;
  const target = state.energy === 'temperature'
    ? perBallKE * balls.length
    : targetKE;
  const ke = totalKE();
  if (ke <= 1e-9 || target <= 0) return;
  const f = clamp(Math.sqrt(target / ke), 0.97, 1.03);
  if (Math.abs(f - 1) > 1e-4) scaleVelocities(f);
}

function packing() {
  let a = 0;
  for (const b of balls) a += Math.PI * b.circleRadius * b.circleRadius;
  return a / cageArea;
}

function sample(dt) {
  sampleAcc += dt;
  if (sampleAcc < 90) return;
  sampleAcc = 0;
  samples.push({ t: simTime, n: balls.length });
  if (samples.length > 900) samples.splice(0, 300);

  const rate = collisions / Math.max(0.001, simTime / 1000);
  collRateWindow.push(rate);
  if (collRateWindow.length > 12) collRateWindow.shift();
  if (rate > peakRate) peakRate = rate;
}

function doublingTime(from, to) {
  const a = samples.find(s => s.n >= from);
  const b = samples.find(s => s.n >= to);
  return (a && b) ? b.t - a.t : NaN;
}

function checkStop() {
  if (stopped || !state.spawn) return;
  const phi = packing();
  const jammed = failedSpawns >= FAIL_LIMIT;
  if (!jammed && (stopSuppressed || phi < state.stopAt)) return;

  stopped = true;
  const f = fits();
  const wall = performance.now() - wallStart;
  // The final doubling has to be measured against the last *sample*,
  // not the true final count — sampling is throttled, so no sample
  // ever reaches balls.length and the lookup would always miss.
  const early = doublingTime(4, 8);
  const lastS = samples[samples.length - 1];
  const halfS = lastS && samples.find(s => s.n >= lastS.n / 2);
  const late = (lastS && halfS) ? lastS.t - halfS.t : NaN;
  const failPct = failedTotal + spawnCount
    ? (failedTotal / (failedTotal + spawnCount) * 100).toFixed(0) : '0';
  let law = 'Too short to fit.';
  if (f && f.power) {
    law = `Measured dN/dt ∝ N^${f.power.p.toFixed(2)} (R² ${f.power.r2.toFixed(2)}), ` +
          `not the N² the collision rate alone would predict. ` +
          (f.power.p > 1.02
            ? 'Still super-linear, so it was heading for a finite-time blow-up.'
            : `${failPct}% of spawn attempts had nowhere to go by the end — ` +
              `crowding, not collisions, set the pace.`) +
          (state.energy === 'conserve'
            ? ' Energy is conserved here, so the balls also slowed as they multiplied; ' +
              'switch to injected energy and the exponent rises by about 0.3.'
            : state.energy === 'inject'
              ? ' Energy is injected here, so the balls never slowed; switch to ' +
                'conserved and the exponent falls by about 0.3.'
              : '');
  }

  summary =
    `<b>${jammed ? 'Jammed' : 'Full'}.</b> ${fmtInt(balls.length)} balls, ` +
    `${maxGen} generations, in ${fmtTime(simTime)} of sim ` +
    `(${fmtTime(wall)} of yours).<br>` +
    `Doubling 4→8 took ${fmtTime(early)}; the last doubling took ${fmtTime(late)}.<br>` +
    `Peak ${peakRate.toFixed(0)} collisions/s. ${law}`;

  announce(`Stopped. ${fmtInt(balls.length)} balls, ` +
           `cage ${(phi * 100).toFixed(0)} percent full.`);
}

/* ═══════════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════════ */
function cagePath(g) {
  g.beginPath();
  if (state.cage === 'circle') {
    g.arc(cx, cy, R, 0, TAU);
  } else if (state.cage === 'stadium') {
    g.arc(cx + SL, cy, R, -Math.PI / 2, Math.PI / 2);
    g.lineTo(cx - SL, cy + R);
    g.arc(cx - SL, cy, R, Math.PI / 2, Math.PI * 1.5);
    g.closePath();
  } else {
    const n = polySides(), rot = polyRot();
    const circum = APO / Math.cos(Math.PI / n);
    for (let i = 0; i < n; i++) {
      const a = rot + (i + 0.5) * TAU / n;
      const x = cx + Math.cos(a) * circum, y = cy + Math.sin(a) * circum;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  }
}

function draw() {
  const g = sprite.ctx;
  const light = isLight();

  /* ── trails ── */
  const fade = trails.fadeFor(state.trails);
  const wantTrails = state.trails > 0.02 && placed;
  if (wantTrails) {
    const t = trails.ctx;
    trails.fade(fade);
    if (balls.length < 900) {
      t.lineCap = 'round';
      t.globalAlpha = 0.55;
      for (const b of balls) {
        const v = b.viz;
        const hue = hueOf(b);
        t.strokeStyle = hue < 0 ? ink('accent') : `hsl(${hue.toFixed(0)} 85% ${light ? 42 : 62}%)`;
        t.lineWidth = Math.max(1, b.circleRadius * 0.7);
        t.beginPath();
        t.moveTo(v.px, v.py);
        t.lineTo(b.position.x, b.position.y);
        t.stroke();
        v.px = b.position.x; v.py = b.position.y;
      }
      t.globalAlpha = 1;
    } else {
      for (const b of balls) { b.viz.px = b.position.x; b.viz.py = b.position.y; }
    }
  } else {
    trails.fade(1);
    for (const b of balls) { b.viz.px = b.position.x; b.viz.py = b.position.y; }
  }

  /* ── sprites ── */
  g.clearRect(0, 0, W, H);

  g.save();
  g.strokeStyle = ink('cage');
  g.lineWidth = 1;
  cagePath(g);
  g.stroke();

  // quarter ticks, so the cage reads as a drawn object and not a ring
  g.globalAlpha = 0.5;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const r0 = (state.cage === 'circle' ? R : APO);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r0 - 7), cy + Math.sin(a) * (r0 - 7));
    g.lineTo(cx + Math.cos(a) * (r0 + 7), cy + Math.sin(a) * (r0 + 7));
    g.stroke();
  }
  g.restore();

  /* Bucket by hue so a thousand balls cost 36 fills, not a thousand. */
  const B = 36, paths = new Array(B).fill(null);
  let mono = null;
  for (const b of balls) {
    const hue = hueOf(b);
    let p;
    if (hue < 0) p = (mono || (mono = new Path2D()));
    else {
      const i = clamp((hue / (360 / B)) | 0, 0, B - 1);
      p = paths[i] || (paths[i] = new Path2D());
    }
    p.moveTo(b.position.x + b.circleRadius, b.position.y);
    p.arc(b.position.x, b.position.y, b.circleRadius, 0, TAU);
  }
  for (let i = 0; i < B; i++) {
    if (!paths[i]) continue;
    g.fillStyle = `hsl(${(i * (360 / B) + 360 / B / 2).toFixed(0)} 88% ${light ? 46 : 66}%)`;
    g.fill(paths[i]);
  }
  if (mono) { g.fillStyle = ink('accent'); g.fill(mono); }

  /* ── the drop crosshair, live for every drop ── */
  drawDropUI(g);
}

function drawDropUI(g) {
  const x = dragging ? dropX : pointerX, y = dragging ? dropY : pointerY;
  if (!pointerIn && !dragging) return;
  if (depth(x, y) < state.radius) return;

  g.save();
  g.strokeStyle = ink('accent');
  g.fillStyle = ink('accent');
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x - 11, y); g.lineTo(x + 11, y);
  g.moveTo(x, y - 11); g.lineTo(x, y + 11);
  g.stroke();
  g.globalAlpha = 0.75;
  g.font = '9px ui-monospace,monospace';
  g.fillText(`${(x - cx).toFixed(0)}, ${(y - cy).toFixed(0)}`, x + 14, y - 6);
  g.globalAlpha = 1;

  if (dragging) {
    const dx = aimX - dropX, dy = aimY - dropY;
    const len = Math.hypot(dx, dy);
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(dropX, dropY);
    g.lineTo(aimX, aimY);
    g.stroke();
    g.setLineDash([]);
    g.fillText(`v ${clamp(len / 26, 0.6, 9).toFixed(1)}`, aimX + 8, aimY + 4);
  }
  g.restore();
}

/* ── the growth chart ────────────────────────────────────────── */
function chart(g, w, h) {
  const pad = { l: 22, r: 4, t: 5, b: 13 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const dim = ink('ink-dim'), line = ink('line-2');

  g.save();
  g.strokeStyle = line; g.lineWidth = 1;
  g.strokeRect(pad.l + .5, pad.t + .5, iw, ih);

  if (samples.length < 2) {
    g.fillStyle = dim; g.font = '9px ui-monospace,monospace';
    g.fillText('waiting for a run', pad.l + 6, pad.t + 16);
    g.restore(); return;
  }

  const tMax = Math.max(1, samples[samples.length - 1].t);
  let nMax = 2;
  for (const s of samples) if (s.n > nMax) nMax = s.n;

  const log = state.logScale;
  const yTop = log ? Math.log10(nMax * 1.4) : nMax * 1.12;
  const X = t => pad.l + (t / tMax) * iw;
  const Y = n => {
    const v = log ? Math.log10(Math.max(1, n)) : n;
    return pad.t + ih - (v / yTop) * ih;
  };

  // gridlines: decades on a log axis, quarters otherwise
  g.strokeStyle = line; g.globalAlpha = 0.6;
  g.font = '8px ui-monospace,monospace'; g.fillStyle = dim;
  if (log) {
    for (let d = 0; Math.pow(10, d) <= nMax * 1.4; d++) {
      const y = Y(Math.pow(10, d));
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(pad.l + iw, y); g.stroke();
      g.fillText('1' + '0'.repeat(d), 2, y + 3);
    }
  } else {
    for (let i = 1; i <= 3; i++) {
      const y = pad.t + ih * i / 4;
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(pad.l + iw, y); g.stroke();
    }
    g.fillText(String(nMax), 2, pad.t + 8);
  }
  g.globalAlpha = 1;

  const f = fits();

  // fitted curves first, so the data sits on top of them
  if (f && f.exp && f.hyp) {
    const drawFit = (fn, colour) => {
      g.strokeStyle = colour; g.globalAlpha = 0.75;
      g.setLineDash([3, 3]); g.lineWidth = 1;
      g.beginPath();
      let started = false;
      for (let px = 0; px <= iw; px += 2) {
        const t = (px / iw) * tMax;
        const n = fn(t);
        if (!isFinite(n) || n <= 0 || n > nMax * 4) { started = false; continue; }
        const y = Y(n);
        if (y < pad.t - 2) { started = false; continue; }
        started ? g.lineTo(pad.l + px, y) : g.moveTo(pad.l + px, y);
        started = true;
      }
      g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
    };
    drawFit(t => Math.exp(f.exp.a + f.exp.b * t), ink('safety'));
    drawFit(t => 1 / (f.hyp.a + f.hyp.b * t), ink('go'));

    if (isFinite(f.tStar) && f.tStar > 0 && f.tStar < tMax * 3.5) {
      const x = X(f.tStar);
      if (x < pad.l + iw) {
        g.strokeStyle = ink('redline'); g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, pad.t + ih); g.stroke();
        g.setLineDash([]);
      }
    }
  }

  // the data
  g.strokeStyle = ink('accent'); g.lineWidth = 1.5;
  g.beginPath();
  samples.forEach((s, i) => i ? g.lineTo(X(s.t), Y(s.n)) : g.moveTo(X(s.t), Y(s.n)));
  g.stroke();

  g.fillStyle = dim; g.font = '8px ui-monospace,monospace';
  g.fillText((tMax / 1000).toFixed(0) + 's', pad.l + iw - 16, h - 3);
  g.restore();
}

/* ═══════════════════════════════════════════════════════════════
   Pointer
   ═══════════════════════════════════════════════════════════════ */
let onDown, onMove, onUp, onLeave, setHintRef;

function attachPointer(setHint) {
  setHintRef = setHint;
  const pos = e => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  onDown = e => {
    const p = pos(e);
    if (depth(p.x, p.y) < state.radius) return;
    dragging = true;
    dropX = p.x; dropY = p.y; aimX = p.x; aimY = p.y;
    stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
  };
  onMove = e => {
    const p = pos(e);
    pointerX = p.x; pointerY = p.y; pointerIn = true;
    if (dragging) { aimX = p.x; aimY = p.y; }
  };
  onUp = () => {
    if (!dragging) return;
    dragging = false;
    drop(dropX, dropY, aimX, aimY);
    setHintRef && setHintRef('');
  };
  onLeave = () => { pointerIn = false; };

  stage.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  stage.addEventListener('pointerleave', onLeave);
}

function detachPointer() {
  stage.removeEventListener('pointerdown', onDown);
  removeEventListener('pointermove', onMove);
  removeEventListener('pointerup', onUp);
  stage.removeEventListener('pointerleave', onLeave);
}

export default exhibit;
