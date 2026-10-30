// Caves & Cliffs-style terrain. generate(cx, cz) returns one 16x16x256 column of blocks.
//
// Pipeline: 2D climate noise picks biome and surface height (mountains where erosion is low),
// 3D noise bends that surface into cliffs and overhangs, cheese/spaghetti/noodle noise carves
// caves, then come deepslate, ores at their 1.18 heights, lush and dripstone caves, geodes,
// aquifers, trees and plants.
(function (G) {
  'use strict';
  const MC = G.MC;
  const { Simplex } = MC;
  const { idx, MIN_Y, HEIGHT, SEA } = MC;
  const B = MC.B;
  const smooth = MC.smooth;
  const clamp = MC.clamp;

  const BIOMES = [
    'ocean', 'deep_ocean', 'beach', 'river', 'plains', 'forest', 'birch_forest', 'dark_forest', 'taiga', 'snowy_plains',
    'desert', 'savanna', 'jungle', 'meadow', 'grove', 'snowy_slopes', 'jagged_peaks', 'stony_peaks', 'cherry_grove', 'stony_shore',
  ];
  const BI = {};
  BIOMES.forEach((b, i) => { BI[b] = i; });
  MC.BIOMES = BIOMES;
  MC.BIOME = BI;
  MC.CAVE_BIOME = { NONE: 0, LUSH: 1, DRIPSTONE: 2 };

  const STONEISH = new Uint8Array(MC.BLOCKS.length);
  for (const k of ['stone', 'deepslate', 'tuff', 'granite', 'diorite', 'andesite', 'dirt', 'gravel', 'calcite', 'sandstone', 'smooth_basalt', 'dripstone_block', 'clay']) STONEISH[B[k]] = 1;

  function WorldGen(seed) {
    this.seed = seed | 0;
    const s = (n) => new Simplex((this.seed * 31 + n * 7919) | 0);
    this.cont = s(1); this.ero = s(2); this.pv = s(3); this.temp = s(4); this.hum = s(5); this.riverN = s(6);
    this.detail = s(7); this.d3 = s(8); this.cheese = s(9); this.spag1 = s(10); this.spag2 = s(11);
    this.nood1 = s(12); this.nood2 = s(13); this.aqua = s(14); this.blob = s(15); this.blob2 = s(16);
    this.caveBiome = s(17); this.caveBiome2 = s(18); this.weird = s(19); this.cherry = s(20);
  }

  // Everything 2D about a column: height, biome inputs and how mountainous it is.
  WorldGen.prototype.climate = function (x, z) {
    const C = this.cont.fbm2(x / 1400, z / 1400, 4) * 1.25;
    const E = this.ero.fbm2(x / 900, z / 900, 3);
    const ridge = 1 - Math.abs(this.pv.fbm2(x / 420, z / 420, 4));
    const T = this.temp.fbm2(x / 1100, z / 1100, 3) * 1.3;
    const Hm = this.hum.fbm2(x / 950, z / 950, 3) * 1.3;
    let h;
    if (C < -0.45) h = 28 + (C + 1) * 22;
    else if (C < -0.18) h = 40 + ((C + 0.45) / 0.27) * 18;
    else if (C < -0.06) h = 58 + ((C + 0.18) / 0.12) * 7;
    else h = 65 + smooth(clamp((C + 0.06) / 0.7, 0, 1)) * 22;
    // Mountains rise where land is inland and erosion is low; ridges give jagged peaks.
    const M = smooth(clamp((C - 0.02) / 0.4, 0, 1)) * smooth(clamp((0.15 - E) / 0.6, 0, 1));
    h += M * (25 + Math.pow(ridge, 2.2) * 95);
    const hills = this.detail.fbm2(x / 160, z / 160, 3);
    h += hills * (6 + 10 * (1 - M)) + this.detail.noise2(x / 32, z / 32) * 1.5;
    // Rivers cut channels through the lowlands.
    const rv = Math.abs(this.riverN.fbm2(x / 700, z / 700, 3));
    let river = 0;
    if (C > -0.15 && M < 0.35) {
      river = smooth(clamp(1 - rv / 0.045, 0, 1)) * (1 - M / 0.35);
      if (river > 0) h = h + (SEA - 4 - h) * river;
    }
    return { h, M, T, Hm, C, river, ridge };
  };

  WorldGen.prototype.biomeFor = function (cl, surf) {
    const { T, Hm, M, river, C } = cl;
    if (river > 0.5) return T < -0.5 ? BI.river : BI.river;
    if (surf < SEA - 12) return BI.deep_ocean;
    if (surf < SEA - 2) return BI.ocean;
    if (surf <= SEA + 2 && C < 0.05) return M > 0.2 ? BI.stony_shore : BI.beach;
    if (surf > 150) return T < 0.3 ? BI.jagged_peaks : BI.stony_peaks;
    if (surf > 118 && M > 0.3) return T < -0.1 ? BI.snowy_slopes : T > 0.4 ? BI.stony_peaks : BI.grove;
    if (M > 0.25 && surf > 92) {
      if (this.cherry.noise2(cl.x / 300, cl.z / 300) > 0.35 && T > -0.2) return BI.cherry_grove;
      return T < -0.3 ? BI.grove : BI.meadow;
    }
    if (T < -0.45) return BI.snowy_plains;
    if (T < -0.15) return BI.taiga;
    if (T > 0.45 && Hm < -0.05) return BI.desert;
    if (T > 0.3 && Hm < 0.2) return BI.savanna;
    if (T > 0.25 && Hm > 0.35) return BI.jungle;
    if (Hm > 0.4) return BI.dark_forest;
    if (Hm > 0.1) return T < 0.05 ? BI.birch_forest : BI.forest;
    return BI.plains;
  };

  // ---------- trilinear helper: noise sampled on a coarse grid, interpolated per block ----------
  function grid3(fn, x0, z0, yLo, yHi, sx, sy) {
    const nx = 16 / sx + 1, ny = Math.floor((yHi - yLo) / sy) + 2;
    const g = new Float32Array(nx * nx * ny);
    for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nx; iz++) for (let ix = 0; ix < nx; ix++) {
      g[(iy * nx + iz) * nx + ix] = fn(x0 + ix * sx, yLo + iy * sy, z0 + iz * sx);
    }
    return {
      at(lx, y, lz) {
        const fx = lx / sx, fz = lz / sx, fy = (y - yLo) / sy;
        const ix = Math.min(nx - 2, fx | 0), iz = Math.min(nx - 2, fz | 0), iy = clamp(Math.floor(fy), 0, ny - 2);
        const tx = fx - ix, tz = fz - iz, ty = fy - iy;
        const i000 = (iy * nx + iz) * nx + ix;
        const a = g[i000], b = g[i000 + 1], c = g[i000 + nx], d = g[i000 + nx + 1];
        const j = i000 + nx * nx;
        const e = g[j], f = g[j + 1], h = g[j + nx], k = g[j + nx + 1];
        const l0 = a + (b - a) * tx, l1 = c + (d - c) * tx, l2 = e + (f - e) * tx, l3 = h + (k - h) * tx;
        const m0 = l0 + (l1 - l0) * tz, m1 = l2 + (l3 - l2) * tz;
        return m0 + (m1 - m0) * ty;
      },
    };
  }

  WorldGen.prototype.generate = function (cx, cz) {
    const blocks = new Uint16Array(MC.COLUMN_SIZE);
    const x0 = cx * 16, z0 = cz * 16;
    const seed = this.seed;
    const set = (lx, y, lz, id) => { const ly = y - MIN_Y; if (ly >= 0 && ly < HEIGHT && lx >= 0 && lx < 16 && lz >= 0 && lz < 16) blocks[idx(lx, ly, lz)] = id; };
    const get = (lx, y, lz) => { const ly = y - MIN_Y; if (ly < 0 || ly >= HEIGHT || lx < 0 || lx > 15 || lz < 0 || lz > 15) return -1; return blocks[idx(lx, ly, lz)]; };

    // 1) climate per column (with a 1-block border so we can measure slopes)
    const CL = [];
    const H = new Float32Array(18 * 18);
    for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
      const c = this.climate(x0 + x, z0 + z);
      c.x = x0 + x; c.z = z0 + z;
      H[(z + 1) * 18 + x + 1] = c.h;
      if (x >= 0 && x < 16 && z >= 0 && z < 16) CL[z * 16 + x] = c;
    }
    let hMin = 1e9, hMax = -1e9, ampMax = 0;
    const amp = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = CL[i];
      // Overhangs and cliffs get stronger in the mountains.
      amp[i] = 4 + 26 * c.M * c.M + (c.river > 0 ? -4 * c.river : 0);
      hMin = Math.min(hMin, c.h); hMax = Math.max(hMax, c.h); ampMax = Math.max(ampMax, amp[i]);
    }
    const yLo = Math.max(MIN_Y, Math.floor(hMin - ampMax - 2));
    const yHi = Math.min(MIN_Y + HEIGHT - 1, Math.ceil(hMax + ampMax + 2));
    const d3 = this.d3;
    const dens = grid3((x, y, z) => d3.fbm3(x / 70, y / 45, z / 70, 3), x0, z0, yLo, yHi, 4, 8);

    // 2) solid terrain
    const top = new Int16Array(256).fill(MIN_Y);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = lz * 16 + lx, h = CL[i].h, a = amp[i];
      for (let y = MIN_Y; y <= MC.MAX_Y; y++) {
        let solid;
        if (y < yLo) solid = true;
        else if (y > yHi) solid = false;
        else solid = h - y + a * dens.at(lx, y, lz) > 0;
        const ly = y - MIN_Y;
        if (solid) { blocks[idx(lx, ly, lz)] = B.stone; top[i] = y; }
        else if (y <= SEA) blocks[idx(lx, ly, lz)] = B.water;
      }
    }

    // 3) biome and surface materials
    const biome = new Uint8Array(256);
    // Steepness comes from the smooth height field so chunk edges agree with their neighbours.
    const topAt = (lx, lz) => H[(lz + 1) * 18 + lx + 1];
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = lz * 16 + lx, c = CL[i], t = top[i];
      const b = this.biomeFor(c, t);
      biome[i] = b;
      const slope = Math.max(Math.abs(topAt(lx + 1, lz) - topAt(lx - 1, lz)), Math.abs(topAt(lx, lz + 1) - topAt(lx, lz - 1)));
      const r = MC.hashf(x0 + lx, t, z0 + lz, seed);
      let surf = B.grass_block, under = B.dirt, depth = 3 + Math.floor(r * 2);
      if (b === BI.ocean || b === BI.deep_ocean) { surf = r < 0.3 ? B.gravel : r < 0.4 ? B.clay : B.sand; under = surf === B.clay ? B.clay : B.sand; }
      else if (b === BI.river) { surf = r < 0.5 ? B.sand : B.gravel; under = B.gravel; }
      else if (b === BI.beach) { surf = B.sand; under = B.sand; depth = 4; }
      else if (b === BI.stony_shore) { surf = B.stone; under = B.stone; }
      else if (b === BI.desert) { surf = B.sand; under = B.sand; depth = 4; }
      else if (b === BI.jagged_peaks || b === BI.snowy_slopes) { surf = slope > 2.6 ? B.stone : B.snow_block; under = slope > 2.6 ? B.stone : r < 0.1 ? B.powder_snow : B.snow_block; depth = 2; }
      else if (b === BI.stony_peaks) { surf = r < 0.15 ? B.calcite : B.stone; under = B.stone; }
      else if (b === BI.grove) { surf = B.snow_block; under = B.dirt; }
      else if (b === BI.taiga) { surf = r < 0.25 ? B.podzol : r < 0.3 ? B.coarse_dirt : B.grass_block; }
      else if (b === BI.savanna && r < 0.08) surf = B.coarse_dirt;
      // Exposed cliffs stay bare stone.
      if (slope > 3.2 && t > SEA + 2 && b !== BI.desert && b !== BI.beach) { surf = B.stone; under = B.stone; }
      if (t < SEA && surf === B.grass_block) surf = B.dirt;
      for (let d = 0; d <= depth; d++) {
        const y = t - d;
        if (get(lx, y, lz) !== B.stone) break;
        set(lx, y, lz, d === 0 ? surf : under);
      }
      if (surf === B.sand && depth >= 4) for (let d = depth + 1; d < depth + 4; d++) if (get(lx, t - d, lz) === B.stone) set(lx, t - d, lz, B.sandstone);
    }

    // 4) underground stone types: deepslate below y=0 and blobs of tuff, granite, diorite, andesite, dirt, gravel
    const blob = this.blob, blob2 = this.blob2;
    const bg = grid3((x, y, z) => blob.noise3(x / 22, y / 18, z / 22), x0, z0, MIN_Y, MC.MAX_Y, 4, 4);
    const bg2 = grid3((x, y, z) => blob2.noise3(x / 26, y / 20, z / 26), x0, z0, MIN_Y, MC.MAX_Y, 4, 4);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const t = top[lz * 16 + lx];
      for (let y = MIN_Y; y <= t; y++) {
        const k = idx(lx, y - MIN_Y, lz);
        if (blocks[k] !== B.stone) continue;
        const deep = y < 0 || (y < 8 && MC.hashf(x0 + lx, y, z0 + lz, seed + 5) < (8 - y) / 8);
        const n1 = bg.at(lx, y, lz), n2 = bg2.at(lx, y, lz);
        if (deep) blocks[k] = n1 > 0.62 ? B.tuff : B.deepslate;
        else if (n1 > 0.62) blocks[k] = B.granite;
        else if (n1 < -0.62) blocks[k] = B.diorite;
        else if (n2 > 0.62) blocks[k] = B.andesite;
        else if (n2 < -0.7 && y < t - 6) blocks[k] = y > 30 ? B.dirt : B.gravel;
      }
    }

    // 5) caves
    const caveBiomeAt = (x, z) => {
      const l = this.caveBiome.noise2(x / 260, z / 260), d = this.caveBiome2.noise2(x / 240, z / 240);
      return l > 0.38 ? 1 : d > 0.42 ? 2 : 0;
    };
    const cheeseN = this.cheese, s1 = this.spag1, s2 = this.spag2, n1 = this.nood1, n2 = this.nood2;
    const cg = grid3((x, y, z) => cheeseN.fbm3(x / 90, y / 45, z / 90, 2) + 0.35 * cheeseN.noise3(x / 24 + 50, y / 20, z / 24), x0, z0, MIN_Y, MC.MAX_Y, 4, 4);
    const sg1 = grid3((x, y, z) => s1.noise3(x / 55, y / 34, z / 55), x0, z0, MIN_Y, MC.MAX_Y, 4, 4);
    const sg2 = grid3((x, y, z) => s2.noise3(x / 55, y / 34, z / 55), x0, z0, MIN_Y, MC.MAX_Y, 4, 4);
    const ng1 = grid3((x, y, z) => n1.noise3(x / 24, y / 18, z / 24), x0, z0, MIN_Y, MC.MAX_Y, 4, 4);
    const ng2 = grid3((x, y, z) => n2.noise3(x / 24, y / 18, z / 24), x0, z0, MIN_Y, MC.MAX_Y, 4, 4);
    const aquifer = this.aqua;
    const caveMask = new Uint8Array(MC.COLUMN_SIZE);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = lz * 16 + lx, t = top[i];
      const underwater = t < SEA;
      // Some areas get underground lakes: a flat water table inside the caves.
      const table = aquifer.noise2((x0 + lx) / 180, (z0 + lz) / 180) > 0.25 ? Math.round(-10 + aquifer.noise2((x0 + lx) / 400, (z0 + lz) / 400) * 30) : -999;
      for (let y = MIN_Y + 5; y <= t; y++) {
        const depth = t - y;
        if (underwater && depth < 9) continue;
        const k = idx(lx, y - MIN_Y, lz);
        const b = blocks[k];
        if (!STONEISH[b] && b !== B.grass_block && b !== B.sand && b !== B.snow_block && b !== B.podzol && b !== B.coarse_dirt && b !== B.sandstone) continue;
        let cave = false;
        const fade = smooth(clamp((y - MIN_Y - 4) / 8, 0, 1));
        if (depth > 10) {
          const c = cg.at(lx, y, lz);
          if (c * fade > 0.52) cave = true;
        }
        if (!cave) {
          const a = sg1.at(lx, y, lz), bb = sg2.at(lx, y, lz);
          const w = depth < 4 ? 0.0035 : 0.0065;
          if (a * a + bb * bb < w * fade) cave = true;
        }
        if (!cave && depth > 4) {
          const a = ng1.at(lx, y, lz), bb = ng2.at(lx, y, lz);
          if (a * a + bb * bb < 0.0016 * fade) cave = true;
        }
        if (!cave) continue;
        caveMask[k] = 1;
        if (y < -54) blocks[k] = B.lava;
        else if (y <= table) blocks[k] = B.water;
        else blocks[k] = B.air;
      }
      // keep the column's recorded top in sync if a cave opened the surface
      while (top[i] > MIN_Y && blocks[idx(lx, top[i] - MIN_Y, lz)] === B.air) top[i]--;
    }

    // 6) ores (veins), placed at Caves & Cliffs heights
    const rnd = MC.rng(MC.hash(cx, 0, cz, seed + 99));
    const tri = (lo, hi) => Math.round(lo + (hi - lo) * (rnd() + rnd()) / 2);
    const uni = (lo, hi) => Math.round(lo + (hi - lo) * rnd());
    const mountainous = CL[136].M > 0.3;
    const ORE_PLAN = [
      ['coal', 18, 9, () => uni(0, 190)], ['coal', 10, 9, () => tri(0, 192)],
      ['copper', 14, 8, () => tri(-16, 112)],
      ['iron', 9, 7, () => tri(-24, 56)], ['iron', 8, 4, () => uni(-64, 72)],
      ['gold', 4, 7, () => tri(-64, 32)],
      ['redstone', 4, 6, () => uni(-64, 15)], ['redstone', 6, 6, () => tri(-96, -32)],
      ['lapis', 2, 5, () => tri(-32, 32)], ['lapis', 3, 5, () => uni(-64, 64)],
      ['diamond', 6, 4, () => tri(-144, 16)],
    ];
    if (mountainous) { ORE_PLAN.push(['iron', 10, 7, () => tri(80, 190)]); ORE_PLAN.push(['emerald', 8, 1, () => tri(-16, 190)]); }
    if (caveBiomeAt(x0 + 8, z0 + 8) === 2) ORE_PLAN.push(['copper', 12, 12, () => tri(-16, 112)]);
    for (const [ore, count, size, yfn] of ORE_PLAN) {
      for (let n = 0; n < count; n++) {
        let x = Math.floor(rnd() * 16), y = yfn(), z = Math.floor(rnd() * 16);
        if (y < MIN_Y + 1) continue;
        for (let s = 0; s < size; s++) {
          const b = get(x, y, z);
          if (b === B.stone || b === B.granite || b === B.diorite || b === B.andesite) set(x, y, z, B[`${ore}_ore`]);
          else if (b === B.deepslate || b === B.tuff) set(x, y, z, B[`deepslate_${ore}_ore`]);
          const dir = Math.floor(rnd() * 6);
          x += [1, -1, 0, 0, 0, 0][dir]; y += [0, 0, 1, -1, 0, 0][dir]; z += [0, 0, 0, 0, 1, -1][dir];
        }
      }
    }

    // 7) cave decoration: lush caves, dripstone caves, glow lichen
    const isAir = (b) => b === B.air;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const cb = caveBiomeAt(x0 + lx, z0 + lz);
      const t = top[lz * 16 + lx];
      for (let y = MIN_Y + 6; y < t - 6; y++) {
        const k = idx(lx, y - MIN_Y, lz);
        if (!caveMask[k] || blocks[k] !== B.air) continue;
        const below = get(lx, y - 1, lz), above = get(lx, y + 1, lz);
        const h = MC.hashf(x0 + lx, y, z0 + lz, seed + 3);
        if (cb === 1) {
          // Lush cave: moss floors and ceilings, azaleas, dripleaf, glow berry vines, spore blossoms, clay pools
          if (STONEISH[below] && below !== B.clay) {
            set(lx, y - 1, lz, h < 0.08 ? B.clay : B.moss_block);
            if (h < 0.06) set(lx, y, lz, B.azalea);
            else if (h < 0.09) set(lx, y, lz, B.flowering_azalea);
            else if (h < 0.18) set(lx, y, lz, B.moss_carpet);
            else if (h < 0.24) set(lx, y, lz, B.short_grass);
            else if (h < 0.27) set(lx, y, lz, B.small_dripleaf);
            else if (h < 0.29) set(lx, y, lz, B.big_dripleaf);
          } else if (STONEISH[above]) {
            set(lx, y + 1, lz, h < 0.5 ? B.moss_block : B.rooted_dirt);
            if (h < 0.16) {
              const len = 1 + Math.floor(MC.hashf(lx, y, lz, seed + 4) * 6);
              for (let d = 0; d < len && get(lx, y - d, lz) === B.air; d++) set(lx, y - d, lz, MC.withState(B.cave_vines, MC.hashf(lx, y - d, lz, seed) < 0.2 ? 1 : 0));
            } else if (h < 0.18) set(lx, y, lz, B.spore_blossom);
            else if (h > 0.9) set(lx, y, lz, B.hanging_roots);
          }
        } else if (cb === 2) {
          // Dripstone cave: dripstone blocks with stalactites and stalagmites
          if (STONEISH[above] && h < 0.25) {
            set(lx, y + 1, lz, B.dripstone_block);
            const len = 1 + Math.floor(MC.hashf(lx, y, lz, seed + 6) * 4);
            for (let d = 0; d < len && get(lx, y - d, lz) === B.air; d++) set(lx, y - d, lz, MC.withState(B.pointed_dripstone, 1));
          } else if (STONEISH[below] && h < 0.25) {
            set(lx, y - 1, lz, B.dripstone_block);
            if (h < 0.12) {
              const len = 1 + Math.floor(MC.hashf(lx, y, lz, seed + 7) * 3);
              for (let d = 0; d < len && get(lx, y + d, lz) === B.air; d++) set(lx, y + d, lz, MC.withState(B.pointed_dripstone, 0));
            }
          } else if (STONEISH[below] && h < 0.4) set(lx, y - 1, lz, B.dripstone_block);
        } else if (h < 0.025) {
          // glow lichen on a neighbouring wall
          for (let f = 0; f < 4; f++) {
            const dx = [0, 1, 0, -1][f], dz = [-1, 0, 1, 0][f];
            if (STONEISH[get(lx + dx, y, lz + dz)] || get(lx + dx, y, lz + dz) === B.deepslate) { set(lx, y, lz, MC.withState(B.glow_lichen, f)); break; }
          }
        } else if (h > 0.997 && y < 30) set(lx, y, lz, B.cobweb);
      }
    }

    // 8) amethyst geode (rare), kept inside this chunk
    if (MC.hashf(cx, 7, cz, seed) < 0.045) {
      const gx = 7 + Math.floor(rnd() * 2), gz = 7 + Math.floor(rnd() * 2), gy = tri(-50, 24);
      const R = 5.2;
      for (let dz = -6; dz <= 6; dz++) for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const d = Math.hypot(dx, dy, dz) + MC.hashf(dx, dy, dz, seed) * 0.4;
        const x = gx + dx, y = gy + dy, z = gz + dz;
        if (get(x, y, z) < 0 || d > R + 0.6) continue;
        if (d > R - 0.5) set(x, y, z, B.smooth_basalt);
        else if (d > R - 1.5) set(x, y, z, B.calcite);
        else if (d > R - 2.5) set(x, y, z, MC.hashf(x, y, z, seed + 8) < 0.1 ? B.budding_amethyst : B.amethyst_block);
        else set(x, y, z, B.air);
      }
      // crystals grow off budding amethyst into the hollow
      for (let dz = -4; dz <= 4; dz++) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = gx + dx, y = gy + dy, z = gz + dz;
        if (get(x, y, z) !== B.air) continue;
        for (let f = 0; f < 6; f++) {
          const F = MC.FACES[f];
          if (get(x - F.dx, y - F.dy, z - F.dz) === B.budding_amethyst && MC.hashf(x, y, z, seed + f) < 0.6) {
            const kinds = [B.small_amethyst_bud, B.medium_amethyst_bud, B.large_amethyst_bud, B.amethyst_cluster];
            set(x, y, z, MC.withState(kinds[Math.floor(MC.hashf(x, y, z, seed + 9) * 4)], f));
            break;
          }
        }
      }
    }

    // 9) surface plants and trees
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = lz * 16 + lx, t = top[i], b = biome[i];
      const ground = get(lx, t, lz), above = get(lx, t + 1, lz);
      const wx = x0 + lx, wz = z0 + lz;
      const h = MC.hashf(wx, 1, wz, seed), h2 = MC.hashf(wx, 2, wz, seed);
      if (above === B.water) {
        if (t + 1 <= SEA && get(lx, SEA, lz) === B.water && (b === BI.snowy_plains || b === BI.grove || b === BI.snowy_slopes || b === BI.jagged_peaks)) set(lx, SEA, lz, B.ice);
        continue;
      }
      if (above !== B.air) continue;
      const inner = lx >= 2 && lx <= 13 && lz >= 2 && lz <= 13;
      const grassy = ground === B.grass_block || ground === B.podzol || ground === B.coarse_dirt || ground === B.dirt;
      const treeChance = { forest: 0.05, birch_forest: 0.05, dark_forest: 0.08, taiga: 0.05, jungle: 0.09, plains: 0.004, savanna: 0.008, meadow: 0.003, grove: 0.02, snowy_plains: 0.006, cherry_grove: 0.02 }[BIOMES[b]] || 0;
      if (grassy && inner && h < treeChance) {
        const kind = { forest: h2 < 0.25 ? 'birch' : 'oak', birch_forest: 'birch', dark_forest: h2 < 0.85 ? 'dark_oak' : 'oak', taiga: 'spruce', grove: 'spruce', snowy_plains: 'spruce', jungle: 'jungle', savanna: 'acacia', cherry_grove: 'cherry' }[BIOMES[b]] || (h2 < 0.1 ? 'birch' : 'oak');
        this.tree(set, get, lx, t + 1, lz, kind, MC.hash(wx, t, wz, seed));
        continue;
      }
      // Azalea trees mark lush caves below.
      if (grassy && inner && caveBiomeAt(wx, wz) === 1 && h > 0.996) { this.tree(set, get, lx, t + 1, lz, 'azalea', MC.hash(wx, t, wz, seed)); continue; }
      const r = h2;
      if (ground === B.grass_block) {
        if (b === BI.snowy_plains) { set(lx, t + 1, lz, B.snow); continue; }
        const flowerRate = b === BI.meadow ? 0.12 : b === BI.plains ? 0.03 : b === BI.cherry_grove ? 0.05 : 0.012;
        if (h < 0.3 + (b === BI.meadow || b === BI.plains ? 0.25 : 0)) {
          if (r < flowerRate) {
            const pool = b === BI.meadow ? ['dandelion', 'poppy', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower'] : b === BI.cherry_grove ? ['pink_tulip', 'white_tulip', 'allium'] : b === BI.dark_forest || b === BI.forest ? ['lily_of_the_valley', 'poppy', 'dandelion', 'cornflower'] : ['dandelion', 'poppy', 'azure_bluet', 'oxeye_daisy', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'blue_orchid'];
            set(lx, t + 1, lz, B[pool[Math.floor(MC.hashf(wx, 3, wz, seed) * pool.length)]]);
          } else if (r < 0.75) set(lx, t + 1, lz, b === BI.taiga || b === BI.jungle ? (r < 0.4 ? B.fern : B.short_grass) : B.short_grass);
        }
        if (b === BI.dark_forest && h > 0.985) set(lx, t + 1, lz, r < 0.5 ? B.red_mushroom : B.brown_mushroom);
        if (h > 0.9994 && (b === BI.plains || b === BI.forest)) set(lx, t + 1, lz, B.pumpkin);
      } else if (ground === B.podzol && h < 0.3) set(lx, t + 1, lz, B.fern);
      else if (ground === B.sand || ground === B.red_sand) {
        if (b === BI.desert && inner && h < 0.006) { const ht = 1 + Math.floor(r * 3); for (let d = 1; d <= ht; d++) set(lx, t + d, lz, B.cactus); }
        else if (b === BI.desert && h > 0.985) set(lx, t + 1, lz, B.dead_bush);
      } else if (ground === B.snow_block && (b === BI.snowy_slopes || b === BI.grove) && h < 0.2) set(lx, t + 1, lz, B.snow);
      // Sugar cane beside water.
      if ((ground === B.grass_block || ground === B.sand || ground === B.dirt) && t === SEA && h > 0.92) {
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => get(lx + dx, t, lz + dz) === B.water)) {
          const ht = 1 + Math.floor(r * 3);
          for (let d = 1; d <= ht; d++) set(lx, t + d, lz, B.sugar_cane);
        }
      }
    }

    // 10) bedrock floor
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      set(lx, MIN_Y, lz, B.bedrock);
      for (let d = 1; d < 5; d++) if (MC.hashf(x0 + lx, d, z0 + lz, seed + 11) < (5 - d) / 5) set(lx, MIN_Y + d, lz, B.bedrock);
    }

    const caveBiomes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) caveBiomes[i] = caveBiomeAt(x0 + (i & 15), z0 + (i >> 4));
    return { blocks, biome, caveBiomes, top };
  };

  // ---------- trees ----------
  WorldGen.prototype.tree = function (set, get, x, y, z, kind, h) {
    const r = MC.rng(h);
    const LOG = B[`${kind}_log`] || B.oak_log, LEAF = B[`${kind}_leaves`] || B.oak_leaves;
    const soft = (b) => b === B.air || b === B.short_grass || b === B.fern || b === B.snow || b < 0;
    const leaf = (lx, ly, lz, id = LEAF) => { if (get(lx, ly, lz) === B.air || get(lx, ly, lz) === B.snow) set(lx, ly, lz, id); };
    const blob = (cx, cy, cz, rad, id) => {
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && r() < 0.6) continue;
        leaf(cx + dx, cy, cz + dz, id);
      }
    };
    if (get(x, y - 1, z) === B.grass_block || get(x, y - 1, z) === B.podzol) set(x, y - 1, z, B.dirt);
    if (kind === 'oak' || kind === 'birch' || kind === 'azalea') {
      const ht = (kind === 'birch' ? 5 : 4) + Math.floor(r() * 3);
      const log = kind === 'azalea' ? B.oak_log : LOG;
      for (let i = 0; i < ht; i++) if (soft(get(x, y + i, z)) || get(x, y + i, z) === LEAF) set(x, y + i, z, log);
      const lf = kind === 'azalea' ? () => (r() < 0.3 ? B.flowering_azalea_leaves : B.azalea_leaves) : () => LEAF;
      for (let dy = ht - 3; dy <= ht; dy++) {
        const rad = dy >= ht - 1 ? 1 : 2;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && (dy === ht || r() < 0.5)) continue;
          if (dx === 0 && dz === 0 && dy < ht) continue;
          leaf(x + dx, y + dy, z + dz, lf());
        }
      }
      if (kind === 'azalea') for (let d = 1; d < 5; d++) if (get(x, y - 1 - d, z) === B.dirt || get(x, y - 1 - d, z) === B.stone) set(x, y - 1 - d, z, B.rooted_dirt);
    } else if (kind === 'spruce') {
      const ht = 6 + Math.floor(r() * 4);
      for (let i = 0; i < ht; i++) set(x, y + i, z, LOG);
      let rad = 0;
      for (let dy = ht + 1; dy >= 2; dy--) {
        blob(x, y + dy, z, rad, LEAF);
        rad = rad >= (dy < ht - 3 ? 3 : 2) ? 1 : rad + 1;
      }
      leaf(x, y + ht + 1, z);
    } else if (kind === 'jungle') {
      const ht = 8 + Math.floor(r() * 5);
      for (let i = 0; i < ht; i++) set(x, y + i, z, LOG);
      for (let dy = ht - 2; dy <= ht + 1; dy++) blob(x, y + dy, z, dy <= ht - 1 ? 3 : 2, LEAF);
    } else if (kind === 'acacia') {
      const ht = 4 + Math.floor(r() * 2);
      const dx = r() < 0.5 ? 1 : -1, dz = r() < 0.5 ? 1 : -1;
      let cx = x, cz = z;
      for (let i = 0; i < ht; i++) { if (i >= ht - 2) { cx += dx; cz += dz; } set(cx, y + i, cz, LOG); }
      blob(cx, y + ht, cz, 3, LEAF);
      blob(cx, y + ht + 1, cz, 1, LEAF);
    } else if (kind === 'dark_oak') {
      const ht = 6 + Math.floor(r() * 3);
      for (let i = 0; i < ht; i++) for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + ox, y + i, z + oz, LOG);
      for (let dy = ht - 2; dy <= ht + 1; dy++) blob(x, y + dy, z, dy >= ht ? 2 : 3, LEAF);
    } else if (kind === 'cherry') {
      const ht = 5 + Math.floor(r() * 2);
      for (let i = 0; i < ht; i++) set(x, y + i, z, LOG);
      for (let dy = ht - 2; dy <= ht + 1; dy++) blob(x, y + dy, z, dy === ht + 1 ? 2 : 3, LEAF);
    }
  };

  MC.WorldGen = WorldGen;
})(globalThis);
