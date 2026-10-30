// The world worker owns the authoritative block and light data. It generates chunks, floods
// sky light and block light across chunk borders, applies edits, and builds the vertex data for
// every 16x16x16 section that the page uploads to the GPU.
'use strict';
importScripts('util.js', 'noise.js', 'blocks.js', 'shapes.js', 'worldgen.js', 'atlas.js');
const MC = self.MC;
const { MIN_Y, HEIGHT, BLOCKS, OPACITY } = MC;
const ID_MASK = MC.ID_MASK;

let gen = null;
const chunks = new Map(); // numeric key -> chunk
const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
let focus = { x: 0, y: 64, z: 0 };
const genQueue = [];
const dirty = new Set(); // chunkKey * 16 + section

// ------------------------------------------------------------------ chunk storage
// Chunks know their four neighbours (nb: east, west, south, north) so the light flood can step
// across borders without map lookups. Light queues store (chunk slot, cell index).
const slots = [];
const freeSlots = [];
function getChunk(cx, cz) { return chunks.get(key(cx, cz)); }
const NB_OFF = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function link(c) {
  for (let f = 0; f < 4; f++) {
    const n = getChunk(c.cx + NB_OFF[f][0], c.cz + NB_OFF[f][1]) || null;
    c.nb[f] = n;
    if (n) n.nb[f ^ 1] = c;
  }
}
function unlink(c) { for (let f = 0; f < 4; f++) { const n = c.nb[f]; if (n) n.nb[f ^ 1] = null; } }
function chunkAt(x, z) { const c = getChunk(x >> 4, z >> 4); return c && c.lit ? c : null; }

// ------------------------------------------------------------------ lighting
// light byte = sky << 4 | block. Channel 0 = sky, 1 = block.
const QN = 1 << 21, QM = QN - 1;
const qs = new Int32Array(QN), qi = new Int32Array(QN);
let qh = 0, qt = 0;
const rs = new Int32Array(QN), ri = new Int32Array(QN), rl = new Int8Array(QN);

// Neighbour of cell i in chunk c along direction d (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z).
let NB = null, NJ = 0;
function step(c, i, d) {
  const lx = i & 15, lz = (i >> 4) & 15;
  switch (d) {
    case 0: if (lx < 15) { NB = c; NJ = i + 1; } else { NB = c.nb[0]; NJ = i - 15; } break;
    case 1: if (lx > 0) { NB = c; NJ = i - 1; } else { NB = c.nb[1]; NJ = i + 15; } break;
    case 2: if ((i >> 8) < HEIGHT - 1) { NB = c; NJ = i + 256; } else return false; break;
    case 3: if ((i >> 8) > 0) { NB = c; NJ = i - 256; } else return false; break;
    case 4: if (lz < 15) { NB = c; NJ = i + 16; } else { NB = c.nb[2]; NJ = i - 240; } break;
    default: if (lz > 0) { NB = c; NJ = i - 16; } else { NB = c.nb[3]; NJ = i + 240; } break;
  }
  return !!(NB && NB.lit);
}

function markDirty(c, i) {
  const ly = i >> 8, lx = i & 15, lz = (i >> 4) & 15, sy = ly >> 4;
  const base = c.k * 16;
  dirty.add(base + sy);
  if ((ly & 15) === 0 && sy > 0) dirty.add(base + sy - 1);
  if ((ly & 15) === 15 && sy < 15) dirty.add(base + sy + 1);
  if (lx === 0 && c.nb[1]) dirty.add(c.nb[1].k * 16 + sy);
  if (lx === 15 && c.nb[0]) dirty.add(c.nb[0].k * 16 + sy);
  if (lz === 0 && c.nb[3]) dirty.add(c.nb[3].k * 16 + sy);
  if (lz === 15 && c.nb[2]) dirty.add(c.nb[2].k * 16 + sy);
}

function push(c, i) { qs[qt] = c.slot; qi[qt] = i; qt = (qt + 1) & QM; }

