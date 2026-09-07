/* ═══════════════════════════════════════════════════════════════
   0 · SHELL — registry, router, control kit, frame governor

   Everything that is not an exhibit lives here, so that adding an
   exhibit is writing one module and one registry line. The shell
   owns: the tab strip, the control panel, the title block, the
   chart canvas, the single rAF loop, and the theme.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

export const $ = s => document.querySelector(s);
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

export const reducedMotion =
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── theme inks ──────────────────────────────────────────────────
   Canvas can't read CSS variables, so it asks for them here. The
   lookup is cached because getComputedStyle is a layout read and
   these are hit once per shape per frame otherwise. */
const inkCache = new Map();
export function ink(name) {
  let v = inkCache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement)
          .getPropertyValue('--' + name).trim();
    inkCache.set(name, v);
  }
  return v;
}
export const isLight = () =>
  document.documentElement.getAttribute('data-theme') === 'light';

/* ── seeded RNG ──────────────────────────────────────────────────
   Every random draw in every exhibit comes from one of these, so a
   run can be reproduced exactly from its seed. mulberry32 is small,
   fast and good enough for scattering balls. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── canvas layers ───────────────────────────────────────────────
   A layer is a canvas sized in device pixels but drawn in CSS
   pixels — the transform is reset on every fit(), so exhibit code
   never thinks about devicePixelRatio. */
export function makeLayer(stage, { alpha = true } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha });
  stage.appendChild(canvas);
  const L = {
    canvas, ctx, w: 0, h: 0, dpr: 1,
    fit(w, h, dpr) {
      L.w = w; L.h = h; L.dpr = dpr;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    clear() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  };
  return L;
}

/* ── stage area ──────────────────────────────────────────────────
   Where an exhibit may actually draw: the viewport minus the
   floating panels, so nothing important is ever rendered
   underneath one. On a wide sheet the panels flank the stage; on a
   narrow one the title block sits above it and the controls below.
   Kept here because every exhibit needs the same answer. */
export function safeRect(w, h) {
  if (w > 920) return { x: 332, y: 112, w: w - 332 - 292, h: h - 112 - 64 };
  return { x: 14, y: 246, w: w - 28, h: h * 0.46 };
}

/* ── number formatting ───────────────────────────────────────── */
export const fmtInt = n => n.toLocaleString('en-US');
export const fmtFixed = (n, d = 2) =>
  (!isFinite(n) ? '—' : n.toFixed(d));
export function fmtTime(ms) {
  if (!isFinite(ms)) return '—';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
}

/* ═══════════════════════════════════════════════════════════════
   1 · Control kit — declarative controls into sheet-styled DOM

   Spec entries:
     {type:'range',  key, label, min, max, step, fmt}
     {type:'toggle', key, label}
     {type:'select', key, label, options:[{value,label}]}
     {type:'button', key, label, danger, primary, onClick}
     {type:'group',  label, when, children:[…]}
   `when(state)` on any entry hides it when false.
   ═══════════════════════════════════════════════════════════════ */
