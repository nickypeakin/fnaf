// Crafting and smelting recipes, and the matcher used by crafting grids and the recipe book.
//
// A shaped recipe is a pattern of rows plus a key; a shapeless recipe is a list of ingredients.
// Ingredients are item keys or tags ('#planks'). Shaped recipes also match mirrored.
(function (G) {
  'use strict';
  const MC = G.MC;
  const I = MC.ITEMS;

  const TAGS = {
    planks: MC.WOODS.map((w) => `${w}_planks`),
    logs: MC.WOODS.flatMap((w) => [`${w}_log`, `${w}_wood`, `stripped_${w}_log`, `stripped_${w}_wood`]),
    wooden_slabs: MC.WOODS.map((w) => `${w}_slab`),
    coals: ['coal', 'charcoal'],
    stone_tool: ['cobblestone', 'cobbled_deepslate'],
    stone_craft: ['cobblestone', 'cobbled_deepslate'],
    wool: MC.COLORS.map((c) => `${c}_wool`),
    sand: ['sand', 'red_sand'],
    candles: ['candle', ...MC.COLORS.map((c) => `${c}_candle`)],
    beds: MC.COLORS.map((c) => `${c}_bed`),
    carpets: MC.COLORS.map((c) => `${c}_carpet`),
  };
  MC.TAGS = TAGS;

  const CRAFT = [];
  const SMELT = {}; // input -> {out, xp, kind: 'ore'|'food'|null}

  function has(k) { return !!I[k]; }
  function okIng(k) { return k.startsWith('#') ? !!TAGS[k.slice(1)] : has(k); }

  // shaped('oak_planks', 4, ['#'], {'#': 'oak_log'})
  function shaped(out, n, pattern, key, group) {
    if (!has(out)) return;
    for (const v of Object.values(key)) if (!okIng(v)) return;
    CRAFT.push({ type: 'shaped', out, n, pattern, key, w: pattern[0].length, h: pattern.length, group: group || out });
  }
  function shapeless(out, n, ing, group) {
    if (!has(out)) return;
    for (const v of ing) if (!okIng(v)) return;
    CRAFT.push({ type: 'shapeless', out, n, ing, group: group || out });
  }
  function smelt(input, out, xp = 0.1, kind = null) {
    if (!has(input) || !has(out)) return;
    SMELT[input] = { out, xp, kind };
  }
  // 9 items <-> a storage block
  function storage(itemKey, blockKey) {
    shaped(blockKey, 1, ['###', '###', '###'], { '#': itemKey });
    shapeless(itemKey, 9, [blockKey]);
  }
  function slabStairsWall(base, stem, wall) {
    shaped(`${stem}_slab`, 6, ['###'], { '#': base });
    shaped(`${stem}_stairs`, 4, ['#  ', '## ', '###'], { '#': base });
    if (wall) shaped(`${stem}_wall`, 6, ['###', '###'], { '#': base });
  }
  const square = (out, n, ing) => shaped(out, n, ['##', '##'], { '#': ing });

  // ---------------- wood ----------------
  for (const w of MC.WOODS) {
    for (const src of [`${w}_log`, `${w}_wood`, `stripped_${w}_log`, `stripped_${w}_wood`]) shapeless(`${w}_planks`, 4, [src], 'planks');
    square(`${w}_wood`, 3, `${w}_log`);
    square(`stripped_${w}_wood`, 3, `stripped_${w}_log`);
    const P = `${w}_planks`;
    shaped(`${w}_slab`, 6, ['###'], { '#': P });
    shaped(`${w}_stairs`, 4, ['#  ', '## ', '###'], { '#': P });
    shaped(`${w}_fence`, 3, ['#S#', '#S#'], { '#': P, S: 'stick' });
    shaped(`${w}_fence_gate`, 1, ['S#S', 'S#S'], { '#': P, S: 'stick' });
    shaped(`${w}_door`, 3, ['##', '##', '##'], { '#': P });
    shaped(`${w}_trapdoor`, 2, ['###', '###'], { '#': P });
    shapeless(`${w}_button`, 1, [P]);
    shaped(`${w}_pressure_plate`, 1, ['##'], { '#': P });
    shaped(`${w}_boat`, 1, ['# #', '###'], { '#': P });
    shaped(`${w}_sign`, 3, ['###', '###', ' S '], { '#': P, S: 'stick' });
  }
  shaped('stick', 4, ['#', '#'], { '#': '#planks' });
  square('crafting_table', 1, '#planks');
  shaped('chest', 1, ['###', '# #', '###'], { '#': '#planks' });
  shaped('barrel', 1, ['#S#', '# #', '#S#'], { '#': '#planks', S: '#wooden_slabs' });
  shaped('bowl', 4, ['# #', ' # '], { '#': '#planks' });
  shaped('bookshelf', 1, ['###', 'BBB', '###'], { '#': '#planks', B: 'book' });
  shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' });
  shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' });
  shaped('campfire', 1, [' S ', 'SCS', 'LLL'], { S: 'stick', C: '#coals', L: '#logs' });
  shaped('note_block', 1, ['###', '#R#', '###'], { '#': '#planks', R: 'redstone' });
  shaped('jukebox', 1, ['###', '#D#', '###'], { '#': '#planks', D: 'diamond' });
  shaped('composter', 1, ['S S', 'S S', 'SSS'], { S: '#wooden_slabs' });
  shaped('loom', 1, ['SS', '##'], { S: 'string', '#': '#planks' });
  shaped('cartography_table', 1, ['pp', '##', '##'], { p: 'paper', '#': '#planks' });
  shaped('fletching_table', 1, ['ff', '##', '##'], { f: 'flint', '#': '#planks' });
  shaped('smithing_table', 1, ['II', '##', '##'], { I: 'iron_ingot', '#': '#planks' });
  shaped('lectern', 1, ['SSS', ' B ', ' S '], { S: '#wooden_slabs', B: 'bookshelf' });
  shaped('shield', 1, ['#I#', '###', ' # '], { '#': '#planks', I: 'iron_ingot' });
  shaped('scaffolding', 6, ['S#S', 'S S', 'S S'], { S: 'stick', '#': 'string' });

  // ---------------- tools, weapons, armour ----------------
  const toolMats = { wooden: '#planks', stone: '#stone_tool', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
  for (const [mat, m] of Object.entries(toolMats)) {
    shaped(`${mat}_pickaxe`, 1, ['###', ' S ', ' S '], { '#': m, S: 'stick' }, 'pickaxe');
    shaped(`${mat}_axe`, 1, ['##', '#S', ' S'], { '#': m, S: 'stick' }, 'axe');
    shaped(`${mat}_shovel`, 1, ['#', 'S', 'S'], { '#': m, S: 'stick' }, 'shovel');
    shaped(`${mat}_hoe`, 1, ['##', ' S', ' S'], { '#': m, S: 'stick' }, 'hoe');
    shaped(`${mat}_sword`, 1, ['#', '#', 'S'], { '#': m, S: 'stick' }, 'sword');
  }
  const armorMats = { leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
  for (const [mat, m] of Object.entries(armorMats)) {
    shaped(`${mat}_helmet`, 1, ['###', '# #'], { '#': m }, 'helmet');
    shaped(`${mat}_chestplate`, 1, ['# #', '###', '###'], { '#': m }, 'chestplate');
    shaped(`${mat}_leggings`, 1, ['###', '# #', '# #'], { '#': m }, 'leggings');
    shaped(`${mat}_boots`, 1, ['# #', '# #'], { '#': m }, 'boots');
  }
  shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' });
  shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' });
  shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
  shaped('compass', 1, [' I ', 'IRI', ' I '], { I: 'iron_ingot', R: 'redstone' });
  shaped('clock', 1, [' G ', 'GRG', ' G '], { G: 'gold_ingot', R: 'redstone' });
  shaped('bow', 1, [' S#', 'S #', ' S#'], { S: 'stick', '#': 'string' });
  shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
  shaped('fishing_rod', 1, ['  S', ' S#', 'S #'], { S: 'stick', '#': 'string' });
  shaped('spyglass', 1, ['A', 'C', 'C'], { A: 'amethyst_shard', C: 'copper_ingot' });
  shaped('brush', 1, ['F', 'C', 'S'], { F: 'feather', C: 'copper_ingot', S: 'stick' });
  shaped('minecart', 1, ['I I', 'III'], { I: 'iron_ingot' });

  // ---------------- stone ----------------
  shaped('furnace', 1, ['###', '# #', '###'], { '#': '#stone_craft' });
  slabStairsWall('cobblestone', 'cobblestone', true);
  slabStairsWall('mossy_cobblestone', 'mossy_cobblestone', true);
  shapeless('mossy_cobblestone', 1, ['cobblestone', 'moss_block']);
  shaped('stone_slab', 6, ['###'], { '#': 'stone' });
  shaped('stone_stairs', 4, ['#  ', '## ', '###'], { '#': 'stone' });
  shapeless('stone_button', 1, ['stone']);
  shaped('stone_pressure_plate', 1, ['##'], { '#': 'stone' });
  shaped('smooth_stone_slab', 6, ['###'], { '#': 'smooth_stone' });
  square('stone_bricks', 4, 'stone');
  slabStairsWall('stone_bricks', 'stone_brick', true);
  shapeless('mossy_stone_bricks', 1, ['stone_bricks', 'moss_block']);
  slabStairsWall('mossy_stone_bricks', 'mossy_stone_brick', true);
  shaped('chiseled_stone_bricks', 1, ['#', '#'], { '#': 'stone_brick_slab' });
  for (const s of ['granite', 'diorite', 'andesite']) {
    slabStairsWall(s, s, true);
    square(`polished_${s}`, 4, s);
    slabStairsWall(`polished_${s}`, `polished_${s}`, false);
  }
  shapeless('andesite', 2, ['diorite', 'cobblestone']);
  shapeless('granite', 1, ['diorite', 'amethyst_shard']); // no nether quartz here, so amethyst stands in
  shaped('diorite', 2, ['CA', 'AC'], { C: 'cobblestone', A: 'amethyst_shard' });
  slabStairsWall('cobbled_deepslate', 'cobbled_deepslate', true);
  square('polished_deepslate', 4, 'cobbled_deepslate');
  slabStairsWall('polished_deepslate', 'polished_deepslate', true);
  square('deepslate_bricks', 4, 'polished_deepslate');
  slabStairsWall('deepslate_bricks', 'deepslate_brick', true);
  square('deepslate_tiles', 4, 'deepslate_bricks');
  slabStairsWall('deepslate_tiles', 'deepslate_tile', true);
  shaped('chiseled_deepslate', 1, ['#', '#'], { '#': 'cobbled_deepslate_slab' });
  slabStairsWall('tuff', 'tuff', true);
  square('polished_tuff', 4, 'tuff');
  slabStairsWall('polished_tuff', 'polished_tuff', true);
  square('tuff_bricks', 4, 'polished_tuff');
  slabStairsWall('tuff_bricks', 'tuff_brick', true);
  shaped('chiseled_tuff', 1, ['#', '#'], { '#': 'tuff_slab' });
  shaped('chiseled_tuff_bricks', 1, ['#', '#'], { '#': 'tuff_brick_slab' });
  square('sandstone', 1, 'sand');
  slabStairsWall('sandstone', 'sandstone', true);
  square('cut_sandstone', 4, 'sandstone');
  shaped('chiseled_sandstone', 1, ['#', '#'], { '#': 'sandstone_slab' });
  slabStairsWall('smooth_sandstone', 'smooth_sandstone', false);
  square('bricks', 1, 'brick');
  slabStairsWall('bricks', 'brick', true);
  shapeless('packed_mud', 1, ['mud', 'wheat']);
  square('mud_bricks', 4, 'packed_mud');
  slabStairsWall('mud_bricks', 'mud_brick', true);
  square('dripstone_block', 1, 'pointed_dripstone');
  shaped('lever', 1, ['S', 'C'], { S: 'stick', C: 'cobblestone' });
  shaped('stonecutter', 1, [' I ', '###'], { I: 'iron_ingot', '#': 'stone' });
  shaped('blast_furnace', 1, ['III', 'IFI', '###'], { I: 'iron_ingot', F: 'furnace', '#': 'smooth_stone' });
  shaped('smoker', 1, [' L ', 'LFL', ' L '], { L: '#logs', F: 'furnace' });
  shaped('grindstone', 1, ['SsS', '# #'], { S: 'stick', s: 'stone_slab', '#': '#planks' });
  shaped('cauldron', 1, ['I I', 'I I', 'III'], { I: 'iron_ingot' });
  shaped('anvil', 1, ['BBB', ' I ', 'III'], { B: 'iron_block', I: 'iron_ingot' });
  shaped('armor_stand', 1, ['SSS', ' S ', 'SsS'], { S: 'stick', s: 'smooth_stone_slab' });

  // ---------------- minerals ----------------
  storage('coal', 'coal_block');
  storage('iron_ingot', 'iron_block');
  storage('gold_ingot', 'gold_block');
  storage('diamond', 'diamond_block');
  storage('emerald', 'emerald_block');
  storage('lapis_lazuli', 'lapis_block');
  storage('redstone', 'redstone_block');
  storage('raw_iron', 'raw_iron_block');
  storage('raw_copper', 'raw_copper_block');
  storage('raw_gold', 'raw_gold_block');
  storage('copper_ingot', 'copper_block');
  storage('iron_nugget', 'iron_ingot');
  storage('gold_nugget', 'gold_ingot');
  square('amethyst_block', 1, 'amethyst_shard');
  shaped('tinted_glass', 2, [' A ', 'AGA', ' A '], { A: 'amethyst_shard', G: 'glass' });
  shaped('lightning_rod', 1, ['C', 'C', 'C'], { C: 'copper_ingot' });
  shaped('iron_door', 3, ['##', '##', '##'], { '#': 'iron_ingot' });
  square('iron_trapdoor', 1, 'iron_ingot');
  shaped('iron_bars', 16, ['###', '###'], { '#': 'iron_ingot' });
  shaped('chain', 1, ['N', 'I', 'N'], { N: 'iron_nugget', I: 'iron_ingot' });
  shaped('lantern', 1, ['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'torch' });
  shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
  shaped('golden_carrot', 1, ['NNN', 'NCN', 'NNN'], { N: 'gold_nugget', C: 'carrot' });
  // copper building blocks for every stage of weathering
  for (const age of MC.COPPER_AGES) {
    const blockKey = `${age}copper_block`;
    square(`${age}cut_copper`, 4, blockKey);
    shaped(`${age}cut_copper_slab`, 6, ['###'], { '#': `${age}cut_copper` });
    shaped(`${age}cut_copper_stairs`, 4, ['#  ', '## ', '###'], { '#': `${age}cut_copper` });
    shaped(`${age}chiseled_copper`, 1, ['#', '#'], { '#': `${age}cut_copper_slab` });
    shaped(`${age}copper_grate`, 4, [' # ', '# #', ' # '], { '#': blockKey });
    shaped(`${age}copper_bulb`, 4, [' # ', '#T#', ' R '], { '#': blockKey, T: 'redstone_torch', R: 'redstone' });
  }
  shaped('copper_door', 3, ['##', '##', '##'], { '#': 'copper_ingot' });
  square('copper_trapdoor', 1, 'copper_ingot');

  // ---------------- redstone-ish and misc ----------------
  shaped('redstone_torch', 1, ['R', 'S'], { R: 'redstone', S: 'stick' });
  shaped('redstone_lamp', 1, [' R ', 'RGR', ' R '], { R: 'redstone', G: 'glowstone_dust' });
  shaped('target', 1, [' R ', 'RHR', ' R '], { R: 'redstone', H: 'hay_block' });
  shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: '#sand' });
  shaped('paper', 3, ['###'], { '#': 'sugar_cane' });
  shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
  shapeless('writable_book', 1, ['book', 'ink_sac', 'feather']);
  shaped('map', 1, ['PPP', 'PCP', 'PPP'], { P: 'paper', C: 'compass' });
  shapeless('sugar', 1, ['sugar_cane']);
  shapeless('bone_meal', 3, ['bone']);
  storage('bone_meal', 'bone_block');
  shaped('painting', 1, ['SSS', 'SWS', 'SSS'], { S: 'stick', W: '#wool' });
  shaped('item_frame', 1, ['SSS', 'SLS', 'SSS'], { S: 'stick', L: 'leather' });
  shapeless('glow_item_frame', 1, ['item_frame', 'glow_ink_sac']);
  shaped('lead', 2, ['SS ', 'SB ', '  S'], { S: 'string', B: 'slime_ball' });
  shaped('glass_bottle', 3, ['# #', ' # '], { '#': 'glass' });
  storage('slime_ball', 'slime_block');
  storage('dried_kelp', 'dried_kelp_block');
  storage('wheat', 'hay_block');
  shaped('melon', 1, ['###', '###', '###'], { '#': 'melon_slice' });
  square('snow_block', 1, 'snowball');
  shaped('snow', 6, ['###'], { '#': 'snow_block' });
  square('clay', 1, 'clay_ball');
  shaped('moss_carpet', 3, ['##'], { '#': 'moss_block' });
  shaped('packed_ice', 1, ['###', '###', '###'], { '#': 'ice' });
  shaped('blue_ice', 1, ['###', '###', '###'], { '#': 'packed_ice' });
  shaped('jack_o_lantern', 1, ['P', 'T'], { P: 'carved_pumpkin', T: 'torch' });
  shaped('glass_pane', 16, ['###', '###'], { '#': 'glass' });
  shaped('white_wool', 1, ['##', '##'], { '#': 'string' });
  shaped('candle', 1, ['S', 'H'], { S: 'string', H: 'honeycomb' });

  // ---------------- food ----------------
  shaped('bread', 1, ['###'], { '#': 'wheat' });
  shaped('cake', 1, ['MMM', 'SES', 'WWW'], { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' });
  shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
  shapeless('mushroom_stew', 1, ['brown_mushroom', 'red_mushroom', 'bowl']);
  shaped('cookie', 8, ['WBW'], { W: 'wheat', B: 'sweet_berries' });

  // ---------------- colours ----------------
  for (const [flower, color] of MC.FLOWERS) shapeless(`${color}_dye`, flower === 'sunflower' ? 2 : 1, [flower], 'dye');
  shapeless('white_dye', 1, ['bone_meal'], 'dye');
  shapeless('black_dye', 1, ['ink_sac'], 'dye');
  shapeless('blue_dye', 1, ['lapis_lazuli'], 'dye');
  shapeless('brown_dye', 1, ['brown_mushroom', 'dirt'], 'dye'); // stand-in for cocoa beans
  shapeless('orange_dye', 2, ['red_dye', 'yellow_dye'], 'dye');
  shapeless('pink_dye', 2, ['red_dye', 'white_dye'], 'dye');
  shapeless('light_blue_dye', 2, ['blue_dye', 'white_dye'], 'dye');
  shapeless('cyan_dye', 2, ['blue_dye', 'green_dye'], 'dye');
  shapeless('purple_dye', 2, ['red_dye', 'blue_dye'], 'dye');
  shapeless('magenta_dye', 2, ['purple_dye', 'pink_dye'], 'dye');
  shapeless('gray_dye', 2, ['black_dye', 'white_dye'], 'dye');
  shapeless('light_gray_dye', 2, ['gray_dye', 'white_dye'], 'dye');
  shapeless('lime_dye', 2, ['green_dye', 'white_dye'], 'dye');
  for (const c of MC.COLORS) {
    const dye = `${c}_dye`;
    if (c !== 'white') shapeless(`${c}_wool`, 1, [dye, '#wool'], 'wool');
    shaped(`${c}_carpet`, 3, ['##'], { '#': `${c}_wool` }, 'carpet');
    shaped(`${c}_stained_glass`, 8, ['###', '#D#', '###'], { '#': 'glass', D: dye }, 'stained_glass');
    shaped(`${c}_stained_glass_pane`, 16, ['###', '###'], { '#': `${c}_stained_glass` }, 'stained_glass_pane');
    shaped(`${c}_terracotta`, 8, ['###', '#D#', '###'], { '#': 'terracotta', D: dye }, 'terracotta');
    shapeless(`${c}_concrete_powder`, 8, [dye, 'sand', 'sand', 'sand', 'sand', 'gravel', 'gravel', 'gravel', 'gravel'], 'concrete_powder');
    shaped(`${c}_bed`, 1, ['WWW', '###'], { W: `${c}_wool`, '#': '#planks' }, 'bed');
    shapeless(`${c}_candle`, 1, ['candle', dye], 'candle');
  }

  // ---------------- smelting ----------------
  for (const o of ['iron', 'copper', 'gold']) {
    smelt(`raw_${o}`, `${o}_ingot`, 0.7, 'ore');
    smelt(`${o}_ore`, `${o}_ingot`, 0.7, 'ore');
    smelt(`deepslate_${o}_ore`, `${o}_ingot`, 0.7, 'ore');
  }
  for (const [o, out] of [['coal', 'coal'], ['diamond', 'diamond'], ['emerald', 'emerald'], ['lapis', 'lapis_lazuli'], ['redstone', 'redstone']]) {
    smelt(`${o}_ore`, out, 0.7, 'ore');
    smelt(`deepslate_${o}_ore`, out, 0.7, 'ore');
  }
  for (const s of ['sand', 'red_sand']) smelt(s, 'glass');
  smelt('cobblestone', 'stone');
  smelt('stone', 'smooth_stone');
  smelt('cobbled_deepslate', 'deepslate');
  smelt('clay_ball', 'brick', 0.3);
  smelt('clay', 'terracotta', 0.35);
  smelt('sandstone', 'smooth_sandstone');
  smelt('stone_bricks', 'cracked_stone_bricks');
  smelt('deepslate_bricks', 'cracked_deepslate_bricks');
  smelt('deepslate_tiles', 'cracked_deepslate_tiles');
  smelt('cactus', 'green_dye', 1);
  smelt('wet_sponge', 'sponge');
  for (const t of TAGS.logs) smelt(t, 'charcoal', 0.15);
  for (const c of MC.COLORS) smelt(`${c}_terracotta`, `${c}_glazed_terracotta`);
  for (const [raw, cooked] of [['beef', 'cooked_beef'], ['porkchop', 'cooked_porkchop'], ['chicken', 'cooked_chicken'], ['mutton', 'cooked_mutton'], ['potato', 'baked_potato']]) smelt(raw, cooked, 0.35, 'food');
  smelt('kelp', 'dried_kelp', 0.1, 'food');

  // ---------------- matching ----------------
  function ingMatches(ing, stack) {
    if (!stack) return false;
    if (ing.startsWith('#')) return TAGS[ing.slice(1)].includes(stack.id);
    return ing === stack.id;
  }

  // grid: array of stacks (null for empty), width x height (2 or 3)
  function match(grid, gw, gh) {
    // bounding box of filled cells
    let x0 = gw, y0 = gh, x1 = -1, y1 = -1, filled = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y * gw + x]) {
      filled++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!filled) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    for (const r of CRAFT) {
      if (r.type === 'shaped') {
        if (r.w !== w || r.h !== h) continue;
        for (const mirror of [false, true]) {
          let ok = true;
          for (let y = 0; y < h && ok; y++) for (let x = 0; x < w && ok; x++) {
            const ch = r.pattern[y][mirror ? w - 1 - x : x];
            const st = grid[(y0 + y) * gw + (x0 + x)];
            if (ch === ' ') { if (st) ok = false; }
            else if (!ingMatches(r.key[ch], st)) ok = false;
          }
          if (ok) return r;
        }
      } else {
        if (r.ing.length !== filled) continue;
        const left = r.ing.slice();
        let ok = true;
        for (const st of grid) {
          if (!st) continue;
          const i = left.findIndex((ing) => ingMatches(ing, st));
          if (i < 0) { ok = false; break; }
          left.splice(i, 1);
        }
        if (ok) return r;
      }
    }
    return null;
  }

  // Ingredients of a recipe as a list (with counts) for the recipe book.
  function ingredients(r) {
    const list = r.type === 'shaped' ? r.pattern.join('').split('').filter((c) => c !== ' ').map((c) => r.key[c]) : r.ing;
    const m = new Map();
    for (const k of list) m.set(k, (m.get(k) || 0) + 1);
    return m;
  }
  function fits(r, size) { return r.type === 'shaped' ? r.w <= size && r.h <= size : r.ing.length <= size * size; }

  // A representative item for a tag (for drawing ingredients).
  function sampleOf(ing) { return ing.startsWith('#') ? TAGS[ing.slice(1)][0] : ing; }

  MC.Recipes = { CRAFT, SMELT, TAGS, match, ingredients, ingMatches, fits, sampleOf };
})(globalThis);
