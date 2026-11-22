/* ═══════════════════════════════════════════════════════════════
   6 · GL — a small WebGL2 core, and the post chain

   Everything here exists to make things look expensive: an HDR
   accumulation buffer so trails glow instead of smearing, a real
   bloom (bright-pass, downsample, separable blur, upsample) rather
   than additive alpha pretending to be light, and a finishing pass
   with chromatic aberration, vignette and grain.

   Nothing in here is required. Every caller checks `supported()`
   first and keeps its Canvas 2D path, because a page that renders
   nothing on a machine without WebGL2 is worse than a plain one.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

export function supported() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch (e) { return false; }
}

/* ── shader plumbing ─────────────────────────────────────────── */
export function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    console.error('shader failed:\n' + log + '\n' + src);
    throw new Error(log);
  }
  return s;
}

export function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  // Cache uniform locations; looking them up per frame is a real cost
  // once there are a dozen of them and sixty frames a second.
  p.u = new Proxy({}, {
    get(cache, name) {
      if (!(name in cache)) cache[name] = gl.getUniformLocation(p, name);
      return cache[name];
    }
  });
  return p;
}

/* A single oversized triangle beats a quad: no diagonal seam, and the
   GPU rasterises it in one go. */
const FS_VERT = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function fullscreenVert() { return FS_VERT; }

/* ── render targets ──────────────────────────────────────────── */
export function makeTarget(gl, w, h, { float = true, filter = null } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const f = filter || gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Half-float is the point: values above 1.0 survive, which is what
  // makes a bright-pass meaningful and lets trails accumulate light
  // instead of clipping to white.
  const internal = float ? gl.RGBA16F : gl.RGBA8;
  const type = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    tex, fbo, w, h,
    bind() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
    },
    free() { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); }
  };
}

