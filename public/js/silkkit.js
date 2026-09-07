/* ═══════════════════════════════════════════════════════════════
   8 · SILKKIT — the parts of Silk that Harmonograph also needs

   E-03.2 draws with your hand and E-03.4 draws with a pendulum
   hanging off it, but they share a look: the same paper, the same
   k-fold symmetry, the same gradients, and the same rule that ink
   has to sit darker on a white sheet than it does on a dark one.

   All of this was private to silk.js until there were two callers.
   Nothing here is new — it is lifted so that there is one copy of
   each, and the gradient list in particular is a thing that will be
   tweaked and must not be tweaked in only one place.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import { ink, TAU } from './shell.js';

/* Stored as hex because that is what <input type=color> speaks;
   resolved to HSL once per stroke. 'custom' reads the two pickers. */
export const GRADIENTS = {
  blueprint: ['#7fd4ff', '#ffb277'],
  ultra:     ['#5ce1ff', '#ff5cc8'],
  sunset:    ['#ffd166', '#ef476f'],
  aurora:    ['#5ce1ff', '#8fe3ae'],
  ember:     ['#ff9a3c', '#ff2d55'],
  iris:      ['#a06bff', '#38f9d7'],
  custom:    null
};

/* The option list for a gradient <select>, so both exhibits offer
   the same names in the same order. */
export const GRADIENT_OPTIONS = [
  { value: 'ultra',     label: 'Ultra — cyan to magenta' },
  { value: 'blueprint', label: 'Blueprint — cyan to peach' },
  { value: 'sunset',    label: 'Sunset — gold to rose' },
  { value: 'aurora',    label: 'Aurora — cyan to green' },
  { value: 'ember',     label: 'Ember — amber to red' },
  { value: 'iris',      label: 'Iris — violet to teal' },
  { value: 'custom',    label: 'Custom — pick both' }
];

export function hexToHsl(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return [200, 90, 62];
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0, sat = 0;
  if (d) {
    sat = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, sat * 100, l * 100];
}

/* Interpolate the short way round the wheel — a plain lerp from 350°
   to 10° would sweep through every colour in between. */
export function mixHsl(a, b, t) {
  let dh = ((b[0] - a[0] + 540) % 360) - 180;
  return [
    (a[0] + dh * t + 360) % 360,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

export function css(hsl, alpha, light) {
  // On paper the same hue has to sit much darker to read as ink.
  const l = light ? Math.min(hsl[2], 44) : hsl[2];
  return `hsl(${hsl[0].toFixed(0)} ${hsl[1].toFixed(0)}% ${l.toFixed(0)}% / ${alpha})`;
}

export function blendFor(brush, light) {
  if (brush === 'ink') return 'source-over';
  return light ? 'multiply' : 'lighter';
}

/* Run fn once per symmetry copy, with the transform already applied.
   Coordinates handed to fn are in pixels relative to the centre, so
   line widths stay in pixels and never need un-scaling.

   k and mirror are passed in rather than read from any state,
   because a stroke must always be replayed with the symmetry it was
   drawn under — otherwise changing the fold would silently rewrite
   every stroke already on the sheet the next time anything
   re-rendered. `frame` carries the centre for the same reason: at
   export time it is the centre of a canvas four times the size. */
export function withSymmetry(g, frame, k, mirror, fn) {
  k = Math.max(1, k | 0);
  const copies = mirror ? 2 : 1;
  for (let i = 0; i < k; i++) {
    for (let m = 0; m < copies; m++) {
      g.save();
      g.translate(frame.cx, frame.cy);
      g.rotate(i * TAU / k);
      if (m) g.scale(1, -1);
      fn(g, i, m);
      g.restore();
    }
  }
}

/* Paper, and the drafting grid drawn onto it.

   Both drawing exhibits paint onto an *opaque* layer, and have to.
   Additive blending needs something to add to. Composite `lighter`
   onto a transparent canvas and the RGB channels saturate almost at
   once while alpha only creeps up by the stroke alpha each pass — so
   a stroke ends up brilliantly coloured and 93% transparent, which
   is to say invisible. `multiply` against transparent is worse: it
   is a no-op. Both want real paper underneath, so the layer paints
   its own — including the drafting grid, which would otherwise be
   hidden behind an opaque canvas.

   `grid:false` is for the Harmonograph's fade mode, where a wash
   over the whole sheet would erode the grid unevenly; there it is
   cleaner to have drawn no grid at all than a half-eaten one. */
export function paintPaper(g, w, h, { grid = true } = {}) {
  g.fillStyle = ink('paper-0');
  g.fillRect(0, 0, w, h);
  if (!grid) return;
  g.save();
  g.strokeStyle = ink('line-1'); g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x < w; x += 28) { g.moveTo(x + .5, 0); g.lineTo(x + .5, h); }
  for (let yy = 0; yy < h; yy += 28) { g.moveTo(0, yy + .5); g.lineTo(w, yy + .5); }
  g.stroke();
  g.strokeStyle = ink('line-2');
  g.beginPath();
  for (let x = 0; x < w; x += 140) { g.moveTo(x + .5, 0); g.lineTo(x + .5, h); }
  for (let yy = 0; yy < h; yy += 140) { g.moveTo(0, yy + .5); g.lineTo(w, yy + .5); }
  g.stroke();
  g.restore();
}
