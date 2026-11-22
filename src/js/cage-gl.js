/* ═══════════════════════════════════════════════════════════════
   7 · CAGE-GL — the Growth Cage, rendered as a substance

   Three thousand discs read as three thousand discs. The same three
   thousand rendered as a density field read as one material: they
   merge where they touch, hold surface tension where they don't, and
   the jamming transition stops being something you infer from the
   chart and becomes something you watch happen.

   Pipeline, per frame:

     trail   decayed in place, then bright splats added   (glowing wake)
     dens    density and colour accumulated fresh          (the field)
     scene   dens resolved into a lit surface over trail   (the material)
     post    bloom, aberration, vignette, grain            (see gl.js)

   Physics is the bottleneck here, not any of this — profiled at
   ~38ms/frame of Matter against under 8ms of drawing at N=2000 — so
   none of this costs the simulation anything it was otherwise using.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import { program, fullscreenVert, makeTarget, makePost, supported } from './gl.js';

/* ── instanced splat: one quad per ball ──────────────────────── */
const SPLAT_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 i_pos;
layout(location=2) in vec3 i_data;   // radius, hue, speed01

out vec2  v_local;
out float v_hue;
out float v_speed;

uniform vec2  u_res;
uniform float u_kernel;              // how far past the radius the field reaches