function propagate(ch) {
  const shift = ch === 0 ? 4 : 0, keep = ch === 0 ? 0x0f : 0xf0;
  while (qh !== qt) {
    const c = slots[qs[qh]], i = qi[qh];
    qh = (qh + 1) & QM;
    if (!c || !c.lit) continue;
    const L = (c.light[i] >> shift) & 15;
    if (L <= 1) continue;
    for (let d = 0; d < 6; d++) {
      if (!step(c, i, d)) continue;
      const n = NB, j = NJ;
      const op = OPACITY[n.blocks[j] & ID_MASK];
      if (op >= 15) continue;
      const nl = ch === 0 && d === 3 && L === 15 && op === 0 ? 15 : L - 1 - op;
      if (nl > ((n.light[j] >> shift) & 15)) {
        n.light[j] = (n.light[j] & keep) | (nl << shift);
        markDirty(n, j);
        push(n, j);
      }
    }
  }
}

// Remove light that came through cell i and re-light from whatever is left around it.
function unlight(ch, c, i0) {
  const shift = ch === 0 ? 4 : 0, keep = ch === 0 ? 0x0f : 0xf0;
  const L0 = (c.light[i0] >> shift) & 15;
  if (L0 === 0) return;
  let h = 0, t = 0;
  c.light[i0] &= keep;
  markDirty(c, i0);
  rs[t] = c.slot; ri[t] = i0; rl[t] = L0; t++;
  while (h !== t) {
    const pc = slots[rs[h]], pi = ri[h], L = rl[h];
    h = (h + 1) & QM;
    if (!pc) continue;
    for (let d = 0; d < 6; d++) {
      if (!step(pc, pi, d)) continue;
      const n = NB, j = NJ;
      const Ln = (n.light[j] >> shift) & 15;
      if (Ln === 0) continue;
      if (Ln < L || (ch === 0 && d === 3 && L === 15 && Ln === 15)) {
        n.light[j] &= keep;
        markDirty(n, j);
        rs[t] = n.slot; ri[t] = j; rl[t] = Ln;
        t = (t + 1) & QM;
        if (ch === 1) {
          const e = MC.lightOf(n.blocks[j]);
          if (e > 0) { n.light[j] = (n.light[j] & 0xf0) | e; push(n, j); }
        }
      } else push(n, j);
    }
  }
}

// First lighting of a freshly generated chunk, then stitch it to its loaded neighbours.
function lightChunk(c) {
  const { blocks, light } = c;
  light.fill(0);
  let maxLy = 0;
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    let L = 15;
    for (let ly = HEIGHT - 1; ly >= 0; ly--) {
      const i = (ly << 8) | (lz << 4) | lx;
      const v = blocks[i];
      if (v && ly > maxLy) maxLy = ly;
      if (L === 0) continue;
      const op = OPACITY[v & ID_MASK];
      if (op >= 15) { L = 0; continue; }
      if (op > 0) L = Math.max(0, L - 1 - op);
      light[i] = L << 4;
    }
  }
  c.maxLy = maxLy;
  c.lit = true;
  let limit = maxLy + 1;
  for (const n of c.nb) if (n && n.lit) limit = Math.max(limit, n.maxLy + 1);
  limit = Math.min(limit, HEIGHT - 1);
  // block light from emitters
  for (let ly = 0; ly <= c.maxLy; ly++) for (let k = 0; k < 256; k++) {
    const i = (ly << 8) | k;
    const v = blocks[i];
    if (v && MC.EMIT[v & ID_MASK]) { const e = MC.lightOf(v); if (e) { light[i] = (light[i] & 0xf0) | e; push(c, i); } }
  }
  // sky light: only cells next to a darker see-through cell need to spread
  for (let ly = 0; ly <= limit; ly++) for (let k = 0; k < 256; k++) {
    const i = (ly << 8) | k;
    const L = light[i] >> 4;
    if (L <= 1) continue;
    for (let d = 0; d < 6; d++) {
      if (d === 2 || !step(c, i, d)) continue;
      const n = NB, j = NJ;
      if ((n.light[j] >> 4) < L - 1 && OPACITY[n.blocks[j] & ID_MASK] < 15) { push(c, i); break; }
    }
  }
  // neighbours' border cells flow into us
  for (let f = 0; f < 4; f++) {
    const n = c.nb[f];
    if (!n || !n.lit) continue;
    for (let ly = 0; ly <= limit; ly++) for (let s = 0; s < 16; s++) {
      // the neighbour's cells that face us
      const lx = f === 0 ? 0 : f === 1 ? 15 : s, lz = f === 2 ? 0 : f === 3 ? 15 : s;
      const i = (ly << 8) | (lz << 4) | lx;
      if ((n.light[i] >> 4) > 1) push(n, i);
    }
  }
  propagate(0);
  for (let f = 0; f < 4; f++) {
    const n = c.nb[f];
    if (!n || !n.lit) continue;
    for (let ly = 0; ly <= Math.max(c.maxLy, n.maxLy) + 1 && ly < HEIGHT; ly++) for (let s = 0; s < 16; s++) {
      const lx = f === 0 ? 0 : f === 1 ? 15 : s, lz = f === 2 ? 0 : f === 3 ? 15 : s;
      const i = (ly << 8) | (lz << 4) | lx;
      if ((n.light[i] & 15) > 1) push(n, i);
    }
  }
  propagate(1);
  for (let s = 0; s < 16; s++) dirty.add(c.k * 16 + s);
}

