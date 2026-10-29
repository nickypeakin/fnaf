// App shell: menus, lobby, connecting/hosting, input routing and the render loop.
(function () {
  'use strict';
  const FN = window.FN;
  const Art = FN.Art;
  const A = FN.Audio;
  const V = FN.Views;
  const W = FN.W, H = FN.H;
  const $ = (id) => document.getElementById(id);

  const App = {
    link: null, host: null, isHost: false, pid: null, lobby: null,
    screen: 'menu', view: null, role: null, snap: null,
    t: 0, feed: [], js: null, resultAt: null, resultHits: [],
    send(msg) { if (this.link) this.link.send(msg); },
  };
  FN.App = App;

  // ---------------- helpers ----------------
  function toast(msg, error) {
    const d = document.createElement('div');
    d.className = 'toast' + (error ? ' error' : '');
    d.textContent = msg;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 4000);
  }

  function setStatus(id, msg, error) {
    const el = $(id);
    el.textContent = msg || '';
    el.classList.toggle('error', !!error);
  }

  function showScreen(name) {
    App.screen = name;
    $('menu').classList.toggle('hidden', name !== 'menu');
    $('lobby').classList.toggle('hidden', name !== 'lobby');
    $('ingame').classList.toggle('hidden', name !== 'game');
    checkRotate();
  }

  function getName() {
    const n = FN.Net.cleanName($('name').value);
    try { localStorage.setItem('fnaf-name', n); } catch (e) { /* storage blocked */ }
    return n;
  }

  function checkRotate() {
    const portraitTouch = window.innerHeight > window.innerWidth && matchMedia('(pointer: coarse)').matches;
    $('rotate').classList.toggle('hidden', !(portraitTouch && App.screen === 'game'));
  }

  // ---------------- connection lifecycle ----------------
  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        App.pid = msg.pid;
        showScreen('lobby');
        break;
      case 'lobby':
        App.lobby = msg;
        renderLobby();
        if (msg.phase === 'lobby' && App.screen === 'game') backToLobby();
        break;
      case 'start':
        startGameView(!!msg.late);
        break;
      case 'snap':
        onSnap(msg.s, msg.ev || []);
        break;
      case 'msg':
        toast(msg.text);
        setStatus('lobby-status', msg.text, true);
        break;
      case 'bye':
        leave(msg.reason);
        break;
    }
  }

  async function createRoom(online) {
    A.init();
    if (online && !window.Peer) {
      setStatus('menu-status', 'The multiplayer library didn\'t load. Check your connection and refresh.', true);
      return;
    }
    setStatus('menu-status', online ? 'Opening a room...' : '');
    const host = new FN.Net.RoomHost({ name: getName(), online, onLocal: (m) => queueMicrotask(() => onMessage(m)) });
    App.host = host;
    App.isHost = true;
    App.link = new FN.Net.LocalLink(host);
    try {
      await host.open();
      setStatus('menu-status', '');
    } catch (err) {
      App.host = null;
      App.link = null;
      App.isHost = false;
      setStatus('menu-status', `Couldn't open an online room (${err.type || err.message}). Solo still works.`, true);
    }
  }

  async function joinRoom() {
    A.init();
    const code = $('join-code').value.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 5) { setStatus('menu-status', 'Room codes are 5 letters.', true); return; }
    if (!window.Peer) { setStatus('menu-status', 'The multiplayer library didn\'t load. Check your connection and refresh.', true); return; }
    setStatus('menu-status', `Connecting to ${code}...`);
    $('btn-join').disabled = true;
    const link = new FN.Net.RemoteLink({ code, name: getName(), onMessage, onClose: (reason) => leave(reason) });
    App.link = link;
    App.isHost = false;
    try {
      await link.open();
      setStatus('menu-status', '');
    } catch (err) {
      if (App.link === link) App.link = null;
      setStatus('menu-status', err.message, true);
    } finally {
      $('btn-join').disabled = false;
    }
  }

  function leave(reason) {
    const l = App.link;
    App.link = null;
    if (l) { try { l.close(); } catch (e) { /* already closed */ } }
    Object.assign(App, { host: null, isHost: false, pid: null, lobby: null, snap: null, view: null, js: null, resultAt: null });
    A.stopAll();
    showScreen('menu');
    if (reason) { setStatus('menu-status', reason, true); toast(reason, true); }
  }

  // ---------------- game lifecycle ----------------
  function startGameView(late) {
    const me = App.lobby && App.lobby.players.find((p) => p.pid === App.pid);
    const role = late || !me ? 'spectator' : me.role;
    A.stopAll();
    Object.assign(App, { snap: null, js: null, resultAt: null, feed: [], role });
    if (role === 'guard') App.view = new V.GuardView(App);
    else if (FN.CHARS.includes(role)) App.view = new V.AnimView(App, role);
    else App.view = new V.SpectatorView(App);
    showScreen('game');
    if (late) toast('A night is already underway. You\'re spectating until the next one.');
  }

  function backToLobby() {
    A.stopAll();
    Object.assign(App, { view: null, snap: null, js: null, resultAt: null });
    showScreen('lobby');
  }

  function onSnap(s, events) {
    if (App.screen !== 'game' || !App.view) return;
    App.snap = s;
    App.view.onSnap(s);
    for (const e of events) handleEvent(e);
  }

  function handleEvent(e) {
    switch (e.k) {
      case 'jumpscare':
        App.js = { who: e.who, at: App.t };
        A.stopAll();
        A.play('jumpscare');
        return;
      case 'sixam':
        A.stopAll();
        A.play('chime');
        return;
      case 'feed':
        App.feed.push({ msg: e.msg, at: App.t });
        if (App.feed.length > 30) App.feed.shift();
        return;
      case 'msg':
        toast(e.msg);
        return;
      case 'end':
        return;
    }
    App.view.onEvent(e);
  }

  // ---------------- lobby UI ----------------
  const ROLE_ORDER = ['guard', 'bonnie', 'chica', 'foxy', 'freddy', 'spectator'];
  const ROLE_BLURB = {
    guard: 'Survive until 6 AM. Watch the cameras, check the lights, and shut the doors when something is there. Two guards can share the office.',
    spectator: 'Watch the night unfold. Flip through every camera and the office.',
  };

  function fillSelect(sel, entries) {
    sel.innerHTML = '';
    for (const [value, label] of entries) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    }
  }

  function renderLobby() {
    const L = App.lobby;
    if (!L) return;
    const me = L.players.find((p) => p.pid === App.pid);
    const myRole = me ? me.role : 'spectator';
    $('lobby-label').textContent = L.online ? 'ROOM CODE' : 'SOLO NIGHT';
    $('lobby-code').textContent = L.online ? L.code : 'SOLO';
    $('btn-copy').classList.toggle('hidden', !L.online);
    $('roles-wrap').classList.toggle('hidden', !L.online);
    $('speed-field').classList.toggle('hidden', !L.online);

    const roles = $('roles');
    roles.innerHTML = '';
    for (const role of ROLE_ORDER) {
      const holders = L.players.filter((p) => p.role === role);
      const isChar = FN.CHARS.includes(role);
      const full = (role === 'guard' && holders.length >= FN.MAX_GUARDS) || (isChar && holders.length > 0);
      const btn = document.createElement('button');
      btn.className = 'role' + (role === myRole ? ' mine' : '') + (full && role !== myRole ? ' full' : '');
      const title = document.createElement('div');
      title.className = 'rname';
      if (isChar) {
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = FN.CHAR_INFO[role].color;
        title.appendChild(sw);
      }
      title.appendChild(document.createTextNode(role === 'guard' ? 'Night Guard' : role === 'spectator' ? 'Spectate' : FN.CHAR_INFO[role].short));
      btn.appendChild(title);
      const who = document.createElement('div');
      who.className = 'who';
      if (!holders.length) {
        const s = document.createElement('span');
        s.className = 'ai';
        s.textContent = isChar ? 'AI controlled' : role === 'guard' ? 'Empty' : '-';
        who.appendChild(s);
      }
      holders.forEach((p, i) => {
        const s = document.createElement('span');
        if (p.pid === App.pid) s.className = 'me';
        s.textContent = p.name + (p.pid === L.hostPid ? ' (host)' : '');
        who.appendChild(s);
        if (i < holders.length - 1) who.appendChild(document.createTextNode(', '));
      });
      if (role === 'guard') who.appendChild(document.createTextNode(` (${holders.length}/${FN.MAX_GUARDS})`));
      btn.appendChild(who);
      btn.addEventListener('click', () => { if (role !== myRole) App.send({ t: 'role', role }); });
      roles.appendChild(btn);
    }
    $('role-blurb').textContent = ROLE_BLURB[myRole] || (FN.CHAR_INFO[myRole] ? FN.CHAR_INFO[myRole].blurb : '');

    const S = L.settings;
    const sets = { 'set-night': String(S.night), 'set-length': S.length, 'set-speed': S.speed };
    for (const [id, v] of Object.entries(sets)) {
      const el = $(id);
      el.disabled = !App.isHost;
      if (document.activeElement !== el) el.value = v;
    }
    const custom = $('custom');
    custom.classList.toggle('hidden', S.night !== 7);
    if (!custom.children.length) {
      for (const c of FN.CHARS) {
        const lab = document.createElement('label');
        lab.className = 'field';
        lab.innerHTML = `<span>${FN.CHAR_INFO[c].short} AI (0-20)</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = 0;
        inp.max = 20;
        inp.id = 'ai-' + c;
        inp.addEventListener('change', () => sendSettings());
        lab.appendChild(inp);
        custom.appendChild(lab);
      }
    }
    for (const c of FN.CHARS) {
      const el = $('ai-' + c);
      el.disabled = !App.isHost;
      if (document.activeElement !== el) el.value = S.custom[c];
    }
    $('btn-start').classList.toggle('hidden', !App.isHost);
    const hasGuard = L.players.some((p) => p.role === 'guard');
    $('btn-start').disabled = !hasGuard || L.phase !== 'lobby';
    if (!App.isHost) setStatus('lobby-status', L.phase === 'lobby' ? 'Waiting for the host to start the night...' : 'A night is in progress...');
    else setStatus('lobby-status', hasGuard ? '' : 'Someone needs to be the Night Guard.');
  }

  function sendSettings() {
    if (!App.isHost) return;
    const custom = {};
    for (const c of FN.CHARS) custom[c] = Number($('ai-' + c).value) || 0;
    App.send({
      t: 'settings',
      settings: { night: Number($('set-night').value), length: $('set-length').value, speed: $('set-speed').value, custom },
    });
  }

  function inviteLink() {
    const u = new URL(location.href);
    u.searchParams.set('join', App.lobby.code);
    return u.toString();
  }

  // ---------------- render loop ----------------
  const cv = $('game');
  const ctx = cv.getContext('2d');
  let last = performance.now();
  let menuEyes = { dark: false, until: 0 };

  function drawBackdrop(t) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (t > menuEyes.until) menuEyes = { dark: Math.random() < 0.18, until: t + (Math.random() < 0.2 ? 0.12 : 0.6 + Math.random() * 2) };
    const flicker = Math.random() < 0.06 ? 0.4 : 1;
    Art.drawHeadCloseup(ctx, 'freddy', 900 + Math.sin(t * 0.4) * 10, 430, 1.7, 0, menuEyes.dark ? 'dark' : 'normal', Math.sin(t * 0.3) * 0.03);
    ctx.fillStyle = `rgba(0,0,0,${flicker < 1 ? 0.9 : 0.62})`;
    ctx.fillRect(0, 0, W, H);
    Art.staticScreen(ctx, t, 0.12 + Math.random() * 0.06);
    const g = ctx.createLinearGradient(0, 0, W * 0.6, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawGame(dt) {
    const snap = App.snap;
    const t = App.t;
    if (App.js && t - App.js.at < FN.TUNE.jumpscareTime + 0.1) {
      V.Overlays.jumpscare(ctx, App.js.who, t - App.js.at, t);
      return;
    }
    if (snap.result) {
      if (App.resultAt == null) App.resultAt = t;
      const k = t - App.resultAt;
      A.loop('heavystatic', snap.result.winner === 'anims' && k < 2.2, 0.5);
      App.resultHits = [];
      V.Overlays.result(ctx, snap.result, k, t, App, App.resultHits);
      return;
    }
    App.view.update(dt);
    App.view.draw(ctx, t);
    V.Overlays.intro(ctx, snap, t);
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    App.t = now / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    try {
      if (App.screen === 'game' && App.view) {
        if (App.snap) drawGame(dt);
        else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); Art.text(ctx, 'Connecting to the night...', W / 2, H / 2, 36, '#888', 'center'); }
      } else drawBackdrop(App.t);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(frame);
  }

  // ---------------- input ----------------
  function toGame(e) {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  }

  function dispatch(type, e) {
    if (App.screen !== 'game' || !App.snap || !App.view) return;
    const [x, y] = toGame(e);
    if (App.snap.result) {
      if (type === 'up') {
        const h = V.hitTest(App.resultHits, x, y);
        if (h && h.id === 'lobby') App.send({ t: 'lobby' });
      }
      return;
    }
    if (App.js) return;
    App.view.pointer(type, x, y, e);
  }

  cv.addEventListener('pointerdown', (e) => { A.init(); dispatch('down', e); });
  cv.addEventListener('pointermove', (e) => dispatch('move', e));
  cv.addEventListener('pointerup', (e) => dispatch('up', e));
  cv.addEventListener('pointerleave', (e) => dispatch('leave', e));
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    A.init();
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (App.screen !== 'game' || !App.view || !App.snap || App.snap.result || App.js) return;
    if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
    if (e.repeat) return;
    if (App.view.key(e)) e.preventDefault();
  });

  function toggleMute() {
    A.setMuted(!A.isMuted());
    $('btn-mute').classList.toggle('off', A.isMuted());
  }

  // ---------------- DOM wiring ----------------
  fillSelect($('set-length'), Object.entries(FN.LENGTHS).map(([k, v]) => [k, v.label]));
  fillSelect($('set-speed'), Object.entries(FN.SPEEDS).map(([k, v]) => [k, v.label]));
  for (const id of ['set-night', 'set-length', 'set-speed']) $(id).addEventListener('change', sendSettings);

  try { $('name').value = localStorage.getItem('fnaf-name') || ''; } catch (e) { /* storage blocked */ }
  const q = new URLSearchParams(location.search);
  if (q.get('join')) {
    $('join-code').value = q.get('join').toUpperCase().slice(0, 5);
    setStatus('menu-status', 'Enter your name and press Join.');
  }

  $('btn-solo').addEventListener('click', () => createRoom(false));
  $('btn-host').addEventListener('click', () => createRoom(true));
  $('btn-join').addEventListener('click', joinRoom);
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('btn-help').addEventListener('click', () => $('help').classList.toggle('hidden'));
  $('btn-help-close').addEventListener('click', () => $('help').classList.add('hidden'));
  $('btn-leave').addEventListener('click', () => leave());
  $('btn-start').addEventListener('click', () => { A.init(); App.send({ t: 'start' }); });
  $('btn-copy').addEventListener('click', async () => {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied!');
    } catch (e) {
      window.prompt('Copy this invite link:', link);
    }
  });
  $('btn-mute').addEventListener('click', toggleMute);
  $('btn-mute').classList.toggle('off', A.isMuted());
  $('btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  $('btn-quit').addEventListener('click', () => {
    if (window.confirm(App.isHost && App.lobby && App.lobby.online ? 'Leave? This closes the room for everyone.' : 'Leave this game?')) leave();
  });
  window.addEventListener('resize', checkRotate);
  window.addEventListener('beforeunload', (e) => {
    if (App.isHost && App.lobby && App.lobby.online && App.lobby.players.length > 1) { e.preventDefault(); e.returnValue = ''; }
  });

  // Wait briefly for the pixel font so pre-rendered text uses it.
  const fontReady = document.fonts && document.fonts.load
    ? Promise.race([document.fonts.load('30px VT323'), new Promise((r) => setTimeout(r, 2000))]).catch(() => {})
    : Promise.resolve();
  fontReady.then(() => {
    Art.init();
    requestAnimationFrame(frame);
  });
})();
