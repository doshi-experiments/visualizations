/* ═══════════════════════════════════════════════════════════════
   1 · TRAILS — a persistent buffer that forgets at a chosen rate

   Shared by the Growth Cage and Divergence. The whole reason this
   is a module rather than four lines inlined twice is the fade:

   The obvious way to age a trail layer is to paint translucent
   black over it every frame. That is wrong. Repeatedly compositing
   `rgba(0,0,0,a)` over a pixel approaches the background colour
   asymptotically but never reaches it, so every trail leaves a
   permanent smear — invisible against the dark sheet, and glaring
   the moment someone flips to the light one.

   `destination-out` subtracts alpha instead of adding colour, so
   pixels genuinely reach zero and the layer is honestly empty.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import { makeLayer } from './shell.js';

export function makeTrails(stage) {
  const L = makeLayer(stage, { alpha: true });
  const ctx = L.ctx;

  return {
    layer: L,
    ctx,
    get w() { return L.w; },
    get h() { return L.h; },

    /* Resizing a canvas clears it, so carry the old image across —
       a trail that vanishes because someone dragged the window edge
       reads as a bug. */
    fit(w, h, dpr, preserve = true) {
      let old = null;
      if (preserve && L.canvas.width && L.canvas.height) {
        old = document.createElement('canvas');
        old.width = L.canvas.width;
        old.height = L.canvas.height;
        old.getContext('2d').drawImage(L.canvas, 0, 0);
      }
      L.fit(w, h, dpr);
      if (old) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(old, 0, 0, L.canvas.width, L.canvas.height);
        ctx.restore();
      }
    },

    /* amount: 0 keeps everything (paint mode), 1 clears immediately. */
    fade(amount) {
      if (amount <= 0) return;
      if (amount >= 1) { this.clear(); return; }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${amount})`;
      ctx.fillRect(0, 0, L.canvas.width, L.canvas.height);
      ctx.restore();
    },

    clear() { L.clear(); },

    /* Slider is linear, perception is not — every interesting trail
       length lives in the bottom two percent of fade, so map it
       through three decades. 0 = no trail at all, 1 = paint mode. */
    fadeFor(persistence) {
      if (persistence >= 0.995) return 0;
      return Math.pow(10, -3.3 * persistence);
    }
  };
}
