// Procedural 16x16 block textures, looked up by name. Everything here is original pixel art.
'use strict';
const { Tile, shade, mix, hex, rngFor } = require('./pixels');

const COLORS = {
  white: [233, 236, 236], orange: [240, 118, 19], magenta: [189, 68, 179], light_blue: [58, 175, 217],
  yellow: [248, 197, 39], lime: [112, 185, 25], pink: [237, 141, 172], gray: [62, 68, 71],
  light_gray: [142, 142, 134], cyan: [21, 137, 145], purple: [121, 42, 172], blue: [53, 57, 157],
  brown: [114, 71, 40], green: [84, 109, 27], red: [160, 39, 34], black: [28, 29, 33],
};
const WOOD = {
  oak: { planks: [162, 130, 78], bark: [104, 82, 50], leaves: [70, 125, 38], stripped: [177, 144, 86] },
  spruce: { planks: [114, 84, 48], bark: [58, 40, 20], leaves: [52, 90, 56], stripped: [116, 90, 52] },
  birch: { planks: [196, 179, 123], bark: [216, 215, 208], leaves: [106, 148, 60], stripped: [196, 176, 118] },
  jungle: { planks: [160, 115, 80], bark: [86, 68, 28], leaves: [52, 140, 28], stripped: [171, 132, 84] },
  acacia: { planks: [168, 90, 50], bark: [103, 96, 86], leaves: [92, 124, 34], stripped: [174, 92, 59] },
  dark_oak: { planks: [66, 43, 20], bark: [58, 44, 26], leaves: [50, 104, 28], stripped: [96, 76, 49] },
  cherry: { planks: [226, 178, 172], bark: [54, 33, 44], leaves: [236, 168, 200], stripped: [216, 144, 146] },
};
const COPPER = { '': [192, 107, 79], exposed_: [161, 125, 103], weathered_: [108, 153, 110], oxidized_: [82, 162, 132] };
const ORE_COL = {
  coal: [[32, 32, 32], [60, 60, 60]], iron: [[216, 175, 147], [180, 140, 110]], copper: [[226, 124, 80], [94, 178, 146]],
  gold: [[252, 238, 75], [220, 170, 30]], redstone: [[255, 20, 20], [170, 0, 0]], lapis: [[34, 78, 200], [24, 50, 140]],
  diamond: [[110, 236, 228], [40, 170, 170]], emerald: [[30, 220, 100], [10, 150, 60]],
};

// ---------- building blocks ----------
function noisy(base, amp, name, opts = {}) {
  const r = rngFor(name);
  const t = new Tile();
  t.each((x, y) => {
    let k = (r() - 0.5) * amp;
    if (opts.rows) k += (rngFor(name + 'row' + y)() - 0.5) * opts.rows;
    if (opts.cols) k += (rngFor(name + 'col' + x)() - 0.5) * opts.cols;
    t.set(x, y, shade(base, k));
  });
  if (opts.blobs) {
    for (let i = 0; i < opts.blobs; i++) {
      const cx = r() * 16, cy = r() * 16, rad = 0.8 + r() * 1.6, k = (r() - 0.6) * 0.35;
      t.each((x, y) => { for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) if ((x - cx + ox) ** 2 + (y - cy + oy) ** 2 < rad * rad) t.set(x, y, shade(t.get(x, y), k)); });
    }
  }
  return t;
}

function voronoi(base, name, cells = 7, mortar = 0.45, vary = 0.25) {
  const r = rngFor(name);
  const pts = [];
  for (let i = 0; i < cells; i++) pts.push([r() * 16, r() * 16, (r() - 0.5) * vary]);
  const t = new Tile();
  t.each((x, y) => {
    let d1 = 99, d2 = 99, k = 0;
    for (const [px, py, pk] of pts) {
      for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
        const d = Math.hypot(x + 0.5 - px - ox, y + 0.5 - py - oy);
        if (d < d1) { d2 = d1; d1 = d; k = pk; } else if (d < d2) d2 = d;
      }
    }
    const edge = d2 - d1 < 1.1;
    t.set(x, y, shade(base, edge ? -mortar : k + (r() - 0.5) * 0.12 + (d1 < 1.5 ? 0.08 : 0)));
  });
  return t;
}

function bricks(base, mortarCol, name, rows = 4, cols = 2, vary = 0.18) {
  const r = rngFor(name);
  const t = new Tile();
  const bh = 16 / rows, bw = 16 / cols;
  t.each((x, y) => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    const col = Math.floor(((x + off) % 16) / bw);
    const isMortar = y % bh === bh - 1 || Math.floor((x + off) % bw) === bw - 1;
    const k = (rngFor(name + row + ',' + col)() - 0.5) * vary + (r() - 0.5) * 0.1;
    t.set(x, y, isMortar ? shade(mortarCol, (r() - 0.5) * 0.1) : shade(base, k));
  });
  return t;
}

function bevel(t, k = 0.18) {
  t.each((x, y) => {
    if (x === 0 || y === 0) t.set(x, y, shade(t.get(x, y), k));
    else if (x === 15 || y === 15) t.set(x, y, shade(t.get(x, y), -k));
  });
  return t;
}

function planks(base, name) {
  const r = rngFor(name);
  const t = new Tile();
  t.each((x, y) => {
    const board = Math.floor(y / 4);
    const seamX = board % 2 ? 4 : 12;
    let k = (rngFor(name + 'b' + board)() - 0.5) * 0.12 + (rngFor(name + 'g' + y + ',' + Math.floor(x / 3))() - 0.5) * 0.12 + (r() - 0.5) * 0.05;
    if (y % 4 === 3) k = -0.32;
    else if (x === seamX) k -= 0.22;
    else if (y % 4 === 0) k += 0.06;
    t.set(x, y, shade(base, k));
  });
  return t;
}

function bark(base, name) {
  const t = noisy(base, 0.18, name, { cols: 0.35 });
  const r = rngFor(name + 'k');
  for (let i = 0; i < 6; i++) { const x = Math.floor(r() * 16), y = Math.floor(r() * 14); t.line(x, y, x, y + 1 + Math.floor(r() * 3), shade(base, -0.35)); }
  return t;
}

function logTop(barkCol, inner, name) {
  const t = new Tile();
  const r = rngFor(name);
  t.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const ring = Math.floor(Math.hypot(x - 7.5, y - 7.5));
    if (d > 6.6) t.set(x, y, shade(barkCol, (r() - 0.5) * 0.2));
    else t.set(x, y, shade(inner, (ring % 2 ? -0.1 : 0.04) + (r() - 0.5) * 0.06));
  });
  return t;
}

