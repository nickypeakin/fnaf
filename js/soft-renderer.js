// Compatibility renderer: draws the 3D world in plain JavaScript and shows each frame as an
// ordinary <img>, without <canvas> or WebGL. Used when the browser (or a privacy tool) blocks
// those. It has the same interface as MC.Renderer, so the rest of the game doesn't care which
// one is running. Textures are decoded from the PNG files directly (a small inflate below), so
// nothing ever has to be drawn into a canvas to read its pixels.
(function (G) {
  'use strict';
  const MC = G.MC;
  const M = MC.mat4;

  // ---------------------------------------------------------------- PNG decoding
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function huff(lengths, n) {
    const counts = new Uint16Array(16), offs = new Uint16Array(16), syms = new Uint16Array(n);
    for (let i = 0; i < n; i++) counts[lengths[i]]++;
    counts[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    for (let i = 0; i < n; i++) if (lengths[i]) syms[offs[lengths[i]]++] = i;
    return { counts, syms };
  }

  // zlib inflate (stored, fixed and dynamic Huffman blocks)
  function inflate(src, outSize) {
    const out = new Uint8Array(outSize);
    let pos = 2, buf = 0, cnt = 0, op = 0;
    const bits = (n) => {
      while (cnt < n) { buf |= src[pos++] << cnt; cnt += 8; }
      const v = buf & ((1 << n) - 1);
      buf >>>= n; cnt -= n;
      return v;
    };
    const decode = (h) => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len < 16; len++) {
        code |= bits(1);
        const c = h.counts[len];
        if (code - c < first) return h.syms[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('bad huffman code');
    };
    let fixedL = null, fixedD = null;
    let last = 0;
    while (!last) {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        buf = 0; cnt = 0;
        const len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        out.set(src.subarray(pos, pos + len), op);
        pos += len; op += len;
        continue;
      }
      let lcode, dcode;
      if (type === 1) {
        if (!fixedL) {
          const l = new Uint8Array(288);
          l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
          fixedL = huff(l, 288);
          fixedD = huff(new Uint8Array(30).fill(5), 30);
        }
        lcode = fixedL; dcode = fixedD;
      } else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CLORDER[i]] = bits(3);
        const ch = huff(cl, 19);
        const lens = new Uint8Array(nlen + ndist);
        for (let i = 0; i < nlen + ndist;) {
          const sym = decode(ch);
          if (sym < 16) lens[i++] = sym;
          else if (sym === 16) { const prev = lens[i - 1]; for (let r = 3 + bits(2); r > 0; r--) lens[i++] = prev; }
          else if (sym === 17) i += 3 + bits(3);
          else i += 11 + bits(7);
        }
        lcode = huff(lens.subarray(0, nlen), nlen);
        dcode = huff(lens.subarray(nlen), ndist);
      }
      for (;;) {
        let sym = decode(lcode);
        if (sym < 256) { out[op++] = sym; continue; }
        if (sym === 256) break;
        sym -= 257;
        const len = LBASE[sym] + bits(LEXT[sym]);
        const ds = decode(dcode);
        const dist = DBASE[ds] + bits(DEXT[ds]);
        for (let k = 0; k < len; k++, op++) out[op] = out[op - dist];
      }
    }
    return out;
  }

  // 8-bit RGBA PNG -> {w, h, px: Uint32Array (0xAABBGGRR)}
  async function loadPNG(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('missing ' + url);
    const b = new Uint8Array(await res.arrayBuffer());
    const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    let o = 8, w = 0, h = 0;
    const idat = [];
    while (o < b.length) {
      const len = u32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
      if (type === 'IHDR') { w = u32(o + 8); h = u32(o + 12); if (b[o + 16] !== 8 || b[o + 17] !== 6) throw new Error('unsupported png'); }
      else if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
      else if (type === 'IEND') break;
      o += 12 + len;
    }
    let total = 0;
    for (const c of idat) total += c.length;
    const z = new Uint8Array(total);
    let p = 0;
    for (const c of idat) { z.set(c, p); p += c.length; }
    const stride = w * 4;
    const raw = inflate(z, (stride + 1) * h);
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, d = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? px[d + x - 4] : 0, up = y > 0 ? px[d - stride + x] : 0, c = x >= 4 && y > 0 ? px[d - stride + x - 4] : 0;
        let v = raw[s + x];
        if (f === 1) v += a;
        else if (f === 2) v += up;
        else if (f === 3) v += (a + up) >> 1;
        else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
        px[d + x] = v & 255;
      }
    }
    return { w, h, px: new Uint32Array(px.buffer) };
  }
  MC.loadPNG = loadPNG;

  // ---------------------------------------------------------------- rasterizer state
  // Polygon scratch (view space before clipping, then screen space after projection).
  const N = 12;
  const AX = new Float64Array(N), AY = new Float64Array(N), AD = new Float64Array(N), AU = new Float64Array(N), AV = new Float64Array(N);
  const AR = new Float64Array(N), AG = new Float64Array(N), AB = new Float64Array(N), AF = new Float64Array(N);
  const BX = new Float64Array(N), BY = new Float64Array(N), BD = new Float64Array(N), BU = new Float64Array(N), BV = new Float64Array(N);
  const BR = new Float64Array(N), BG = new Float64Array(N), BB = new Float64Array(N), BF = new Float64Array(N);
  const SX = new Float64Array(N), SY = new Float64Array(N), SW = new Float64Array(N), SU = new Float64Array(N), SV = new Float64Array(N);
  const NEAR = 0.05;
  const SHADE = [1, 0.8, 0.62, 0.5, 0.5, 0.5, 0.5, 0.5];

  let W = 0, H = 0, COLOR = null, DEPTH = null, F = 1, HW = 0, HH = 0;
  let TEX = null, TW = 0, U0 = 0, U1 = 0, V0 = 0, V1 = 0;
  let MODE = 0; // 0 alpha-tested opaque, 1 alpha blended, 2 darken (mining cracks)
  let FR = 0, FG = 0, FB = 0; // fog colour 0..255
  let DEPTH_BIAS = 1;

  function tri(a, b, c) {
    const x0 = SX[a], y0 = SY[a], x1 = SX[b], y1 = SY[b], x2 = SX[c], y2 = SY[c];
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (det > -1e-9 && det < 1e-9) return;
    let ymin = y0, ymax = y0;
    if (y1 < ymin) ymin = y1; if (y2 < ymin) ymin = y2; if (y1 > ymax) ymax = y1; if (y2 > ymax) ymax = y2;
    let r0 = Math.ceil(ymin - 0.5), r1 = Math.ceil(ymax - 0.5);
    if (r0 < 0) r0 = 0; if (r1 > H) r1 = H;
    if (r0 >= r1) return;
    if (Math.max(x0, x1, x2) < 0 || Math.min(x0, x1, x2) > W) return;
    // attribute gradients: dA/dx = (A1-A0)*p1 + (A2-A0)*p2, dA/dy = (A1-A0)*q1 + (A2-A0)*q2
    const id = 1 / det;
    const p1 = (y2 - y0) * id, p2 = -(y1 - y0) * id, q1 = -(x2 - x0) * id, q2 = (x1 - x0) * id;
    let e1 = SW[b] - SW[a], e2 = SW[c] - SW[a];
    const dWx = e1 * p1 + e2 * p2, dWy = e1 * q1 + e2 * q2;
    e1 = SU[b] - SU[a]; e2 = SU[c] - SU[a];
    const dUx = e1 * p1 + e2 * p2, dUy = e1 * q1 + e2 * q2;
    e1 = SV[b] - SV[a]; e2 = SV[c] - SV[a];
    const dVx = e1 * p1 + e2 * p2, dVy = e1 * q1 + e2 * q2;
    e1 = BR[b] - BR[a]; e2 = BR[c] - BR[a];
    const dRx = e1 * p1 + e2 * p2, dRy = e1 * q1 + e2 * q2;
    e1 = BG[b] - BG[a]; e2 = BG[c] - BG[a];
    const dGx = e1 * p1 + e2 * p2, dGy = e1 * q1 + e2 * q2;
    e1 = BB[b] - BB[a]; e2 = BB[c] - BB[a];
    const dBx = e1 * p1 + e2 * p2, dBy = e1 * q1 + e2 * q2;
    e1 = BF[b] - BF[a]; e2 = BF[c] - BF[a];
    const dFx = e1 * p1 + e2 * p2, dFy = e1 * q1 + e2 * q2;
    // sort by y for edge walking
    let ia = a, ib = b, ic = c, t;
    if (SY[ib] < SY[ia]) { t = ia; ia = ib; ib = t; }
    if (SY[ic] < SY[ia]) { t = ia; ia = ic; ic = t; }
    if (SY[ic] < SY[ib]) { t = ib; ib = ic; ic = t; }
    const Xa = SX[ia], Ya = SY[ia], Xb = SX[ib], Yb = SY[ib], Xc = SX[ic], Yc = SY[ic];
    const sAC = Yc > Ya ? (Xc - Xa) / (Yc - Ya) : 0, sAB = Yb > Ya ? (Xb - Xa) / (Yb - Ya) : 0, sBC = Yc > Yb ? (Xc - Xb) / (Yc - Yb) : 0;
    const w0 = SW[a], u0 = SU[a], v0 = SV[a], R0 = BR[a], G0 = BG[a], B0 = BB[a], F0 = BF[a];
    const tex = TEX, tw = TW, uLo = U0, uHi = U1, vLo = V0, vHi = V1, mode = MODE, color = COLOR, depth = DEPTH, bias = DEPTH_BIAS;
    for (let row = r0; row < r1; row++) {
      const yc = row + 0.5;
      const xl0 = Xa + (yc - Ya) * sAC;
      const xs0 = yc < Yb ? Xa + (yc - Ya) * sAB : Xb + (yc - Yb) * sBC;
      let xl = xl0 < xs0 ? xl0 : xs0, xr = xl0 < xs0 ? xs0 : xl0;
      let xs = Math.ceil(xl - 0.5), xe = Math.ceil(xr - 0.5);
      if (xs < 0) xs = 0; if (xe > W) xe = W;
      if (xs >= xe) continue;
      const fx = xs + 0.5 - x0, fy = yc - y0;
      let iw = w0 + dWx * fx + dWy * fy, uw = u0 + dUx * fx + dUy * fy, vw = v0 + dVx * fx + dVy * fy;
      let lr = R0 + dRx * fx + dRy * fy, lg = G0 + dGx * fx + dGy * fy, lb = B0 + dBx * fx + dBy * fy, fg = F0 + dFx * fx + dFy * fy;
      let idx = row * W + xs;
      for (let x = xs; x < xe; x++, idx++, iw += dWx, uw += dUx, vw += dVx, lr += dRx, lg += dGx, lb += dBx, fg += dFx) {
        if (iw * bias <= depth[idx]) continue;
        const w = 1 / iw;
        let tu = uw * w, tv = vw * w;
        if (tu < uLo) tu = uLo; else if (tu > uHi) tu = uHi;
        if (tv < vLo) tv = vLo; else if (tv > vHi) tv = vHi;
        const tx = tex[(tv | 0) * tw + (tu | 0)];
        const al = tx >>> 24;
        if (mode === 0) {
          if (al < 128) continue;
          let r = (tx & 255) * lr, g = ((tx >> 8) & 255) * lg, bl = ((tx >> 16) & 255) * lb;
          if (fg > 0) { const f = fg > 1 ? 1 : fg; r += (FR - r) * f; g += (FG - g) * f; bl += (FB - bl) * f; }
          color[idx] = (r > 255 ? 255 : r) | ((g > 255 ? 255 : g) << 8) | ((bl > 255 ? 255 : bl) << 16);
          depth[idx] = iw;
        } else if (mode === 1) {
          if (al < 6) continue;
          let r = (tx & 255) * lr, g = ((tx >> 8) & 255) * lg, bl = ((tx >> 16) & 255) * lb;
          if (fg > 0) { const f = fg > 1 ? 1 : fg; r += (FR - r) * f; g += (FG - g) * f; bl += (FB - bl) * f; }
          const k = al / 255, d = color[idx];
          r = r * k + (d & 255) * (1 - k); g = g * k + ((d >> 8) & 255) * (1 - k); bl = bl * k + ((d >> 16) & 255) * (1 - k);
          color[idx] = (r > 255 ? 255 : r) | ((g > 255 ? 255 : g) << 8) | ((bl > 255 ? 255 : bl) << 16);
        } else {
          if (al < 13) continue;
          const k = 1 - (al / 255) * 0.7, d = color[idx];
          color[idx] = ((d & 255) * k) | ((((d >> 8) & 255) * k) << 8) | ((((d >> 16) & 255) * k) << 16);
        }
      }
    }
  }

  // Clip polygon in A* arrays (n vertices, view space) against the near plane into B*, project
  // into S*, and rasterize as a triangle fan. cull: skip back faces.
  function poly(n, cull) {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const di = AD[i], dj = AD[j];
      const inI = di >= NEAR, inJ = dj >= NEAR;
      if (inI) { BX[m] = AX[i]; BY[m] = AY[i]; BD[m] = di; BU[m] = AU[i]; BV[m] = AV[i]; BR[m] = AR[i]; BG[m] = AG[i]; BB[m] = AB[i]; BF[m] = AF[i]; m++; }
      if (inI !== inJ) {
        const t = (NEAR - di) / (dj - di);
        BX[m] = AX[i] + (AX[j] - AX[i]) * t; BY[m] = AY[i] + (AY[j] - AY[i]) * t; BD[m] = NEAR;
        BU[m] = AU[i] + (AU[j] - AU[i]) * t; BV[m] = AV[i] + (AV[j] - AV[i]) * t;
        BR[m] = AR[i] + (AR[j] - AR[i]) * t; BG[m] = AG[i] + (AG[j] - AG[i]) * t; BB[m] = AB[i] + (AB[j] - AB[i]) * t; BF[m] = AF[i] + (AF[j] - AF[i]) * t;
        m++;
      }
    }
    if (m < 3) return;
    for (let i = 0; i < m; i++) {
      const iw = 1 / BD[i];
      SX[i] = HW + BX[i] * iw * F;
      SY[i] = HH - BY[i] * iw * F;
      SW[i] = iw; SU[i] = BU[i] * iw; SV[i] = BV[i] * iw;
    }
    if (cull) {
      // front faces wind clockwise on screen (y down)
      const det = (SX[1] - SX[0]) * (SY[2] - SY[0]) - (SX[2] - SX[0]) * (SY[1] - SY[0]);
      if (det >= 0) return;
    }
    for (let k = 1; k < m - 1; k++) tri(0, k, k + 1);
  }

  // ---------------------------------------------------------------- the renderer
  class SoftRenderer {
    constructor(container) {
      this.canvas = container; // element used for input and pointer lock
      this.img = container.querySelector('img');
      this.software = true;
      this.sections = new Map();
      this.models = new Map();
      this.proj = M.create(); this.view = M.create(); this.viewProj = M.create();
      this.time = 0;
      this.scale = 1;
      this.adapt = 1;
      this.stats = { sections: 0, drawn: 0, quads: 0, ms: 0, px: '' };
      this.lut = new Float64Array(256 * 3);
      this.frameMs = [];
      this.stars = [];
      const rnd = MC.rng(1234);
      for (let i = 0; i < 260; i++) {
        const a = rnd() * Math.PI * 2, h = rnd() * 0.95 + 0.03, r = Math.sqrt(1 - h * h);
        this.stars.push([Math.cos(a) * r, h, Math.sin(a) * r, 0.5 + rnd() * 0.5]);
      }
      this.useDataUrl = false;
      this.img.addEventListener('load', () => { this.presenting = false; if (this.oldUrl) { URL.revokeObjectURL(this.oldUrl); this.oldUrl = null; } });
      this.img.addEventListener('error', () => { this.presenting = false; if (!this.useDataUrl) this.useDataUrl = true; });
    }

    async loadTextures() {
      const [atlas, icons] = await Promise.all([loadPNG('assets/terrain.png'), loadPNG('assets/icons.png')]);
      this.atlas = atlas;
      this.icons = icons;
      this.atlasSize = [atlas.w, atlas.h];
      this.iconSize = [icons.w, icons.h];
    }

    // ---------------- terrain storage ----------------
    upload(cx, cz, sy, opaque, trans) {
      const k = cx + ',' + cz + ',' + sy;
      if ((!opaque || !opaque.length) && (!trans || !trans.length)) { this.sections.delete(k); return; }
      this.sections.set(k, { cx, cz, sy, o: opaque && opaque.length ? opaque : null, t: trans && trans.length ? trans : null });
    }
    removeChunk(cx, cz) { for (let sy = 0; sy < MC.SECTIONS; sy++) this.sections.delete(cx + ',' + cz + ',' + sy); }
    clear() { this.sections.clear(); }

    resize() {
      const el = this.canvas;
      const cw = el.clientWidth || innerWidth, ch = el.clientHeight || innerHeight;
      const ps = Math.max(2, Math.min(10, (3 / (this.scale || 1)) * this.adapt));
      const w = Math.max(64, Math.round(cw / ps)), h = Math.max(40, Math.round(ch / ps));
      if (w !== this.W || h !== this.H) {
        this.W = w; this.H = h;
        this.color = new Uint32Array(w * h);
        this.depth = new Float32Array(w * h);
        const row = (w * 3 + 3) & ~3;
        this.bmp = new Uint8Array(54 + row * h);
        this.tiles = new Float32Array(Math.ceil(w / 16) * Math.ceil(h / 16));
      }
      this.stats.px = `${w}x${h}`;
    }

    bind() {
      W = this.W; H = this.H; COLOR = this.color; DEPTH = this.depth; F = this.F; HW = W / 2; HH = H / 2;
      FR = this.fog[0]; FG = this.fog[1]; FB = this.fog[2];
    }

    // ---------------- frame ----------------
    begin(cam, env) {
      this.t0 = performance.now();
      this.skip = !!this.presenting && performance.now() - this.presentStart < 250;
      if (this.skip) return;
      this.resize();
      this.cam = cam; this.env = env;
      const aspect = this.W / this.H;
      M.perspective(this.proj, (cam.fov * Math.PI) / 180, aspect, 0.05, 2000);
      M.rotation(this.view, cam.yaw, cam.pitch);
      M.multiply(this.viewProj, this.proj, this.view);
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      // basis: right r, up u, forward f
      this.fx = -sy * cp; this.fy = sp; this.fz = -cy * cp;
      this.rx = cy; this.rz = -sy;
      this.ux = -this.rz * this.fy; this.uy = this.rz * this.fx - this.rx * this.fz; this.uz = this.rx * this.fy;
      this.F = (this.H / 2) / Math.tan((cam.fov * Math.PI) / 360);
      this.fog = env.fogColor.map((c) => Math.round(Math.min(1, c) * 255));
      this.fogStart = env.fogStart; this.fogEnd = env.fogEnd;
      this.buildLut(env);
      this.bind();
      this.depth.fill(0);
      DEPTH_BIAS = 1;
      if (env.underwater || env.noSky) this.color.fill(this.fog[0] | (this.fog[1] << 8) | (this.fog[2] << 16));
      else this.drawSky(cam, env);
    }

    buildLut(env) {
      const lut = this.lut, dl = env.daylight, gm = env.gamma;
      const curve = (x) => { const c = x / (4 - 3 * x); return c + (Math.sqrt(c) - c) * gm; };
      const amb = 0.045 + 0.04 * gm;
      for (let s = 0; s < 16; s++) for (let b = 0; b < 16; b++) {
        const cs = curve((s / 15) * dl), cb = curve(b / 15);
        const sr = (0.55 + 0.45 * dl) * cs, sg = (0.6 + 0.4 * dl) * cs, sb = (0.85 + 0.15 * dl) * cs;
        const i = (s * 16 + b) * 3;
        lut[i] = Math.max(sr, cb, amb); lut[i + 1] = Math.max(sg, cb * 0.86, amb); lut[i + 2] = Math.max(sb, cb * 0.66, amb);
      }
    }

    drawSky(cam, env) {
      const W = this.W, H = this.H, F = this.F, color = this.color;
      const Z = env.zenith, Hz = env.horizon;
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const cloudY = 200, below = cam.y < cloudY;
      const nightK = env.night;
      const cc = [255 * (1 - nightK * 0.82), 255 * (1 - nightK * 0.8), 255 * (1 - nightK * 0.72)];
      const time = this.time;
      for (let y = 0; y < H; y++) {
        const vy = (H / 2 - (y + 0.5)) / F;
        const dirY = cp * vy + sp;
        const h = dirY / Math.sqrt(1 + vy * vy);
        let r, g, b;
        if (h >= 0) { const k = MC.smooth(MC.clamp((h + 0.05) / 0.65, 0, 1)); r = Hz[0] + (Z[0] - Hz[0]) * k; g = Hz[1] + (Z[1] - Hz[1]) * k; b = Hz[2] + (Z[2] - Hz[2]) * k; }
        else { r = Hz[0]; g = Hz[1]; b = Hz[2]; } // below the horizon: same as the fog, so distant terrain fades in
        const base = (Math.min(255, r * 255)) | ((Math.min(255, g * 255)) << 8) | ((Math.min(255, b * 255)) << 16);
        const row = y * W;
        if (!(below && dirY > 0.02)) { color.fill(base, row, row + W); continue; }
        // a flat layer of blocky clouds: along a row the hit point moves linearly
        const t = (cloudY - cam.y) / dirY;
        const ax = cam.x + (this.ux * vy + this.fx) * t + time * 1.2, az = cam.z + (this.uz * vy + this.fz) * t;
        const bx = this.rx * t / F, bz = this.rz * t / F;
        let lastC = 0x7fffffff, lastZ = 0x7fffffff, isCloud = false;
        for (let x = 0; x < W; x++) {
          const sx = x + 0.5 - W / 2;
          const cxw = Math.floor((ax + bx * sx) / 12), czw = Math.floor((az + bz * sx) / 12);
          if (cxw !== lastC || czw !== lastZ) {
            lastC = cxw; lastZ = czw;
            const n = MC.hashf(cxw, czw, 1, 77) + MC.hashf(cxw >> 1, czw >> 1, 2, 78) * 0.6;
            isCloud = n > 1.05;
          }
          if (isCloud) {
            const dist = t * Math.sqrt(1 + vy * vy + (sx / F) ** 2);
            const k = 0.85 * (1 - MC.smooth(MC.clamp((dist - 300) / 600, 0, 1)));
            color[row + x] = ((r * 255) * (1 - k) + cc[0] * k) | (((g * 255) * (1 - k) + cc[1] * k) << 8) | (((b * 255) * (1 - k) + cc[2] * k) << 16);
          } else color[row + x] = base;
        }
      }
      // sun and moon (square), stars
      const a = env.sunAngle;
      const sun = [Math.cos(a), Math.sin(a), 0.15];
      this.skyDot(sun, 0.07, [255, 247, 204], 0.95);
      this.skyDot([-sun[0], -sun[1], -sun[2]], 0.05, [217, 224, 242], 0.9 * nightK + 0.1);
      if (nightK > 0.05) for (const s of this.stars) this.skyDot(s, 0, [255, 255, 255], nightK * s[3]);
    }
    skyDot(d, size, col, k) {
      const vx = d[0] * this.rx + d[2] * this.rz, vy = d[0] * this.ux + d[1] * this.uy + d[2] * this.uz, dd = d[0] * this.fx + d[1] * this.fy + d[2] * this.fz;
      if (dd <= 0.05) return;
      const sx = this.W / 2 + (vx / dd) * this.F, sy = this.H / 2 - (vy / dd) * this.F;
      const half = Math.max(0.5, size * this.F);
      const x0 = Math.max(0, Math.round(sx - half)), x1 = Math.min(this.W, Math.round(sx + half)), y0 = Math.max(0, Math.round(sy - half)), y1 = Math.min(this.H, Math.round(sy + half));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * this.W + x, c = this.color[i];
        const r = (c & 255) + (col[0] - (c & 255)) * k, g = ((c >> 8) & 255) + (col[1] - ((c >> 8) & 255)) * k, b = ((c >> 16) & 255) + (col[2] - ((c >> 16) & 255)) * k;
        this.color[i] = r | (g << 8) | (b << 16);
      }
    }

    // Is a camera-relative box (possibly) on screen? Returns nearest 1/depth or -1 if culled.
    boxScreen(x0, y0, z0, x1, y1, z1) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, nearIw = 0, behind = false;
      let outL = 0, outR = 0, outT = 0, outB = 0, outN = 0;
      for (let i = 0; i < 8; i++) {
        const px = i & 1 ? x1 : x0, py = i & 2 ? y1 : y0, pz = i & 4 ? z1 : z0;
        const vx = px * this.rx + pz * this.rz, vy = px * this.ux + py * this.uy + pz * this.uz, d = px * this.fx + py * this.fy + pz * this.fz;
        if (d < NEAR) { outN++; behind = true; continue; }
        const sx = vx / d * this.F, sy = vy / d * this.F;
        if (sx < -this.W / 2) outL++; if (sx > this.W / 2) outR++; if (sy > this.H / 2) outT++; if (sy < -this.H / 2) outB++;
        if (sx < minX) minX = sx; if (sx > maxX) maxX = sx; if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
        const iw = 1 / d; if (iw > nearIw) nearIw = iw;
      }
      if (outN === 8 || outL === 8 || outR === 8 || outT === 8 || outB === 8) return null;
      if (behind) return { all: true };
      return { x0: this.W / 2 + minX, x1: this.W / 2 + maxX, y0: this.H / 2 - maxY, y1: this.H / 2 - minY, iw: nearIw };
    }

    // Coarse occlusion: farthest depth in each 16x16 tile of the screen so far.
    updateTiles() {
      const W = this.W, H = this.H, tw = Math.ceil(W / 16), depth = this.depth, tiles = this.tiles;
      tiles.fill(Infinity);
      for (let y = 0; y < H; y++) {
        const ty = (y >> 4) * tw, row = y * W;
        for (let x = 0; x < W; x++) { const d = depth[row + x], t = ty + (x >> 4); if (d < tiles[t]) tiles[t] = d; }
      }
    }
    occluded(s) {
      if (s.all) return false;
      const tw = Math.ceil(this.W / 16), th = Math.ceil(this.H / 16);
      const tx0 = Math.max(0, Math.floor(s.x0 / 16)), tx1 = Math.min(tw - 1, Math.floor(s.x1 / 16)), ty0 = Math.max(0, Math.floor(s.y0 / 16)), ty1 = Math.min(th - 1, Math.floor(s.y1 / 16));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (this.tiles[ty * tw + tx] < s.iw) return false;
      return true;
    }

    drawTerrain() {
      if (this.skip) return;
      const c = this.cam;
      const maxD = (this.env.fogEnd + 20) ** 2;
      const vis = [];
      for (const s of this.sections.values()) {
        const ox = s.cx * 16 - c.x, oy = MC.MIN_Y + s.sy * 16 - c.y, oz = s.cz * 16 - c.z;
        const dx = ox + 8, dy = oy + 8, dz = oz + 8;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD) continue;
        const sc = this.boxScreen(ox, oy, oz, ox + 16, oy + 16, oz + 16);
        if (!sc) continue;
        vis.push([d2, s, ox, oy, oz, sc]);
      }
      vis.sort((a, b) => a[0] - b[0]);
      let quads = 0, drawn = 0, next = 4;
      this.tiles.fill(0);
      TEX = this.atlas.px; TW = this.atlas.w;
      MODE = 0;
      const shown = [];
      for (let i = 0; i < vis.length; i++) {
        if (i === next) { this.updateTiles(); next *= 2; }
        const [, s, ox, oy, oz, sc] = vis[i];
        if (i >= 4 && this.occluded(sc)) continue;
        shown.push(vis[i]);
        if (!s.o) continue;
        quads += this.quads(s.o, ox, oy, oz, true);
        drawn++;
      }
      this.visible = shown;
      this.stats.sections = this.sections.size; this.stats.drawn = drawn; this.stats.quads = quads;
    }

    drawTranslucent() {
      if (this.skip) return;
      TEX = this.atlas.px; TW = this.atlas.w;
      MODE = 1;
      for (let i = this.visible.length - 1; i >= 0; i--) {
        const [, s, ox, oy, oz] = this.visible[i];
        if (s.t) this.quads(s.t, ox, oy, oz, false);
      }
      MODE = 0;
    }

    // Draw packed section quads (see world-worker.js for the format).
    quads(d, ox, oy, oz, cull) {
      const rx = this.rx, rz = this.rz, ux = this.ux, uy = this.uy, uz = this.uz, fx = this.fx, fy = this.fy, fz = this.fz;
      const lut = this.lut, cols = MC.ATLAS.cols, fs = this.fogStart, fr = 1 / Math.max(0.001, this.fogEnd - this.fogStart);
      const halfW = W / 2, halfH = H / 2, Fc = F;
      let count = 0;
      const n = d.length;
      for (let o = 0; o < n; o += 8) {
        // positions
        let allBehind = true, outL = true, outR = true, outT = true, outB = true;
        for (let k = 0; k < 4; k++) {
          const w0 = d[o + k * 2];
          const px = ox + (w0 & 511) * 0.0625, py = oy + ((w0 >>> 9) & 511) * 0.0625, pz = oz + ((w0 >>> 18) & 511) * 0.0625;
          const vx = px * rx + pz * rz, vy = px * ux + py * uy + pz * uz, dd = px * fx + py * fy + pz * fz;
          AX[k] = vx; AY[k] = vy; AD[k] = dd;
          AF[k] = Math.sqrt(px * px + py * py + pz * pz);
          if (dd >= NEAR) {
            allBehind = false;
            const sx = vx * Fc, sy = vy * Fc, lim = dd * halfW, limY = dd * halfH;
            if (sx >= -lim) outL = false; if (sx <= lim) outR = false; if (sy <= limY) outT = false; if (sy >= -limY) outB = false;
          } else { outL = outR = outT = outB = false; }
        }
        if (allBehind || outL || outR || outT || outB) continue;
        if (cull) {
          // normal from the first three corners (view space is a rotation of world space)
          const e1x = AX[1] - AX[0], e1y = AY[1] - AY[0], e1z = -(AD[1] - AD[0]);
          const e2x = AX[2] - AX[0], e2y = AY[2] - AY[0], e2z = -(AD[2] - AD[0]);
          const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
          if (nx * AX[0] + ny * AY[0] - nz * AD[0] >= 0) continue;
        }
        const w1a = d[o + 1];
        const tile = (w1a >>> 10) & 4095;
        const tx = (tile % cols) * 16, ty = ((tile / cols) | 0) * 16;
        U0 = tx; U1 = tx + 15.999; V0 = ty; V1 = ty + 15.999;
        for (let k = 0; k < 4; k++) {
          const w0 = d[o + k * 2], w1 = d[o + k * 2 + 1];
          const ao = (w0 >>> 27) & 3, sh = (w0 >>> 29) & 7;
          const li = ((((w1 >>> 22) & 15) << 4) | ((w1 >>> 26) & 15)) * 3;
          const f = SHADE[sh] * (1 - ao * 0.19);
          AR[k] = lut[li] * f; AG[k] = lut[li + 1] * f; AB[k] = lut[li + 2] * f;
          AU[k] = tx + (w1 & 31); AV[k] = ty + ((w1 >>> 5) & 31);
          const fd = (AF[k] - fs) * fr;
          AF[k] = fd <= 0 ? 0 : fd >= 1 ? 1 : fd * fd * (3 - 2 * fd);
        }
        poly(4, cull);
        count++;
      }
      return count;
    }

    // ---------------- outline and cracks ----------------
    drawOutline(x, y, z, boxes) {
      if (this.skip) return;
      const c = this.cam;
      for (const b of boxes) {
        const e = 0.003;
        const p = [[b[0] - e, b[1] - e, b[2] - e], [b[3] + e, b[1] - e, b[2] - e], [b[3] + e, b[1] - e, b[5] + e], [b[0] - e, b[1] - e, b[5] + e],
          [b[0] - e, b[4] + e, b[2] - e], [b[3] + e, b[4] + e, b[2] - e], [b[3] + e, b[4] + e, b[5] + e], [b[0] - e, b[4] + e, b[5] + e]];
        for (const [a, bb] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
          this.line(x + p[a][0] - c.x, y + p[a][1] - c.y, z + p[a][2] - c.z, x + p[bb][0] - c.x, y + p[bb][1] - c.y, z + p[bb][2] - c.z);
        }
      }
    }
    view3(px, py, pz) { return [px * this.rx + pz * this.rz, px * this.ux + py * this.uy + pz * this.uz, px * this.fx + py * this.fy + pz * this.fz]; }
    line(ax, ay, az, bx, by, bz) {
      let A = this.view3(ax, ay, az), Bv = this.view3(bx, by, bz);
      if (A[2] < NEAR && Bv[2] < NEAR) return;
      if (A[2] < NEAR) { const t = (NEAR - A[2]) / (Bv[2] - A[2]); A = [A[0] + (Bv[0] - A[0]) * t, A[1] + (Bv[1] - A[1]) * t, NEAR]; }
      if (Bv[2] < NEAR) { const t = (NEAR - Bv[2]) / (A[2] - Bv[2]); Bv = [Bv[0] + (A[0] - Bv[0]) * t, Bv[1] + (A[1] - Bv[1]) * t, NEAR]; }
      const x0 = HW + A[0] / A[2] * F, y0 = HH - A[1] / A[2] * F, x1 = HW + Bv[0] / Bv[2] * F, y1 = HH - Bv[1] / Bv[2] * F;
      const steps = Math.min(4000, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.floor(x0 + (x1 - x0) * t), y = Math.floor(y0 + (y1 - y0) * t);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const iw = 1 / (A[2] + (Bv[2] - A[2]) * t);
        const idx = y * W + x;
        if (iw * 1.02 < DEPTH[idx]) continue;
        const d = COLOR[idx];
        COLOR[idx] = ((d & 255) * 0.4) | ((((d >> 8) & 255) * 0.4) << 8) | ((((d >> 16) & 255) * 0.4) << 16);
      }
    }

    drawCracks(x, y, z, boxes, stage) {
      if (this.skip) return;
      const tile = MC.TEX['destroy_' + Math.min(9, stage)];
      const cols = MC.ATLAS.cols, tx = (tile % cols) * 16, ty = Math.floor(tile / cols) * 16;
      const corners = [
        [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
        [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
      ];
      TEX = this.atlas.px; TW = this.atlas.w; MODE = 2; DEPTH_BIAS = 1.01;
      U0 = tx; U1 = tx + 15.999; V0 = ty; V1 = ty + 15.999;
      const c = this.cam;
      for (const b of boxes.slice(0, 3)) {
        for (let f = 0; f < 6; f++) {
          corners[f].forEach(([cx, cy, cz], k) => {
            const px = (cx ? b[3] : b[0]), py = (cy ? b[4] : b[1]), pz = (cz ? b[5] : b[2]);
            const v = this.view3(x + px - c.x, y + py - c.y, z + pz - c.z);
            AX[k] = v[0]; AY[k] = v[1]; AD[k] = v[2];
            const qx = Math.round(px * 16), qy = Math.round(py * 16), qz = Math.round(pz * 16);
            AU[k] = tx + ([16 - qz, qz, qx, qx, qx, 16 - qx][f] & 31) % 17;
            AV[k] = ty + ((f === 2 || f === 3 ? qz : 16 - qy) & 31) % 17;
            AR[k] = AG[k] = AB[k] = 1; AF[k] = 0;
          });
          poly(4, true);
        }
      }
      MODE = 0; DEPTH_BIAS = 1;
    }

    // ---------------- entity box models ----------------
    model(name, build) {
      let m = this.models.get(name);
      if (m) return m;
      m = this.buildModel(build());
      this.models.set(name, m);
      return m;
    }

    buildModel(def) {
      const cols = MC.ATLAS.cols;
      const parts = def.parts.map((p) => {
        const faces = [];
        for (const b of p.boxes) {
          const [x0, y0, z0] = b.from, [x1, y1, z1] = b.to;
          const tiles = Array.isArray(b.tex) ? b.tex : [b.tex, b.tex, b.tex, b.tex, b.tex, b.tex];
          const fl = [
            [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.6], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.6],
            [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 1.0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.5],
            [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.8], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.8],
          ];
          fl.forEach((f, i) => {
            const tile = tiles[i];
            if (tile == null) return;
            const tx = (tile % cols) * 16, ty = Math.floor(tile / cols) * 16;
            faces.push({ p: [f[0], f[1], f[2], f[3]], u0: tx, v0: ty, u1: tx + 16, v1: ty + 16, shade: f[4] });
          });
        }
        return { name: p.name, pivot: p.pivot || [0, 0, 0], faces };
      });
      return { parts, scale: def.scale || 1 / 16 };
    }

    iconModel(itemKey) {
      const name = 'icon:' + itemKey;
      let m = this.models.get(name);
      if (m) return m;
      const i = MC.ICONS[itemKey] || 0, S = MC.ICON_SHEET;
      const tx = (i % S.cols) * S.size, ty = Math.floor(i / S.cols) * S.size;
      m = { parts: [{ name: 'card', pivot: [0, 0, 0], faces: [{ p: [[-8, 0, 0], [8, 0, 0], [8, 16, 0], [-8, 16, 0]], u0: tx, v0: ty, u1: tx + S.size, v1: ty + S.size, shade: 1 }] }], scale: 1 / 16, icons: true };
      this.models.set(name, m);
      return m;
    }

    beginEntities() {}

    drawModel(m, x, y, z, yaw, opts = {}, held) {
      if (this.skip) return;
      const base = M.identity(M.create());
      const c = held ? { x: 0, y: 0, z: 0 } : this.cam;
      M.translate(base, base, x - c.x, y - c.y, z - c.z);
      M.rotateY(base, base, yaw);
      if (opts.pitch) M.rotateX(base, base, opts.pitch);
      if (opts.roll) M.rotateZ(base, base, opts.roll);
      const s = (opts.scale || 1) * m.scale;
      M.scale(base, base, s, s, s);
      const li = (((opts.sky != null ? opts.sky : 15) | 0) * 16 + ((opts.blk || 0) | 0)) * 3;
      const tint = opts.tint || [1, 1, 1];
      const hurt = (opts.hurt || 0) * 0.55;
      const lr = this.lut[li] * tint[0], lg = this.lut[li + 1] * tint[1], lb = this.lut[li + 2] * tint[2];
      TEX = m.icons ? this.icons.px : this.atlas.px; TW = m.icons ? this.icons.w : this.atlas.w;
      MODE = 0;
      const fs = this.fogStart, fr = 1 / Math.max(0.001, this.fogEnd - this.fogStart);
      const mm = M.create();
      for (const p of m.parts) {
        M.translate(mm, base, p.pivot[0], p.pivot[1], p.pivot[2]);
        const r = opts.rot && opts.rot[p.name];
        if (r) { if (r.x) M.rotateX(mm, mm, r.x); if (r.y) M.rotateY(mm, mm, r.y); if (r.z) M.rotateZ(mm, mm, r.z); }
        M.translate(mm, mm, -p.pivot[0], -p.pivot[1], -p.pivot[2]);
        for (const f of p.faces) {
          U0 = f.u0; U1 = f.u1 - 0.001; V0 = f.v0; V1 = f.v1 - 0.001;
          const uv = [[f.u0, f.v1], [f.u1, f.v1], [f.u1, f.v0], [f.u0, f.v0]];
          for (let k = 0; k < 4; k++) {
            const [px, py, pz] = f.p[k];
            const wx = mm[0] * px + mm[4] * py + mm[8] * pz + mm[12];
            const wy = mm[1] * px + mm[5] * py + mm[9] * pz + mm[13];
            const wz = mm[2] * px + mm[6] * py + mm[10] * pz + mm[14];
            if (held) { AX[k] = wx; AY[k] = wy; AD[k] = -wz; AF[k] = 0; }
            else {
              AX[k] = wx * this.rx + wz * this.rz; AY[k] = wx * this.ux + wy * this.uy + wz * this.uz; AD[k] = wx * this.fx + wy * this.fy + wz * this.fz;
              const fd = (Math.sqrt(wx * wx + wy * wy + wz * wz) - fs) * fr;
              AF[k] = fd <= 0 ? 0 : fd >= 1 ? 1 : fd * fd * (3 - 2 * fd);
            }
            let r = lr * f.shade, g = lg * f.shade, b = lb * f.shade;
            if (hurt) { r += (1 - r) * hurt; g -= g * hurt * 0.9; b -= b * hurt * 0.9; }
            AR[k] = r; AG[k] = g; AB[k] = b;
            AU[k] = uv[k][0]; AV[k] = uv[k][1];
          }
          poly(4, false);
        }
      }
    }

    drawHeld(m, opts) {
      if (this.skip) return;
      this.depth.fill(0);
      this.drawModel(m, opts.x, opts.y, opts.z, opts.yaw, opts, true);
    }

    // ---------------- show the frame ----------------
    end() {
      if (this.skip) return;
      const W = this.W, H = this.H, row = (W * 3 + 3) & ~3, out = this.bmp, color = this.color;
      const dv = new DataView(out.buffer);
      out[0] = 66; out[1] = 77;
      dv.setUint32(2, out.length, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
      dv.setInt32(18, W, true); dv.setInt32(22, H, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
      dv.setUint32(30, 0, true); dv.setUint32(34, row * H, true); dv.setUint32(38, 2835, true); dv.setUint32(42, 2835, true);
      for (let y = 0; y < H; y++) {
        let p = 54 + (H - 1 - y) * row, i = y * W;
        for (let x = 0; x < W; x++, i++) { const c = color[i]; out[p++] = (c >> 16) & 255; out[p++] = (c >> 8) & 255; out[p++] = c & 255; }
      }
      this.present(out);
      const ms = performance.now() - this.t0;
      this.frameMs.push(ms);
      if (this.frameMs.length >= 20) {
        const avg = this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length;
        this.frameMs.length = 0;
        this.stats.ms = Math.round(avg);
        // keep the game responsive on slower computers by lowering the resolution
        if (avg > 34 && this.adapt < 2.6) this.adapt *= 1.15;
        else if (avg < 14 && this.adapt > 1) this.adapt = Math.max(1, this.adapt / 1.1);
      }
    }

    present(bytes) {
      this.presenting = true;
      this.presentStart = performance.now();
      if (!this.useDataUrl) {
        try {
          const url = URL.createObjectURL(new Blob([bytes], { type: 'image/bmp' }));
          this.oldUrl = this.curUrl;
          this.curUrl = url;
          this.img.src = url;
          return;
        } catch (e) { this.useDataUrl = true; }
      }
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      this.img.src = 'data:image/bmp;base64,' + btoa(s);
    }
  }

  MC.SoftRenderer = SoftRenderer;
})(globalThis);
