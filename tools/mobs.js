// Original 16x16 skin tiles for mob and player box models (each box face shows one whole tile).
'use strict';
const { Tile, shade, rngFor } = require('./pixels');

function noisy(base, amp, name) {
  const r = rngFor(name);
  const t = new Tile();
  t.each((x, y) => t.set(x, y, shade(base, (r() - 0.5) * amp)));
  return t;
}
function patches(t, col, n, name, size = 3) {
  const r = rngFor(name);
  for (let i = 0; i < n; i++) {
    const cx = r() * 16, cy = r() * 16, rad = 1 + r() * size;
    t.each((x, y) => { if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) t.set(x, y, shade(col, (r() - 0.5) * 0.1)); });
  }
  return t;
}
function eyes(t, y, col, pupil, gap = 3, w = 3) {
  const l = 8 - gap / 2 - w, rr = 8 + gap / 2;
  t.rect(Math.round(l), y, w, 2, col);
  t.rect(Math.round(rr), y, w, 2, col);
  if (pupil) { t.rect(Math.round(l + w - 1), y, 1, 2, pupil); t.rect(Math.round(rr), y, 1, 2, pupil); }
  return t;
}

const SHIRTS = [[38, 120, 140], [170, 60, 50], [60, 130, 60], [120, 70, 160], [220, 160, 40], [60, 80, 170], [200, 200, 200], [40, 40, 44]];

const M = {};
// ---- players ----
const SKIN = [214, 160, 120], HAIR = [70, 46, 26];
M.player_face = () => { const t = noisy(SKIN, 0.06, 'pf'); t.rect(0, 0, 16, 4, HAIR); t.rect(0, 4, 2, 2, HAIR); t.rect(14, 4, 2, 2, HAIR); eyes(t, 7, [250, 250, 250], [60, 70, 160], 4, 3); t.rect(6, 10, 4, 1, shade(SKIN, -0.25)); t.rect(5, 12, 6, 1, [150, 90, 70]); return t; };
M.player_head = () => { const t = noisy(SKIN, 0.06, 'ph'); t.rect(0, 0, 16, 5, HAIR); t.rect(10, 5, 6, 3, HAIR); t.rect(6, 8, 2, 2, shade(SKIN, -0.15)); return t; };
M.player_hair = () => noisy(HAIR, 0.2, 'phair');
M.player_back = () => { const t = noisy(HAIR, 0.2, 'pback'); t.rect(0, 12, 16, 4, SKIN); return t; };
M.player_arm = () => { const t = noisy(SKIN, 0.06, 'parm'); return t; };
M.player_pants = () => { const t = noisy([52, 58, 120], 0.12, 'ppants'); t.rect(0, 13, 16, 3, [70, 70, 74]); return t; };
SHIRTS.forEach((c, i) => {
  M[`player_shirt_${i}`] = () => { const t = noisy(c, 0.12, 'pshirt' + i); t.rect(5, 0, 6, 2, SKIN); return t; };
  M[`player_sleeve_${i}`] = () => { const t = noisy(SKIN, 0.06, 'psl' + i); t.rect(0, 0, 16, 6, shade(c, 0.05)); return t; };
});

// ---- zombie ----
const ZSKIN = [82, 132, 70];
M.zombie_face = () => { const t = noisy(ZSKIN, 0.12, 'zf'); t.rect(0, 0, 16, 3, shade(ZSKIN, -0.35)); eyes(t, 7, [20, 30, 20], null, 4, 3); t.rect(6, 11, 4, 2, shade(ZSKIN, -0.4)); return t; };
M.zombie_head = () => { const t = noisy(ZSKIN, 0.14, 'zh'); t.rect(0, 0, 16, 4, shade(ZSKIN, -0.35)); return t; };
M.zombie_hair = () => noisy(shade(ZSKIN, -0.35), 0.15, 'zhair');
M.zombie_shirt = () => { const t = noisy([44, 140, 150], 0.18, 'zs'); patches(t, [30, 100, 110], 4, 'zsp', 2); return t; };
M.zombie_arm = () => { const t = noisy(ZSKIN, 0.14, 'za'); t.rect(0, 0, 16, 5, [44, 140, 150]); return t; };
M.zombie_pants = () => noisy([66, 60, 140], 0.16, 'zp');

// ---- skeleton ----
const BONE = [205, 205, 200];
M.skeleton_face = () => { const t = noisy(BONE, 0.08, 'skf'); t.rect(3, 6, 4, 3, [40, 40, 40]); t.rect(9, 6, 4, 3, [40, 40, 40]); t.rect(7, 10, 2, 1, [70, 70, 70]); t.rect(4, 12, 8, 1, [60, 60, 60]); for (let x = 5; x < 12; x += 2) t.set(x, 13, [60, 60, 60]); return t; };
M.skeleton_head = () => noisy(BONE, 0.1, 'skh');
M.skeleton_body = () => { const t = new Tile(); t.rect(7, 0, 2, 16, BONE); for (let y = 2; y < 12; y += 3) t.rect(1, y, 14, 1, BONE); t.rect(2, 13, 12, 2, BONE); return t; };
M.skeleton_limb = () => { const t = new Tile(); t.rect(5, 0, 6, 16, BONE); t.rect(5, 0, 6, 1, shade(BONE, -0.2)); return t; };

