// Shared helpers: constants, seeded randomness and small matrix math.
// Loaded by the page, the world worker and the Node build tools, so it only uses globalThis.
(function (G) {
  'use strict';
  const MC = (G.MC = G.MC || {});

  // World layout: chunks are 16x16 columns from y = -64 up to y = 191.
  MC.CHUNK = 16;
  MC.MIN_Y = -64;
  MC.HEIGHT = 256;
  MC.MAX_Y = MC.MIN_Y + MC.HEIGHT - 1;
  MC.SECTIONS = MC.HEIGHT / 16;
  MC.SEA = 62;
  MC.COLUMN_SIZE = 16 * 16 * MC.HEIGHT;

  // Index of a block inside a column array (y-major, so each 16-tall section is contiguous).
  MC.idx = (lx, ly, lz) => (ly << 8) | (lz << 4) | lx;
  MC.chunkKey = (cx, cz) => cx + ',' + cz;

  // A block value packs the block id (10 bits) and its state (6 bits): facing, axis, half...
  MC.ID_BITS = 10;
  MC.ID_MASK = (1 << MC.ID_BITS) - 1;
  MC.blockId = (v) => v & MC.ID_MASK;
  MC.blockState = (v) => v >> MC.ID_BITS;
  MC.withState = (id, state) => id | (state << MC.ID_BITS);

  MC.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  MC.lerp = (a, b, t) => a + (b - a) * t;
  MC.smooth = (t) => t * t * (3 - 2 * t);

  MC.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Deterministic integer hashes for "is there a tree here?"-style decisions.
  MC.hash = function (a, b, c, seed) {
    let h = (seed | 0) ^ Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  MC.hashf = (a, b, c, seed) => MC.hash(a, b, c, seed) / 4294967296;

  MC.seedFromString = function (s) {
    s = String(s).trim();
    if (/^-?\d+$/.test(s)) return Number(s) | 0;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h;
  };

  // ---- 4x4 matrices (column-major, like WebGL expects) ----
  const M = (MC.mat4 = {});
  M.create = () => new Float32Array(16);
  M.perspective = function (out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  };
  // View matrix for a camera at the origin looking along yaw/pitch (translation is applied per chunk).
  M.rotation = function (out, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // forward = (-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch))
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const rx = cy, ry = 0, rz = -sy;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    out[0] = rx; out[1] = ux; out[2] = -fx; out[3] = 0;
    out[4] = ry; out[5] = uy; out[6] = -fy; out[7] = 0;
    out[8] = rz; out[9] = uz; out[10] = -fz; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
  };
  M.multiply = function (out, a, b) {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        r[i * 4 + j] = s;
      }
    }
    out.set(r);
    return out;
  };
  M.translate = function (out, a, x, y, z) {
    out.set(a);
    out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
    out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
    out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
    out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    return out;
  };
  M.scale = function (out, a, x, y, z) {
    out.set(a);
    for (let i = 0; i < 4; i++) { out[i] *= x; out[4 + i] *= y; out[8 + i] *= z; }
    return out;
  };
  M.rotateY = function (out, a, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const r = M.create();
    r[0] = c; r[2] = -s; r[5] = 1; r[8] = s; r[10] = c; r[15] = 1;
    return M.multiply(out, a, r);
  };
  M.rotateX = function (out, a, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const r = M.create();
    r[0] = 1; r[5] = c; r[6] = s; r[9] = -s; r[10] = c; r[15] = 1;
    return M.multiply(out, a, r);
  };
  M.rotateZ = function (out, a, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const r = M.create();
    r[0] = c; r[1] = s; r[4] = -s; r[5] = c; r[10] = 1; r[15] = 1;
    return M.multiply(out, a, r);
  };
  M.identity = (out) => { out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out; };

  // Six faces in a fixed order used everywhere: +x, -x, +y, -y, +z, -z.
  MC.FACES = [
    { dx: 1, dy: 0, dz: 0, name: 'east' },
    { dx: -1, dy: 0, dz: 0, name: 'west' },
    { dx: 0, dy: 1, dz: 0, name: 'up' },
    { dx: 0, dy: -1, dz: 0, name: 'down' },
    { dx: 0, dy: 0, dz: 1, name: 'south' },
    { dx: 0, dy: 0, dz: -1, name: 'north' },
  ];
})(globalThis);