function ore(baseTile, cols, name) {
  const t = baseTile.copy();
  const r = rngFor(name);
  const clusters = name.includes('coal') ? 5 : 4;
  for (let i = 0; i < clusters; i++) {
    const cx = 2 + Math.floor(r() * 12), cy = 2 + Math.floor(r() * 12);
    const n = 3 + Math.floor(r() * 3);
    for (let j = 0; j < n; j++) {
      const x = cx + Math.floor(r() * 3) - 1, y = cy + Math.floor(r() * 3) - 1;
      t.set(x, y, j % 2 ? cols[1] : cols[0]);
      if (r() < 0.4) t.set(x + 1, y, shade(cols[0], 0.25));
    }
  }
  return t;
}

function sprite(name, draw) { const t = new Tile(); draw(t, rngFor(name)); return t; }

function crossPlant(stem, petal, center, name) {
  return sprite(name, (t, r) => {
    t.line(8, 15, 8, 7, stem);
    t.line(7, 12, 5, 10, stem); t.line(9, 11, 11, 9, stem);
    if (petal) {
      t.disc(8, 5.5, 2.6, petal);
      for (let i = 0; i < 4; i++) t.set(6 + r() * 4, 3 + r() * 4, shade(petal, 0.25));
      if (center) t.set(8, 5, center);
    }
  });
}

const STONE = [125, 125, 125];
const DEEPSLATE = [78, 78, 84];
function stoneTile(n) { return noisy(STONE, 0.16, n, { blobs: 8 }); }
function deepTile(n) { return noisy(DEEPSLATE, 0.14, n, { rows: 0.18, blobs: 4 }); }

// ---------- the big lookup ----------
const T = {};
const RULES = [];
const rule = (re, fn) => RULES.push([re, fn]);

