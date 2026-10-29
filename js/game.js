// The authoritative night simulation. Only the host runs this; everyone else
// receives snapshots of it and sends inputs back.
(function () {
  'use strict';
  const FN = window.FN;
  const T = FN.TUNE;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const doorSide = (room) => (room === 'LD' ? 'L' : room === 'RD' ? 'R' : null);

  // Footsteps the guard can hear when someone gets close, by room entered.
  const STEP_CUES = { '2B': ['L', 0.45], '3': ['L', 0.3], LD: ['L', 0.8], '4B': ['R', 0.45], RD: ['R', 0.8] };

  // Slow human animatronics down when they outnumber the guards.
  function autoSpeed(roster) {
    const guards = roster.filter((p) => p.role === 'guard').length || 1;
    const hunters = roster.filter((p) => FN.CHARS.includes(p.role)).length;
    return 1 + 0.15 * Math.max(0, hunters / guards - 1);
  }
  FN.autoSpeed = autoSpeed;

  class Sim {
    // roster: [{pid, name, role}], settings: {night, custom, length, speed}
    constructor(roster, settings) {
      this.night = settings.night;
      this.hourLen = FN.LENGTHS[settings.length].hour;
      this.lenFactor = 89 / this.hourLen;
      this.speed = FN.SPEEDS[settings.speed].mult || autoSpeed(roster);
      this.t = 0;
      this.hour = 0;
      this.power = 100;
      this.usage = 1;
      this.doors = { L: false, R: false };
      this.lights = { L: false, R: false };
      this.broken = { L: false, R: false };
      this.guards = {};
      this.anims = {};
      this.glitch = {};
      this.powerOut = null;
      this.jumpscare = null;
      this.result = null;
      this.ended = false;
      this.events = [];
      this.foxyBangs = 0;
      this.kitchenT = 2;

      const base = this.night === 7 ? settings.custom : FN.NIGHT_AI[this.night];
      for (const c of FN.CHARS) {
        this.anims[c] = {
          room: c === 'foxy' ? '1C' : '1A', ctrl: null, name: null,
          ai: Math.max(0, Math.min(20, base[c] | 0)), aiT: rand(0.5, T.aiInterval[c]),
          cd: 0, jamCd: 0, doorT: 0, shutT: 0, inT: 0, side: null,
          stage: 0, runT: -1, outT: 0, lockT: 0, seen: false,
        };
      }
      if (this.night === 4) this.anims.freddy.ai = 1 + (Math.random() < 0.5 ? 1 : 0);

      for (const p of roster) {
        if (p.role === 'guard') this.guards[p.pid] = { name: p.name, up: false, cam: '1A' };
        else if (this.anims[p.role]) {
          const a = this.anims[p.role];
          a.ctrl = p.pid;
          a.name = p.name;
          a.cd = T.playerCooldown[p.role] * this.speed;
        }
      }
    }

    // ---- helpers ----
    emit(ev, to = 'all') { ev.to = to; this.events.push(ev); }
    feed(msg) { this.emit({ k: 'feed', msg }, 'anims'); }
    tell(pid, msg) { this.emit({ k: 'msg', msg }, pid); }
    roll(ai) { return ai >= 1 + Math.floor(Math.random() * 20); }
    guardList() { return Object.values(this.guards); }
    allGuardsOnMonitor() { const g = this.guardList(); return g.length > 0 && g.every((x) => x.up); }
    anyGuardOffMonitor() { return this.guardList().some((x) => !x.up); }
    watched(room) { return !this.glitch[room] && this.guardList().some((g) => g.up && g.cam === room); }
    charOf(pid) { return FN.CHARS.find((c) => this.anims[c].ctrl === pid) || null; }
    label(c) { return FN.CHAR_INFO[c].short; }
    glitchRoom(room, secs) { if (FN.CAMS.includes(room)) this.glitch[room] = Math.max(this.glitch[room] || 0, secs); }

    // ---- main loop ----
    tick(dt) {
      if (this.ended) return;
      if (this.jumpscare) {
        this.jumpscare.t += dt;
        if (this.jumpscare.t >= T.jumpscareTime) this.finish('anims');
        return;
      }
      this.t += dt;
      const h = Math.min(6, Math.floor(this.t / this.hourLen));
      if (h !== this.hour) { this.hour = h; this.onHour(h); }
      if (this.t >= 6 * this.hourLen) { this.finish('guards'); return; }

      for (const k of Object.keys(this.glitch)) {
        this.glitch[k] -= dt;
        if (this.glitch[k] <= 0) delete this.glitch[k];
      }
      if (this.powerOut) { this.tickPowerOut(dt); return; }
      this.tickPower(dt);
      if (this.powerOut) return;

      for (const c of FN.CHARS) {
        this.tickAnim(c, this.anims[c], dt);
        if (this.jumpscare) return;
      }

      if (FN.CHARS.some((c) => this.anims[c].room === '6')) {
        this.kitchenT -= dt;
        if (this.kitchenT <= 0) { this.kitchenT = rand(1.4, 3.2); this.emit({ k: 'kitchen' }, 'guards'); }
      }
    }

    onHour(h) {
      this.emit({ k: 'hour', h });
      for (const c of FN.HOURLY_AI[h] || []) this.anims[c].ai = Math.min(20, this.anims[c].ai + 1);
    }

    tickPower(dt) {
      const monitors = this.guardList().filter((g) => g.up).length;
      this.usage = 1 + (this.doors.L ? 1 : 0) + (this.doors.R ? 1 : 0) +
        (this.lights.L ? 1 : 0) + (this.lights.R ? 1 : 0) + monitors;
      const drain = (this.usage * T.powerPerUsage + (FN.NIGHT_PASSIVE_DRAIN[this.night] || 0)) * this.lenFactor;
      this.power -= drain * dt;
      if (this.power <= 0) this.startPowerOut();
    }

    startPowerOut() {
      this.power = 0;
      this.usage = 0;
      this.powerOut = { phase: 'out', t: 0, next: rand(...T.powerOut.toMusic) };
      this.doors.L = this.doors.R = false;
      this.lights.L = this.lights.R = false;
      for (const g of this.guardList()) g.up = false;
      this.emit({ k: 'powerout' });
      this.feed('The power is out! Freddy will take it from here...');
    }

    tickPowerOut(dt) {
      const po = this.powerOut;
      po.t += dt;
      if (po.t < po.next) return;
      po.t = 0;
      if (po.phase === 'out') {
        po.phase = 'music';
        po.next = rand(...T.powerOut.music);
        this.emit({ k: 'music' });
      } else if (po.phase === 'music') {
        po.phase = 'dark';
        po.next = rand(...T.powerOut.dark);
        this.emit({ k: 'musicstop' });
      } else {
        this.startJumpscare('freddy');
      }
    }

    tickAnim(c, a, dt) {
      if (a.jamCd > 0) a.jamCd = Math.max(0, a.jamCd - dt);
      if (a.room === 'OF') {
        a.inT += dt;
        if ((a.inT >= T.officeGrace && this.anyGuardOffMonitor()) || a.inT >= T.officeForce) this.startJumpscare(c);
        return;
      }
      if (c === 'foxy') { this.tickFoxy(a, dt); return; }

      const side = doorSide(a.room) || (c === 'freddy' && a.room === '4B' ? 'R' : null);
      if (side) {
        a.doorT += dt;
        a.shutT = this.doors[side] ? a.shutT + dt : 0;
        if (a.ctrl && a.shutT >= T.doorRepelTime) { this.repel(c, a, side); return; }
      }
      if (a.ctrl) {
        if (a.cd > 0) a.cd = Math.max(0, a.cd - dt);
        return;
      }
      a.aiT -= dt;
      if (a.aiT > 0) return;
      a.aiT += T.aiInterval[c];
      if (this.roll(a.ai)) this.aiMove(c, a);
    }

    aiMove(c, a) {
      if (c === 'freddy') {
        if (this.watched(a.room)) return;
        if (a.room === '4B') {
          if (this.doors.R) this.moveTo(c, a, '4A');
          else if (this.allGuardsOnMonitor()) this.enterOffice(c, a, 'R');
          return;
        }
        this.moveTo(c, a, pick(FN.AI_PATH.freddy[a.room]));
        this.emit({ k: 'laugh' }, 'guards');
        return;
      }
      const side = doorSide(a.room);
      if (side) {
        if (this.doors[side]) this.repel(c, a, side);
        else this.enterOffice(c, a, side);
        return;
      }
      this.moveTo(c, a, pick(FN.AI_PATH[c][a.room]));
    }

    moveTo(c, a, room) {
      const from = a.room;
      a.room = room;
      a.doorT = 0;
      a.shutT = 0;
      this.glitchRoom(from, T.glitchOnMove);
      this.glitchRoom(room, T.glitchOnMove);
      const cue = STEP_CUES[room];
      if (cue) this.emit({ k: 'steps', side: cue[0], vol: cue[1] }, 'guards');
      this.emit({ k: 'moved', who: c, from, to: room }, 'anims');
    }

    repel(c, a, side) {
      const back = c === 'freddy' ? '4A' : '1B';
      this.moveTo(c, a, back);
      this.emit({ k: 'steps', side, vol: 0.35 }, 'guards');
      if (a.ctrl) {
        a.cd = T.repelCooldown * this.speed;
        this.tell(a.ctrl, `The door stayed shut. You retreat to the ${FN.ROOMS[back].name}.`);
      }
      this.feed(`${this.label(c)} was turned away at the ${side === 'L' ? 'left' : 'right'} door.`);
    }

    enterOffice(c, a, side) {
      a.room = 'OF';
      a.inT = 0;
      a.side = side;
      if (c !== 'freddy') { this.broken[side] = true; this.lights[side] = false; }
      this.emit({ k: 'groan', side }, 'guards');
      this.feed(`${this.label(c)} got into the office!`);
    }

    startJumpscare(c) {
      if (this.jumpscare || this.ended) return;
      this.jumpscare = { who: c, t: 0 };
      for (const g of this.guardList()) g.up = false;
      this.emit({ k: 'jumpscare', who: c });
    }

    // ---- Foxy ----
    tickFoxy(a, dt) {
      if (a.runT >= 0) {
        a.runT += dt;
        if (a.runT >= T.foxyRunTime) this.foxyArrive(a);
        return;
      }
      const watched = this.watched('1C');
      if (a.ctrl) {
        if (!watched && a.cd > 0) a.cd = Math.max(0, a.cd - dt);
        return;
      }
      if (a.stage === 3) {
        a.outT += dt;
        if (this.watched('2A') || a.outT >= T.foxyAiLeaveTime) this.foxyStartRun(a);
        return;
      }
      if (watched) { a.seen = true; return; }
      if (a.seen) { a.seen = false; a.lockT = rand(0.8, 12); }
      if (a.lockT > 0) { a.lockT -= dt; return; }
      a.aiT -= dt;
      if (a.aiT > 0) return;
      a.aiT += T.aiInterval.foxy;
      if (this.allGuardsOnMonitor() || !this.roll(a.ai)) return;
      a.stage++;
      this.glitchRoom('1C', T.glitchOnMove);
      if (a.stage === 3) a.outT = 0;
    }

    foxyStartRun(a) {
      a.stage = 3;
      a.runT = 0;
      a.room = '2A';
      this.emit({ k: 'run' }, 'guards');
      this.feed('Foxy is sprinting down the West Hall!');
    }

    foxyArrive(a) {
      a.runT = -1;
      a.room = '1C';
      a.outT = 0;
      if (!this.doors.L) { this.startJumpscare('foxy'); return; }
      // AI Foxy uses the original escalating drain. A human Foxy attacks far more often, so each bang
      // costs a flat amount, scaled so a whole night of bangs costs the same share on any night length.
      const drain = a.ctrl ? Math.round(T.playerFoxyBang * this.lenFactor * 10) / 10 : 1 + 5 * this.foxyBangs;
      this.foxyBangs++;
      this.power = Math.max(0.01, this.power - drain);
      a.stage = a.ctrl ? 0 : pick([0, 1]);
      a.cd = T.foxyBangCooldown * this.speed;
      this.emit({ k: 'bang' }, 'all');
      this.feed(`Foxy slammed into the left door! (-${drain}% power)`);
    }

    // ---- inputs ----
    input(pid, m) {
      if (this.ended || this.jumpscare || !m) return;
      const g = this.guards[pid];
      if (g) { this.guardInput(pid, g, m); return; }
      const c = this.charOf(pid);
      if (c) this.animInput(pid, c, this.anims[c], m);
    }

    guardInput(pid, g, m) {
      if (this.powerOut) return;
      const s = m.side;
      if (m.a === 'mon') {
        g.up = !!m.up;
        if (FN.CAMS.includes(m.cam)) g.cam = m.cam;
      } else if (m.a === 'door' && (s === 'L' || s === 'R')) {
        if (!this.broken[s]) this.doors[s] = 'on' in m ? !!m.on : !this.doors[s];
      } else if (m.a === 'light' && (s === 'L' || s === 'R')) {
        if (this.broken[s]) return;
        this.lights[s] = 'on' in m ? !!m.on : !this.lights[s];
        if (this.lights[s]) this.lights[s === 'L' ? 'R' : 'L'] = false;
      }
    }

    animInput(pid, c, a, m) {
      if (this.powerOut || a.room === 'OF') return;
      switch (m.a) {
        case 'move': {
          if (c === 'foxy' || a.cd > 0) return;
          if (!(FN.PLAYER_GRAPH[c][a.room] || []).includes(m.to)) return;
          if (c === 'freddy' && this.watched(a.room)) { this.tell(pid, 'Someone is watching you. You can\'t move.'); return; }
          this.moveTo(c, a, m.to);
          a.cd = T.playerCooldown[c] * this.speed;
          if (c === 'freddy') this.emit({ k: 'laugh' }, 'guards');
          return;
        }
        case 'enter': {
          if (c === 'freddy') {
            if (a.room !== '4B' || a.cd > 0) return;
            if (this.watched('4B')) { this.tell(pid, 'They\'re looking right at you!'); return; }
            if (this.doors.R) {
              this.moveTo(c, a, '4A');
              a.cd = T.repelCooldown * this.speed;
              this.tell(pid, 'The right door was shut! You slink back to the East Hall.');
              this.feed('Freddy found the right door shut.');
              return;
            }
            if (!this.allGuardsOnMonitor()) { this.tell(pid, 'The guard isn\'t on the monitor. They\'d see you coming.'); return; }
            this.enterOffice(c, a, 'R');
          } else if (c === 'bonnie' || c === 'chica') {
            const side = doorSide(a.room);
            if (!side || a.doorT < T.doorLurkMin) return;
            if (this.doors[side]) { this.tell(pid, 'The door is shut.'); return; }
            this.enterOffice(c, a, side);
          }
          return;
        }
        case 'advance': {
          if (c !== 'foxy' || a.runT >= 0 || a.stage >= 2 || a.cd > 0) return;
          if (this.watched('1C')) { this.tell(pid, 'They\'re watching the cove. Hold still.'); return; }
          a.stage++;
          a.cd = T.playerCooldown.foxy * this.speed;
          this.glitchRoom('1C', T.glitchOnMove);
          return;
        }
        case 'run': {
          if (c !== 'foxy' || a.runT >= 0 || a.stage !== 2 || a.cd > 0) return;
          if (this.watched('1C')) { this.tell(pid, 'They\'re watching the cove. Hold still.'); return; }
          this.foxyStartRun(a);
          return;
        }
        case 'jam': {
          if (a.jamCd > 0) return;
          const room = c === 'foxy' ? (a.runT >= 0 ? '2A' : '1C') : a.room;
          if (!FN.CAMS.includes(room) || room === '6') { this.tell(pid, 'There\'s no camera here to jam.'); return; }
          this.glitch[room] = Math.max(this.glitch[room] || 0, T.jamDuration);
          a.jamCd = T.jamCooldown;
          return;
        }
      }
    }

    removePlayer(pid) {
      if (this.guards[pid]) {
        delete this.guards[pid];
        if (!this.guardList().length && !this.ended) {
          this.ended = true;
          this.result = { winner: 'none', reason: 'Every guard left their shift.', night: this.night, t: this.t };
          this.emit({ k: 'end' });
        }
        return;
      }
      const c = this.charOf(pid);
      if (c) {
        this.anims[c].ctrl = null;
        this.anims[c].name = null;
        this.feed(`${this.label(c)}'s player left. The AI takes over.`);
      }
    }

    finish(winner) {
      if (this.ended) return;
      this.ended = true;
      const who = this.jumpscare ? this.jumpscare.who : null;
      this.result = {
        winner, who, by: who ? this.anims[who].name : null,
        night: this.night, t: this.t, power: this.power, powerOut: !!this.powerOut,
      };
      if (winner === 'guards') this.emit({ k: 'sixam' });
      this.emit({ k: 'end' });
    }

    snapshot() {
      const anims = {};
      for (const c of FN.CHARS) {
        const a = this.anims[c];
        anims[c] = {
          room: a.room, ctrl: a.ctrl, name: a.name, cd: r1(a.cd), jamCd: r1(a.jamCd),
          doorT: r1(a.doorT), shutT: r1(a.shutT), inT: r1(a.inT), side: a.side,
          stage: a.stage, runT: r2(a.runT),
        };
      }
      const guards = {};
      for (const [pid, g] of Object.entries(this.guards)) guards[pid] = { name: g.name, up: g.up, cam: g.cam };
      const glitch = {};
      for (const [k, v] of Object.entries(this.glitch)) glitch[k] = r1(v);
      return {
        t: r2(this.t), hourLen: this.hourLen, hour: this.hour, night: this.night, speed: r2(this.speed),
        power: Math.max(0, r1(this.power)), usage: this.usage,
        doors: { ...this.doors }, lights: { ...this.lights }, broken: { ...this.broken },
        guards, anims, glitch,
        powerOut: this.powerOut ? { phase: this.powerOut.phase, t: r2(this.powerOut.t) } : null,
        jumpscare: this.jumpscare ? { ...this.jumpscare } : null,
        result: this.result, ended: this.ended,
      };
    }

    takeEvents() { const e = this.events; this.events = []; return e; }
  }

  FN.Sim = Sim;
})();
