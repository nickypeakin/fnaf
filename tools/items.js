// Procedural 16x16 item sprites (tools, food, materials...). Drawn, then outlined like classic item art.
'use strict';
const { Tile, shade, hex, rngFor } = require('./pixels');
const { COLORS, WOOD } = require('./textures');

const STICK = [137, 103, 39];
const MAT = {
  wooden: [160, 126, 72], stone: [130, 130, 130], iron: [216, 216, 216], golden: [250, 220, 70],
  diamond: [80, 225, 220], leather: [150, 90, 50], chainmail: [150, 150, 160], netherite: [70, 60, 64],
};

function spr(draw, name, outline = true) {
  const t = new Tile();
  draw(t, rngFor(name));
  if (outline) t.outline(0.55);
  return t;
}

// Shaded thick line: light on one side, dark on the other.
function thick(t, x0, y0, x1, y1, c, w = 2) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    t.set(x, y, shade(c, 0.15));
    if (w > 1) t.set(x + 1, y, shade(c, -0.15));
  }
}

function handle(t, len = 8) { thick(t, 2, 13, 2 + len, 13 - len, STICK); }

const TOOL = {
  pickaxe: (t, c) => {
    handle(t, 8);
    const pts = [];
    for (let i = 0; i <= 20; i++) { const s = i / 20; pts.push([(1 - s) * (1 - s) * 4 + 2 * (1 - s) * s * 13 + s * s * 14, (1 - s) * (1 - s) * 2 + 2 * (1 - s) * s * 1 + s * s * 11]); }
    for (const [x, y] of pts) { t.set(x, y, shade(c, 0.2)); t.set(x, y + 1, c); t.set(x - 1, y + 1, shade(c, -0.2)); }
  },
  axe: (t, c) => { handle(t, 9); t.poly([[8, 2], [12, 1], [15, 4], [14, 8], [11, 7], [9, 5]], c); t.line(12, 2, 14, 5, shade(c, 0.3)); },
  shovel: (t, c) => { handle(t, 8); t.poly([[9, 4], [12, 1], [15, 3], [15, 5], [12, 8]], c); t.line(12, 2, 14, 4, shade(c, 0.3)); },
  hoe: (t, c) => { handle(t, 9); thick(t, 8, 3, 12, 1, c); t.set(13, 2, c); t.set(13, 3, shade(c, -0.2)); t.set(12, 3, shade(c, -0.1)); },
  sword: (t, c) => { thick(t, 5, 10, 14, 1, c); t.line(3, 8, 7, 12, shade(c, -0.25)); t.line(4, 8, 8, 12, shade(c, -0.1)); thick(t, 1, 14, 4, 11, STICK); },
};

const ARMOR_SHAPE = {
  helmet: (t, c) => { t.rect(3, 4, 10, 4, c); t.rect(3, 8, 3, 3, c); t.rect(10, 8, 3, 3, c); t.line(3, 4, 12, 4, shade(c, 0.25)); },
  chestplate: (t, c) => { t.rect(2, 3, 4, 4, c); t.rect(10, 3, 4, 4, c); t.rect(4, 5, 8, 9, c); t.rect(6, 3, 4, 2, [0, 0, 0], 0); t.line(4, 7, 11, 7, shade(c, 0.2)); },
  leggings: (t, c) => { t.rect(3, 2, 10, 4, c); t.rect(3, 6, 4, 9, c); t.rect(9, 6, 4, 9, c); t.line(3, 2, 12, 2, shade(c, 0.25)); },
  boots: (t, c) => { t.rect(2, 8, 4, 6, c); t.rect(10, 8, 4, 6, c); t.rect(1, 12, 5, 2, shade(c, -0.15)); t.rect(10, 12, 5, 2, shade(c, -0.15)); },
};

