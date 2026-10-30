// Mobs, dropped items, arrows, primed TNT, falling blocks, experience orbs and particles.
//
// The host (or a singleplayer game) simulates every entity. Guests receive snapshots and only
// interpolate them, sending attacks and interactions back to the host.
(function (G) {
  'use strict';
  const MC = G.MC;
  const { Inv } = MC;
  const B = MC.B, BLOCKS = MC.BLOCKS;
  let nextId = 1;

  // ---------------- mob catalogue ----------------
  const MOBS = {
    zombie: { w: 0.6, h: 1.95, hp: 20, speed: 2.4, hostile: true, dmg: 3, burns: true, xp: 5, sound: 'zombie', drops: [['rotten_flesh', 0, 2]], rare: [['iron_ingot', 0.025], ['carrot', 0.025], ['potato', 0.025]] },
    skeleton: { w: 0.6, h: 1.99, hp: 20, speed: 2.6, hostile: true, ranged: true, dmg: 3, burns: true, xp: 5, sound: 'skeleton', drops: [['bone', 0, 2], ['arrow', 0, 2]] },
    creeper: { w: 0.6, h: 1.7, hp: 20, speed: 2.3, hostile: true, explodes: true, xp: 5, sound: 'creeper', drops: [['gunpowder', 0, 2]] },
    spider: { w: 1.4, h: 0.9, hp: 16, speed: 3.1, hostile: true, dmg: 2, climbs: true, xp: 5, sound: 'spider', drops: [['string', 0, 2]], dayNeutral: true },
    pig: { w: 0.9, h: 0.9, hp: 10, speed: 2.0, food: ['carrot', 'potato', 'beetroot'], xp: 2, sound: 'pig', drops: [['porkchop', 1, 3]], cooked: 'cooked_porkchop' },
    cow: { w: 0.9, h: 1.4, hp: 10, speed: 2.0, food: ['wheat'], xp: 2, sound: 'cow', drops: [['beef', 1, 3], ['leather', 0, 2]], cooked: 'cooked_beef' },
    sheep: { w: 0.9, h: 1.3, hp: 8, speed: 2.1, food: ['wheat'], xp: 2, sound: 'sheep', drops: [['mutton', 1, 2]], cooked: 'cooked_mutton' },
    chicken: { w: 0.4, h: 0.7, hp: 4, speed: 2.0, food: ['wheat_seeds'], xp: 1, sound: 'chicken', drops: [['chicken', 1, 1], ['feather', 0, 2]], flutter: true, cooked: 'cooked_chicken' },
    goat: { w: 0.9, h: 1.3, hp: 10, speed: 2.4, food: ['wheat'], xp: 2, sound: 'goat', drops: [], jumpy: true },
    axolotl: { w: 0.75, h: 0.42, hp: 14, speed: 3.0, aquatic: true, xp: 2, sound: 'axolotl', drops: [] },
    glow_squid: { w: 0.8, h: 0.8, hp: 10, speed: 1.6, aquatic: true, glow: true, xp: 2, sound: 'squid', drops: [['glow_ink_sac', 1, 3]] },
  };
  MC.MOBS = MOBS;
  const AXOLOTL_TINTS = [[1, 0.72, 0.8], [0.62, 0.45, 0.35], [1, 0.85, 0.35], [0.55, 0.95, 1], [0.45, 0.5, 1]];
  const SHEEP_COLORS = { white: [1, 1, 1], light_gray: [0.62, 0.62, 0.6], gray: [0.32, 0.33, 0.34], black: [0.12, 0.12, 0.13], brown: [0.5, 0.33, 0.2], pink: [1, 0.66, 0.78] };

  // ---------------- generic box physics ----------------
  const scratch = [];
  function sweep(world, e, mx, my, mz) {
    const W = e.w / 2, h = e.h, E = 1e-7;
    const boxes = world.boxesIn(
      Math.min(e.x - W, e.x - W + mx), Math.min(e.y, e.y + my), Math.min(e.z - W, e.z - W + mz),
      Math.max(e.x + W, e.x + W + mx), Math.max(e.y + h, e.y + h + my), Math.max(e.z + W, e.z + W + mz), scratch);
    let hx = false, hy = false, hz = false, down = false;
    for (const b of boxes) {
      if (b[0] >= e.x + W - E || b[3] <= e.x - W + E || b[2] >= e.z + W - E || b[5] <= e.z - W + E) continue;
      if (my < 0 && b[4] <= e.y + E && b[4] > e.y + my) { my = b[4] - e.y; hy = down = true; }
      else if (my > 0 && b[1] >= e.y + h - E && b[1] < e.y + h + my) { my = b[1] - (e.y + h); hy = true; }
    }
    e.y += my;
    for (const b of boxes) {
      if (b[1] >= e.y + h - E || b[4] <= e.y + E || b[2] >= e.z + W - E || b[5] <= e.z - W + E) continue;
      if (mx < 0 && b[3] <= e.x - W + E && b[3] > e.x - W + mx) { mx = b[3] - (e.x - W); hx = true; }
      else if (mx > 0 && b[0] >= e.x + W - E && b[0] < e.x + W + mx) { mx = b[0] - (e.x + W); hx = true; }
    }
    e.x += mx;
    for (const b of boxes) {
      if (b[1] >= e.y + h - E || b[4] <= e.y + E || b[0] >= e.x + W - E || b[3] <= e.x - W + E) continue;
      if (mz < 0 && b[5] <= e.z - W + E && b[5] > e.z - W + mz) { mz = b[5] - (e.z - W); hz = true; }
      else if (mz > 0 && b[2] >= e.z + W - E && b[2] < e.z + W + mz) { mz = b[2] - (e.z + W); hz = true; }
    }
    e.z += mz;
    if (hx) e.vx = 0;
    if (hz) e.vz = 0;
    if (hy) e.vy = 0;
    e.onGround = down;
    e.hitWall = hx || hz;
  }
  MC.sweepEntity = sweep;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  // ---------------- models ----------------
  // tex: tile name, or array of 6 [east, west, up, down, south, north(front)]
  function T(n) { return MC.TEX[n] != null ? MC.TEX[n] : 0; }
  function faces(side, front, top, bottom, back) {
    const s = T(side);
    return [s, s, T(top || side), T(bottom || top || side), T(back || side), T(front || side)];
  }
  function box(from, to, tex) { return { from, to, tex: Array.isArray(tex) ? tex : [T(tex), T(tex), T(tex), T(tex), T(tex), T(tex)] }; }

  function humanoid(skin) {
    const s = skin;
    return {
      parts: [
        { name: 'head', pivot: [0, 24, 0], boxes: [box([-4, 24, -4], [4, 32, 4], faces(s.head, s.face, s.hair, s.head, s.back || s.head))] },
        { name: 'body', pivot: [0, 24, 0], boxes: [box([-4, 12, -2], [4, 24, 2], s.body)] },
        { name: 'armR', pivot: [6, 22, 0], boxes: [box(s.thin ? [5, 12, -1] : [4, 12, -2], s.thin ? [7, 24, 1] : [8, 24, 2], s.arm)] },
        { name: 'armL', pivot: [-6, 22, 0], boxes: [box(s.thin ? [-7, 12, -1] : [-8, 12, -2], s.thin ? [-5, 24, 1] : [-4, 24, 2], s.arm)] },
        { name: 'legR', pivot: [2, 12, 0], boxes: [box(s.thin ? [1, 0, -1] : [0, 0, -2], s.thin ? [3, 12, 1] : [4, 12, 2], s.leg)] },
        { name: 'legL', pivot: [-2, 12, 0], boxes: [box(s.thin ? [-3, 0, -1] : [-4, 0, -2], s.thin ? [-1, 12, 1] : [0, 12, 2], s.leg)] },
      ],
    };
  }
  function quadruped(o) {
    const [bw, bh, bl, by] = o.body, [hw, hh, hl, hy] = o.head, [lw, lh] = o.leg;
    const parts = [
      { name: 'body', pivot: [0, by, 0], boxes: [box([-bw / 2, by, -bl / 2], [bw / 2, by + bh, bl / 2], o.bodyTex)] },
      { name: 'head', pivot: [0, hy + hh / 2, -bl / 2], boxes: [box([-hw / 2, hy, -bl / 2 - hl + (o.headIn || 0)], [hw / 2, hy + hh, -bl / 2 + (o.headIn || 0)], faces(o.headTex, o.face))].concat(o.extraHead || []) },
    ];
    const lx = bw / 2 - lw / 2 - (o.legInset || 0), lz = bl / 2 - lw / 2 - 1;
    [['legFR', lx, -lz], ['legFL', -lx, -lz], ['legBR', lx, lz], ['legBL', -lx, lz]].forEach(([n, x, z]) => {
      parts.push({ name: n, pivot: [x, lh, z], boxes: [box([x - lw / 2, 0, z - lw / 2], [x + lw / 2, lh, z + lw / 2], o.legTex)] });
    });
    if (o.extra) parts.push(...o.extra);
    return { parts };
  }

  const MODELS = {
    zombie: () => humanoid({ head: 'zombie_head', face: 'zombie_face', hair: 'zombie_hair', body: 'zombie_shirt', arm: 'zombie_arm', leg: 'zombie_pants' }),
    skeleton: () => humanoid({ head: 'skeleton_head', face: 'skeleton_face', hair: 'skeleton_head', body: 'skeleton_body', arm: 'skeleton_limb', leg: 'skeleton_limb', thin: true }),
    creeper: () => ({
      parts: [
        { name: 'head', pivot: [0, 18, 0], boxes: [box([-4, 18, -4], [4, 26, 4], faces('creeper_body', 'creeper_face'))] },
        { name: 'body', pivot: [0, 6, 0], boxes: [box([-4, 6, -2], [4, 18, 2], 'creeper_body')] },
        { name: 'legFR', pivot: [2, 6, -4], boxes: [box([0, 0, -6], [4, 6, -2], 'creeper_body')] },
        { name: 'legFL', pivot: [-2, 6, -4], boxes: [box([-4, 0, -6], [0, 6, -2], 'creeper_body')] },
        { name: 'legBR', pivot: [2, 6, 4], boxes: [box([0, 0, 2], [4, 6, 6], 'creeper_body')] },
        { name: 'legBL', pivot: [-2, 6, 4], boxes: [box([-4, 0, 2], [0, 6, 6], 'creeper_body')] },
      ],
    }),
    spider: () => {
      const parts = [
        { name: 'body', pivot: [0, 8, 0], boxes: [box([-5, 4, 3], [5, 12, 15], 'spider_body'), box([-3, 5, -3], [3, 11, 3], 'spider_body')] },
        { name: 'head', pivot: [0, 8, -3], boxes: [box([-4, 4, -11], [4, 12, -3], faces('spider_body', 'spider_face'))] },
      ];
      for (let i = 0; i < 8; i++) {
        const side = i < 4 ? 1 : -1, z = -2 + (i % 4) * 1.5;
        parts.push({ name: 'leg' + i, pivot: [side * 3, 8, z], boxes: [box(side > 0 ? [3, 7, z - 0.5] : [-17, 7, z - 0.5], side > 0 ? [17, 9, z + 0.5] : [-3, 9, z + 0.5], 'spider_leg')] });
      }
      return { parts };
    },
    pig: () => quadruped({ body: [10, 8, 16, 6], head: [8, 8, 8, 8], leg: [4, 6], bodyTex: 'pig_skin', headTex: 'pig_skin', face: 'pig_face', legTex: 'pig_skin', headIn: 2 }),
    cow: () => quadruped({
      body: [12, 10, 18, 12], head: [8, 8, 6, 16], leg: [4, 12], bodyTex: 'cow_hide', headTex: 'cow_hide', face: 'cow_face', legTex: 'cow_hide',
      extraHead: [box([-6, 22, -14], [-4, 25, -12], 'horn'), box([4, 22, -14], [6, 25, -12], 'horn')],
    }),
    sheep: () => quadruped({ body: [10, 10, 16, 12], head: [6, 7, 8, 16], leg: [4, 12], bodyTex: 'sheep_wool', headTex: 'sheep_wool', face: 'sheep_face', legTex: 'sheep_skin', headIn: 2 }),
    sheep_sheared: () => quadruped({ body: [8, 8, 14, 13], head: [6, 7, 8, 16], leg: [4, 13], bodyTex: 'sheep_skin', headTex: 'sheep_skin', face: 'sheep_face', legTex: 'sheep_skin', headIn: 2 }),
    goat: () => quadruped({
      body: [9, 10, 16, 10], head: [5, 7, 8, 15], leg: [3, 10], bodyTex: 'goat_fur', headTex: 'goat_fur', face: 'goat_face', legTex: 'goat_fur', headIn: 2,
      extraHead: [box([-3, 22, -12], [-2, 27, -10], 'horn'), box([2, 22, -12], [3, 27, -10], 'horn'), box([-1, 13, -17], [1, 16, -16], 'goat_fur')],
    }),
    chicken: () => ({
      parts: [
        { name: 'body', pivot: [0, 5, 0], boxes: [box([-3, 4, -4], [3, 10, 4], 'chicken_body')] },
        { name: 'head', pivot: [0, 9, -4], boxes: [box([-2, 9, -7], [2, 15, -4], faces('chicken_body', 'chicken_face')), box([-2, 11, -9], [2, 13, -7], 'chicken_beak'), box([-1, 9, -8], [1, 11, -7], 'chicken_wattle')] },
        { name: 'legR', pivot: [1.5, 5, 0], boxes: [box([1, 0, 0], [2, 5, 1], 'chicken_leg')] },
        { name: 'legL', pivot: [-1.5, 5, 0], boxes: [box([-2, 0, 0], [-1, 5, 1], 'chicken_leg')] },
        { name: 'wingR', pivot: [3, 9, 0], boxes: [box([3, 5, -3], [4, 9, 3], 'chicken_body')] },
        { name: 'wingL', pivot: [-3, 9, 0], boxes: [box([-4, 5, -3], [-3, 9, 3], 'chicken_body')] },
      ],
    }),
    axolotl: () => ({
      parts: [
        { name: 'body', pivot: [0, 2, 0], boxes: [box([-4, 0, -5], [4, 4, 5], 'axolotl_body')] },
        { name: 'head', pivot: [0, 2, -5], boxes: [box([-4, 0, -10], [4, 5, -5], faces('axolotl_body', 'axolotl_face')), box([-6, 2, -8], [-4, 7, -7], 'axolotl_gills'), box([4, 2, -8], [6, 7, -7], 'axolotl_gills'), box([-4, 5, -8], [4, 7, -7], 'axolotl_gills')] },
        { name: 'tail', pivot: [0, 2, 5], boxes: [box([-0.5, 0, 5], [0.5, 4, 13], 'axolotl_gills')] },
        { name: 'legFR', pivot: [4, 1, -3], boxes: [box([4, 0, -4], [7, 1, -2], 'axolotl_body')] },
        { name: 'legFL', pivot: [-4, 1, -3], boxes: [box([-7, 0, -4], [-4, 1, -2], 'axolotl_body')] },
        { name: 'legBR', pivot: [4, 1, 3], boxes: [box([4, 0, 2], [7, 1, 4], 'axolotl_body')] },
        { name: 'legBL', pivot: [-4, 1, 3], boxes: [box([-7, 0, 2], [-4, 1, 4], 'axolotl_body')] },
      ],
    }),
    glow_squid: () => {
      const parts = [{ name: 'body', pivot: [0, 8, 0], boxes: [box([-6, 6, -6], [6, 22, 6], faces('glow_squid_body', 'glow_squid_face'))] }];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, x = Math.cos(a) * 5, z = Math.sin(a) * 5;
        parts.push({ name: 't' + i, pivot: [x, 6, z], boxes: [box([x - 1, -8, z - 1], [x + 1, 6, z + 1], 'glow_squid_body')] });
      }
      return { parts };
    },
    arrow: () => ({ parts: [{ name: 'a', pivot: [0, 0, 0], boxes: [box([-0.5, -0.5, -8], [0.5, 0.5, 8], 'arrow_tex'), box([-1.5, -0.5, 4], [1.5, 0.5, 8], 'arrow_tex')] }] }),
  };
  MC.playerModel = (shirt) => humanoid({ head: 'player_head', face: 'player_face', hair: 'player_hair', back: 'player_back', body: `player_shirt_${shirt}`, arm: `player_sleeve_${shirt}`, leg: 'player_pants' });

  // A small cube showing a block, for dropped items, falling blocks and TNT.
  function blockModelDef(v, size = 8) {
    const t = [];
    for (let f = 0; f < 6; f++) t.push(T(MC.faceTexName(v, f)));
    const h = size / 2;
    return { parts: [{ name: 'b', pivot: [0, 0, 0], boxes: [{ from: [-h, 0, -h], to: [h, size, h], tex: t }] }] };
  }
  MC.blockModelDef = blockModelDef;
  const CUBE_SHAPES = new Set(['cube', 'leaves', 'glass', 'tglass', 'slab', 'stairs', 'chest', 'cactus', 'cake', 'bed', 'wall', 'fence', 'gate', 'layer', 'carpet', 'liquid']);
  function itemModel(r, id) {
    const it = MC.ITEMS[id];
    const b = it && it.block ? MC.blockByKey(it.block) : null;
    if (b && CUBE_SHAPES.has(b.shape)) return r.model('blk:' + b.key, () => blockModelDef(b.id, 8));
    return r.iconModel(id);
  }
  MC.itemModel = itemModel;

  // ---------------- entity manager ----------------
  class Entities {
    constructor(game) {
      this.game = game;
      this.map = new Map();
      this.particles = [];
      this.spawnTimer = 0;
      this.mergeTimer = 0;
    }
    get world() { return this.game.world; }

    add(e) {
      if (!e.id) e.id = nextId++;
      e.vx = e.vx || 0; e.vy = e.vy || 0; e.vz = e.vz || 0;
      e.yaw = e.yaw || 0; e.pitch = e.pitch || 0; e.age = 0;
      e.onGround = false;
      this.map.set(e.id, e);
      return e;
    }
    remove(e) { this.map.delete(e.id); e.dead = true; }
    clear() { this.map.clear(); this.particles.length = 0; }

    spawnItem(stack, x, y, z, vx, vy, vz, delay = 0.5) {
      if (!stack || stack.n <= 0) return null;
      if (!this.game.isHost) { this.game.net.send({ t: 'drop', s: stack, p: [x, y, z], v: [vx || 0, vy || 0, vz || 0] }); return null; }
      return this.add({ type: 'item', x, y, z, vx: vx != null ? vx : rnd(-1.5, 1.5), vy: vy != null ? vy : 3, vz: vz != null ? vz : rnd(-1.5, 1.5), w: 0.25, h: 0.25, stack: Inv.clone(stack), delay, spin: Math.random() * 6 });
    }
    spawnXP(x, y, z, amount) {
      if (!this.game.isHost) { if (amount > 0) this.game.net.send({ t: 'spawnxp', p: [x, y, z], v: amount }); return; }
      while (amount > 0) {
        const v = Math.min(amount, amount >= 17 ? 17 : amount >= 7 ? 7 : amount >= 3 ? 3 : 1);
        amount -= v;
        this.add({ type: 'xp', x, y, z, vx: rnd(-1.5, 1.5), vy: rnd(2, 4), vz: rnd(-1.5, 1.5), w: 0.25, h: 0.25, value: v, delay: 0.3 });
      }
    }
    spawnMob(kind, x, y, z, opts = {}) {
      const d = MOBS[kind];
      const e = this.add({ type: 'mob', kind, x, y, z, w: d.w, h: d.h, hp: d.hp, yaw: Math.random() * 6.28, walk: 0, hurt: 0, ai: { t: 0, dx: 0, dz: 0 }, attackCd: 0, fuse: 0, ...opts });
      if (kind === 'axolotl' && e.variant == null) e.variant = Math.random() < 0.002 ? 4 : irnd(0, 3);
      if (kind === 'sheep' && !e.color) { const r = Math.random(); e.color = r < 0.82 ? 'white' : r < 0.87 ? 'light_gray' : r < 0.92 ? 'gray' : r < 0.97 ? 'black' : r < 0.995 ? 'brown' : 'pink'; }
      if (kind === 'chicken') e.eggTimer = rnd(300, 600);
      if (e.baby) { e.w *= 0.5; e.h *= 0.5; e.grow = 600; }
      return e;
    }
    spawnFalling(v, x, y, z) { return this.add({ type: 'falling', v, x: x + 0.5, y, z: z + 0.5, w: 0.98, h: 0.98 }); }
    spawnTNT(x, y, z, fuse = 4) { return this.add({ type: 'tnt', x: x + 0.5, y, z: z + 0.5, w: 0.98, h: 0.98, fuse, vy: 2, vx: rnd(-0.4, 0.4), vz: rnd(-0.4, 0.4) }); }
    spawnArrow(x, y, z, vx, vy, vz, owner, dmg = 2) { return this.add({ type: 'arrow', x, y, z, vx, vy, vz, w: 0.2, h: 0.2, owner, dmg, stuck: false }); }

    count(test) { let n = 0; for (const e of this.map.values()) if (test(e)) n++; return n; }

    // ---------------- simulation (host) ----------------
    update(dt) {
      const g = this.game;
      if (g.isHost) {
        for (const e of [...this.map.values()]) {
          if (e.dead) continue;
          e.age += dt;
          if (!this.world.loaded(e.x, e.z)) continue; // freeze in unloaded chunks
          switch (e.type) {
            case 'item': this.updateItem(e, dt); break;
            case 'xp': this.updateXP(e, dt); break;
            case 'mob': this.updateMob(e, dt); break;
            case 'falling': this.updateFalling(e, dt); break;
            case 'tnt': this.updateTNT(e, dt); break;
            case 'arrow': this.updateArrow(e, dt); break;
          }
        }
        this.mergeTimer -= dt;
        if (this.mergeTimer < 0) { this.mergeTimer = 0.5; this.mergeItems(); }
        this.spawnTimer -= dt;
        if (this.spawnTimer < 0) { this.spawnTimer = 0.6; this.naturalSpawn(); }
      } else {
        // guests smooth toward the latest snapshot
        const k = Math.min(1, dt * 12);
        for (const e of this.map.values()) {
          if (e.tx == null) continue;
          e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.z += (e.tz - e.z) * k;
          let dy = e.tyaw - e.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          e.yaw += dy * k;
          const mv = Math.hypot(e.tx - e.x, e.tz - e.z);
          e.walk += mv * 4 * dt * 10;
          e.moving = mv > 0.02;
          if (e.hurt > 0) e.hurt -= dt;
          e.age += dt;
          if (e.spin != null) e.spin += dt * 2;
        }
      }
      // particles are local everywhere
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.vy -= (p.grav != null ? p.grav : 14) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const bd = this.world.def(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        if (bd && bd.solid && bd.full) { p.y = Math.floor(p.y) + 1.01; p.vy = 0; p.vx *= 0.5; p.vz *= 0.5; }
      }
    }

    physics(e, dt, grav = 32, drag = 0.98) {
      const w = this.world;
      const t = w.touching(e.x - e.w / 2, e.y, e.z - e.w / 2, e.x + e.w / 2, e.y + e.h, e.z + e.w / 2);
      e.inWater = t.water; e.inLava = t.lava;
      if (t.water) {
        e.vy += (e.buoyant ? 10 : -4) * dt;
        e.vy *= Math.pow(0.15, dt);
        e.vx *= Math.pow(0.3, dt); e.vz *= Math.pow(0.3, dt);
      } else e.vy -= grav * dt;
      if (e.vy < -60) e.vy = -60;
      if (t.web) { e.vx *= 0.2; e.vz *= 0.2; e.vy *= 0.2; }
      sweep(w, e, e.vx * dt, e.vy * dt, e.vz * dt);
      if (e.onGround) { const f = Math.pow(0.002, dt); e.vx *= f; e.vz *= f; }
      else { const f = Math.pow(drag, dt * 20); e.vx *= f; e.vz *= f; }
      if (e.y < MC.MIN_Y - 40) this.remove(e);
      return t;
    }

    updateItem(e, dt) {
      e.buoyant = true;
      this.physics(e, dt, 16);
      e.spin += dt * 2;
      if (e.delay > 0) e.delay -= dt;
      if (e.inLava && e.stack.id !== 'netherite_ingot') { this.remove(e); this.game.audio.play('fizz', e); return; }
      if (e.age > 300) { this.remove(e); return; }
      if (e.delay > 0) return;
      for (const p of this.game.allPlayers()) {
        if (p.dead || p.mode === 'spectator') continue;
        if (Math.abs(p.x - e.x) < 1.3 && Math.abs(p.z - e.z) < 1.3 && e.y > p.y - 0.8 && e.y < p.y + 2.2) {
          if (this.game.givePlayer(p, e.stack)) { this.remove(e); break; }
        }
      }
    }

    updateXP(e, dt) {
      this.physics(e, dt, 10);
      if (e.delay > 0) { e.delay -= dt; return; }
      if (e.age > 300) { this.remove(e); return; }
      let best = null, bd = 8 * 8;
      for (const p of this.game.allPlayers()) {
        if (p.dead || p.mode !== 'survival') continue;
        const d = (p.x - e.x) ** 2 + (p.y + 0.8 - e.y) ** 2 + (p.z - e.z) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) {
        const d = Math.sqrt(bd);
        if (d < 1) { this.game.giveXP(best, e.value); this.remove(e); return; }
        const k = (1 - d / 8) ** 2 * 30 * dt;
        e.vx += ((best.x - e.x) / d) * k; e.vy += ((best.y + 0.8 - e.y) / d) * k; e.vz += ((best.z - e.z) / d) * k;
      }
    }

    updateFalling(e, dt) {
      this.physics(e, dt, 32, 1);
      if (e.onGround || e.age > 30) {
        const x = Math.floor(e.x), y = Math.floor(e.y + 0.5), z = Math.floor(e.z);
        this.remove(e);
        const here = this.world.def(x, y, z);
        if (here && (here.replaceable || here.id === 0)) this.game.setBlock(x, y, z, e.v, { fromFall: true });
        else this.spawnItem(Inv.make(BLOCKS[e.v & MC.ID_MASK].key, 1), e.x, e.y + 0.5, e.z);
      }
    }

    updateTNT(e, dt) {
      this.physics(e, dt, 24);
      e.fuse -= dt;
      if (e.fuse <= 0) { this.remove(e); this.explode(e.x, e.y + 0.5, e.z, 4); }
    }

    updateArrow(e, dt) {
      if (e.stuck) {
        if (e.age > 60) this.remove(e);
        // pick up stuck arrows shot by players
        if (e.owner !== 'mob') for (const p of this.game.allPlayers()) {
          if (Math.abs(p.x - e.x) < 1 && Math.abs(p.z - e.z) < 1 && Math.abs(p.y + 0.5 - e.y) < 1.5) {
            if (p.mode !== 'creative' && this.game.givePlayer(p, Inv.make('arrow', 1))) this.remove(e);
            else if (p.mode === 'creative') this.remove(e);
            break;
          }
        }
        return;
      }
      e.vy -= 20 * dt;
      const sp = Math.hypot(e.vx, e.vy, e.vz);
      e.yaw = Math.atan2(-e.vx, -e.vz);
      e.pitch = Math.atan2(e.vy, Math.hypot(e.vx, e.vz));
      // hit entities along the path
      const steps = Math.ceil(sp * dt / 0.25);
      for (let s = 0; s < steps; s++) {
        const nx = e.x + (e.vx * dt) / steps, ny = e.y + (e.vy * dt) / steps, nz = e.z + (e.vz * dt) / steps;
        const v = this.world.get(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (v !== 0 && v !== -1) {
          const bd = BLOCKS[v & MC.ID_MASK];
          if (bd.solid) { e.stuck = true; e.age = 0; this.game.audio.play('arrowhit', e); return; }
        }
        e.x = nx; e.y = ny; e.z = nz;
        if (e.age < 0.05 && e.owner !== 'mob') continue;
        for (const m of this.map.values()) {
          if (m.type !== 'mob' || m.dead || m.dying) continue;
          if (Math.abs(m.x - e.x) < m.w / 2 + 0.1 && Math.abs(m.z - e.z) < m.w / 2 + 0.1 && e.y > m.y && e.y < m.y + m.h) {
            this.hurtMob(m, Math.ceil(sp / 25 * e.dmg * 3), e.vx, e.vz, e.owner);
            this.remove(e);
            return;
          }
        }
        if (e.owner === 'mob' || e.age > 0.1) for (const p of this.game.allPlayers()) {
          if (p.dead || p.id === e.owner) continue;
          if (Math.abs(p.x - e.x) < 0.4 && Math.abs(p.z - e.z) < 0.4 && e.y > p.y && e.y < p.y + 1.8) {
            this.game.hurtPlayer(p, Math.ceil(sp / 25 * e.dmg * 2), { kx: e.vx, kz: e.vz, cause: 'arrow' });
            this.remove(e);
            return;
          }
        }
      }
      if (e.age > 30) this.remove(e);
    }

    mergeItems() {
      const items = [...this.map.values()].filter((e) => e.type === 'item' && !e.dead);
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (a.dead) continue;
        for (let j = i + 1; j < items.length; j++) {
          const b = items[j];
          if (b.dead || !Inv.same(a.stack, b.stack)) continue;
          if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 0.6 || Math.abs(a.z - b.z) > 1) continue;
          const max = Inv.max(a.stack.id);
          if (a.stack.n + b.stack.n > max) continue;
          a.stack.n += b.stack.n;
          this.remove(b);
        }
      }
    }

    // ---------------- mobs ----------------
    updateMob(e, dt) {
      const d = MOBS[e.kind];
      const g = this.game;
      if (e.hurt > 0) e.hurt -= dt;
      if (e.attackCd > 0) e.attackCd -= dt;
      if (e.dying) {
        e.dying += dt;
        if (e.dying > 0.8) { this.remove(e); this.deathPuff(e); }
        return;
      }
      if (e.grow != null) { e.grow -= dt; if (e.grow <= 0) { e.grow = null; e.baby = false; e.w = d.w; e.h = d.h; } }
      if (e.love > 0) e.love -= dt;
      // despawn hostile mobs far from everyone
      const players = g.allPlayers().filter((p) => !p.dead);
      let near = null, nd = Infinity;
      for (const p of players) {
        const dd = (p.x - e.x) ** 2 + (p.y - e.y) ** 2 + (p.z - e.z) ** 2;
        if (dd < nd) { nd = dd; near = p; }
      }
      nd = Math.sqrt(nd);
      if ((d.hostile || d.aquatic) && !e.persistent && (nd > 128 || (nd > 40 && Math.random() < dt / 30))) { this.remove(e); return; }
      if (d.hostile && g.difficulty === 0) { this.remove(e); return; }

      const day = g.isDay();
      const light = this.world.light(Math.floor(e.x), Math.floor(e.y + e.h * 0.8), Math.floor(e.z));
      // undead burn in sunlight
      if (d.burns && day && light.sky >= 15 * 0.9 && !e.inWater) {
        e.burnT = (e.burnT || 0) + dt;
        if (e.burnT > 1) { e.burnT = 0; this.hurtMob(e, 1, 0, 0, null, true); }
        e.onFire = 0.5;
      }
      if (e.onFire > 0) e.onFire -= dt;
      if (e.inLava) { e.lavaT = (e.lavaT || 0) + dt; if (e.lavaT > 0.5) { e.lavaT = 0; this.hurtMob(e, 4, 0, 0, null, true); } }

      // decide where to go
      let tx = null, tz = null, speed = d.speed, wantJump = false;
      const ai = e.ai;
      ai.t -= dt;
      let target = null;
      if (d.hostile && !(d.dayNeutral && day && !e.angry)) {
        for (const p of players) {
          if (p.mode !== 'survival') continue;
          const dd = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
          if (dd < 16 && (!target || dd < target.d)) target = { p, d: dd };
        }
      }
      if (e.fleeT > 0) { e.fleeT -= dt; speed *= 1.6; }
      if (target) {
        const p = target.p;
        e.target = p.id;
        const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
        if (d.ranged) {
          // keep some distance and shoot
          if (dist > 10) { tx = dx; tz = dz; } else if (dist < 6) { tx = -dx; tz = -dz; }
          e.lookYaw = Math.atan2(-dx, -dz);
          if (e.attackCd <= 0 && dist < 15) {
            e.attackCd = g.difficulty >= 3 ? 1.2 : 2;
            const sy = e.y + 1.5, ty = p.y + 1.2;
            const flight = dist / 22;
            const vx = dx / flight, vz = dz / flight, vy = (ty - sy) / flight + 10 * flight;
            this.spawnArrow(e.x + (dx / dist) * 0.6, sy, e.z + (dz / dist) * 0.6, vx + rnd(-1, 1), vy + rnd(-0.5, 0.5), vz + rnd(-1, 1), 'mob', d.dmg);
            g.audio.play('bow', e);
          }
        } else if (d.explodes) {
          tx = dx; tz = dz;
          if (Math.hypot(dx, p.y - e.y, dz) < 3) { if (!e.fuse) g.audio.play('fuse', e); e.fuse += dt; tx = tz = null; }
          else e.fuse = Math.max(0, e.fuse - dt);
          if (e.fuse >= 1.5) { this.remove(e); this.explode(e.x, e.y + 0.8, e.z, 3); return; }
        } else {
          tx = dx; tz = dz;
          const reach = e.w / 2 + 0.9;
          if (dist < reach && Math.abs(p.y - e.y) < 1.6 && e.attackCd <= 0) {
            e.attackCd = 1;
            e.swing = 0.3;
            const dmg = d.dmg * [0, 0.7, 1, 1.5][g.difficulty];
            g.hurtPlayer(p, Math.max(1, Math.round(dmg)), { kx: dx / dist * 6, kz: dz / dist * 6, cause: e.kind });
          }
        }
      } else {
        e.target = null;
        if (e.fuse > 0) e.fuse = Math.max(0, e.fuse - dt);
        // passive mobs follow food in hand
        if (d.food) {
          for (const p of players) {
            if (p.held && d.food.includes(p.held) && Math.hypot(p.x - e.x, p.z - e.z) < 8) { tx = p.x - e.x; tz = p.z - e.z; speed *= 0.9; if (Math.hypot(tx, tz) < 2) tx = tz = null; e.lookYaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); break; }
          }
          // find a partner when in love
          if (e.love > 0 && tx == null) {
            for (const o of this.map.values()) {
              if (o === e || o.kind !== e.kind || !(o.love > 0) || o.dead) continue;
              const dd = Math.hypot(o.x - e.x, o.z - e.z);
              if (dd < 8) {
                tx = o.x - e.x; tz = o.z - e.z;
                if (dd < 1.5) { e.love = o.love = 0; e.breedCd = o.breedCd = 300; this.spawnMob(e.kind, (e.x + o.x) / 2, e.y, (e.z + o.z) / 2, { baby: true, persistent: true }); this.hearts(e); g.entitiesChanged = true; this.spawnXP(e.x, e.y + 0.5, e.z, irnd(1, 7)); }
                break;
              }
            }
          }
        }
        if (tx == null && !d.aquatic) {
          if (ai.t <= 0) {
            ai.t = rnd(2, 7);
            if (Math.random() < 0.55 || e.fleeT > 0) { const a = Math.random() * Math.PI * 2; ai.dx = Math.cos(a); ai.dz = Math.sin(a); }
            else ai.dx = ai.dz = 0;
          }
          if (ai.dx || ai.dz) { tx = ai.dx; tz = ai.dz; speed *= e.fleeT > 0 ? 1 : 0.45; }
        }
      }
      if (e.fleeT > 0 && e.fleeFrom) { tx = e.x - e.fleeFrom.x; tz = e.z - e.fleeFrom.z; }

      // chickens lay eggs, sheep regrow wool on grass
      if (e.kind === 'chicken' && !e.baby) { e.eggTimer -= dt; if (e.eggTimer <= 0) { e.eggTimer = rnd(300, 600); this.spawnItem(Inv.make('egg', 1), e.x, e.y + 0.3, e.z, 0, 1, 0); } }
      if (e.kind === 'sheep' && e.sheared && Math.random() < dt / 40) {
        const bx = Math.floor(e.x), by = Math.floor(e.y - 0.1), bz = Math.floor(e.z);
        if (this.world.id(bx, by, bz) === B.grass_block) { e.sheared = false; g.setBlock(bx, by, bz, B.dirt); }
      }
      // goats occasionally leap
      if (d.jumpy && e.onGround && Math.random() < dt / 12) { e.vy = 11; const a = Math.random() * 6.28; e.vx = Math.cos(a) * 3; e.vz = Math.sin(a) * 3; }

      if (d.aquatic) { this.swim(e, d, dt, near); return; }

      // steer
      let mx = 0, mz = 0;
      if (tx != null) {
        const l = Math.hypot(tx, tz) || 1;
        mx = tx / l; mz = tz / l;
        // passive mobs avoid walking off cliffs
        if (!d.hostile && e.onGround) {
          const ax = Math.floor(e.x + mx * 0.9), az = Math.floor(e.z + mz * 0.9);
          let drop = 0;
          for (let y = Math.floor(e.y) - 1; y > Math.floor(e.y) - 5; y--) { const bd = this.world.def(ax, y, az); if (bd && (bd.solid || bd.liquid)) break; drop++; }
          if (drop >= 4) { mx = mz = 0; ai.t = 0; }
        }
        e.yawTarget = Math.atan2(-mx, -mz);
      }
      const k = Math.min(1, (e.onGround ? 12 : e.inWater ? 4 : 2) * dt);
      e.vx += (mx * speed - e.vx) * k;
      e.vz += (mz * speed - e.vz) * k;
      if ((mx || mz) && e.hitWall && e.onGround) wantJump = true;
      if (wantJump) e.vy = d.jumpy ? 10 : 8.6;
      if (d.climbs && e.hitWall && (mx || mz)) e.vy = 3;
      if (e.inWater && !d.aquatic) e.buoyant = true;
      const yt = e.lookYaw != null && !mx && !mz ? e.lookYaw : e.yawTarget;
      e.lookYaw = null;
      if (yt != null) {
        let dy = yt - e.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        e.yaw += dy * Math.min(1, dt * 8);
      }
      const fallStart = e.y;
      this.physics(e, dt, d.flutter && e.vy < 0 ? 12 : 32, 0.99);
      if (d.flutter && e.vy < -3) e.vy = -3;
      if (!e.onGround && e.y < fallStart) e.fall = (e.fall || 0) + fallStart - e.y;
      if (e.onGround) { if (e.fall > 3.5 && !d.flutter) this.hurtMob(e, Math.floor(e.fall - 3), 0, 0, null, true); e.fall = 0; }
      if (e.inWater) e.fall = 0;
      const hs = Math.hypot(e.vx, e.vz);
      e.walk += hs * dt * 3.2;
      e.moving = hs > 0.3;
      if (e.swing > 0) e.swing -= dt;
      if (Math.random() < dt / 9 && nd < 20) g.audio.play(d.sound, e, 0.6);
    }

    swim(e, d, dt, near) {
      const ai = e.ai;
      const w = this.world;
      const t = w.touching(e.x - e.w / 2, e.y, e.z - e.w / 2, e.x + e.w / 2, e.y + e.h, e.z + e.w / 2);
      e.inWater = t.water;
      if (e.inWater) {
        e.dry = 0;
        if (ai.t <= 0) {
          ai.t = rnd(1.5, 4);
          const a = Math.random() * Math.PI * 2;
          ai.dx = Math.cos(a); ai.dz = Math.sin(a); ai.dy = rnd(-0.6, 0.6);
        }
        // don't swim out of the water
        const nb = w.def(Math.floor(e.x + ai.dx), Math.floor(e.y + e.h / 2 + ai.dy), Math.floor(e.z + ai.dz));
        if (!nb || nb.liquid !== 'water') { ai.dx = -ai.dx; ai.dz = -ai.dz; ai.dy = -ai.dy; }
        const k = Math.min(1, 3 * dt);
        e.vx += (ai.dx * d.speed - e.vx) * k; e.vz += (ai.dz * d.speed - e.vz) * k; e.vy += (ai.dy * d.speed * 0.6 - e.vy) * k;
        e.yawTarget = Math.atan2(-e.vx, -e.vz);
        let dy = e.yawTarget - e.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        e.yaw += dy * Math.min(1, dt * 4);
        sweep(w, e, e.vx * dt, e.vy * dt, e.vz * dt);
        e.walk += dt * 6;
        e.moving = true;
      } else {
        // flop around on land, slowly drying out
        e.dry = (e.dry || 0) + dt;
        if (e.onGround && Math.random() < dt * 2) { e.vy = 5; e.vx = rnd(-2, 2); e.vz = rnd(-2, 2); }
        e.vy -= 32 * dt;
        sweep(w, e, e.vx * dt, e.vy * dt, e.vz * dt);
        if (e.onGround) { e.vx *= 0.8; e.vz *= 0.8; }
        if (e.dry > (e.kind === 'axolotl' ? 300 : 20)) { e.dry = 0; this.hurtMob(e, 2, 0, 0, null, true); }
      }
      if (Math.random() < dt / 15 && near && Math.hypot(near.x - e.x, near.z - e.z) < 16) this.game.audio.play(d.sound, e, 0.4);
    }

    hurtMob(e, dmg, kx, kz, byPlayer, silent) {
      if (!this.game.isHost) { this.game.net.send({ t: 'hit', id: e.id, dmg, kx, kz }); e.hurt = 0.4; return; }
      if (e.dead || e.dying || e.invuln > e.age) return;
      e.invuln = e.age + 0.45;
      e.hp -= dmg;
      e.hurt = 0.4;
      const d = MOBS[e.kind];
      if (kx || kz) {
        const l = Math.hypot(kx, kz) || 1;
        e.vx = (kx / l) * 6; e.vz = (kz / l) * 6; e.vy = 5;
      }
      if (byPlayer) {
        e.angry = true;
        if (!d.hostile) { e.fleeT = 4; e.fleeFrom = { x: e.x - (kx || 0), z: e.z - (kz || 0) }; }
      }
      if (!silent || dmg > 0) this.game.audio.play(d.sound, e, 0.8);
      if (e.hp <= 0) {
        e.dying = 0.001;
        if (!e.baby) {
          for (const [k, a, b] of d.drops) {
            const n = irnd(a, b);
            if (n > 0) this.spawnItem(Inv.make(e.onFire > 0 && d.cooked && k === d.drops[0][0] ? d.cooked : k, n), e.x, e.y + 0.5, e.z);
          }
          for (const [k, p] of d.rare || []) if (Math.random() < p) this.spawnItem(Inv.make(k, 1), e.x, e.y + 0.5, e.z);
          if (e.kind === 'sheep' && !e.sheared) this.spawnItem(Inv.make(`${e.color || 'white'}_wool`, 1), e.x, e.y + 0.5, e.z);
          if (byPlayer) this.spawnXP(e.x, e.y + 0.5, e.z, d.hostile ? d.xp : irnd(1, 3));
        }
      }
    }

    // Right-click on a mob with an item (shearing, milking, feeding, bucketing).
    interact(e, held, player) {
      const d = MOBS[e.kind];
      const g = this.game;
      const id = held && held.id;
      if (e.kind === 'sheep' && id === 'shears' && !e.sheared && !e.baby) {
        e.sheared = true;
        this.spawnItem(Inv.make(`${e.color || 'white'}_wool`, irnd(1, 3)), e.x, e.y + 1, e.z);
        g.audio.play('sheep', e);
        return { damageTool: 1 };
      }
      if (e.kind === 'sheep' && id && id.endsWith('_dye') && !e.sheared) {
        const c = id.slice(0, -4);
        if (c !== e.color) { e.color = c; return { consume: 1 }; }
      }
      if (e.kind === 'cow' && id === 'bucket' && !e.baby) { g.audio.play('cow', e); return { replace: 'milk_bucket' }; }
      if (e.kind === 'axolotl' && id === 'water_bucket') { this.remove(e); return { replace: 'axolotl_bucket' }; }
      if (d.food && id && d.food.includes(id)) {
        if (e.baby) { e.grow = Math.max(0, (e.grow || 0) - 60); this.hearts(e); return { consume: 1 }; }
        if (!(e.breedCd > 0) && !(e.love > 0)) { e.love = 30; this.hearts(e); return { consume: 1 }; }
      }
      return null;
    }

    hearts(e) { for (let i = 0; i < 5; i++) this.particle(e.x + rnd(-0.4, 0.4), e.y + e.h + rnd(0, 0.4), e.z + rnd(-0.4, 0.4), T('red_wool'), { vy: 1, grav: -1, life: 1, size: 0.6 }); }
    deathPuff(e) { for (let i = 0; i < 12; i++) this.particle(e.x + rnd(-0.4, 0.4), e.y + rnd(0, e.h), e.z + rnd(-0.4, 0.4), T('white_wool'), { vx: rnd(-1, 1), vy: rnd(0.5, 2), vz: rnd(-1, 1), grav: 0, life: 0.6 }); }

    // ---------------- explosions ----------------
    explode(x, y, z, power) {
      const g = this.game;
      g.audio.play('explode', { x, y, z }, 1.2);
      g.net && g.net.broadcast && g.net.broadcast({ t: 'boom', p: [x, y, z], r: power });
      this.boomParticles(x, y, z, power);
      if (!g.isHost) return;
      const r = power * 1.1;
      const changes = [];
      if (!g.noGrief) {
        for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          const d = Math.hypot(dx, dy, dz);
          if (d > r * (0.7 + Math.random() * 0.4)) continue;
          const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz);
          const v = this.world.get(bx, by, bz);
          if (v <= 0) continue;
          const b = BLOCKS[v & MC.ID_MASK];
          if (b.hardness < 0 || b.hardness >= 30 || b.liquid) continue;
          if (b.key === 'tnt') { g.setBlock(bx, by, bz, 0); this.spawnTNT(bx, by, bz, rnd(0.5, 1.5)); continue; }
          changes.push([bx, by, bz, v]);
        }
      }
      for (const [bx, by, bz, v] of changes) {
        g.setBlock(bx, by, bz, 0, { noUpdate: true });
        if (Math.random() < 1 / power) for (const st of g.blockDrops(v, null)) this.spawnItem(st, bx + 0.5, by + 0.5, bz + 0.5);
      }
      for (const [bx, by, bz] of changes) g.neighborUpdate(bx, by, bz);
      // damage and push entities and players
      const reach = power * 2;
      for (const e of this.map.values()) {
        const d = Math.hypot(e.x - x, e.y + e.h / 2 - y, e.z - z);
        if (d > reach) continue;
        const imp = 1 - d / reach;
        const l = d || 1;
        e.vx += ((e.x - x) / l) * imp * 14; e.vy += ((e.y - y) / l) * imp * 10 + imp * 4; e.vz += ((e.z - z) / l) * imp * 14;
        if (e.type === 'mob') this.hurtMob(e, Math.floor((imp * imp + imp) / 2 * 7 * reach + 1), 0, 0, null);
        if (e.type === 'item' && imp > 0.5) this.remove(e);
      }
      for (const p of g.allPlayers()) {
        const d = Math.hypot(p.x - x, p.y + 0.9 - y, p.z - z);
        if (d > reach) continue;
        const imp = 1 - d / reach;
        const dmg = Math.floor((imp * imp + imp) / 2 * 7 * reach + 1) * [0, 0.5, 1, 1.5][g.difficulty || 0];
        g.hurtPlayer(p, Math.max(dmg, 0), { kx: (p.x - x) / (d || 1) * imp * 16, kz: (p.z - z) / (d || 1) * imp * 16, ky: imp * 8, cause: 'explosion' });
      }
    }
    boomParticles(x, y, z, power) {
      for (let i = 0; i < 30; i++) this.particle(x + rnd(-power, power) * 0.5, y + rnd(-power, power) * 0.5, z + rnd(-power, power) * 0.5, T(Math.random() < 0.5 ? 'gray_wool' : 'light_gray_wool'), { vx: rnd(-3, 3), vy: rnd(-1, 3), vz: rnd(-3, 3), grav: -0.5, life: rnd(0.6, 1.4), size: rnd(1.5, 3) });
    }

    // ---------------- natural spawning (host) ----------------
    naturalSpawn() {
      const g = this.game;
      const players = g.allPlayers().filter((p) => !p.dead);
      if (!players.length) return;
      const counts = { hostile: 0, passive: 0, water: 0 };
      for (const e of this.map.values()) if (e.type === 'mob') counts[MOBS[e.kind].hostile ? 'hostile' : MOBS[e.kind].aquatic ? 'water' : 'passive']++;
      const p = players[Math.floor(Math.random() * players.length)];
      const cap = (n) => n * Math.max(1, players.length * 0.7);
      for (let attempt = 0; attempt < 4; attempt++) {
        const a = Math.random() * Math.PI * 2, dist = rnd(24, 56);
        const x = Math.floor(p.x + Math.cos(a) * dist), z = Math.floor(p.z + Math.sin(a) * dist);
        if (!this.world.loaded(x, z)) continue;
        // pick a random height between bedrock and the surface, near the player's level more often
        const top = this.world.surfaceY(x, z);
        const y0 = Math.random() < 0.5 ? top + 1 : Math.floor(rnd(Math.max(MC.MIN_Y + 1, p.y - 40), Math.min(top, p.y + 30)));
        const pos = this.findSpawn(x, y0, z);
        if (!pos) continue;
        const { y, ground, water } = pos;
        const L = this.world.light(x, y, z);
        const sky = Math.round(L.sky * g.skyFactor());
        const cb = this.world.caveBiomeAt(x, z);
        const biome = MC.BIOMES[this.world.biomeAt(x, z)];
        if (water) {
          if (counts.water >= cap(6)) continue;
          if (cb === MC.CAVE_BIOME.LUSH && y < 56 && ground === B.clay || (cb === MC.CAVE_BIOME.LUSH && y < 56)) { this.spawnGroup('axolotl', x, y, z, irnd(1, 3)); return; }
          if (y < 30 && L.sky === 0 && L.blk < 3) { this.spawnGroup('glow_squid', x, y, z, irnd(1, 3)); return; }
          continue;
        }
        if (g.difficulty > 0 && L.blk === 0 && sky <= 0 + (y > 50 && !g.isDay() ? 7 : 0) && counts.hostile < cap(16)) {
          if (Math.hypot(x - p.x, y - p.y, z - p.z) < 24) continue;
          const r = Math.random();
          const kind = r < 0.38 ? 'zombie' : r < 0.68 ? 'skeleton' : r < 0.86 ? 'creeper' : 'spider';
          if (kind === 'spider' && !this.fits(x, y, z, 1.4, 0.9)) continue;
          this.spawnMob(kind, x + 0.5, y, z + 0.5);
          return;
        }
        if (ground === B.grass_block && sky >= 9 && counts.passive < cap(10) && y > 50) {
          const r = Math.random();
          const mountain = /peaks|slopes|grove|meadow/.test(biome);
          const kind = mountain && r < 0.5 ? 'goat' : r < 0.3 ? 'sheep' : r < 0.55 ? 'cow' : r < 0.8 ? 'pig' : 'chicken';
          this.spawnGroup(kind, x, y, z, irnd(2, 4));
          return;
        }
        if ((ground === B.snow_block || ground === B.stone || ground === B.snow || ground === B.powder_snow) && /peaks|slopes|grove/.test(biome) && counts.passive < cap(10) && sky >= 9) {
          this.spawnGroup('goat', x, y, z, irnd(1, 3));
          return;
        }
      }
    }
    findSpawn(x, y0, z) {
      for (let y = y0; y > y0 - 12 && y > MC.MIN_Y; y--) {
        const here = this.world.def(x, y, z), above = this.world.def(x, y + 1, z), below = this.world.def(x, y - 1, z);
        if (!here || !above || !below) return null;
        if (here.liquid === 'water' && above.liquid === 'water') return { y, ground: this.world.id(x, y - 1, z), water: true };
        if (!here.solid && !here.liquid && !above.solid && !above.liquid && below.solid && below.full) return { y, ground: below.id, water: false };
      }
      return null;
    }
    fits(x, y, z, w, h) {
      const out = this.world.boxesIn(x + 0.5 - w / 2, y + 0.01, z + 0.5 - w / 2, x + 0.5 + w / 2, y + h, z + 0.5 + w / 2, scratch);
      return !out.some((b) => b[4] > y + 0.01);
    }
    spawnGroup(kind, x, y, z, n) {
      for (let i = 0; i < n; i++) {
        const ox = x + irnd(-2, 2), oz = z + irnd(-2, 2);
        const pos = this.findSpawn(ox, y + 2, oz);
        if (pos && pos.water === !!MOBS[kind].aquatic) this.spawnMob(kind, ox + 0.5, pos.y, oz + 0.5);
      }
    }

    // ---------------- particles ----------------
    particle(x, y, z, tile, o = {}) {
      if (this.particles.length > 400) return;
      this.particles.push({ x, y, z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 0.8, tile, size: o.size || 1, grav: o.grav });
    }
    blockParticles(x, y, z, v, n = 16) {
      const b = BLOCKS[v & MC.ID_MASK];
      if (!b || b.shape === 'none') return;
      const tile = T(MC.faceTexName(v, 4));
      for (let i = 0; i < n; i++) this.particle(x + Math.random(), y + Math.random(), z + Math.random(), tile, { vx: rnd(-1.5, 1.5), vy: rnd(0, 3), vz: rnd(-1.5, 1.5), life: rnd(0.4, 1) });
    }

    // ---------------- picking ----------------
    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      let best = null;
      for (const e of this.map.values()) {
        if (e.type !== 'mob' || e.dying) continue;
        const W = e.w / 2 + 0.1;
        const t = rayAABB(ox, oy, oz, dx, dy, dz, e.x - W, e.y, e.z - W, e.x + W, e.y + e.h + 0.1, e.z + W);
        if (t != null && t <= maxDist && (!best || t < best.t)) best = { e, t };
      }
      return best;
    }

    // ---------------- network snapshots ----------------
    snapshotFor(px, pz, radius = 96) {
      const out = [];
      for (const e of this.map.values()) {
        if (Math.abs(e.x - px) > radius || Math.abs(e.z - pz) > radius) continue;
        const base = [e.id, e.type, +e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2), +e.yaw.toFixed(2)];
        if (e.type === 'mob') base.push({ k: e.kind, h: e.hurt > 0 ? 1 : 0, f: +e.fuse.toFixed(2), s: e.sheared ? 1 : 0, c: e.color, v: e.variant, b: e.baby ? 1 : 0, d: e.dying ? 1 : 0, p: +(e.pitch || 0).toFixed(2), sw: e.swing > 0 ? 1 : 0, fi: e.onFire > 0 ? 1 : 0 });
        else if (e.type === 'item') base.push({ s: e.stack });
        else if (e.type === 'falling') base.push({ v: e.v });
        else if (e.type === 'tnt') base.push({ f: +e.fuse.toFixed(2) });
        else if (e.type === 'arrow') base.push({ p: +(e.pitch || 0).toFixed(2) });
        else base.push({});
        out.push(base);
      }
      return out;
    }
    applySnapshot(list) {
      const seen = new Set();
      for (const [id, type, x, y, z, yaw, o] of list) {
        seen.add(id);
        let e = this.map.get(id);
        if (!e || e.type !== type) {
          e = { id, type, x, y, z, yaw, vx: 0, vy: 0, vz: 0, walk: 0, age: 0, hurt: 0 };
          if (type === 'mob') { const d = MOBS[o.k]; e.w = d.w; e.h = d.h; }
          else { e.w = e.h = type === 'falling' || type === 'tnt' ? 0.98 : 0.25; }
          if (type === 'item' || type === 'xp') e.spin = Math.random() * 6;
          this.map.set(id, e);
        }
        e.tx = x; e.ty = y; e.tz = z; e.tyaw = yaw;
        if (type === 'mob') {
          e.kind = o.k; e.fuse = o.f; e.sheared = !!o.s; e.color = o.c; e.variant = o.v; e.baby = !!o.b; e.pitch = o.p; e.onFire = o.fi ? 0.2 : 0;
          if (o.h && !(e.hurt > 0)) e.hurt = 0.4;
          if (o.d && !e.dying) e.dying = 0.001;
          if (o.sw) e.swing = 0.3;
          const d = MOBS[o.k];
          e.w = d.w * (e.baby ? 0.5 : 1); e.h = d.h * (e.baby ? 0.5 : 1);
        } else if (type === 'item') e.stack = o.s;
        else if (type === 'falling') e.v = o.v;
        else if (type === 'tnt') e.fuse = o.f;
        else if (type === 'arrow') e.pitch = o.p;
      }
      for (const [id, e] of this.map) if (!seen.has(id)) { if (e.type === 'mob' && e.dying) this.deathPuff(e); this.map.delete(id); }
    }

    // ---------------- drawing ----------------
    render(r, time) {
      const w = this.world;
      for (const e of this.map.values()) {
        const L = w.light(Math.floor(e.x), Math.floor(e.y + 0.3), Math.floor(e.z));
        const lo = { sky: L.sky, blk: L.blk };
        if (e.type === 'item') {
          const m = itemModel(r, e.stack.id);
          const bob = Math.sin(e.age * 2 + e.spin) * 0.08 + 0.12;
          const isCube = !m.icons;
          const n = e.stack.n > 32 ? 3 : e.stack.n > 1 ? 2 : 1;
          for (let i = 0; i < n; i++) r.drawModel(m, e.x + i * 0.06, e.y + bob + i * 0.05, e.z + i * 0.04, e.spin + e.age * 1.5, { ...lo, scale: isCube ? 0.5 : 0.5 });
        } else if (e.type === 'xp') {
          const m = r.model('xp', () => blockModelDef(B.lime_concrete, 4));
          r.drawModel(m, e.x, e.y + 0.1 + Math.sin(e.age * 4) * 0.05, e.z, e.age * 3, { sky: 15, blk: 15, scale: 0.6, tint: [1.2, 1.3, 0.6] });
        } else if (e.type === 'falling') {
          const m = r.model('blkf:' + e.v, () => blockModelDef(e.v, 16));
          r.drawModel(m, e.x, e.y, e.z, 0, lo);
        } else if (e.type === 'tnt') {
          const m = r.model('blkf:' + B.tnt, () => blockModelDef(B.tnt, 16));
          const flash = Math.floor(e.fuse * 4) % 2 === 0;
          const s = e.fuse < 0.4 ? 1 + (0.4 - e.fuse) * 0.4 : 1;
          r.drawModel(m, e.x, e.y - (s - 1) / 2, e.z, 0, { ...lo, tint: flash ? [2.4, 2.4, 2.4] : null, scale: s });
        } else if (e.type === 'arrow') {
          const m = r.model('arrow', MODELS.arrow);
          r.drawModel(m, e.x, e.y, e.z, e.yaw, { ...lo, pitch: e.pitch, scale: 0.5 });
        } else if (e.type === 'mob') this.renderMob(r, e, lo, time);
      }
      for (const p of this.particles) {
        const m = r.model('p:' + p.tile, () => ({ parts: [{ name: 'p', pivot: [0, 0, 0], boxes: [{ from: [-1, 0, -1], to: [1, 2, 1], tex: [p.tile, p.tile, p.tile, p.tile, p.tile, p.tile] }] }] }));
        const L = w.light(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        r.drawModel(m, p.x, p.y, p.z, p.life * 3, { sky: L.sky, blk: L.blk, scale: p.size * Math.min(1, p.life * 3) });
      }
    }

    renderMob(r, e, lo, time) {
      const kind = e.kind === 'sheep' && e.sheared ? 'sheep_sheared' : e.kind;
      const m = r.model('mob:' + kind, MODELS[kind]);
      const sw = Math.sin(e.walk * 2.2) * (e.moving ? 0.8 : 0);
      const rot = {};
      const d = MOBS[e.kind];
      if (e.kind === 'zombie') { rot.armR = { x: Math.PI / 2 + sw * 0.1 }; rot.armL = { x: Math.PI / 2 - sw * 0.1 }; }
      else if (e.kind === 'skeleton') { rot.armR = { x: Math.PI / 2 }; rot.armL = { x: Math.PI / 2.4, y: 0.4 }; }
      else { rot.armR = { x: sw }; rot.armL = { x: -sw }; }
      rot.legR = { x: -sw }; rot.legL = { x: sw };
      rot.legFR = { x: sw }; rot.legBL = { x: sw }; rot.legFL = { x: -sw }; rot.legBR = { x: -sw };
      if (e.kind === 'spider') for (let i = 0; i < 8; i++) rot['leg' + i] = { z: (i < 4 ? 1 : -1) * (0.5 + Math.sin(e.walk * 3 + i) * (e.moving ? 0.25 : 0)), y: (i % 4 - 1.5) * 0.35 * (i < 4 ? 1 : -1) };
      if (e.kind === 'chicken') { const f = e.onGround ? 0 : Math.sin(time * 30) * 0.8 + 0.8; rot.wingR = { z: -f }; rot.wingL = { z: f }; }
      if (e.kind === 'axolotl') { rot.tail = { y: Math.sin(e.walk * 2) * 0.5 }; rot.body = { y: Math.sin(e.walk * 2 + 1) * 0.1 }; }
      if (e.kind === 'glow_squid') for (let i = 0; i < 8; i++) rot['t' + i] = { x: Math.sin(time * 3 + i) * 0.3 };
      if (e.pitch) rot.head = { x: e.pitch };
      const opts = { ...lo, rot, hurt: e.hurt > 0 ? 1 : 0, scale: e.baby ? 0.5 : 1 };
      if (d.glow) { opts.blk = 15; opts.sky = 15; }
      if (e.kind === 'axolotl') opts.tint = AXOLOTL_TINTS[e.variant || 0];
      if (e.kind === 'sheep' && !e.sheared) opts.tint = SHEEP_COLORS[e.color] || MC.dyeTint(e.color);
      if (e.kind === 'creeper' && e.fuse > 0) {
        const f = e.fuse / 1.5;
        opts.scale = 1 + f * 0.25;
        if (Math.floor(e.fuse * 8) % 2 === 0) opts.tint = [2.2, 2.2, 2.2];
      }
      if (e.dying) { opts.roll = Math.min(1, e.dying * 3) * Math.PI / 2; opts.hurt = 1; }
      if (e.onFire > 0) {
        opts.tint = [1.2, 0.95, 0.8];
        if (Math.random() < 0.25) this.particle(e.x + (Math.random() - 0.5) * e.w, e.y + Math.random() * e.h, e.z + (Math.random() - 0.5) * e.w, T('orange_wool'), { vy: 1.2, grav: -1, life: 0.5, size: 0.5 });
      }
      r.drawModel(m, e.x, e.y, e.z, e.yaw, opts);
    }
  }

  // dye colours for sheep tints
  const DYE = { orange: [1, 0.55, 0.15], magenta: [0.85, 0.35, 0.85], light_blue: [0.45, 0.75, 1], yellow: [1, 0.9, 0.25], lime: [0.55, 0.9, 0.2], cyan: [0.2, 0.65, 0.7], purple: [0.6, 0.25, 0.85], blue: [0.3, 0.32, 0.8], green: [0.4, 0.55, 0.15], red: [0.75, 0.2, 0.18] };
  MC.dyeTint = (c) => DYE[c] || [1, 1, 1];

  function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
    let tmin = 0, tmax = Infinity;
    for (const [o, d, a, b] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
      if (Math.abs(d) < 1e-9) { if (o < a || o > b) return null; continue; }
      let t1 = (a - o) / d, t2 = (b - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    return tmin;
  }
  MC.rayAABB = rayAABB;

  MC.Entities = Entities;
})(globalThis);