void main() {
  v_local = a_corner;
  v_hue = i_data.y;
  v_speed = i_data.z;
  vec2 p = i_pos + a_corner * i_data.x * u_kernel;
  gl_Position = vec4((p / u_res * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);
}`;

const HSL = `
vec3 hue2rgb(float h) {
  h = fract(h);
  vec3 c = abs(h * 6.0 - vec3(3.0, 2.0, 4.0));
  return clamp(vec3(c.x - 1.0, 2.0 - c.y, 2.0 - c.z), 0.0, 1.0);
}`;

/* Density pass. The falloff is a cubed quadratic — smooth to zero at
   the kernel edge, which is what lets neighbouring balls fuse without
   a visible seam where their quads end. */
/* Two targets, because one cannot carry both jobs.

   The field that decides the *silhouette* has to be wide and smooth so
   neighbouring balls fuse. But a wide field is flat in the interior of
   a crowd — its gradient is zero, so there is no normal, no shading,
   and a packed cage renders as one dead slab. And a colour averaged
   over every ball touching a pixel converges on the mean hue, which
   erases the lineage the exhibit exists to show.

   So: target 0 carries colour weighted by a *sharp* kernel, which makes
   the nearest ball dominate and keeps hues distinct. Target 1 carries
   the wide merging field in .r and a tight per-ball core in .g, and the
   normal is taken from the core so individual spheres still bulge
   inside the merged mass. */
const DENS_FS = `#version 300 es
precision highp float;
in vec2 v_local; in float v_hue; in float v_speed;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oField;
uniform float u_kernel;
${HSL}
void main() {
  float d = length(v_local);
  if (d > 1.0) discard;

  /* Normalise so the field is exactly 0.5 at the ball's true edge,
     whatever the merge radius. Without this the threshold and the
     merge radius fight each other: widening the kernel pushes the
     isosurface inward, and balls render at a fraction of their real
     size while the physics still treats them as full width. */
  float k = max(u_kernel, 1.05);
  float edge = pow(1.0 - 1.0 / k, 3.0);
  float wide = pow(max(0.0, 1.0 - d), 3.0) / edge * 0.5;

  // d measured against the true ball edge rather than the kernel edge
  float dc = clamp(d * u_kernel, 0.0, 1.0);
  float core = pow(1.0 - dc, 2.0);

  // Sharp enough to act as a soft argmax: the nearest centre wins.
  float sharp = pow(1.0 - d, 12.0) + 1e-5;

  vec3 col = hue2rgb(v_hue) * (0.85 + v_speed * 0.5);
  oCol   = vec4(col * sharp, sharp);
  oField = vec4(wide, core, 0.0, 1.0);
}`;

/* Trail splat: tight, bright, additive, and left to decay. */
const TRAIL_FS = `#version 300 es
precision highp float;
in vec2 v_local; in float v_hue; in float v_speed;
out vec4 o;
${HSL}
void main() {
  float d = length(v_local);
  if (d > 1.0) discard;
  float w = pow(max(0.0, 1.0 - d), 5.0);
  o = vec4(hue2rgb(v_hue) * w * (0.10 + v_speed * 0.30), w);
}`;

const DECAY_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
void main() { o = vec4(1.0); }`;   // colour comes from the blend constant

/* Resolve: threshold the field into a surface, light it, and refract
   the drafting grid through it. */
const RESOLVE_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;

uniform sampler2D u_col, u_field, u_trail;
uniform vec2  u_res;
uniform float u_threshold, u_soft, u_refract, u_metal, u_light, u_gridFade;
uniform vec3  u_ink, u_paper;

float grid(vec2 p) {
  vec2 m = abs(fract(p / 28.0) - 0.5);
  vec2 M = abs(fract(p / 140.0) - 0.5);
  float minor = smoothstep(0.5, 0.49, max(m.x, m.y));
  float major = smoothstep(0.5, 0.487, max(M.x, M.y));
  return minor * 0.35 + major * 0.65;
}

void main() {
  vec2 px = 1.0 / u_res;
  vec2 f = texture(u_field, v_uv).rg;

  // Silhouette from the wide field, shading from the tight core.
  float cx1 = texture(u_field, v_uv + vec2(px.x, 0)).g;
  float cx0 = texture(u_field, v_uv - vec2(px.x, 0)).g;
  float cy1 = texture(u_field, v_uv + vec2(0, px.y)).g;
  float cy0 = texture(u_field, v_uv - vec2(0, px.y)).g;
  vec3 n = normalize(vec3(-(cx1 - cx0) * 9.0, -(cy1 - cy0) * 9.0, 0.10));

  float surf = smoothstep(u_threshold - u_soft, u_threshold + u_soft, f.r);

  // background: the drafting grid, bent through the surface
  vec2 bgUv = v_uv + n.xy * u_refract * surf;
  float g = grid(bgUv * u_res) * u_gridFade;
  vec3 bg = u_paper + u_ink * g;

  vec4 cc = texture(u_col, v_uv);
  vec3 base = cc.rgb / max(cc.a, 1e-5);

  vec3 L = normalize(vec3(-0.45, -0.6, 0.66));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 26.0);
  float rim  = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.5);

  /* Highlights are deliberately pushed past 1.0 — that is the whole
     reason the buffer is half-float. Anything that stays under the
     bright-pass threshold never blooms, and the cage renders as flat
     stickers rather than wet glass. */
  vec3 lit = base * (0.50 + 0.85 * diff)
           + vec3(spec) * (1.9 * u_metal)
           + base * rim * 0.75;

  // On white paper the same surface has to read as pigment, not light.
  lit = mix(lit, base * (0.55 + 0.45 * diff) * 0.85, u_light);

  vec3 trail = texture(u_trail, v_uv).rgb;
  vec3 c = bg + trail * (1.0 - surf * 0.75);
  c = mix(c, lit, surf);

  o = vec4(c, 1.0);
}`;

/* Glow mode: the balls stay discrete, but as light rather than paint. */
const GLOW_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_col, u_field, u_trail;
uniform float u_light, u_gridFade;
uniform vec2 u_res;
uniform vec3 u_ink, u_paper;

float grid(vec2 p) {
  vec2 m = abs(fract(p / 28.0) - 0.5);
  vec2 M = abs(fract(p / 140.0) - 0.5);
  return smoothstep(0.5, 0.49, max(m.x, m.y)) * 0.35
       + smoothstep(0.5, 0.487, max(M.x, M.y)) * 0.65;
}

void main() {
  vec4 cc = texture(u_col, v_uv);
  vec3 base = cc.rgb / max(cc.a, 1e-5);
  vec2 f = texture(u_field, v_uv).rg;
  float core = smoothstep(0.25, 0.8, f.g);
  float halo = smoothstep(0.0, 0.55, f.r);
  vec3 c = u_paper + u_ink * grid(v_uv * u_res) * u_gridFade
         + texture(u_trail, v_uv).rgb
         + base * (halo * 0.30 + core * 1.25);
  c = mix(c, base * (0.5 + core * 0.6), u_light);
  o = vec4(c, 1.0);
}`;