// Apply one block change with a full light update.
function setBlock(x, y, z, v) {
  const c = chunkAt(x, z);
  const ly = y - MIN_Y;
  if (!c || ly < 0 || ly >= HEIGHT) return false;
  const i = (ly << 8) | ((z & 15) << 4) | (x & 15);
  const old = c.blocks[i];
  if (old === v) return false;
  c.blocks[i] = v;
  if (ly > c.maxLy) c.maxLy = ly;
  markDirty(c, i);
  // block light
  if ((c.light[i] & 15) > 0) unlight(1, c, i);
  const e = MC.lightOf(v);
  if (e > 0) { c.light[i] = (c.light[i] & 0xf0) | e; push(c, i); }
  for (let d = 0; d < 6; d++) if (step(c, i, d) && (NB.light[NJ] & 15)) push(NB, NJ);
  propagate(1);
  // sky light
  if (OPACITY[old & ID_MASK] !== OPACITY[v & ID_MASK]) {
    if (c.light[i] >> 4) unlight(0, c, i);
    if (ly === HEIGHT - 1 && OPACITY[v & ID_MASK] < 15) { c.light[i] |= 0xf0; push(c, i); }
    for (let d = 0; d < 6; d++) if (step(c, i, d) && (NB.light[NJ] >> 4)) push(NB, NJ);
    propagate(0);
  }
  return true;
}

// ------------------------------------------------------------------ meshing
const P = 18;
const PB = new Uint16Array(P * P * P);
const PL = new Uint8Array(P * P * P);
const pidx = (x, y, z) => ((y + 1) * P + (z + 1)) * P + (x + 1);
const OFF = [1, -1, P * P, -P * P, P, -P];
const isOpaque = new Uint8Array(BLOCKS.length);
const RENDER = new Uint8Array(BLOCKS.length); // 0 none, 1 opaque, 2 cutout, 3 translucent
const SHAPE_FULL = new Uint8Array(BLOCKS.length);
const LIQUID = new Uint8Array(BLOCKS.length);
for (const b of BLOCKS) {
  isOpaque[b.id] = b.opaque ? 1 : 0;
  RENDER[b.id] = { none: 0, opaque: 1, cutout: 2, translucent: 3 }[b.render];
  SHAPE_FULL[b.id] = b.full || b.shape === 'liquid' ? 1 : 0;
  LIQUID[b.id] = b.liquid === 'water' ? 1 : b.liquid === 'lava' ? 2 : 0;
}
const texCache = new Map();
function tileFor(v, face) {
  const k = v * 8 + face;
  let t = texCache.get(k);
  if (t === undefined) {
    const name = MC.faceTexName(v, face);
    t = MC.TEX[name];
    if (t === undefined) t = 0;
    texCache.set(k, t);
  }
  return t;
}