T.stone = () => stoneTile('stone');
T.smooth_stone = () => bevel(noisy([160, 160, 160], 0.06, 'smooth_stone'), 0.12);
T.cobblestone = () => voronoi([122, 122, 122], 'cobblestone', 8, 0.5, 0.3);
T.mossy_cobblestone = () => { const t = T.cobblestone(); const r = rngFor('moss'); t.each((x, y) => { if (r() < 0.32 + (y < 6 ? 0.2 : 0)) t.set(x, y, shade([82, 110, 42], (r() - 0.5) * 0.3)); }); return t; };
T.stone_bricks = () => bricks([122, 121, 122], [88, 88, 88], 'stone_bricks', 2, 2, 0.12);
T.mossy_stone_bricks = () => { const t = T.stone_bricks(); const r = rngFor('mossb'); t.each((x, y) => { if (r() < 0.28) t.set(x, y, shade([82, 110, 42], (r() - 0.5) * 0.3)); }); return t; };
T.cracked_stone_bricks = () => { const t = T.stone_bricks(); t.line(3, 0, 6, 6, [70, 70, 70]); t.line(6, 6, 4, 11, [70, 70, 70]); t.line(11, 8, 13, 15, [70, 70, 70]); return t; };
T.chiseled_stone_bricks = () => { const t = bevel(noisy([122, 121, 122], 0.08, 'csb'), 0.2); t.rect(3, 3, 10, 10, [100, 100, 100]); t.rect(5, 5, 6, 6, [130, 130, 130]); t.rect(6, 6, 4, 4, [95, 95, 95]); return t; };
T.granite = () => noisy([149, 103, 85], 0.22, 'granite', { blobs: 10 });
T.diorite = () => { const t = noisy([190, 190, 190], 0.12, 'diorite'); const r = rngFor('dior'); for (let i = 0; i < 26; i++) t.set(r() * 16, r() * 16, [110, 110, 110]); return t; };
T.andesite = () => noisy([136, 136, 137], 0.2, 'andesite', { blobs: 6 });
for (const s of ['granite', 'diorite', 'andesite']) T[`polished_${s}`] = () => bevel(noisy(T[s]().get(4, 4), 0.07, 'p' + s), 0.15);
T.deepslate = () => deepTile('deepslate');
T.deepslate_top = () => { const t = noisy(DEEPSLATE, 0.12, 'dtop'); t.each((x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); if (Math.floor(d) % 3 === 0) t.set(x, y, shade(t.get(x, y), -0.12)); }); return t; };
T.cobbled_deepslate = () => voronoi([74, 74, 80], 'cdeep', 9, 0.5, 0.25);
T.polished_deepslate = () => bevel(noisy([72, 72, 78], 0.07, 'pdeep'), 0.15);
T.deepslate_bricks = () => bricks([80, 80, 86], [44, 44, 48], 'dbricks', 4, 2, 0.12);
T.cracked_deepslate_bricks = () => { const t = T.deepslate_bricks(); t.line(2, 0, 7, 7, [30, 30, 32]); t.line(9, 9, 12, 15, [30, 30, 32]); return t; };
T.deepslate_tiles = () => bricks([66, 66, 72], [36, 36, 40], 'dtiles', 4, 4, 0.15);
T.cracked_deepslate_tiles = () => { const t = T.deepslate_tiles(); t.line(3, 1, 9, 9, [24, 24, 26]); return t; };
T.chiseled_deepslate = () => { const t = bevel(noisy([70, 70, 76], 0.08, 'chd'), 0.2); t.rect(3, 3, 10, 10, [52, 52, 58]); t.rect(5, 5, 6, 6, [86, 86, 92]); return t; };
T.tuff = () => { const t = noisy([108, 109, 102], 0.16, 'tuff'); const r = rngFor('tuffs'); for (let i = 0; i < 20; i++) t.set(r() * 16, r() * 16, shade([140, 140, 128], (r() - 0.5) * 0.3)); return t; };
T.polished_tuff = () => bevel(noisy([104, 108, 100], 0.07, 'ptuff'), 0.15);
T.tuff_bricks = () => bricks([110, 114, 104], [72, 76, 70], 'tbricks', 4, 2, 0.12);
T.chiseled_tuff = () => { const t = bevel(noisy([104, 108, 100], 0.07, 'ctuff'), 0.18); t.rect(2, 6, 12, 4, [80, 84, 78]); return t; };
T.chiseled_tuff_bricks = () => { const t = T.tuff_bricks(); t.rect(5, 5, 6, 6, [80, 84, 78]); t.rect(6, 6, 4, 4, [128, 132, 120]); return t; };
T.calcite = () => { const t = noisy([223, 224, 220], 0.06, 'calcite'); const r = rngFor('calc'); for (let i = 0; i < 5; i++) { const y = Math.floor(r() * 16); t.line(0, y, 15, y + Math.floor(r() * 3) - 1, [200, 200, 196]); } return t; };
T.smooth_basalt = () => noisy([72, 72, 78], 0.1, 'sbasalt', { blobs: 5 });
T.dripstone_block = () => noisy([134, 107, 92], 0.18, 'dripstone', { cols: 0.3 });
T.pointed_dripstone = () => sprite('pdrip', (t) => { for (let y = 0; y < 16; y++) { const w = Math.max(0, Math.round((16 - y) / 4)); for (let x = 8 - w; x <= 8 + w; x++) t.set(x, y, shade([134, 107, 92], (x - 8) * 0.06 + (y % 3 ? 0 : -0.1))); } });
T.amethyst_block = () => { const t = noisy([133, 97, 191], 0.14, 'amethyst'); t.each((x, y) => { if ((x + y) % 5 === 0) t.set(x, y, [171, 135, 230]); if ((x - y + 16) % 7 === 0) t.set(x, y, [100, 70, 160]); }); return t; };
T.budding_amethyst = () => { const t = T.amethyst_block(); const r = rngFor('bud'); for (let i = 0; i < 6; i++) t.rect(Math.floor(r() * 14), Math.floor(r() * 14), 2, 2, [70, 45, 120]); return t; };
const crystal = (n, size) => sprite(n, (t) => { const h = size; for (let i = 0; i < 3; i++) { const cx = 5 + i * 3, top = 15 - h + (i === 1 ? 0 : 2); t.line(cx, 15, cx, top, [190, 150, 250]); t.line(cx + 1, 15, cx + 1, top + 1, [140, 100, 210]); } });
T.small_amethyst_bud = () => crystal('sab', 4);
T.medium_amethyst_bud = () => crystal('mab', 7);
T.large_amethyst_bud = () => crystal('lab', 10);
T.amethyst_cluster = () => crystal('ac', 13);
T.tinted_glass = () => { const t = new Tile(); t.fill([44, 38, 50], 200); t.each((x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) t.set(x, y, [70, 60, 80], 255); }); return t; };
T.moss_block = () => noisy([89, 109, 45], 0.24, 'moss', { blobs: 8 });
T.azalea_side = () => sprite('azalea', (t, r) => { t.disc(8, 7, 7, [94, 126, 46]); t.each((x, y) => { if (t.alpha(x, y) && r() < 0.3) t.set(x, y, [70, 100, 34]); }); t.line(8, 15, 8, 12, [90, 70, 40]); });
T.flowering_azalea_side = () => { const t = T.azalea_side(); const r = rngFor('fa'); for (let i = 0; i < 10; i++) { const x = 2 + r() * 12, y = 1 + r() * 11; if (t.alpha(Math.round(x), Math.round(y))) t.set(x, y, [210, 110, 200]); } return t; };
T.cave_vines = () => sprite('cvines', (t, r) => { for (let y = 0; y < 16; y++) { t.set(7 + Math.round(Math.sin(y * 0.8)), y, [76, 110, 40]); if (y % 4 === 1) t.set(9, y, [80, 120, 40]); if (y % 5 === 3) t.set(5, y, [90, 130, 46]); } });
T.cave_vines_lit = () => { const t = T.cave_vines(); t.disc(10, 6, 1.6, [255, 170, 60]); t.disc(6, 12, 1.6, [255, 170, 60]); return t; };
T.spore_blossom = () => sprite('spore', (t) => { for (let a = 0; a < 6; a++) { const ang = (a * Math.PI) / 3; t.line(8, 8, 8 + Math.cos(ang) * 7, 8 + Math.sin(ang) * 7, [220, 100, 180]); } t.disc(8, 8, 2.5, [110, 160, 60]); });
T.hanging_roots = () => sprite('roots', (t, r) => { for (let i = 0; i < 5; i++) { const x = 2 + i * 3; const len = 6 + Math.floor(r() * 9); t.line(x, 0, x + (r() < 0.5 ? 1 : -1), len, [160, 116, 90]); } });
T.glow_lichen = () => sprite('lichen', (t, r) => { for (let i = 0; i < 22; i++) { const x = Math.floor(r() * 16), y = Math.floor(r() * 16); t.set(x, y, [120, 170, 140]); if (r() < 0.4) t.set(x + 1, y, [200, 230, 170]); } });
T.small_dripleaf = () => sprite('sdl', (t) => { t.line(8, 15, 8, 8, [70, 120, 40]); t.poly([[2, 8], [8, 5], [14, 8], [8, 10]], [96, 160, 56]); });
T.big_dripleaf_top = () => { const t = noisy([96, 160, 56], 0.12, 'bdl'); t.line(0, 0, 15, 15, [70, 120, 40]); t.line(15, 0, 0, 15, [70, 120, 40]); return t; };
T.sculk = () => { const t = noisy([12, 30, 36], 0.25, 'sculk'); const r = rngFor('sk'); for (let i = 0; i < 12; i++) t.set(r() * 16, r() * 16, [40, 200, 210]); return t; };

