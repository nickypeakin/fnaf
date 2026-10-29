// Networking. One browser hosts the room and runs the simulation; everybody
// else connects to it peer-to-peer (WebRTC via PeerJS). The host's own player
// talks to the room through a LocalLink, so the UI code is identical for
// hosts and joiners.
//
// Protocol (all JSON):
//   client -> host: hello {name, v}, role {role}, settings {settings}, start, lobby, in {...input}
//   host -> client: welcome {pid, code}, lobby {...}, start {}, snap {s, ev}, msg {text}, bye {reason}
(function () {
  'use strict';
  const FN = window.FN;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  function makeCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  // Optional self-hosted signalling server: ?peerhost=example.com&peerport=9000&peerpath=/&peersecure=0
  function peerOptions() {
    const q = new URLSearchParams(location.search);
    const o = { debug: 1 };
    if (q.get('peerhost')) {
      o.host = q.get('peerhost');
      o.port = Number(q.get('peerport') || 443);
      o.path = q.get('peerpath') || '/';
      o.secure = q.get('peersecure') !== '0';
    }
    return o;
  }

  function cleanName(n) {
    return String(n || '').replace(/[^\w .'\-!?]/g, '').trim().slice(0, 16) || 'Player';
  }

  // Timers in a worker keep ticking at full speed when the host's tab is in the background.
  function makeTicker(ms, fn) {
    let interval = null;
    let worker = null;
    let url = null;
    const fallback = () => {
      if (worker) { worker.terminate(); worker = null; }
      if (!interval) interval = setInterval(fn, ms);
    };
    try {
      url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = fn;
      worker.onerror = fallback; // some browsers refuse blob workers (e.g. file:// pages); that only shows up async
    } catch (e) {
      fallback();
    }
    return {
      stop() {
        if (worker) worker.terminate();
        if (interval) clearInterval(interval);
        if (url) URL.revokeObjectURL(url);
        worker = null;
        interval = null;
      },
    };
  }

  const DEFAULT_SETTINGS = {
    night: 1, length: 'classic', speed: 'auto',
    custom: { freddy: 10, bonnie: 10, chica: 10, foxy: 10 },
  };

  class RoomHost {
    // onLocal(msg) delivers messages to the host's own UI.
    constructor({ name, online, onLocal, onStatus }) {
      this.online = online;
      this.onLocal = onLocal;
      this.onStatus = onStatus || (() => {});
      this.code = online ? makeCode() : null;
      this.players = [];
      this.nextId = 1;
      this.phase = 'lobby';
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this.sim = null;
      this.ticker = null;
      this.peer = null;
      this.localPid = 'p0';
      this.players.push({ pid: this.localPid, name: cleanName(name), role: 'guard', conn: null });
    }

    open() {
      if (!this.online) {
        this.sendTo(this.localPid, { t: 'welcome', pid: this.localPid, code: null });
        this.broadcastLobby();
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        let tries = 0;
        const attempt = () => {
          const peer = new window.Peer(FN.PEER_PREFIX + this.code, peerOptions());
          let opened = false;
          peer.on('open', () => {
            opened = true;
            this.peer = peer;
            this.sendTo(this.localPid, { t: 'welcome', pid: this.localPid, code: this.code });
            this.broadcastLobby();
            resolve();
          });
          peer.on('connection', (conn) => this.accept(conn));
          peer.on('disconnected', () => {
            // Lost the signalling server; existing players stay connected, new ones can't join until this works.
            if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
          });
          peer.on('error', (err) => {
            if (!opened && err.type === 'unavailable-id' && tries++ < 4) {
              peer.destroy();
              this.code = makeCode();
              attempt();
            } else if (!opened) {
              peer.destroy();
              reject(err);
            } else {
              console.warn('peer error', err.type, err);
            }
          });
        };
        attempt();
      });
    }

    accept(conn) {
      let pid = null;
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (!pid) {
          if (msg.t !== 'hello') return;
          if (msg.v !== FN.PROTOCOL) {
            conn.send({ t: 'bye', reason: 'Your game version doesn\'t match the host\'s. Refresh the page.' });
            setTimeout(() => conn.close(), 300);
            return;
          }
          if (this.players.length >= 12) {
            conn.send({ t: 'bye', reason: 'The room is full.' });
            setTimeout(() => conn.close(), 300);
            return;
          }
          pid = 'p' + this.nextId++;
          const role = this.phase === 'lobby' ? this.freeRole() : 'spectator';
          this.players.push({ pid, name: cleanName(msg.name), role, conn });
          conn.send({ t: 'welcome', pid, code: this.code });
          if (this.phase !== 'lobby') conn.send({ t: 'start', late: true });
          this.broadcastLobby();
          return;
        }
        this.handle(pid, msg);
      });
      const drop = () => { if (pid) this.removePlayer(pid); pid = null; };
      conn.on('close', drop);
      conn.on('error', drop);
    }

    freeRole() {
      for (const c of ['bonnie', 'chica', 'foxy', 'freddy']) if (!this.players.some((p) => p.role === c)) return c;
      if (this.players.filter((p) => p.role === 'guard').length < FN.MAX_GUARDS) return 'guard';
      return 'spectator';
    }

    removePlayer(pid) {
      const p = this.players.find((x) => x.pid === pid);
      if (!p) return;
      this.players = this.players.filter((x) => x.pid !== pid);
      if (this.sim) this.sim.removePlayer(pid);
      this.broadcastLobby();
    }

    isHost(pid) { return pid === this.localPid; }

    handle(pid, msg) {
      const p = this.players.find((x) => x.pid === pid);
      if (!p) return;
      switch (msg.t) {
        case 'in':
          if (this.sim && this.phase === 'playing') this.sim.input(pid, msg);
          break;
        case 'role': {
          if (this.phase !== 'lobby' || !FN.ROLES.includes(msg.role)) return;
          const role = msg.role;
          if (role === 'guard' && p.role !== 'guard' &&
            this.players.filter((x) => x.role === 'guard').length >= FN.MAX_GUARDS) return;
          if (FN.CHARS.includes(role) && this.players.some((x) => x.role === role && x.pid !== pid)) return;
          p.role = role;
          this.broadcastLobby();
          break;
        }
        case 'settings':
          if (!this.isHost(pid) || this.phase !== 'lobby') return;
          this.applySettings(msg.settings || {});
          this.broadcastLobby();
          break;
        case 'start':
          if (this.isHost(pid)) this.startGame();
          break;
        case 'lobby':
          if (this.isHost(pid)) this.toLobby();
          break;
      }
    }

    applySettings(s) {
      const cur = this.settings;
      const n = Number(s.night);
      if (n >= 1 && n <= 7) cur.night = n;
      if (FN.LENGTHS[s.length]) cur.length = s.length;
      if (FN.SPEEDS[s.speed]) cur.speed = s.speed;
      if (s.custom) for (const c of FN.CHARS) if (c in s.custom) cur.custom[c] = Math.max(0, Math.min(20, s.custom[c] | 0));
    }

    lobbyState() {
      return {
        t: 'lobby', code: this.code, online: this.online, phase: this.phase, settings: this.settings,
        hostPid: this.localPid,
        players: this.players.map((p) => ({ pid: p.pid, name: p.name, role: p.role })),
      };
    }

    broadcastLobby() { this.broadcast(this.lobbyState()); }

    startGame() {
      if (this.phase === 'playing') return;
      if (!this.players.some((p) => p.role === 'guard')) {
        this.sendTo(this.localPid, { t: 'msg', text: 'Someone has to be the night guard!' });
        return;
      }
      this.phase = 'playing';
      this.sim = new FN.Sim(this.players.map((p) => ({ pid: p.pid, name: p.name, role: p.role })), this.settings);
      this.broadcastLobby();
      this.broadcast({ t: 'start' });
      this.last = performance.now();
      this.ticker = makeTicker(FN.TUNE.tickMs, () => this.step());
    }

    step() {
      const now = performance.now();
      let dt = (now - this.last) / 1000;
      this.last = now;
      // Catch up after hitches in small steps so timers stay fair.
      dt = Math.min(dt, 2);
      while (dt > 0) {
        const d = Math.min(dt, 0.1);
        this.sim.tick(d);
        dt -= d;
      }
      const snap = this.sim.snapshot();
      const events = this.sim.takeEvents();
      for (const p of this.players) {
        const ev = events.filter((e) => this.eventFor(e, p));
        this.sendTo(p.pid, { t: 'snap', s: snap, ev });
      }
      if (this.sim.ended) {
        this.ticker.stop();
        this.ticker = null;
        this.phase = 'results';
        // Like the original: survive a night and the next one is queued up.
        const r = this.sim.result;
        if (r && r.winner === 'guards' && this.settings.night < 6) this.settings.night++;
        this.broadcastLobby();
      }
    }

    eventFor(e, p) {
      if (e.to === 'all' || e.to === p.pid) return true;
      if (e.to === 'guards') return p.role === 'guard' || p.role === 'spectator';
      if (e.to === 'anims') return p.role !== 'guard';
      return false;
    }

    toLobby() {
      if (this.ticker) { this.ticker.stop(); this.ticker = null; }
      this.sim = null;
      this.phase = 'lobby';
      this.broadcastLobby();
    }

    sendTo(pid, msg) {
      const p = this.players.find((x) => x.pid === pid);
      if (!p) return;
      if (!p.conn) { this.onLocal(msg); return; }
      try { if (p.conn.open) p.conn.send(msg); } catch (e) { console.warn('send failed', e); }
    }

    broadcast(msg) { for (const p of this.players) this.sendTo(p.pid, msg); }

    close() {
      if (this.ticker) this.ticker.stop();
      for (const p of this.players) if (p.conn) { try { p.conn.send({ t: 'bye', reason: 'The host closed the room.' }); } catch (e) { /* closing anyway */ } }
      const peer = this.peer;
      setTimeout(() => peer && peer.destroy(), 200);
    }
  }

  // The host's own player: messages go straight into the RoomHost.
  class LocalLink {
    constructor(host) { this.host = host; }
    send(msg) { this.host.handle(this.host.localPid, msg); }
    close() { this.host.close(); }
  }

  // A joining player's connection to a remote host.
  class RemoteLink {
    constructor({ code, name, onMessage, onClose }) {
      this.code = code;
      this.name = cleanName(name);
      this.onMessage = onMessage;
      this.onClose = onClose;
      this.conn = null;
      this.peer = null;
      this.closed = false;
    }

    open() {
      return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (text) => {
          if (settled) return;
          settled = true;
          this.shutdown();
          reject(new Error(text));
        };
        const timer = setTimeout(() => fail('Couldn\'t reach that room. Check the code and try again.'), 15000);
        const peer = (this.peer = new window.Peer(undefined, peerOptions()));
        peer.on('open', () => {
          const conn = (this.conn = peer.connect(FN.PEER_PREFIX + this.code, { reliable: true, serialization: 'json' }));
          conn.on('open', () => conn.send({ t: 'hello', name: this.name, v: FN.PROTOCOL }));
          conn.on('data', (msg) => {
            if (!settled && msg && msg.t === 'welcome') { settled = true; clearTimeout(timer); resolve(); }
            if (!settled && msg && msg.t === 'bye') { clearTimeout(timer); fail(msg.reason); return; }
            this.onMessage(msg);
          });
          conn.on('close', () => {
            if (!settled) { clearTimeout(timer); fail('The host closed the connection.'); return; }
            if (!this.closed) { this.closed = true; this.onClose('Lost connection to the host.'); }
          });
        });
        peer.on('error', (err) => {
          if (!settled) {
            clearTimeout(timer);
            fail(err.type === 'peer-unavailable' ? `No room with code ${this.code}. Check the code with your host.`
              : `Connection problem (${err.type}). Try again.`);
          } else console.warn('peer error', err.type, err);
        });
        peer.on('disconnected', () => { if (!peer.destroyed && !this.closed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500); });
      });
    }

    send(msg) { try { if (this.conn && this.conn.open) this.conn.send(msg); } catch (e) { console.warn('send failed', e); } }

    shutdown() {
      this.closed = true;
      try { if (this.conn) this.conn.close(); } catch (e) { /* already closed */ }
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* already gone */ }
    }

    close() { this.shutdown(); }
  }

  FN.Net = { RoomHost, LocalLink, RemoteLink, cleanName };
})();