// Corners of each face (in 1/16 block units), counter-clockwise seen from outside.
const FACE_CORNERS = [
  [[16, 0, 16], [16, 0, 0], [16, 16, 0], [16, 16, 16]],
  [[0, 0, 0], [0, 0, 16], [0, 16, 16], [0, 16, 0]],
  [[0, 16, 16], [16, 16, 16], [16, 16, 0], [0, 16, 0]],
  [[0, 0, 0], [16, 0, 0], [16, 0, 16], [0, 0, 16]],
  [[0, 0, 16], [16, 0, 16], [16, 16, 16], [0, 16, 16]],
  [[16, 0, 0], [0, 0, 0], [0, 16, 0], [16, 16, 0]],
];
const FACE_SHADE = [2, 2, 0, 3, 1, 1];
function faceUV(f, x, y, z) {
  switch (f) {
    case 0: return [16 - z, 16 - y];
    case 1: return [z, 16 - y];
    case 2: return [x, z];
    case 3: return [x, 16 - z];
    case 4: return [x, 16 - y];
    default: return [16 - x, 16 - y];
  }
}

class Buf {
  constructor() { this.a = new Uint32Array(1 << 18); this.n = 0; }
  reset() { this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { const b = new Uint32Array(this.a.length * 2); b.set(this.a); this.a = b; } }
  // x,y,z in 1/16 units relative to the section; u,v in pixels; light sky/block 0..15; ao 0..3
  vert(x, y, z, u, v, tile, sky, blk, ao, shade, flags) {
    this.a[this.n++] = (x & 511) | ((y & 511) << 9) | ((z & 511) << 18) | ((ao & 3) << 27) | ((shade & 7) << 29);
    this.a[this.n++] = ((u & 31) | ((v & 31) << 5) | ((tile & 4095) << 10) | ((sky & 15) << 22) | ((blk & 15) << 26) | ((flags & 3) << 30)) >>> 0;
  }
  out() { return this.a.slice(0, this.n); }
}
const opaqueBuf = new Buf(), transBuf = new Buf();

function fillPadded(c, sy) {
  const y0 = sy * 16;
  for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
    const n = ox === 0 && oz === 0 ? c : getChunk(c.cx + ox, c.cz + oz);
    const xs = ox === -1 ? 15 : 0, xe = ox === 1 ? 0 : 15, zs = oz === -1 ? 15 : 0, ze = oz === 1 ? 0 : 15;
    for (let y = -1; y <= 16; y++) {
      const ly = y0 + y;
      for (let lz = zs; lz <= ze; lz++) for (let lx = xs; lx <= xe; lx++) {
        const px = lx + ox * 16, pz = lz + oz * 16;
        if (px < -1 || px > 16 || pz < -1 || pz > 16) continue;
        const p = pidx(px, y, pz);
        if (ly < 0) { PB[p] = MC.B.bedrock; PL[p] = 0; }
        else if (ly >= HEIGHT || !n) { PB[p] = 0; PL[p] = 0xf0; }
        else { const i = (ly << 8) | (lz << 4) | lx; PB[p] = n.blocks[i]; PL[p] = n.light[i]; }
      }
    }
  }
}

function meshSection(c, sy) {
  fillPadded(c, sy);
  opaqueBuf.reset(); transBuf.reset();
  let any = false;
  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const p = pidx(x, y, z);
    const v = PB[p];
    const id = v & ID_MASK;
    if (id === 0) continue;
    const r = RENDER[id];
    if (r === 0) continue;
    any = true;
    const buf = r === 3 ? transBuf : opaqueBuf;
    if (SHAPE_FULL[id]) fullBlock(buf, p, v, id, x, y, z);
    else if (BLOCKS[id].shape === 'cross') crossBlock(buf, p, v, id, x, y, z);
    else boxBlock(buf, p, v, id, x, y, z);
  }
  return any ? { opaque: opaqueBuf.out(), trans: transBuf.out() } : null;
}

