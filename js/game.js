// The running game: input, mining and placing, using items and blocks, survival stats, block
// physics (water and lava flow, falling sand, crops, saplings, copper weathering, amethyst
// growth), furnaces and chests, day/night, rendering each frame, and chat commands.
(function (G) {
  'use strict';
  const MC = G.MC;
  const { Inv, Recipes } = MC;
  const B = MC.B, BLOCKS = MC.BLOCKS, I = MC.ITEMS;
  const { withState, blockState, ID_MASK, ID_BITS } = MC;
  const $ = (id) => document.getElementById(id);
  const TICK = 0.05;
  const DAY = 24000;
  const XP_ORES = { coal: [0, 2], diamond: [3, 7], emerald: [3, 7], lapis: [2, 5], redstone: [1, 5] };
  const keyOf = (x, y, z) => x + ',' + y + ',' + z;

  class Game {
    constructor(renderer, audio, settings) {
      this.r = renderer;
      this.audio = audio;
      this.settings = settings;
      this.ui = new MC.UI(this);
      this.keys = {};
      this.mouse = { left: false, right: false, leftDown: false, rightDown: false };
      this.running = false;
      this.paused = false;
      this.hideHud = false;
      this.debug = false;
      this.chatOpen = false;
      this.touch = { active: false, mx: 0, mz: 0 };
      this.bindInput();
    }

    // ================= lifecycle =================
    start(info) {
      this.info = info;
      this.seed = info.seed;
      this.isHost = !info.guest;
      this.net = info.net || null;
      this.difficulty = info.difficulty != null ? +info.difficulty : 2;
      this.gen = new MC.WorldGen(this.seed);
      const data = info.data || {};
      const edits = new Map();
      for (const [k, list] of data.edits || []) edits.set(k, new Map(list));
      if (this.world) this.world.worker.terminate();
      this.world = new MC.World(this.seed, this.r, { edits, renderDist: this.settings.dist });
      this.world.onEdit = (x, y, z, v, opts) => {
        this.dirtyWorld = true;
        if (!this.net) return;
        if (this.isHost) this.net.edit(x, y, z, v, opts.from);
        else if (!opts.remote) this.net.edit(x, y, z, v);
      };
      this.r.clear();
      this.tiles = new Map(data.tiles || []);
      this.player = new MC.Player(this.world);
      this.entities = new MC.Entities(this);
      this.remotes = new Map();
      this.sched = new Map();
      this.time = data.time != null ? data.time : 1000;
      this.tickAcc = 0;
      this.inv = { main: new Array(36).fill(null), armor: new Array(4).fill(null), offhand: [null], craft: new Array(4).fill(null) };
      this.selected = 0;
      this.health = 20; this.food = 20; this.saturation = 5; this.exhaustion = 0; this.air = 300;
      this.xp = 0; this.xpLevel = 0; this.xpProgress = 0;
      this.dead = false;
      this.mining = null; this.breakCd = 0; this.useCd = 0; this.swing = 0; this.eating = null; this.bowCharge = 0;
      this.hurtFlash = 0; this.invuln = 0; this.freeze = 0;
      this.playerName = this.settings.name || 'Player';
      this.myId = this.net ? this.net.id : 'local';
      this.shirt = Math.abs(MC.seedFromString(this.playerName)) % 8;
      this.spawn = data.spawn || null;
      const pd = data.player || info.you;
      this.player.mode = (pd && pd.mode) || info.mode || 'survival';
      if (pd) this.loadPlayer(pd);
      else this.player.flying = false;
      if (!this.spawn) this.spawn = this.findSpawn();
      if (!pd || pd.x == null) {
        // guests appear a couple of blocks away from the host instead of inside them
        const j = info.guest ? 1 + Math.floor(Math.random() * 3) : 0;
        this.player.x = this.spawn.x + 0.5 + j; this.player.z = this.spawn.z + 0.5 + (info.guest ? 1 : 0); this.player.y = this.spawn.y;
        this.needsSurface = !this.spawn.exact || !!info.guest;
      }
      for (const m of data.mobs || []) this.entities.spawnMob(m.kind, m.x, m.y, m.z, { ...m, ai: { t: 0, dx: 0, dz: 0 } });
      this.player.frozen = true;
      this.player.onLand = (d) => this.onLand(d);
      this.player.onStep = () => this.footstep();
      this.player.onJump = () => { this.exhaustion += this.player.sprinting ? 0.2 : 0.05; };
      this.loadStart = performance.now();
      this.running = true;
      this.paused = false;
      this.lastFrame = performance.now();
      this.saveTimer = 0;
      this.netTimer = 0;
      this.world.update(this.player.x, this.player.y, this.player.z, true);
      this.ui.hudSig = '';
      $('hud').classList.remove('hidden');
      if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.ui.closeWindow(true);
      if (this.world) { this.world.worker.terminate(); this.world = null; }
      this.r.clear();
      $('hud').classList.add('hidden');
      document.exitPointerLock && document.exitPointerLock();
    }

    findSpawn() {
      // walk outwards from the origin until the climate says "dry land, not a cliff face"
      for (let r = 0; r < 4000; r += 24) {
        for (let k = 0; k < Math.max(1, r / 8); k++) {
          const a = (k / Math.max(1, r / 8)) * Math.PI * 2;
          const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
          const c = this.gen.climate(x, z);
          if (c.h > MC.SEA + 2 && c.h < MC.SEA + 40 && c.M < 0.35 && !c.river) return { x, y: Math.round(c.h) + 2, z };
        }
      }
      return { x: 0, y: 100, z: 0 };
    }

    // ================= player data =================
    playerData() {
      const p = this.player;
      return {
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, mode: p.mode, flying: p.flying,
        health: this.health, food: this.food, saturation: this.saturation, air: this.air,
        xp: this.xp, xpLevel: this.xpLevel, inv: this.inv.main, armor: this.inv.armor, offhand: this.inv.offhand,
        selected: this.selected, dead: this.dead, spawn: this.mySpawn || null,
      };
    }
    loadPlayer(d) {
      const p = this.player;
      if (d.x != null) { p.x = d.x; p.y = d.y; p.z = d.z; p.yaw = d.yaw || 0; p.pitch = d.pitch || 0; }
      p.mode = d.mode || p.mode;
      p.flying = !!d.flying && p.mode !== 'survival';
      this.health = d.health != null ? d.health : 20;
      this.food = d.food != null ? d.food : 20;
      this.saturation = d.saturation != null ? d.saturation : 5;
      this.air = d.air != null ? d.air : 300;
      this.xp = d.xp || 0; this.xpLevel = d.xpLevel || 0;
      this.xpProgress = this.xp / this.xpNeeded();
      if (d.inv) this.inv.main = d.inv.map(Inv.clone).concat(new Array(36).fill(null)).slice(0, 36);
      if (d.armor) this.inv.armor = d.armor.map(Inv.clone).slice(0, 4);
      if (d.offhand) this.inv.offhand = d.offhand.map(Inv.clone).slice(0, 1);
      this.selected = d.selected || 0;
      this.mySpawn = d.spawn || null;
      if (d.dead || this.health <= 0) { this.health = 20; this.food = 20; if (this.spawn) { p.x = this.spawn.x + 0.5; p.y = this.spawn.y; p.z = this.spawn.z + 0.5; this.needsSurface = true; } }
    }

    saveData() {
      const edits = [];
      for (const [k, m] of this.world.edits) if (m.size) edits.push([k, [...m]]);
      const mobs = [];
      for (const e of this.entities.map.values()) {
        if (e.type !== 'mob' || e.dead || e.dying) continue;
        const d = MC.MOBS[e.kind];
        if (d.hostile && !e.persistent) continue;
        mobs.push({ kind: e.kind, x: e.x, y: e.y, z: e.z, hp: e.hp, color: e.color, sheared: e.sheared, variant: e.variant, baby: e.baby, persistent: true });
      }
      return { time: Math.floor(this.time), spawn: this.spawn, edits, tiles: [...this.tiles], player: this.playerData(), mobs, players: this.net ? this.net.savedPlayers() : (this.info.data && this.info.data.players) || {} };
    }

    // ================= players (for mobs, items, damage) =================
    localPlayer() {
      const p = this.player;
      const st = this.inv.main[this.selected];
      return { id: this.myId, local: true, x: p.x, y: p.y, z: p.z, mode: p.mode, dead: this.dead || p.frozen, held: st && st.id };
    }
    allPlayers() {
      const out = [this.localPlayer()];
      for (const r of this.remotes.values()) out.push(r);
      return out;
    }
    givePlayer(p, stack) {
      if (p.local) {
        const left = Inv.add(this.inv.main, Inv.clone(stack), Inv.PICKUP_ORDER);
        if (left === stack.n) return false;
        this.audio.play('pop', null, 0.4);
        this.invChanged();
        if (left > 0) { stack.n = left; return false; }
        return true;
      }
      if (this.net) this.net.sendTo(p.id, { t: 'give', s: stack });
      return true;
    }
    giveXP(p, v) {
      if (!p.local) { if (this.net) this.net.sendTo(p.id, { t: 'xp', v }); return; }
      this.audio.play('orb', null, 0.4);
      this.xp += v;
      while (this.xp >= this.xpNeeded()) { this.xp -= this.xpNeeded(); this.xpLevel++; if (this.xpLevel % 5 === 0) this.audio.play('levelup'); }
      this.xpProgress = this.xp / this.xpNeeded();
    }
    xpNeeded() { const L = this.xpLevel; return L < 16 ? 2 * L + 7 : L < 31 ? 5 * L - 38 : 9 * L - 158; }
    hurtPlayer(p, dmg, info) {
      if (p.local) return this.damage(dmg, info);
      if (this.net) this.net.sendTo(p.id, { t: 'hurt', dmg, info });
    }

    // ================= world access =================
    setBlock(x, y, z, v, opts = {}) {
      const old = this.world.get(x, y, z);
      if (old < 0) return false;
      if (!this.world.set(x, y, z, v, opts)) return false;
      const k = keyOf(x, y, z);
      if (this.tiles.has(k) && (v & ID_MASK) !== (old & ID_MASK)) {
        const t = this.tiles.get(k);
        if (this.isHost) for (const s of t.slots) if (s) this.entities.spawnItem(s, x + 0.5, y + 0.5, z + 0.5);
        this.tiles.delete(k);
        if (this.net) this.net.tile(k, null);
      }
      if (!opts.noUpdate && this.isHost) this.neighborUpdate(x, y, z);
      return true;
    }

    // A block changed: check what's attached to it, wake up liquids and falling blocks.
    neighborUpdate(x, y, z) {
      const cells = [[x, y, z], [x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
      for (const [cx, cy, cz] of cells) {
        const v = this.world.get(cx, cy, cz);
        if (v <= 0) continue;
        const b = BLOCKS[v & ID_MASK];
        if (!this.supportOk(cx, cy, cz, v)) { this.breakBlock(cx, cy, cz, null); continue; }
        if (b.gravity) this.schedule(cx, cy, cz, 2);
        if (b.liquid) this.schedule(cx, cy, cz, b.liquid === 'water' ? 5 : 30);
        if (b.key.endsWith('_concrete_powder') && this.touchesWater(cx, cy, cz)) this.setBlock(cx, cy, cz, B[b.key.replace('_powder', '')]);
      }
    }
    touchesWater(x, y, z) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) { const b = this.world.def(x + dx, y + dy, z + dz); if (b && b.liquid === 'water') return true; }
      return false;
    }

    solidAt(x, y, z) { const b = this.world.def(x, y, z); return !b || (b.solid && (b.full || b.shape === 'slab' || b.shape === 'stairs')); }

    supportOk(x, y, z, v) {
      const b = BLOCKS[v & ID_MASK], st = blockState(v);
      const below = this.world.def(x, y - 1, z), above = this.world.def(x, y + 1, z);
      if (!below || !above) return true; // unknown: don't break
      switch (b.shape) {
        case 'torch': {
          if (st === 0) return this.solidAt(x, y - 1, z);
          const [dx, dz] = MC.DIR[(st - 1) & 3];
          return this.solidAt(x + dx, y, z + dz);
        }
        case 'ladder': { const [dx, dz] = MC.DIR[st & 3]; return this.solidAt(x + dx, y, z + dz); }
        case 'door': return st & 8 ? above.id !== undefined && this.world.id(x, y - 1, z) === b.id : (this.solidAt(x, y - 1, z) && this.world.id(x, y + 1, z) === b.id);
        case 'lantern': return st ? this.solidAt(x, y + 1, z) || above.shape === 'chain' : this.solidAt(x, y - 1, z);
      }
      if (b.key === 'pointed_dripstone') return st & 1 ? above.solid : below.solid;
      if (b.key === 'cave_vines') return above.solid || above.id === b.id;
      if (b.key === 'sugar_cane') return below.id === b.id || (b.plantOn.includes(below.key) && this.nearWater(x, y - 1, z));
      if (b.key === 'cactus') { if (!(below.id === b.id || b.plantOn.includes(below.key))) return false; for (const [dx, dz] of MC.DIR) { const n = this.world.def(x + dx, y, z + dz); if (n && n.solid) return false; } return true; }
      if (b.plantOn) return b.plantOn.includes(below.key);
      if (b.support === 'floor') return below.solid && below.id !== B.air;
      if (b.support === 'ceiling') return above.solid || above.id === b.id;
      if (b.key === 'wheat') return below.id === B.farmland;
      return true;
    }
    nearWater(x, y, z) {
      for (const [dx, dz] of MC.DIR) { const n = this.world.def(x + dx, y, z + dz); if (!n || n.liquid === 'water' || n.key === 'ice') return true; }
      return false;
    }

    schedule(x, y, z, ticks) {
      const k = keyOf(x, y, z);
      const due = this.tickCount + ticks;
      const cur = this.sched.get(k);
      if (!cur || cur.due > due) this.sched.set(k, { x, y, z, due });
    }

    // ================= breaking =================
    breakTime(v, stack) {
      const b = BLOCKS[v & ID_MASK];
      if (b.hardness < 0) return Infinity;
      if (b.hardness === 0) return 0;
      const tool = stack && I[stack.id].tool;
      let speed = 1;
      const right = tool && (tool.type === b.tool || (tool.type === 'sword' && b.key === 'cobweb') || (tool.type === 'shears' && (b.shape === 'leaves' || /wool|cobweb/.test(b.key))));
      if (right) speed = tool.type === 'sword' ? 15 : tool.type === 'shears' && b.key === 'cobweb' ? 15 : tool.speed;
      if (tool && tool.type === 'sword' && !right) speed = 1.5;
      const harvest = this.canHarvest(b, stack);
      let t = (b.hardness * (harvest ? 1.5 : 5)) / speed;
      if (this.player.eyeInWater) t *= 5;
      if (!this.player.onGround && !this.player.climbing) t *= 5;
      return t;
    }
    canHarvest(b, stack) {
      if (!b.tier) return true;
      const tool = stack && I[stack.id].tool;
      return !!(tool && tool.type === b.tool && tool.tier >= b.tier);
    }

    // What a block drops when broken with `stack` (null = explosion or no tool).
    blockDrops(v, stack, byPlayer) {
      const b = BLOCKS[v & ID_MASK], st = blockState(v);
      const tool = stack && I[stack.id].tool;
      if (byPlayer && !this.canHarvest(b, stack)) return [];
      const shears = tool && tool.type === 'shears';
      const out = [];
      const add = (id, n = 1) => { if (n > 0 && I[id]) out.push(Inv.make(id, n)); };
      if (b.shape === 'leaves') {
        if (shears) return [Inv.make(b.key, 1)];
        if (b.drop && Math.random() < 0.05) add(b.drop);
        if (Math.random() < 0.02) add('stick', 1 + Math.floor(Math.random() * 2));
        if ((b.key === 'oak_leaves' || b.key === 'dark_oak_leaves') && Math.random() < 0.005) add('apple');
        return out;
      }
      if ((b.key === 'short_grass' || b.key === 'fern' || b.key === 'dead_bush' || b.key === 'hanging_roots' || b.key === 'glow_lichen' || b.key === 'cobweb') && shears) return [Inv.make(b.key, 1)];
      if (b.key === 'gravel') return Math.random() < 0.1 ? [Inv.make('flint', 1)] : [Inv.make('gravel', 1)];
      if (b.key === 'wheat') { if (st >= 7) { add('wheat'); add('wheat_seeds', 1 + Math.floor(Math.random() * 3)); } else add('wheat_seeds'); return out; }
      if (b.key === 'cave_vines') { if (st & 1) add('glow_berries'); return out; }
      if (b.key === 'snow') return [Inv.make('snowball', 1)];
      if (b.shape === 'door' && st & 8) return []; // the lower half drops the door
      if (b.shape === 'slab' && st === 2) return [Inv.make(b.key, 2)];
      if (b.key === 'campfire') return [Inv.make('charcoal', 2)];
      if (b.drop == null) return out;
      if (b.dropChance != null && Math.random() >= b.dropChance) return out;
      let n = 1;
      if (b.dropCount) n = b.dropCount[0] + Math.floor(Math.random() * (b.dropCount[1] - b.dropCount[0] + 1));
      add(b.drop, n);
      return out;
    }

    breakBlock(x, y, z, stack, byPlayer) {
      const v = this.world.get(x, y, z);
      if (v <= 0) return;
      const b = BLOCKS[v & ID_MASK], st = blockState(v);
      const survival = !byPlayer || this.player.mode === 'survival';
      // doors are two blocks tall
      if (b.shape === 'door') {
        const oy = st & 8 ? y - 1 : y + 1;
        if (this.world.id(x, oy, z) === b.id) this.setBlock(x, oy, z, 0, { noUpdate: true });
      }
      let replace = 0;
      if (b.key === 'ice' && byPlayer && survival) { const below = this.world.def(x, y - 1, z); if (below && (below.solid || below.liquid)) replace = B.water; }
      this.setBlock(x, y, z, replace);
      this.entities.blockParticles(x, y, z, v);
      this.audio.block(b.sound, 'break', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      if (b.key.includes('amethyst')) this.audio.play('amethyst', { x, y, z }, 0.6);
      if (survival) {
        const drops = this.blockDrops(v, byPlayer ? stack : null, byPlayer);
        for (const d of drops) this.entities.spawnItem(d, x + 0.5, y + 0.3, z + 0.5);
        const ore = b.key.match(/^(?:deepslate_)?(coal|diamond|emerald|lapis|redstone)_ore$/);
        if (ore && byPlayer && this.canHarvest(b, stack)) { const [a, c] = XP_ORES[ore[1]]; this.entities.spawnXP(x + 0.5, y + 0.5, z + 0.5, a + Math.floor(Math.random() * (c - a + 1))); }
      }
    }

    // ================= input =================
    bindInput() {
      const canvas = this.r.canvas;
      document.addEventListener('keydown', (e) => this.keyDown(e));
      document.addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.Shift = false; });
      window.addEventListener('blur', () => { this.keys = {}; this.mouse.left = this.mouse.right = false; });
      canvas.addEventListener('mousedown', (e) => {
        if (!this.running) return;
        this.audio.unlock();
        if (!this.locked() && !this.touch.active) { this.requestPointer(); return; }
        if (e.button === 0) { this.mouse.left = true; this.mouse.leftDown = true; }
        if (e.button === 2) { this.mouse.right = true; this.mouse.rightDown = true; }
        if (e.button === 1) { e.preventDefault(); this.pickBlock(); }
      });
      document.addEventListener('mouseup', (e) => {
        if (e.button === 0) this.mouse.left = false;
        if (e.button === 2) { this.mouse.right = false; this.releaseUse(); }
      });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      document.addEventListener('mousemove', (e) => {
        if (!this.running || !this.locked()) return;
        // browsers report one big bogus jump right after the mouse is captured
        if (this.skipMoves > 0) { this.skipMoves--; return; }
        if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
        this.look(e.movementX, e.movementY);
      });
      document.addEventListener('wheel', (e) => {
        if (!this.running || this.ui.open || !this.locked()) return;
        this.selectSlot((this.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9);
      }, { passive: true });
      document.addEventListener('pointerlockchange', () => {
        if (this.locked()) this.skipMoves = 2;
        if (!this.running) return;
        if (!this.locked() && !this.ui.open && !this.chatOpen && !this.touch.active && !this.dead && !this.suppressPause) this.onPause && this.onPause();
        this.suppressPause = false;
        $('click-to-play').classList.toggle('hidden', this.locked() || this.ui.open || this.chatOpen || this.touch.active);
      });
      const ci = $('chat-input');
      ci.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { const t = ci.value.trim(); if (t) this.sendChat(t); this.closeChat(); }
        else if (e.key === 'Escape') this.closeChat();
      });
      this.bindTouch();
    }

    look(dx, dy) {
      const s = (this.settings.sens || 100) / 100 * 0.0022 * (this.zooming ? 0.2 : 1);
      const p = this.player;
      p.yaw -= dx * s;
      p.pitch -= dy * s * (this.settings.invert ? -1 : 1);
      p.pitch = MC.clamp(p.pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
    }

    locked() { return document.pointerLockElement === this.r.canvas; }
    requestPointer() {
      if (this.touch.active) return;
      const c = this.r.canvas;
      try { const p = c.requestPointerLock && c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
    }
    releasePointer() { this.suppressPause = true; if (document.exitPointerLock) document.exitPointerLock(); }

    keyDown(e) {
      if (!this.running) return;
      if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
      this.audio.unlock();
      const c = e.code;
      if (this.ui.open) {
        if (c === 'Escape' || c === 'KeyE') { e.preventDefault(); this.ui.closeWindow(); return; }
        if (this.ui.key(e)) e.preventDefault();
        return;
      }
      if (this.menuOpen) return;
      if (c === 'Escape') return;
      if (c === 'F1') { e.preventDefault(); this.hideHud = !this.hideHud; $('hud').style.opacity = this.hideHud ? 0 : 1; return; }
      if (c === 'F3') { e.preventDefault(); this.debug = !this.debug; $('debug').classList.toggle('hidden', !this.debug); return; }
      if (c === 'KeyT' || c === 'Slash' || c === 'Enter') { e.preventDefault(); this.openChat(c === 'Slash' ? '/' : ''); return; }
      if (this.dead) return;
      const now = performance.now();
      if (c === 'KeyW' && !this.keys.KeyW) { if (now - (this.lastW || 0) < 280) this.keys.sprintTap = true; this.lastW = now; }
      if (c === 'Space' && !this.keys.Space) {
        if (now - (this.lastSpace || 0) < 280 && this.player.mode === 'creative') { this.player.flying = !this.player.flying; this.player.vy = 0; this.lastSpace = 0; }
        else this.lastSpace = now;
      }
      this.keys[c] = true;
      if (e.shiftKey) this.keys.Shift = true;
      if (/^Digit[1-9]$/.test(c)) this.selectSlot(+c.slice(5) - 1);
      if (c === 'KeyE') { e.preventDefault(); this.ui.openWindow('inventory'); }
      if (c === 'KeyQ') this.dropHeld(e.ctrlKey);
      if (c === 'KeyF') { const a = this.inv.main[this.selected]; this.inv.main[this.selected] = this.inv.offhand[0]; this.inv.offhand[0] = a; this.invChanged(); }
      if (c === 'Tab' || c === 'Space' || c.startsWith('Arrow')) e.preventDefault();
    }

    selectSlot(i) { if (this.selected !== i) { this.selected = i; this.eating = null; this.bowCharge = 0; } }

    openChat(prefix) {
      this.chatOpen = true;
      const ci = $('chat-input');
      ci.classList.remove('hidden');
      $('chat').classList.add('open');
      ci.value = prefix;
      this.keys = {};
      this.releasePointer();
      setTimeout(() => { ci.focus(); ci.setSelectionRange(prefix.length, prefix.length); }, 0);
    }
    closeChat() {
      this.chatOpen = false;
      const ci = $('chat-input');
      ci.blur();
      ci.classList.add('hidden');
      $('chat').classList.remove('open');
      this.requestPointer();
    }

    inputState() {
      const k = this.keys, t = this.touch;
      const active = !this.ui.open && !this.chatOpen && !this.dead && !this.menuOpen;
      if (!active) return {};
      const fwd = k.KeyW || k.ArrowUp || t.mz < -0.3;
      if (!fwd) k.sprintTap = false;
      return {
        forward: fwd, back: k.KeyS || k.ArrowDown || t.mz > 0.3, left: k.KeyA || k.ArrowLeft || t.mx < -0.3, right: k.KeyD || k.ArrowRight || t.mx > 0.3,
        jump: k.Space || t.jump, sneak: k.ShiftLeft || k.ShiftRight || k.Shift || t.sneak, sprint: k.ControlLeft || k.ControlRight || k.sprintTap || (t.mz < -0.9),
      };
    }

    // ================= touch controls =================
    bindTouch() {
      const mc = $('mobile-controls');
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (!isTouch) return;
      this.touch.active = matchMedia('(pointer: coarse)').matches;
      if (!this.touch.active) return;
      mc.classList.remove('hidden');
      const stick = $('stick'), knob = $('stick-knob');
      let stickId = null, lookId = null, lx = 0, ly = 0;
      stick.addEventListener('touchstart', (e) => { e.preventDefault(); stickId = e.changedTouches[0].identifier; });
      const btn = (id, down, up) => { const b = $(id); b.addEventListener('touchstart', (e) => { e.preventDefault(); this.audio.unlock(); down(); }); b.addEventListener('touchend', (e) => { e.preventDefault(); up && up(); }); };
      btn('m-jump', () => { this.touch.jump = true; }, () => { this.touch.jump = false; });
      btn('m-sneak', () => { this.touch.sneak = !this.touch.sneak; $('m-sneak').style.background = this.touch.sneak ? 'rgba(255,255,255,.4)' : ''; });
      btn('m-break', () => { this.mouse.left = true; this.mouse.leftDown = true; }, () => { this.mouse.left = false; });
      btn('m-place', () => { this.mouse.right = true; this.mouse.rightDown = true; }, () => { this.mouse.right = false; this.releaseUse(); });
      btn('m-inv', () => this.ui.openWindow('inventory'));
      btn('m-pause', () => this.onPause && this.onPause());
      document.addEventListener('touchstart', (e) => {
        if (!this.running || this.ui.open) return;
        for (const t of e.changedTouches) if (t.target === this.r.canvas && lookId == null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }, { passive: true });
      document.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === stickId) {
            const r = stick.getBoundingClientRect();
            let dx = (t.clientX - r.left - r.width / 2) / (r.width / 2), dy = (t.clientY - r.top - r.height / 2) / (r.height / 2);
            const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
            this.touch.mx = dx; this.touch.mz = dy;
            knob.style.left = 40 + dx * 40 + 'px'; knob.style.top = 40 + dy * 40 + 'px';
          } else if (t.identifier === lookId) { this.look((t.clientX - lx) * 2.2, (t.clientY - ly) * 2.2); lx = t.clientX; ly = t.clientY; }
        }
      }, { passive: true });
      const end = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === stickId) { stickId = null; this.touch.mx = this.touch.mz = 0; knob.style.left = '40px'; knob.style.top = '40px'; }
          if (t.identifier === lookId) lookId = null;
        }
      };
      document.addEventListener('touchend', end);
      document.addEventListener('touchcancel', end);
      $('hotbar').style.pointerEvents = 'auto';
      $('hotbar').addEventListener('touchstart', (e) => { const s = e.target.closest('.slot'); if (s) this.selectSlot([...s.parentNode.children].indexOf(s)); });
    }

    // ================= frame =================
    frame(now) {
      this.raf = requestAnimationFrame((t) => this.frame(t));
      if (!this.running) return;
      let dt = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      if (dt > 0.1) dt = 0.1;
      this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05 : 60;
      const simulate = !(this.paused && !this.net);
      try {
        if (simulate) this.update(dt);
        this.render(now / 1000, dt);
      } catch (err) {
        console.error(err);
        if (!this.reported) { this.reported = true; this.ui.chat('Error: ' + err.message, '#f66'); }
      }
    }

    update(dt) {
      const p = this.player, w = this.world;
      // wait for the ground under us before letting physics run
      if (p.frozen) {
        const c = w.chunks.get(w.key(Math.floor(p.x / 16), Math.floor(p.z / 16)));
        if (c && c.light) {
          if (this.needsSurface) {
            let y = MC.MAX_Y;
            while (y > MC.MIN_Y) { const b = w.def(Math.floor(p.x), y, Math.floor(p.z)); if (b && (b.solid || b.liquid)) break; y--; }
            p.y = y + 1;
            this.needsSurface = false;
            if (!this.info.data || !this.info.data.spawn) this.spawn = { x: Math.floor(p.x), y: p.y, z: Math.floor(p.z), exact: true };
          }
          p.frozen = false;
          p.unstick();
          this.onLoaded && this.onLoaded();
        } else {
          this.loadProgress = Math.min(0.99, w.meshCount / 400);
          w.update(p.x, p.y, p.z);
          w.flush();
          if (this.net) this.net.update(dt);
          return;
        }
      }
      const input = this.inputState();
      p.food = this.food;
      p.usingItem = !!this.eating || this.bowCharge > 0;
      const ox = p.x, oz = p.z;
      p.update(dt, input);
      const moved = Math.hypot(p.x - ox, p.z - oz);
      if (p.mode === 'survival') this.exhaustion += moved * (p.sprinting ? 0.1 : p.inWater ? 0.01 : 0);
      this.survival(dt);
      this.interact(dt);
      this.tickAcc += dt;
      let n = 0;
      while (this.tickAcc >= TICK && n < 5) { this.tickAcc -= TICK; this.tick(); n++; }
      if (n === 5) this.tickAcc = 0;
      this.entities.update(dt);
      w.update(p.x, p.y, p.z);
      w.flush();
      if (this.net) this.net.update(dt);
      this.saveTimer += dt;
      if (this.saveTimer > 30 && this.isHost && this.onAutosave) { this.saveTimer = 0; this.onAutosave(); }
      if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 3.5);
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
      if (this.invuln > 0) this.invuln -= dt;
      this.audio.listener = { x: p.x, y: p.eye, z: p.z, yaw: p.yaw };
    }

    // ================= ticks (20 per second) =================
    tick() {
      this.tickCount = (this.tickCount || 0) + 1;
      if (this.isHost) {
        this.time = (this.time + 1) % DAY;
        // scheduled block updates
        const due = [];
        for (const [k, s] of this.sched) if (s.due <= this.tickCount) { due.push(s); this.sched.delete(k); if (due.length > 400) break; }
        for (const s of due) this.blockTick(s.x, s.y, s.z);
        this.randomTicks();
        if (this.tickCount % 2 === 0) this.furnaceTicks();
      } else this.time = (this.time + 1) % DAY;
    }

    blockTick(x, y, z) {
      const v = this.world.get(x, y, z);
      if (v <= 0) return;
      const b = BLOCKS[v & ID_MASK];
      if (b.gravity) {
        const below = this.world.def(x, y - 1, z);
        if (below && (below.id === 0 || below.liquid || (below.replaceable && !below.solid))) {
          this.setBlock(x, y, z, 0);
          this.entities.spawnFalling(v, x, y, z);
        }
        return;
      }
      if (b.liquid) this.fluidTick(x, y, z, v, b);
    }

    // Water spreads 7 blocks, lava 3. State 0 = source, 1..7 = flowing distance, 8 = falling.
    fluidTick(x, y, z, v, b) {
      const w = this.world, id = b.id, water = b.liquid === 'water';
      const maxL = water ? 7 : 3;
      const rate = water ? 5 : 30;
      let lvl = blockState(v);
      const same = (vv) => vv > 0 && (vv & ID_MASK) === id;
      if (lvl > 0) {
        const above = w.get(x, y + 1, z);
        let want;
        if (same(above)) want = 8;
        else {
          let best = 99, sources = 0;
          for (const [dx, dz] of MC.DIR) {
            const n = w.get(x + dx, y, z + dz);
            if (!same(n)) continue;
            const nl = blockState(n);
            if (nl === 0) sources++;
            best = Math.min(best, nl === 0 || nl === 8 ? 1 : nl + 1);
          }
          want = best;
          const below = w.def(x, y - 1, z);
          if (water && sources >= 2 && below && (below.solid || (same(w.get(x, y - 1, z)) && blockState(w.get(x, y - 1, z)) === 0))) want = 0;
        }
        if (want > maxL && want !== 8) { this.setBlock(x, y, z, 0, { noUpdate: true }); this.wakeFluids(x, y, z); return; }
        if (want !== lvl) { this.setBlock(x, y, z, withState(id, want), { noUpdate: true }); this.wakeFluids(x, y, z); lvl = want; }
      }
      // lava meets water
      if (!water) {
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
          const n = w.def(x + dx, y + dy, z + dz);
          if (n && n.liquid === 'water') { this.setBlock(x, y, z, lvl === 0 ? B.obsidian : B.cobblestone); this.audio.play('fizz', { x, y, z }); return; }
        }
      }
      // spread
      const belowV = w.get(x, y - 1, z);
      if (belowV < 0) return;
      if (this.canFlow(belowV, b)) { this.flowInto(x, y - 1, z, withState(id, 8), b); return; }
      if (same(belowV) && lvl !== 0) return;
      const nl = lvl === 8 ? 1 : lvl + 1;
      if (nl > maxL) return;
      for (const [dx, dz] of MC.DIR) {
        const nv = w.get(x + dx, y, z + dz);
        if (nv < 0) continue;
        if (this.canFlow(nv, b)) this.flowInto(x + dx, y, z + dz, withState(id, nl), b);
        else if (same(nv) && blockState(nv) > nl && blockState(nv) !== 8) { this.setBlock(x + dx, y, z + dz, withState(id, nl), { noUpdate: true }); this.schedule(x + dx, y, z + dz, rate); }
      }
    }
    canFlow(v, b) {
      if (v === 0) return true;
      const d = BLOCKS[v & ID_MASK];
      if (d.liquid) return d.liquid !== b.liquid && b.liquid === 'lava' ? false : false;
      return d.replaceable || (d.shape === 'cross' && !d.solid) || d.shape === 'torch' || d.key === 'snow';
    }
    flowInto(x, y, z, nv, b) {
      const old = this.world.get(x, y, z);
      const od = BLOCKS[old & ID_MASK];
      // lava flowing onto water makes stone
      if (b.liquid === 'lava') {
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const n = this.world.def(x + dx, y + dy, z + dz); if (n && n.liquid === 'water') { this.setBlock(x, y, z, B.stone); this.audio.play('fizz', { x, y, z }); return; } }
      }
      if (old > 0 && od.shape !== 'none' && !od.liquid) for (const d of this.blockDrops(old, null)) this.entities.spawnItem(d, x + 0.5, y + 0.5, z + 0.5);
      this.setBlock(x, y, z, nv, { noUpdate: true });
      this.schedule(x, y, z, b.liquid === 'water' ? 5 : 30);
      this.wakeFluids(x, y, z);
    }
    wakeFluids(x, y, z) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = this.world.def(x + dx, y + dy, z + dz);
        if (n && n.liquid) this.schedule(x + dx, y + dy, z + dz, n.liquid === 'water' ? 5 : 30);
        else if (n && n.gravity) this.schedule(x + dx, y + dy, z + dz, 2);
      }
    }

    randomTicks() {
      const w = this.world;
      const players = this.allPlayers();
      const daylight = this.skyFactor();
      for (const pl of players) {
        for (let i = 0; i < 120; i++) {
          const x = Math.floor(pl.x + (Math.random() - 0.5) * 96), y = Math.floor(pl.y + (Math.random() - 0.5) * 48), z = Math.floor(pl.z + (Math.random() - 0.5) * 96);
          const v = w.get(x, y, z);
          if (v <= 0) continue;
          const b = BLOCKS[v & ID_MASK], st = blockState(v);
          const key = b.key;
          if (key === 'grass_block') {
            const a = w.def(x, y + 1, z);
            if (a && a.opaque) { this.setBlock(x, y, z, B.dirt); continue; }
            // spread to nearby dirt
            const tx = x + Math.floor(Math.random() * 3) - 1, ty = y + Math.floor(Math.random() * 3) - 1, tz = z + Math.floor(Math.random() * 3) - 1;
            if (w.id(tx, ty, tz) === B.dirt) { const ab = w.def(tx, ty + 1, tz); const L = w.light(tx, ty + 1, tz); if (ab && !ab.opaque && !ab.liquid && Math.max(L.sky * daylight, L.blk) >= 9) this.setBlock(tx, ty, tz, B.grass_block); }
          } else if (b.use === 'sapling') {
            const L = w.light(x, y, z);
            if (Math.max(L.sky * daylight, L.blk) >= 9 && Math.random() < 0.3) this.growTree(x, y, z, key.replace('_sapling', ''));
          } else if (key === 'wheat' && st < 7) {
            const L = w.light(x, y, z);
            if (Math.max(L.sky * daylight, L.blk) >= 9 && Math.random() < 0.6) this.setBlock(x, y, z, withState(b.id, st + 1));
          } else if (key === 'sugar_cane' || key === 'cactus') {
            if (w.id(x, y + 1, z) === 0 && w.id(x, y - 2, z) !== b.id && Math.random() < 0.4) this.setBlock(x, y + 1, z, b.id);
          } else if (key === 'cave_vines') {
            if (!(st & 1) && Math.random() < 0.1) this.setBlock(x, y, z, withState(b.id, 1));
            else if (w.id(x, y - 1, z) === 0 && Math.random() < 0.05) this.setBlock(x, y - 1, z, withState(b.id, 0));
          } else if (key === 'budding_amethyst' && Math.random() < 0.25) {
            const f = Math.floor(Math.random() * 6), F = MC.FACES[f];
            const nx = x + F.dx, ny = y + F.dy, nz = z + F.dz;
            const n = w.get(nx, ny, nz);
            const stages = [B.small_amethyst_bud, B.medium_amethyst_bud, B.large_amethyst_bud, B.amethyst_cluster];
            if (n === 0 || (n > 0 && BLOCKS[n & ID_MASK].liquid === 'water' && blockState(n) === 0)) this.setBlock(nx, ny, nz, withState(B.small_amethyst_bud, f));
            else if (n > 0) { const k = stages.indexOf(n & ID_MASK); if (k >= 0 && k < 3) this.setBlock(nx, ny, nz, withState(stages[k + 1], blockState(n))); }
          } else if (b.family === 'copper' && Math.random() < 0.05 && !key.startsWith('oxidized_')) {
            const ages = MC.COPPER_AGES;
            const cur = ages.findIndex((a) => a && key.startsWith(a));
            const base = cur >= 0 ? key.slice(ages[cur].length) : key;
            const next = ages[(cur >= 0 ? cur : 0) + 1] + base;
            if (B[next] != null) this.setBlock(x, y, z, withState(B[next], st));
          } else if (key === 'farmland') {
            const a = w.def(x, y + 1, z);
            if (a && a.solid && a.full) this.setBlock(x, y, z, B.dirt);
          } else if ((key === 'ice' || key === 'snow') && w.light(x, y + 1, z).blk > 11) {
            this.setBlock(x, y, z, key === 'ice' ? B.water : 0);
          }
        }
      }
    }

    growTree(x, y, z, kind) {
      const w = this.world;
      for (let i = 1; i < 6; i++) { const b = w.def(x, y + i, z); if (!b || (b.solid && b.shape !== 'leaves')) return false; }
      this.setBlock(x, y, z, 0, { noUpdate: true });
      const set = (bx, by, bz, v) => { const cur = w.get(bx, by, bz); if (cur >= 0) this.setBlock(bx, by, bz, v, { noUpdate: true }); };
      const get = (bx, by, bz) => { const v = w.get(bx, by, bz); return v < 0 ? -1 : v & ID_MASK; };
      this.gen.tree(set, get, x, y, z, kind === 'azalea' || kind === 'flowering_azalea' ? 'azalea' : kind, (Math.random() * 1e9) | 0);
      return true;
    }

    // ================= furnaces =================
    fuelValue(id) { const it = I[id]; if (!it) return 0; if (it.fuel) return it.fuel; const b = it.block && MC.blockByKey(it.block); return b && b.tool === 'axe' && b.solid ? 15 : 0; }

    furnaceTicks() {
      const dt = TICK * 2;
      for (const [k, t] of this.tiles) {
        if (t.type !== 'furnace') continue;
        const [x, y, z] = k.split(',').map(Number);
        if (!this.world.loaded(x, z)) continue;
        const [inp, fuel, out] = t.slots;
        const rec = inp && Recipes.SMELT[inp.id];
        const kind = t.kind || 'furnace';
        const okKind = rec && (kind === 'furnace' || (kind === 'blast_furnace' && rec.kind === 'ore') || (kind === 'smoker' && rec.kind === 'food'));
        const can = okKind && (!out || (out.id === rec.out && out.n < Inv.max(out.id)));
        const speed = kind === 'furnace' ? 1 : 2;
        t.cookMax = 10;
        const wasBurning = t.burn > 0;
        if (t.burn > 0) t.burn -= dt * speed;
        if (t.burn <= 0 && can && fuel) {
          const fv = this.fuelValue(fuel.id);
          if (fv > 0) {
            t.burn = t.burnMax = fv;
            fuel.n--;
            if (fuel.id === 'lava_bucket') t.slots[1] = Inv.make('bucket', 1);
            else if (!fuel.n) t.slots[1] = null;
          }
        }
        const burning = t.burn > 0;
        if (burning && can) {
          t.cook = (t.cook || 0) + dt * speed;
          if (t.cook >= 10) {
            t.cook = 0;
            inp.n--;
            if (!inp.n) t.slots[0] = null;
            if (out) out.n++; else t.slots[2] = Inv.make(rec.out, 1);
            t.xp = (t.xp || 0) + rec.xp;
          }
          t.dirty = true;
        } else if (t.cook > 0) { t.cook = Math.max(0, t.cook - dt * 2); t.dirty = true; }
        if (wasBurning !== burning || burning) t.dirty = true;
        if (wasBurning !== burning) {
          const v = this.world.get(x, y, z);
          if (v > 0) this.setBlock(x, y, z, withState(v & ID_MASK, (blockState(v) & 3) | (burning ? 4 : 0)), { noUpdate: true });
        }
        if (t.dirty && this.net && this.tickCount % 10 === 0) this.net.tile(k, t);
      }
    }

    tileFor(x, y, z) {
      const k = keyOf(x, y, z);
      let t = this.tiles.get(k);
      if (!t) {
        const b = this.world.def(x, y, z);
        if (b.use === 'furnace') t = { type: 'furnace', kind: b.key, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
        else t = { type: 'chest', slots: new Array(27).fill(null) };
        this.tiles.set(k, t);
      }
      return t;
    }
    openTile(x, y, z, b) {
      const k = keyOf(x, y, z);
      if (!this.isHost) { this.net.send({ t: 'openTile', k }); this.pendingTile = { k, b }; return; }
      this.showTile(k, this.tileFor(x, y, z), b);
    }
    showTile(k, t, b) {
      if (t.type === 'furnace') this.ui.openWindow('furnace', { tile: t, tileKey: k, title: b.name });
      else { this.ui.openWindow('chest', { tile: t, tileKey: k, title: b.name }); this.audio.play('chest', null, 0.5); }
    }
    tileChanged(k) {
      const t = this.tiles.get(k);
      if (!t) return;
      if (this.net) this.net.tile(k, t);
    }
    closeTile(k) { if (this.net && !this.isHost) this.net.tile(k, this.tiles.get(k)); }

    // ================= interaction =================
    interact(dt) {
      const p = this.player;
      this.breakCd -= dt; this.useCd -= dt;
      const can = !this.ui.open && !this.chatOpen && !this.dead && !this.menuOpen && (this.locked() || this.touch.active);
      if (!can) { this.mining = null; this.mouse.left = this.mouse.leftDown = false; this.mouse.rightDown = false; this.target = null; this.eating = null; return; }
      const [dx, dy, dz] = p.look();
      const creative = p.mode === 'creative';
      const reach = creative ? 5 : 4.5;
      const hit = this.world.raycast(p.x, p.eye, p.z, dx, dy, dz, reach);
      const ent = this.entities.raycast(p.x, p.eye, p.z, dx, dy, dz, creative ? 5 : 3);
      this.target = hit;
      this.targetEnt = ent && (!hit || ent.t < hit.t) ? ent.e : null;
      const held = this.inv.main[this.selected];

      // left mouse: attack or mine
      if (this.mouse.leftDown) {
        this.mouse.leftDown = false;
        this.swing = 1;
        if (this.targetEnt) { this.attack(this.targetEnt, held); this.mining = null; }
      }
      if (this.mouse.left && !this.targetEnt && hit && p.mode !== 'spectator') {
        if (this.swing < 0.4) this.swing = 1;
        const k = keyOf(hit.x, hit.y, hit.z);
        if (!this.mining || this.mining.k !== k || this.mining.v !== hit.v) this.mining = { k, x: hit.x, y: hit.y, z: hit.z, v: hit.v, progress: 0, sound: 0 };
        const m = this.mining;
        if (creative) {
          const b = BLOCKS[hit.v & ID_MASK];
          if (this.breakCd <= 0 && !(held && I[held.id].tool && I[held.id].tool.type === 'sword')) { this.breakBlock(hit.x, hit.y, hit.z, held, true); this.breakCd = 0.22; this.mining = null; }
          void b;
        } else {
          const t = this.breakTime(hit.v, held);
          if (t !== Infinity && this.breakCd <= 0) {
            m.progress += t === 0 ? 1 : dt / t;
            m.sound -= dt;
            if (m.sound <= 0) { m.sound = 0.25; this.audio.block(BLOCKS[hit.v & ID_MASK].sound, 'hit', { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 }); }
            if (m.progress >= 1) {
              const b = BLOCKS[hit.v & ID_MASK];
              this.breakBlock(hit.x, hit.y, hit.z, held, true);
              if (held && I[held.id].tool && b.hardness > 0) this.damageHeld(I[held.id].tool.type === 'sword' ? 2 : 1);
              this.exhaustion += 0.005;
              this.mining = null;
              this.breakCd = 0.3;
            }
          }
        }
      } else this.mining = null;

      // right mouse: use / place
      if (this.mouse.rightDown || (this.mouse.right && this.useCd <= 0 && !this.eating && !(this.bowCharge > 0))) {
        const first = this.mouse.rightDown;
        this.mouse.rightDown = false;
        this.useCd = 0.25;
        this.use(hit, held, first);
      }
      // continuous actions while holding right mouse
      if (this.mouse.right && this.eating) {
        this.eating.t += dt;
        if (Math.floor(this.eating.t * 5) !== Math.floor((this.eating.t - dt) * 5)) this.audio.play('eat', null, 0.4);
        if (this.eating.t >= this.eating.max) this.finishEating();
      }
      if (this.mouse.right && this.bowCharge > 0) this.bowCharge += dt;
      this.zooming = this.mouse.right && held && held.id === 'spyglass';
    }

    attack(e, held) {
      const it = held && I[held.id];
      let dmg = it ? it.damage : 1;
      const p = this.player;
      if (!p.onGround && p.vy < 0 && !p.inWater) { dmg *= 1.5; this.audio.play('crit', e); }
      else this.audio.play('attack', e, 0.6);
      const [dx, , dz] = p.look();
      this.entities.hurtMob(e, Math.round(dmg), dx, dz, this.myId);
      if (p.sprinting) { e.vx = (e.vx || 0) + dx * 4; e.vz = (e.vz || 0) + dz * 4; }
      this.exhaustion += 0.1;
      if (it && it.tool && p.mode === 'survival') this.damageHeld(it.tool.type === 'sword' ? 1 : 2);
    }

    damageHeld(n) {
      if (this.player.mode !== 'survival') return;
      const st = this.inv.main[this.selected];
      if (!st) return;
      const uses = Inv.uses(st.id);
      if (!uses) return;
      st.d = (st.d || 0) + n;
      if (st.d >= uses) { this.inv.main[this.selected] = null; this.audio.play('fizz', null, 0.5); this.ui.toast(I[st.id].name + ' broke!'); }
      this.invChanged();
    }

    consumeHeld(n = 1) {
      if (this.player.mode !== 'survival') return;
      const st = this.inv.main[this.selected];
      if (!st) return;
      st.n -= n;
      if (st.n <= 0) this.inv.main[this.selected] = null;
      this.invChanged();
    }
    replaceHeld(id) {
      if (this.player.mode !== 'survival') { if (!Inv.count(this.inv.main, (s) => s.id === id)) Inv.add(this.inv.main, Inv.make(id, 1), Inv.PICKUP_ORDER); this.invChanged(); return; }
      const st = this.inv.main[this.selected];
      if (st && st.n > 1) { st.n--; const left = Inv.add(this.inv.main, Inv.make(id, 1), Inv.PICKUP_ORDER); if (left) this.dropStack(Inv.make(id, 1)); }
      else this.inv.main[this.selected] = Inv.make(id, 1);
      this.invChanged();
    }

    use(hit, held, first) {
      const p = this.player;
      const it = held && I[held.id];
      this.swingSoon = false;
      // 1) mobs
      if (this.targetEnt && first) {
        if (this.isHost) { const res = this.entities.interact(this.targetEnt, held, this.localPlayer()); if (res) { this.applyInteract(res); this.swing = 1; return; } }
        else if (held) { this.net.send({ t: 'interact', id: this.targetEnt.id, item: held.id }); this.swing = 1; return; }
      }
      // 2) block with a use (unless sneaking with something in hand)
      if (hit && !(p.sneaking && held)) {
        const b = BLOCKS[hit.v & ID_MASK];
        if (b.use && b.use !== 'sapling' && this.useBlock(hit, b, held, first)) { this.swing = 1; return; }
      }
      // 3) items with special uses
      if (it && this.useItem(hit, held, it, first)) return;
      // 4) place a block
      if (it && it.block && hit) { if (this.place(hit, held)) { this.swing = 1; return; } }
      // offhand block placement
      const off = this.inv.offhand[0];
      if (off && I[off.id].block && hit && (!it || !it.block)) {
        if (this.place(hit, off, true)) this.swing = 1;
      }
    }

    applyInteract(res) {
      if (res.consume) this.consumeHeld(res.consume);
      if (res.replace) this.replaceHeld(res.replace);
      if (res.damageTool) this.damageHeld(res.damageTool);
    }

    useBlock(hit, b, held, first) {
      const { x, y, z } = hit;
      const st = blockState(hit.v);
      switch (b.use) {
        case 'crafting': if (!first) return true; this.ui.openWindow('crafting'); return true;
        case 'furnace': case 'chest': if (!first) return true; this.openTile(x, y, z, b); return true;
        case 'toggle': {
          if (!first) return true;
          if (b.key === 'iron_door' || b.key === 'iron_trapdoor') return false; // needs redstone
          if (b.state === 'lit') { this.setBlock(x, y, z, withState(b.id, st ^ 1)); this.audio.play('click', hit); return true; }
          if (b.shape === 'gate') {
            let ns = st ^ 4;
            if (ns & 4) { const look = MC.facingFromYaw(this.player.yaw); if (((st & 3) + 2) % 4 === look) ns = (ns & ~3) | look; }
            this.setBlock(x, y, z, withState(b.id, ns));
          } else if (b.shape === 'door') {
            const oy = st & 8 ? y - 1 : y + 1;
            this.setBlock(x, y, z, withState(b.id, st ^ 4), { noUpdate: true });
            const ov = this.world.get(x, oy, z);
            if ((ov & ID_MASK) === b.id) this.setBlock(x, oy, z, withState(b.id, blockState(ov) ^ 4), { noUpdate: true });
          } else this.setBlock(x, y, z, withState(b.id, st ^ 4));
          this.audio.play('door', hit);
          return true;
        }
        case 'bed': {
          if (!first) return true;
          this.mySpawn = { x, y: y + 1, z };
          if (this.isDay()) { this.ui.toast('You can only sleep at night'); this.ui.chat('Respawn point set'); return true; }
          if (this.isHost) { this.time = 0; this.ui.chat('Good morning! Respawn point set.'); if (this.net) this.net.broadcast({ t: 'time', time: this.time }); }
          else this.net.send({ t: 'sleep' });
          return true;
        }
        case 'tnt':
          if (held && (held.id === 'flint_and_steel')) {
            if (!first) return true;
            this.setBlock(x, y, z, 0);
            if (this.isHost) this.entities.spawnTNT(x, y, z); else this.net.send({ t: 'prime', p: [x, y, z] });
            this.audio.play('fuse', hit);
            this.damageHeld(1);
            return true;
          }
          return false;
        case 'cake': {
          if (!first) return true;
          if (this.food >= 20 && this.player.mode === 'survival') return false;
          this.food = Math.min(20, this.food + 2); this.saturation = Math.min(this.food, this.saturation + 0.4);
          this.audio.play('eat');
          if (st >= 6) this.setBlock(x, y, z, 0); else this.setBlock(x, y, z, withState(b.id, st + 1));
          return true;
        }
      }
      return false;
    }

    useItem(hit, held, it, first) {
      const p = this.player;
      const id = held.id;
      const hb = hit && BLOCKS[hit.v & ID_MASK];
      const creative = p.mode === 'creative';
      // tools on blocks
      if (hit && it.tool) {
        const t = it.tool.type;
        if (t === 'axe') {
          const strip = hb.key.match(/^(\w+)_(log|wood)$/);
          if (strip && !hb.key.startsWith('stripped_') && B[`stripped_${hb.key}`] != null) { this.setBlock(hit.x, hit.y, hit.z, withState(B[`stripped_${hb.key}`], blockState(hit.v))); this.audio.block('wood', 'place', hit); this.damageHeld(1); this.swing = 1; return true; }
          if (hb.family === 'copper') {
            const ages = MC.COPPER_AGES;
            const cur = ages.findIndex((a) => a && hb.key.startsWith(a));
            if (cur > 0) { const prev = ages[cur - 1] + hb.key.slice(ages[cur].length); if (B[prev] != null) { this.setBlock(hit.x, hit.y, hit.z, withState(B[prev], blockState(hit.v))); this.audio.play('click', hit); this.damageHeld(1); this.swing = 1; return true; } }
          }
        }
        if (t === 'hoe' && (hb.key === 'grass_block' || hb.key === 'dirt' || hb.key === 'coarse_dirt') && this.world.id(hit.x, hit.y + 1, hit.z) === 0 && first) {
          this.setBlock(hit.x, hit.y, hit.z, hb.key === 'coarse_dirt' ? B.dirt : B.farmland);
          this.audio.block('gravel', 'place', hit); this.damageHeld(1); this.swing = 1; return true;
        }
        if (t === 'shears' && hb.key === 'pumpkin' && first) {
          this.setBlock(hit.x, hit.y, hit.z, withState(B.carved_pumpkin, MC.facingFromYaw(p.yaw) ^ 2));
          this.entities.spawnItem(Inv.make('wheat_seeds', 4), hit.x + 0.5, hit.y + 1, hit.z + 0.5);
          this.damageHeld(1); this.swing = 1; return true;
        }
        if (t === 'shovel' && hb.key === 'campfire') { this.swing = 1; return true; }
        if (t === 'bow') { if (first && (creative || Inv.count(this.inv.main, (s) => s.id === 'arrow') > 0)) this.bowCharge = 0.0001; return true; }
      }
      if (it.tool && it.tool.type === 'bow') { if (first && (creative || Inv.count(this.inv.main, (s) => s.id === 'arrow') > 0)) this.bowCharge = 0.0001; return true; }
      // food
      if (it.food && !(id === 'glow_berries' && hit && hit.face === 3) && !(id === 'carrot' && hit && hb.key === 'farmland')) {
        if (first && (this.food < 20 || id === 'golden_apple' || creative)) this.eating = { t: 0, max: id === 'dried_kelp' ? 0.8 : 1.6, id };
        return true;
      }
      switch (it.use) {
        case 'bucket': {
          const fh = this.world.raycast(p.x, p.eye, p.z, ...p.look(), 5, true);
          if (!fh || !first) return !!fh;
          const fb = BLOCKS[fh.v & ID_MASK];
          if (fb.liquid && blockState(fh.v) === 0) { this.setBlock(fh.x, fh.y, fh.z, 0); this.replaceHeld(fb.liquid === 'water' ? 'water_bucket' : 'lava_bucket'); this.audio.play('splash', fh, 0.5); return true; }
          if (fb.key === 'powder_snow') { this.setBlock(fh.x, fh.y, fh.z, 0); this.replaceHeld('powder_snow_bucket'); return true; }
          return false;
        }
        case 'place_water': case 'place_lava': case 'place_powder_snow': {
          if (!hit || !first) return false;
          const blk = it.use === 'place_water' ? B.water : it.use === 'place_lava' ? B.lava : B.powder_snow;
          const c = this.adjacent(hit);
          if (!c) return false;
          this.setBlock(c[0], c[1], c[2], blk);
          if (!creative) this.replaceHeld('bucket');
          this.audio.play('splash', hit, 0.5);
          this.swing = 1;
          return true;
        }
        case 'drink_milk': if (first) { this.eating = { t: 0, max: 1.6, id }; } return true;
        case 'bone_meal': if (hit && first) { if (this.boneMeal(hit)) { this.consumeHeld(1); this.swing = 1; } return true; } return false;
        case 'plant_wheat':
          if (hit && first && hb.key === 'farmland' && hit.face === 2 && this.world.id(hit.x, hit.y + 1, hit.z) === 0) { this.setBlock(hit.x, hit.y + 1, hit.z, withState(B.wheat, 0)); this.consumeHeld(1); this.swing = 1; this.audio.block('grass', 'place', hit); return true; }
          return false;
        case 'plant_vines':
          if (hit && first && hit.face === 3 && hb.solid && this.world.id(hit.x, hit.y - 1, hit.z) === 0) { this.setBlock(hit.x, hit.y - 1, hit.z, withState(B.cave_vines, 0)); this.consumeHeld(1); this.swing = 1; return true; }
          return false;
        case 'compass': if (first) { const s = this.mySpawn || this.spawn; const a = Math.atan2(-(s.x - p.x), -(s.z - p.z)); let d = ((a - p.yaw) * 180 / Math.PI) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; this.ui.toast(`Spawn is ${Math.round(Math.hypot(s.x - p.x, s.z - p.z))} blocks ${Math.abs(d) < 30 ? 'ahead' : d > 0 ? 'to the left' : 'to the right'}`); } return true;
        case 'clock': if (first) { const h = Math.floor(((this.time / 1000) + 6) % 24); this.ui.toast(`It's ${h}:${String(Math.floor((this.time % 1000) * 0.06)).padStart(2, '0')} — ${this.isDay() ? 'daytime' : 'night'}`); } return true;
        case 'spyglass': return true;
      }
      if (it.armor && first) {
        const k = MC.ARMOR_SLOTS.indexOf(it.armor.slot);
        const old = this.inv.armor[k];
        this.inv.armor[k] = held;
        this.inv.main[this.selected] = old;
        this.audio.play('click');
        this.invChanged();
        return true;
      }
      if (id === 'axolotl_bucket' && hit && first) {
        const c = this.adjacent(hit);
        if (!c) return false;
        this.setBlock(c[0], c[1], c[2], B.water);
        if (this.isHost) this.entities.spawnMob('axolotl', c[0] + 0.5, c[1], c[2] + 0.5, { persistent: true });
        this.replaceHeld('bucket');
        return true;
      }
      return false;
    }

    releaseUse() {
      if (this.bowCharge > 0) {
        const charge = Math.min(1, this.bowCharge / 1);
        this.bowCharge = 0;
        if (charge < 0.1) return;
        const p = this.player;
        const creative = p.mode === 'creative';
        if (!creative && !Inv.take(this.inv.main, (s) => s.id === 'arrow', 1)) return;
        const [dx, dy, dz] = p.look();
        const v = 45 * charge;
        if (this.isHost) this.entities.spawnArrow(p.x + dx * 0.5, p.eye - 0.1, p.z + dz * 0.5, dx * v, dy * v, dz * v, this.myId, 2 + charge * 2);
        else this.net.send({ t: 'arrow', p: [p.x + dx * 0.5, p.eye - 0.1, p.z + dz * 0.5], v: [dx * v, dy * v, dz * v], c: charge });
        this.audio.play('bow');
        this.damageHeld(1);
        this.invChanged();
      }
      this.eating = null;
    }

    finishEating() {
      const id = this.eating.id;
      this.eating = null;
      if (id === 'milk_bucket') { this.replaceHeld('bucket'); this.audio.play('burp'); return; }
      const f = I[id].food;
      this.food = Math.min(20, this.food + f.hunger);
      this.saturation = Math.min(this.food, this.saturation + f.saturation);
      if (id === 'golden_apple') this.health = Math.min(20, this.health + 4);
      this.audio.play('burp', null, 0.5);
      if (id === 'mushroom_stew') this.replaceHeld('bowl'); else this.consumeHeld(1);
      if (id === 'rotten_flesh' && Math.random() < 0.8) { this.exhaustion += 4; }
    }

    boneMeal(hit) {
      const b = BLOCKS[hit.v & ID_MASK], st = blockState(hit.v);
      const w = this.world;
      const sparkle = () => { for (let i = 0; i < 8; i++) this.entities.particle(hit.x + Math.random(), hit.y + 0.5 + Math.random(), hit.z + Math.random(), MC.TEX.lime_wool, { vy: 0.5, grav: -0.5, life: 0.8, size: 0.5 }); };
      if (b.use === 'sapling') { if (Math.random() < 0.45) this.growTree(hit.x, hit.y, hit.z, b.key.replace('_sapling', '')); sparkle(); return true; }
      if (b.key === 'wheat' && st < 7) { this.setBlock(hit.x, hit.y, hit.z, withState(b.id, Math.min(7, st + 2 + Math.floor(Math.random() * 3)))); sparkle(); return true; }
      if (b.key === 'cave_vines' && !(st & 1)) { this.setBlock(hit.x, hit.y, hit.z, withState(b.id, 1)); sparkle(); return true; }
      if (b.key === 'grass_block' || b.key === 'moss_block') {
        const moss = b.key === 'moss_block';
        for (let i = 0; i < (moss ? 30 : 40); i++) {
          const x = hit.x + Math.floor((Math.random() - 0.5) * 7), z = hit.z + Math.floor((Math.random() - 0.5) * 7);
          for (let y = hit.y + 2; y >= hit.y - 2; y--) {
            const g = w.id(x, y, z);
            if (moss && (g === B.stone || g === B.dirt || g === B.grass_block || g === B.deepslate || g === B.tuff)) { this.setBlock(x, y, z, B.moss_block); break; }
            if (g === (moss ? B.moss_block : B.grass_block) && w.id(x, y + 1, z) === 0) {
              const r = Math.random();
              const pl = moss ? (r < 0.4 ? B.moss_carpet : r < 0.5 ? B.azalea : r < 0.55 ? B.flowering_azalea : null) : r < 0.75 ? B.short_grass : r < 0.85 ? B.fern : B[MC.FLOWERS[Math.floor(Math.random() * MC.FLOWERS.length)][0]];
              if (pl != null) this.setBlock(x, y + 1, z, pl);
              break;
            }
          }
        }
        sparkle();
        return true;
      }
      return false;
    }

    // The cell next to the clicked face (or the clicked cell itself when it is replaceable).
    adjacent(hit) {
      const tb = BLOCKS[hit.v & ID_MASK];
      if (tb.replaceable && !tb.liquid) return [hit.x, hit.y, hit.z];
      const F = MC.FACES[hit.face];
      const x = hit.x + F.dx, y = hit.y + F.dy, z = hit.z + F.dz;
      const v = this.world.get(x, y, z);
      if (v < 0) return null;
      if (v !== 0 && !BLOCKS[v & ID_MASK].replaceable) return null;
      return [x, y, z];
    }

    place(hit, stack, offhand) {
      const p = this.player;
      const it = I[stack.id];
      const b = MC.blockByKey(it.block);
      const tb = BLOCKS[hit.v & ID_MASK];
      const hy = hit.py - hit.y;
      // finish a half slab into a double slab
      if (b.shape === 'slab' && tb.id === b.id) {
        const st = blockState(hit.v);
        if ((st === 0 && hit.face === 2) || (st === 1 && hit.face === 3)) return this.finishPlace(hit.x, hit.y, hit.z, withState(b.id, 2), b, stack, offhand);
      }
      let x, y, z;
      if (tb.replaceable && tb.id !== b.id && !(tb.liquid && b.liquid)) { x = hit.x; y = hit.y; z = hit.z; }
      else { const F = MC.FACES[hit.face]; x = hit.x + F.dx; y = hit.y + F.dy; z = hit.z + F.dz; }
      const cur = this.world.get(x, y, z);
      if (cur < 0) return false;
      const cd = BLOCKS[cur & ID_MASK];
      if (cur !== 0 && !cd.replaceable) {
        if (b.shape === 'slab' && cd.id === b.id && blockState(cur) !== 2) return this.finishPlace(x, y, z, withState(b.id, 2), b, stack, offhand);
        return false;
      }
      if (y < MC.MIN_Y || y > MC.MAX_Y) return false;
      const st = MC.placeState(b, { face: hit.face, hy, yaw: p.yaw });
      const v = withState(b.id, st);
      // attachment rules
      if (b.shape === 'torch' || b.shape === 'ladder' || b.shape === 'button' || (b.shape === 'flat' && b.key === 'glow_lichen')) {
        if (!tb.solid || !(tb.full || tb.shape === 'slab' || tb.shape === 'stairs')) return false;
        if (b.shape === 'ladder' && (hit.face === 2 || hit.face === 3)) return false;
      }
      if (!this.supportOk(x, y, z, v)) return false;
      if (b.shape === 'door') {
        const above = this.world.get(x, y + 1, z);
        if (above !== 0 && !(above > 0 && BLOCKS[above & ID_MASK].replaceable)) return false;
      }
      // don't place solid blocks inside players or mobs
      if (b.solid) {
        const boxes = MC.collisionBoxes(v, this.world.nb(x, y, z)) || [];
        for (const bx of boxes) {
          if (p.mode !== 'spectator' && p.intersects(x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5])) return false;
          for (const r of this.remotes.values()) if (x + bx[0] < r.x + 0.3 && x + bx[3] > r.x - 0.3 && y + bx[1] < r.y + 1.8 && y + bx[4] > r.y && z + bx[2] < r.z + 0.3 && z + bx[5] > r.z - 0.3) return false;
          for (const e of this.entities.map.values()) if (e.type === 'mob' && x + bx[0] < e.x + e.w / 2 && x + bx[3] > e.x - e.w / 2 && y + bx[1] < e.y + e.h && y + bx[4] > e.y && z + bx[2] < e.z + e.w / 2 && z + bx[5] > e.z - e.w / 2) return false;
        }
      }
      if (!this.finishPlace(x, y, z, v, b, stack, offhand)) return false;
      if (b.shape === 'door') this.setBlock(x, y + 1, z, withState(b.id, st | 8));
      return true;
    }

    finishPlace(x, y, z, v, b, stack, offhand) {
      // water stays in waterloggable plants? keep it simple: placing in water replaces it
      this.setBlock(x, y, z, v);
      this.audio.block(b.sound, 'place', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      if (this.player.mode === 'survival') {
        stack.n--;
        if (offhand) { if (!stack.n) this.inv.offhand[0] = null; }
        else if (!stack.n) this.inv.main[this.selected] = null;
        this.invChanged();
      }
      if (b.gravity && this.isHost) this.schedule(x, y, z, 2);
      return true;
    }

    pickBlock() {
      const hit = this.target;
      if (!hit) return;
      const b = BLOCKS[hit.v & ID_MASK];
      let id = I[b.key] ? b.key : b.key === 'wheat' ? 'wheat_seeds' : b.key === 'cave_vines' ? 'glow_berries' : null;
      if (!id) return;
      const i = this.inv.main.findIndex((s) => s && s.id === id);
      if (i >= 0 && i < 9) { this.selectSlot(i); return; }
      if (i >= 9) { const t = this.inv.main[this.selected]; this.inv.main[this.selected] = this.inv.main[i]; this.inv.main[i] = t; this.invChanged(); return; }
      if (this.player.mode === 'creative') {
        let slot = this.inv.main.slice(0, 9).findIndex((s) => !s);
        if (slot < 0) slot = this.selected;
        this.inv.main[slot] = Inv.make(id, Inv.max(id));
        this.selectSlot(slot);
        this.invChanged();
      }
    }

    dropHeld(all) {
      const st = this.inv.main[this.selected];
      if (!st) return;
      const n = all ? st.n : 1;
      this.dropStack({ ...st, n });
      st.n -= n;
      if (!st.n) this.inv.main[this.selected] = null;
      this.swing = 1;
      this.invChanged();
    }
    dropStack(st) {
      if (!st || st.n <= 0) return;
      const p = this.player;
      const [dx, dy, dz] = p.look();
      this.entities.spawnItem(Inv.clone(st), p.x + dx * 0.3, p.eye - 0.3, p.z + dz * 0.3, dx * 5, dy * 5 + 1.5, dz * 5, 1.5);
    }

    invChanged() { this.ui.hudSig = ''; if (this.ui.open) this.ui.refresh(); }
    onCraft(id) { if (id === 'crafting_table' && !this.toldTable) { this.toldTable = true; this.ui.chat('Tip: place the crafting table and right-click it for a 3×3 grid.'); } }

    // ================= survival =================
    armorPoints() { let a = 0; for (const s of this.inv.armor) if (s && I[s.id].armor) a += I[s.id].armor.points; return a; }

    damage(dmg, info = {}) {
      const p = this.player;
      if (p.mode !== 'survival' || this.dead || p.frozen) return;
      if (this.invuln > 0 && !info.bypass) return;
      if (!['fall', 'drown', 'starve', 'void', 'suffocate', 'freeze'].includes(info.cause)) {
        const a = Math.min(20, this.armorPoints());
        dmg = dmg * (1 - a / 25);
        for (let i = 0; i < 4; i++) { const s = this.inv.armor[i]; if (s) { s.d = (s.d || 0) + 1; if (s.d >= Inv.uses(s.id)) this.inv.armor[i] = null; } }
      }
      if (dmg <= 0) return;
      this.health = Math.max(0, this.health - dmg);
      this.invuln = 0.5;
      this.hurtFlash = 0.5;
      this.audio.play('hurt');
      this.exhaustion += 0.1;
      if (info.kx || info.kz) { const l = Math.hypot(info.kx, info.kz) || 1; p.vx += (info.kx / l) * 7; p.vz += (info.kz / l) * 7; p.vy = Math.max(p.vy, info.ky || 5); }
      this.ui.hudSig = '';
      if (this.health <= 0) this.die(info.cause);
    }

    die(cause) {
      this.dead = true;
      this.mining = null; this.eating = null;
      const msgs = { fall: 'fell from a high place', drown: 'drowned', lava: 'tried to swim in lava', starve: 'starved to death', void: 'fell out of the world', explosion: 'blew up', arrow: 'was shot by a Skeleton', zombie: 'was slain by a Zombie', spider: 'was slain by a Spider', creeper: 'was blown up by a Creeper', suffocate: 'suffocated in a wall', cactus: 'was pricked to death', freeze: 'froze to death', kill: 'died' };
      const msg = `${this.playerName} ${msgs[cause] || 'died'}`;
      this.ui.chat(msg, '#f88');
      if (this.net) this.net.chat(msg, true);
      // drop everything
      for (const arr of [this.inv.main, this.inv.armor, this.inv.offhand, this.inv.craft]) for (let i = 0; i < arr.length; i++) if (arr[i]) { const s = arr[i]; arr[i] = null; this.entities.spawnItem(s, this.player.x, this.player.y + 1, this.player.z, (Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4, 1); }
      const lost = this.xpLevel * 7;
      if (lost) this.entities.spawnXP(this.player.x, this.player.y + 1, this.player.z, Math.min(100, lost));
      this.xp = 0; this.xpLevel = 0; this.xpProgress = 0;
      this.ui.closeWindow(true);
      this.releasePointer();
      this.onDeath && this.onDeath(msg);
    }

    respawn() {
      const s = this.mySpawn || this.spawn;
      const p = this.player;
      p.x = s.x + 0.5; p.y = s.y; p.z = s.z + 0.5;
      p.vx = p.vy = p.vz = 0;
      p.frozen = true;
      this.needsSurface = !this.mySpawn && !s.exact;
      this.health = 20; this.food = 20; this.saturation = 5; this.air = 300; this.exhaustion = 0;
      this.dead = false;
      this.ui.hudSig = '';
      this.world.update(p.x, p.y, p.z, true);
      this.requestPointer();
    }

    onLand(dist) {
      const p = this.player;
      const below = this.world.def(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      let dmg = Math.ceil(dist - 3);
      if (below && below.key === 'hay_block') dmg = Math.floor(dmg * 0.2);
      if (below && (below.key === 'slime_block' || below.key === 'powder_snow')) dmg = 0;
      if (below && below.key === 'pointed_dripstone') dmg = Math.ceil(dist - 2) * 2;
      if (dmg > 0) { this.damage(dmg, { cause: 'fall', bypass: true }); this.audio.block('stone', 'break', null); }
      else if (dist > 1 && below) this.audio.block(below.sound, 'step', null);
      if (below && below.key === 'slime_block' && dist > 1 && !p.sneaking) p.vy = Math.sqrt(2 * 32 * dist) * 0.8;
    }

    footstep() {
      const p = this.player;
      const b = this.world.def(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      if (b && b.id) this.audio.block(b.sound, 'step', null);
      if (p.inWater) this.audio.play('swim', null, 0.3);
    }

    survival(dt) {
      const p = this.player;
      if (this.dead) return;
      if (p.mode !== 'survival') { this.health = 20; this.food = 20; this.air = 300; this.freeze = 0; return; }
      this.survT = (this.survT || 0) + dt;
      while (this.survT >= TICK) {
        this.survT -= TICK;
        this.st = (this.st || 0) + 1;
        // hunger
        if (this.exhaustion >= 4) { this.exhaustion -= 4; if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1); else this.food = Math.max(0, this.food - 1); }
        if (this.food >= 18 && this.health < 20 && this.st % 80 === 0) { this.health = Math.min(20, this.health + 1); this.exhaustion += 6; }
        if (this.food >= 20 && this.saturation > 0 && this.health < 20 && this.st % 10 === 0) { this.health = Math.min(20, this.health + 1); this.exhaustion += 6; }
        if (this.food <= 0 && this.st % 80 === 0) { const floor = [10, 10, 1, 0][this.difficulty]; if (this.health > floor) this.damage(1, { cause: 'starve', bypass: true }); }
        // air
        if (p.eyeInWater) { this.air--; if (this.air <= -20) { this.air = 0; this.damage(2, { cause: 'drown', bypass: true }); } }
        else this.air = Math.min(300, this.air + 5);
        // lava, cactus, suffocation, freezing, void
        if (p.inLava && this.st % 10 === 0) { this.damage(4, { cause: 'lava', bypass: true }); this.burning = 3; }
        if (this.burning > 0) { this.burning -= TICK; if (p.inWater) this.burning = 0; else if (this.st % 20 === 0 && !p.inLava) this.damage(1, { cause: 'lava', bypass: true }); }
        if (this.st % 10 === 0) {
          const eb = this.world.def(Math.floor(p.x), Math.floor(p.eye), Math.floor(p.z));
          if (eb && eb.opaque && !p.flying) this.damage(1, { cause: 'suffocate', bypass: true });
          for (const [dx, dz] of [[0.31, 0], [-0.31, 0], [0, 0.31], [0, -0.31]]) { const b = this.world.def(Math.floor(p.x + dx), Math.floor(p.y + 0.5), Math.floor(p.z + dz)); if (b && b.key === 'cactus') { this.damage(1, { cause: 'cactus' }); break; } }
          if (p.y < MC.MIN_Y - 60) this.damage(4, { cause: 'void', bypass: true });
        }
        const leatherBoots = this.inv.armor[3] && this.inv.armor[3].id === 'leather_boots';
        if (p.inPowder && !leatherBoots) { this.freeze = Math.min(7, this.freeze + TICK); if (this.freeze >= 7 && this.st % 40 === 0) this.damage(1, { cause: 'freeze', bypass: true }); }
        else this.freeze = Math.max(0, this.freeze - TICK * 2);
      }
    }

    // ================= time of day =================
    sunAngle() { return (this.time / DAY) * Math.PI * 2; }
    daylight() { const s = Math.sin(this.sunAngle()); return 0.26 + 0.74 * MC.smooth(MC.clamp((s + 0.15) / 0.45, 0, 1)); }
    skyFactor() { return this.daylight(); }
    isDay() { const t = this.time; return t < 12500 || t > 23400; }

    env() {
      const p = this.player;
      const dl = this.daylight();
      const s = Math.sin(this.sunAngle()), c = Math.cos(this.sunAngle());
      const night = MC.clamp(1 - dl * 1.25, 0, 1);
      const dayZ = [0.47, 0.65, 1.0], dayH = [0.74, 0.85, 1.0], nightZ = [0.01, 0.01, 0.04], nightH = [0.04, 0.05, 0.1];
      const k = MC.smooth(MC.clamp((dl - 0.2) / 0.8, 0, 1));
      const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      let zenith = mix(nightZ, dayZ, k), horizon = mix(nightH, dayH, k);
      // sunrise / sunset glow toward the sun
      const glow = Math.max(0, 1 - Math.abs(s) * 4) * 0.6;
      if (glow > 0) horizon = mix(horizon, [1.0, 0.55, 0.3], glow * (c > 0 ? 1 : 1));
      const dist = this.settings.dist * 16;
      let fogColor = horizon, fogStart = dist * 0.55, fogEnd = dist - 6;
      // darker fog deep underground
      const eyeL = this.world.light(Math.floor(p.x), Math.floor(p.eye), Math.floor(p.z));
      const under = MC.clamp((MC.SEA - 10 - p.eye) / 40, 0, 1) * (eyeL.sky < 8 ? 1 : 0);
      if (under > 0) fogColor = mix(fogColor, [0.02, 0.02, 0.03], under);
      let underwater = false, noSky = false;
      if (p.eyeInWater) { underwater = true; fogColor = [0.06 * dl, 0.16 * dl, 0.45 * dl]; fogStart = 0; fogEnd = 28; }
      if (p.eyeInLava) { underwater = true; fogColor = [0.8, 0.25, 0.02]; fogStart = 0; fogEnd = 2.5; }
      if (this.freeze > 0 && p.inPowder) { fogColor = [0.85, 0.9, 0.97]; fogStart = 0; fogEnd = 3; noSky = true; }
      return { daylight: dl, sunAngle: this.sunAngle(), zenith, horizon, fogColor, fogStart, fogEnd, night, underwater, noSky, gamma: (this.settings.gamma || 0) / 100 };
    }

    // ================= rendering =================
    render(t, dt) {
      const p = this.player, r = this.r;
      r.time = t;
      r.scale = (this.settings.scale || 100) / 100;
      const bobOn = this.settings.bob !== false;
      const bob = bobOn ? p.bob : 0;
      const ph = p.walkDist * Math.PI * 0.75;
      let fov = this.settings.fov || 70;
      if (p.sprinting) fov *= 1.1;
      if (this.zooming) fov = 12;
      if (this.bowCharge > 0) fov *= 1 - Math.min(1, this.bowCharge) * 0.15;
      this.curFov = this.curFov ? this.curFov + (fov - this.curFov) * Math.min(1, dt * 10) : fov;
      const cam = { x: p.x + Math.cos(p.yaw) * Math.sin(ph) * 0.04 * bob, y: p.eye + Math.abs(Math.cos(ph)) * 0.06 * bob, z: p.z - Math.sin(p.yaw) * Math.sin(ph) * 0.04 * bob, yaw: p.yaw, pitch: p.pitch, fov: this.curFov };
      if (this.dead) { cam.y = p.y + 0.3; }
      const env = this.env();
      r.begin(cam, env);
      r.drawTerrain();
      r.beginEntities();
      this.entities.render(r, t);
      this.renderRemotes(r, t);
      r.drawTranslucent();
      const tgt = this.target;
      if (tgt && !this.ui.open && !this.hideHud && !this.dead) {
        r.drawOutline(tgt.x, tgt.y, tgt.z, tgt.boxes);
        if (this.mining && this.mining.progress > 0) r.drawCracks(tgt.x, tgt.y, tgt.z, tgt.boxes, Math.floor(this.mining.progress * 10));
      }
      if (!this.hideHud && !this.dead && !this.zooming && p.mode !== 'spectator') this.renderHand(r, t);
      r.end();
      // HUD bits
      $('overlay-water').style.opacity = p.eyeInWater ? 1 : 0;
      $('overlay-hurt').style.opacity = this.hurtFlash > 0 ? this.hurtFlash * 1.6 : 0;
      $('overlay-freeze').style.opacity = this.freeze / 7;
      if (!this.ui.open) this.ui.hud(); else this.ui.tick();
      this.nametags();
      if (this.debug) this.debugText();
    }

    renderHand(r, t) {
      const p = this.player;
      const L = this.world.light(Math.floor(p.x), Math.floor(p.eye), Math.floor(p.z));
      const held = this.inv.main[this.selected];
      const sw = this.swing > 0 ? Math.sin((1 - this.swing) * Math.PI) : 0;
      const ph = p.walkDist * Math.PI * 0.75;
      const bob = this.settings.bob !== false ? p.bob : 0;
      const bx = Math.sin(ph) * 0.03 * bob, by = -Math.abs(Math.cos(ph)) * 0.03 * bob;
      const eat = this.eating ? Math.sin(this.eating.t * 25) * 0.03 : 0;
      r.beginEntities();
      const lo = { sky: L.sky, blk: L.blk };
      if (held) {
        const m = MC.itemModel(r, held.id);
        const cube = !m.icons;
        const tool = I[held.id].tool;
        const draw = this.eating ? { x: 0.22, y: -0.42 + eat, z: -0.62 } : { x: 0.5 - sw * 0.22 + bx, y: (cube ? -0.58 : -0.66) + sw * 0.18 + by, z: -0.85 - sw * 0.1 };
        r.drawHeld(m, { ...lo, ...draw, yaw: cube ? 0.75 : -0.45, pitch: -sw * 1.1 + (cube ? 0 : 0.12), roll: tool && !cube ? 0.1 : 0, scale: cube ? 0.4 : tool ? 0.5 : 0.4 });
      } else {
        const m = r.model('arm', () => ({ parts: [{ name: 'a', pivot: [0, 0, 0], boxes: [{ from: [-2, -2, -12], to: [2, 2, 0], tex: [MC.TEX[`player_sleeve_${this.shirt}`], MC.TEX[`player_sleeve_${this.shirt}`], MC.TEX.player_arm, MC.TEX.player_arm, MC.TEX.player_arm, MC.TEX.player_arm] }] }] }));
        r.drawHeld(m, { ...lo, x: 0.62 - sw * 0.2 + bx, y: -0.72 + sw * 0.15 + by, z: -0.42 - sw * 0.2, yaw: 0.32 + sw * 0.3, pitch: 0.42 - sw * 0.6, scale: 0.55 });
      }
    }

    renderRemotes(r, t) {
      for (const rp of this.remotes.values()) {
        if (rp.dead) continue;
        const m = r.model('player:' + rp.shirt, () => MC.playerModel(rp.shirt));
        const L = this.world.light(Math.floor(rp.x), Math.floor(rp.y + 1), Math.floor(rp.z));
        const sw = Math.sin((rp.walk || 0) * 2.2) * Math.min(1, rp.speed || 0);
        const swing = rp.swingT > 0 ? Math.sin(rp.swingT * Math.PI) : 0;
        const rot = { head: { x: rp.pitch || 0 }, armR: { x: sw * 0.8 + swing * 1.4 }, armL: { x: -sw * 0.8 }, legR: { x: -sw * 0.8 }, legL: { x: sw * 0.8 }, body: { x: rp.sneak ? -0.3 : 0 } };
        r.drawModel(m, rp.x, rp.y - (rp.sneak ? 0.15 : 0), rp.z, rp.yaw, { sky: L.sky, blk: L.blk, rot, hurt: rp.hurt > 0 ? 1 : 0 });
        if (rp.held) {
          const im = MC.itemModel(r, rp.held);
          const s = Math.sin(rp.yaw), c = Math.cos(rp.yaw);
          // right hand is +x in model space: rotate (0.38, 0, -0.25) by yaw
          const hx = 0.38 * c + -0.3 * s, hz = -0.38 * s + -0.3 * c;
          r.drawModel(im, rp.x + hx, rp.y + 0.7, rp.z + hz, rp.yaw + (im.icons ? Math.PI / 2 : 0), { sky: L.sky, blk: L.blk, scale: im.icons ? 0.45 : 0.3 });
        }
      }
    }

    nametags() {
      const box = $('nametags');
      if (!this.remotes.size) { if (box.childElementCount) box.innerHTML = ''; return; }
      const vp = this.r.viewProj, cam = this.r.cam;
      const W = innerWidth, H = innerHeight;
      const seen = new Set();
      for (const [id, rp] of this.remotes) {
        let el = box.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (!el) { el = document.createElement('span'); el.dataset.id = id; box.appendChild(el); }
        seen.add(el);
        el.textContent = rp.name;
        const x = rp.x - cam.x, y = rp.y + 2.1 - cam.y, z = rp.z - cam.z;
        const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
        if (cw <= 0.1 || rp.dead || rp.sneak && Math.hypot(x, z) > 8) { el.style.display = 'none'; continue; }
        el.style.display = '';
        el.style.left = ((cx / cw) * 0.5 + 0.5) * W + 'px';
        el.style.top = (1 - ((cy / cw) * 0.5 + 0.5)) * H + 'px';
      }
      for (const el of [...box.children]) if (!seen.has(el)) el.remove();
    }

    debugText() {
      const p = this.player, w = this.world, r = this.r;
      const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
      const L = w.light(bx, Math.floor(p.eye), bz);
      const dirs = ['north (-z)', 'west (-x)', 'south (+z)', 'east (+x)'];
      const facing = dirs[Math.round((((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4];
      const tgt = this.target ? `${this.target.x} ${this.target.y} ${this.target.z} ${BLOCKS[this.target.v & ID_MASK].key}${blockState(this.target.v) ? ' [' + blockState(this.target.v) + ']' : ''}` : '-';
      $('debug').textContent = [
        `Blockcraft  ${Math.round(this.fps)} fps`,
        `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
        `Block: ${bx} ${by} ${bz}   Chunk: ${Math.floor(bx / 16)} ${Math.floor(bz / 16)}`,
        `Facing: ${facing}`,
        `Biome: ${MC.BIOMES[w.biomeAt(bx, bz)] || '?'}   Cave: ${['none', 'lush caves', 'dripstone caves'][w.caveBiomeAt(bx, bz)] || '-'}`,
        `Light: sky ${L.sky}  block ${L.blk}   Time: ${Math.floor(this.time)}`,
        `Looking at: ${tgt}`,
        `Sections: ${r.stats.drawn}/${r.stats.sections}  Quads: ${r.stats.quads}`,
        `Entities: ${this.entities.map.size}  Chunks: ${w.chunks.size}`,
        `Seed: ${this.seed}   Mode: ${p.mode}${this.net ? '   Room: ' + this.net.code : ''}`,
      ].join('\n');
    }

    // ================= chat & commands =================
    sendChat(text) {
      if (text.startsWith('/')) { this.command(text.slice(1)); return; }
      const msg = `<${this.playerName}> ${text}`;
      this.ui.chat(msg);
      if (this.net) this.net.chat(msg);
    }

    command(cmd) {
      const [name, ...args] = cmd.trim().split(/\s+/);
      const p = this.player;
      const say = (m, c) => this.ui.chat(m, c || '#ccc');
      const cheats = this.isHost || this.info.cheats;
      switch (name) {
        case 'help': say('/gamemode survival|creative|spectator, /time set day|noon|night|midnight, /tp x y z, /give item [n], /summon mob, /seed, /spawn, /setspawn, /kill, /weather clear, /difficulty peaceful|easy|normal|hard'); break;
        case 'seed': say('Seed: ' + this.seed); break;
        case 'gamemode': case 'gm': {
          const m = { s: 'survival', c: 'creative', sp: 'spectator', 0: 'survival', 1: 'creative', 3: 'spectator' }[args[0]] || args[0];
          if (!['survival', 'creative', 'spectator'].includes(m)) { say('Unknown game mode'); break; }
          p.mode = m; if (m === 'survival') p.flying = false;
          this.ui.hudSig = '';
          say('Game mode set to ' + m);
          break;
        }
        case 'time': {
          if (!cheats) { say('Only the host can change the time'); break; }
          const v = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 }[args[1]];
          const n = v != null ? v : +args[1];
          if (args[0] === 'set' && !isNaN(n)) { this.time = n % DAY; if (this.net) this.net.broadcast({ t: 'time', time: this.time }); say('Time set to ' + n); }
          else if (args[0] === 'add' && !isNaN(+args[1])) { this.time = (this.time + +args[1]) % DAY; }
          else say('/time set day|noon|night|midnight|<ticks>');
          break;
        }
        case 'tp': {
          const n = args.map(Number);
          if (n.length === 3 && n.every((x) => !isNaN(x))) { p.x = n[0]; p.y = n[1]; p.z = n[2]; p.vy = 0; p.frozen = true; this.needsSurface = false; this.world.update(p.x, p.y, p.z, true); say(`Teleported to ${n.join(' ')}`); }
          else { const rp = [...this.remotes.values()].find((r) => r.name.toLowerCase() === (args[0] || '').toLowerCase()); if (rp) { p.x = rp.x; p.y = rp.y; p.z = rp.z; } else say('/tp x y z or /tp <player>'); }
          break;
        }
        case 'give': {
          if (!cheats && p.mode !== 'creative') { say('Only the host (or creative mode) can use /give'); break; }
          const id = (args[0] || '').toLowerCase().replace(/^minecraft:/, '');
          if (!I[id]) { say('Unknown item: ' + id); break; }
          const n = Math.max(1, Math.min(64 * 36, +args[1] || 1));
          let left = n;
          while (left > 0) { const k = Math.min(left, Inv.max(id)); const rem = Inv.add(this.inv.main, Inv.make(id, k), Inv.PICKUP_ORDER); if (rem) { this.dropStack(Inv.make(id, rem)); } left -= k; }
          this.invChanged();
          say(`Gave ${n} ${I[id].name}`);
          break;
        }
        case 'summon': {
          if (!cheats) { say('Only the host can summon'); break; }
          const k = (args[0] || '').toLowerCase();
          if (!MC.MOBS[k]) { say('Mobs: ' + Object.keys(MC.MOBS).join(', ')); break; }
          const [dx, , dz] = p.look();
          this.entities.spawnMob(k, p.x + dx * 3, p.y + 0.5, p.z + dz * 3, { persistent: true });
          break;
        }
        case 'spawn': { const s = this.mySpawn || this.spawn; p.x = s.x + 0.5; p.y = s.y + 0.5; p.z = s.z + 0.5; p.frozen = true; this.world.update(p.x, p.y, p.z, true); break; }
        case 'setspawn': case 'spawnpoint': this.mySpawn = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), exact: true }; say('Respawn point set'); break;
        case 'kill': if (p.mode === 'survival') { this.health = 0; this.die('kill'); } else say('Only works in survival'); break;
        case 'weather': say('The sky is clear (weather is not simulated)'); break;
        case 'difficulty': {
          if (!cheats) { say('Only the host can change difficulty'); break; }
          const d = { peaceful: 0, easy: 1, normal: 2, hard: 3 }[args[0]];
          if (d == null) { say('/difficulty peaceful|easy|normal|hard'); break; }
          this.difficulty = d; say('Difficulty set to ' + args[0]);
          break;
        }
        default: say('Unknown command. Try /help', '#f88');
      }
    }
  }

  MC.Game = Game;
})(globalThis);