const pile = (c) => (t, r) => { for (let i = 0; i < 40; i++) { const x = 3 + r() * 10, y = 6 + r() * 8; if ((x - 8) ** 2 / 25 + (y - 11) ** 2 / 12 < 1) t.set(x, y, shade(c, (r() - 0.5) * 0.4)); } };
const lump = (c) => (t, r) => { t.poly([[3, 7], [6, 3], [11, 3], [13, 7], [12, 12], [7, 13], [3, 11]], c); for (let i = 0; i < 14; i++) t.set(4 + r() * 8, 4 + r() * 8, shade(c, (r() - 0.5) * 0.5)); };
const ingot = (c) => (t) => { t.poly([[2, 9], [7, 5], [14, 6], [9, 11]], c); t.line(3, 9, 8, 5, shade(c, 0.35)); t.line(9, 11, 14, 7, shade(c, -0.3)); };
const gem = (c) => (t) => { t.poly([[8, 2], [14, 7], [8, 14], [2, 7]], c); t.poly([[8, 2], [8, 14], [2, 7]], shade(c, 0.2)); t.line(4, 7, 12, 7, shade(c, 0.4)); };
const ball = (c) => (t) => { t.disc(8, 8, 5, c); t.disc(6.5, 6.5, 1.5, shade(c, 0.35)); };
const dye = (c) => (t) => { t.poly([[4, 6], [8, 3], [12, 6], [12, 12], [8, 14], [4, 12]], c); t.rect(6, 4, 4, 2, shade(c, 0.3)); t.set(6, 8, shade(c, 0.4)); };
const meat = (c, fat) => (t) => { t.poly([[2, 8], [5, 4], [11, 3], [14, 7], [12, 12], [6, 13]], c); t.line(4, 7, 11, 5, fat); t.disc(12, 10, 1.3, [235, 235, 230]); };
const bucket = (fill) => (t) => { t.poly([[3, 4], [13, 4], [12, 14], [4, 14]], [180, 180, 185]); t.line(3, 4, 12, 4, [220, 220, 225]); if (fill) t.rect(4, 5, 8, 3, fill); t.line(3, 4, 8, 0, [120, 120, 125]); t.line(8, 0, 13, 4, [120, 120, 125]); };

