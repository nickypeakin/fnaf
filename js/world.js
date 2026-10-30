// Page-side view of the world: keeps a copy of every loaded chunk's blocks (and light) for
// physics, raycasts and game logic, streams chunks in around the player, and forwards edits to
// the worker. All persistent changes are recorded in `edits` so they can be saved or synced.
(function (G) {
  'use strict';
  const MC = G.MC;
  const { MIN_Y, HEIGHT, BLOCKS } = MC;
  const B = MC.B;

  class World {
    constructor(seed, renderer, opts = {}) {
      this.seed = seed;
      this.renderer = renderer;
      this.chunks = new Map();
      this.edits = opts.edits || new Map(); // chunk key -> Map(cell index -> block value)
      this.tiles = opts.tiles || new Map(); // "x,y,z" -> container data (chests, furnaces)
      this.requested = new Map(); // key -> wanted
      this.renderDist = opts.renderDist || 6;
      this.pending = [];
      this.onEdit = null; // (x, y, z, v) for multiplayer / saving
      this.meshCount = 0;
      this.worker = new WorldWorker((m) => this.onMessage(m));
      this.worker.postMessage({ t: 'init', seed });
      this.lastCenter = null;
    }

    key(cx, cz) { return cx + ',' + cz; }

    onMessage(m) {
      if (m.t === 'chunk') {
        const k = this.key(m.cx, m.cz);
        if (!this.requested.has(k)) return;
        const old = this.chunks.get(k);
        this.chunks.set(k, { cx: m.cx, cz: m.cz, blocks: m.blocks, light: old ? old.light : null, biome: m.biome, caveBiomes: m.caveBiomes });
      } else if (m.t === 'mesh') {
        if (!this.requested.get(this.key(m.cx, m.cz))) return;
        this.renderer.upload(m.cx, m.cz, m.sy, m.opaque, m.trans);
        this.meshCount++;
      } else if (m.t === 'light') {
        const c = this.chunks.get(this.key(m.cx, m.cz));
        if (c) c.light = m.light;
      }
    }

    // Stream chunks in and out around (x, z).
    update(x, y, z, force) {
      const pcx = Math.floor(x / 16), pcz = Math.floor(z / 16);
      this.worker.postMessage({ t: 'focus', pos: { x, y, z } });
      const center = pcx + ',' + pcz + ',' + this.renderDist;
      if (!force && center === this.lastCenter) return;
      this.lastCenter = center;
      const R = this.renderDist;
      const want = new Map();
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (R + 1.5) ** 2) continue;
        want.set(this.key(pcx + dx, pcz + dz), d2 <= (R + 0.5) ** 2);
      }
      const order = [...want.keys()].sort((a, b) => {
        const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
        return (ax - pcx) ** 2 + (az - pcz) ** 2 - ((bx - pcx) ** 2 + (bz - pcz) ** 2);
      });
      for (const k of order) {
        const w = want.get(k);
        const had = this.requested.get(k);
        if (had === undefined) {
          const [cx, cz] = k.split(',').map(Number);
          const ed = this.edits.get(k);
          this.worker.postMessage({ t: 'load', cx, cz, wanted: w, edits: ed ? [...ed] : null });
          this.requested.set(k, w);
        } else if (had !== w) {
          const [cx, cz] = k.split(',').map(Number);
          if (w) this.worker.postMessage({ t: 'load', cx, cz, wanted: true });
          else { this.worker.postMessage({ t: 'unwant', cx, cz }); this.renderer.removeChunk(cx, cz); }
          this.requested.set(k, w);
        }
      }
      for (const k of [...this.requested.keys()]) {
        const [cx, cz] = k.split(',').map(Number);
        if ((cx - pcx) ** 2 + (cz - pcz) ** 2 > (R + 2.5) ** 2) {
          this.worker.postMessage({ t: 'unload', cx, cz });
          this.requested.delete(k);
          this.chunks.delete(k);
          this.renderer.removeChunk(cx, cz);
        }
      }
    }

    reloadAll() {
      for (const k of this.requested.keys()) { const [cx, cz] = k.split(',').map(Number); this.worker.postMessage({ t: 'unload', cx, cz }); }
      this.requested.clear();
      this.chunks.clear();
      this.renderer.clear();
      this.lastCenter = null;
    }

    // ---- block access ----
    // Returns the block value, or -1 if that chunk isn't loaded yet (treated as solid by physics).
    get(x, y, z) {
      const ly = y - MIN_Y;
      if (ly < 0) return B.bedrock;
      if (ly >= HEIGHT) return 0;
      const c = this.chunks.get(this.key(Math.floor(x / 16), Math.floor(z / 16)));
      if (!c) return -1;
      return c.blocks[(ly << 8) | ((z & 15) << 4) | (x & 15)];
    }
    id(x, y, z) { const v = this.get(x, y, z); return v < 0 ? -1 : v & MC.ID_MASK; }
    def(x, y, z) { const v = this.get(x, y, z); return v < 0 ? null : BLOCKS[v & MC.ID_MASK]; }
    loaded(x, z) { return this.chunks.has(this.key(Math.floor(x / 16), Math.floor(z / 16))); }

    light(x, y, z) {
      const ly = y - MIN_Y;
      if (ly >= HEIGHT) return { sky: 15, blk: 0 };
      if (ly < 0) return { sky: 0, blk: 0 };
      const c = this.chunks.get(this.key(Math.floor(x / 16), Math.floor(z / 16)));
      if (!c || !c.light) return { sky: 15, blk: 0 };
      const l = c.light[(ly << 8) | ((z & 15) << 4) | (x & 15)];
      return { sky: l >> 4, blk: l & 15 };
    }

    biomeAt(x, z) {
      const c = this.chunks.get(this.key(Math.floor(x / 16), Math.floor(z / 16)));
      return c ? c.biome[((z & 15) << 4) | (x & 15)] : 0;
    }
    caveBiomeAt(x, z) {
      const c = this.chunks.get(this.key(Math.floor(x / 16), Math.floor(z / 16)));
      return c ? c.caveBiomes[((z & 15) << 4) | (x & 15)] : 0;
    }

    // Change a block. opts.remote: came from the network (don't echo it back).
    set(x, y, z, v, opts = {}) {
      const ly = y - MIN_Y;
      if (ly < 0 || ly >= HEIGHT) return false;
      const k = this.key(Math.floor(x / 16), Math.floor(z / 16));
      const c = this.chunks.get(k);
      const i = (ly << 8) | ((z & 15) << 4) | (x & 15);
      if (c) {
        if (c.blocks[i] === v) return false;
        c.blocks[i] = v;
      }
      let e = this.edits.get(k);
      if (!e) { e = new Map(); this.edits.set(k, e); }
      e.set(i, v);
      this.pending.push([x, y, z, v]);
      if (this.onEdit) this.onEdit(x, y, z, v, opts);
      return true;
    }

    flush() {
      if (!this.pending.length) return;
      this.worker.postMessage({ t: 'set', list: this.pending });
      this.pending = [];
    }

    nb(x, y, z) { return (dx, dy, dz) => { const v = this.get(x + dx, y + dy, z + dz); return v < 0 ? 0 : v; }; }

    // ---- raycast: the block you're looking at ----
    raycast(ox, oy, oz, dx, dy, dz, maxDist, fluids) {
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
      const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
      let tx = dx ? (sx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
      let ty = dy ? (sy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
      let tz = dz ? (sz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
      for (let n = 0; n < 200; n++) {
        const v = this.get(x, y, z);
        if (v > 0) {
          const b = BLOCKS[v & MC.ID_MASK];
          let boxes = MC.selectBoxes(v, this.nb(x, y, z));
          if (!boxes && fluids && b.liquid && (v >> MC.ID_BITS) === 0) boxes = [[0, 0, 0, 1, 1, 1]];
          if (boxes) {
            let best = null;
            for (const bx of boxes) {
              const hit = rayBox(ox, oy, oz, dx, dy, dz, x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]);
              if (hit && hit.t <= maxDist && (!best || hit.t < best.t)) best = hit;
            }
            if (best) return { x, y, z, v, face: best.face, t: best.t, px: ox + dx * best.t, py: oy + dy * best.t, pz: oz + dz * best.t, boxes };
          }
        }
        const tmin = Math.min(tx, ty, tz);
        if (tmin > maxDist) break;
        if (tx === tmin) { x += sx; tx += tdx; } else if (ty === tmin) { y += sy; ty += tdy; } else { z += sz; tz += tdz; }
      }
      return null;
    }

    // ---- collision boxes overlapping an AABB ----
    boxesIn(x0, y0, z0, x1, y1, z1, out) {
      out.length = 0;
      for (let y = Math.floor(y0) - 1; y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
        const v = this.get(x, y, z);
        if (v === 0) continue;
        if (v < 0) { out.push([x, y, z, x + 1, y + 1, z + 1]); continue; }
        const b = BLOCKS[v & MC.ID_MASK];
        if (!b.solid) continue;
        const boxes = b.full ? FULL_BOX : MC.collisionBoxes(v, this.nb(x, y, z));
        if (!boxes) continue;
        for (const bx of boxes) out.push([x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]]);
      }
      return out;
    }

    // What fluid/climbable/special blocks an AABB is touching.
    touching(x0, y0, z0, x1, y1, z1) {
      const r = { water: false, lava: false, climb: false, powder: false, web: false, eyeWater: false };
      for (let y = Math.floor(y0); y <= Math.floor(y1 - 0.001); y++) for (let z = Math.floor(z0); z <= Math.floor(z1 - 0.001); z++) for (let x = Math.floor(x0); x <= Math.floor(x1 - 0.001); x++) {
        const b = this.def(x, y, z);
        if (!b) continue;
        if (b.liquid === 'water') r.water = true;
        if (b.liquid === 'lava') r.lava = true;
        if (b.climb) r.climb = true;
        if (b.key === 'powder_snow') r.powder = true;
        if (b.key === 'cobweb') r.web = true;
      }
      return r;
    }

    // Height of the highest solid block in a column (for spawning).
    surfaceY(x, z) {
      for (let y = MC.MAX_Y; y > MIN_Y; y--) {
        const b = this.def(x, y, z);
        if (b && (b.solid || b.liquid)) return y;
      }
      return MIN_Y;
    }
  }

  const FULL_BOX = [[0, 0, 0, 1, 1, 1]];

  // The world normally runs in a Web Worker. If workers are blocked (some privacy tools do that),
  // the same script runs on the page instead: a bit slower, but the game still works.
  class WorldWorker {
    constructor(onMessage) {
      this.onMessage = onMessage;
      this.queue = [];
      this.ok = false;
      this.inline = null;
      try {
        this.w = new Worker('js/world-worker.js');
        this.w.onmessage = (e) => { if (!this.ok) { this.ok = true; this.queue = []; clearTimeout(this.timer); } this.onMessage(e.data); };
        this.w.onerror = (e) => { if (!this.ok) { if (e.preventDefault) e.preventDefault(); this.fallback(); } };
        // nothing back at all after a while: probably blocked without an error
        this.timer = setTimeout(() => { if (!this.ok) this.fallback(); }, 8000);
      } catch (e) { this.fallback(); }
    }
    postMessage(m) {
      if (this.inline) { this.inline(m); return; }
      if (!this.ok) this.queue.push(m);
      if (this.w) this.w.postMessage(m);
    }
    fallback() {
      if (this.inline || this.starting || this.dead) return;
      this.starting = true;
      clearTimeout(this.timer);
      if (this.w) { try { this.w.terminate(); } catch (e) { /* ignore */ } this.w = null; }
      MC.workerMode = 'page';
      fetch('js/world-worker.js').then((r) => r.text()).then((src) => {
        if (this.dead) return;
        const post = (msg) => { Promise.resolve().then(() => { if (!this.dead) this.onMessage(msg); }); };
        const make = new Function('postMessage', 'importScripts', 'self', 'let onmessage;\n' + src.replace("'use strict';", '') + '\n;return (m) => onmessage({ data: m });');
        this.inline = make(post, () => {}, G);
        this.ok = true;
        for (const m of this.queue) this.inline(m);
        this.queue = [];
      }).catch((e) => console.error('world worker failed', e));
    }
    terminate() {
      this.dead = true;
      clearTimeout(this.timer);
      if (this.w) this.w.terminate();
      if (this.inline) this.inline({ t: 'stop' });
    }
  }

  function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
    let tmin = -Infinity, tmax = Infinity, face = -1;
    const axes = [[ox, dx, x0, x1, 1, 0], [oy, dy, y0, y1, 3, 2], [oz, dz, z0, z1, 5, 4]];
    for (const [o, d, a, b, fNeg, fPos] of axes) {
      if (Math.abs(d) < 1e-9) { if (o < a || o > b) return null; continue; }
      let t1 = (a - o) / d, t2 = (b - o) / d, f1 = fNeg, f2 = fPos;
      if (t1 > t2) { [t1, t2] = [t2, t1]; [f1, f2] = [f2, f1]; }
      if (t1 > tmin) { tmin = t1; face = f1; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    return { t: Math.max(0, tmin), face };
  }

  MC.World = World;
})(globalThis);
