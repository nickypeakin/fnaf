// In-game views. Each player sees one of: GuardView (the office + cameras),
// AnimView (an animatronic hunting the guard) or SpectatorView.
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

  function hitTest(hits, x, y) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  function button(ctx, hits, b) {
    ctx.fillStyle = b.enabled ? (b.hot ? 'rgba(150,26,18,0.9)' : 'rgba(28,28,32,0.9)') : 'rgba(16,16,18,0.75)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = b.enabled ? (b.hot ? '#ffb0a0' : '#cfcfc8') : '#3e3e42';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    text(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 - (b.sub ? 9 : 0), b.size || 32, b.enabled ? '#fff' : '#6a6a6a', 'center');
    if (b.sub) text(ctx, b.sub, b.x + b.w / 2, b.y + b.h - 15, 19, b.enabled ? '#e0d0c0' : '#6a6a6a', 'center');
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

  function watchedCams(snap) {
    return Object.values(snap.guards).filter((g) => g.up && !snap.glitch[g.cam]).map((g) => g.cam);
  }

  function eyeIcon(ctx, x, y, s, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(-40 * s, 0);
    ctx.quadraticCurveTo(0, -34 * s, 40 * s, 0);
    ctx.quadraticCurveTo(0, 34 * s, -40 * s, 0);
    ctx.fillStyle = '#f2eee0';
    ctx.fill();
    ell(ctx, 0, 0, 14 * s, 14 * s, '#b01e14');
    ell(ctx, 0, 0, 6 * s * (0.8 + 0.2 * Math.sin(t * 6)), 6 * s, '#000');
    ctx.restore();
  }

  // ---------- shared overlays ----------
  const Overlays = {
    intro(ctx, snap, t) {
      if (snap.t > 4) return;
      const a = snap.t < 3 ? 1 : 1 - (snap.t - 3);
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = a;
      text(ctx, '12:00 AM', W / 2, H / 2 - 30, 72, '#fff', 'center');
      const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', 'Custom'][snap.night - 1];
      text(ctx, snap.night === 7 ? 'Custom Night' : `${ord} Night`, W / 2, H / 2 + 36, 44, '#fff', 'center');
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
          const guards = (app.lobby ? app.lobby.players : []).filter((p) => p.role === 'guard').map((p) => p.name);
          text(ctx, `${guards.join(' & ') || 'The guard'} survived ${nightLabel(res.night)}!`, W / 2, H / 2 + 90, 40, '#d8c25a', 'center');
        }
      } else if (res.winner === 'anims') {
        if (k < 2.2) Art.staticScreen(ctx, t, 1);
        else {
          Art.staticScreen(ctx, t, 0.18);
          text(ctx, 'Game Over', W - 60, H - 70, 64, '#f2f2ec', 'right');
          const who = FN.CHAR_INFO[res.who] ? FN.CHAR_INFO[res.who].short : 'Something';
          const by = res.by ? `${who} (${res.by})` : `${who} (AI)`;
          text(ctx, res.powerOut ? 'The power ran out...' : '', W / 2, H / 2 - 60, 34, '#a0a098', 'center');
          text(ctx, `${by} got the guard.`, W / 2, H / 2, 46, '#e04a3a', 'center');
          text(ctx, 'The animatronics win!', W / 2, H / 2 + 50, 34, '#cfcfc8', 'center');
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

    pressDoor(s) {
      if (this.blocked()) return;
      if (this.app.snap.broken[s]) { A.play('dud', { pan: s === 'L' ? -0.6 : 0.6 }); return; }
      const v = !this.doorOn(s);
      this.pend['door' + s] = { v, at: performance.now() };
      this.app.send({ t: 'in', a: 'door', side: s, on: v });
    }

    pressLight(s) {
      if (this.blocked()) return;
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

    sendMon() { this.app.send({ t: 'in', a: 'mon', up: this.mon, cam: this.cam }); }

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
      this.scroll = clamp(this.scroll, 0, OFF().W - W);
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
      } else {
        this.drawCams(ctx, t);
      }
      if (snap.powerOut && snap.powerOut.phase === 'dark') return;
      drawClock(ctx, snap);
      if (!snap.powerOut) {
        drawPower(ctx, snap);
        this.drawBar(ctx);
      }
      this.drawPartner(ctx);
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
      this.hits.push(...Art.drawMap(ctx, 860, 340, { mode: 'guard', cam: this.cam }));
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

    drawPartner(ctx) {
      const snap = this.app.snap;
      const others = Object.entries(snap.guards).filter(([pid]) => pid !== this.app.pid);
      let y = 104;
      for (const [, g] of others) {
        const s = g.up ? `watching CAM ${g.cam} (${camName(g.cam)})` : 'looking around the office';
        text(ctx, `${g.name}: ${s}`, 30, y, 24, '#b8d0b0');
        y += 26;
      }
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
      if (this.mon) {
        const h = hitTest(this.hits, x, y);
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

  // ======================= ANIMATRONIC =======================
  class AnimView {
    constructor(app, who) {
      this.app = app;
      this.who = who;
      this.hits = [];
      A.loop('ambience', true, 0.4);
    }

    update() {}
    onSnap() {}

    room() {
      const a = this.app.snap.anims[this.who];
      if (this.who === 'foxy') return a.runT >= 0 ? '2A' : '1C';
      return a.room;
    }

    watched() {
      const snap = this.app.snap;
      return watchedCams(snap).includes(this.room());
    }

    draw(ctx, t) {
      const snap = this.app.snap;
      const a = snap.anims[this.who];
      const room = this.room();
      const info = FN.CHAR_INFO[this.who];
      this.hits = [];

      if (room === 'LD' || room === 'RD') this.drawDoorPOV(ctx, room === 'LD' ? 'L' : 'R', t);
      else if (room === 'OF') this.drawInside(ctx, t);
      else if (room === '6') this.drawKitchen(ctx, t);
      else {
        Art.drawRoom(ctx, room, snap, 0.5 + 0.5 * Math.sin(t * 0.2), t);
        Art.camEffects(ctx, t, snap.glitch[room] ? 0.35 : 0, 'rgba(110,0,0,0.12)');
      }
      if (snap.powerOut) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        text(ctx, 'THE POWER IS OUT', W / 2, 200, 54, '#e04a3a', 'center');
        text(ctx, 'Freddy is coming for the guard...', W / 2, 250, 32, '#cfcfc8', 'center');
      }

      // status panel
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(20, 44, 440, 176);
      ctx.fillStyle = info.color;
      ctx.fillRect(20, 44, 8, 176);
      text(ctx, `YOU ARE ${info.short.toUpperCase()}`, 40, 70, 36, info.color);
      const where = room === 'LD' || room === 'RD' || room === 'OF' ? camName(room)
        : this.who === 'foxy' && a.runT < 0 ? `Pirate Cove (stage ${a.stage + 1}/3)` : `${camName(room)} (CAM ${room})`;
      text(ctx, where, 40, 104, 26, '#e8e8e2');
      const cdMax = T.playerCooldown[this.who] * (snap.speed || 1);
      if (room === 'OF') text(ctx, 'Inside the office!', 40, 136, 26, '#ff9a8a');
      else if (this.who === 'foxy' && a.runT >= 0) text(ctx, 'RUNNING!', 40, 136, 26, '#ff9a8a');
      else if (a.cd > 0) {
        text(ctx, `Next move in ${a.cd.toFixed(1)}s`, 40, 136, 26, '#d8c25a');
        ctx.fillStyle = '#333';
        ctx.fillRect(40, 152, 400, 8);
        ctx.fillStyle = '#d8c25a';
        ctx.fillRect(40, 152, 400 * (1 - clamp(a.cd / Math.max(cdMax, T.repelCooldown), 0, 1)), 8);
      } else text(ctx, 'Ready to move', 40, 136, 26, '#7fd060');
      const guards = Object.values(snap.guards);
      const gtxt = guards.map((g) => (g.up ? `on CAM ${g.cam}` : 'in the office')).join(' / ') || 'none';
      text(ctx, `Guard power: ${Math.ceil(snap.power)}%`, 40, 178, 24, '#b0b0a8');
      text(ctx, `Guard: ${gtxt}`, 40, 204, 24, '#b0b0a8');

      if (this.watched() && room !== 'OF') {
        eyeIcon(ctx, W / 2, 70, 1.1, t);
        text(ctx, this.who === 'freddy' ? 'WATCHED - YOU CAN\'T MOVE' : 'THE GUARD IS WATCHING YOU', W / 2, 120, 30, '#ffdf60', 'center');
      }

      drawClock(ctx, snap);
      this.drawFeed(ctx);

      // map
      const positions = {};
      for (const c of FN.CHARS) {
        const ac = snap.anims[c];
        positions[c] = c === 'foxy' ? (ac.runT >= 0 ? '2A' : '1C') : ac.room;
      }
      let adj = [];
      const canMove = this.who !== 'foxy' && a.cd <= 0 && room !== 'OF' && !snap.powerOut && !snap.jumpscare &&
        !(this.who === 'freddy' && this.watched());
      if (canMove) adj = FN.PLAYER_GRAPH[this.who][a.room] || [];
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(850, 300, 420, 410);
      text(ctx, adj.length ? 'Click a green room to move' : 'Map', 1060, 318, 26, '#cfcfc8', 'center');
      this.hits.push(...Art.drawMap(ctx, 860, 340, { mode: 'anim', here: positions[this.who], adj, positions, me: this.who, watched: watchedCams(snap), t }));

      this.drawActions(ctx, snap, a, room);
    }

    actions(snap, a, room) {
      const acts = [];
      const lurk = T.doorLurkMin;
      if (snap.powerOut || snap.jumpscare || room === 'OF') return acts;
      const watched = this.watched();
      if (this.who === 'bonnie' || this.who === 'chica') {
        const side = this.who === 'bonnie' ? 'L' : 'R';
        if (room === FN.DOOR_ROOM[side]) {
          const shut = snap.doors[side];
          const ready = a.doorT >= lurk;
          acts.push({ id: 'enter', label: 'SNEAK IN', hot: ready && !shut, enabled: ready && !shut,
            sub: shut ? `Door shut! Pushed back in ${Math.max(0, T.doorRepelTime - a.shutT).toFixed(1)}s` : ready ? 'The door is open...' : `Wait ${(lurk - a.doorT).toFixed(1)}s` });
        }
      } else if (this.who === 'freddy') {
        if (room === '4B') {
          acts.push({ id: 'enter', label: 'SNEAK IN', hot: true, enabled: a.cd <= 0 && !watched,
            sub: watched ? 'They\'re watching you' : 'Only while the guard is on the monitor' });
        }
      } else if (this.who === 'foxy' && a.runT < 0) {
        if (a.stage < 2) acts.push({ id: 'advance', label: 'CREEP OUT', enabled: a.cd <= 0 && !watched, sub: watched ? 'Hold still - watched' : a.cd > 0 ? `${a.cd.toFixed(1)}s` : `Stage ${a.stage + 1} of 3` });
        else acts.push({ id: 'run', label: 'RUN!', hot: true, enabled: a.cd <= 0 && !watched, sub: watched ? 'Hold still - watched' : a.cd > 0 ? `${a.cd.toFixed(1)}s` : 'Sprint for the left door' });
      } else if (this.who === 'foxy') {
        acts.push({ id: 'none', label: 'RUNNING!', enabled: false, sub: 'Is the left door open?' });
      }
      const jamRoom = this.who === 'foxy' ? (a.runT >= 0 ? '2A' : '1C') : room;
      if (FN.CAMS.includes(jamRoom) && jamRoom !== '6') {
        acts.push({ id: 'jam', label: 'JAM CAMERA', enabled: a.jamCd <= 0, sub: a.jamCd > 0 ? `${a.jamCd.toFixed(0)}s` : `Static for ${T.jamDuration}s` });
      }
      return acts;
    }

    drawActions(ctx, snap, a, room) {
      const acts = this.actions(snap, a, room);
      let y = H - 100;
      for (const b of acts.reverse()) {
        button(ctx, this.hits, { ...b, x: 30, y, w: 300, h: 76 });
        y -= 90;
      }
      if (room === 'OF') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(30, H - 130, 560, 100);
        text(ctx, 'You\'re in the office.', 50, H - 104, 32, '#ff9a8a');
        text(ctx, 'The moment they lower the monitor...', 50, H - 66, 28, '#cfcfc8');
      }
    }

    drawFeed(ctx) {
      const now = this.app.t;
      const items = this.app.feed.filter((f) => now - f.at < 12).slice(-5);
      let y = 136;
      for (const f of items) {
        ctx.globalAlpha = clamp(12 - (now - f.at), 0, 1);
        text(ctx, f.msg, W - 30, y, 24, '#e0c8a0', 'right');
        y += 28;
      }
      ctx.globalAlpha = 1;
    }

    // Looking into the office from the doorway.
    drawDoorPOV(ctx, side, t) {
      const snap = this.app.snap;
      const shut = snap.doors[side];
      const lit = snap.lights[side];
      const guards = Object.values(snap.guards);
      const onMon = guards.some((g) => g.up);
      const fx = 360, fy = 90, fw = 560, fh = 580;
      ctx.fillStyle = '#060608';
      ctx.fillRect(0, 0, W, H);
      poly(ctx, [[0, 0], [fx, fy], [fx, fy + fh], [0, H]], '#1b1a1f');
      poly(ctx, [[W, 0], [fx + fw, fy], [fx + fw, fy + fh], [W, H]], '#161519');
      poly(ctx, [[0, H], [fx, fy + fh], [fx + fw, fy + fh], [W, H]], '#232226');
      ctx.fillStyle = '#1e1f23';
      ctx.fillRect(fx, fy, fw, fh);
      ctx.fillStyle = '#2b2620';
      ctx.fillRect(fx, fy + fh - 170, fw, 170);
      const gx = side === 'L' ? fx + fw * 0.68 : fx + fw * 0.32;
      if (guards.length) {
        ell(ctx, gx, fy + fh - 250, 40, 46, '#050505');
        ell(ctx, gx, fy + fh - 150, 100, 70, '#050505');
        if (onMon) {
          ctx.save();
          ctx.shadowColor = '#9fe0c0';
          ctx.shadowBlur = 40;
          ctx.fillStyle = '#8fd0b0';
          ctx.fillRect(gx - 70, fy + fh - 230, 140, 90);
          ctx.restore();
        }
      }
      ctx.fillStyle = '#3a332b';
      ctx.fillRect(fx, fy + fh - 120, fw, 30);
      if (shut) {
        const g = ctx.createLinearGradient(fx, 0, fx + fw, 0);
        g.addColorStop(0, '#3c3f44');
        g.addColorStop(0.5, '#5b5e64');
        g.addColorStop(1, '#3a3d42');
        ctx.fillStyle = g;
        ctx.fillRect(fx, fy, fw, fh);
        for (let y = fy + 40; y < fy + fh; y += 42) { ctx.fillStyle = '#26282c'; ctx.fillRect(fx, y, fw, 5); }
      }
      ctx.strokeStyle = '#34363b';
      ctx.lineWidth = 26;
      ctx.strokeRect(fx - 13, fy - 13, fw + 26, fh + 26);
      if (lit) {
        const g = ctx.createRadialGradient(W / 2, 0, 40, W / 2, H / 2, 700);
        g.addColorStop(0, 'rgba(255,235,170,0.35)');
        g.addColorStop(1, 'rgba(255,235,170,0.05)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, W, H);
      }
      Art.staticScreen(ctx, t, 0.06);
      const y0 = 300;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(W / 2 - 250, y0 - 30, 500, 120);
      text(ctx, `DOOR: ${shut ? 'SHUT' : 'OPEN'}`, W / 2, y0, 34, shut ? '#ff8070' : '#90e070', 'center');
      text(ctx, lit ? 'LIGHT ON - THEY CAN SEE YOU' : 'LIGHT: OFF', W / 2, y0 + 32, 28, lit ? '#ffd060' : '#a0a098', 'center');
      text(ctx, onMon ? 'The guard is on the monitor' : 'The guard is watching the office', W / 2, y0 + 62, 26, '#cfcfc8', 'center');
    }

    drawInside(ctx, t) {
      const snap = this.app.snap;
      const v = {
        t, door: { L: snap.doors.L ? 1 : 0, R: snap.doors.R ? 1 : 0 }, light: snap.lights,
        doorway: { L: null, R: null }, invader: null, fan: t * 26, power: 'on', flash: false, dim: 0.3,
      };
      Art.blitOffice(ctx, Art.renderOffice(v), (OFF().W - W) / 2);
    }

    drawKitchen(ctx, t) {
      ctx.fillStyle = '#060607';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#121214';
      ctx.fillRect(100, 420, 1080, 300);
      for (let i = 0; i < 7; i++) {
        const x = 170 + i * 150;
        ctx.strokeStyle = '#2a2a2e';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, 120);
        ctx.lineTo(x, 200 + (i % 3) * 20);
        ctx.stroke();
        ell(ctx, x, 230 + (i % 3) * 20, 34, 30, '#1e1e22');
      }
      text(ctx, 'KITCHEN', W / 2, 360, 48, '#5a5a58', 'center');
      text(ctx, 'No camera in here. The guard can only hear you.', W / 2, 404, 26, '#5a5a58', 'center');
      Art.staticScreen(ctx, t, 0.08);
    }

    pointer(type, x, y) {
      if (type !== 'up') return;
      const h = hitTest(this.hits, x, y);
      if (!h) return;
      if (h.room) { this.app.send({ t: 'in', a: 'move', to: h.room }); A.play('click'); }
      else if (h.id && h.id !== 'none') { this.app.send({ t: 'in', a: h.id }); A.play('click'); }
    }

    key(e) {
      const k = e.key.toLowerCase();
      const map = { e: 'enter', j: 'jam', ' ': this.who === 'foxy' ? (this.app.snap.anims.foxy.stage >= 2 ? 'run' : 'advance') : 'enter' };
      if (map[k]) { this.app.send({ t: 'in', a: map[k] }); return true; }
      return false;
    }

    onEvent(e) {
      if (e.k === 'bang' && this.who === 'foxy') A.play('bang');
      if (e.k === 'music') A.loop('music', true, 0.5);
      if (e.k === 'musicstop') A.loop('music', false);
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
      text(ctx, 'SPECTATING', 30, 70, 34, '#d8c25a');
      let y = 104;
      for (const [, g] of Object.entries(snap.guards)) {
        text(ctx, `${g.name}: ${g.up ? `CAM ${g.cam}` : 'office'}`, 30, y, 24, '#b8d0b0');
        y += 26;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(850, 300, 420, 410);
      text(ctx, this.cam === 'OF' ? 'The Office' : camName(this.cam), 1060, 318, 32, '#f2f2ec', 'center');
      this.hits.push(...Art.drawMap(ctx, 860, 340, { mode: 'guard', cam: this.cam }));
      button(ctx, this.hits, { id: 'office', x: 30, y: y + 10, w: 180, h: 50, label: 'VIEW OFFICE', size: 26, enabled: this.cam !== 'OF' });
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

  FN.Views = { GuardView, AnimView, SpectatorView, Overlays, hitTest, button };
})();
