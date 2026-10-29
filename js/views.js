// In-game views. Every player is a night guard (GuardView) sharing one office;
// anyone past the guard limit, or who joins mid-night, gets the SpectatorView.
// Views render from the latest host snapshot and send inputs through app.send().
(function () {
  'use strict';
  const FN = window.FN;
  const Art = FN.Art;
  const A = FN.Audio;
  const W = FN.W, H = FN.H, T = FN.TUNE;
  const { text, ell, rr, poly } = Art;
  const OFF = () => Art.OFFICE;

  const hourLabel = (h) => (h === 0 ? '12 AM' : `${Math.min(6, h)} AM`);
  const nightLabel = (n) => (n === 7 ? 'Custom Night' : `Night ${n}`);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const camName = (room) => (FN.ROOMS[room] ? FN.ROOMS[room].name : room);
  const LOOK_TEXT = { L: 'left door', C: 'the desk', R: 'right door' };
  const PING_TEXT = { L: 'LEFT DOOR!', C: 'HEADS UP!', R: 'RIGHT DOOR!' };

  function hitTest(hits, x, y) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  function button(ctx, hits, b) {
    ctx.fillStyle = b.enabled ? 'rgba(28,28,32,0.85)' : 'rgba(16,16,18,0.7)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = b.enabled ? '#cfcfc8' : '#3e3e42';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    text(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2, b.size || 32, b.enabled ? '#fff' : '#6a6a6a', 'center');
    if (b.enabled) hits.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h });
  }

  function drawClock(ctx, snap) {
    text(ctx, hourLabel(snap.hour), W - 30, 48, 66, '#f2f2ec', 'right');
    text(ctx, nightLabel(snap.night), W - 30, 94, 30, '#cfcfc8', 'right');
  }

  function drawPower(ctx, snap) {
    text(ctx, `Power left: ${Math.max(0, Math.ceil(snap.power))}%`, 30, H - 76, 32, '#f2f2ec');
    text(ctx, 'Usage:', 30, H - 38, 32, '#f2f2ec');
    const cols = ['#4caf3c', '#4caf3c', '#d8c23a', '#e08a2a', '#d23a2a'];
    for (let i = 0; i < Math.min(5, snap.usage); i++) {
      ctx.fillStyle = cols[i];
      ctx.fillRect(122 + i * 26, H - 52, 20, 28);
    }
  }

  // The team list: who's on which camera, who's watching which door.
  function drawTeam(ctx, snap, myPid, y0) {
    const guards = Object.entries(snap.guards);
    if (guards.length < 2 && myPid) return;
    let y = y0;
    text(ctx, 'TEAM', 30, y, 24, '#8d8d86');
    y += 26;
    for (const [pid, g] of guards) {
      ell(ctx, 38, y, 7, 7, g.color || '#ccc');
      const what = g.up ? `CAM ${g.cam}  ${camName(g.cam)}` : LOOK_TEXT[g.look] || 'the office';
      text(ctx, `${g.name}${pid === myPid ? ' (you)' : ''}: ${what}`, 52, y, 24, pid === myPid ? '#f2f2ec' : '#c8d8c0');
      y += 25;
    }
  }

  // Monitor markers for the map: which cameras teammates are on, and live call-outs.
  function mapMarks(snap, myPid, pings, now) {
    const marks = {};
    for (const [pid, g] of Object.entries(snap.guards)) {
      if (!g.up || pid === myPid) continue;
      (marks[g.cam] = marks[g.cam] || []).push(g.color || '#ccc');
    }
    const live = pings.filter((p) => p.cam && now - p.at < T.pingTime).map((p) => ({ cam: p.cam, color: p.color }));
    return { marks, pings: live };
  }

  function drawCallouts(ctx, pings, now) {
    const live = pings.filter((p) => now - p.at < T.pingTime).slice(-3);
    let y = 150;
    for (const p of live) {
      const a = clamp(T.pingTime - (now - p.at), 0, 1);
      ctx.globalAlpha = a;
      const msg = `${p.name.toUpperCase()}: ${p.cam ? `CHECK CAM ${p.cam}!` : PING_TEXT[p.side] || 'HEADS UP!'}`;
      ctx.font = `34px ${Art.FONT}`;
      const w = ctx.measureText(msg).width + 40;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(W / 2 - w / 2, y - 22, w, 44);
      ctx.strokeStyle = p.color || '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(W / 2 - w / 2, y - 22, w, 44);
      text(ctx, msg, W / 2, y, 34, p.color || '#fff', 'center');
      ctx.globalAlpha = 1;
      y += 52;
    }
  }

  // ---------- shared overlays ----------
  const Overlays = {
    intro(ctx, snap) {
      if (snap.t > 4) return;
      const a = snap.t < 3 ? 1 : 1 - (snap.t - 3);
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = a;
      text(ctx, '12:00 AM', W / 2, H / 2 - 30, 72, '#fff', 'center');
      const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th'][snap.night - 1];
      text(ctx, snap.night === 7 ? 'Custom Night' : `${ord} Night`, W / 2, H / 2 + 36, 44, '#fff', 'center');
      const n = Object.keys(snap.guards).length;
      if (n > 1) text(ctx, `${n} guards on shift. The animatronics are restless tonight (+${snap.bonus} AI).`, W / 2, H / 2 + 96, 28, '#a0a098', 'center');
      ctx.globalAlpha = 1;
    },

    jumpscare(ctx, who, k, t) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const shake = 26 * (1 - Math.min(1, k / 1.4)) + 8;
      const scale = 1.4 + Math.min(1, k * 5) * 1.6;
      const jaw = 0.5 + 0.5 * Math.abs(Math.sin(t * 30));
      Art.drawHeadCloseup(ctx, who, W / 2 + (Math.random() - 0.5) * shake, H * 0.58 + (Math.random() - 0.5) * shake,
        scale, jaw, who === 'freddy' ? 'glow' : 'dark', (Math.random() - 0.5) * 0.1);
      Art.staticScreen(ctx, t, 0.12);
    },

    result(ctx, res, k, t, app, hits) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const names = res.guards || [];
      const team = names.length > 1;
      if (res.winner === 'guards') {
        const roll = clamp((k - 1) / 1.6, 0, 1);
        const ease = roll * roll * (3 - 2 * roll);
        ctx.save();
        ctx.beginPath();
        ctx.rect(W / 2 - 160, H / 2 - 120, 140, 150);
        ctx.clip();
        text(ctx, '5', W / 2 - 90, H / 2 - 40 - ease * 170, 140, '#fff', 'center');
        text(ctx, '6', W / 2 - 90, H / 2 - 40 + (1 - ease) * 170, 140, '#fff', 'center');
        ctx.restore();
        text(ctx, 'AM', W / 2 + 40, H / 2 - 40, 140, '#fff', 'center');
        if (k > 3.2) {
          const who = names.length > 2 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names.join(' & ') || 'The guard';
          text(ctx, `${who} survived ${nightLabel(res.night)}!`, W / 2, H / 2 + 90, 40, '#d8c25a', 'center');
        }
      } else if (res.winner === 'anims') {
        if (k < 2.2) Art.staticScreen(ctx, t, 1);
        else {
          Art.staticScreen(ctx, t, 0.18);
          text(ctx, 'Game Over', W - 60, H - 70, 64, '#f2f2ec', 'right');
          const who = FN.CHAR_INFO[res.who] ? FN.CHAR_INFO[res.who].short : 'Something';
          if (res.powerOut) text(ctx, 'The power ran out...', W / 2, H / 2 - 60, 34, '#a0a098', 'center');
          text(ctx, `${who} got ${team ? 'the whole team' : names[0] || 'the guard'}.`, W / 2, H / 2, 46, '#e04a3a', 'center');
          text(ctx, `Made it to ${hourLabel(Math.floor(res.t / (app.snap ? app.snap.hourLen : 89)))}.`, W / 2, H / 2 + 50, 32, '#cfcfc8', 'center');
        }
      } else {
        text(ctx, res.reason || 'The night was abandoned.', W / 2, H / 2, 40, '#cfcfc8', 'center');
      }
      if (k > (res.winner === 'guards' ? 3.2 : 2.4)) {
        if (app.isHost) button(ctx, hits, { id: 'lobby', x: W / 2 - 160, y: H - 190, w: 320, h: 64, label: 'Back to lobby', enabled: true });
        else text(ctx, 'Waiting for the host...', W / 2, H - 158, 30, '#8d8d86', 'center');
      }
    },
  };

  // ======================= GUARD =======================
  class GuardView {
    constructor(app) {
      this.app = app;
      this.scroll = (OFF().W - W) / 2;
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
      const max = OFF().W - W;
      this.scroll = clamp(this.scroll, 0, max);
      // Tell the team which way we're looking (only when it changes).
      const look = this.scroll < max * 0.3 ? 'L' : this.scroll > max * 0.7 ? 'R' : 'C';
      if (look !== this.look) { this.look = look; this.sendMon(); }
      this.flickT -= dt;
      if (powered && this.flickT < -2 && Math.random() < dt * 0.25) this.flickT = 0.05 + Math.random() * 0.15;
      this.dim = this.flickT > 0 ? 0.4 : 0;
    }

    occupant(room) {
      const snap = this.app.snap;
      return FN.CHARS.find((c) => c !== 'foxy' && snap.anims[c].room === room) || null;
    }

    draw(ctx, t) {
      const snap = this.app.snap;
      this.hits = [];
      if (this.monK < 1) {
        const inv = FN.CHARS.find((c) => c !== 'foxy' && snap.anims[c].room === 'OF');
        const po = snap.powerOut;
        const v = {
          t, door: this.door,
          light: { L: this.lightOn('L'), R: this.lightOn('R') },
          doorway: { L: this.occupant('LD'), R: this.occupant('RD') },
          invader: inv && !this.mon ? { who: inv, side: snap.anims[inv].side || 'R' } : null,
          fan: this.fan,
          power: po ? po.phase : 'on',
          flash: po && po.phase === 'music' && Math.sin(t * 9) > 0.1 && Math.random() > 0.08,
          dim: this.dim,
        };
        Art.blitOffice(ctx, Art.renderOffice(v), this.scroll);
        if (this.monK > 0) this.drawTablet(ctx, t);
        else this.drawPingArrows(ctx, t);
      } else {
        this.drawCams(ctx, t);
      }
      if (snap.powerOut && snap.powerOut.phase === 'dark') return;
      drawClock(ctx, snap);
      drawTeam(ctx, snap, this.app.pid, this.monK >= 1 ? 100 : 60);
      drawCallouts(ctx, this.app.pings, this.app.t);
      if (!snap.powerOut) {
        drawPower(ctx, snap);
        this.drawBar(ctx);
        if (Object.keys(snap.guards).length > 1) button(ctx, this.hits, { id: 'ping', x: 30, y: H - 156, w: 190, h: 42, label: 'CALL OUT (F)', size: 26, enabled: true });
      }
    }

    // Arrows at the edge of the office pointing at a door a teammate just called out.
    drawPingArrows(ctx, t) {
      const now = this.app.t;
      for (const p of this.app.pings) {
        if (p.cam || p.side === 'C' || now - p.at > T.pingTime || Math.sin(t * 10) < 0) continue;
        const x = p.side === 'L' ? 40 : W - 40;
        const d = p.side === 'L' ? -1 : 1;
        poly(ctx, [[x + d * 22, H / 2], [x - d * 14, H / 2 - 34], [x - d * 14, H / 2 + 34]], p.color || '#fff');
      }
    }

    drawTablet(ctx, t) {
      const k = this.monK;
      const y = H - H * 1.05 * k;
      ctx.fillStyle = '#1a1b1e';
      rr(ctx, 30, y, W - 60, H, 26);
      ctx.fill();
      ctx.fillStyle = '#060807';
      rr(ctx, 60, y + 30, W - 120, H - 60, 12);
      ctx.fill();
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(Art.noiseTex[Math.floor(t * 30) % 6], 60, y + 30, W - 120, H - 60);
      ctx.restore();
    }

    drawCams(ctx, t) {
      const snap = this.app.snap;
      const pan = 0.5 + 0.5 * Math.sin(t * 0.3 + this.panPhase);
      Art.drawRoom(ctx, this.cam, snap, pan, t);
      const since = this.app.t - this.camT;
      let glitch = since < 0.3 ? 1 - since / 0.3 : 0;
      if (snap.glitch[this.cam]) glitch = Math.max(glitch, 0.95);
      Art.camEffects(ctx, t, glitch);
      if (Math.floor(t * 1.5) % 2) ell(ctx, 52, 52, 13, 13, '#d01a10');
      text(ctx, 'REC', 76, 54, 30, '#f0f0e8');
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeRect(24, 24, W - 48, H - 48);
      text(ctx, camName(this.cam), 1060, 318, 36, '#f2f2ec', 'center');
      const mm = mapMarks(snap, this.app.pid, this.app.pings, this.app.t);
      this.hits.push(...Art.drawMap(ctx, 860, 340, { cam: this.cam, marks: mm.marks, pings: mm.pings, t }));
    }

    drawBar(ctx) {
      const b = { x: 250, y: 668, w: 660, h: 40 };
      ctx.fillStyle = this.mon ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      for (const dx of [-12, 12]) {
        for (const dy of [0, 10]) {
          const cx = b.x + b.w / 2 + dx * 2, cy = b.y + 14 + dy;
          const d = this.mon ? -6 : 6;
          ctx.beginPath();
          ctx.moveTo(cx - 12, cy + d);
          ctx.lineTo(cx, cy - d);
          ctx.lineTo(cx + 12, cy + d);
          ctx.stroke();
        }
      }
      this.bar = b;
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
          this.scroll = clamp(this.drag.scroll - (x - this.drag.x), 0, OFF().W - W);
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
      const [wx, wy] = Art.officePoint(x, y, this.scroll);
      const O = OFF();
      for (const s of ['L', 'R']) {
        const px = O.PANEL[s];
        const r = O.BTN.r + 12;
        if (Math.hypot(wx - px, wy - O.BTN.door) < r) { this.pressDoor(s); return; }
        if (Math.hypot(wx - px, wy - O.BTN.light) < r) { this.pressLight(s); return; }
      }
      if (Math.hypot(wx - O.NOSE.x, wy - O.NOSE.y) < O.NOSE.r + 6) A.play('honk');
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
      this.scroll = (OFF().W - W) / 2;
      this.mx = W / 2;
      A.loop('ambience', true, 0.4);
    }

    update(dt) {
      if (this.cam !== 'OF') return;
      const edge = 330;
      if (this.mx < edge) this.scroll -= ((edge - this.mx) / edge) * 900 * dt;
      if (this.mx > W - edge) this.scroll += ((this.mx - (W - edge)) / edge) * 900 * dt;
      this.scroll = clamp(this.scroll, 0, OFF().W - W);
    }

    onSnap() {}

    draw(ctx, t) {
      const snap = this.app.snap;
      this.hits = [];
      if (this.cam === 'OF') {
        const po = snap.powerOut;
        const inv = FN.CHARS.find((c) => c !== 'foxy' && snap.anims[c].room === 'OF');
        const occ = (room) => FN.CHARS.find((c) => c !== 'foxy' && snap.anims[c].room === room) || null;
        Art.blitOffice(ctx, Art.renderOffice({
          t, door: { L: snap.doors.L ? 1 : 0, R: snap.doors.R ? 1 : 0 }, light: snap.lights,
          doorway: { L: occ('LD'), R: occ('RD') }, invader: inv ? { who: inv, side: snap.anims[inv].side || 'R' } : null,
          fan: t * 26, power: po ? po.phase : 'on', flash: po && po.phase === 'music' && Math.sin(t * 9) > 0.1, dim: 0,
        }), this.scroll);
      } else {
        Art.drawRoom(ctx, this.cam, snap, 0.5 + 0.5 * Math.sin(t * 0.3), t);
        const since = this.app.t - this.camT;
        Art.camEffects(ctx, t, Math.max(since < 0.3 ? 1 - since / 0.3 : 0, snap.glitch[this.cam] ? 0.9 : 0));
      }
      drawClock(ctx, snap);
      if (!snap.powerOut) drawPower(ctx, snap);
      text(ctx, 'SPECTATING', 30, 64, 34, '#d8c25a');
      drawTeam(ctx, snap, null, 100);
      drawCallouts(ctx, this.app.pings, this.app.t);
      const y = 100 + 26 * (Object.keys(snap.guards).length + 1);
      button(ctx, this.hits, { id: 'office', x: 30, y: y + 6, w: 180, h: 46, label: 'VIEW OFFICE', size: 26, enabled: this.cam !== 'OF' });
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(850, 300, 420, 410);
      text(ctx, this.cam === 'OF' ? 'The Office' : camName(this.cam), 1060, 318, 32, '#f2f2ec', 'center');
      const mm = mapMarks(snap, null, this.app.pings, this.app.t);
      this.hits.push(...Art.drawMap(ctx, 860, 340, { cam: this.cam, marks: mm.marks, pings: mm.pings, t }));
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

  FN.Views = { GuardView, SpectatorView, Overlays, hitTest };
})();