export function renderControls(container, spec, state, onChange) {
  container.textContent = '';
  const refresh = [];

  const build = (entry, parent) => {
    if (entry.type === 'group') {
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = entry.label;
      fs.appendChild(lg);
      entry.children.forEach(c => build(c, fs));
      parent.appendChild(fs);
      if (entry.when) refresh.push(() => {
        const on = !!entry.when(state);
        fs.hidden = !on;
        // inert keeps hidden controls out of the tab order in browsers
        // that still focus display:none children during a find-in-page.
        if ('inert' in fs) fs.inert = !on;
      });
      return;
    }

    if (entry.type === 'button') {
      let row = parent.lastElementChild;
      if (!row || !row.classList.contains('btnrow')) {
        row = document.createElement('div');
        row.className = 'btnrow';
        parent.appendChild(row);
      }
      const b = document.createElement('button');
      b.className = 'btn' + (entry.danger ? ' danger' : '') +
                    (entry.primary ? ' primary' : '');
      b.textContent = entry.label;
      b.addEventListener('click', () => onChange(entry.key, true, entry));
      row.appendChild(b);
      if (entry.labelFn) refresh.push(() => { b.textContent = entry.labelFn(state); });
      if (entry.when) refresh.push(() => { b.hidden = !entry.when(state); });
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'ctl' + (entry.type === 'toggle' ? ' tog' : '');
    const id = 'c_' + entry.key;

    if (entry.type === 'toggle') {
      const lab = document.createElement('label');
      lab.htmlFor = id;
      const span = document.createElement('span');
      span.textContent = entry.label;
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.id = id; inp.checked = !!state[entry.key];
      inp.addEventListener('change', () => onChange(entry.key, inp.checked, entry));
      lab.append(span, inp);
      wrap.appendChild(lab);
      refresh.push(() => { inp.checked = !!state[entry.key]; });

    } else {
      const lab = document.createElement('div');
      lab.className = 'lab';
      const name = document.createElement('label');
      name.htmlFor = id; name.textContent = entry.label;
      const val = document.createElement('span');
      val.className = 'val';
      lab.append(name, val);
      wrap.appendChild(lab);

      if (entry.type === 'range') {
        const inp = document.createElement('input');
        inp.type = 'range'; inp.id = id;
        inp.min = entry.min; inp.max = entry.max; inp.step = entry.step;
        inp.value = state[entry.key];
        const show = () => {
          val.textContent = entry.fmt
            ? entry.fmt(+inp.value, state) : String(+inp.value);
        };
        inp.addEventListener('input', () => {
          onChange(entry.key, +inp.value, entry); show();
        });
        wrap.appendChild(inp); show();
        refresh.push(() => {
          if (+inp.value !== state[entry.key]) inp.value = state[entry.key];
          show();
        });

      } else if (entry.type === 'color') {
        val.textContent = '';
        const inp = document.createElement('input');
        inp.type = 'color'; inp.id = id;
        inp.value = state[entry.key];
        inp.addEventListener('input', () => onChange(entry.key, inp.value, entry));
        wrap.appendChild(inp);
        refresh.push(() => {
          if (inp.value !== state[entry.key]) inp.value = state[entry.key];
        });

      } else if (entry.type === 'select') {
        val.textContent = '';
        const sel = document.createElement('select');
        sel.id = id;
        for (const o of entry.options) {
          const op = document.createElement('option');
          op.value = o.value; op.textContent = o.label;
          sel.appendChild(op);
        }
        sel.value = state[entry.key];
        sel.addEventListener('change', () => onChange(entry.key, sel.value, entry));
        wrap.appendChild(sel);
        refresh.push(() => { sel.value = state[entry.key]; });
      }
    }

    if (entry.when) refresh.push(() => {
      const on = !!entry.when(state);
      wrap.hidden = !on;
      if ('inert' in wrap) wrap.inert = !on;
    });
    parent.appendChild(wrap);
  };

  const root = document.createElement('div');
  spec.forEach(e => build(e, root));
  container.appendChild(root);
  const sync = () => refresh.forEach(f => f());
  sync();
  return sync;
}

/* ═══════════════════════════════════════════════════════════════
   2 · Runtime — mount exhibits, route, drive one rAF loop
   ═══════════════════════════════════════════════════════════════ */
const stage = $('#stage');
const tabsEl = $('#tabs');
const panelBody = $('#panelBody');
const tbRows = $('#tbRows');
const barFill = $('#barFill');
const tbNote = $('#tbNote');
const chartWrap = $('#chartwrap');
const chartCv = $('#chart');
const chartCtx = chartCv.getContext('2d');
const hintEl = $('#hint');
const liveEl = $('#live');
const titleEl = $('#exhibitTitle');

let exhibits = [];
let active = null;
let syncControls = () => {};
let running = false;
let raf = 0, lastTs = 0;
let telemetryAcc = 0, chartAcc = 0;
let slowFrames = 0, quality = 2;   // 2 = full, 1 = reduced trails, 0 = minimal

export const announce = msg => { liveEl.textContent = msg; };
export function setHint(text) {
  if (!text) { hintEl.hidden = true; return; }
  hintEl.hidden = false;
  hintEl.textContent = text;
}
export const getQuality = () => quality;
export const isRunning = () => running;

export function setRunning(v) {
  running = !!v;
  syncControls();
}

/* ── sizing ──────────────────────────────────────────────────── */
function currentSize() {
  const r = stage.getBoundingClientRect();
  return {
    w: Math.max(1, Math.round(r.width)),
    h: Math.max(1, Math.round(r.height)),
    dpr: Math.min(window.devicePixelRatio || 1, 2)
  };
}
function doResize() {
  if (!active) return;
  const { w, h, dpr } = currentSize();
  active.resize(w, h, dpr);
  sizeChart();
  if (active.repaint) active.repaint();
}

function sizeChart() {
  if (chartWrap.hidden) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = chartCv.clientWidth || 200, h = chartCv.clientHeight || 104;
  chartCv.width = Math.round(w * dpr);
  chartCv.height = Math.round(h * dpr);
  chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ── the one loop ────────────────────────────────────────────── */
function loop(ts) {
  raf = requestAnimationFrame(loop);
  const dt = lastTs ? Math.min(64, ts - lastTs) : 16.7;
  lastTs = ts;

  if (!active) return;

  const t0 = performance.now();
  if (active.frame) active.frame(dt, running);
  const cost = performance.now() - t0;

  // Degrade rather than stutter, and say so in the title block.
  if (cost > 24) { if (++slowFrames > 30 && quality > 0) { quality--; slowFrames = 0; } }
  else if (slowFrames > 0) slowFrames--;

  telemetryAcc += dt;
  if (telemetryAcc > 180) { telemetryAcc = 0; paintTelemetry(); }

  if (!chartWrap.hidden) {
    chartAcc += dt;
    if (chartAcc > 120) { chartAcc = 0; paintChart(); }
  }
}

function paintTelemetry() {
  if (!active || !active.telemetry) return;
  const t = active.telemetry();
  const rows = t.rows || [];
  // Rebuild only when the shape changes; otherwise patch text in place.
  if (tbRows.childElementCount !== rows.length) {
    tbRows.textContent = '';
    for (const _ of rows) {
      const d = document.createElement('div');
      d.className = 'row';
      d.append(document.createElement('span'), document.createElement('b'));
      tbRows.appendChild(d);
    }
  }
  rows.forEach(([k, v], i) => {
    const el = tbRows.children[i];
    if (el.children[0].textContent !== k) el.children[0].textContent = k;
    const s = String(v);
    if (el.children[1].textContent !== s) el.children[1].textContent = s;
  });

  const p = t.progress;
  barFill.parentElement.hidden = (p == null);
  if (p != null) barFill.style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%';

  const note = quality < 2
    ? (t.note ? t.note + ' · ' : '') + 'Quality reduced to hold frame rate.'
    : t.note;
  tbNote.hidden = !note;
  if (note) tbNote.innerHTML = note;

  if (t.aria) stage.setAttribute('aria-label', t.aria);
}

function paintChart() {
  if (!active || !active.drawChart) return;
  const w = chartCv.clientWidth, h = chartCv.clientHeight;
  chartCtx.clearRect(0, 0, w, h);
  active.drawChart(chartCtx, w, h);
  if (active.chartInfo) {
    const i = active.chartInfo();
    if (i.title) $('#chartTitle').textContent = i.title;
    if (i.scale != null) $('#chartScale').textContent = i.scale;
    $('#chartFoot').innerHTML = i.foot || '';
  }
}

/* ── switching ───────────────────────────────────────────────── */
function mount(ex) {
  if (active) {
    if (active.destroy) active.destroy();
    stage.textContent = '';
  }
  active = ex;
  quality = 2; slowFrames = 0;

  titleEl.firstChild.nodeValue = ex.title || ex.name;
  document.title = (ex.title || ex.name) + ' — Visualizations — Rishabh Doshi';

  for (const b of tabsEl.children)
    b.setAttribute('aria-selected', String(b.dataset.id === ex.id));

  const { w, h, dpr } = currentSize();
  ex.init({ stage, announce, setHint, w, h, dpr });
  ex.resize(w, h, dpr);

  chartWrap.hidden = !ex.drawChart;
  sizeChart();

  syncControls = renderControls(panelBody, ex.controls, ex.state, (key, value, entry) => {
    if (entry.type === 'button') { ex.onAction(key); }
    else { ex.state[key] = value; if (ex.onSet) ex.onSet(key, value); }
    syncControls();
  });

  // Nothing animates unasked.
  running = !reducedMotion && ex.autorun !== false;
  setHint(ex.hint || '');
  paintTelemetry();
  if (ex.repaint) ex.repaint();
  announce((ex.code || '') + ' ' + (ex.title || ex.name) + ' loaded.');
}

function routeFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  const id = raw.split('?')[0];
  return exhibits.find(e => e.id === id) || exhibits[0];
}

export function boot(list) {
  exhibits = list;

  for (const ex of exhibits) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'false');
    b.dataset.id = ex.id;
    b.innerHTML = `<span class="code">${ex.code}</span><span class="name">${ex.name}</span>`;
    b.addEventListener('click', () => {
      if (active && active.id === ex.id) return;
      location.hash = ex.id;
    });
    tabsEl.appendChild(b);
  }

  /* theme */
  const themeBtn = $('#theme');
  const paintTheme = (t, write) => {
    document.documentElement.setAttribute('data-theme', t);
    themeBtn.setAttribute('aria-checked', String(t === 'light'));
    inkCache.clear();
    if (write) {
      const bits = 'sheet-theme=' + t + ';path=/;max-age=31536000;samesite=lax';
      try { document.cookie = bits + ';domain=.rishabhdoshi.com'; } catch (e) {}
      try { document.cookie = bits; } catch (e) {}
      try { localStorage.setItem('sheet-theme', t); } catch (e) {}
    }
    if (active && active.repaint) active.repaint();
    paintTelemetry();
    if (!chartWrap.hidden) paintChart();
  };
  paintTheme(document.documentElement.getAttribute('data-theme'), false);
  themeBtn.addEventListener('click', () =>
    paintTheme(isLight() ? 'dark' : 'light', true));

  /* panel collapse */
  const panel = $('#panel'), pt = $('#panelToggle');
  const setPanel = open => {
    panel.dataset.open = String(open);
    pt.setAttribute('aria-expanded', String(open));
    pt.textContent = open ? 'Hide' : 'Show';
  };
  pt.addEventListener('click', () => setPanel(panel.dataset.open !== 'true'));
  // On a phone the drawer would cover the exhibit it controls, so it
  // starts closed and the visitor opens it when they want it.
  if (innerWidth <= 920) setPanel(false);

  /* keyboard */
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && !(t && t.closest && t.closest('button'))) {
      e.preventDefault(); setRunning(!running);
      announce(running ? 'Running.' : 'Paused.');
    } else if (k === 'r') {
      if (active && active.onAction) { active.onAction('reset'); syncControls(); }
    } else if (k >= '1' && k <= String(exhibits.length)) {
      location.hash = exhibits[+k - 1].id;
    }
  });

  /* sizing + visibility */
  new ResizeObserver(doResize).observe(stage);
  addEventListener('orientationchange', () => setTimeout(doResize, 120));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { lastTs = 0; raf = requestAnimationFrame(loop); }
  });

  addEventListener('hashchange', () => {
    const ex = routeFromHash();
    if (!active || ex.id !== active.id) mount(ex);
  });

  mount(routeFromHash());
  raf = requestAnimationFrame(loop);

  /* Opt-in test hook. The Growth Cage's central invariant — that no
     ball is ever outside the wall — is only checkable from inside,
     so expose the active exhibit when the URL asks for it. Off by
     default so the page keeps no globals in normal use. */
  if (/(^|[?&#])debug/.test(location.hash + location.search)) {
    window.__e03 = {
      get active() { return active; },
      running: () => running,
      setRunning,
      debug: () => (active && active.debug ? active.debug() : null),
      step: ms => (active && active.debugStep ? active.debugStep(ms) : null)
    };
  }

  console.log(
    '%cSheet E-03 · Visualizations',
    'font-weight:bold;font-size:14px;color:#7fd4ff',
    '\nThe collision rate says the cage should blow up as N². It measures out ' +
    'below N¹ instead —\nthe balls cool as they multiply, and newborns run out ' +
    'of room.\nSheet E-03 · hello@rishabhdoshi.com'
  );
}