export function createCageRenderer(stage) {
  if (!supported()) return { ok: false };

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  stage.appendChild(canvas);
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, premultipliedAlpha: false
  });
  if (!gl) { canvas.remove(); return { ok: false }; }

  // Rendering *to* a float texture is an extension even in WebGL2.
  const hdr = !!gl.getExtension('EXT_color_buffer_float');

  /* WebGL being *present* is not the same as WebGL being *fast*.
     The post chain is about ten fullscreen passes, which a real GPU
     eats without noticing and a software rasteriser does not: measured
     at 47ms a frame under SwiftShader with sixteen balls on screen,
     where the entire cost is pixels rather than anything to do with
     the simulation. So ask what is actually doing the work, and let
     the caller default to the Canvas path when the answer is a CPU. */
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = String(
    (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || ''
  );
  const software = /swiftshader|software|llvmpipe|basic render|microsoft basic/i.test(rendererName);

  const splatDens = program(gl, SPLAT_VS, DENS_FS);
  const splatTrail = program(gl, SPLAT_VS, TRAIL_FS);
  const decay = program(gl, fullscreenVert(), DECAY_FS);
  const resolve = program(gl, fullscreenVert(), RESOLVE_FS);
  const glow = program(gl, fullscreenVert(), GLOW_FS);
  const post = makePost(gl);

  const emptyVao = gl.createVertexArray();

  // instanced quad
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 20, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);

  let densCol = null, densField = null, densFbo = null;
  let trail = null, scene = null;
  let W = 0, H = 0, DPR = 1;
  let data = new Float32Array(0);
  let count = 0;

  const fs = () => { gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  function alloc(w, h) {
    [densCol, densField, trail, scene].forEach(t => t && t.free());
    if (densFbo) gl.deleteFramebuffer(densFbo);

    // Colour and field are written in one pass, so they share a
    // framebuffer with two colour attachments.
    densCol = makeTarget(gl, w, h, { float: hdr });
    densField = makeTarget(gl, w, h, { float: hdr });
    densFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, densFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, densCol.tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, densField.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    trail = makeTarget(gl, w, h, { float: hdr });
    scene = makeTarget(gl, w, h, { float: hdr });
    post.resize(w, h);
    clear();
  }

  function bindDens() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, densFbo);
    gl.viewport(0, 0, W, H);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  }

  function clear() {
    if (densFbo) {
      bindDens();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    for (const t of [trail, scene]) {
      if (!t) continue;
      t.bind();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);
  }

  return {
    ok: true,
    software,
    rendererName,
    canvas,

    resize(w, h, dpr) {
      W = Math.max(1, Math.round(w * dpr));
      H = Math.max(1, Math.round(h * dpr));
      DPR = dpr;
      canvas.width = W; canvas.height = H;
      alloc(W, H);
    },

    clear,

    /* balls: the live Matter bodies. hueOf(b) -> 0..360 or <0 for mono. */
    upload(balls, hueOf, monoHue, speedRef) {
      count = balls.length;
      if (data.length < count * 5) data = new Float32Array(Math.ceil(count * 1.4) * 5);
      for (let i = 0; i < count; i++) {
        const b = balls[i], o = i * 5;
        data[o]     = b.position.x * DPR;
        data[o + 1] = b.position.y * DPR;
        data[o + 2] = b.circleRadius * DPR;
        const h = hueOf(b);
        data[o + 3] = ((h < 0 ? monoHue : h) / 360);
        const v = Math.hypot(b.velocity.x, b.velocity.y) / speedRef;
        data[o + 4] = v > 1 ? 1 : v;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 5), gl.DYNAMIC_DRAW);
    },

    frame(o) {
      if (!scene) return;
      gl.bindVertexArray(vao);

      /* 1 · trail: decay what is there, then add this frame's splats */
      trail.bind();
      if (o.trailDecay >= 1) {
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      } else {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
        const d = 1 - o.trailDecay;
        gl.blendColor(d, d, d, d);
        gl.useProgram(decay); fs();
        gl.bindVertexArray(vao);
      }
      if (count && o.trailDecay < 1) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(splatTrail);
        gl.uniform2f(splatTrail.u.u_res, W, H);
        gl.uniform1f(splatTrail.u.u_kernel, 0.8);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      }

      /* 2 · density field, fresh every frame */
      bindDens();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (count) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(splatDens);
        gl.uniform2f(splatDens.u.u_res, W, H);
        gl.uniform1f(splatDens.u.u_kernel, o.kernel);   // used by both stages
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      }

      /* 3 · resolve into a lit surface */
      gl.disable(gl.BLEND);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      scene.bind();
      const prog = o.style === 'glow' ? glow : resolve;
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, densCol.tex);
      gl.uniform1i(prog.u.u_col, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, densField.tex);
      gl.uniform1i(prog.u.u_field, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, trail.tex);
      gl.uniform1i(prog.u.u_trail, 2);
      gl.uniform2f(prog.u.u_res, W, H);
      gl.uniform1f(prog.u.u_light, o.light ? 1 : 0);
      gl.uniform1f(prog.u.u_gridFade, o.gridFade);
      gl.uniform3f(prog.u.u_ink, o.ink[0], o.ink[1], o.ink[2]);
      gl.uniform3f(prog.u.u_paper, o.paper[0], o.paper[1], o.paper[2]);
      if (prog === resolve) {
        gl.uniform1f(prog.u.u_threshold, o.threshold);
        gl.uniform1f(prog.u.u_soft, o.soft);
        gl.uniform1f(prog.u.u_refract, o.refract);
        gl.uniform1f(prog.u.u_metal, o.metal);
      }
      fs();

      /* 4 · post */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.drawBuffers([gl.BACK]);
      post.render(scene.tex, o.post);
    },

    destroy() {
      [densCol, densField, trail, scene].forEach(t => t && t.free());
      if (densFbo) gl.deleteFramebuffer(densFbo);
      post.free();
      canvas.remove();
    }
  };
}