T.dirt = () => noisy([134, 96, 67], 0.22, 'dirt', { blobs: 10 });
T.coarse_dirt = () => { const t = T.dirt(); const r = rngFor('cd'); for (let i = 0; i < 30; i++) t.set(r() * 16, r() * 16, [96, 70, 50]); return t; };
T.rooted_dirt = () => { const t = T.dirt(); t.line(3, 2, 6, 9, [170, 130, 100]); t.line(6, 9, 5, 14, [170, 130, 100]); t.line(11, 1, 12, 7, [170, 130, 100]); return t; };
T.mud = () => noisy([60, 57, 61], 0.12, 'mud', { blobs: 6 });
T.packed_mud = () => noisy([142, 107, 80], 0.12, 'pmud', { blobs: 8 });
T.mud_bricks = () => bricks([137, 104, 79], [100, 78, 58], 'mbricks', 4, 2, 0.12);
T.grass_top = () => noisy([95, 159, 53], 0.24, 'grass', { blobs: 8 });
T.grass_side = () => { const t = T.dirt(); const g = T.grass_top(); const r = rngFor('gs'); for (let x = 0; x < 16; x++) { const h = 3 + Math.floor(r() * 3); for (let y = 0; y < h; y++) t.set(x, y, g.get(x, y)); } return t; };
T.podzol_top = () => noisy([91, 63, 24], 0.24, 'podzol', { blobs: 10 });
T.podzol_side = () => { const t = T.dirt(); const g = T.podzol_top(); for (let x = 0; x < 16; x++) for (let y = 0; y < 3 + (x % 3 === 0 ? 1 : 0); y++) t.set(x, y, g.get(x, y)); return t; };
T.farmland = () => { const t = noisy([90, 60, 38], 0.15, 'farm'); for (let y = 0; y < 16; y += 4) t.line(0, y, 15, y, [70, 46, 28]); return t; };
T.sand = () => noisy([219, 207, 163], 0.1, 'sand', { blobs: 4 });
T.red_sand = () => noisy([190, 102, 33], 0.12, 'rsand', { blobs: 4 });
T.gravel = () => voronoi([132, 127, 126], 'gravel', 14, 0.25, 0.5);
T.clay = () => noisy([160, 166, 179], 0.08, 'clay', { blobs: 6 });
T.bedrock = () => voronoi([86, 86, 86], 'bedrock', 10, 0.5, 0.8);
T.obsidian = () => { const t = noisy([20, 18, 30], 0.3, 'obs'); const r = rngFor('obsp'); for (let i = 0; i < 14; i++) t.set(r() * 16, r() * 16, [60, 40, 90]); return t; };
T.snow = () => noisy([243, 251, 251], 0.04, 'snow');
T.powder_snow = () => noisy([236, 244, 252], 0.08, 'psnow', { blobs: 5 });
T.ice = () => { const t = noisy([145, 183, 253], 0.08, 'ice'); t.map((c) => [c[0], c[1], c[2], 190]); t.line(3, 3, 7, 7, [200, 220, 255], 200); return t; };
T.packed_ice = () => noisy([140, 175, 240], 0.1, 'pice', { blobs: 6 });
T.blue_ice = () => noisy([116, 166, 252], 0.1, 'bice', { blobs: 6 });
T.water = () => { const t = noisy([46, 92, 210], 0.12, 'water', { rows: 0.15 }); return t.map((c) => [c[0], c[1], c[2], 180]); };
T.lava = () => { const t = noisy([210, 96, 18], 0.25, 'lava', { blobs: 10 }); const r = rngFor('lavab'); for (let i = 0; i < 18; i++) t.set(r() * 16, r() * 16, [255, 200, 60]); return t; };

for (const [o, cols] of Object.entries(ORE_COL)) {
  T[`${o}_ore`] = () => ore(stoneTile(o + 'ore'), cols, o + '_ore');
  T[`deepslate_${o}_ore`] = () => ore(deepTile(o + 'dore'), cols, 'deepslate_' + o + '_ore');
}
T.raw_iron_block = () => noisy([166, 135, 107], 0.2, 'rib', { blobs: 8 });
T.raw_copper_block = () => noisy([154, 106, 79], 0.2, 'rcb', { blobs: 8 });
T.raw_gold_block = () => noisy([221, 169, 46], 0.2, 'rgb', { blobs: 8 });
const metal = (c, n) => () => { const t = bevel(noisy(c, 0.06, n), 0.2); t.line(2, 2, 13, 2, shade(c, 0.25)); return t; };
T.iron_block = metal([220, 220, 220], 'ib');
T.gold_block = metal([250, 215, 60], 'gb');
T.diamond_block = metal([100, 230, 225], 'db');
T.emerald_block = metal([40, 200, 100], 'eb');
T.lapis_block = () => noisy([35, 70, 170], 0.2, 'lb', { blobs: 8 });
T.redstone_block = () => { const t = bevel(noisy([175, 25, 15], 0.15, 'rsb'), 0.15); return t; };
T.coal_block = () => noisy([22, 22, 22], 0.25, 'cb', { blobs: 6 });
T.bone_block_side = () => { const t = noisy([229, 226, 208], 0.06, 'bones', { rows: 0.12 }); return t; };
T.bone_block_top = () => { const t = noisy([229, 226, 208], 0.06, 'bonet'); t.disc(4, 4, 2, [200, 196, 176]); t.disc(11, 11, 2, [200, 196, 176]); return t; };

for (const [age, c] of Object.entries(COPPER)) {
  T[`${age}copper`] = () => { const t = noisy(c, 0.12, age + 'cu', { blobs: 6 }); if (age) { const r = rngFor(age + 'ox'); for (let i = 0; i < 20; i++) t.set(r() * 16, r() * 16, shade(c, -0.2)); } return bevel(t, 0.1); };
  T[`${age}cut_copper`] = () => { const t = T[`${age}copper`](); for (const v of [0, 8]) { t.line(0, v, 15, v, shade(c, -0.3)); t.line(v, 0, v, 15, shade(c, -0.3)); } return t; };
  T[`${age}chiseled_copper`] = () => { const t = T[`${age}copper`](); t.rect(3, 3, 10, 10, shade(c, -0.25)); t.rect(5, 5, 6, 6, shade(c, 0.15)); return t; };
  T[`${age}copper_grate`] = () => { const t = new Tile(); t.each((x, y) => { if (x % 4 === 0 || y % 4 === 0) t.set(x, y, shade(c, ((x + y) % 3) * 0.05)); }); return t; };
  T[`${age}copper_bulb`] = () => { const t = T[`${age}copper`](); t.rect(3, 3, 10, 10, [60, 40, 30]); t.rect(5, 5, 6, 6, [255, 220, 150]); return t; };
  T[`${age}copper_door_top`] = () => { const t = T[`${age}copper`](); t.rect(3, 3, 4, 10, [0, 0, 0], 0); t.rect(9, 3, 4, 10, [0, 0, 0], 0); return t; };
  T[`${age}copper_door_bottom`] = () => { const t = T[`${age}copper`](); t.rect(3, 3, 10, 10, shade(c, -0.2)); return t; };
  T[`${age}copper_trapdoor`] = () => { const t = T[`${age}copper`](); t.rect(3, 3, 4, 4, [0, 0, 0], 0); t.rect(9, 3, 4, 4, [0, 0, 0], 0); t.rect(3, 9, 4, 4, [0, 0, 0], 0); t.rect(9, 9, 4, 4, [0, 0, 0], 0); return t; };
  T[`${age}copper_door_item`] = () => sprite(age + 'cdi', (t) => { t.rect(4, 0, 8, 16, c); t.rect(5, 2, 2, 5, [0, 0, 0], 0); t.rect(9, 2, 2, 5, [0, 0, 0], 0); t.set(10, 10, shade(c, -0.4)); });
}
T.lightning_rod = () => sprite('lrod', (t) => { t.rect(7, 2, 2, 14, COPPER['']); t.rect(6, 0, 4, 3, shade(COPPER[''], 0.2)); });