// ---- creeper ----
const CR = [80, 170, 70];
M.creeper_body = () => { const t = noisy(CR, 0.2, 'crb'); patches(t, [140, 210, 120], 6, 'crp', 1.4); patches(t, [40, 90, 40], 5, 'crd', 1.2); return t; };
M.creeper_face = () => { const t = M.creeper_body(); const k = [10, 14, 10]; t.rect(3, 4, 3, 3, k); t.rect(10, 4, 3, 3, k); t.rect(6, 7, 4, 4, k); t.rect(5, 9, 2, 4, k); t.rect(9, 9, 2, 4, k); return t; };

// ---- spider ----
M.spider_body = () => { const t = noisy([52, 44, 40], 0.25, 'spb'); patches(t, [70, 60, 54], 4, 'spp', 2); return t; };
M.spider_face = () => { const t = M.spider_body(); const e = [210, 20, 20]; t.rect(4, 5, 2, 2, e); t.rect(10, 5, 2, 2, e); t.set(6, 8, e); t.set(9, 8, e); t.set(3, 9, e); t.set(12, 9, e); return t; };
M.spider_leg = () => noisy([40, 34, 32], 0.2, 'spl');

// ---- pig ----
const PIG = [236, 160, 160];
M.pig_skin = () => noisy(PIG, 0.08, 'pig');
M.pig_face = () => { const t = M.pig_skin(); eyes(t, 4, [255, 255, 255], [20, 20, 20], 6, 2); t.rect(4, 8, 8, 5, [246, 186, 186]); t.rect(5, 10, 2, 2, [140, 80, 80]); t.rect(9, 10, 2, 2, [140, 80, 80]); return t; };

// ---- cow ----
M.cow_hide = () => { const t = noisy([64, 48, 36], 0.12, 'cow'); patches(t, [235, 235, 230], 3, 'cowp', 3.5); return t; };
M.cow_face = () => { const t = noisy([64, 48, 36], 0.12, 'cowf'); t.rect(5, 2, 6, 6, [230, 230, 226]); eyes(t, 4, [20, 20, 20], null, 8, 2); t.rect(3, 10, 10, 6, [210, 170, 150]); t.rect(5, 12, 2, 2, [80, 50, 40]); t.rect(9, 12, 2, 2, [80, 50, 40]); return t; };
M.horn = () => noisy([220, 210, 180], 0.1, 'horn');

// ---- sheep ----
M.sheep_wool = () => { const t = noisy([234, 234, 230], 0.08, 'wool'); patches(t, [214, 214, 210], 8, 'woolp', 1.2); return t; };
M.sheep_skin = () => noisy([214, 186, 160], 0.08, 'shs');
M.sheep_face = () => { const t = M.sheep_skin(); eyes(t, 6, [255, 255, 255], [20, 20, 20], 6, 2); t.rect(6, 11, 4, 2, [230, 150, 150]); t.rect(0, 0, 16, 3, [234, 234, 230]); return t; };

// ---- chicken ----
M.chicken_body = () => noisy([244, 244, 240], 0.06, 'chk');
M.chicken_face = () => { const t = M.chicken_body(); eyes(t, 5, [20, 20, 20], null, 8, 2); return t; };
M.chicken_beak = () => noisy([240, 170, 40], 0.1, 'beak');
M.chicken_wattle = () => noisy([210, 30, 30], 0.1, 'wattle');
M.chicken_leg = () => noisy([230, 160, 40], 0.1, 'chl');

// ---- goat (Caves & Cliffs) ----
M.goat_fur = () => { const t = noisy([226, 222, 210], 0.1, 'goat'); for (let y = 0; y < 16; y += 3) t.line(0, y, 15, y + 1, [205, 200, 188]); return t; };
M.goat_face = () => { const t = noisy([226, 222, 210], 0.08, 'goatf'); eyes(t, 5, [200, 160, 40], [20, 20, 20], 8, 2); t.rect(6, 12, 4, 4, [200, 196, 186]); return t; };

// ---- axolotl (Caves & Cliffs): pale base that's tinted per variant ----
M.axolotl_body = () => { const t = noisy([250, 246, 246], 0.06, 'axo'); t.rect(0, 0, 16, 2, [235, 225, 225]); return t; };
M.axolotl_face = () => { const t = M.axolotl_body(); t.rect(3, 6, 2, 2, [30, 20, 30]); t.rect(11, 6, 2, 2, [30, 20, 30]); t.rect(6, 11, 4, 1, [200, 150, 160]); return t; };
M.axolotl_gills = () => { const t = noisy([230, 140, 170], 0.15, 'gill'); return t; };

// ---- glow squid (Caves & Cliffs) ----
M.glow_squid_body = () => { const t = noisy([30, 110, 120], 0.15, 'gsq'); patches(t, [90, 240, 210], 7, 'gsqp', 1.4); return t; };
M.glow_squid_face = () => { const t = M.glow_squid_body(); t.rect(3, 9, 3, 3, [240, 255, 240]); t.rect(10, 9, 3, 3, [240, 255, 240]); t.set(4, 10, [10, 30, 30]); t.set(11, 10, [10, 30, 30]); return t; };

// ---- misc entity bits ----
M.arrow_tex = () => { const t = new Tile(); t.rect(0, 7, 16, 2, [120, 90, 50]); t.rect(13, 6, 3, 4, [150, 150, 150]); t.rect(0, 5, 3, 6, [240, 240, 240]); return t; };
M.flash = () => new Tile().fill([255, 255, 255]);

function mobTexture(name) { return M[name] ? M[name]() : null; }
module.exports = { mobTexture, MOB_TEXTURES: Object.keys(M), SHIRT_COUNT: SHIRTS.length };
