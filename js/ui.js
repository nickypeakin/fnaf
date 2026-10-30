// HUD (hotbar, hearts, hunger, armour, air, xp, chat, debug) and the inventory windows:
// player inventory with 2x2 crafting, crafting table, furnace, chest, creative palette and the
// recipe book.
(function (G) {
  'use strict';
  const MC = G.MC;
  const { Inv, Recipes } = MC;
  const I = MC.ITEMS;
  const $ = (id) => document.getElementById(id);

  // ---------- tiny pixel icons for the status bars ----------
  function pix(rows, pal) {
    const c = document.createElement('canvas');
    c.width = rows[0].length; c.height = rows.length;
    const g = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
    return c.toDataURL();
  }
  const heartRows = ['.##..##.', '#rr##rr#', '#wrrrrr#', '#rrrrrr#', '.#rrrr#.', '..#rr#..', '...##...', '........'];
  const halfPal = { '#': '#000', r: '#d01010', w: '#ff8080' };
  const ICONS = {
    heart: pix(heartRows, { '#': '#000', r: '#d01010', w: '#ff9090' }),
    heartHalf: pix(heartRows.map((r) => r.slice(0, 4) + r.slice(4).replace(/[rw]/g, 'e')), { ...halfPal, e: '#3a1010' }),
    heartEmpty: pix(heartRows.map((r) => r.replace(/[rw]/g, 'e')), { '#': '#000', e: '#3a1010' }),
    food: pix(['....##..', '...#bb#.', '..#bbbb#', '.#bbbbb#', '.#bbbb#.', 'w##bb#..', 'ww.##...', '.w......'], { '#': '#3a1a00', b: '#b5652a', w: '#e8e0d0' }),
    foodHalf: pix(['....##..', '...#ee#.', '..#eeee#', '.#bbeee#', '.#bbee#.', 'w##ee#..', 'ww.##...', '.w......'], { '#': '#3a1a00', b: '#b5652a', w: '#e8e0d0', e: '#2a1a10' }),
    foodEmpty: pix(['....##..', '...#ee#.', '..#eeee#', '.#eeeee#', '.#eeee#.', 'e##ee#..', 'ee.##...', '.e......'], { '#': '#3a1a00', e: '#2a1a10' }),
    armor: pix(['##....##', '#g#..#g#', '#gg##gg#', '#gggggg#', '.#gggg#.', '.#gggg#.', '.#gggg#.', '..####..'], { '#': '#222', g: '#d8d8d8' }),
    armorHalf: pix(['##....##', '#g#..#e#', '#gg##ee#', '#gggeee#', '.#ggee#.', '.#ggee#.', '.#ggee#.', '..####..'], { '#': '#222', g: '#d8d8d8', e: '#333' }),
    armorEmpty: pix(['##....##', '#e#..#e#', '#ee##ee#', '#eeeeee#', '.#eeee#.', '.#eeee#.', '.#eeee#.', '..####..'], { '#': '#222', e: '#333' }),
    bubble: pix(['..####..', '.#wbbb#.', '#wbbbbb#', '#bbbbbb#', '#bbbbbb#', '#bbbbbb#', '.#bbbb#.', '..####..'], { '#': '#1840a0', b: '#4080e0', w: '#e0f0ff' }),
  };

  function iconStyle(el, id) {
    const S = MC.ICON_SHEET;
    const i = MC.ICONS[id] != null ? MC.ICONS[id] : 0;
    el.style.backgroundSize = `${S.width}px ${S.height}px`;
    el.style.backgroundPosition = `-${(i % S.cols) * S.size}px -${Math.floor(i / S.cols) * S.size}px`;
  }
  MC.iconStyle = iconStyle;

  function fillSlot(el, st) {
    el.innerHTML = '';
    if (!st) return;
    const ic = document.createElement('div');
    ic.className = 'icon';
    iconStyle(ic, st.id);
    el.appendChild(ic);
    if (st.n > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = st.n; el.appendChild(c); }
    const uses = Inv.uses(st.id);
    if (uses && st.d > 0) {
      const f = Math.max(0, 1 - st.d / uses);
      const bar = document.createElement('div');
      bar.className = 'dur';
      bar.innerHTML = `<i style="width:${Math.round(f * 100)}%;background:hsl(${Math.round(f * 120)},100%,45%)"></i>`;
      el.appendChild(bar);
    }
  }

  const ARMOR_KIND = ['helmet', 'chestplate', 'leggings', 'boots'];
  const BOOK_TABS = [
    ['All', () => true],
    ['Building', (r) => { const it = I[r.out]; return !!it.block && !MC.blockByKey(it.block).use && !/(torch|lantern|door|button|plate|lever|bed|candle|carpet|pane|dye)/.test(r.out); }],
    ['Tools', (r) => { const it = I[r.out]; return !!(it.tool || it.armor) || /(bucket|compass|clock|spyglass|arrow|shield|boat|minecart|flint_and_steel|brush|lead|map)/.test(r.out); }],
    ['Food', (r) => !!I[r.out].food || r.out === 'cake'],
    ['Misc', (r) => { const it = I[r.out]; return !it.block || !!MC.blockByKey(it.block).use || /(torch|lantern|door|button|plate|lever|bed|candle|carpet|dye)/.test(r.out); }],
  ];

  class UI {
    constructor(game) {
      this.game = game;
      this.cursor = null;
      this.win = null;
      this.refs = [];
      this.hoverRef = null;
      this.bookOpen = true;
      this.bookTab = 'All';
      this.bookQuery = '';
      this.bookCraftable = false;
      this.creativeTab = 'Building';
      this.creativeQuery = '';
      this.mouse = { x: 0, y: 0 };
      this.hudSig = '';
      this.chatLines = [];
      this.buildHUD();
      this.bindWindow();
    }

    // ================= HUD =================
    buildHUD() {
      const hb = $('hotbar');
      hb.innerHTML = '';
      this.hotEls = [];
      for (let i = 0; i < 9; i++) { const s = document.createElement('div'); s.className = 'slot'; hb.appendChild(s); this.hotEls.push(s); }
      const mk = (id) => { const el = $(id); el.innerHTML = ''; const out = []; for (let i = 0; i < 10; i++) { const x = document.createElement('i'); el.appendChild(x); out.push(x); } return out; };
      this.hearts = mk('health-bar'); this.foods = mk('food-bar'); this.armors = mk('armor-bar'); this.bubbles = mk('air-bar');
    }

    hud() {
      const g = this.game, p = g.player, inv = g.inv;
      const sig = JSON.stringify([inv.main.slice(0, 9), g.selected, g.health, g.food, g.armorPoints(), Math.ceil(g.air / 30), g.xpLevel, Math.round(g.xpProgress * 60), p.mode, p.eyeInWater]);
      if (sig === this.hudSig) return;
      const oldSel = this.hudSel;
      this.hudSig = sig;
      this.hudSel = g.selected;
      this.hotEls.forEach((el, i) => { fillSlot(el, inv.main[i]); el.classList.toggle('sel', i === g.selected); });
      const surv = p.mode === 'survival';
      $('stats').style.visibility = surv ? 'visible' : 'hidden';
      $('xp-bar').style.visibility = surv ? 'visible' : 'hidden';
      const set = (els, val, full, half, empty) => els.forEach((el, i) => { const v = val - i * 2; el.style.backgroundImage = `url(${v >= 2 ? ICONS[full] : v === 1 ? ICONS[half] : ICONS[empty]})`; });
      set(this.hearts, Math.ceil(g.health), 'heart', 'heartHalf', 'heartEmpty');
      set(this.foods, Math.ceil(g.food), 'food', 'foodHalf', 'foodEmpty');
      const ap = g.armorPoints();
      $('armor-bar').style.visibility = ap > 0 ? 'visible' : 'hidden';
      set(this.armors, ap, 'armor', 'armorHalf', 'armorEmpty');
      const showAir = p.eyeInWater || g.air < 300;
      $('air-bar').style.visibility = showAir ? 'visible' : 'hidden';
      const bubbles = Math.ceil(g.air / 30);
      this.bubbles.forEach((el, i) => { el.style.backgroundImage = i < bubbles ? `url(${ICONS.bubble})` : 'none'; });
      $('xp-fill').style.width = Math.round(g.xpProgress * 100) + '%';
      $('xp-level').textContent = g.xpLevel > 0 ? g.xpLevel : '';
      if (oldSel !== g.selected || this.lastHeld !== (inv.main[g.selected] && inv.main[g.selected].id)) {
        const st = inv.main[g.selected];
        this.lastHeld = st && st.id;
        const nm = $('itemname');
        nm.textContent = st ? I[st.id].name : '';
        nm.style.opacity = 1;
        clearTimeout(this.nameT);
        this.nameT = setTimeout(() => { nm.style.opacity = 0; }, 2000);
      }
    }

    toast(msg, ms = 2500) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this.toastT);
      this.toastT = setTimeout(() => t.classList.remove('show'), ms);
    }

    chat(msg, color) {
      const log = $('chat-log');
      const d = document.createElement('div');
      d.textContent = msg;
      if (color) d.style.color = color;
      log.appendChild(d);
      while (log.children.length > 50) log.removeChild(log.firstChild);
      setTimeout(() => d.classList.add('fade'), 10000);
    }

    // ================= windows =================
    get open() { return !!this.win; }

    openWindow(type, opts = {}) {
      if (this.win) this.closeWindow(true);
      const g = this.game;
      if (type === 'inventory' && g.player.mode === 'creative') type = 'creative';
      this.win = { type, ...opts };
      if (type === 'crafting') this.win.grid = new Array(9).fill(null);
      if (type === 'inventory' || type === 'creative') this.win.grid = g.inv.craft;
      $('window-layer').classList.remove('hidden');
      this.render();
      g.releasePointer();
    }

    closeWindow(silent) {
      if (!this.win) return;
      const g = this.game;
      // return crafting grid items and the cursor stack to the inventory (or drop them)
      const back = (st) => { if (!st) return; const left = Inv.add(g.inv.main, st, Inv.PICKUP_ORDER); if (left > 0) g.dropStack({ ...st, n: left }); };
      if (this.win.grid) { for (let i = 0; i < this.win.grid.length; i++) { back(this.win.grid[i]); this.win.grid[i] = null; } }
      back(this.cursor);
      this.cursor = null;
      if (this.win.tileKey) g.closeTile(this.win.tileKey);
      this.win = null;
      $('window-layer').classList.add('hidden');
      $('cursor-stack').classList.add('hidden');
      $('tooltip').classList.add('hidden');
      g.invChanged();
      if (!silent) g.requestPointer();
    }

    render() {
      const w = this.win, g = this.game, inv = g.inv;
      const root = $('window');
      root.innerHTML = '';
      this.refs = [];
      const main = document.createElement('div');
      main.className = 'win-main';
      const title = (t) => { const d = document.createElement('div'); d.className = 'win-title'; d.textContent = t; return d; };
      const grid = (cols, refs) => { const d = document.createElement('div'); d.className = 'grid c' + cols; for (const r of refs) d.appendChild(this.slotEl(r)); return d; };
      const range = (arr, a, b, kind) => { const out = []; for (let i = a; i < b; i++) out.push({ arr, i, kind: kind || 'any' }); return out; };
      const playerInv = () => {
        const d = document.createElement('div');
        d.appendChild(title('Inventory'));
        d.appendChild(grid(9, range(inv.main, 9, 36)));
        const gap = document.createElement('div'); gap.className = 'hotbar-gap'; d.appendChild(gap);
        d.appendChild(grid(9, range(inv.main, 0, 9)));
        return d;
      };
      const craftRow = (gridArr, size) => {
        const row = document.createElement('div');
        row.className = 'row';
        const refs = gridArr.map((_, i) => ({ arr: gridArr, i, kind: 'grid' }));
        row.appendChild(grid(size, refs));
        const ar = document.createElement('div'); ar.className = 'arrow'; row.appendChild(ar);
        const res = this.slotEl({ kind: 'result', size });
        res.classList.add('big');
        row.appendChild(res);
        const bk = document.createElement('div');
        bk.className = 'book-btn' + (this.bookOpen ? ' on' : '');
        bk.title = 'Recipe book';
        bk.textContent = '📗';
        bk.onclick = () => { this.bookOpen = !this.bookOpen; this.render(); };
        row.appendChild(bk);
        return row;
      };

      if (w.type === 'inventory') {
        main.appendChild(title('Crafting'));
        const top = document.createElement('div');
        top.className = 'row';
        top.appendChild(grid(1, [0, 1, 2, 3].map((i) => ({ arr: inv.armor, i, kind: 'armor:' + ARMOR_KIND[i] }))));
        const prev = document.createElement('div'); prev.className = 'player-preview'; prev.textContent = g.playerName || 'You'; top.appendChild(prev);
        top.appendChild(grid(1, [{ arr: inv.offhand, i: 0, kind: 'any' }]));
        top.appendChild(craftRow(w.grid, 2));
        main.appendChild(top);
        main.appendChild(playerInv());
      } else if (w.type === 'crafting') {
        main.appendChild(title('Crafting'));
        main.appendChild(craftRow(w.grid, 3));
        main.appendChild(playerInv());
      } else if (w.type === 'furnace') {
        const t = w.tile;
        main.appendChild(title(w.title || 'Furnace'));
        const row = document.createElement('div');
        row.className = 'row';
        const col = document.createElement('div');
        col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';
        col.appendChild(this.slotEl({ arr: t.slots, i: 0, kind: 'input' }));
        const fl = document.createElement('div'); fl.className = 'flame'; fl.innerHTML = '<i></i>'; col.appendChild(fl);
        col.appendChild(this.slotEl({ arr: t.slots, i: 1, kind: 'fuel' }));
        row.appendChild(col);
        const ar = document.createElement('div'); ar.className = 'arrow'; ar.innerHTML = '<div class="fill"></div>'; row.appendChild(ar);
        const out = this.slotEl({ arr: t.slots, i: 2, kind: 'output' }); out.classList.add('big'); row.appendChild(out);
        row.style.padding = '8px 40px';
        main.appendChild(row);
        this.furnaceEls = { flame: fl.firstChild, arrow: ar.firstChild };
        main.appendChild(playerInv());
      } else if (w.type === 'chest') {
        main.appendChild(title(w.title || 'Chest'));
        main.appendChild(grid(9, range(w.tile.slots, 0, w.tile.slots.length)));
        main.appendChild(playerInv());
      } else if (w.type === 'creative') {
        main.appendChild(this.creativePanel());
      }
      root.appendChild(main);
      if ((w.type === 'inventory' || w.type === 'crafting') && this.bookOpen) root.insertBefore(this.bookPanel(w.type === 'crafting' ? 3 : 2), main);
      this.refresh();
    }

    slotEl(ref) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.dataset.r = this.refs.length;
      ref.el = el;
      this.refs.push(ref);
      return el;
    }

    refresh() {
      if (!this.win) return;
      for (const r of this.refs) {
        if (r.kind === 'result') fillSlot(r.el, this.result());
        else if (r.kind === 'palette') fillSlot(r.el, { id: r.id, n: 1 });
        else if (r.kind === 'trash') r.el.innerHTML = '<span style="color:#fff;font-size:20px">✖</span>';
        else fillSlot(r.el, r.arr[r.i]);
        if (r.kind && r.kind.startsWith('armor:') && !r.arr[r.i]) r.el.style.opacity = 0.75; else r.el.style.opacity = '';
      }
      this.updateCursor();
      if (this.bookList) this.fillBook();
    }

    tick() {
      if (!this.win) return;
      if (this.win.type === 'furnace' && this.furnaceEls) {
        const t = this.win.tile;
        const burn = t.burnMax ? t.burn / t.burnMax : 0;
        this.furnaceEls.flame.style.height = Math.round(burn * 22) + 'px';
        this.furnaceEls.flame.style.opacity = burn > 0 ? 1 : 0;
        this.furnaceEls.arrow.style.width = Math.round((t.cook / (t.cookMax || 10)) * 100) + '%';
        if (t.dirty) { t.dirty = false; this.refresh(); }
      }
      if (this.win.type === 'chest' && this.win.tile.dirty) { this.win.tile.dirty = false; this.refresh(); }
    }

    // ---------- crafting result ----------
    result() {
      const w = this.win;
      if (!w || !w.grid) return null;
      const size = w.grid.length === 9 ? 3 : 2;
      const r = Recipes.match(w.grid, size, size);
      return r ? { id: r.out, n: r.n, d: 0 } : null;
    }

    craftOnce() {
      const w = this.win;
      const size = w.grid.length === 9 ? 3 : 2;
      const r = Recipes.match(w.grid, size, size);
      if (!r) return null;
      for (let i = 0; i < w.grid.length; i++) {
        const s = w.grid[i];
        if (!s) continue;
        s.n--;
        if (s.id === 'milk_bucket' || s.id === 'water_bucket' || s.id === 'lava_bucket') { w.grid[i] = { id: 'bucket', n: 1, d: 0 }; continue; }
        if (!s.n) w.grid[i] = null;
      }
      this.game.onCraft(r.out, r.n);
      return { id: r.out, n: r.n, d: 0 };
    }

    // ---------- clicks ----------
    bindWindow() {
      const layer = $('window-layer');
      layer.addEventListener('contextmenu', (e) => e.preventDefault());
      layer.addEventListener('mousedown', (e) => {
        const slot = e.target.closest('.slot');
        if (slot && slot.dataset.r != null) {
          e.preventDefault();
          this.click(this.refs[+slot.dataset.r], e.button, e.shiftKey);
          this.game.audio.play('click', null, 0.25);
          return;
        }
        // clicking outside the panel drops the cursor stack
        if (!e.target.closest('#window') && this.cursor) {
          if (e.button === 2) { this.game.dropStack({ ...this.cursor, n: 1 }); this.cursor.n--; if (!this.cursor.n) this.cursor = null; }
          else { this.game.dropStack(this.cursor); this.cursor = null; }
          this.updateCursor();
        }
      });
      layer.addEventListener('mousemove', (e) => {
        this.mouse.x = e.clientX; this.mouse.y = e.clientY;
        const cs = $('cursor-stack');
        cs.style.left = e.clientX + 'px'; cs.style.top = e.clientY + 'px';
        const slot = e.target.closest('.slot, .rec');
        const tip = $('tooltip');
        for (const r of this.refs) r.el.classList.remove('hover');
        this.hoverRef = null;
        if (slot && slot.dataset.r != null) {
          const ref = this.refs[+slot.dataset.r];
          this.hoverRef = ref;
          slot.classList.add('hover');
          const st = ref.kind === 'result' ? this.result() : ref.kind === 'palette' ? { id: ref.id, n: 1 } : ref.arr && ref.arr[ref.i];
          if (st && !this.cursor) { this.showTip(st, e); return; }
        } else if (slot && slot.dataset.rec != null) {
          const rec = this.bookRecipes[+slot.dataset.rec];
          if (rec) { this.showTip({ id: rec.out, n: rec.n }, e, rec); return; }
        }
        tip.classList.add('hidden');
      });
    }

    showTip(st, e, rec) {
      const tip = $('tooltip');
      const it = I[st.id];
      let html = `${it.name}`;
      const uses = Inv.uses(st.id);
      if (it.tool && it.tool.type !== 'flint' && it.damage > 1) html += `<small>${it.damage} attack damage</small>`;
      if (it.armor) html += `<small>+${it.armor.points} armor</small>`;
      if (it.food) html += `<small>Restores ${it.food.hunger / 2} hunger</small>`;
      if (uses) html += `<small>Durability: ${uses - (st.d || 0)} / ${uses}</small>`;
      if (rec) {
        const parts = [...Recipes.ingredients(rec)].map(([k, n]) => `${n}× ${k.startsWith('#') ? 'any ' + k.slice(1).replace(/_/g, ' ') : I[k].name}`);
        html += `<small>${parts.join(', ')}</small>`;
        if (!Recipes.fits(rec, this.win.grid.length === 9 ? 3 : 2)) html += '<small style="color:#f88">Needs a crafting table</small>';
      }
      tip.innerHTML = html;
      tip.classList.remove('hidden');
      tip.style.left = Math.min(innerWidth - 330, e.clientX + 14) + 'px';
      tip.style.top = e.clientY - 30 + 'px';
    }

    updateCursor() {
      const cs = $('cursor-stack');
      if (!this.cursor) { cs.classList.add('hidden'); return; }
      cs.classList.remove('hidden');
      cs.innerHTML = '';
      const ic = document.createElement('div'); ic.className = 'icon'; iconStyle(ic, this.cursor.id); cs.appendChild(ic);
      if (this.cursor.n > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = this.cursor.n; cs.appendChild(c); }
      cs.style.left = this.mouse.x + 'px'; cs.style.top = this.mouse.y + 'px';
    }

    accepts(ref, st) {
      if (!st) return true;
      if (ref.kind.startsWith('armor:')) { const a = I[st.id].armor; return (a && a.slot === ref.kind.slice(6)) || (ref.kind === 'armor:helmet' && st.id === 'carved_pumpkin'); }
      if (ref.kind === 'fuel') return this.game.fuelValue(st.id) > 0 || st.id === 'bucket';
      if (ref.kind === 'output' || ref.kind === 'result') return false;
      return true;
    }

    click(ref, button, shift) {
      const g = this.game;
      if (!ref) return;
      if (ref.kind === 'palette') return this.paletteClick(ref, button, shift);
      if (ref.kind === 'trash') {
        if (shift) { g.inv.main.fill(null); g.inv.armor.fill(null); g.inv.offhand.fill(null); }
        this.cursor = null;
        this.changed();
        return;
      }
      if (ref.kind === 'result') {
        const res = this.result();
        if (!res) return;
        if (shift) {
          // craft as many as fit into the inventory
          for (let k = 0; k < 64; k++) {
            const r2 = this.result();
            if (!r2 || r2.id !== res.id) break;
            const tmp = g.inv.main.map(Inv.clone);
            if (Inv.add(tmp, { ...r2 }, [...Inv.BACKPACK, ...Inv.HOTBAR.slice().reverse()]) > 0) break;
            const made = this.craftOnce();
            Inv.add(g.inv.main, made, [...Inv.BACKPACK, ...Inv.HOTBAR.slice().reverse()]);
          }
        } else {
          if (this.cursor && (!Inv.same(this.cursor, res) || this.cursor.n + res.n > Inv.max(res.id))) return;
          const made = this.craftOnce();
          if (this.cursor) this.cursor.n += made.n; else this.cursor = made;
        }
        this.changed();
        return;
      }
      const arr = ref.arr, i = ref.i;
      const s = arr[i];
      if (ref.kind === 'output') {
        if (!s) return;
        if (shift) { const left = Inv.add(g.inv.main, { ...s }, [...Inv.BACKPACK, ...Inv.HOTBAR]); this.takeOutput(ref, s.n - left); }
        else if (!this.cursor) { this.cursor = { ...s }; this.takeOutput(ref, s.n); }
        else if (Inv.same(this.cursor, s) && this.cursor.n + s.n <= Inv.max(s.id)) { this.cursor.n += s.n; this.takeOutput(ref, s.n); }
        this.changed();
        return;
      }
      if (shift) { this.quickMove(ref); this.changed(); return; }
      const cur = this.cursor;
      const max = cur ? Math.min(Inv.max(cur.id), ref.kind.startsWith('armor:') ? 1 : 64) : 64;
      if (button === 0) {
        if (!cur) { if (s) { this.cursor = s; arr[i] = null; } }
        else if (!s) { if (this.accepts(ref, cur)) { const k = Math.min(max, cur.n); arr[i] = { ...cur, n: k }; cur.n -= k; if (!cur.n) this.cursor = null; } }
        else if (Inv.same(s, cur)) { const k = Math.min(max - s.n, cur.n); if (k > 0) { s.n += k; cur.n -= k; if (!cur.n) this.cursor = null; } }
        else if (this.accepts(ref, cur) && cur.n <= max) { arr[i] = cur; this.cursor = s; }
      } else if (button === 2) {
        if (!cur) { if (s) { const half = Math.ceil(s.n / 2); this.cursor = { ...s, n: half }; s.n -= half; if (!s.n) arr[i] = null; } }
        else if (!s) { if (this.accepts(ref, cur)) { arr[i] = { ...cur, n: 1 }; cur.n--; if (!cur.n) this.cursor = null; } }
        else if (Inv.same(s, cur)) { if (s.n < max) { s.n++; cur.n--; if (!cur.n) this.cursor = null; } }
        else if (this.accepts(ref, cur) && cur.n <= max) { arr[i] = cur; this.cursor = s; }
      }
      this.changed(ref);
    }

    takeOutput(ref, n) {
      const s = ref.arr[ref.i];
      if (!s || n <= 0) return;
      const t = this.win.tile;
      if (t && t.xp) { this.game.giveXP(this.game.localPlayer(), Math.floor(t.xp)); t.xp = 0; }
      s.n -= n;
      if (s.n <= 0) ref.arr[ref.i] = null;
    }

    quickMove(ref) {
      const g = this.game, inv = g.inv, w = this.win;
      const st = ref.arr[ref.i];
      if (!st) return;
      const fromPlayer = ref.arr === inv.main;
      let dest = [];
      if (fromPlayer) {
        if (w.type === 'chest') dest = [[w.tile.slots, null]];
        else if (w.type === 'furnace') {
          if (Recipes.SMELT[st.id]) dest = [[w.tile.slots, [0]]];
          else if (g.fuelValue(st.id) > 0) dest = [[w.tile.slots, [1]]];
        } else if (w.type === 'inventory' && I[st.id].armor) {
          const k = ARMOR_KIND.indexOf(I[st.id].armor.slot);
          if (!inv.armor[k]) { inv.armor[k] = st; ref.arr[ref.i] = null; return; }
        }
        if (!dest.length) dest = [[inv.main, ref.i < 9 ? Inv.BACKPACK : Inv.HOTBAR]];
      } else dest = [[inv.main, [...Inv.BACKPACK, ...Inv.HOTBAR.slice().reverse()]]];
      for (const [arr, order] of dest) {
        const left = Inv.add(arr, st, order || undefined);
        if (left === 0) { ref.arr[ref.i] = null; return; }
      }
    }

    changed(ref) {
      if (this.win && this.win.tileKey && (!ref || ref.arr === (this.win.tile && this.win.tile.slots))) this.game.tileChanged(this.win.tileKey);
      else if (this.win && this.win.tileKey) this.game.tileChanged(this.win.tileKey);
      this.game.invChanged();
      this.refresh();
    }

    // Number keys over a slot swap it with that hotbar slot; Q drops from the hovered slot.
    key(e) {
      const ref = this.hoverRef;
      if (!ref || !ref.arr) return false;
      const g = this.game;
      if (/^Digit[1-9]$/.test(e.code)) {
        const h = +e.code.slice(5) - 1;
        if (ref.kind === 'output' || (ref.kind !== 'any' && ref.kind !== 'grid' && ref.kind !== 'input' && ref.kind !== 'fuel')) return true;
        const a = ref.arr[ref.i], b = g.inv.main[h];
        if (b && !this.accepts(ref, b)) return true;
        ref.arr[ref.i] = b; g.inv.main[h] = a;
        this.changed(ref);
        return true;
      }
      if (e.code === 'KeyQ') {
        const s = ref.arr[ref.i];
        if (!s) return true;
        const n = e.ctrlKey ? s.n : 1;
        g.dropStack({ ...s, n });
        s.n -= n;
        if (!s.n) ref.arr[ref.i] = null;
        this.changed(ref);
        return true;
      }
      return false;
    }

    // ================= creative =================
    creativePanel() {
      const d = document.createElement('div');
      d.className = 'creative';
      const tabs = document.createElement('div');
      tabs.className = 'tabs';
      for (const t of [...Inv.TABS.map((x) => x.name), 'Search', 'Inventory']) {
        const b = document.createElement('div');
        b.className = 'tab' + (this.creativeTab === t ? ' on' : '');
        b.textContent = t;
        b.onmousedown = (e) => { e.stopPropagation(); this.creativeTab = t; this.render(); };
        tabs.appendChild(b);
      }
      d.appendChild(tabs);
      const inv = this.game.inv;
      if (this.creativeTab === 'Inventory') {
        const top = document.createElement('div');
        top.className = 'row';
        const arm = document.createElement('div'); arm.className = 'grid c1';
        [0, 1, 2, 3].forEach((i) => arm.appendChild(this.slotEl({ arr: inv.armor, i, kind: 'armor:' + ARMOR_KIND[i] })));
        top.appendChild(arm);
        const off = document.createElement('div'); off.className = 'grid c1'; off.appendChild(this.slotEl({ arr: inv.offhand, i: 0, kind: 'any' })); top.appendChild(off);
        d.appendChild(top);
        const bp = document.createElement('div'); bp.className = 'grid c9';
        for (let i = 9; i < 36; i++) bp.appendChild(this.slotEl({ arr: inv.main, i, kind: 'any' }));
        d.appendChild(bp);
      } else {
        if (this.creativeTab === 'Search') {
          const s = document.createElement('input');
          s.type = 'search'; s.placeholder = 'Search items…'; s.value = this.creativeQuery;
          s.oninput = () => { this.creativeQuery = s.value; this.fillPalette(); };
          s.onmousedown = (e) => e.stopPropagation();
          d.appendChild(s);
          setTimeout(() => s.focus(), 0);
        }
        const pal = document.createElement('div');
        pal.className = 'palette';
        this.paletteEl = pal;
        d.appendChild(pal);
        this.fillPalette();
      }
      const row = document.createElement('div'); row.className = 'row';
      const hb = document.createElement('div'); hb.className = 'grid c9';
      for (let i = 0; i < 9; i++) hb.appendChild(this.slotEl({ arr: inv.main, i, kind: 'any' }));
      row.appendChild(hb);
      const trash = this.slotEl({ kind: 'trash' }); trash.classList.add('trash'); trash.title = 'Destroy item (shift-click: clear inventory)';
      row.appendChild(trash);
      d.appendChild(row);
      return d;
    }

    fillPalette() {
      const pal = this.paletteEl;
      if (!pal) return;
      // drop old palette refs
      this.refs = this.refs.filter((r) => r.kind !== 'palette');
      this.refs.forEach((r, i) => { r.el.dataset.r = i; });
      pal.innerHTML = '';
      const items = Inv.creativeItems(this.creativeTab === 'Search' ? null : this.creativeTab, this.creativeTab === 'Search' ? this.creativeQuery || ' ' : '');
      const list = this.creativeTab === 'Search' && !this.creativeQuery ? MC.ITEM_LIST.filter((k) => I[k].creative) : items;
      for (const id of list) { const el = this.slotEl({ kind: 'palette', id }); fillSlot(el, { id, n: 1 }); pal.appendChild(el); }
    }

    paletteClick(ref, button, shift) {
      const id = ref.id;
      if (shift) { Inv.add(this.game.inv.main, { id, n: Inv.max(id), d: 0 }, Inv.PICKUP_ORDER); }
      else if (this.cursor) {
        if (this.cursor.id === id && this.cursor.n < Inv.max(id)) this.cursor.n++;
        else this.cursor = null;
      } else this.cursor = { id, n: button === 2 ? 1 : Inv.max(id), d: 0 };
      this.changed();
    }

    // ================= recipe book =================
    bookPanel(size) {
      const d = document.createElement('div');
      d.className = 'panel book';
      d.style.boxShadow = 'none';
      const s = document.createElement('input');
      s.type = 'search'; s.placeholder = 'Search recipes…'; s.value = this.bookQuery;
      s.oninput = () => { this.bookQuery = s.value; this.fillBook(); };
      s.onmousedown = (e) => e.stopPropagation();
      d.appendChild(s);
      const tabs = document.createElement('div');
      tabs.className = 'tabs';
      for (const [name] of BOOK_TABS) {
        const b = document.createElement('div');
        b.className = 'tab' + (this.bookTab === name ? ' on' : '');
        b.textContent = name;
        b.onmousedown = (e) => { e.stopPropagation(); this.bookTab = name; [...tabs.children].forEach((c) => c.classList.toggle('on', c === b)); this.fillBook(); };
        tabs.appendChild(b);
      }
      d.appendChild(tabs);
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = this.bookCraftable;
      cb.onchange = () => { this.bookCraftable = cb.checked; this.fillBook(); };
      lab.appendChild(cb); lab.appendChild(document.createTextNode('Show craftable only'));
      d.appendChild(lab);
      const list = document.createElement('div');
      list.className = 'list';
      list.addEventListener('mousedown', (e) => {
        const el = e.target.closest('.rec');
        if (!el) return;
        e.stopPropagation();
        e.preventDefault();
        this.fillFromRecipe(this.bookRecipes[+el.dataset.rec], e.shiftKey);
      });
      d.appendChild(list);
      const note = document.createElement('div');
      note.style.cssText = 'font-size:12px;color:#555';
      note.textContent = `${MC.Recipes.CRAFT.length} crafting recipes. Click to fill the grid, shift-click for as many as you can.`;
      d.appendChild(note);
      this.bookList = list;
      this.bookSize = size;
      return d;
    }

    // How many times can we make this recipe from the inventory + grid?
    haveFor(r) {
      const pool = [...this.game.inv.main, ...(this.win.grid || [])].filter(Boolean).map((s) => ({ id: s.id, n: s.n }));
      const need = Recipes.ingredients(r);
      let times = 64;
      for (const [ing, n] of need) {
        const have = pool.filter((s) => Recipes.ingMatches(ing, s)).reduce((a, s) => a + s.n, 0);
        times = Math.min(times, Math.floor(have / n));
      }
      // shared tags: check jointly (rough but fine for display)
      return times;
    }

    fillBook() {
      const list = this.bookList;
      if (!list || !this.win || !this.win.grid) return;
      const size = this.win.grid.length === 9 ? 3 : 2;
      const tab = BOOK_TABS.find((t) => t[0] === this.bookTab)[1];
      const q = this.bookQuery.trim().toLowerCase();
      const seen = new Set();
      const recs = [];
      for (const r of Recipes.CRAFT) {
        if (!tab(r)) continue;
        if (q && !I[r.out].name.toLowerCase().includes(q)) continue;
        const key = r.out + ':' + r.n + ':' + (r.type === 'shaped' ? r.pattern.join('|') : r.ing.join(','));
        if (seen.has(key)) continue;
        seen.add(key);
        const n = this.haveFor(r);
        if (this.bookCraftable && (n <= 0 || !Recipes.fits(r, size))) continue;
        recs.push([r, n]);
      }
      recs.sort((a, b) => (b[1] > 0 && Recipes.fits(b[0], size)) - (a[1] > 0 && Recipes.fits(a[0], size)));
      this.bookRecipes = recs.map((x) => x[0]);
      list.innerHTML = '';
      recs.forEach(([r, n], i) => {
        const el = document.createElement('div');
        el.className = 'rec' + (n > 0 && Recipes.fits(r, size) ? '' : ' no');
        el.dataset.rec = i;
        const ic = document.createElement('div'); ic.className = 'icon'; iconStyle(ic, r.out); el.appendChild(ic);
        if (r.n > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = r.n; el.appendChild(c); }
        list.appendChild(el);
      });
    }

    fillFromRecipe(r, many) {
      if (!r) return;
      const g = this.game, w = this.win;
      const size = w.grid.length === 9 ? 3 : 2;
      if (!Recipes.fits(r, size)) { this.toast('Needs a crafting table'); return; }
      // clear the grid back into the inventory
      for (let i = 0; i < w.grid.length; i++) if (w.grid[i]) { const left = Inv.add(g.inv.main, w.grid[i], Inv.PICKUP_ORDER); if (left) g.dropStack({ ...w.grid[i], n: left }); w.grid[i] = null; }
      const times = Math.max(1, many ? Math.min(this.haveFor(r), 64) : 1);
      const cells = [];
      if (r.type === 'shaped') r.pattern.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') cells.push([y * size + x, r.key[ch]]); }));
      else r.ing.forEach((ing, k) => cells.push([k, ing]));
      if (this.haveFor(r) <= 0) {
        this.toast('Missing ingredients');
        this.changed();
        return;
      }
      for (let t = 0; t < times; t++) {
        for (const [cell, ing] of cells) {
          const cur = w.grid[cell];
          let idx = -1;
          for (let i = 0; i < 36; i++) { const s = g.inv.main[i]; if (s && Recipes.ingMatches(ing, s) && (!cur || Inv.same(cur, s))) { idx = i; break; } }
          if (idx < 0) continue;
          const s = g.inv.main[idx];
          if (cur) { if (cur.n >= Inv.max(cur.id)) continue; cur.n++; }
          else w.grid[cell] = { id: s.id, n: 1, d: s.d || 0 };
          s.n--;
          if (!s.n) g.inv.main[idx] = null;
        }
      }
      this.changed();
    }
  }

  MC.UI = UI;
  MC.fillSlot = fillSlot;
})(globalThis);