for (const [w, c] of Object.entries(WOOD)) {
  T[`${w}_planks`] = () => planks(c.planks, w + 'planks');
  T[`${w}_log`] = () => (w === 'birch' ? (() => { const t = noisy(c.bark, 0.06, 'birchbark'); const r = rngFor('birchm'); for (let i = 0; i < 7; i++) { const y = Math.floor(r() * 16), x = Math.floor(r() * 12); t.line(x, y, x + 2 + Math.floor(r() * 3), y, [40, 40, 40]); } return t; })() : bark(c.bark, w + 'bark'));
  T[`${w}_log_top`] = () => logTop(c.bark, c.planks, w + 'logtop');
  T[`stripped_${w}_log`] = () => noisy(c.stripped, 0.1, w + 'strip', { cols: 0.2 });
  T[`stripped_${w}_log_top`] = () => logTop(c.stripped, shade(c.stripped, -0.05), w + 'striptop');
  T[`${w}_leaves`] = () => { const t = noisy(c.leaves, 0.3, w + 'leaves'); const r = rngFor(w + 'holes'); t.each((x, y) => { if (r() < 0.16) t.set(x, y, [0, 0, 0], 0); }); return t; };
  T[`${w}_sapling`] = () => sprite(w + 'sap', (t, r) => { t.line(8, 15, 8, 9, c.bark); t.disc(8, 6.5, 4.2, c.leaves); t.each((x, y) => { if (t.alpha(x, y) && y < 11 && r() < 0.35) t.set(x, y, shade(c.leaves, -0.25)); }); });
  T[`${w}_door_top`] = () => { const t = planks(c.planks, w + 'dt'); t.rect(3, 3, 4, 5, [0, 0, 0], 0); t.rect(9, 3, 4, 5, [0, 0, 0], 0); return t; };
  T[`${w}_door_bottom`] = () => { const t = planks(c.planks, w + 'db'); t.rect(3, 2, 10, 11, shade(c.planks, -0.15)); return t; };
  T[`${w}_trapdoor`] = () => { const t = planks(c.planks, w + 'td'); t.rect(3, 3, 4, 4, [0, 0, 0], 0); t.rect(9, 3, 4, 4, [0, 0, 0], 0); t.rect(3, 9, 4, 4, [0, 0, 0], 0); t.rect(9, 9, 4, 4, [0, 0, 0], 0); return t; };
  T[`${w}_door_item`] = () => sprite(w + 'di', (t) => { t.rect(4, 0, 8, 16, c.planks); t.rect(5, 2, 2, 4, [0, 0, 0], 0); t.rect(9, 2, 2, 4, [0, 0, 0], 0); t.line(4, 8, 11, 8, shade(c.planks, -0.3)); t.set(10, 10, [40, 40, 40]); });
}
T.azalea_leaves = () => { const t = noisy([94, 126, 46], 0.3, 'azl'); const r = rngFor('azlh'); t.each((x, y) => { if (r() < 0.12) t.set(x, y, [0, 0, 0], 0); }); return t; };
T.flowering_azalea_leaves = () => { const t = T.azalea_leaves(); const r = rngFor('fazl'); for (let i = 0; i < 14; i++) t.set(r() * 16, r() * 16, [214, 110, 200]); return t; };

// plants
T.short_grass = () => sprite('sgrass', (t, r) => { for (let i = 0; i < 9; i++) { const x = 1 + i * 1.7; t.line(x, 15, x + (r() - 0.5) * 3, 5 + r() * 6, shade([95, 159, 53], (r() - 0.5) * 0.4)); } });
T.fern = () => sprite('fern', (t) => { for (let i = 0; i < 3; i++) { const bx = 3 + i * 5; t.line(bx, 15, bx + 1, 3, [70, 130, 50]); for (let y = 4; y < 14; y += 2) { t.set(bx - 1, y, [80, 150, 60]); t.set(bx + 2, y + 1, [80, 150, 60]); } } });
T.dead_bush = () => sprite('dbush', (t) => { const c = [120, 80, 40]; t.line(8, 15, 8, 9, c); t.line(8, 9, 4, 4, c); t.line(8, 10, 12, 5, c); t.line(6, 7, 6, 3, c); t.line(10, 7, 13, 8, c); });
const FLOWER_COL = { dandelion: [[250, 220, 40], null], poppy: [[220, 30, 30], [20, 20, 20]], blue_orchid: [[40, 170, 230], null], allium: [[190, 110, 230], null], azure_bluet: [[230, 230, 240], [240, 220, 80]], red_tulip: [[230, 40, 30], null], orange_tulip: [[240, 130, 30], null], white_tulip: [[240, 240, 240], null], pink_tulip: [[240, 160, 200], null], oxeye_daisy: [[245, 245, 245], [240, 200, 40]], cornflower: [[70, 110, 230], null], lily_of_the_valley: [[250, 250, 250], null] };
for (const [f, [petal, center]] of Object.entries(FLOWER_COL)) T[f] = () => crossPlant([60, 140, 50], petal, center, f);
T.brown_mushroom = () => sprite('bm', (t) => { t.rect(7, 10, 2, 5, [220, 200, 170]); t.poly([[3, 10], [8, 6], [13, 10]], [150, 110, 80]); });
T.red_mushroom = () => sprite('rm', (t) => { t.rect(7, 10, 2, 5, [220, 200, 170]); t.disc(8, 9, 4.5, [200, 30, 30]); t.rect(3, 10, 11, 4, [0, 0, 0], 0); t.rect(7, 10, 2, 5, [220, 200, 170]); t.set(6, 7, [255, 255, 255]); t.set(10, 6, [255, 255, 255]); });
T.sugar_cane = () => sprite('cane', (t) => { for (const x of [3, 8, 12]) { t.line(x, 0, x, 15, [130, 190, 90]); t.line(x + 1, 0, x + 1, 15, [100, 160, 70]); for (let y = 2; y < 16; y += 5) t.set(x, y, [200, 230, 160]); } });
T.sugar_cane_item = T.sugar_cane;
T.cactus_side = () => { const t = noisy([84, 130, 50], 0.12, 'cactus', { cols: 0.25 }); for (let y = 1; y < 16; y += 4) { t.set(0, y, [230, 230, 190]); t.set(15, y + 2, [230, 230, 190]); } return t; };
T.cactus_top = () => { const t = noisy([94, 140, 56], 0.1, 'cactt'); t.rect(4, 4, 8, 8, shade([94, 140, 56], 0.15)); return t; };
T.cactus_bottom = () => noisy([170, 190, 110], 0.1, 'cactb');
for (let st = 0; st < 7; st++) T[`wheat_stage${st}`] = () => sprite('wheat' + st, (t) => { const top = 14 - Math.round(st * 1.5); const col = st < 5 ? [70, 150, 40] : [150, 160, 50]; for (const x of [2, 6, 10, 13]) { t.line(x, 15, x, top, col); if (st >= 4) t.rect(x - 1, top - 1, 2, 3, [180, 180, 70]); } });
T.wheat_stage7 = () => sprite('wheat', (t) => { for (const x of [2, 6, 10, 13]) { t.line(x, 15, x, 4, [180, 150, 50]); t.rect(x - 1, 2, 2, 5, [220, 190, 80]); } });
T.pumpkin_side = () => { const t = noisy([227, 141, 26], 0.1, 'pumpkin'); for (const x of [0, 5, 10, 15]) t.line(x, 0, x, 15, [190, 110, 15]); return t; };
T.pumpkin_top = () => { const t = noisy([210, 126, 24], 0.1, 'ptop'); t.rect(6, 6, 4, 4, [90, 110, 40]); return t; };
T.carved_pumpkin = () => { const t = T.pumpkin_side(); t.rect(3, 4, 3, 3, [40, 20, 0]); t.rect(10, 4, 3, 3, [40, 20, 0]); t.rect(3, 10, 10, 2, [40, 20, 0]); t.rect(5, 12, 6, 1, [40, 20, 0]); return t; };
T.jack_o_lantern = () => { const t = T.pumpkin_side(); t.rect(3, 4, 3, 3, [255, 220, 60]); t.rect(10, 4, 3, 3, [255, 220, 60]); t.rect(3, 10, 10, 2, [255, 220, 60]); t.rect(5, 12, 6, 1, [255, 220, 60]); return t; };
T.melon_side = () => { const t = noisy([110, 150, 30], 0.12, 'melon'); for (let x = 1; x < 16; x += 4) t.line(x, 0, x, 15, [190, 200, 60]); return t; };
T.melon_top = () => { const t = noisy([110, 150, 30], 0.12, 'melont'); t.disc(8, 8, 3, [150, 180, 50]); return t; };
T.hay_block_side = () => { const t = noisy([200, 170, 30], 0.15, 'hay', { cols: 0.25 }); t.line(0, 4, 15, 4, [130, 40, 20]); t.line(0, 11, 15, 11, [130, 40, 20]); return t; };
T.hay_block_top = () => noisy([190, 160, 30], 0.2, 'hayt', { blobs: 10 });
T.cobweb = () => sprite('web', (t) => { const c = [230, 230, 230]; t.line(0, 0, 15, 15, c); t.line(15, 0, 0, 15, c); t.line(8, 0, 8, 15, c); t.line(0, 8, 15, 8, c); for (const r of [3, 6]) { t.line(8 - r, 8, 8, 8 - r, c); t.line(8, 8 - r, 8 + r, 8, c); t.line(8 + r, 8, 8, 8 + r, c); t.line(8, 8 + r, 8 - r, 8, c); } });

