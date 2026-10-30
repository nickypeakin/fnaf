// Item stacks and inventories. A stack is {id, n, d} (item key, count, damage taken).
(function (G) {
  'use strict';
  const MC = G.MC;
  const I = MC.ITEMS;

  const Inv = {
    make(id, n = 1, d = 0) { return { id, n, d }; },
    max(id) { const it = I[id]; return it ? it.stack : 64; },
    same(a, b) { return !!(a && b && a.id === b.id && (a.d || 0) === (b.d || 0)); },
    clone(s) { return s ? { id: s.id, n: s.n, d: s.d || 0 } : null; },
    uses(id) { const it = I[id]; return it ? (it.tool && it.tool.uses) || (it.armor && it.armor.uses) || 0 : 0; },

    // Put a stack into slots (indices in `order`); merges into matching stacks first.
    // Returns how many items didn't fit. Mutates `st.n`.
    add(slots, st, order) {
      if (!st || st.n <= 0) return 0;
      order = order || slots.map((_, i) => i);
      const max = Inv.max(st.id);
      for (const i of order) {
        const s = slots[i];
        if (s && Inv.same(s, st) && s.n < max) {
          const k = Math.min(max - s.n, st.n);
          s.n += k; st.n -= k;
          if (!st.n) return 0;
        }
      }
      for (const i of order) {
        if (!slots[i]) {
          const k = Math.min(max, st.n);
          slots[i] = { id: st.id, n: k, d: st.d || 0 };
          st.n -= k;
          if (!st.n) return 0;
        }
      }
      return st.n;
    },

    count(slots, test) {
      let n = 0;
      for (const s of slots) if (s && test(s)) n += s.n;
      return n;
    },

    // Remove up to n items passing test; returns how many were removed.
    take(slots, test, n) {
      let got = 0;
      for (let i = slots.length - 1; i >= 0 && got < n; i--) {
        const s = slots[i];
        if (!s || !test(s)) continue;
        const k = Math.min(n - got, s.n);
        s.n -= k; got += k;
        if (!s.n) slots[i] = null;
      }
      return got;
    },
  };

  // Player inventory layout: main[0..8] is the hotbar, main[9..35] the backpack.
  Inv.HOTBAR = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  Inv.BACKPACK = Array.from({ length: 27 }, (_, i) => i + 9);
  Inv.PICKUP_ORDER = [...Inv.HOTBAR, ...Inv.BACKPACK];

  // Creative tabs.
  function blockOf(k) { const it = I[k]; return it && it.block ? MC.blockByKey(it.block) : null; }
  const NATURAL = /(ore|_log$|leaves|sapling|dirt|grass|sand|gravel|clay|stone$|deepslate$|tuff$|calcite|basalt|dripstone|amethyst|moss|azalea|lichen|dripleaf|sculk|snow|ice|obsidian|bedrock|mud$|podzol|mushroom|cactus|sugar_cane|pumpkin|melon|fern|bush|cobweb|roots|blossom|^raw_)/;
  Inv.TABS = [
    { name: 'Building', test: (k, it, b) => b && !b.use && !b.color && b.shape !== 'cross' && !NATURAL.test(k) && !/(torch|lantern|campfire|ladder|door|button|plate|lever|rod|chain|bars|pane|glass|candle|bed|scaffolding)/.test(k) || /copper|bricks|planks|stairs|slab|wall/.test(k) && b && !b.use },
    { name: 'Colored', test: (k, it, b) => !!(b && b.color) || k === 'candle' || k === 'terracotta' || /_dye$/.test(k) },
    { name: 'Natural', test: (k, it, b) => !!b && (NATURAL.test(k) || b.shape === 'cross') && !b.color },
    { name: 'Functional', test: (k, it, b) => !!b && (!!b.use || /(torch|lantern|campfire|ladder|door|button|plate|lever|rod|chain|bars|pane|glass|scaffolding|bookshelf|jukebox|note_block|loom|table|stonecutter|composter|cauldron|lectern|grindstone|anvil|target)/.test(k)) && !b.color },
    { name: 'Tools', test: (k, it) => !!(it.tool || it.armor) || /(bucket|compass|clock|spyglass|arrow|shield|mace|wind_charge|lead|name_tag|saddle|boat|minecart|flint_and_steel|map|brush)/.test(k) },
    { name: 'Food', test: (k, it) => !!it.food || k === 'cake' },
    { name: 'Ingredients', test: (k, it) => !it.block && !it.tool && !it.armor && !it.food && !/(bucket|compass|clock|spyglass|arrow|shield|mace|boat|minecart|sign|frame|painting|armor_stand|map|book|_dye$|lead|name_tag|saddle|brush|flint_and_steel|wind_charge)/.test(k) || /(book|sign|frame|painting|armor_stand)/.test(k) && !it.block },
  ];
  Inv.creativeItems = function (tab, query) {
    const q = (query || '').trim().toLowerCase();
    return MC.ITEM_LIST.filter((k) => {
      const it = I[k];
      if (!it.creative) return false;
      if (q) return it.name.toLowerCase().includes(q) || k.includes(q.replace(/ /g, '_'));
      const t = Inv.TABS.find((x) => x.name === tab);
      return t ? t.test(k, it, blockOf(k)) : true;
    });
  };

  MC.Inv = Inv;
})(globalThis);
