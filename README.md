# visualizations

**Sheet E-03** — three interactive exhibits on one drawing sheet, filling the
Visualizations slot that [experiments-landing](https://github.com/doshi-experiments/experiments-landing)
(Sheet A-002) had reserved and left empty.

Live at **visualizations.rishabhdoshi.com**. Companions: Sheet A-001
([portfolio-landing](https://github.com/doshi-experiments/portfolio-landing)) and
Sheet A-002.

| Code | Exhibit | What it is |
|---|---|---|
| E-03.1 | Growth Cage | Balls in a cage; every collision spawns another. Measures its own growth exponent. |
| E-03.2 | Silk | k-fold symmetric drawing surface with a velocity-reactive strand brush. |
| E-03.3 | Divergence | 120 double pendulums a billionth of a radian apart, and the Lyapunov exponent fitted live. |

## The interesting part of E-03.1

The tempting argument is that collision rate in a gas goes as N², every collision
spawns a ball, so `dN/dt = kN²` and the population blows up at a finite,
calculable time. That holds for about a second.

Rather than assume a law, the page measures the exponent: it estimates `dN/dt` by
central difference and regresses `log(rate)` on `log(N)`, so the slope *is* `p` in
`dN/dt = kN^p`. Measured over full runs to the jamming limit:

| Setting | p |
|---|---|
| Energy injected (default) | ≈ 0.7–0.9 |
| Energy conserved | ≈ 0.86 |
| Conserved, smaller balls | ≈ 0.63 |

A default run reaches roughly 3,500 balls and 100 generations before the cage
jams at 80% packing — close enough to the hexagonal limit that the packing is
visibly crystalline at the edges.

Three brakes, in the order they bite:

1. **Cooling.** With total energy fixed, sharing it among more balls makes each
   slower — mean speed falls as `N^-1/2`, and collision rate carries a factor of
   `v`. Switch Energy to *injected*, the balls stop slowing, and the measured
   exponent rises by about 0.3. It does, reproducibly.
2. **Crowding.** A newborn needs somewhere to go, and placement fails more often
   as packing climbs. This brake has no ceiling — it reaches a full stop at
   jamming. It is what ends a run and what pulls `p` below 1.
3. **The refractory period τ**, capping each ball at one spawn per τ. This one
   turns out *not* to bind at the defaults: measured rates sit far below the `1/τ`
   ceiling, and shortening τ from 130ms to 30ms barely moves `p`.

So the cage is logistic, not explosive. Watching the N² intuition break is the
exhibit.

Balls can be dropped at any point in a run, not just at the start — each handful
gets its own hue family, so a later drop reads as a separate bloodline invading a
settled cage. Adding by hand is taken as an explicit "keep going", so the
automatic packing stop stands down and only a genuine jam ends the run.

Lineage colour inherits from **one** parent plus a mutation, not the average of
both. Averaging was the first thing I tried, and it looks wrong past about forty
generations: blending halves the variance every generation, so a hundred
generations in, every ball is the same colour and the lineage view stops showing
lineage. That is the classic objection to blending inheritance, showing up here
for exactly the same reason.

## Adding an exhibit

Write one module in `public/js/` that default-exports the contract documented at
the top of `shell.js`, then add it to the array in `public/js/boot.js`. That is the
whole content model — the tab strip, the number-key shortcuts, the control panel,
the title-block telemetry and the chart all derive from it.

Controls are declarative; the shell renders them:

```js
{ type:'range',  key:'trails', label:'Trail persistence', min:0, max:1, step:.01, fmt: v => … }
{ type:'select', key:'cage',   label:'Shape', options:[…] }
{ type:'group',  label:'Physics', when: s => s.spawn, children:[…] }
```

## Layout

```
public/
  index.html            sheet chrome, tokens, control-panel styles
  js/
    shell.js            registry, router, control kit, the one rAF loop
    trails.js           persistent trail buffer
    growth-cage.js      E-03.1
    silk.js             E-03.2
    divergence.js       E-03.3
  vendor/
    matter.min.js       0.20.0
    perfect-freehand.mjs 1.2.2
```

## Dependencies

Two, both vendored into `public/vendor/` and pinned rather than pulled from a CDN
— no third-party request at runtime, works offline, and the deploy stays a plain
asset upload.

- **Matter.js** in the Growth Cage, for its grid broad phase and its
  `collisionStart` event, which *is* the spawn rule.
- **perfect-freehand** for Silk's Ribbon and Ink brushes, which turns a pointer
  path into a pressure-variable filled outline instead of a stroked line.

Divergence deliberately uses **neither**. A physics engine's constraint solver is
soft and iterative, and its numerical damping is precisely what would destroy the
demonstration — damped pendulums converge instead of diverging, and the exponent
you would measure would be the solver's, not the system's. The equations of motion
are integrated directly with RK4; energy drift stays under 0.001% over a minute.

## Three things that are easy to get wrong

**The cage wall is not a physics body.** Matter cannot express a hollow circle as
one body, so the usual recipe is a ring of a hundred thin static rectangles — which
is visibly faceted and a tunnelling hazard at speed. Here the wall is reflected
analytically in an `afterUpdate` hook: exact curvature, and in testing nothing has
ever escaped by more than 0.0000px.

**Trails fade with `destination-out`.** Painting translucent black over a layer
approaches the background asymptotically but never reaches it, so every trail
leaves permanent grey — invisible on the dark sheet and glaring on the light one.

**Silk's paint layer is opaque, and has to be.** Composite `lighter` onto a
transparent canvas and the colour channels saturate while alpha only creeps up by
the stroke alpha per pass, so strokes come out brilliantly coloured and 93%
transparent. `multiply` against transparent is worse — it is a no-op. The layer
paints its own paper, drafting grid included.

## Develop

```sh
npx wrangler dev
```

Native ES modules need a server; `file://` will not work.

Append `?debug` to the hash (`/#growth?debug`) to expose `window.__e03`, which
gives the active exhibit, `debug()` for its internal state — including the worst
containment violation across every ball — and `step(ms)` to advance the simulation
by an exact amount of simulated time. Equal wall-clock is not equal sim time, so
`step()` is the only way to check that a seed reproduces a run.

## Deploy

Connected to Cloudflare and deployed on push to `main`. There is no build step:
`public/` is uploaded as-is.

## The shared theme cookie

The light/dark toggle writes a `sheet-theme` cookie scoped to `.rishabhdoshi.com`,
so the choice follows you across the subdomains. The head script that stamps
`data-theme` before first paint is byte-identical across all three sheets — three
repos depend on that cookie name and scope, and a typo fails silently and only in
production.