// stone & masonry
T.sandstone = () => { const t = noisy([216, 203, 155], 0.06, 'sst'); for (const y of [3, 9, 13]) t.line(0, y, 15, y, [196, 182, 134]); t.line(0, 15, 15, 15, [180, 166, 120]); return t; };
T.sandstone_top = () => noisy([224, 214, 170], 0.06, 'sstt');
T.sandstone_bottom = () => noisy([214, 200, 152], 0.08, 'sstb');
T.cut_sandstone = () => { const t = bevel(noisy([216, 203, 155], 0.05, 'cutss'), 0.15); t.line(0, 4, 15, 4, [196, 182, 134]); t.line(0, 11, 15, 11, [196, 182, 134]); return t; };
T.chiseled_sandstone = () => { const t = T.cut_sandstone(); t.rect(5, 6, 6, 4, [180, 166, 120]); t.rect(7, 7, 2, 2, [216, 203, 155]); return t; };
T.bricks = () => bricks([150, 74, 58], [180, 170, 160], 'bricks', 4, 2, 0.18);

// utility
T.glass = () => { const t = new Tile(); t.each((x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) t.set(x, y, [220, 240, 245]); }); t.line(3, 5, 6, 2, [255, 255, 255]); t.line(3, 7, 8, 2, [255, 255, 255]); return t; };
T.iron_bars = () => sprite('bars', (t) => { for (const x of [1, 5, 9, 13]) t.rect(x, 0, 2, 16, [110, 112, 114]); t.rect(0, 0, 16, 1, [90, 92, 94]); t.rect(0, 15, 16, 1, [90, 92, 94]); });
T.chain = () => sprite('chain', (t) => { for (let y = 0; y < 16; y += 4) { t.rect(7, y, 2, 3, [70, 72, 80]); t.set(6, y + 1, [90, 92, 100]); t.set(9, y + 1, [90, 92, 100]); } });
T.chain_item = T.chain;
T.iron_door_top = () => { const t = bevel(noisy([200, 200, 200], 0.05, 'idt'), 0.15); t.rect(3, 3, 4, 5, [0, 0, 0], 0); t.rect(9, 3, 4, 5, [0, 0, 0], 0); return t; };
T.iron_door_bottom = () => { const t = bevel(noisy([200, 200, 200], 0.05, 'idb'), 0.15); t.rect(3, 2, 10, 11, [170, 170, 170]); return t; };
T.iron_door_item = () => sprite('idi', (t) => { t.rect(4, 0, 8, 16, [200, 200, 200]); t.rect(5, 2, 2, 4, [0, 0, 0], 0); t.rect(9, 2, 2, 4, [0, 0, 0], 0); t.set(10, 10, [80, 80, 80]); });
T.iron_trapdoor = () => { const t = bevel(noisy([200, 200, 200], 0.05, 'itd'), 0.15); t.rect(3, 3, 4, 4, [0, 0, 0], 0); t.rect(9, 3, 4, 4, [0, 0, 0], 0); t.rect(3, 9, 4, 4, [0, 0, 0], 0); t.rect(9, 9, 4, 4, [0, 0, 0], 0); return t; };
T.ladder = () => sprite('ladder', (t) => { const c = [130, 100, 60]; t.rect(2, 0, 2, 16, c); t.rect(12, 0, 2, 16, c); for (let y = 2; y < 16; y += 4) t.rect(2, y, 12, 2, shade(c, 0.1)); });
T.scaffolding_top = () => { const t = new Tile(); const c = [190, 150, 80]; t.rect(0, 0, 16, 2, c); t.rect(0, 14, 16, 2, c); t.rect(0, 0, 2, 16, c); t.rect(14, 0, 2, 16, c); t.line(2, 2, 13, 13, shade(c, -0.1)); return t; };
T.scaffolding_side = () => { const t = new Tile(); const c = [190, 150, 80]; t.rect(0, 0, 16, 2, c); t.rect(0, 0, 2, 16, c); t.rect(14, 0, 2, 16, c); t.line(2, 13, 13, 2, shade(c, -0.1)); return t; };
T.torch = () => sprite('torch', (t) => { t.rect(7, 6, 2, 10, [120, 90, 50]); t.rect(7, 4, 2, 2, [255, 220, 80]); t.set(7, 3, [255, 250, 200]); t.set(8, 3, [255, 160, 40]); });
T.redstone_torch = () => sprite('rtorch', (t) => { t.rect(7, 6, 2, 10, [120, 90, 50]); t.rect(7, 4, 2, 2, [255, 40, 30]); t.set(7, 3, [255, 140, 120]); });
T.lantern = () => { const t = new Tile(); t.rect(5, 6, 6, 8, [60, 60, 70]); t.rect(6, 7, 4, 6, [255, 200, 90]); t.rect(6, 4, 4, 2, [60, 60, 70]); return t; };
T.lantern_item = () => sprite('lanti', (t) => { t.rect(5, 6, 6, 9, [60, 60, 70]); t.rect(6, 8, 4, 5, [255, 200, 90]); t.rect(6, 4, 4, 2, [60, 60, 70]); t.rect(7, 1, 2, 3, [90, 90, 100]); });
T.campfire = () => { const t = new Tile(); t.rect(0, 12, 16, 3, [110, 80, 40]); t.poly([[3, 12], [8, 2], [13, 12]], [255, 150, 30]); t.poly([[5, 12], [8, 5], [11, 12]], [255, 230, 120]); return t; };
T.campfire_item = T.campfire;
T.crafting_table_top = () => { const t = planks(WOOD.oak.planks, 'cttop'); t.rect(1, 1, 14, 14, shade(WOOD.oak.planks, -0.05)); for (const v of [5, 10]) { t.line(1, v, 14, v, [90, 70, 40]); t.line(v, 1, v, 14, [90, 70, 40]); } return t; };
T.crafting_table_side = () => { const t = planks(WOOD.oak.planks, 'ctside'); t.rect(0, 0, 16, 3, [120, 90, 55]); t.line(3, 6, 6, 11, [160, 160, 170]); t.rect(2, 5, 3, 2, [100, 100, 110]); t.line(10, 5, 13, 12, [110, 80, 50]); t.rect(12, 4, 2, 3, [160, 160, 170]); return t; };
T.crafting_table_front = () => { const t = T.crafting_table_side(); t.rect(6, 7, 4, 6, [80, 60, 35]); return t; };
const ovenFront = (c, n, glow) => () => { const t = bevel(noisy(c, 0.12, n), 0.1); t.rect(3, 8, 10, 6, [30, 30, 30]); t.rect(4, 3, 8, 2, shade(c, -0.3)); if (glow) t.rect(4, 11, 8, 3, glow); return t; };
T.furnace_front = ovenFront([115, 115, 115], 'ff');
T.furnace_side = () => stoneTile('fside');
T.furnace_top = () => bevel(noisy([125, 125, 125], 0.1, 'ftop'), 0.12);
T.blast_furnace_front = ovenFront([95, 95, 100], 'bff');
T.blast_furnace_side = () => { const t = bevel(noisy([100, 100, 105], 0.1, 'bfs'), 0.15); t.rect(2, 10, 12, 4, [70, 70, 75]); return t; };
T.blast_furnace_top = () => bevel(noisy([110, 110, 115], 0.08, 'bft'), 0.12);
T.smoker_front = ovenFront([100, 84, 60], 'sf');
T.smoker_side = () => { const t = noisy([108, 90, 66], 0.12, 'ss'); t.rect(0, 12, 16, 4, [70, 70, 70]); return t; };
T.smoker_top = () => noisy([80, 80, 80], 0.12, 'st');
T.chest_side = () => { const t = planks([160, 110, 40], 'chests'); t.rect(0, 5, 16, 1, [60, 40, 15]); return bevel(t, 0.1); };
T.chest_top = () => bevel(planks([160, 110, 40], 'chestt'), 0.12);
T.chest_front = () => { const t = T.chest_side(); t.rect(7, 4, 2, 4, [200, 200, 210]); return t; };
T.barrel_side = () => { const t = planks([120, 86, 46], 'barrels').rot90(); t.rect(0, 2, 16, 1, [60, 60, 60]); t.rect(0, 13, 16, 1, [60, 60, 60]); return t; };
T.barrel_top = () => { const t = bevel(planks([140, 100, 56], 'barrelt'), 0.2); t.rect(5, 5, 6, 6, [70, 50, 30]); return t; };
T.barrel_bottom = () => bevel(planks([140, 100, 56], 'barrelb'), 0.2);
T.bookshelf = () => { const t = planks(WOOD.oak.planks, 'bshelf'); const r = rngFor('books'); for (const y0 of [1, 9]) { let x = 1; while (x < 15) { const w = 1 + Math.floor(r() * 2); const col = [[160, 40, 40], [40, 80, 160], [50, 120, 50], [180, 140, 60], [110, 60, 140]][Math.floor(r() * 5)]; t.rect(x, y0, w, 6, col); x += w; } } return t; };
T.tnt_side = () => { const t = noisy([200, 40, 30], 0.08, 'tnts'); t.rect(0, 6, 16, 4, [230, 230, 230]); t.rect(3, 7, 10, 2, [30, 30, 30]); return t; };
T.tnt_top = () => { const t = noisy([200, 40, 30], 0.08, 'tntt'); t.disc(8, 8, 2, [60, 60, 60]); return t; };
T.tnt_bottom = () => noisy([200, 40, 30], 0.08, 'tntb');
T.redstone_lamp = () => { const t = bevel(noisy([110, 70, 40], 0.12, 'rlamp'), 0.15); t.rect(3, 3, 10, 10, [150, 100, 60]); t.line(3, 8, 12, 8, [90, 60, 30]); t.line(8, 3, 8, 12, [90, 60, 30]); return t; };
T.note_block = () => { const t = planks([110, 70, 50], 'note'); t.rect(4, 4, 8, 8, [70, 45, 30]); return t; };
T.jukebox_top = () => { const t = T.note_block(); t.rect(3, 7, 10, 2, [30, 30, 30]); return t; };
const workstation = (name, col) => { T[`${name}_top`] = () => bevel(noisy(col, 0.1, name + 't'), 0.18); T[`${name}_bottom`] = () => noisy(shade(col, -0.2), 0.1, name + 'b'); T[`${name}_side`] = () => { const t = bevel(noisy(col, 0.12, name + 's'), 0.15); const r = rngFor(name + 'p'); t.rect(4, 4, 8, 8, shade(col, (r() - 0.5) * 0.6)); t.rect(6, 6, 4, 4, shade(col, 0.3)); return t; }; };
workstation('loom', [180, 150, 110]); workstation('cartography_table', [110, 80, 50]); workstation('fletching_table', [200, 180, 130]);
workstation('smithing_table', [60, 60, 70]); workstation('stonecutter', [130, 130, 130]); workstation('composter', [120, 80, 40]);
workstation('cauldron', [60, 60, 66]); workstation('lectern', [160, 120, 70]); workstation('grindstone', [140, 140, 140]); workstation('anvil', [64, 64, 64]);
T.target_side = () => { const t = new Tile(); t.each((x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); t.set(x, y, Math.floor(d / 2) % 2 ? [230, 220, 200] : [200, 40, 40]); }); return t; };
T.target_top = () => noisy([200, 190, 160], 0.1, 'tgt');
T.lever = () => sprite('lever', (t) => { t.rect(4, 11, 8, 4, [120, 120, 120]); t.line(8, 11, 11, 3, [120, 90, 50]); });
T.dried_kelp_side = () => noisy([50, 62, 40], 0.15, 'dks', { rows: 0.25 });
T.dried_kelp_top = () => noisy([46, 58, 36], 0.15, 'dkt', { blobs: 6 });
T.cake_top = () => { const t = noisy([245, 240, 235], 0.04, 'caket'); const r = rngFor('cakec'); for (let i = 0; i < 8; i++) t.set(r() * 16, r() * 16, [220, 30, 40]); return t; };
T.cake_side = () => { const t = noisy([230, 200, 150], 0.06, 'cakes'); t.rect(0, 0, 16, 4, [245, 240, 235]); t.rect(0, 9, 16, 2, [220, 40, 40]); return t; };
T.cake_bottom = () => noisy([200, 160, 110], 0.08, 'cakeb');
T.cake_item = () => sprite('cakei', (t) => { t.rect(2, 7, 12, 7, [230, 200, 150]); t.rect(2, 5, 12, 3, [245, 240, 235]); t.set(4, 4, [220, 30, 40]); t.set(9, 4, [220, 30, 40]); t.set(12, 4, [220, 30, 40]); });
T.sponge = () => { const t = noisy([205, 205, 80], 0.12, 'sponge'); const r = rngFor('sph'); for (let i = 0; i < 18; i++) t.set(r() * 16, r() * 16, [150, 150, 50]); return t; };
T.slime_block = () => { const t = noisy([120, 200, 100], 0.08, 'slime'); t.map((c) => [c[0], c[1], c[2], 190]); t.rect(3, 3, 10, 10, [100, 180, 80], 230); return t; };
T.honey_block = () => { const t = noisy([250, 180, 40], 0.08, 'honey'); t.map((c) => [c[0], c[1], c[2], 200]); t.rect(3, 3, 10, 10, [230, 160, 30], 230); return t; };
T.terracotta = () => noisy([152, 94, 67], 0.08, 'terracotta');

