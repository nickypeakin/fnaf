// In-game views. Every player is a night guard (GuardView) sharing one office;
// anyone past the guard limit, or who joins mid-night, gets the SpectatorView.
// Views read the latest host snapshot and update the page elements in #stage
// (plain images and divs, no canvas), and send inputs through app.send().
(function () {
  'use strict';
  const FN = window.FN;
  const A = FN.Audio;
  const L = FN.LAYOUT;
  const W = FN.W, H = FN.H, T = FN.TUNE;
  const { OFFICE, SPRITE, MAP } = L;

  const hourLabel = (h) => (h === 0 ? '12 AM' : `${Math.min(6, h)} AM`);
  const nightLabel = (n) => (n === 7 ? 'Custom Night' : `Night ${n}`);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const camName = (room) => (FN.ROOMS[room] ? FN.ROOMS[room].name : room);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LOOK_TEXT = { L: 'left door', C: 'the desk', R: 'right door' };
  const PING_TEXT = { L: 'LEFT DOOR!', C: 'HEADS UP!', R: 'RIGHT DOOR!' };
  const OFFICE_MAX = OFFICE.W - W;

  // ---------- cheap DOM updates: only touch the page when a value actually changes ----------
  const $ = (id) => document.getElementById(id);
  const memo = (el) => el._m || (el._m = {});
  function set(el, prop, val) { const m = memo(el); if (m[prop] !== val) { m[prop] = val; el.style[prop] = val; } }
  function vis(el, on) { const m = memo(el); if (m.vis !== on) { m.vis = on; el.classList.toggle('hidden', !on); } }
  function cls(el, name, on) { const m = memo(el); if (m['c' + name] !== on) { m['c' + name] = on; el.classList.toggle(name, on); } }
  function text(el, s) { const m = memo(el); if (m.text !== s) { m.text = s; el.textContent = s; } }
  function html(el, s) { const m = memo(el); if (m.html !== s) { m.html = s; el.innerHTML = s; } }
  // Show image `name` (or hide the element when name is null).
  function img(el, name) {
    const m = memo(el);
    if (name && m.src !== name) { m.src = name; el.src = FN.Assets.url(name); }
    set(el, 'display', name ? 'block' : 'none');
  }
  // Place a character image with its feet at (x, y).
  function sprite(el, name, x, y, scale) {
    img(el, name);
    if (name) set(el, 'transform', `translate(${(x - SPRITE.ox * scale).toFixed(1)}px, ${(y - SPRITE.oy * scale).toFixed(1)}px) scale(${scale.toFixed(3)})`);
  }

  function hitTest(hits, x, y) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  // ---------- the scene: office, cameras, map and HUD elements ----------
  let E = null;
  const Scene = {
    init() {
      if (E) return;
      const side = (f) => ({ L: f('L'), R: f('R') });
      E = {
        office: $('office'), officeWorld: $('office-world'), officeBg: $('office-bg'),
        dwImg: side((s) => $('dw-' + s).querySelector('.dw-img')),
        dwShutter: side((s) => $('dw-' + s).querySelector('.dw-shutter')),
        btnDoor: side((s) => $('btn-door-' + s)), btnLight: side((s) => $('btn-light-' + s)),
        spill: side((s) => $('spill-' + s)), screens: [$('scr-0'), $('scr-1')],
        fanBlades: $('fan-blades'), fanCage: $('fan-cage'), invader: $('invader'),
        dim: $('office-dim'), po: $('office-po'), poFreddy: $('po-freddy'),
        cams: $('cams'), camWorld: $('cam-world'), camBg: $('cam-bg'), camDisabled: $('cam-disabled'),
        cc: { freddy: $('cc-freddy'), bonnie: $('cc-bonnie'), chica: $('cc-chica') },
        covePeekClip: $('cove-peek-clip'), covePeek: $('cove-peek'), coveOut: $('cove-out'),
        curtain: side((s) => $('curtain-' + s)), foxyRun: $('foxy-run'),
        camVignette: $('cam-vignette'), camNoise: $('cam-noise'), camBars: $('cam-bars'), camName: $('cam-name'), map: $('map'),
        tablet: $('tablet'), hud: $('hud'), clockHour: $('clock-hour'), clockNight: $('clock-night'),
        team: $('team'), specLabel: $('spec-label'), specOffice: $('spec-office'), callouts: $('callouts'),
        arrow: side((s) => $('arrow-' + s)), btnPing: $('btn-ping'), power: $('power'), powerVal: $('power-val'),
        usage: $('usage'), monBar: $('mon-bar'),
      };
      img(E.officeBg, 'office');
      img(E.fanBlades, 'fan-blades');
      img(E.fanCage, 'fan-cage');
      for (const s of ['L', 'R']) { img(E.dwShutter[s], 'shutter'); img(E.curtain[s], 'curtain'); }
      for (let i = 0; i < 6; i++) E.camBars.appendChild(document.createElement('div'));
      // Map: rooms, then camera buttons on top.
      let h = '';
      for (const [id, [x, y, w, hh]] of Object.entries(MAP.rooms)) {
        const kind = id === 'LD' || id === 'RD' ? ' door' : id === 'OF' ? ' office' : '';
        h += `<div class="mroom${kind}" style="left:${x}px;top:${y}px;width:${w}px;height:${hh}px">${id === 'OF' ? 'YOU' : ''}</div>`;
      }
      for (const [cam, [x, y]] of Object.entries(MAP.cams)) {
        h += `<div class="mcam" data-cam="${cam}" style="left:${x}px;top:${y}px"><b>CAM</b><i>${cam}</i><div class="marks"></div></div>`;
      }
      E.map.innerHTML = h;
      E.mcam = {};
      for (const el of E.map.querySelectorAll('.mcam')) E.mcam[el.dataset.cam] = { el, marks: el.querySelector('.marks') };
    },

    // withMap keeps the camera layer (and its map) visible over the office, for spectators.
    show(which, withMap) {
      vis(E.office, which === 'office');
      vis(E.cams, which === 'cams' || !!withMap);
    },

    // v: {scroll, door:{L,R} 0..1, light:{L,R}, doorway:{L,R}, invader, fan, power:'on'|'out'|'music'|'dark', flash, dim}
    office(v) {
      set(E.officeWorld, 'transform', `translateX(${-Math.round(v.scroll)}px)`);
      const powered = v.power === 'on';
      for (const s of ['L', 'R']) {
        const lit = powered && v.light[s];
        const who = v.doorway[s];
        const known = (s === 'L' && who === 'bonnie') || (s === 'R' && who === 'chica');
        img(E.dwImg[s], lit ? `door-${s}-${known ? who : 'lit'}` : null);
        set(E.dwShutter[s], 'transform', `translateY(${Math.round((v.door[s] - 1) * (OFFICE.DOOR.bot - OFFICE.DOOR.top))}px)`);
        cls(E.btnDoor[s], 'on', powered && v.door[s] > 0.5);
        cls(E.btnLight[s], 'on', lit);
        set(E.spill[s], 'opacity', lit ? '1' : '0');
      }
      for (const el of E.screens) set(el, 'display', powered ? 'block' : 'none');
      set(E.fanBlades, 'transform', `rotate(${(v.fan % (Math.PI * 2)).toFixed(2)}rad)`);
      if (v.invader) {
        const [x, y, s] = OFFICE.INVADER[v.invader.side];
        sprite(E.invader, L.spriteName(v.invader.who, 'stand', ...L.INVADER_LOOK), x, y, s);
      } else img(E.invader, null);
      set(E.dim, 'opacity', v.power === 'dark' ? '1' : powered ? String(v.dim) : '0');
      set(E.po, 'display', !powered && v.power !== 'dark' ? 'block' : 'none');
      img(E.poFreddy, v.power === 'music' ? (v.flash ? 'door-L-freddy-on' : 'door-L-freddy-off') : null);
    },

    // What a camera in `room` sees.
    cams(room, snap, pan, glitch, t, title, mapOpts) {
      set(E.camWorld, 'transform', `translateX(${-Math.round(pan * (L.ROOM_W - W))}px)`);
      const disabled = room === '6';
      set(E.camWorld, 'display', disabled ? 'none' : 'block');
      set(E.camDisabled, 'display', disabled ? 'block' : 'none');
      if (!disabled) img(E.camBg, 'room-' + room);
      const spots = L.SPOTS[room] || {};
      for (const who of ['freddy', 'bonnie', 'chica']) {
        const spot = spots[who];
        if (spot && snap.anims[who].room === room) sprite(E.cc[who], L.spriteName(who, 'stand', spot[3], spot[4]), spot[0], spot[1], spot[2]);
        else img(E.cc[who], null);
      }
      const foxy = snap.anims.foxy;
      const cove = room === '1C';
      const stage = foxy.runT >= 0 ? 3 : foxy.stage;
      set(E.covePeekClip, 'display', cove && stage === 1 ? 'block' : 'none');
      if (cove && stage === 1) {
        const [who, x, y, s, eyes, light] = L.COVE.peek;
        sprite(E.covePeek, L.spriteName(who, 'stand', eyes, light), x - L.COVE.rect[0], y - L.COVE.rect[1], s);
      }
      if (cove && stage === 2) {
        const [who, x, y, s, eyes, light] = L.COVE.out;
        sprite(E.coveOut, L.spriteName(who, 'stand', eyes, light), x, y, s);
      } else img(E.coveOut, null);
      const [cx, , cw] = L.COVE.rect;
      const half = (cw - L.COVE.gaps[stage]) / 2;
      for (const s of ['L', 'R']) {
        set(E.curtain[s], 'display', cove ? 'block' : 'none');
        set(E.curtain[s], 'width', `${half}px`);
        set(E.curtain[s], 'left', `${s === 'L' ? cx : cx + cw - half}px`);
      }
      if (room === '2A' && foxy.runT >= 0) {
        const k = Math.min(1, foxy.runT / T.foxyRunTime);
        const [who, pose, eyes, light] = L.FOXY_RUN;
        sprite(E.foxyRun, L.spriteName(who, pose, eyes, light), 740 + Math.sin(t * 30) * 8, 520 + k * k * 560, 0.3 + k * k * 1.4);
      } else img(E.foxyRun, null);
      const [lx, ly, dark] = L.ROOM_LIGHT[room] || [740, 360, 0.6];
      set(E.camVignette, 'background', `radial-gradient(circle at ${lx}px ${ly}px, rgba(0,0,0,0) 120px, rgba(0,0,0,${dark + 0.25}) 900px)`);
      set(E.camNoise, 'opacity', (0.1 + Math.random() * 0.06 + glitch * 0.85).toFixed(2));
      const bars = glitch > 0.3;
      set(E.camBars, 'display', bars ? 'block' : 'none');
      if (bars) {
        for (const b of E.camBars.children) {
          b.style.top = `${Math.random() * H}px`;
          b.style.height = `${4 + Math.random() * 30}px`;
          b.style.opacity = (Math.random() * 0.25).toFixed(2);
        }
      }
      text(E.camName, title);
      this.map(mapOpts);
    },

    // The camera map: selected camera, teammates' cameras and live call-outs.
    map(o) {
      for (const [cam, m] of Object.entries(E.mcam)) {
        cls(m.el, 'sel', cam === o.cam);
        const ping = o.pings.find((p) => p.cam === cam);
        cls(m.el, 'ping', !!ping);
        if (ping) set(m.el, 'outlineColor', ping.color || '#fff');
        html(m.marks, (o.marks[cam] || []).map((c) => `<span style="background:${c}"></span>`).join(''));
      }
    },

    tablet(k) {
      vis(E.tablet, k > 0 && k < 1);
      if (k > 0 && k < 1) set(E.tablet, 'transform', `translateY(${Math.round(H - H * 1.05 * k)}px)`);
    },

    hud(o) {
      vis(E.hud, true);
      const snap = o.snap;
      text(E.clockHour, hourLabel(snap.hour));
      text(E.clockNight, nightLabel(snap.night));
      set(E.power, 'display', o.power ? 'block' : 'none');
      text(E.powerVal, String(Math.max(0, Math.ceil(snap.power))));
      const cols = ['#4caf3c', '#4caf3c', '#d8c23a', '#e08a2a', '#d23a2a'];
      html(E.usage, cols.slice(0, Math.min(5, snap.usage)).map((c) => `<span style="background:${c}"></span>`).join(''));
      set(E.monBar, 'display', o.bar ? 'block' : 'none');
      cls(E.monBar, 'up', !!o.mon);
      vis(E.btnPing, !!o.ping);
      vis(E.specLabel, !!o.spectating);
      // Team list
      const guards = Object.entries(snap.guards);
      let team = '';
      if (o.spectating || guards.length > 1) {
        team = '<div class="t-head">TEAM</div>' + guards.map(([pid, g]) => {
          const what = g.up ? `CAM ${g.cam}  ${camName(g.cam)}` : LOOK_TEXT[g.look] || 'the office';
          const me = pid === o.myPid;
          return `<div class="${me ? 't-me' : 't-mate'}"><span class="t-dot" style="background:${g.color || '#ccc'}"></span>${esc(g.name)}${me ? ' (you)' : ''}: ${esc(what)}</div>`;
        }).join('');
      }
      html(E.team, team);
      set(E.team, 'top', `${o.teamTop}px`);
      set(E.team, 'display', o.showTeam === false ? 'none' : 'block');
      // Call-outs fade out over their last second.
      const now = o.now;
      const live = o.pings.filter((p) => now - p.at < T.pingTime).slice(-3);
      html(E.callouts, live.map((p) => {
        const a = clamp(T.pingTime - (now - p.at), 0, 1).toFixed(2);
        const msg = `${p.name.toUpperCase()}: ${p.cam ? `CHECK CAM ${p.cam}!` : PING_TEXT[p.side] || 'HEADS UP!'}`;
        return `<div style="color:${p.color || '#fff'};opacity:${a}">${esc(msg)}</div>`;
      }).join(''));
      for (const s of ['L', 'R']) {
        const p = o.arrows ? live.filter((q) => !q.cam && q.side === s).pop() : null;
        set(E.arrow[s], 'display', p && Math.sin(o.t * 10) > 0 ? 'block' : 'none');
        if (p) set(E.arrow[s], 'color', p.color || '#fff');
      }
    },

    hideHud() { vis(E.hud, false); },
  };

  // Map camera buttons as hit boxes in stage coordinates.
  function camHits() {
    return Object.entries(MAP.cams).map(([cam, [x, y]]) => ({ cam, x: MAP.x + x, y: MAP.y + y, w: 50, h: 32 }));
  }

  function mapMarks(snap, myPid, pings, now) {
    const marks = {};
    for (const [pid, g] of Object.entries(snap.guards)) {
      if (!g.up || pid === myPid) continue;
      (marks[g.cam] = marks[g.cam] || []).push(g.color || '#ccc');
    }
    return { marks, pings: pings.filter((p) => p.cam && now - p.at < T.pingTime) };
  }

  // ---------- full-screen overlays ----------
  const Overlays = {
    intro(snap) {
      const el = $('intro');
      const on = snap.t <= 4;
      vis(el, on);
      if (!on) return;
      set(el, 'opacity', String(snap.t < 3 ? 1 : clamp(1 - (snap.t - 3), 0, 1)));
      const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th'][snap.night - 1];
      text($('intro-night'), snap.night === 7 ? 'Custom Night' : `${ord} Night`);
      const n = Object.keys(snap.guards).length;
      text($('intro-team'), n > 1 ? `${n} guards on shift. The animatronics are restless tonight (+${snap.bonus} AI).` : '');
    },

    jumpscare(who, k, t) {
      vis($('jumpscare'), true);
      const head = $('js-head');
      const eyes = who === 'freddy' ? 'glow' : 'dark';
      img(head, L.headName(who, Math.abs(Math.sin(t * 30)) > 0.75 ? 'b' : 'a', eyes));
      const shake = 26 * (1 - Math.min(1, k / 1.4)) + 8;
      const scale = (1.4 + Math.min(1, k * 5) * 1.6) / L.HEAD.scale;
      const dx = W / 2 - L.HEAD.cx + (Math.random() - 0.5) * shake;
      const dy = H * 0.58 - L.HEAD.cy + (Math.random() - 0.5) * shake;
      set(head, 'transform', `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${((Math.random() - 0.5) * 0.1).toFixed(3)}rad)`);
    },

    result(res, k, app, hits) {
      const el = $('result');
      vis(el, true);
      const names = res.guards || [];
      const win = res.winner === 'guards';
      const lost = res.winner === 'anims';
      cls(el, 'win', win);
      const noise = $('res-noise');
      set(noise, 'display', lost ? 'block' : 'none');
      set(noise, 'opacity', lost && k < 2.2 ? '1' : '0.18');
      vis($('res-clock'), win);
      const reveal = k > (win ? 3.2 : 2.4);
      if (win) {
        const roll = clamp((k - 1) / 1.6, 0, 1);
        const ease = roll * roll * (3 - 2 * roll);
        set($('res-5'), 'transform', `translateY(${(-ease * 170).toFixed(1)}px)`);
        set($('res-6'), 'transform', `translateY(${((1 - ease) * 170).toFixed(1)}px)`);
        const who = names.length > 2 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names.join(' & ') || 'The guard';
        text($('res-pre'), '');
        text($('res-main'), k > 3.2 ? `${who} survived ${nightLabel(res.night)}!` : '');
        text($('res-sub'), '');
      } else if (lost) {
        const after = k >= 2.2;
        const who = FN.CHAR_INFO[res.who] ? FN.CHAR_INFO[res.who].short : 'Something';
        text($('res-pre'), after && res.powerOut ? 'The power ran out...' : '');
        text($('res-main'), after ? `${who} got ${names.length > 1 ? 'the whole team' : names[0] || 'the guard'}.` : '');
        text($('res-sub'), after ? `Made it to ${hourLabel(Math.floor(res.t / (app.snap ? app.snap.hourLen : 89)))}.` : '');
      } else {
        text($('res-pre'), '');
        text($('res-main'), res.reason || 'The night was abandoned.');
        text($('res-sub'), '');
      }
      vis($('res-gameover'), lost && k >= 2.2);
      vis($('res-btn'), reveal && app.isHost);
      vis($('res-wait'), reveal && !app.isHost);
      if (reveal && app.isHost) hits.push({ id: 'lobby', x: 480, y: 530, w: 320, h: 64 });
    },

    // Hide every in-game element (when leaving the game or showing the menu).
    clear() {
      for (const id of ['office', 'cams', 'tablet', 'hud', 'intro', 'jumpscare', 'result', 'loading']) vis($(id), false);
    },
  };

  // ======================= GUARD =======================
  class GuardView {
    constructor(app) {
      this.app = app;
      this.scroll = OFFICE_MAX / 2;
      this.mon = false;
      this.monK = 0;
      this.cam = '1A';
      this.camT = -10;
      this.look = 'C';
      this.door = { L: 0, R: 0 };
      this.pend = {};
      this.shown = { L: false, R: false };
      this.fan = 0;
      this.armed = true;
      this.mouse = { x: W / 2, y: H / 2, inside: false, type: 'mouse' };
      this.drag = null;
      this.hits = [];
      this.dim = 0;
      this.flickT = 0;
      this.panPhase = Math.random() * 6;
      A.loop('fan', true, 0.55);
      A.loop('ambience', true, 0.45);
    }

    // Local prediction: show our own door/light presses instantly, then defer to the host.
    doorOn(s) { const p = this.pend['door' + s]; return p ? p.v : this.app.snap.doors[s]; }
    lightOn(s) { const p = this.pend['light' + s]; return p ? p.v : this.app.snap.lights[s]; }

    onSnap(snap) {
      const now = performance.now();
      for (const key of Object.keys(this.pend)) {
        const p = this.pend[key];
        const s = key.slice(-1);
        const actual = key.startsWith('door') ? snap.doors[s] : snap.lights[s];
        if (actual === p.v || now - p.at > 900) delete this.pend[key];
      }
    }

    blocked() { const s = this.app.snap; return !!(s.powerOut || s.jumpscare || s.ended); }

    // The buttons are on the wall: you can only reach them with your monitor down.
    canReach() { return !this.blocked() && !this.mon && this.monK === 0; }

    pressDoor(s) {
      if (!this.canReach()) return;
      if (this.app.snap.broken[s]) { A.play('dud', { pan: s === 'L' ? -0.6 : 0.6 }); return; }
      const v = !this.doorOn(s);
      this.pend['door' + s] = { v, at: performance.now() };
      this.app.send({ t: 'in', a: 'door', side: s, on: v });
    }

    pressLight(s) {
      if (!this.canReach()) return;
      if (this.app.snap.broken[s]) { A.play('dud', { pan: s === 'L' ? -0.6 : 0.6 }); return; }
      const v = !this.lightOn(s);
      this.pend['light' + s] = { v, at: performance.now() };
      const o = s === 'L' ? 'R' : 'L';
      if (v && this.lightOn(o)) this.pend['light' + o] = { v: false, at: performance.now() };
      this.app.send({ t: 'in', a: 'light', side: s, on: v });
      A.play('click');
    }

    setMon(up) {
      if (up === this.mon) return;
      if (up && this.blocked()) return;
      this.mon = up;
      A.play(up ? 'camUp' : 'camDown');
      if (up) this.camT = this.app.t;
      this.sendMon();
    }

    setCam(cam) {
      if (cam === this.cam) return;
      this.cam = cam;
      this.camT = this.app.t;
      A.play('blip');
      this.sendMon();
    }

    sendMon() { this.app.send({ t: 'in', a: 'mon', up: this.mon, cam: this.cam, look: this.look }); }

    ping() {
      if (this.blocked() || Object.keys(this.app.snap.guards).length < 2) return;
      this.app.send({ t: 'in', a: 'ping' });
    }

    update(dt) {
      const snap = this.app.snap;
      if (this.blocked() && this.mon) { this.mon = false; this.monK = Math.min(this.monK, 0.99); }
      this.monK = clamp(this.monK + ((this.mon ? 1 : -1) * dt) / 0.22, 0, 1);
      const powered = !snap.powerOut;
      for (const s of ['L', 'R']) {
        const on = powered && this.doorOn(s);
        this.door[s] = clamp(this.door[s] + ((on ? 1 : -1) * dt) / 0.18, 0, 1);
        if (on !== this.shown[s]) { this.shown[s] = on; A.play('door', { pan: s === 'L' ? -0.7 : 0.7 }); }
      }
      const lit = powered && (this.lightOn('L') || this.lightOn('R'));
      A.loop('buzz', lit && this.monK < 1, 0.5);
      A.loop('static', powered && this.monK >= 1, 0.35);
      A.loop('heavystatic', powered && this.monK >= 1 && !!snap.glitch[this.cam], 0.25);
      if (powered) this.fan += dt * 26;
      if (!this.mon && this.mouse.inside && this.mouse.type === 'mouse') {
        const x = this.mouse.x, edge = 330;
        if (x < edge) this.scroll -= ((edge - x) / edge) * 950 * dt;
        if (x > W - edge) this.scroll += ((x - (W - edge)) / edge) * 950 * dt;
      }
      this.scroll = clamp(this.scroll, 0, OFFICE_MAX);
      // Tell the team which way we're looking (only when it changes).
      const look = this.scroll < OFFICE_MAX * 0.3 ? 'L' : this.scroll > OFFICE_MAX * 0.7 ? 'R' : 'C';
      if (look !== this.look) { this.look = look; this.sendMon(); }
      this.flickT -= dt;
      if (powered && this.flickT < -2 && Math.random() < dt * 0.25) this.flickT = 0.05 + Math.random() * 0.15;
      this.dim = this.flickT > 0 ? 0.4 : 0;
    }

    occupant(room) {
      const snap = this.app.snap;
      return FN.CHARS.find((c) => c !== 'foxy' && snap.anims[c].room === room) || null;
    }

    draw(t) {
      const snap = this.app.snap;
      this.hits = [];
      const onCams = this.monK >= 1;
      const po = snap.powerOut;
      Scene.show(onCams ? 'cams' : 'office');
      if (!onCams) {
        const inv = FN.CHARS.find((c) => c !== 'foxy' && snap.anims[c].room === 'OF');
        Scene.office({
          scroll: this.scroll, door: this.door,
          light: { L: this.lightOn('L'), R: this.lightOn('R') },
          doorway: { L: this.occupant('LD'), R: this.occupant('RD') },
          invader: inv && !this.mon ? { who: inv, side: snap.anims[inv].side || 'R' } : null,
          fan: this.fan,
          power: po ? po.phase : 'on',
          flash: po && po.phase === 'music' && Math.sin(t * 9) > 0.1 && Math.random() > 0.08,
          dim: this.dim,
        });
      } else {
        const since = this.app.t - this.camT;
        let glitch = since < 0.3 ? 1 - since / 0.3 : 0;
        if (snap.glitch[this.cam]) glitch = Math.max(glitch, 0.95);
        const mm = mapMarks(snap, this.app.pid, this.app.pings, this.app.t);
        Scene.cams(this.cam, snap, 0.5 + 0.5 * Math.sin(t * 0.3 + this.panPhase), glitch, t, camName(this.cam), { cam: this.cam, ...mm });
        this.hits.push(...camHits());
      }
      Scene.tablet(this.monK);
      if (po && po.phase === 'dark') { Scene.hideHud(); return; }
      const team = Object.keys(snap.guards).length > 1;
      Scene.hud({
        snap, myPid: this.app.pid, pings: this.app.pings, now: this.app.t, t,
        power: !po, bar: !po, mon: this.mon, ping: team && !po, teamTop: onCams ? 84 : 48, arrows: !onCams && this.monK === 0,
      });
      if (team && !po) this.hits.push({ id: 'ping', x: 30, y: 564, w: 190, h: 42 });
      this.bar = po ? null : { x: 250, y: 668, w: 660, h: 40 };
    }

    inBar(x, y) { const b = this.bar; return b && x >= b.x && x <= b.x + b.w && y >= b.y - 10 && y <= b.y + b.h + 10; }

    pointer(type, x, y, e) {
      this.mouse.x = x;
      this.mouse.y = y;
      this.mouse.inside = type !== 'leave';
      if (e && e.pointerType) this.mouse.type = e.pointerType;
      const snap = this.app.snap;
      if (snap.jumpscare || snap.ended) return;
      const touch = this.mouse.type !== 'mouse';
      if (type === 'move') {
        if (!touch && !snap.powerOut) {
          const inBar = this.inBar(x, y);
          if (inBar && this.armed) { this.armed = false; this.setMon(!this.mon); }
          if (!inBar) this.armed = true;
        }
        if (this.drag && !this.mon) {
          this.scroll = clamp(this.drag.scroll - (x - this.drag.x), 0, OFFICE_MAX);
          if (Math.abs(x - this.drag.x) > 12) this.drag.moved = true;
        }
        return;
      }
      if (type === 'down') {
        if (touch) this.drag = { x, scroll: this.scroll, moved: false };
        return;
      }
      if (type !== 'up') return;
      const wasDrag = this.drag && this.drag.moved;
      this.drag = null;
      if (wasDrag) return;
      if (touch && this.inBar(x, y) && !snap.powerOut) { this.setMon(!this.mon); return; }
      const h = hitTest(this.hits, x, y);
      if (h && h.id === 'ping') { this.ping(); return; }
      if (this.mon) {
        if (h && h.cam) this.setCam(h.cam);
        return;
      }
      if (this.monK > 0) return;
      const wx = this.scroll + x, wy = y;
      for (const s of ['L', 'R']) {
        const px = OFFICE.PANEL[s];
        const r = OFFICE.BTN.r + 12;
        if (Math.hypot(wx - px, wy - OFFICE.BTN.door) < r) { this.pressDoor(s); return; }
        if (Math.hypot(wx - px, wy - OFFICE.BTN.light) < r) { this.pressLight(s); return; }
      }
      if (Math.hypot(wx - OFFICE.NOSE.x, wy - OFFICE.NOSE.y) < OFFICE.NOSE.r + 6) A.play('honk');
    }

    key(e) {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 's') { this.setMon(!this.mon); return true; }
      if (k === 'f') { this.ping(); return true; }
      if (k === 'q') { this.pressDoor('L'); return true; }
      if (k === 'e') { this.pressDoor('R'); return true; }
      if (k === 'a') { this.pressLight('L'); return true; }
      if (k === 'd') { this.pressLight('R'); return true; }
      if (this.mon && (k === 'arrowright' || k === 'arrowleft')) {
        const i = FN.CAMS.indexOf(this.cam);
        const n = FN.CAMS.length;
        this.setCam(FN.CAMS[(i + (k === 'arrowright' ? 1 : n - 1)) % n]);
        return true;
      }
      return false;
    }

    onEvent(e) {
      switch (e.k) {
        case 'steps': A.play('steps', { pan: e.side === 'L' ? -0.8 : 0.8, vol: e.vol }); break;
        case 'laugh': A.play('laugh', { vol: 0.35 }); break;
        case 'kitchen': A.play('kitchen', { vol: this.mon && this.cam === '6' ? 0.9 : 0.22 }); break;
        case 'groan': A.play('groan', { pan: e.side === 'L' ? -0.7 : 0.7 }); break;
        case 'run': A.play('run'); break;
        case 'bang': A.play('bang'); break;
        case 'powerout':
          A.play('powerout');
          A.loop('fan', false);
          A.loop('buzz', false);
          A.loop('static', false);
          A.loop('heavystatic', false);
          break;
        case 'music': A.loop('music', true, 0.8); break;
        case 'musicstop': A.loop('music', false); break;
      }
    }
  }

  // ======================= SPECTATOR =======================
  class SpectatorView {
    constructor(app) {
      this.app = app;
      this.cam = 'OF';
      this.camT = -10;
      this.hits = [];
      this.scroll = OFFICE_MAX / 2;
      this.mx = W / 2;
      A.loop('ambience', true, 0.4);
    }

    update(dt) {
      if (this.cam !== 'OF') return;
      const edge = 330;
      if (this.mx < edge) this.scroll -= ((edge - this.mx) / edge) * 900 * dt;
      if (this.mx > W - edge) this.scroll += ((this.mx - (W - edge)) / edge) * 900 * dt;
      this.scroll = clamp(this.scroll, 0, OFFICE_MAX);
    }

    onSnap() {}

    draw(t) {
      const snap = this.app.snap;
      this.hits = camHits();
      const po = snap.powerOut;
      const inOffice = this.cam === 'OF';
      Scene.show(inOffice ? 'office' : 'cams', true);
      const mm = mapMarks(snap, null, this.app.pings, this.app.t);
      if (inOffice) {
        const inv = FN.CHARS.find((c) => c !== 'foxy' && snap.anims[c].room === 'OF');
        const occ = (room) => FN.CHARS.find((c) => c !== 'foxy' && snap.anims[c].room === room) || null;
        Scene.office({
          scroll: this.scroll, door: { L: snap.doors.L ? 1 : 0, R: snap.doors.R ? 1 : 0 }, light: snap.lights,
          doorway: { L: occ('LD'), R: occ('RD') }, invader: inv ? { who: inv, side: snap.anims[inv].side || 'R' } : null,
          fan: t * 26, power: po ? po.phase : 'on', flash: po && po.phase === 'music' && Math.sin(t * 9) > 0.1, dim: 0,
        });
        // The map still shows over the office so spectators can jump to any camera.
        set(E.camWorld, 'display', 'none');
        set(E.camDisabled, 'display', 'none');
        for (const id of ['cam-noise', 'cam-bars', 'cam-scan', 'cam-roll', 'cam-vig2', 'cam-frame', 'rec']) set($(id), 'display', 'none');
        text(E.camName, 'The Office');
        Scene.map({ cam: null, ...mm });
      } else {
        for (const id of ['cam-noise', 'cam-scan', 'cam-roll', 'cam-vig2', 'cam-frame', 'rec']) set($(id), 'display', 'block');
        const since = this.app.t - this.camT;
        const glitch = Math.max(since < 0.3 ? 1 - since / 0.3 : 0, snap.glitch[this.cam] ? 0.9 : 0);
        Scene.cams(this.cam, snap, 0.5 + 0.5 * Math.sin(t * 0.3), glitch, t, camName(this.cam), { cam: this.cam, ...mm });
      }
      Scene.tablet(0);
      Scene.hud({ snap, myPid: null, pings: this.app.pings, now: this.app.t, t, power: !po, bar: false, spectating: true, teamTop: 84, arrows: false });
      const y = 84 + 25 * (Object.keys(snap.guards).length + 1) + 10;
      vis(E.specOffice, !inOffice);
      set(E.specOffice, 'top', `${y}px`);
      if (!inOffice) this.hits.push({ id: 'office', x: 30, y, w: 180, h: 46 });
    }

    pointer(type, x, y) {
      this.mx = x;
      if (type !== 'up') return;
      const h = hitTest(this.hits, x, y);
      if (!h) return;
      this.cam = h.cam || 'OF';
      this.camT = this.app.t;
      A.play('blip');
    }

    key() { return false; }

    onEvent(e) {
      if (['steps', 'laugh', 'kitchen', 'groan', 'run', 'bang'].includes(e.k)) GuardView.prototype.onEvent.call({ mon: false, cam: this.cam }, e);
      if (e.k === 'music') A.loop('music', true, 0.6);
      if (e.k === 'musicstop') A.loop('music', false);
    }
  }

  // Leaving the spectator's office view hides some camera chrome; put it back for guards.
  function resetCamChrome() {
    for (const id of ['cam-noise', 'cam-scan', 'cam-roll', 'cam-vig2', 'cam-frame', 'rec']) set($(id), 'display', 'block');
    if (E) { vis(E.specOffice, false); vis(E.specLabel, false); }
  }

  FN.Views = { GuardView, SpectatorView, Overlays, Scene, hitTest, resetCamChrome, util: { set, vis, img, text } };
})();