function fullBlock(buf, p, v, id, x, y, z) {
  const liquid = LIQUID[id];
  let topH = 16;
  if (liquid && (PB[p + OFF[2]] & ID_MASK) !== id) {
    // sources sit at 14/16; flowing water gets lower the further it is from its source
    const st = v >> MC.ID_BITS;
    topH = st === 0 || st >= 8 ? 14 : Math.max(3, 14 - Math.round(st * 1.5));
  }
  const cutout = RENDER[id] === 2;
  for (let f = 0; f < 6; f++) {
    const nv = PB[p + OFF[f]], nid = nv & ID_MASK;
    if (isOpaque[nid]) continue;
    if (nid === id && (cutout || liquid || RENDER[id] === 3)) continue;
    if (liquid && f !== 2 && SHAPE_FULL[nid] && !LIQUID[nid] && RENDER[nid] !== 0 && liquid === 1 && RENDER[nid] === 3) continue;
    const tile = tileFor(v, f);
    buf.ensure(16);
    const corners = FACE_CORNERS[f];
    const lights = [], aos = [];
    for (let k = 0; k < 4; k++) {
      const cx = corners[k][0], cy = corners[k][1], cz = corners[k][2];
      // tangent directions toward this corner
      const tx = f <= 1 ? 0 : cx ? 1 : -1, ty = f === 2 || f === 3 ? 0 : cy ? 1 : -1, tz = f >= 4 ? 0 : cz ? 1 : -1;
      const front = p + OFF[f];
      let s1, s2;
      if (f <= 1) { s1 = front + ty * P * P; s2 = front + tz * P; }
      else if (f <= 3) { s1 = front + tx; s2 = front + tz * P; }
      else { s1 = front + tx; s2 = front + ty * P * P; }
      const cr = s1 + (s2 - front);
      const o1 = isOpaque[PB[s1] & ID_MASK], o2 = isOpaque[PB[s2] & ID_MASK], oc = isOpaque[PB[cr] & ID_MASK];
      aos.push(o1 && o2 ? 3 : o1 + o2 + oc);
      let sk = PL[front] >> 4, bl = PL[front] & 15, n = 1;
      if (!o1) { sk += PL[s1] >> 4; bl += PL[s1] & 15; n++; }
      if (!o2) { sk += PL[s2] >> 4; bl += PL[s2] & 15; n++; }
      if (!oc && !(o1 && o2)) { sk += PL[cr] >> 4; bl += PL[cr] & 15; n++; }
      lights.push([Math.round(sk / n), Math.round(bl / n)]);
    }
    const flags = liquid === 1 ? 1 : 0;
    // Flip the quad's diagonal so ambient occlusion doesn't look lopsided.
    const order = aos[0] + aos[2] > aos[1] + aos[3] ? [1, 2, 3, 0] : [0, 1, 2, 3];
    for (const k of order) {
      const [cx, cy0, cz] = corners[k];
      const cy = cy0 === 16 ? topH : cy0;
      const [u, vv] = faceUV(f, cx, cy, cz);
      buf.vert(x * 16 + cx, y * 16 + cy, z * 16 + cz, u, vv, tile, lights[k][0], lights[k][1], aos[k], FACE_SHADE[f], flags);
    }
  }
}

function crossBlock(buf, p, v, id, x, y, z) {
  const tile = tileFor(v, 4);
  const L = PL[p];
  const sky = L >> 4, blk = L & 15;
  // Pointed dripstone's texture is wide at the top: hanging ones keep it, standing ones flip it.
  const drip = BLOCKS[id].key === 'pointed_dripstone';
  const hang = drip && (v >> MC.ID_BITS) & 1;
  const quads = [[[2, 0, 2], [14, 0, 14]], [[2, 0, 14], [14, 0, 2]]];
  buf.ensure(32);
  for (const [[ax, , az], [bx, , bz]] of quads) {
    for (const side of [0, 1]) {
      const pts = side ? [[bx, bz], [ax, az]] : [[ax, az], [bx, bz]];
      const vs = [[pts[0], 0, 0], [pts[1], 16, 0], [pts[1], 16, 16], [pts[0], 0, 16]];
      for (const [[px, pz], u, h] of vs) {
        const vy = hang ? 16 - h : h;
        buf.vert(x * 16 + px, y * 16 + vy, z * 16 + pz, u, drip ? h : 16 - h, tile, sky, blk, 0, 1, 2);
      }
    }
  }
}

