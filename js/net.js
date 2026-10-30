// Multiplayer over WebRTC (PeerJS). One player hosts their world; friends join with a room code.
//
// The host is in charge of the world: block physics, mobs, items, furnaces and chests. Guests
// generate terrain themselves from the shared seed, run their own movement, and send their
// block edits and actions to the host, which applies them and passes them on to everyone else.
(function (G) {
  'use strict';
  const MC = G.MC;
  const PREFIX = 'blockcraft-v1-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function makeCode() { let s = ''; for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]; return s; }
  function peerOptions() {
    const o = { debug: 1 };
    // tests (and self-hosters) can point at their own PeerJS server: ?peer=host:port
    const q = new URLSearchParams(location.search).get('peer');
    if (q) { const [host, port] = q.split(':'); Object.assign(o, { host, port: +port || 9000, path: '/', secure: false }); }
    return o;
  }

  class Net {
    constructor(peer, isHost) {
      this.peer = peer;
      this.isHost = isHost;
      this.id = peer.id;
      this.conns = new Map(); // peer id -> {conn, name}
      this.outEdits = [];
      this.timers = { pos: 0, ents: 0, time: 0, pstate: 0, edits: 0 };
      this.saved = {}; // name -> player data (host)
      this.game = null;
    }

    // ---------------- setup ----------------
    static host(code, savedPlayers) {
      return new Promise((resolve, reject) => {
        if (!G.Peer) { reject(new Error('Multiplayer library failed to load')); return; }
        const tryCode = (c, attempts) => {
          const peer = new G.Peer(PREFIX + c, peerOptions());
          let done = false;
          peer.on('open', () => {
            done = true;
            const n = new Net(peer, true);
            n.code = c;
            n.saved = savedPlayers || {};
            peer.on('connection', (conn) => n.accept(conn));
            resolve(n);
          });
          peer.on('error', (err) => {
            if (!done && err.type === 'unavailable-id' && attempts < 5) { peer.destroy(); tryCode(makeCode(), attempts + 1); return; }
            if (!done) { peer.destroy(); reject(new Error(niceError(err))); }
            else console.warn('peer error', err);
          });
        };
        tryCode(code || makeCode(), 0);
      });
    }

    static join(code, name) {
      return new Promise((resolve, reject) => {
        if (!G.Peer) { reject(new Error('Multiplayer library failed to load')); return; }
        code = code.trim().toUpperCase();
        const peer = new G.Peer(undefined, peerOptions());
        let done = false;
        const fail = (msg) => { if (!done) { done = true; peer.destroy(); reject(new Error(msg)); } };
        const timer = setTimeout(() => fail('Could not reach that room. Check the code and that the host is still playing.'), 15000);
        peer.on('open', () => {
          const conn = peer.connect(PREFIX + code, { reliable: true });
          conn.on('open', () => conn.send({ t: 'hello', name }));
          conn.on('data', (m) => {
            if (m && m.t === 'welcome' && !done) {
              done = true;
              clearTimeout(timer);
              const n = new Net(peer, false);
              n.code = code;
              n.hostConn = conn;
              n.conns.set(conn.peer, { conn, name: m.hostName });
              conn.on('data', (msg) => n.onGuestMessage(msg));
              conn.on('close', () => n.lost('The host closed the world.'));
              resolve({ net: n, welcome: m });
            } else if (m && m.t === 'refuse') fail(m.reason);
          });
          conn.on('error', (e) => fail(niceError(e)));
        });
        peer.on('error', (err) => fail(niceError(err)));
        peer.on('disconnected', () => { if (done) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
      });
    }

    close() {
      for (const { conn } of this.conns.values()) { try { conn.close(); } catch (e) { /* ignore */ } }
      try { this.peer.destroy(); } catch (e) { /* ignore */ }
      this.closed = true;
    }

    lost(msg) { if (this.closed) return; this.closed = true; if (this.game && this.game.onDisconnect) this.game.onDisconnect(msg); }

    // ---------------- host side ----------------
    accept(conn) {
      conn.on('data', (m) => {
        if (!m || !m.t) return;
        if (m.t === 'hello') return this.welcome(conn, m);
        const who = this.conns.get(conn.peer);
        if (!who) return;
        this.onHostMessage(conn.peer, who, m);
      });
      conn.on('close', () => this.drop(conn.peer));
      conn.on('error', () => this.drop(conn.peer));
    }

    welcome(conn, m) {
      const g = this.game;
      if (!g || !g.running) { conn.send({ t: 'refuse', reason: 'The host is not in a world right now.' }); return; }
      let name = String(m.name || 'Player').slice(0, 16).replace(/[<>]/g, '') || 'Player';
      const taken = new Set([g.playerName, ...[...this.conns.values()].map((c) => c.name)]);
      let k = 2;
      const base = name;
      while (taken.has(name)) name = base + k++;
      this.conns.set(conn.peer, { conn, name });
      const edits = [];
      for (const [ck, map] of g.world.edits) if (map.size) edits.push([ck, [...map]]);
      const saved = this.saved[name];
      const sp = g.spawn;
      conn.send({
        t: 'welcome', seed: g.seed, time: g.time, difficulty: g.difficulty, mode: g.info.mode || 'survival', hostName: g.playerName, name,
        edits, tiles: [...g.tiles], spawn: sp, you: saved || null, worldName: g.info.name,
      });
      g.remotes.set(conn.peer, { id: conn.peer, name, x: sp.x + 0.5, y: sp.y, z: sp.z + 0.5, tx: sp.x + 0.5, ty: sp.y, tz: sp.z + 0.5, yaw: 0, pitch: 0, mode: (saved && saved.mode) || g.info.mode || 'survival', shirt: Math.abs(MC.seedFromString(name)) % 8, local: false, dead: false });
      const msg = `${name} joined the game`;
      g.ui.chat(msg, '#ff5');
      this.broadcast({ t: 'chat', msg, color: '#ff5' }, conn.peer);
    }

    drop(id) {
      const who = this.conns.get(id);
      if (!who) return;
      this.conns.delete(id);
      const g = this.game;
      if (this.isHost && g) {
        g.remotes.delete(id);
        const msg = `${who.name} left the game`;
        g.ui.chat(msg, '#ff5');
        this.broadcast({ t: 'chat', msg, color: '#ff5' });
      } else this.lost('Lost connection to the host.');
    }

    onHostMessage(id, who, m) {
      const g = this.game;
      if (!g || !g.running) return;
      const E = g.entities;
      switch (m.t) {
        case 'pos': {
          const r = g.remotes.get(id);
          if (!r) return;
          r.tx = m.x; r.ty = m.y; r.tz = m.z; r.yaw = m.yaw; r.pitch = m.pitch; r.held = m.held; r.sneak = m.sneak; r.mode = m.mode; r.dead = m.dead;
          if (m.swing) r.swingT = 1;
          break;
        }
        case 'set': for (const [x, y, z, v] of m.list) g.setBlock(x, y, z, v, { remote: true, from: id }); break;
        case 'drop': E.spawnItem(m.s, m.p[0], m.p[1], m.p[2], m.v[0], m.v[1], m.v[2], 1); break;
        case 'spawnxp': E.spawnXP(m.p[0], m.p[1], m.p[2], m.v); break;
        case 'hit': { const e = E.map.get(m.id); if (e) E.hurtMob(e, m.dmg, m.kx, m.kz, id); break; }
        case 'interact': {
          const e = E.map.get(m.id);
          const res = e ? E.interact(e, { id: m.item, n: 1 }, g.remotes.get(id)) : null;
          if (res) this.sendTo(id, { t: 'interactResult', res });
          break;
        }
        case 'arrow': E.spawnArrow(m.p[0], m.p[1], m.p[2], m.v[0], m.v[1], m.v[2], id, 2 + m.c * 2); break;
        case 'prime': E.spawnTNT(m.p[0], m.p[1], m.p[2]); break;
        case 'openTile': {
          const [x, y, z] = m.k.split(',').map(Number);
          const b = g.world.def(x, y, z);
          if (b && (b.use === 'chest' || b.use === 'furnace')) this.sendTo(id, { t: 'tile', k: m.k, tile: g.tileFor(x, y, z), open: true });
          break;
        }
        case 'tile': {
          if (!m.tile) break;
          const t = g.tiles.get(m.k);
          if (!t) break;
          t.slots = m.tile.slots.map(MC.Inv.clone);
          t.dirty = true;
          if (g.ui.win && g.ui.win.tileKey === m.k) { g.ui.win.tile.slots = t.slots; g.ui.refresh(); }
          this.broadcast({ t: 'tile', k: m.k, tile: t }, id);
          break;
        }
        case 'sleep':
          if (!g.isDay()) { g.time = 0; this.broadcast({ t: 'time', time: 0 }); g.ui.chat(`${who.name} slept through the night`); }
          break;
        case 'chat': g.ui.chat(m.msg, m.color); this.broadcast({ t: 'chat', msg: m.msg, color: m.color }, id); break;
        case 'pstate': this.saved[who.name] = m.data; break;
      }
    }

    // ---------------- guest side ----------------
    onGuestMessage(m) {
      const g = this.game;
      if (!g || !g.running || !m) return;
      switch (m.t) {
        case 'set':
          for (const [x, y, z, v] of m.list) {
            const old = g.world.get(x, y, z);
            if (g.world.set(x, y, z, v, { remote: true }) && old > 0 && v === 0 && Math.hypot(x - g.player.x, y - g.player.y, z - g.player.z) < 24) {
              g.entities.blockParticles(x, y, z, old, 8);
              g.audio.block(MC.BLOCKS[old & MC.ID_MASK].sound, 'break', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
            }
          }
          break;
        case 'ents': g.entities.applySnapshot(m.list); break;
        case 'players': {
          const seen = new Set();
          for (const [id, name, x, y, z, yaw, pitch, held, sneak, mode, dead, swing] of m.list) {
            if (id === this.id) continue;
            seen.add(id);
            let r = g.remotes.get(id);
            if (!r) { r = { id, name, x, y, z, shirt: Math.abs(MC.seedFromString(name)) % 8, local: false }; g.remotes.set(id, r); }
            Object.assign(r, { name, tx: x, ty: y, tz: z, yaw, pitch, held, sneak, mode, dead });
            if (swing) r.swingT = 1;
          }
          for (const id of [...g.remotes.keys()]) if (!seen.has(id)) g.remotes.delete(id);
          break;
        }
        case 'time': g.time = m.time; break;
        case 'chat': g.ui.chat(m.msg, m.color); break;
        case 'give': { const left = MC.Inv.add(g.inv.main, m.s, MC.Inv.PICKUP_ORDER); if (left) g.dropStack({ ...m.s, n: left }); g.audio.play('pop', null, 0.4); g.invChanged(); break; }
        case 'xp': g.giveXP(g.localPlayer(), m.v); break;
        case 'hurt': g.damage(m.dmg, m.info || {}); break;
        case 'interactResult': g.applyInteract(m.res); break;
        case 'boom': g.entities.boomParticles(m.p[0], m.p[1], m.p[2], m.r); g.audio.play('explode', { x: m.p[0], y: m.p[1], z: m.p[2] }, 1.2); break;
        case 'tile': {
          if (!m.tile) { g.tiles.delete(m.k); if (g.ui.win && g.ui.win.tileKey === m.k) g.ui.closeWindow(); break; }
          let t = g.tiles.get(m.k);
          if (!t) { t = m.tile; g.tiles.set(m.k, t); } else Object.assign(t, m.tile);
          t.dirty = true;
          if (m.open && g.pendingTile && g.pendingTile.k === m.k) { g.showTile(m.k, t, g.pendingTile.b); g.pendingTile = null; }
          else if (g.ui.win && g.ui.win.tileKey === m.k) { g.ui.win.tile = t; g.ui.refresh(); }
          break;
        }
      }
    }

    // ---------------- sending ----------------
    send(m) { if (this.hostConn && this.hostConn.open) this.hostConn.send(m); }
    sendTo(id, m) { const c = this.conns.get(id); if (c && c.conn.open) c.conn.send(m); }
    broadcast(m, except) { for (const [id, c] of this.conns) if (id !== except && c.conn.open) c.conn.send(m); }

    edit(x, y, z, v, from) { this.outEdits.push([x, y, z, v, from || null]); }

    chat(msg, system) {
      if (this.isHost) this.broadcast({ t: 'chat', msg, color: system ? '#f88' : null });
      else this.send({ t: 'chat', msg, color: system ? '#f88' : null });
    }
    tile(k, t) {
      const data = t ? { type: t.type, kind: t.kind, slots: t.slots, burn: t.burn, burnMax: t.burnMax, cook: t.cook, cookMax: t.cookMax } : null;
      if (this.isHost) this.broadcast({ t: 'tile', k, tile: data });
      else if (t) this.send({ t: 'tile', k, tile: data });
    }

    savedPlayers() {
      return this.saved;
    }

    // Called every frame.
    update(dt) {
      const g = this.game;
      if (!g || this.closed) return;
      const T = this.timers;
      for (const k in T) T[k] += dt;
      // smooth remote players
      const kk = Math.min(1, dt * 12);
      for (const r of g.remotes.values()) {
        if (r.tx == null) continue;
        const ox = r.x, oz = r.z;
        r.x += (r.tx - r.x) * kk; r.y += (r.ty - r.y) * kk; r.z += (r.tz - r.z) * kk;
        const sp = Math.hypot(r.x - ox, r.z - oz) / Math.max(dt, 0.001);
        r.speed = Math.min(1, sp / 4);
        r.walk = (r.walk || 0) + sp * dt * 1.6;
        if (r.swingT > 0) r.swingT -= dt * 3;
      }
      if (T.edits >= 0.05 && this.outEdits.length) {
        T.edits = 0;
        if (this.isHost) {
          for (const [id, c] of this.conns) {
            if (!c.conn.open) continue;
            const list = this.outEdits.filter((e) => e[4] !== id).map((e) => e.slice(0, 4));
            if (list.length) c.conn.send({ t: 'set', list });
          }
        } else this.send({ t: 'set', list: this.outEdits.filter((e) => !e[4]).map((e) => e.slice(0, 4)) });
        this.outEdits = [];
      }
      const p = g.player;
      const st = g.inv.main[g.selected];
      if (this.isHost) {
        if (T.pos >= 0.1) {
          T.pos = 0;
          const list = [[this.id, g.playerName, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), +p.pitch.toFixed(2), st && st.id, p.sneaking, p.mode, g.dead, g.swing > 0.9]];
          for (const r of g.remotes.values()) list.push([r.id, r.name, +r.tx.toFixed(2), +r.ty.toFixed(2), +r.tz.toFixed(2), +(r.yaw || 0).toFixed(2), +(r.pitch || 0).toFixed(2), r.held, r.sneak, r.mode, r.dead, r.swingT > 0.9]);
          this.broadcast({ t: 'players', list });
        }
        if (T.ents >= 0.1) {
          T.ents = 0;
          for (const [id, c] of this.conns) {
            const r = g.remotes.get(id);
            if (!r || !c.conn.open) continue;
            c.conn.send({ t: 'ents', list: g.entities.snapshotFor(r.tx, r.tz) });
          }
        }
        if (T.time >= 5) { T.time = 0; this.broadcast({ t: 'time', time: g.time }); }
      } else {
        if (T.pos >= 0.1) {
          T.pos = 0;
          this.send({ t: 'pos', x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), held: st && st.id, sneak: p.sneaking, mode: p.mode, dead: g.dead || p.frozen, swing: g.swing > 0.85 });
        }
        if (T.pstate >= 5) { T.pstate = 0; this.send({ t: 'pstate', data: g.playerData() }); }
      }
    }
  }

  function niceError(err) {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'No room with that code. Check the code and that the host is still playing.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the multiplayer server. Your network or a privacy blocker may be stopping it.';
    if (t === 'browser-incompatible') return 'This browser does not support multiplayer (WebRTC).';
    if (t === 'unavailable-id') return 'That room code is already in use.';
    return (err && err.message) || 'Multiplayer error';
  }

  MC.Net = Net;
})(globalThis);
