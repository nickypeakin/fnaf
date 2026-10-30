#!/usr/bin/env node
// Builds assets/terrain.png (block textures), assets/icons.png (inventory icons) and js/atlas.js
// (name -> tile index). Run after adding blocks or items: node tools/build-textures.js
'use strict';
const fs = require('fs');
const path = require('path');
const { Tile, shade, encodePNG } = require('./pixels');
const { terrain } = require('./textures');
const { itemSprite } = require('./items');
const { mobTexture, MOB_TEXTURES } = require('./mobs');

const root = path.resolve(__dirname, '..');
require(path.join(root, 'js/util.js'));
require(path.join(root, 'js/blocks.js'));
const MC = globalThis.MC;

const ATLAS_COLS = 32;
const ICON = 32;
const ICON_COLS = 16;

// ---- which block textures exist ----
const texNames = new Set();
const faceTex = (b) => (typeof b.tex === 'string' ? { top: b.tex, bottom: b.tex, side: b.tex } : b.tex);
for (const b of MC.BLOCKS) {
  if (b.shape === 'none') continue;
  const t = faceTex(b);
  for (const v of Object.values(t)) texNames.add(v);
  if (b.icon && !b.icon.startsWith('block:')) texNames.add(b.icon);
}
for (let i = 0; i < 10; i++) texNames.add(`destroy_${i}`);
for (const n of MOB_TEXTURES) texNames.add(n);
for (let i = 0; i < 7; i++) texNames.add(`wheat_stage${i}`);
texNames.add('cave_vines_lit');

const tiles = {};
const missing = [];
for (const name of texNames) {
  const t = terrain(name) || mobTexture(name);
  if (!t) { missing.push(name); continue; }
  tiles[name] = t;
}

// ---- terrain atlas ----
const names = Object.keys(tiles);
const rows = Math.ceil(names.length / ATLAS_COLS);
const atlasW = ATLAS_COLS * 16, atlasH = Math.max(1, rows) * 16;
const atlas = new Uint8ClampedArray(atlasW * atlasH * 4);
const TEX = {};
names.forEach((n, i) => {
  TEX[n] = i;
  const ox = (i % ATLAS_COLS) * 16, oy = Math.floor(i / ATLAS_COLS) * 16;
  const t = tiles[n];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const s = (y * 16 + x) * 4, d = ((oy + y) * atlasW + ox + x) * 4;
    atlas[d] = t.d[s]; atlas[d + 1] = t.d[s + 1]; atlas[d + 2] = t.d[s + 2]; atlas[d + 3] = t.d[s + 3];
  }
});

// ---- icons ----
// Isometric cube: top, left (south) and right (east) faces sampled from the block's textures.
function iso(top, left, right, h = 1, inset = 0) {
  const t = new Tile(ICON, ICON);
  const S = ICON / 32;
  t.each((px, py) => {
    const sx = (px + 0.5) / S, sy = (py + 0.5) / S;
    // top face at height h: sx = 16 + 14(x - z), sy = 16 + 7(x + z) - 15h
    let x = ((sx - 16) / 14 + (sy - 16 + 15 * h) / 7) / 2;
    let z = ((sy - 16 + 15 * h) / 7 - (sx - 16) / 14) / 2;
    if (x >= inset && x < 1 - inset && z >= inset && z < 1 - inset) {
      const c = top.get(Math.floor(x * 16), Math.floor(z * 16));
      if (c[3] > 0) { t.set(px, py, c, c[3]); return; }
    }
    // south face (z = 1 - inset)
    x = (sx - 16) / 14 + (1 - inset);
    let y = (16 + 7 * (x + 1 - inset) - sy) / 15;
    if (x >= inset && x < 1 - inset && y >= 0 && y < h) {
      const c = left.get(Math.floor(x * 16), Math.floor((1 - y) * 16));
      if (c[3] > 0) { t.set(px, py, shade(c, -0.22), c[3]); return; }
    }
    // east face (x = 1 - inset)
    z = (1 - inset) - (sx - 16) / 14;
    y = (16 + 7 * (1 - inset + z) - sy) / 15;
    if (z >= inset && z < 1 - inset && y >= 0 && y < h) {
      const c = right.get(Math.floor((1 - z) * 16), Math.floor((1 - y) * 16));
      if (c[3] > 0) t.set(px, py, shade(c, -0.4), c[3]);
    }
  });
  return t;
}

