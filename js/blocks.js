// Every block and item in the game. Shared by the page, the world worker and the build tools.
//
// Blocks get numeric ids (in definition order) that are stored in chunk arrays; items are
// looked up by string key. Every block also has an item with the same key unless noItem is set.
(function (G) {
  'use strict';
  const MC = G.MC;

  const BLOCKS = [];
  const B = {};
  const ITEMS = {};
  const ITEM_LIST = [];

  // ---- defaults for each shape ----
  // render: opaque (full cube that hides neighbours), cutout (alpha-tested), translucent (blended).
  const SHAPES = {
    cube: { solid: true, render: 'opaque', full: true },
    cross: { solid: false, render: 'cutout' },
    slab: { solid: true, render: 'opaque' },
    stairs: { solid: true, render: 'opaque' },
    fence: { solid: true, render: 'cutout' },
    gate: { solid: true, render: 'cutout' },
    wall: { solid: true, render: 'opaque' },
    pane: { solid: true, render: 'cutout' },
    door: { solid: true, render: 'cutout' },
    trapdoor: { solid: true, render: 'cutout' },
    ladder: { solid: false, render: 'cutout', climb: true },
    flat: { solid: false, render: 'cutout' },
    torch: { solid: false, render: 'cutout' },
    lantern: { solid: true, render: 'cutout' },
    carpet: { solid: true, render: 'opaque' },
    layer: { solid: true, render: 'opaque' },
    plate: { solid: false, render: 'opaque' },
    button: { solid: false, render: 'opaque' },
    bed: { solid: true, render: 'opaque' },
    cactus: { solid: true, render: 'cutout' },
    chest: { solid: true, render: 'opaque' },
    candle: { solid: false, render: 'cutout' },
    rod: { solid: true, render: 'opaque' },
    chain: { solid: true, render: 'cutout' },
    cake: { solid: true, render: 'opaque' },
    campfire: { solid: true, render: 'cutout' },
    liquid: { solid: false, render: 'translucent' },
    leaves: { solid: true, render: 'cutout', full: true },
    glass: { solid: true, render: 'cutout', full: true },
    tglass: { solid: true, render: 'translucent', full: true },
    none: { solid: false, render: 'none' },
  };

  // How many light levels each kind of block removes as light passes through.
  const OPACITY = { opaque: 15, cutout: 0, translucent: 1, none: 0 };

  function block(key, def = {}) {
    const shape = def.shape || 'cube';
    const base = SHAPES[shape];
    const b = {
      id: BLOCKS.length, key, name: def.name || titleCase(key), shape,
      tex: def.tex || key,
      solid: def.solid != null ? def.solid : base.solid,
      render: def.render || base.render,
      full: def.full != null ? def.full : !!base.full,
      light: def.light || 0,
      hardness: def.hardness != null ? def.hardness : 1,
      tool: def.tool || null,
      tier: def.tier || 0,
      drop: def.drop === undefined ? key : def.drop,
      dropCount: def.dropCount || null,
      dropChance: def.dropChance || null,
      state: def.state || null,
      gravity: !!def.gravity,
      replaceable: !!def.replaceable,
      support: def.support || null,
      plantOn: def.plantOn || null,
      climb: def.climb != null ? def.climb : !!base.climb,
      liquid: def.liquid || null,
      use: def.use || null,
      color: def.color || null,
      sound: def.sound || guessSound(def.tool, shape),
      family: def.family || null,
    };
    b.opaque = b.full && b.render === 'opaque';
    b.opacity = def.opacity != null ? def.opacity : b.opaque ? 15 : shape === 'leaves' ? 1 : OPACITY[b.render] || 0;
    B[key] = b.id;
    BLOCKS.push(b);
    if (!def.noItem) item(key, { name: b.name, block: key, icon: def.icon || null, stack: def.stack, fuel: def.fuel, creative: def.creative });
    return b;
  }

  function item(key, def = {}) {
    const it = {
      key, name: def.name || titleCase(key),
      block: def.block || null,
      icon: def.icon || null,
      stack: def.stack || 64,
      tool: def.tool || null,
      armor: def.armor || null,
      food: def.food || null,
      fuel: def.fuel || 0,
      use: def.use || null,
      damage: def.damage || 1,
      creative: def.creative !== false,
    };
    if (ITEMS[key]) Object.assign(ITEMS[key], it);
    else { ITEMS[key] = it; ITEM_LIST.push(key); }
    return it;
  }

  function titleCase(k) {
    return k.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }

  function guessSound(tool, shape) {
    if (tool === 'axe') return 'wood';
    if (tool === 'shovel') return 'gravel';
    if (shape === 'cross' || shape === 'leaves') return 'grass';
    if (shape === 'glass' || shape === 'tglass' || shape === 'pane') return 'glass';
    return 'stone';
  }

  // ---------------- core / natural ----------------
  block('air', { shape: 'none', noItem: true, hardness: 0, drop: null, replaceable: true });
  block('stone', { hardness: 1.5, tool: 'pickaxe', tier: 1, drop: 'cobblestone' });
  block('grass_block', { tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', drop: 'dirt', sound: 'grass' });
  block('dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
  block('coarse_dirt', { hardness: 0.5, tool: 'shovel' });
  block('podzol', { tex: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, hardness: 0.5, tool: 'shovel', drop: 'dirt' });
  block('rooted_dirt', { hardness: 0.5, tool: 'shovel' });
  block('mud', { hardness: 0.5, tool: 'shovel' });
  block('sand', { hardness: 0.5, tool: 'shovel', gravity: true, sound: 'sand' });
  block('red_sand', { hardness: 0.5, tool: 'shovel', gravity: true, sound: 'sand' });
  block('gravel', { hardness: 0.6, tool: 'shovel', gravity: true });
  block('clay', { hardness: 0.6, tool: 'shovel', drop: 'clay_ball', dropCount: [4, 4] });
  block('bedrock', { hardness: -1, drop: null });
  block('water', { shape: 'liquid', liquid: 'water', hardness: -1, drop: null, replaceable: true, noItem: true, opacity: 2 });
  block('lava', { shape: 'liquid', liquid: 'lava', hardness: -1, drop: null, replaceable: true, noItem: true, light: 15, render: 'opaque', opacity: 15 });
  block('obsidian', { hardness: 50, tool: 'pickaxe', tier: 4 });
  block('snow_block', { tex: 'snow', hardness: 0.2, tool: 'shovel', drop: 'snowball', dropCount: [4, 4], sound: 'snow' });
  block('snow', { shape: 'layer', tex: 'snow', hardness: 0.1, tool: 'shovel', drop: 'snowball', replaceable: true, support: 'floor', sound: 'snow' });
  block('powder_snow', { hardness: 0.25, solid: false, drop: null, sound: 'snow' });
  block('ice', { shape: 'tglass', hardness: 0.5, tool: 'pickaxe', drop: null, sound: 'glass' });
  block('packed_ice', { hardness: 0.5, tool: 'pickaxe', drop: null, sound: 'glass' });
  block('blue_ice', { hardness: 2.8, tool: 'pickaxe', drop: null, sound: 'glass' });

  // Caves & Cliffs stones
  block('deepslate', { tex: { top: 'deepslate_top', bottom: 'deepslate_top', side: 'deepslate' }, hardness: 3, tool: 'pickaxe', tier: 1, drop: 'cobbled_deepslate', state: 'axis' });
  block('tuff', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('calcite', { hardness: 0.75, tool: 'pickaxe', tier: 1 });
  block('smooth_basalt', { hardness: 1.25, tool: 'pickaxe', tier: 1 });
  block('dripstone_block', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('pointed_dripstone', { shape: 'cross', hardness: 1.5, tool: 'pickaxe', state: 'hanging', solid: true });
  block('amethyst_block', { hardness: 1.5, tool: 'pickaxe', tier: 1, sound: 'glass' });
  block('budding_amethyst', { hardness: 1.5, tool: 'pickaxe', drop: null, sound: 'glass' });
  block('small_amethyst_bud', { shape: 'cross', hardness: 1.5, drop: null, light: 1, state: 'face', sound: 'glass' });
  block('medium_amethyst_bud', { shape: 'cross', hardness: 1.5, drop: null, light: 2, state: 'face', sound: 'glass' });
  block('large_amethyst_bud', { shape: 'cross', hardness: 1.5, drop: null, light: 4, state: 'face', sound: 'glass' });
  block('amethyst_cluster', { shape: 'cross', hardness: 1.5, tool: 'pickaxe', drop: 'amethyst_shard', dropCount: [4, 4], light: 5, state: 'face', sound: 'glass' });
  block('tinted_glass', { shape: 'glass', hardness: 0.3, opacity: 15, sound: 'glass' });
  block('moss_block', { hardness: 0.1, tool: 'hoe', sound: 'grass' });
  block('moss_carpet', { shape: 'carpet', tex: 'moss_block', hardness: 0.1, support: 'floor', sound: 'grass' });
  block('azalea', { shape: 'cross', tex: 'azalea_side', hardness: 0, support: 'floor', plantOn: ['grass_block', 'dirt', 'moss_block', 'rooted_dirt', 'clay', 'coarse_dirt', 'podzol'], icon: 'azalea_side' });
  block('flowering_azalea', { shape: 'cross', tex: 'flowering_azalea_side', hardness: 0, support: 'floor', plantOn: ['grass_block', 'dirt', 'moss_block', 'rooted_dirt', 'clay', 'coarse_dirt', 'podzol'], icon: 'flowering_azalea_side' });
  block('cave_vines', { shape: 'cross', hardness: 0, drop: null, support: 'ceiling', climb: true, noItem: true, state: 'berries', light: 0 });
  block('spore_blossom', { shape: 'flat', hardness: 0, support: 'ceiling', icon: 'spore_blossom' });
  block('hanging_roots', { shape: 'cross', hardness: 0, support: 'ceiling', icon: 'hanging_roots' });
  block('glow_lichen', { shape: 'flat', hardness: 0.2, light: 7, support: 'wall', state: 'face', icon: 'glow_lichen', replaceable: true });
  block('small_dripleaf', { shape: 'cross', hardness: 0, support: 'floor', icon: 'small_dripleaf' });
  block('big_dripleaf', { shape: 'flat', tex: 'big_dripleaf_top', hardness: 0.1, solid: true, support: 'floor', icon: 'big_dripleaf_top' });
  block('sculk', { hardness: 0.2, tool: 'hoe' });

  // Ores (stone and deepslate variants)
  const ORES = [
    ['coal', 1, 'coal'], ['iron', 2, 'raw_iron'], ['copper', 2, 'raw_copper'], ['gold', 3, 'raw_gold'],
    ['redstone', 3, 'redstone'], ['lapis', 2, 'lapis_lazuli'], ['diamond', 3, 'diamond'], ['emerald', 3, 'emerald'],
  ];
  for (const [o, tier, drop] of ORES) {
    const count = o === 'redstone' ? [4, 5] : o === 'lapis' ? [4, 8] : o === 'copper' ? [2, 5] : null;
    block(`${o}_ore`, { hardness: 3, tool: 'pickaxe', tier, drop, dropCount: count });
    block(`deepslate_${o}_ore`, { hardness: 4.5, tool: 'pickaxe', tier, drop, dropCount: count });
  }
  block('raw_iron_block', { hardness: 5, tool: 'pickaxe', tier: 2 });
  block('raw_copper_block', { hardness: 5, tool: 'pickaxe', tier: 2 });
  block('raw_gold_block', { hardness: 5, tool: 'pickaxe', tier: 3 });

  // ---------------- wood ----------------
  MC.WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry'];
  for (const w of MC.WOODS) {
    const axe = { hardness: 2, tool: 'axe', fuel: 15, family: w };
    block(`${w}_log`, { ...axe, tex: { end: `${w}_log_top`, side: `${w}_log` }, state: 'axis' });
    block(`stripped_${w}_log`, { ...axe, tex: { end: `stripped_${w}_log_top`, side: `stripped_${w}_log` }, state: 'axis' });
    block(`${w}_wood`, { ...axe, tex: `${w}_log`, state: 'axis' });
    block(`stripped_${w}_wood`, { ...axe, tex: `stripped_${w}_log`, state: 'axis' });
    block(`${w}_planks`, axe);
    block(`${w}_slab`, { ...axe, shape: 'slab', tex: `${w}_planks`, state: 'slab', fuel: 7 });
    block(`${w}_stairs`, { ...axe, shape: 'stairs', tex: `${w}_planks`, state: 'stairs' });
    block(`${w}_fence`, { ...axe, shape: 'fence', tex: `${w}_planks` });
    block(`${w}_fence_gate`, { ...axe, shape: 'gate', tex: `${w}_planks`, state: 'gate', use: 'toggle' });
    block(`${w}_door`, { ...axe, shape: 'door', tex: { bottom: `${w}_door_bottom`, top: `${w}_door_top` }, state: 'door', use: 'toggle', icon: `${w}_door_item`, hardness: 3, fuel: 10 });
    block(`${w}_trapdoor`, { ...axe, shape: 'trapdoor', state: 'trapdoor', use: 'toggle', hardness: 3 });
    block(`${w}_button`, { ...axe, shape: 'button', tex: `${w}_planks`, hardness: 0.5, state: 'face', fuel: 5 });
    block(`${w}_pressure_plate`, { ...axe, shape: 'plate', tex: `${w}_planks`, hardness: 0.5, support: 'floor' });
    block(`${w}_leaves`, { shape: 'leaves', hardness: 0.2, tool: 'hoe', drop: `${w}_sapling`, dropChance: 0.05, sound: 'grass' });
    block(`${w}_sapling`, { shape: 'cross', hardness: 0, support: 'floor', plantOn: ['grass_block', 'dirt', 'podzol', 'coarse_dirt', 'moss_block', 'rooted_dirt'], icon: `${w}_sapling`, fuel: 5, use: 'sapling' });
  }
  block('azalea_leaves', { shape: 'leaves', hardness: 0.2, tool: 'hoe', drop: 'azalea', dropChance: 0.05, sound: 'grass' });
  block('flowering_azalea_leaves', { shape: 'leaves', hardness: 0.2, tool: 'hoe', drop: 'flowering_azalea', dropChance: 0.05, sound: 'grass' });

  // ---------------- plants ----------------
  const plantOn = ['grass_block', 'dirt', 'podzol', 'coarse_dirt', 'moss_block', 'rooted_dirt', 'mud'];
  block('short_grass', { shape: 'cross', tex: 'short_grass', hardness: 0, drop: 'wheat_seeds', dropChance: 0.125, replaceable: true, support: 'floor', plantOn, icon: 'short_grass' });
  block('fern', { shape: 'cross', hardness: 0, drop: 'wheat_seeds', dropChance: 0.125, replaceable: true, support: 'floor', plantOn, icon: 'fern' });
  block('dead_bush', { shape: 'cross', hardness: 0, drop: 'stick', dropCount: [0, 2], replaceable: true, support: 'floor', plantOn: ['sand', 'red_sand', 'dirt', 'coarse_dirt', 'podzol', 'terracotta'], icon: 'dead_bush', fuel: 5 });
  MC.FLOWERS = [
    ['dandelion', 'yellow'], ['poppy', 'red'], ['blue_orchid', 'light_blue'], ['allium', 'magenta'], ['azure_bluet', 'light_gray'],
    ['red_tulip', 'red'], ['orange_tulip', 'orange'], ['white_tulip', 'light_gray'], ['pink_tulip', 'pink'],
    ['oxeye_daisy', 'light_gray'], ['cornflower', 'blue'], ['lily_of_the_valley', 'white'],
  ];
  for (const [f] of MC.FLOWERS) block(f, { shape: 'cross', hardness: 0, support: 'floor', plantOn, icon: f });
  block('brown_mushroom', { shape: 'cross', hardness: 0, support: 'floor', light: 1, icon: 'brown_mushroom' });
  block('red_mushroom', { shape: 'cross', hardness: 0, support: 'floor', icon: 'red_mushroom' });
  block('sugar_cane', { shape: 'cross', hardness: 0, support: 'floor', plantOn: ['grass_block', 'dirt', 'sand', 'red_sand', 'sugar_cane', 'podzol', 'coarse_dirt'], icon: 'sugar_cane_item' });
  block('cactus', { shape: 'cactus', tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, hardness: 0.4, support: 'floor', plantOn: ['sand', 'red_sand', 'cactus'] });
  block('wheat', { shape: 'cross', tex: 'wheat_stage7', hardness: 0, drop: 'wheat', support: 'floor', plantOn: ['farmland'], noItem: true });
  block('farmland', { tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' }, hardness: 0.6, tool: 'shovel', drop: 'dirt', noItem: true });
  block('pumpkin', { tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' }, hardness: 1, tool: 'axe' });
  block('carved_pumpkin', { tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'carved_pumpkin' }, hardness: 1, tool: 'axe', state: 'facing' });
  block('jack_o_lantern', { tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, hardness: 1, tool: 'axe', state: 'facing', light: 15 });
  block('melon', { tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', drop: 'melon_slice', dropCount: [3, 7] });
  block('hay_block', { tex: { end: 'hay_block_top', side: 'hay_block_side' }, hardness: 0.5, tool: 'hoe', state: 'axis' });
  block('cobweb', { shape: 'cross', hardness: 4, tool: 'sword', drop: 'string', solid: false, icon: 'cobweb' });

  // ---------------- stone families ----------------
  // family(base, opts) adds base block plus slab/stairs/wall variants as asked.
  function family(base, opts) {
    const p = { hardness: opts.hardness || 1.5, tool: 'pickaxe', tier: opts.tier == null ? 1 : opts.tier, family: base };
    if (!opts.noBase) block(base, { ...p, tex: opts.tex || base, drop: opts.drop });
    const tex = opts.tex || base;
    const stem = opts.stem || base.replace(/_block$/, '').replace(/s$/, '').replace(/bricks$/, 'brick').replace(/tiles$/, 'tile');
    if (opts.slab) block(`${stem}_slab`, { ...p, shape: 'slab', tex, state: 'slab' });
    if (opts.stairs) block(`${stem}_stairs`, { ...p, shape: 'stairs', tex, state: 'stairs' });
    if (opts.wall) block(`${stem}_wall`, { ...p, shape: 'wall', tex });
  }
  family('cobblestone', { hardness: 2, slab: 1, stairs: 1, wall: 1, stem: 'cobblestone' });
  family('mossy_cobblestone', { hardness: 2, slab: 1, stairs: 1, wall: 1, stem: 'mossy_cobblestone' });
  block('stone_slab', { shape: 'slab', tex: 'stone', hardness: 1.5, tool: 'pickaxe', tier: 1, state: 'slab' });
  block('stone_stairs', { shape: 'stairs', tex: 'stone', hardness: 1.5, tool: 'pickaxe', tier: 1, state: 'stairs' });
  block('stone_button', { shape: 'button', tex: 'stone', hardness: 0.5, state: 'face' });
  block('stone_pressure_plate', { shape: 'plate', tex: 'stone', hardness: 0.5, tool: 'pickaxe', support: 'floor' });
  family('smooth_stone', { hardness: 2, slab: 1, stem: 'smooth_stone' });
  family('stone_bricks', { slab: 1, stairs: 1, wall: 1, stem: 'stone_brick' });
  family('mossy_stone_bricks', { slab: 1, stairs: 1, wall: 1, stem: 'mossy_stone_brick' });
  block('cracked_stone_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('chiseled_stone_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  for (const s of ['granite', 'diorite', 'andesite']) {
    family(s, { slab: 1, stairs: 1, wall: 1, stem: s });
    family(`polished_${s}`, { slab: 1, stairs: 1, stem: `polished_${s}` });
  }
  family('cobbled_deepslate', { hardness: 3.5, slab: 1, stairs: 1, wall: 1, stem: 'cobbled_deepslate' });
  family('polished_deepslate', { hardness: 3.5, slab: 1, stairs: 1, wall: 1, stem: 'polished_deepslate' });
  family('deepslate_bricks', { hardness: 3.5, slab: 1, stairs: 1, wall: 1, stem: 'deepslate_brick' });
  family('deepslate_tiles', { hardness: 3.5, slab: 1, stairs: 1, wall: 1, stem: 'deepslate_tile' });
  block('cracked_deepslate_bricks', { hardness: 3.5, tool: 'pickaxe', tier: 1 });
  block('cracked_deepslate_tiles', { hardness: 3.5, tool: 'pickaxe', tier: 1 });
  block('chiseled_deepslate', { hardness: 3.5, tool: 'pickaxe', tier: 1 });
  // 1.21 tuff family
  family('tuff', { noBase: true, slab: 1, stairs: 1, wall: 1, stem: 'tuff' });
  family('polished_tuff', { slab: 1, stairs: 1, wall: 1, stem: 'polished_tuff' });
  family('tuff_bricks', { slab: 1, stairs: 1, wall: 1, stem: 'tuff_brick' });
  block('chiseled_tuff', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('chiseled_tuff_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  family('sandstone', { hardness: 0.8, slab: 1, stairs: 1, wall: 1, tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, stem: 'sandstone' });
  family('smooth_sandstone', { hardness: 2, slab: 1, stairs: 1, tex: 'sandstone_top', stem: 'smooth_sandstone' });
  block('cut_sandstone', { tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'cut_sandstone' }, hardness: 0.8, tool: 'pickaxe', tier: 1 });
  block('chiseled_sandstone', { tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'chiseled_sandstone' }, hardness: 0.8, tool: 'pickaxe', tier: 1 });
  family('bricks', { hardness: 2, slab: 1, stairs: 1, wall: 1, stem: 'brick' });
  family('mud_bricks', { slab: 1, stairs: 1, wall: 1, stem: 'mud_brick' });
  block('packed_mud', { hardness: 1, tool: 'pickaxe' });

  // Metal / mineral blocks
  block('coal_block', { hardness: 5, tool: 'pickaxe', tier: 1, fuel: 800 });
  block('iron_block', { hardness: 5, tool: 'pickaxe', tier: 2 });
  block('gold_block', { hardness: 3, tool: 'pickaxe', tier: 3 });
  block('diamond_block', { hardness: 5, tool: 'pickaxe', tier: 3 });
  block('emerald_block', { hardness: 5, tool: 'pickaxe', tier: 3 });
  block('lapis_block', { hardness: 3, tool: 'pickaxe', tier: 2 });
  block('redstone_block', { hardness: 5, tool: 'pickaxe', tier: 1 });

  // Copper ages over time; an axe scrapes it back. (state of oxidation is the block itself)
  MC.COPPER_AGES = ['', 'exposed_', 'weathered_', 'oxidized_'];
  for (const age of MC.COPPER_AGES) {
    const p = { hardness: 3, tool: 'pickaxe', tier: 2, family: 'copper' };
    block(`${age}copper_block`.replace(/^copper_block$/, 'copper_block'), { ...p, tex: `${age}copper` });
    block(`${age}cut_copper`, { ...p });
    block(`${age}cut_copper_slab`, { ...p, shape: 'slab', tex: `${age}cut_copper`, state: 'slab' });
    block(`${age}cut_copper_stairs`, { ...p, shape: 'stairs', tex: `${age}cut_copper`, state: 'stairs' });
    block(`${age}chiseled_copper`, { ...p });
    block(`${age}copper_grate`, { ...p, shape: 'glass' });
    block(`${age}copper_bulb`, { ...p, light: 0, state: 'lit', use: 'toggle' });
    block(`${age}copper_door`, { ...p, shape: 'door', tex: { bottom: `${age}copper_door_bottom`, top: `${age}copper_door_top` }, state: 'door', use: 'toggle', icon: `${age}copper_door_item` });
    block(`${age}copper_trapdoor`, { ...p, shape: 'trapdoor', state: 'trapdoor', use: 'toggle' });
  }
  block('lightning_rod', { shape: 'rod', tex: 'copper', hardness: 3, tool: 'pickaxe', tier: 1, state: 'face6', icon: 'lightning_rod' });

  // ---------------- building / utility ----------------
  block('glass', { shape: 'glass', hardness: 0.3, drop: null });
  block('glass_pane', { shape: 'pane', tex: 'glass', hardness: 0.3, drop: null, icon: 'glass' });
  block('iron_bars', { shape: 'pane', hardness: 5, tool: 'pickaxe', icon: 'iron_bars' });
  block('chain', { shape: 'chain', hardness: 5, tool: 'pickaxe', state: 'axis', icon: 'chain_item' });
  block('iron_door', { shape: 'door', tex: { bottom: 'iron_door_bottom', top: 'iron_door_top' }, hardness: 5, tool: 'pickaxe', state: 'door', use: 'toggle', icon: 'iron_door_item' });
  block('iron_trapdoor', { shape: 'trapdoor', hardness: 5, tool: 'pickaxe', state: 'trapdoor', use: 'toggle' });
  block('ladder', { shape: 'ladder', hardness: 0.4, tool: 'axe', state: 'facing', icon: 'ladder', fuel: 15 });
  block('scaffolding', { shape: 'glass', hardness: 0, climb: true, solid: false, icon: 'scaffolding_top', tex: { top: 'scaffolding_top', bottom: 'scaffolding_top', side: 'scaffolding_side' }, fuel: 2.5 });
  block('torch', { shape: 'torch', hardness: 0, light: 14, state: 'torch', icon: 'torch' });
  block('redstone_torch', { shape: 'torch', hardness: 0, light: 7, state: 'torch', icon: 'redstone_torch' });
  block('lantern', { shape: 'lantern', hardness: 3.5, tool: 'pickaxe', light: 15, state: 'hanging', icon: 'lantern_item' });
  block('campfire', { shape: 'campfire', hardness: 2, tool: 'axe', light: 15, drop: 'charcoal', dropCount: [2, 2], icon: 'campfire_item' });
  block('crafting_table', { tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, hardness: 2.5, tool: 'axe', use: 'crafting', fuel: 15 });
  block('furnace', { tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, hardness: 3.5, tool: 'pickaxe', tier: 1, state: 'facing_lit', use: 'furnace' });
  block('blast_furnace', { tex: { top: 'blast_furnace_top', bottom: 'blast_furnace_top', side: 'blast_furnace_side', front: 'blast_furnace_front' }, hardness: 3.5, tool: 'pickaxe', tier: 1, state: 'facing_lit', use: 'furnace' });
  block('smoker', { tex: { top: 'smoker_top', bottom: 'smoker_top', side: 'smoker_side', front: 'smoker_front' }, hardness: 3.5, tool: 'pickaxe', tier: 1, state: 'facing_lit', use: 'furnace' });
  block('chest', { shape: 'chest', tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }, hardness: 2.5, tool: 'axe', state: 'facing', use: 'chest', fuel: 15 });
  block('barrel', { tex: { top: 'barrel_top', bottom: 'barrel_bottom', side: 'barrel_side' }, hardness: 2.5, tool: 'axe', use: 'chest', fuel: 15 });
  block('bookshelf', { tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', drop: 'book', dropCount: [3, 3], fuel: 15 });
  block('tnt', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, use: 'tnt' });
  block('redstone_lamp', { tex: 'redstone_lamp', hardness: 0.3, state: 'lit', use: 'toggle' });
  block('note_block', { hardness: 0.8, tool: 'axe', fuel: 15 });
  block('jukebox', { tex: { top: 'jukebox_top', bottom: 'note_block', side: 'note_block' }, hardness: 2, tool: 'axe', fuel: 15 });
  for (const t of ['loom', 'cartography_table', 'fletching_table', 'smithing_table', 'stonecutter', 'composter', 'cauldron', 'lectern', 'grindstone', 'anvil']) {
    const tool = ['cauldron', 'grindstone', 'anvil', 'stonecutter'].includes(t) ? 'pickaxe' : 'axe';
    block(t, { tex: { top: `${t}_top`, bottom: `${t}_bottom`, side: `${t}_side` }, hardness: tool === 'pickaxe' ? 3.5 : 2.5, tool, tier: tool === 'pickaxe' ? 1 : 0 });
  }
  block('target', { tex: { top: 'target_top', bottom: 'target_top', side: 'target_side' }, hardness: 0.5, tool: 'hoe' });
  block('lever', { shape: 'button', tex: 'cobblestone', hardness: 0.5, state: 'face', icon: 'lever' });
  block('dried_kelp_block', { tex: { top: 'dried_kelp_top', bottom: 'dried_kelp_top', side: 'dried_kelp_side' }, hardness: 0.5, tool: 'hoe', fuel: 200 });
  block('cake', { shape: 'cake', tex: { top: 'cake_top', bottom: 'cake_bottom', side: 'cake_side' }, hardness: 0.5, drop: null, use: 'cake', stack: 1, icon: 'cake_item' });
  block('sponge', { hardness: 0.6, tool: 'hoe' });
  block('slime_block', { shape: 'tglass', hardness: 0, sound: 'slime' });
  block('honey_block', { shape: 'tglass', hardness: 0, sound: 'slime' });
  block('bone_block', { tex: { end: 'bone_block_top', side: 'bone_block_side' }, hardness: 2, tool: 'pickaxe', tier: 1, state: 'axis' });

  // ---------------- colours ----------------
  MC.COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  block('terracotta', { hardness: 1.25, tool: 'pickaxe', tier: 1 });
  for (const c of MC.COLORS) {
    block(`${c}_wool`, { hardness: 0.8, tool: 'shears', color: c, sound: 'cloth' });
    block(`${c}_carpet`, { shape: 'carpet', tex: `${c}_wool`, hardness: 0.1, color: c, support: 'floor', sound: 'cloth' });
    block(`${c}_stained_glass`, { shape: 'tglass', hardness: 0.3, drop: null, color: c, sound: 'glass' });
    block(`${c}_stained_glass_pane`, { shape: 'pane', tex: `${c}_stained_glass`, render: 'translucent', hardness: 0.3, drop: null, color: c, icon: `${c}_stained_glass`, sound: 'glass' });
    block(`${c}_terracotta`, { hardness: 1.25, tool: 'pickaxe', tier: 1, color: c });
    block(`${c}_glazed_terracotta`, { hardness: 1.4, tool: 'pickaxe', tier: 1, color: c, state: 'facing' });
    block(`${c}_concrete`, { hardness: 1.8, tool: 'pickaxe', tier: 1, color: c });
    block(`${c}_concrete_powder`, { hardness: 0.5, tool: 'shovel', gravity: true, color: c, sound: 'sand' });
    block(`${c}_bed`, { shape: 'bed', tex: { top: `${c}_bed_top`, side: `${c}_bed_side`, bottom: 'oak_planks' }, hardness: 0.2, color: c, state: 'facing', use: 'bed', stack: 1, sound: 'cloth' });
    block(`${c}_candle`, { shape: 'candle', hardness: 0.1, color: c, state: 'candle', light: 3, icon: `${c}_candle` });
  }
  block('candle', { shape: 'candle', hardness: 0.1, state: 'candle', light: 3, icon: 'candle' });

  // ---------------- items ----------------
  const TIERS = { wooden: [1, 2, 59, 'oak_planks'], stone: [2, 4, 131, 'cobblestone'], iron: [3, 6, 250, 'iron_ingot'], golden: [1, 12, 32, 'gold_ingot'], diamond: [4, 8, 1561, 'diamond'], netherite: [4, 9, 2031, null] };
  MC.TOOL_TIERS = TIERS;
  const DMG = { sword: 4, axe: 7, pickaxe: 2, shovel: 2.5, hoe: 1 };
  for (const [mat, [tier, speed, uses]] of Object.entries(TIERS)) {
    if (mat === 'netherite') continue;
    for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
      item(`${mat}_${kind}`, {
        stack: 1, icon: `${mat}_${kind}`, fuel: mat === 'wooden' ? 10 : 0,
        tool: { type: kind, tier, speed, uses }, damage: DMG[kind] + (tier - 1) * (kind === 'sword' ? 1 : 0.5),
      });
    }
  }
  item('shears', { stack: 1, tool: { type: 'shears', tier: 2, speed: 5, uses: 238 } });
  const ARMOR = { leather: [1, 3, 2, 1, 80], chainmail: [2, 5, 4, 1, 240], iron: [2, 6, 5, 2, 240], golden: [2, 5, 3, 1, 112], diamond: [3, 8, 6, 3, 528] };
  MC.ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
  for (const [mat, [h, c, l, b, uses]] of Object.entries(ARMOR)) {
    const pts = { helmet: h, chestplate: c, leggings: l, boots: b };
    for (const slot of MC.ARMOR_SLOTS) item(`${mat}_${slot}`, { stack: 1, armor: { slot, points: pts[slot], uses } });
  }
  const simple = [
    'stick', 'coal', 'charcoal', 'raw_iron', 'raw_copper', 'raw_gold', 'iron_ingot', 'copper_ingot', 'gold_ingot',
    'iron_nugget', 'gold_nugget', 'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'amethyst_shard', 'flint',
    'clay_ball', 'brick', 'bone', 'bone_meal', 'string', 'feather', 'gunpowder', 'leather', 'paper', 'book',
    'sugar', 'wheat', 'wheat_seeds', 'egg', 'snowball', 'ink_sac', 'glow_ink_sac', 'honeycomb', 'slime_ball',
    'glowstone_dust', 'arrow', 'bowl', 'mud_brick_item',
  ];
  for (const k of simple) item(k, {});
  ITEMS.stick.fuel = 5; ITEMS.coal.fuel = 80; ITEMS.charcoal.fuel = 80; ITEMS.bowl.fuel = 5;
  ITEMS.egg.stack = 16; ITEMS.snowball.stack = 16;
  ITEMS.bone_meal.use = 'bone_meal';
  ITEMS.wheat_seeds.use = 'plant_wheat';
  for (const c of MC.COLORS) item(`${c}_dye`, {});
  const FOOD = {
    apple: [4, 2.4], golden_apple: [4, 9.6], bread: [5, 6], carrot: [3, 3.6], golden_carrot: [6, 14.4], potato: [1, 0.6],
    baked_potato: [5, 6], beef: [3, 1.8], cooked_beef: [8, 12.8], porkchop: [3, 1.8], cooked_porkchop: [8, 12.8],
    chicken: [2, 1.2], cooked_chicken: [6, 7.2], mutton: [2, 1.2], cooked_mutton: [6, 9.6], rotten_flesh: [4, 0.8],
    cookie: [2, 0.4], pumpkin_pie: [8, 4.8], mushroom_stew: [6, 7.2], glow_berries: [2, 0.4], melon_slice: [2, 1.2],
    sweet_berries: [2, 0.4], beetroot: [1, 1.2], dried_kelp: [1, 0.6],
  };
  for (const [k, [h, s]] of Object.entries(FOOD)) item(k, { food: { hunger: h, saturation: s }, stack: k === 'mushroom_stew' ? 1 : 64 });
  ITEMS.glow_berries.use = 'plant_vines';
  ITEMS.carrot.food.plant = true;
  ITEMS.dried_kelp.fuel = 0;
  item('bucket', { stack: 16, use: 'bucket' });
  item('water_bucket', { stack: 1, use: 'place_water' });
  item('lava_bucket', { stack: 1, use: 'place_lava', fuel: 1000 });
  item('powder_snow_bucket', { stack: 1, use: 'place_powder_snow' });
  item('milk_bucket', { stack: 1, use: 'drink_milk' });
  item('flint_and_steel', { stack: 1, use: 'ignite', tool: { type: 'flint', tier: 0, speed: 1, uses: 64 } });
  item('compass', { stack: 1, use: 'compass' });
  item('recovery_compass', { stack: 1, use: 'compass' });
  item('clock', { stack: 1, use: 'clock' });
  item('spyglass', { stack: 1, use: 'spyglass' });
  item('bow', { stack: 1, use: 'bow', tool: { type: 'bow', tier: 0, speed: 1, uses: 384 }, fuel: 15 });
  item('fishing_rod', { stack: 1, tool: { type: 'rod', tier: 0, speed: 1, uses: 64 }, fuel: 15 });
  item('shield', { stack: 1 });
  item('brush', { stack: 1 });
  item('mace', { stack: 1, damage: 6 });
  item('wind_charge', {});
  item('lead', {});
  item('name_tag', {});
  item('saddle', { stack: 1 });
  item('painting', {});
  item('item_frame', {});
  item('glow_item_frame', {});
  item('armor_stand', { stack: 16 });
  item('map', {});
  item('writable_book', { stack: 1 });
  item('glass_bottle', {});
  item('minecart', { stack: 1 });
  item('oak_boat', { stack: 1 });
  for (const w of MC.WOODS) {
    item(`${w}_boat`, { stack: 1, fuel: 60 });
    item(`${w}_sign`, { stack: 16, fuel: 10 });
  }
  item('axolotl_bucket', { stack: 1, creative: false });

  // Items whose shape is a 2D sprite rather than a little cube.
  for (const k of ITEM_LIST) {
    const it = ITEMS[k];
    if (!it.icon) it.icon = it.block ? `block:${it.block}` : k;
  }

  MC.BLOCKS = BLOCKS;
  MC.B = B;
  MC.ITEMS = ITEMS;
  MC.ITEM_LIST = ITEM_LIST;
  MC.SHAPES = SHAPES;
  MC.AIR = 0;
  MC.blockByKey = (k) => BLOCKS[B[k]];
})(globalThis);