function boxBlock(buf, p, v, id, x, y, z) {
  const nb = (dx, dy, dz) => PB[p + dx * OFF[0] + dy * OFF[2] + dz * OFF[4]];
  const boxes = MC.shapeBoxes(v, nb);
  const own = PL[p];
  const b = BLOCKS[id];
  for (const box of boxes) {
    const [x0, y0, z0, x1, y1, z1] = box;
    for (let f = 0; f < 6; f++) {
      const onEdge = (f === 0 && x1 === 16) || (f === 1 && x0 === 0) || (f === 2 && y1 === 16) || (f === 3 && y0 === 0) || (f === 4 && z1 === 16) || (f === 5 && z0 === 0);
      let L = own;
      if (onEdge) {
        const nid = PB[p + OFF[f]] & ID_MASK;
        if (isOpaque[nid]) continue;
        L = Math.max(PL[p + OFF[f]], 0);
        if ((L >> 4) === 0 && (L & 15) === 0) L = own;
      }
      const tile = box[6] === 'stem' ? tileFor(v, 4) : tileFor(v, f);
      buf.ensure(16);
      const corners = FACE_CORNERS[f];
      for (const [cx, cy, cz] of corners) {
        const px = cx ? x1 : x0, py = cy ? y1 : y0, pz = cz ? z1 : z0;
        const [u, vv] = faceUV(f, px, py, pz);
        buf.vert(x * 16 + px, y * 16 + py, z * 16 + pz, u, vv, tile, L >> 4, L & 15, 0, FACE_SHADE[f], 0);
      }
    }
  }
  // Campfires and flowering things get a little cross on top.
  if (b.shape === 'campfire') {
    const tile = tileFor(v, 4);
    for (const [ax, az, bx, bz] of [[2, 2, 14, 14], [2, 14, 14, 2]]) {
      for (const [p0, p1] of [[[ax, az], [bx, bz]], [[bx, bz], [ax, az]]]) {
        buf.ensure(8);
        buf.vert(x * 16 + p0[0], y * 16 + 3, z * 16 + p0[1], 0, 16, tile, own >> 4, 15, 0, 1, 2);
        buf.vert(x * 16 + p1[0], y * 16 + 3, z * 16 + p1[1], 16, 16, tile, own >> 4, 15, 0, 1, 2);
        buf.vert(x * 16 + p1[0], y * 16 + 16, z * 16 + p1[1], 16, 0, tile, own >> 4, 15, 0, 1, 2);
        buf.vert(x * 16 + p0[0], y * 16 + 16, z * 16 + p0[1], 0, 0, tile, own >> 4, 15, 0, 1, 2);
      }
    }
  }
}

// ------------------------------------------------------------------ scheduling
function ready(c) {
  if (!c || !c.lit) return false;
  for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
    const n = getChunk(c.cx + ox, c.cz + oz);
    if (!n || !n.lit) return false;
  }
  return true;
}

function processGen(budgetMs) {
  const t0 = performance.now();
  if (!genQueue.length) return;
  genQueue.sort((a, b) => dist(b) - dist(a));
  while (genQueue.length && performance.now() - t0 < budgetMs) {
    const job = genQueue.pop();
    const k = key(job.cx, job.cz);
    const c = chunks.get(k);
    if (!c || c.lit) continue;
    const g = gen.generate(job.cx, job.cz);
    c.blocks = g.blocks;
    c.biome = g.biome;
    c.caveBiomes = g.caveBiomes;
    if (c.edits) for (const [i, v] of c.edits) c.blocks[i] = v;
    c.edits = null;
    lightChunk(c);
    const copy = c.blocks.slice();
    postMessage({ t: 'chunk', cx: c.cx, cz: c.cz, blocks: copy, biome: g.biome, caveBiomes: g.caveBiomes }, [copy.buffer]);
  }
}

function dist(job) { const dx = job.cx * 16 + 8 - focus.x, dz = job.cz * 16 + 8 - focus.z; return dx * dx + dz * dz; }

