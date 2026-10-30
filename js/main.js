// Boot, menus, settings, world list, hosting and joining, pause and death screens.
(function (G) {
  'use strict';
  const MC = G.MC;
  const $ = (id) => document.getElementById(id);

  // ---------------- settings ----------------
  const DEFAULTS = { dist: 6, fov: 70, sens: 100, gamma: 50, vol: 70, scale: 100, bob: true, invert: false, name: '' };
  let settings = { ...DEFAULTS };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('blockcraft-settings') || '{}')); } catch (e) { /* storage blocked */ }
  if (!settings.name) settings.name = 'Player' + Math.floor(100 + Math.random() * 900);
  const saveSettings = () => { try { localStorage.setItem('blockcraft-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } };
  // smaller default view on phones
  if (matchMedia('(pointer: coarse)').matches) settings.dist = Math.min(settings.dist, 4);
  let game = null;

  // ---------------- menus ----------------
  let current = 'menu-title';
  function show(id) {
    for (const m of document.querySelectorAll('.menu')) m.classList.toggle('hidden', m.id !== id);
    current = id;
    if (game) game.menuOpen = !!id;
    if (id === 'menu-single') refreshWorlds();
    if (id === 'menu-settings') { fillSettings(); $('menu-settings').classList.toggle('solo', !(game && game.running)); }
    if (id === 'menu-multi') $('mp-name').value = settings.name;
  }
  function hideMenus() { show(null); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    if (b.id === 'btn-host-pick') { hostPick = true; settings.name = $('mp-name').value.trim() || settings.name; saveSettings(); }
    else if (b.dataset.go === 'menu-single' && b.closest('#menu-title')) hostPick = false;
    show(b.dataset.go);
  });
  const SPLASH = ['Caves & Cliffs!', 'Now with goats!', 'Axolotls!', 'Mind the dripstone!', `${MC.Recipes.CRAFT.length} recipes!`, 'Play with friends!', 'Dig deeper!', 'Copper ages!', 'Lush caves!', 'Amethyst geodes!', 'Deepslate!', 'Tall mountains!'];
  $('splash').textContent = SPLASH[Math.floor(Math.random() * SPLASH.length)];

  function errorScreen(msg) { $('error-msg').textContent = msg; show('menu-error'); }

  // ---------------- renderer ----------------
  // "Fast" draws with WebGL. "Compatible" draws everything in JavaScript and shows each frame as a
  // plain image, for browsers or privacy tools that block WebGL and canvas. "Auto" tries WebGL,
  // checks that it really draws, and otherwise switches to compatible graphics.
  const canvas = $('game');
  const gfxParam = new URLSearchParams(location.search).get('gfx');
  const gfx = ['auto', 'fast', 'compat'].includes(gfxParam) ? gfxParam : settings.gfx || 'auto';
  let renderer = null;
  if (gfx === 'fast' || (gfx === 'auto' && !settings.webglBlocked)) {
    try {
      const r = new MC.Renderer(canvas);
      if (r.selfTest()) renderer = r;
      else r.dispose();
    } catch (e) { renderer = null; }
    if (!renderer && gfx === 'auto') { settings.webglBlocked = true; saveSettings(); }
  }
  if (!renderer) {
    canvas.remove();
    $('view').classList.remove('hidden');
    renderer = new MC.SoftRenderer($('view'));
    if (!settings.compatSetup) { settings.compatSetup = true; settings.dist = Math.min(settings.dist, 4); settings.scale = Math.min(settings.scale, 80); saveSettings(); }
  }
  $('gfx-note').textContent = renderer.software ? 'Graphics: compatible mode (no WebGL needed)' : 'Graphics: fast (WebGL)';
  const audio = new MC.Audio();
  audio.setVolume(settings.vol / 100);
  game = new MC.Game(renderer, audio, settings);
  G.blockcraft = game; // handy for debugging from the console
  let hostPick = false;
  let worldRecord = null;

  renderer.loadTextures().catch((e) => errorScreen('Could not load textures: ' + e.message));

  // ---------------- world list ----------------
  async function refreshWorlds() {
    const list = $('world-list');
    list.innerHTML = '<p class="hint">Loading…</p>';
    const worlds = await MC.Save.list();
    list.innerHTML = '';
    if (hostPick) { const h = document.createElement('p'); h.className = 'hint'; h.textContent = 'Pick a world to host. Friends can join with the room code you get.'; list.appendChild(h); }
    if (!worlds.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No worlds yet. Create one!'; list.appendChild(p); }
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'world';
      const when = w.played ? new Date(w.played).toLocaleString() : '';
      row.innerHTML = `<div class="meta"><span></span><small></small></div>`;
      row.querySelector('span').textContent = w.name;
      row.querySelector('small').textContent = `${w.mode === 'creative' ? 'Creative' : 'Survival'} · seed ${w.seed} · ${when}`;
      const play = document.createElement('button'); play.textContent = hostPick ? 'Host' : 'Play'; play.className = 'primary';
      play.onclick = (e) => { e.stopPropagation(); playWorld(w.id, hostPick); };
      const host = document.createElement('button'); host.textContent = 'Host'; host.title = 'Play with friends';
      host.onclick = (e) => { e.stopPropagation(); playWorld(w.id, true); };
      const del = document.createElement('button'); del.textContent = '✖'; del.title = 'Delete world';
      del.onclick = async (e) => { e.stopPropagation(); if (confirm(`Delete "${w.name}" forever?`)) { await MC.Save.remove(w.id); refreshWorlds(); } };
      row.appendChild(play);
      if (!hostPick) row.appendChild(host);
      row.appendChild(del);
      row.ondblclick = () => playWorld(w.id, hostPick);
      list.appendChild(row);
    }
    if (!(await MC.Save.persistent)) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Browser storage is blocked, so worlds will not be saved after you close this tab.'; list.appendChild(p); }
  }

  $('btn-create').onclick = async () => {
    const name = $('new-name').value.trim() || 'New World';
    const seedText = $('new-seed').value.trim();
    const seed = seedText ? MC.seedFromString(seedText) : (Math.random() * 2 ** 31) | 0;
    const rec = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, seed, mode: $('new-mode').value, difficulty: +$('new-diff').value, created: Date.now() };
    await MC.Save.put(rec);
    playWorld(rec.id, $('new-host').checked || hostPick);
  };

  async function playWorld(id, host) {
    audio.unlock();
    const rec = await MC.Save.get(id);
    if (!rec) { errorScreen('That world could not be loaded.'); return; }
    worldRecord = rec;
    showLoading('Loading world…');
    let net = null;
    if (host) {
      try { net = await MC.Net.host(null, rec.players || {}); }
      catch (e) { errorScreen(e.message + ' You can still play this world on your own.'); return; }
    }
    startGame({ id: rec.id, name: rec.name, seed: rec.seed, mode: rec.mode, difficulty: rec.difficulty, data: rec.player || rec.edits ? rec : null, net });
  }

  function startGame(info) {
    game.onLoaded = () => { hideMenus(); game.requestPointer(); };
    game.onPause = () => pause();
    game.onDeath = (msg) => { $('death-msg').textContent = msg; show('menu-death'); };
    game.onAutosave = () => save();
    game.onDisconnect = (msg) => { quit(false); errorScreen(msg); };
    if (info.net) info.net.game = game;
    game.start(info);
    if (info.net) info.net.game = game;
    updateRoomBadge();
    loadingLoop();
  }

  function showLoading(title) { $('loading-title').textContent = title; $('loading-bar').style.width = '0%'; $('loading-msg').textContent = ''; show('menu-loading'); }
  function loadingLoop() {
    if (current !== 'menu-loading' || !game.running) return;
    if (game.player.frozen) {
      $('loading-title').textContent = 'Building terrain…';
      $('loading-bar').style.width = Math.round((game.loadProgress || 0) * 100) + '%';
      const secs = (performance.now() - game.loadStart) / 1000;
      $('loading-msg').textContent = secs > 12 ? 'This is taking a while — lowering the render distance in Options helps on slower computers.' : '';
      requestAnimationFrame(loadingLoop);
    }
  }

  function updateRoomBadge() {
    const b = $('room-badge');
    if (game.net) {
      b.textContent = game.isHost ? `Room code: ${game.net.code}` : `In ${game.net.code}`;
      b.classList.remove('hidden');
      $('pause-room').textContent = game.isHost ? `Friends can join with room code ${game.net.code} (Multiplayer → Join Room).` : `Playing in room ${game.net.code}.`;
      $('btn-open-lan').classList.add('hidden');
    } else {
      b.classList.add('hidden');
      $('pause-room').textContent = '';
      $('btn-open-lan').classList.remove('hidden');
    }
  }

  // ---------------- saving ----------------
  async function save() {
    if (!game.running || !game.isHost || !worldRecord) return;
    const data = game.saveData();
    Object.assign(worldRecord, data);
    try { await MC.Save.put(worldRecord); } catch (e) { console.warn('save failed', e); }
  }
  window.addEventListener('beforeunload', () => { if (game.running) save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game.running) save(); });

  // ---------------- pause ----------------
  let pausedAt = 0;
  function pause() {
    if (!game.running || game.dead) return;
    game.paused = true;
    pausedAt = performance.now();
    show('menu-pause');
  }
  $('btn-resume').onclick = () => { game.paused = false; hideMenus(); game.requestPointer(); };
  $('btn-quit').onclick = () => quit(true);
  $('btn-pause-settings').onclick = () => show('menu-settings');
  $('btn-open-lan').onclick = async () => {
    if (game.net) return;
    $('btn-open-lan').disabled = true;
    try {
      const net = await MC.Net.host(null, (worldRecord && worldRecord.players) || {});
      net.game = game;
      game.net = net;
      game.myId = net.id;
      updateRoomBadge();
      game.ui.chat(`Your world is open! Room code: ${net.code}`, '#5f5');
    } catch (e) { $('pause-room').textContent = e.message; }
    $('btn-open-lan').disabled = false;
  };
  async function quit(doSave) {
    if (doSave) await save();
    if (game.net) { game.net.close(); game.net = null; }
    game.stop();
    worldRecord = null;
    hostPick = false;
    show('menu-title');
  }
  $('btn-respawn').onclick = () => { game.respawn(); hideMenus(); show('menu-loading'); showLoading('Respawning…'); loadingLoop(); };
  $('btn-death-quit').onclick = () => quit(true);

  // ---------------- joining ----------------
  $('btn-join').onclick = async () => {
    const code = $('join-code').value.trim().toUpperCase();
    settings.name = ($('mp-name').value.trim() || settings.name).slice(0, 16);
    saveSettings();
    if (code.length < 4) { $('mp-status').textContent = 'Type the room code your friend sees on their screen.'; return; }
    $('mp-status').textContent = 'Connecting…';
    $('btn-join').disabled = true;
    audio.unlock();
    try {
      const { net, welcome } = await MC.Net.join(code, settings.name);
      showLoading('Joining ' + (welcome.worldName || 'world') + '…');
      settings.name = welcome.name;
      worldRecord = null;
      startGame({
        guest: true, net, seed: welcome.seed, mode: (welcome.you && welcome.you.mode) || welcome.mode, difficulty: welcome.difficulty, name: welcome.worldName,
        data: { edits: welcome.edits, tiles: welcome.tiles, time: welcome.time, spawn: welcome.spawn }, you: welcome.you,
      });
      $('mp-status').textContent = '';
    } catch (e) { $('mp-status').textContent = e.message; }
    $('btn-join').disabled = false;
  };
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
  // ?join=CODE in the link jumps straight to the join screen
  const qp = new URLSearchParams(location.search);
  if (qp.get('join')) { $('join-code').value = qp.get('join').toUpperCase(); show('menu-multi'); }

  // ---------------- settings ----------------
  const S = [
    ['s-dist', 'dist', (v) => `${v} chunks`], ['s-fov', 'fov', (v) => `${v}°`], ['s-sens', 'sens', (v) => `${v}%`],
    ['s-gamma', 'gamma', (v) => (v < 10 ? 'Moody' : v > 90 ? 'Bright' : `${v}%`)], ['s-vol', 'vol', (v) => `${v}%`], ['s-scale', 'scale', (v) => `${v}%`],
  ];
  function fillSettings() {
    for (const [id, key, fmt] of S) { $(id).value = settings[key]; $('v-' + id.slice(2)).textContent = fmt(settings[key]); }
    $('s-gfx').value = settings.gfx || 'auto';
    $('v-gfx').textContent = '';
    $('s-bob').checked = settings.bob !== false;
    $('s-invert').checked = !!settings.invert;
  }
  for (const [id, key, fmt] of S) {
    $(id).addEventListener('input', () => {
      settings[key] = +$(id).value;
      $('v-' + id.slice(2)).textContent = fmt(settings[key]);
      if (key === 'vol') audio.setVolume(settings.vol / 100);
      if (key === 'dist' && game.world) { game.world.renderDist = settings.dist; game.world.lastCenter = null; }
      saveSettings();
    });
  }
  $('s-bob').onchange = () => { settings.bob = $('s-bob').checked; saveSettings(); };
  $('s-gfx').onchange = () => {
    settings.gfx = $('s-gfx').value;
    if (settings.gfx !== 'compat') settings.webglBlocked = false;
    saveSettings();
    if (game.running) $('v-gfx').textContent = '(after you return to the title and reload)';
    else location.reload();
  };
  $('gfx-switch').onclick = (e) => {
    e.preventDefault();
    settings.gfx = renderer.software ? 'fast' : 'compat';
    settings.webglBlocked = false;
    saveSettings();
    location.href = location.pathname;
  };
  $('gfx-switch').textContent = renderer.software ? 'Try fast graphics' : 'Screen black? Use compatible graphics';
  $('s-invert').onchange = () => { settings.invert = $('s-invert').checked; saveSettings(); };
  $('btn-settings-done').onclick = () => show(game.running ? 'menu-pause' : 'menu-title');

  // Esc closes sub menus
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (current === 'menu-pause') { if (performance.now() - pausedAt > 400) $('btn-resume').click(); return; }
    if (current && !game.running && current !== 'menu-title' && current !== 'menu-error') show('menu-title');
    else if (current === 'menu-settings' && game.running) show('menu-pause');
  });

  show('menu-title');
})(globalThis);