/* ═══════════════════════════════════════════════════════════════
   The post chain
   ═══════════════════════════════════════════════════════════════ */

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src;
uniform float u_threshold, u_knee;
void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  float b = max(c.r, max(c.g, c.b));
  // Soft knee, so the bloom fades in around the threshold instead of
  // switching on and giving lit areas a hard outline.
  float w = clamp((b - u_threshold + u_knee) / (2.0 * u_knee), 0.0, 1.0);
  o = vec4(c * w * w * step(0.0001, b), 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_dir;          // texel-sized step, horizontal or vertical
void main() {
  // 9-tap Gaussian folded into 5 bilinear samples.
  vec3 c = texture(u_src, v_uv).rgb * 0.227027;
  c += texture(u_src, v_uv + u_dir * 1.3846).rgb * 0.316216;
  c += texture(u_src, v_uv - u_dir * 1.3846).rgb * 0.316216;
  c += texture(u_src, v_uv + u_dir * 3.2308).rgb * 0.070270;
  c += texture(u_src, v_uv - u_dir * 3.2308).rgb * 0.070270;
  o = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src, u_bloom0, u_bloom1, u_bloom2;
uniform float u_bloom, u_aberration, u_vignette, u_grain, u_exposure, u_time;
uniform float u_light;       // 1.0 when the sheet is printed on white

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

vec3 sampleAberrated(sampler2D t, vec2 uv, float amt) {
  // Offset the channels along the radius, so the fringing grows toward
  // the corners the way a real lens does rather than uniformly.
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec2 off = d * r2 * amt;
  return vec3(
    texture(t, uv + off).r,
    texture(t, uv).g,
    texture(t, uv - off).b
  );
}

void main() {
  vec3 c = sampleAberrated(u_src, v_uv, u_aberration);

  vec3 b = texture(u_bloom0, v_uv).rgb * 0.5
         + texture(u_bloom1, v_uv).rgb * 0.35
         + texture(u_bloom2, v_uv).rgb * 0.25;

  /* On the dark sheet, light adds — that is what light does.

     On white paper neither adding nor subtracting works: adding just
     washes toward white, and subtracting punches dark holes in the
     middle of the brightest things. What a glow actually looks like on
     paper is colour bleeding outward, so bleed the bloom's *hue* into
     the pixel and leave its luminance alone. */
  vec3 bl = b * u_bloom;
  float bLum = clamp(max(bl.r, max(bl.g, bl.b)), 0.0, 1.0);
  vec3 bHue = bl / max(max(bl.r, max(bl.g, bl.b)), 1e-4);
  c = mix(c + bl, mix(c, bHue * 0.8, bLum * 0.45), u_light);
  c *= u_exposure;

  // Filmic-ish shoulder: keeps highlights from flat-clipping to white.
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);

  float vig = 1.0 - u_vignette * dot(v_uv - 0.5, v_uv - 0.5) * 2.0;
  c *= clamp(vig, 0.0, 1.0);

  c += (hash(v_uv * 1024.0 + fract(u_time)) - 0.5) * u_grain;

  o = vec4(max(c, 0.0), 1.0);
}`;

export function makePost(gl) {
  const bright = program(gl, FS_VERT, BRIGHT_FS);
  const blur = program(gl, FS_VERT, BLUR_FS);
  const comp = program(gl, FS_VERT, COMPOSITE_FS);
  const vao = gl.createVertexArray();

  let chain = [];   // three half-res mip levels for a wide, soft bloom
  let W = 0, H = 0;

  const draw = () => { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  return {
    resize(w, h) {
      if (w === W && h === H) return;
      W = w; H = h;
      chain.forEach(l => { l.a.free(); l.b.free(); });
      chain = [];
      let cw = Math.max(1, w >> 1), ch = Math.max(1, h >> 1);
      for (let i = 0; i < 3; i++) {
        chain.push({ a: makeTarget(gl, cw, ch), b: makeTarget(gl, cw, ch) });
        cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1);
      }
    },

    /* srcTex is an HDR texture; draws the finished frame to the screen. */
    render(srcTex, o) {
      gl.disable(gl.BLEND);

      // bright-pass into the first (largest) bloom level
      gl.useProgram(bright);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(bright.u.u_src, 0);
      gl.uniform1f(bright.u.u_threshold, o.threshold);
      gl.uniform1f(bright.u.u_knee, 0.35);
      chain[0].a.bind(); draw();

      // blur each level, then seed the next from it
      gl.useProgram(blur);
      gl.uniform1i(blur.u.u_src, 0);
      for (let i = 0; i < chain.length; i++) {
        const L = chain[i];
        if (i > 0) {
          gl.bindTexture(gl.TEXTURE_2D, chain[i - 1].a.tex);
          L.a.bind(); draw();
        }
        for (let pass = 0; pass < 2; pass++) {
          gl.bindTexture(gl.TEXTURE_2D, L.a.tex);
          gl.uniform2f(blur.u.u_dir, 1 / L.a.w, 0);
          L.b.bind(); draw();
          gl.bindTexture(gl.TEXTURE_2D, L.b.tex);
          gl.uniform2f(blur.u.u_dir, 0, 1 / L.a.h);
          L.a.bind(); draw();
        }
      }

      // composite to the default framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(comp);
      const bind = (unit, tex, name) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(comp.u[name], unit);
      };
      bind(0, srcTex, 'u_src');
      bind(1, chain[0].a.tex, 'u_bloom0');
      bind(2, chain[1].a.tex, 'u_bloom1');
      bind(3, chain[2].a.tex, 'u_bloom2');
      gl.uniform1f(comp.u.u_bloom, o.bloom);
      gl.uniform1f(comp.u.u_aberration, o.aberration);
      gl.uniform1f(comp.u.u_vignette, o.vignette);
      gl.uniform1f(comp.u.u_grain, o.grain);
      gl.uniform1f(comp.u.u_exposure, o.exposure);
      gl.uniform1f(comp.u.u_light, o.light ? 1 : 0);
      gl.uniform1f(comp.u.u_time, o.time);
      draw();
    },

    free() { chain.forEach(l => { l.a.free(); l.b.free(); }); chain = []; }
  };
}