function scaleUp(tile) {
  const t = new Tile(ICON, ICON);
  const k = ICON / 16;
  t.each((x, y) => { const c = tile.get(Math.floor(x / k), Math.floor(y / k)); if (c[3]) t.set(x, y, c, c[3]); });
  return t;
}

const ISO_H = { slab: 0.5, bed: 0.56, cake: 0.5, carpet: 0.12, layer: 0.15, plate: 0.12, button: 0.25, trapdoor: 0.2 };
const ISO_SHAPES = new Set(['cube', 'leaves', 'glass', 'tglass', 'slab', 'stairs', 'wall', 'fence', 'gate', 'chest', 'bed', 'cake', 'carpet', 'layer', 'plate', 'button', 'cactus', 'trapdoor']);
const fallback = new Tile();
fallback.each((x, y) => fallback.set(x, y, (x < 8) ^ (y < 8) ? [255, 0, 255] : [0, 0, 0]));

function blockIcon(b) {
  const ft = faceTex(b);
  const get = (n) => tiles[n] || fallback;
  if (b.icon && !b.icon.startsWith('block:')) return scaleUp(get(b.icon));
  if (!ISO_SHAPES.has(b.shape)) return scaleUp(get(ft.side || ft.top || ft.bottom));
  const top = get(ft.top || ft.end || ft.side);
  const side = get(ft.side || ft.top);
  const front = get(ft.front || ft.side || ft.top);
  return iso(top, front, side, ISO_H[b.shape] || 1, b.shape === 'cactus' ? 0.06 : 0);
}

const ICONS = {};
const iconTiles = [];
const iconMissing = [];
for (const key of MC.ITEM_LIST) {
  const it = MC.ITEMS[key];
  let tile = null;
  if (it.icon.startsWith('block:')) tile = blockIcon(MC.blockByKey(it.icon.slice(6)));
  else {
    const s = itemSprite(it.icon) || (tiles[it.icon] ? tiles[it.icon] : terrain(it.icon));
    if (s) tile = scaleUp(s);
  }
  if (!tile) { iconMissing.push(key); tile = scaleUp(fallback); }
  ICONS[key] = iconTiles.length;
  iconTiles.push(tile);
}
const iconRows = Math.ceil(iconTiles.length / ICON_COLS);
const iconW = ICON_COLS * ICON, iconH = iconRows * ICON;
const icons = new Uint8ClampedArray(iconW * iconH * 4);
iconTiles.forEach((t, i) => {
  const ox = (i % ICON_COLS) * ICON, oy = Math.floor(i / ICON_COLS) * ICON;
  for (let y = 0; y < ICON; y++) for (let x = 0; x < ICON; x++) {
    const s = (y * ICON + x) * 4, d = ((oy + y) * iconW + ox + x) * 4;
    icons[d] = t.d[s]; icons[d + 1] = t.d[s + 1]; icons[d + 2] = t.d[s + 2]; icons[d + 3] = t.d[s + 3];
  }
});

fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets/terrain.png'), encodePNG(atlasW, atlasH, atlas));
fs.writeFileSync(path.join(root, 'assets/icons.png'), encodePNG(iconW, iconH, icons));
fs.writeFileSync(path.join(root, 'assets/menu-bg.png'), encodePNG(16, 16, tiles.dirt.d));
fs.writeFileSync(path.join(root, 'js/atlas.js'),
  '// Generated by tools/build-textures.js: texture and icon positions in assets/terrain.png and assets/icons.png.\n' +
  '(function (G) {\n  const MC = G.MC;\n' +
  `  MC.ATLAS = { cols: ${ATLAS_COLS}, rows: ${rows}, width: ${atlasW}, height: ${atlasH} };\n` +
  `  MC.ICON_SHEET = { cols: ${ICON_COLS}, size: ${ICON}, width: ${iconW}, height: ${iconH} };\n` +
  `  MC.TEX = ${JSON.stringify(TEX)};\n` +
  `  MC.ICONS = ${JSON.stringify(ICONS)};\n` +
  '})(globalThis);\n');

console.log(`terrain: ${names.length} textures (${atlasW}x${atlasH}), icons: ${iconTiles.length}`);
if (missing.length) console.log('MISSING textures:', missing.join(', '));
if (iconMissing.length) console.log('MISSING icons:', iconMissing.join(', '));
