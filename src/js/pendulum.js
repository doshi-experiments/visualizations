/* ═══════════════════════════════════════════════════════════════
   7 · PENDULUM — the equations of motion, once

   Two exhibits integrate double pendulums: E-03.3 Divergence hangs
   a hundred of them from a fixed point to watch chaos separate
   them, and E-03.4 Harmonograph hangs them from your cursor and
   uses the lower bobs as ink. Two copies of the same equations
   would drift apart, so there is one copy and it lives here.

   Angles are measured from the *downward* vertical, and the canvas
   y axis points down, so a bob at θ=0 hangs directly below its
   pivot and gravity is +y. That convention is what makes
   effectiveGravity() below a rotation rather than a rederivation.

   Deliberately not a physics engine. A constraint solver's
   iterative damping is exactly what would destroy Divergence's
   demonstration — the Lyapunov exponent you would measure would be
   the solver's, not the system's.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* p = { l1, l2, m1, m2, g, damp } — a stable shape, held by the
   caller and reused, so this stays monomorphic. */
export function deriv(s, o, p) {
  const t1 = s[0], w1 = s[1], t2 = s[2], w2 = s[3];
  const m1 = p.m1, m2 = p.m2, l1 = p.l1, l2 = p.l2, g = p.g;

  const d = t1 - t2;
  const sd = Math.sin(d), cd = Math.cos(d);
  const den = 2 * m1 + m2 - m2 * Math.cos(2 * d);

  o[0] = w1;
  o[1] = (-g * (2 * m1 + m2) * Math.sin(t1)
          - m2 * g * Math.sin(t1 - 2 * t2)
          - 2 * sd * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cd))
         / (l1 * den);
  o[2] = w2;
  o[3] = (2 * sd * (w1 * w1 * l1 * (m1 + m2)
          + g * (m1 + m2) * Math.cos(t1)
          + w2 * w2 * l2 * m2 * cd))
         / (l2 * den);

  /* A viscous drag on each angular coordinate. This is not the
     exact Rayleigh dissipation for a coupled two-body system —
     that would couple the two terms — it is the cheap
     approximation. It bleeds energy, it settles, and it gives the
     Harmonograph's brush its slack. Divergence passes damp:0 and
     never touches this branch, because a damped pendulum converges
     on the bottom instead of diverging and there would be nothing
     left to measure. */
  if (p.damp !== 0) {
    o[1] -= p.damp * w1;
    o[3] -= p.damp * w2;
  }
}

/* Scratch, allocated once. Only one exhibit is mounted at a time
   and every call below is synchronous, so sharing is safe. */
const k1 = new Float64Array(4), k2 = new Float64Array(4);
const k3 = new Float64Array(4), k4 = new Float64Array(4);
const tmp = new Float64Array(4), cur = new Float64Array(4);

/* Classic RK4 over the four-element slice starting at `base`. */
export function rk4(arr, base, h, p) {
  for (let i = 0; i < 4; i++) cur[i] = arr[base + i];

  deriv(cur, k1, p);
  for (let i = 0; i < 4; i++) tmp[i] = cur[i] + k1[i] * h / 2;
  deriv(tmp, k2, p);
  for (let i = 0; i < 4; i++) tmp[i] = cur[i] + k2[i] * h / 2;
  deriv(tmp, k3, p);
  for (let i = 0; i < 4; i++) tmp[i] = cur[i] + k3[i] * h;
  deriv(tmp, k4, p);

  for (let i = 0; i < 4; i++)
    arr[base + i] = cur[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}

/* Total mechanical energy. Meaningless once damp is non-zero — the
   whole point of damping is that this falls. */
export function energy(arr, base, p) {
  const t1 = arr[base], w1 = arr[base + 1], t2 = arr[base + 2], w2 = arr[base + 3];
  const m1 = p.m1, m2 = p.m2, l1 = p.l1, l2 = p.l2, g = p.g;
  const ke = 0.5 * m1 * l1 * l1 * w1 * w1 +
             0.5 * m2 * (l1 * l1 * w1 * w1 + l2 * l2 * w2 * w2 +
                         2 * l1 * l2 * w1 * w2 * Math.cos(t1 - t2));
  const pe = -(m1 + m2) * g * l1 * Math.cos(t1) - m2 * g * l2 * Math.cos(t2);
  return ke + pe;
}

/* ═══════════════════════════════════════════════════════════════
   A pivot that moves

   Drag the pivot and the pendulum is no longer in an inertial
   frame: every mass feels a pseudo-force −a. Skipping this is not
   a small inaccuracy — it is the difference between a tool and a
   dead one. With the pivot merely translated, the bobs are towed
   along rigidly and never swing at all. With the pseudo-force, an
   accelerating hand whips them.

   Gravity becomes a *vector*:

       g_eff = (0, g) − (aₓ, a_y)          screen coords, y down

   and because θ is measured from the downward vertical, a general
   gravity direction is just a constant rotation of the angle
   coordinates. So there are no new equations: integrate
   (θ₁−φ, ω₁, θ₂−φ, ω₂) with gravity G, then add φ back. Angular
   velocities are unchanged by a constant rotation, which is what
   makes this exact within a step rather than an approximation.

   `ax`/`ay` must already be in arm-lengths per second squared —
   the simulation works in arm-lengths and the pointer works in
   pixels, so the caller divides by the arm's pixel length first.
   ═══════════════════════════════════════════════════════════════ */
export function effectiveGravity(ax, ay, g, maxG) {
  const gx = -ax, gy = g - ay;
  let G = Math.hypot(gx, gy);

  // A flicked pointer produces an enormous acceleration estimate,
  // and a large G at a fixed dt will go unstable and take the whole
  // ensemble to NaN in a frame. The clamp is the load-bearing line
  // in this function.
  const cap = maxG || g * 8;
  if (G > cap) G = cap;

  // Near free-fall the direction is meaningless and the pendulums
  // are weightless; hold the last sensible heading by returning
  // straight down rather than letting atan2 spin on noise.
  const phi = G < 1e-6 ? 0 : Math.atan2(gx, gy);
  return { G, phi };
}