for (const [c, col] of Object.entries(COLORS)) {
  T[`${c}_wool`] = () => { const t = noisy(col, 0.12, c + 'wool'); t.each((x, y) => { if ((x + y * 3) % 7 === 0) t.set(x, y, shade(t.get(x, y), -0.1)); }); return t; };
  T[`${c}_stained_glass`] = () => { const t = new Tile(); t.fill(col, 110); t.each((x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) t.set(x, y, shade(col, 0.2), 220); }); t.line(3, 6, 6, 3, shade(col, 0.5), 200); return t; };
  T[`${c}_terracotta`] = () => noisy(mix([152, 94, 67], col, 0.55), 0.07, c + 'tc');
  T[`${c}_glazed_terracotta`] = () => { const t = noisy(col, 0.05, c + 'gt'); t.rect(0, 0, 8, 8, shade(col, 0.3)); t.rect(8, 8, 8, 8, shade(col, -0.25)); t.disc(8, 8, 3, [240, 240, 230]); t.line(0, 15, 15, 0, shade(col, -0.4)); return t; };
  T[`${c}_concrete`] = () => noisy(col, 0.03, c + 'conc');
  T[`${c}_concrete_powder`] = () => noisy(shade(col, 0.08), 0.2, c + 'cpow');
  T[`${c}_bed_top`] = () => { const t = noisy(col, 0.08, c + 'bedt'); t.rect(0, 0, 16, 5, [235, 235, 235]); return t; };
  T[`${c}_bed_side`] = () => { const t = noisy(col, 0.08, c + 'beds'); t.rect(0, 10, 16, 6, WOOD.oak.planks); t.rect(0, 6, 4, 4, [235, 235, 235]); return t; };
  T[`${c}_candle`] = () => sprite(c + 'candle', (t) => { t.rect(6, 6, 4, 10, col); t.set(8, 5, [40, 40, 40]); t.set(8, 4, [255, 200, 80]); });
}
T.candle = () => sprite('candle', (t) => { t.rect(6, 6, 4, 10, [230, 210, 160]); t.set(8, 5, [40, 40, 40]); t.set(8, 4, [255, 200, 80]); });

// Block-breaking crack overlays (destroy_0..9) and a fallback.
for (let i = 0; i < 10; i++) {
  T[`destroy_${i}`] = () => {
    const t = new Tile();
    const r = rngFor('crack');
    const n = 4 + i * 5;
    for (let k = 0; k < n; k++) {
      let x = 8, y = 8;
      const len = 2 + Math.floor(r() * (2 + i));
      const ang = r() * Math.PI * 2;
      x = 8 + Math.cos(ang) * r() * (2 + i * 0.7);
      y = 8 + Math.sin(ang) * r() * (2 + i * 0.7);
      for (let s = 0; s < len; s++) { t.set(x, y, [0, 0, 0], 150); x += Math.cos(ang + (r() - 0.5)); y += Math.sin(ang + (r() - 0.5)); }
    }
    return t;
  };
}

function terrain(name) {
  if (T[name]) return T[name]();
  for (const [re, fn] of RULES) { const m = name.match(re); if (m) return fn(m); }
  return null;
}

module.exports = { terrain, COLORS, WOOD, COPPER };