const ITEM = {
  stick: (t) => thick(t, 3, 13, 12, 4, STICK),
  coal: lump([40, 40, 40]), charcoal: lump([60, 50, 44]),
  raw_iron: lump([200, 160, 130]), raw_copper: lump([200, 120, 80]), raw_gold: lump([240, 200, 60]),
  iron_ingot: ingot([216, 216, 216]), copper_ingot: ingot([220, 120, 80]), gold_ingot: ingot([250, 215, 60]), mud_brick_item: ingot([140, 104, 78]),
  iron_nugget: (t) => { t.disc(7, 9, 2.5, [210, 210, 210]); t.disc(10, 7, 2, [190, 190, 190]); },
  gold_nugget: (t) => { t.disc(7, 9, 2.5, [250, 215, 60]); t.disc(10, 7, 2, [230, 190, 40]); },
  diamond: gem([80, 225, 220]), emerald: gem([40, 210, 100]),
  lapis_lazuli: (t) => { t.poly([[3, 9], [7, 3], [13, 5], [12, 12], [6, 13]], [40, 80, 200]); t.set(6, 7, [200, 210, 255]); t.set(10, 9, [200, 210, 255]); },
  redstone: pile([220, 20, 20]), gunpowder: pile([90, 90, 90]), sugar: pile([245, 245, 245]), glowstone_dust: pile([250, 210, 90]), bone_meal: pile([235, 235, 225]),
  amethyst_shard: (t) => { t.poly([[4, 13], [6, 5], [10, 2], [12, 6], [9, 13]], [160, 110, 230]); t.line(6, 11, 10, 4, [210, 180, 255]); },
  flint: (t) => { t.poly([[4, 12], [5, 5], [10, 3], [12, 9], [9, 13]], [70, 70, 75]); t.line(6, 6, 9, 4, [130, 130, 135]); },
  clay_ball: ball([160, 166, 179]), snowball: ball([245, 250, 252]), slime_ball: ball([110, 190, 90]),
  egg: (t) => { t.disc(8, 9, 4.5, [235, 220, 190]); t.rect(4, 3, 8, 3, [0, 0, 0], 0); t.disc(8, 7, 3.2, [235, 220, 190]); },
  brick: ingot([170, 80, 60]),
  bone: (t) => { thick(t, 4, 12, 11, 5, [235, 232, 220]); t.disc(4, 12, 1.6, [235, 232, 220]); t.disc(12, 4, 1.6, [235, 232, 220]); },
  string: (t) => { for (let i = 0; i < 14; i++) t.set(2 + i * 0.85, 8 + Math.sin(i) * 3, [240, 240, 240]); },
  feather: (t) => { t.poly([[3, 13], [6, 7], [12, 2], [13, 4], [8, 10]], [240, 240, 240]); t.line(3, 13, 12, 3, [200, 200, 200]); },
  leather: (t) => { t.poly([[3, 3], [13, 3], [12, 8], [13, 13], [3, 13], [4, 8]], [150, 90, 50]); },
  paper: (t) => { t.rect(3, 2, 10, 12, [245, 245, 240]); t.line(4, 5, 11, 5, [200, 200, 200]); t.line(4, 8, 11, 8, [200, 200, 200]); },
  book: (t) => { t.rect(3, 2, 10, 12, [130, 60, 40]); t.rect(11, 3, 2, 10, [240, 240, 230]); t.line(5, 5, 9, 5, [200, 160, 60]); },
  writable_book: (t) => { ITEM.book(t); t.line(6, 12, 13, 3, [40, 40, 40]); },
  wheat: (t) => { for (const x of [5, 8, 11]) { t.line(x, 15, x, 6, [180, 150, 50]); t.rect(x - 1, 2, 2, 5, [230, 200, 80]); } },
  wheat_seeds: (t) => { for (const [x, y] of [[5, 6], [9, 5], [7, 9], [11, 10], [5, 12]]) { t.set(x, y, [80, 160, 60]); t.set(x + 1, y, [60, 130, 40]); } },
  bread: (t) => { t.poly([[2, 10], [4, 6], [12, 5], [14, 8], [12, 12], [4, 12]], [190, 130, 60]); t.line(5, 8, 11, 7, [230, 180, 100]); },
  apple: (t) => { t.disc(8, 9, 5, [220, 30, 30]); t.line(8, 4, 9, 2, [100, 70, 30]); t.set(10, 3, [60, 160, 50]); t.set(6, 7, [255, 140, 140]); },
  golden_apple: (t) => { t.disc(8, 9, 5, [250, 210, 50]); t.line(8, 4, 9, 2, [100, 70, 30]); t.set(6, 7, [255, 250, 200]); },
  carrot: (t) => { t.poly([[3, 13], [10, 4], [13, 7]], [240, 130, 30]); t.line(11, 4, 14, 1, [60, 160, 50]); t.line(12, 5, 15, 3, [60, 160, 50]); },
  golden_carrot: (t) => { t.poly([[3, 13], [10, 4], [13, 7]], [250, 210, 60]); t.line(11, 4, 14, 1, [250, 230, 120]); },
  potato: (t) => { t.disc(8, 9, 4.5, [210, 170, 90]); t.set(6, 8, [150, 110, 50]); t.set(10, 11, [150, 110, 50]); },
  baked_potato: (t) => { t.disc(8, 9, 4.5, [190, 130, 60]); t.line(6, 8, 10, 8, [250, 230, 140]); },
  beef: meat([200, 50, 50], [240, 220, 220]), cooked_beef: meat([110, 60, 40], [150, 100, 70]),
  porkchop: meat([240, 150, 150], [255, 230, 230]), cooked_porkchop: meat([200, 150, 110], [230, 200, 160]),
  mutton: meat([210, 70, 70], [240, 220, 220]), cooked_mutton: meat([150, 80, 50], [190, 120, 80]),
  chicken: (t) => { t.disc(9, 7, 4, [240, 200, 180]); thick(t, 4, 13, 7, 10, [235, 232, 220]); },
  cooked_chicken: (t) => { t.disc(9, 7, 4, [190, 120, 60]); thick(t, 4, 13, 7, 10, [235, 232, 220]); },
  rotten_flesh: meat([110, 120, 60], [140, 90, 70]),
  cookie: (t) => { t.disc(8, 8, 5, [200, 140, 70]); for (const [x, y] of [[6, 6], [10, 7], [7, 10], [10, 10]]) t.set(x, y, [70, 40, 20]); },
  pumpkin_pie: (t) => { t.poly([[2, 9], [8, 4], [14, 9], [8, 13]], [230, 130, 40]); t.line(2, 9, 8, 13, [200, 150, 90]); t.line(8, 13, 14, 9, [200, 150, 90]); },
  bowl: (t) => { t.poly([[2, 7], [14, 7], [12, 12], [4, 12]], [140, 100, 50]); t.line(3, 7, 13, 7, [90, 60, 30]); },
  mushroom_stew: (t) => { ITEM.bowl(t); t.rect(3, 6, 10, 2, [170, 120, 80]); },
  glow_berries: (t) => { t.line(8, 2, 8, 8, [70, 110, 40]); t.disc(6, 10, 2.3, [255, 170, 60]); t.disc(10, 11, 2.3, [255, 170, 60]); },
  sweet_berries: (t) => { t.disc(6, 10, 2.3, [200, 30, 40]); t.disc(10, 9, 2.3, [200, 30, 40]); t.line(8, 3, 8, 7, [60, 120, 40]); },
  melon_slice: (t) => { t.poly([[2, 12], [14, 12], [8, 3]], [220, 50, 50]); t.line(2, 12, 14, 12, [80, 160, 40]); t.set(7, 8, [30, 30, 30]); t.set(9, 10, [30, 30, 30]); },
  beetroot: (t) => { t.disc(8, 10, 4, [150, 30, 50]); t.line(8, 6, 9, 2, [60, 140, 50]); },
  dried_kelp: (t) => { t.poly([[4, 13], [6, 3], [10, 3], [12, 13]], [50, 62, 40]); t.line(8, 4, 8, 12, [70, 82, 56]); },
  ink_sac: dye([30, 30, 40]), glow_ink_sac: dye([60, 220, 200]),
  honeycomb: (t) => { t.poly([[8, 2], [13, 5], [13, 11], [8, 14], [3, 11], [3, 5]], [240, 170, 40]); t.disc(8, 8, 1.5, [200, 120, 20]); },
  arrow: (t) => { t.line(3, 13, 12, 4, [140, 110, 70]); t.poly([[11, 3], [14, 2], [13, 5]], [180, 180, 190]); t.line(2, 12, 4, 14, [240, 240, 240]); t.line(2, 14, 3, 12, [220, 220, 220]); },
  bow: (t) => { for (let i = 0; i <= 12; i++) { const a = -Math.PI / 4 + (i / 12) * Math.PI; t.set(8 + Math.cos(a) * 7 - 3, 8 - Math.sin(a) * 7 + 3, [140, 100, 50]); } t.line(2, 4, 12, 14, [230, 230, 230]); },
  fishing_rod: (t) => { thick(t, 2, 14, 12, 2, STICK); t.line(13, 2, 13, 12, [220, 220, 220]); t.set(13, 12, [200, 30, 30]); },
  bucket: bucket(null), water_bucket: bucket([50, 90, 210]), lava_bucket: bucket([230, 110, 20]), powder_snow_bucket: bucket([240, 245, 250]),
  milk_bucket: bucket([250, 250, 250]), axolotl_bucket: bucket([240, 150, 190]),
  flint_and_steel: (t) => { t.disc(6, 9, 3.5, [170, 170, 175]); t.disc(6, 9, 1.8, [0, 0, 0], 0); t.poly([[9, 6], [12, 3], [14, 7], [11, 9]], [70, 70, 75]); },
  compass: (t) => { t.disc(8, 8, 6, [150, 150, 155]); t.disc(8, 8, 4.5, [225, 225, 220]); t.line(8, 8, 8, 4, [220, 30, 30]); t.line(8, 8, 8, 12, [60, 60, 60]); },
  recovery_compass: (t) => { t.disc(8, 8, 6, [40, 60, 70]); t.disc(8, 8, 4.5, [20, 30, 36]); t.line(8, 8, 11, 5, [60, 220, 220]); },
  clock: (t) => { t.disc(8, 8, 6, [250, 210, 60]); t.disc(8, 8, 4.5, [60, 80, 140]); t.rect(4, 8, 9, 4, [80, 160, 60]); t.line(8, 8, 8, 4, [240, 240, 240]); },
  spyglass: (t) => { thick(t, 3, 13, 12, 4, [200, 110, 70]); t.disc(12.5, 3.5, 2.2, [180, 140, 240]); t.rect(5, 9, 3, 3, [150, 80, 50]); },
  shears: (t) => { t.poly([[3, 3], [10, 9], [9, 10], [2, 4]], [200, 200, 205]); t.poly([[13, 3], [6, 9], [7, 10], [14, 4]], [180, 180, 185]); t.disc(5, 12, 2, [60, 60, 60]); t.disc(11, 12, 2, [60, 60, 60]); },
  shield: (t) => { t.poly([[3, 2], [13, 2], [13, 9], [8, 14], [3, 9]], [140, 100, 50]); t.rect(7, 2, 2, 11, [120, 120, 125]); },
  brush: (t) => { thick(t, 2, 13, 9, 6, STICK); t.poly([[9, 4], [12, 1], [15, 4], [12, 7]], [220, 200, 160]); },
  mace: (t) => { thick(t, 2, 13, 9, 6, [120, 110, 100]); t.disc(11, 4, 3.4, [110, 110, 120]); t.set(13, 2, [200, 200, 210]); },
  wind_charge: (t) => { t.disc(8, 8, 5, [200, 220, 250]); t.line(5, 8, 11, 6, [255, 255, 255]); t.line(6, 11, 10, 10, [255, 255, 255]); },
  lead: (t) => { for (let i = 0; i < 20; i++) { const a = i * 0.6; t.set(8 + Math.cos(a) * (2 + i * 0.25), 8 + Math.sin(a) * (2 + i * 0.25), [180, 140, 90]); } },
  name_tag: (t) => { t.poly([[2, 6], [5, 3], [14, 3], [14, 10], [5, 10]], [220, 200, 160]); t.set(4, 6, [80, 60, 40]); },
  saddle: (t) => { t.poly([[2, 7], [6, 3], [12, 3], [14, 7], [12, 12], [4, 12]], [130, 70, 30]); t.rect(7, 10, 2, 5, [100, 100, 100]); },
  painting: (t) => { t.rect(1, 3, 14, 11, [140, 100, 50]); t.rect(2, 4, 12, 9, [90, 160, 220]); t.poly([[2, 13], [7, 7], [11, 13]], [70, 130, 60]); },
  item_frame: (t) => { t.rect(2, 2, 12, 12, [140, 100, 50]); t.rect(4, 4, 8, 8, [100, 70, 40]); },
  glow_item_frame: (t) => { t.rect(2, 2, 12, 12, [80, 200, 190]); t.rect(4, 4, 8, 8, [60, 110, 100]); },
  armor_stand: (t) => { t.rect(7, 2, 2, 12, [160, 120, 70]); t.rect(4, 5, 8, 2, [160, 120, 70]); t.rect(5, 14, 6, 2, [130, 130, 130]); },
  map: (t) => { t.rect(2, 2, 12, 12, [230, 220, 180]); t.poly([[4, 5], [9, 4], [12, 9], [7, 12]], [110, 170, 80]); },
  glass_bottle: (t) => { t.rect(6, 2, 4, 3, [220, 240, 250]); t.disc(8, 10, 4.5, [200, 230, 250]); t.disc(8, 10, 3, [0, 0, 0], 0); t.set(6, 9, [255, 255, 255]); },
  minecart: (t) => { t.poly([[1, 5], [15, 5], [13, 11], [3, 11]], [120, 120, 125]); t.rect(2, 6, 12, 2, [70, 70, 75]); t.disc(4, 12, 1.7, [40, 40, 40]); t.disc(12, 12, 1.7, [40, 40, 40]); },
};
for (const [mat, c] of Object.entries(MAT)) {
  for (const [kind, draw] of Object.entries(TOOL)) ITEM[`${mat}_${kind}`] = (t) => draw(t, c);
  for (const [slot, draw] of Object.entries(ARMOR_SHAPE)) ITEM[`${mat}_${slot}`] = (t) => draw(t, c);
}
for (const [c, col] of Object.entries(COLORS)) ITEM[`${c}_dye`] = dye(col);
for (const [w, c] of Object.entries(WOOD)) {
  ITEM[`${w}_boat`] = (t) => { t.poly([[1, 7], [15, 7], [13, 12], [3, 12]], c.planks); t.line(1, 7, 15, 7, shade(c.planks, 0.2)); t.rect(4, 8, 8, 2, shade(c.planks, -0.25)); };
  ITEM[`${w}_sign`] = (t) => { t.rect(2, 3, 12, 7, c.planks); t.line(4, 5, 11, 5, shade(c.planks, -0.35)); t.line(4, 7, 9, 7, shade(c.planks, -0.35)); t.rect(7, 10, 2, 5, STICK); };
}

function itemSprite(name) {
  const draw = ITEM[name];
  if (!draw) return null;
  return spr(draw, name);
}

module.exports = { itemSprite };
