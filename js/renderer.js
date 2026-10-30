// WebGL2 renderer: terrain sections, sky (sun, moon, stars, clouds), entities as box models,
// the block outline and mining cracks, and the item held in your hand.
(function (G) {
  'use strict';
  const MC = G.MC;
  const M = MC.mat4;

  const TERRAIN_VS = `#version 300 es
precision highp float; precision highp int;
layout(location = 0) in uvec2 a_data;
uniform mat4 u_proj, u_view;
uniform vec3 u_origin, u_cam;
uniform float u_time;
uniform int u_atlasCols;
out vec2 v_local; flat out vec2 v_tile; out float v_sky, v_blk, v_shade, v_dist;
void main() {
  uint w0 = a_data.x, w1 = a_data.y;
  vec3 p = vec3(float(w0 & 511u), float((w0 >> 9u) & 511u), float((w0 >> 18u) & 511u)) / 16.0;
  float ao = float((w0 >> 27u) & 3u);
  uint sh = (w0 >> 29u) & 7u;
  uint tile = (w1 >> 10u) & 4095u;
  uint flags = (w1 >> 30u) & 3u;
  vec3 world = u_origin + p;
  vec3 abs_ = world + u_cam;
  if (flags == 2u && fract(p.y) > 0.01) {
    float ph = abs_.x * 0.7 + abs_.z * 0.9;
    world.x += sin(u_time * 1.6 + ph) * 0.035;
    world.z += cos(u_time * 1.3 + ph) * 0.03;
  }
  if (flags == 1u && fract(p.y) > 0.5) world.y += sin(u_time * 1.5 + (abs_.x + abs_.z) * 0.8) * 0.02 - 0.02;
  vec4 vp = u_view * vec4(world, 1.0);
  gl_Position = u_proj * vp;
  v_dist = length(vp.xyz);
  v_local = vec2(float(w1 & 31u), float((w1 >> 5u) & 31u));
  v_tile = vec2(float(int(tile) % u_atlasCols), float(int(tile) / u_atlasCols)) * 16.0;
  v_sky = float((w1 >> 22u) & 15u);
  v_blk = float((w1 >> 26u) & 15u);
  float tab[4] = float[4](1.0, 0.8, 0.62, 0.5);
  v_shade = tab[sh] * (1.0 - ao * 0.19);
}`;

  const LIGHT_FN = `
uniform float u_daylight, u_gamma;
vec3 lightColor(float sky, float blk) {
  float s = sky / 15.0 * u_daylight, b = blk / 15.0;
  float cs = s / (4.0 - 3.0 * s), cb = b / (4.0 - 3.0 * b);
  cs = mix(cs, sqrt(cs), u_gamma); cb = mix(cb, sqrt(cb), u_gamma);
  vec3 skyCol = mix(vec3(0.55, 0.6, 0.85), vec3(1.0), u_daylight) * cs;
  vec3 blkCol = vec3(1.0, 0.86, 0.66) * cb;
  return max(max(skyCol, blkCol), vec3(0.045 + 0.04 * u_gamma));
}`;

  const TERRAIN_FS = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform vec2 u_atlasSize;
uniform vec3 u_fogColor;
uniform float u_fogStart, u_fogEnd, u_alphaCut, u_alphaMul;
${LIGHT_FN}
in vec2 v_local; flat in vec2 v_tile; in float v_sky, v_blk, v_shade, v_dist;
out vec4 o;
void main() {
  vec2 px = v_tile + clamp(v_local, 0.002, 15.998);
  vec4 t = texture(u_atlas, px / u_atlasSize);
  if (t.a < u_alphaCut) discard;
  vec3 c = t.rgb * v_shade * lightColor(v_sky, v_blk);
  float f = smoothstep(u_fogStart, u_fogEnd, v_dist);
  o = vec4(mix(c, u_fogColor, f), t.a * u_alphaMul);
}`;

  const SKY_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_ndc;
void main() { v_ndc = a_pos; gl_Position = vec4(a_pos, 0.9999, 1.0); }`;
  const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 u_invViewProj;
uniform vec3 u_zenith, u_horizon, u_sunDir, u_cam;
uniform float u_night, u_time, u_cloudY;
in vec2 v_ndc; out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec4 w = u_invViewProj * vec4(v_ndc, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 c = mix(u_horizon, u_zenith, smoothstep(-0.05, 0.6, h));
  if (h < 0.0) c = mix(u_horizon, u_horizon * 0.6, smoothstep(0.0, -0.4, h));
  // stars
  if (u_night > 0.0 && h > 0.0) {
    vec2 g = floor(vec2(atan(d.z, d.x), asin(h)) * 180.0);
    float s = hash(g);
    if (s > 0.996) c += vec3(u_night * (s - 0.996) * 220.0);
  }
  // sun and moon (square, like the classic look)
  vec3 sd = normalize(u_sunDir);
  vec3 ax = normalize(cross(sd, vec3(0.0, 0.0, 1.0)));
  vec3 ay = cross(ax, sd);
  float ds = dot(d, sd);
  if (ds > 0.0) { vec2 q = vec2(dot(d, ax), dot(d, ay)) / ds; if (max(abs(q.x), abs(q.y)) < 0.07) c = mix(c, vec3(1.0, 0.97, 0.8), 0.95); else c += vec3(1.0, 0.8, 0.5) * pow(max(ds, 0.0), 64.0) * 0.35; }
  if (ds < 0.0) { vec2 q = vec2(dot(d, ax), dot(d, ay)) / ds; if (max(abs(q.x), abs(q.y)) < 0.05) c = mix(c, vec3(0.85, 0.88, 0.95), 0.9 * u_night + 0.1); }
  // clouds: a flat blocky layer drifting over the world
  if (d.y > 0.0 && u_cam.y < u_cloudY) {
    float t = (u_cloudY - u_cam.y) / d.y;
    if (t < 900.0) {
      vec2 p = (u_cam.xz + d.xz * t + vec2(u_time * 1.2, 0.0)) / 12.0;
      float n = hash(floor(p)) + hash(floor(p * 0.5) + 7.0) * 0.6;
      if (n > 1.05) {
        vec3 cc = mix(vec3(1.0), vec3(0.18, 0.2, 0.28), u_night);
        c = mix(c, cc, 0.85 * (1.0 - smoothstep(300.0, 900.0, t)));
      }
    }
  }
  o = vec4(c, 1.0);
}`;

  const LINE_VS = `#version 300 es
layout(location = 0) in vec3 a_pos;
uniform mat4 u_proj, u_view; uniform vec3 u_origin;
void main() { gl_Position = u_proj * u_view * vec4(u_origin + a_pos, 1.0); }`;
  const LINE_FS = `#version 300 es
precision mediump float; uniform vec4 u_color; out vec4 o; void main() { o = u_color; }`;

  const ENT_VS = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_shade;
uniform mat4 u_proj, u_view, u_model;
out vec2 v_uv; out float v_shade, v_dist;
void main() {
  vec4 vp = u_view * u_model * vec4(a_pos, 1.0);
  gl_Position = u_proj * vp;
  v_uv = a_uv; v_shade = a_shade; v_dist = length(vp.xyz);
}`;
  const ENT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec3 u_fogColor, u_tint;
uniform float u_fogStart, u_fogEnd, u_sky, u_blk, u_hurt;
${LIGHT_FN}
in vec2 v_uv; in float v_shade, v_dist; out vec4 o;
void main() {
  vec4 t = texture(u_tex, v_uv);
  if (t.a < 0.5) discard;
  vec3 c = t.rgb * u_tint * v_shade * lightColor(u_sky, u_blk);
  c = mix(c, vec3(1.0, 0.1, 0.1), u_hurt * 0.55);
  o = vec4(mix(c, u_fogColor, smoothstep(u_fogStart, u_fogEnd, v_dist)), 1.0);
}`;

  function compile(gl, vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('missing ' + src)); i.src = src; });
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('webgl2');
      this.gl = gl;
      this.sections = new Map();
      this.proj = M.create();
      this.view = M.create();
      this.viewProj = M.create();
      this.fov = 70;
      this.time = 0;
      this.stats = { sections: 0, drawn: 0, quads: 0 };
      this.terrain = compile(gl, TERRAIN_VS, TERRAIN_FS);
      this.sky = compile(gl, SKY_VS, SKY_FS);
      this.lines = compile(gl, LINE_VS, LINE_FS);
      this.ent = compile(gl, ENT_VS, ENT_FS);
      // shared quad index buffer
      const MAXQ = 40000;
      const idx = new Uint32Array(MAXQ * 6);
      for (let q = 0; q < MAXQ; q++) { const v = q * 4, o = q * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3; }
      this.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      // fullscreen triangle pair for the sky
      this.skyVao = gl.createVertexArray();
      gl.bindVertexArray(this.skyVao);
      const sb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, sb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      // outline box
      this.lineVao = gl.createVertexArray();
      gl.bindVertexArray(this.lineVao);
      this.lineBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, 24 * 3 * 4 * 8, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      // crack overlay uses the terrain program with a tiny dynamic buffer
      this.crackVao = gl.createVertexArray();
      gl.bindVertexArray(this.crackVao);
      this.crackBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.crackBuf);
      gl.bufferData(gl.ARRAY_BUFFER, 8 * 4 * 6 * 8, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_INT, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bindVertexArray(null);
      this.models = new Map();
    }

    async loadTextures() {
      const gl = this.gl;
      const [atlas, icons] = await Promise.all([loadImage('assets/terrain.png'), loadImage('assets/icons.png')]);
      const mk = (img) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      };
      this.atlasTex = mk(atlas);
      this.iconTex = mk(icons);
      this.atlasSize = [atlas.width, atlas.height];
      this.iconSize = [icons.width, icons.height];
    }

    // ---------- terrain sections ----------
    upload(cx, cz, sy, opaque, trans) {
      const gl = this.gl;
      const k = cx + ',' + cz + ',' + sy;
      let s = this.sections.get(k);
      if (!opaque && !trans) { if (s) this.freeSection(k, s); return; }
      if (!s) { s = { cx, cz, sy, o: null, t: null }; this.sections.set(k, s); }
      s.o = this.buf(s.o, opaque);
      s.t = this.buf(s.t, trans);
    }

    buf(slot, data) {
      const gl = this.gl;
      if (!data || !data.length) { if (slot) { gl.deleteBuffer(slot.vbo); gl.deleteVertexArray(slot.vao); } return null; }
      if (!slot) {
        slot = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), count: 0 };
        gl.bindVertexArray(slot.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, slot.vbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_INT, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bindVertexArray(null);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      slot.count = (data.length / 8) * 6; // 2 uint32 per vertex, 4 vertices per quad
      return slot;
    }

    freeSection(k, s) {
      const gl = this.gl;
      for (const slot of [s.o, s.t]) if (slot) { gl.deleteBuffer(slot.vbo); gl.deleteVertexArray(slot.vao); }
      this.sections.delete(k);
    }

    removeChunk(cx, cz) {
      for (let sy = 0; sy < MC.SECTIONS; sy++) {
        const k = cx + ',' + cz + ',' + sy;
        const s = this.sections.get(k);
        if (s) this.freeSection(k, s);
      }
    }

    clear() { for (const [k, s] of [...this.sections]) this.freeSection(k, s); }

    // ---------- frame ----------
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * (this.scale || 1);
      const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    }

    // cam: {x, y, z, yaw, pitch, fov}; env: {daylight, sunAngle, zenith, horizon, fogColor, fogStart, fogEnd, night, underwater}
    begin(cam, env) {
      const gl = this.gl;
      this.resize();
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const aspect = this.canvas.width / this.canvas.height;
      M.perspective(this.proj, (cam.fov * Math.PI) / 180, aspect, 0.05, 2000);
      M.rotation(this.view, cam.yaw, cam.pitch);
      M.multiply(this.viewProj, this.proj, this.view);
      this.cam = cam;
      this.env = env;
      gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // sky
      gl.disable(gl.DEPTH_TEST);
      if (!env.underwater && !env.noSky) {
        const s = this.sky;
        gl.useProgram(s.p);
        const inv = invert(this.viewProj);
        gl.uniformMatrix4fv(s.u.u_invViewProj, false, inv);
        gl.uniform3fv(s.u.u_zenith, env.zenith);
        gl.uniform3fv(s.u.u_horizon, env.horizon);
        gl.uniform3fv(s.u.u_sunDir, [Math.cos(env.sunAngle), Math.sin(env.sunAngle), 0.15]);
        gl.uniform3fv(s.u.u_cam, [cam.x, cam.y, cam.z]);
        gl.uniform1f(s.u.u_night, env.night);
        gl.uniform1f(s.u.u_time, this.time);
        gl.uniform1f(s.u.u_cloudY, 200);
        gl.bindVertexArray(this.skyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      this.frustum = planes(this.viewProj);
    }

    terrainUniforms(alphaCut, alphaMul) {
      const gl = this.gl, t = this.terrain, e = this.env;
      gl.useProgram(t.p);
      gl.uniformMatrix4fv(t.u.u_proj, false, this.proj);
      gl.uniformMatrix4fv(t.u.u_view, false, this.view);
      gl.uniform1f(t.u.u_time, this.time);
      gl.uniform3f(t.u.u_cam, this.cam.x, this.cam.y, this.cam.z);
      gl.uniform1i(t.u.u_atlasCols, MC.ATLAS.cols);
      gl.uniform2fv(t.u.u_atlasSize, this.atlasSize);
      gl.uniform3fv(t.u.u_fogColor, e.fogColor);
      gl.uniform1f(t.u.u_fogStart, e.fogStart);
      gl.uniform1f(t.u.u_fogEnd, e.fogEnd);
      gl.uniform1f(t.u.u_daylight, e.daylight);
      gl.uniform1f(t.u.u_gamma, e.gamma);
      gl.uniform1f(t.u.u_alphaCut, alphaCut);
      gl.uniform1f(t.u.u_alphaMul, alphaMul);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform1i(t.u.u_atlas, 0);
    }

    drawTerrain() {
      const gl = this.gl, t = this.terrain, c = this.cam;
      this.terrainUniforms(0.5, 1);
      const vis = [];
      let quads = 0;
      const maxD = (this.env.fogEnd + 24) ** 2;
      for (const s of this.sections.values()) {
        const ox = s.cx * 16 - c.x, oy = MC.MIN_Y + s.sy * 16 - c.y, oz = s.cz * 16 - c.z;
        const dx = ox + 8, dy = oy + 8, dz = oz + 8;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD) continue;
        if (!boxVisible(this.frustum, ox, oy, oz, ox + 16, oy + 16, oz + 16)) continue;
        vis.push([d2, s, ox, oy, oz]);
      }
      vis.sort((a, b) => a[0] - b[0]);
      for (const [, s, ox, oy, oz] of vis) {
        if (!s.o) continue;
        gl.uniform3f(t.u.u_origin, ox, oy, oz);
        gl.bindVertexArray(s.o.vao);
        gl.drawElements(gl.TRIANGLES, s.o.count, gl.UNSIGNED_INT, 0);
        quads += s.o.count / 6;
      }
      this.visible = vis;
      this.stats = { sections: this.sections.size, drawn: vis.length, quads };
    }

    drawTranslucent() {
      const gl = this.gl, t = this.terrain;
      this.terrainUniforms(0.02, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      for (let i = this.visible.length - 1; i >= 0; i--) {
        const [, s, ox, oy, oz] = this.visible[i];
        if (!s.t) continue;
        gl.uniform3f(t.u.u_origin, ox, oy, oz);
        gl.bindVertexArray(s.t.vao);
        gl.drawElements(gl.TRIANGLES, s.t.count, gl.UNSIGNED_INT, 0);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }

    // Outline around the targeted block's boxes.
    drawOutline(x, y, z, boxes) {
      const gl = this.gl, l = this.lines;
      const pts = [];
      for (const b of boxes) {
        const e = 0.002;
        const [x0, y0, z0, x1, y1, z1] = [b[0] - e, b[1] - e, b[2] - e, b[3] + e, b[4] + e, b[5] + e];
        const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
        for (const [a, bb] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) pts.push(...c[a], ...c[bb]);
      }
      gl.useProgram(l.p);
      gl.uniformMatrix4fv(l.u.u_proj, false, this.proj);
      gl.uniformMatrix4fv(l.u.u_view, false, this.view);
      gl.uniform3f(l.u.u_origin, x - this.cam.x, y - this.cam.y, z - this.cam.z);
      gl.uniform4f(l.u.u_color, 0, 0, 0, 0.6);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.LINES, 0, pts.length / 3);
      gl.disable(gl.BLEND);
    }

    // Cracks while mining: the block's boxes drawn with a destroy_N texture.
    drawCracks(x, y, z, boxes, stage) {
      const gl = this.gl, t = this.terrain;
      const tile = MC.TEX['destroy_' + Math.min(9, stage)];
      const data = [];
      const corners = [
        [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
        [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
      ];
      for (const b of boxes.slice(0, 3)) {
        for (let f = 0; f < 6; f++) {
          for (const [cx, cy, cz] of corners[f]) {
            const px = Math.round((cx ? b[3] : b[0]) * 16), py = Math.round((cy ? b[4] : b[1]) * 16), pz = Math.round((cz ? b[5] : b[2]) * 16);
            const u = [16 - pz, pz, px, px, px, 16 - px][f] & 31, v = (f === 2 || f === 3 ? pz : 16 - py) & 31;
            data.push((px & 511) | ((py & 511) << 9) | ((pz & 511) << 18), ((u | (v << 5) | ((tile & 4095) << 10) | (15 << 22) | (15 << 26)) >>> 0));
          }
        }
      }
      this.terrainUniforms(0.05, 0.8);
      gl.uniform3f(t.u.u_origin, x - this.cam.x, y - this.cam.y, z - this.cam.z);
      gl.uniform1f(t.u.u_daylight, 1);
      gl.bindVertexArray(this.crackVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.crackBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Uint32Array(data), gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      gl.drawElements(gl.TRIANGLES, (data.length / 8) * 6, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.BLEND);
    }

    // ---------- entity box models ----------
    // parts: [{name, pivot:[x,y,z], boxes:[{from:[x,y,z], to:[x,y,z], tex: tile or [6 tiles] or {icon}}]}]
    model(name, build) {
      let m = this.models.get(name);
      if (m) return m;
      m = this.buildModel(build());
      this.models.set(name, m);
      return m;
    }

    buildModel(def) {
      const gl = this.gl;
      const parts = [];
      const [aw, ah] = this.atlasSize;
      const cols = MC.ATLAS.cols;
      for (const p of def.parts) {
        const v = [];
        for (const b of p.boxes) {
          const [x0, y0, z0] = b.from, [x1, y1, z1] = b.to;
          const tiles = Array.isArray(b.tex) ? b.tex : [b.tex, b.tex, b.tex, b.tex, b.tex, b.tex];
          const faces = [
            [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.6],
            [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.6],
            [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 1.0],
            [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.5],
            [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.8],
            [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.8],
          ];
          faces.forEach((f, i) => {
            const tile = tiles[i];
            if (tile == null) return;
            const tx = (tile % cols) * 16, ty = Math.floor(tile / cols) * 16;
            const uv = [[tx + 0.01, ty + 15.99], [tx + 15.99, ty + 15.99], [tx + 15.99, ty + 0.01], [tx + 0.01, ty + 0.01]];
            for (const k of [0, 1, 2, 0, 2, 3]) v.push(...f[k], uv[k][0] / aw, uv[k][1] / ah, f[4]);
          });
        }
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
        for (const [loc, size, off] of [[0, 3, 0], [1, 2, 12], [2, 1, 20]]) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, off);
        }
        gl.bindVertexArray(null);
        parts.push({ name: p.name, pivot: p.pivot || [0, 0, 0], vao, count: v.length / 6 });
      }
      return { parts, scale: def.scale || 1 / 16 };
    }

    // A flat item sprite from icons.png, as a thin double-sided card.
    iconModel(itemKey) {
      const name = 'icon:' + itemKey;
      let m = this.models.get(name);
      if (m) return m;
      const gl = this.gl;
      const i = MC.ICONS[itemKey] || 0;
      const S = MC.ICON_SHEET;
      const tx = (i % S.cols) * S.size, ty = Math.floor(i / S.cols) * S.size;
      const [w, h] = this.iconSize;
      const u0 = tx / w, u1 = (tx + S.size) / w, v0 = ty / h, v1 = (ty + S.size) / h;
      const v = [];
      const q = [[-8, 0, 0, u0, v1], [8, 0, 0, u1, v1], [8, 16, 0, u1, v0], [-8, 16, 0, u0, v0]];
      for (const k of [0, 1, 2, 0, 2, 3]) v.push(q[k][0], q[k][1], q[k][2], q[k][3], q[k][4], 1);
      for (const k of [0, 2, 1, 0, 3, 2]) v.push(q[k][0], q[k][1], q[k][2] - 0.01, q[k][3], q[k][4], 0.8);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      for (const [loc, size, off] of [[0, 3, 0], [1, 2, 12], [2, 1, 20]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, off); }
      gl.bindVertexArray(null);
      m = { parts: [{ name: 'card', pivot: [0, 0, 0], vao, count: 12 }], scale: 1 / 16, icons: true };
      this.models.set(name, m);
      return m;
    }

    beginEntities() {
      const gl = this.gl, e = this.ent, env = this.env;
      gl.useProgram(e.p);
      gl.uniformMatrix4fv(e.u.u_proj, false, this.proj);
      gl.uniformMatrix4fv(e.u.u_view, false, this.view);
      gl.uniform3fv(e.u.u_fogColor, env.fogColor);
      gl.uniform1f(e.u.u_fogStart, env.fogStart);
      gl.uniform1f(e.u.u_fogEnd, env.fogEnd);
      gl.uniform1f(e.u.u_daylight, env.daylight);
      gl.uniform1f(e.u.u_gamma, env.gamma);
      gl.uniform3f(e.u.u_tint, 1, 1, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(e.u.u_tex, 0);
      gl.disable(gl.CULL_FACE);
    }

    // Draw a model at world position with yaw, per-part rotations (radians around x), light and hurt flash.
    drawModel(m, x, y, z, yaw, opts = {}) {
      const gl = this.gl, e = this.ent;
      gl.bindTexture(gl.TEXTURE_2D, m.icons ? this.iconTex : this.atlasTex);
      gl.uniform1f(e.u.u_sky, opts.sky != null ? opts.sky : 15);
      gl.uniform1f(e.u.u_blk, opts.blk || 0);
      gl.uniform1f(e.u.u_hurt, opts.hurt || 0);
      if (opts.tint) gl.uniform3fv(e.u.u_tint, opts.tint); else gl.uniform3f(e.u.u_tint, 1, 1, 1);
      const base = M.create();
      M.identity(base);
      M.translate(base, base, x - this.cam.x, y - this.cam.y, z - this.cam.z);
      M.rotateY(base, base, yaw);
      if (opts.pitch) M.rotateX(base, base, opts.pitch);
      if (opts.roll) M.rotateZ(base, base, opts.roll);
      const s = (opts.scale || 1) * m.scale;
      M.scale(base, base, s, s, s);
      const mm = M.create();
      for (const p of m.parts) {
        M.translate(mm, base, p.pivot[0], p.pivot[1], p.pivot[2]);
        const r = opts.rot && opts.rot[p.name];
        if (r) {
          if (r.x) M.rotateX(mm, mm, r.x);
          if (r.y) M.rotateY(mm, mm, r.y);
          if (r.z) M.rotateZ(mm, mm, r.z);
        }
        M.translate(mm, mm, -p.pivot[0], -p.pivot[1], -p.pivot[2]);
        gl.uniformMatrix4fv(e.u.u_model, false, mm);
        gl.bindVertexArray(p.vao);
        gl.drawArrays(gl.TRIANGLES, 0, p.count);
      }
    }

    // First-person held item: drawn last with a fresh depth buffer in view space.
    drawHeld(m, opts) {
      const gl = this.gl, e = this.ent;
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const savedView = this.view;
      const id = M.identity(M.create());
      gl.uniformMatrix4fv(e.u.u_view, false, id);
      const cam = this.cam;
      this.cam = { x: 0, y: 0, z: 0 };
      gl.uniform1f(e.u.u_fogStart, 1000);
      gl.uniform1f(e.u.u_fogEnd, 2000);
      this.drawModel(m, opts.x, opts.y, opts.z, opts.yaw, opts);
      this.cam = cam;
      gl.uniformMatrix4fv(e.u.u_view, false, savedView);
    }

    end() { this.gl.bindVertexArray(null); }
  }

  // ---------- small math helpers ----------
  function invert(m) {
    const inv = new Float32Array(16);
    const a = m;
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    for (let i = 0; i < 16; i++) inv[i] /= det || 1;
    return inv;
  }

  function planes(m) {
    const p = [];
    const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
    const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    for (const [a, s] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) {
      const pl = [r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]];
      p.push(pl);
    }
    return p;
  }

  function boxVisible(ps, x0, y0, z0, x1, y1, z1) {
    for (const p of ps) {
      const x = p[0] > 0 ? x1 : x0, y = p[1] > 0 ? y1 : y0, z = p[2] > 0 ? z1 : z0;
      if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
    }
    return true;
  }

  MC.Renderer = Renderer;
})(globalThis);