function processMeshes(budgetMs) {
  const t0 = performance.now();
  if (!dirty.size) return;
  const list = [];
  for (const d of dirty) {
    const k = Math.floor(d / 16), sy = d % 16;
    const c = chunks.get(k);
    if (!c) { dirty.delete(d); continue; }
    if (!ready(c) || !c.wanted) continue;
    const dx = c.cx * 16 + 8 - focus.x, dy = MIN_Y + sy * 16 + 8 - focus.y, dz = c.cz * 16 + 8 - focus.z;
    list.push([dx * dx + dy * dy * 0.5 + dz * dz, d, c, sy]);
  }
  list.sort((a, b) => a[0] - b[0]);
  const lightSent = new Set();
  for (const [, d, c, sy] of list) {
    if (performance.now() - t0 > budgetMs) break;
    dirty.delete(d);
    const m = meshSection(c, sy);
    if (m) postMessage({ t: 'mesh', cx: c.cx, cz: c.cz, sy, opaque: m.opaque, trans: m.trans }, [m.opaque.buffer, m.trans.buffer]);
    else postMessage({ t: 'mesh', cx: c.cx, cz: c.cz, sy, opaque: null, trans: null });
    if (!lightSent.has(c.k)) { lightSent.add(c.k); c.lightDirty = true; }
  }
  for (const k of lightSent) {
    const c = chunks.get(k);
    const copy = c.light.slice();
    postMessage({ t: 'light', cx: c.cx, cz: c.cz, light: copy }, [copy.buffer]);
  }
}

// When Web Workers are blocked this script runs on the page itself, so it works in smaller slices.
const ON_PAGE = typeof document !== 'undefined';
let stopped = false;
function loop() {
  if (stopped) return;
  processGen(ON_PAGE ? 5 : 14);
  processMeshes(ON_PAGE ? 4 : 12);
  setTimeout(loop, genQueue.length || dirty.size ? (ON_PAGE ? 4 : 0) : 30);
}

onmessage = (e) => {
  const m = e.data;
  switch (m.t) {
    case 'init':
      gen = new MC.WorldGen(m.seed);
      loop();
      break;
    case 'focus':
      focus = m.pos;
      break;
    case 'stop':
      stopped = true;
      break;
    case 'load': {
      // wanted: whether this chunk should be meshed (inside view distance) or only generated as a neighbour
      const k = key(m.cx, m.cz);
      let c = chunks.get(k);
      if (!c) {
        const slot = freeSlots.length ? freeSlots.pop() : slots.length;
        c = { k, slot, cx: m.cx, cz: m.cz, blocks: null, light: new Uint8Array(MC.COLUMN_SIZE), lit: false, maxLy: 0, nb: [null, null, null, null], wanted: m.wanted, edits: m.edits ? new Map(m.edits) : null };
        slots[slot] = c;
        chunks.set(k, c);
        link(c);
        genQueue.push({ cx: m.cx, cz: m.cz });
      } else if (m.wanted && !c.wanted) {
        c.wanted = true;
        for (let s = 0; s < 16; s++) dirty.add(k * 16 + s);
      } else c.wanted = m.wanted || c.wanted;
      break;
    }
    case 'unload': {
      const k = key(m.cx, m.cz);
      const c = chunks.get(k);
      if (!c) break;
      unlink(c);
      slots[c.slot] = null;
      freeSlots.push(c.slot);
      chunks.delete(k);
      for (let s = 0; s < 16; s++) dirty.delete(k * 16 + s);
      break;
    }
    case 'unwant': {
      const c = getChunk(m.cx, m.cz);
      if (c) c.wanted = false;
      break;
    }
    case 'set': {
      for (const [x, y, z, v] of m.list) {
        const c = getChunk(x >> 4, z >> 4);
        if (c && !c.lit) { if (!c.edits) c.edits = new Map(); c.edits.set(MC.idx(x & 15, y - MIN_Y, z & 15), v); continue; }
        setBlock(x, y, z, v);
      }
      processMeshes(30);
      break;
    }
  }
};
