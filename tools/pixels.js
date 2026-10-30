// Tiny pixel-art toolkit for the texture build: 16x16 RGBA tiles, colours, noise and PNG output.
'use strict';
const zlib = require('zlib');

class Tile {
  constructor(w = 16, h = 16) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(x, y, c, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a != null ? a : c[3] != null ? c[3] : 255;
  }
  get(x, y) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  alpha(x, y) { return (x < 0 || y < 0 || x >= this.w || y >= this.h) ? 0 : this.d[(y * this.w + x) * 4 + 3]; }
  fill(c, a) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c, a); return this; }
  each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y); return this; }
  copy() { const t = new Tile(this.w, this.h); t.d.set(this.d); return t; }
  rect(x0, y0, w, h, c, a) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a); return this; }
  line(x0, y0, x1, y1, c, a) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, a);
    return this;
  }
  disc(cx, cy, r, c, a) { this.each((x, y) => { if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, c, a); }); return this; }
  poly(pts, c, a) {
    this.each((x, y) => {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) this.set(x, y, c, a);
    });
    return this;
  }
  // Darken transparent pixels that touch opaque ones: the classic item outline.
  outline(darken = 0.45) {
    const src = this.copy();
    this.each((x, y) => {
      if (src.alpha(x, y) > 0) return;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (src.alpha(x + dx, y + dy) > 128) { const c = src.get(x + dx, y + dy); this.set(x, y, shade(c, -darken)); return; }
      }
    });
    return this;
  }
  map(fn) { this.each((x, y) => { const c = this.get(x, y); const r = fn(c, x, y); if (r) this.set(x, y, r, r[3] != null ? r[3] : c[3]); }); return this; }
  tint(col, k = 1) { return this.map((c) => (c[3] ? [lerp(c[0], c[0] * col[0] / 255, k), lerp(c[1], c[1] * col[1] / 255, k), lerp(c[2], c[2] * col[2] / 255, k), c[3]] : null)); }
  over(t) { t.each((x, y) => { const c = t.get(x, y); if (c[3] > 0) { if (c[3] >= 255) this.set(x, y, c); else { const b = this.get(x, y); const a = c[3] / 255; this.set(x, y, [lerp(b[0], c[0], a), lerp(b[1], c[1], a), lerp(b[2], c[2], a)], Math.max(b[3], c[3])); } } }); return this; }
  flipX() { const s = this.copy(); this.each((x, y) => this.set(x, y, s.get(this.w - 1 - x, y), s.get(this.w - 1 - x, y)[3])); return this; }
  rot90() { const s = this.copy(); this.each((x, y) => { const c = s.get(y, this.w - 1 - x); this.set(x, y, c, c[3]); }); return this; }
}

const lerp = (a, b, t) => a + (b - a) * t;
function shade(c, k) {
  if (k >= 0) return [lerp(c[0], 255, k), lerp(c[1], 255, k), lerp(c[2], 255, k), c[3]];
  return [c[0] * (1 + k), c[1] * (1 + k), c[2] * (1 + k), c[3]];
}
function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function hex(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

function rngFor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- PNG encoding ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { Tile, shade, mix, hex, lerp, rngFor, encodePNG };
