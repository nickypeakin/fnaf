// The authoritative night simulation. Only the host runs this; everyone else
// receives snapshots of it and sends inputs back. Every player is a guard in
// the same office: doors, lights and power are shared, the monitors are not.
(function () {
  'use strict';
  const FN = window.FN;
  const T = FN.TUNE;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const doorSide = (room) => (room === 'LD' ? 'L' : room === 'RD' ? 'R' : null);

  // Footsteps the guards can hear when someone gets close, by room entered.
  const STEP_CUES = { '2B': ['L', 0.45], '3': ['L', 0.3], LD: ['L', 0.8], '4B': ['R', 0.45], RD: ['R', 0.8] };

  class Sim {
    // roster: [{pid, name, role, color}], settings: {night, custom, length}
    constructor(roster, settings) {
      this.night = settings.night;
      this.hourLen = FN.LENGTHS[settings.length].hour;
      this.lenFactor = 89 / this.hourLen;
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

      for (const p of roster) {
        if (p.role === 'guard') this.guards[p.pid] = { name: p.name, color: p.color, up: false, cam: '1A', look: 'C', pingT: 0 };
      }
      this.bonus = FN.teamBonus(Object.keys(this.guards).length);
      this.powerMult = FN.teamPower(Object.keys(this.guards).length);
      const base = this.night === 7 ? settings.custom : FN.NIGHT_AI[this.night];
      for (const c of FN.CHARS) {
        this.anims[c] = {
          room: c === 'foxy' ? '1C' : '1A',
          ai: Math.min(20, Math.max(0, base[c] | 0) + this.bonus), aiT: rand(0.5, T.aiInterval[c]),
          inT: 0, side: null, stage: 0, runT: -1, outT: 0, lockT: 0, seen: false,
        };
      }
      if (this.night === 4) this.anims.freddy.ai = Math.min(20, 1 + (Math.random() < 0.5 ? 1 : 0) + this.bonus);
    }

    // ---- helpers ----
    emit(ev) { this.events.push(ev); }
    roll(ai) { return ai >= 1 + Math.floor(Math.random() * 20); }
    guardList() { return Object.values(this.guards); }
    allOnMonitor() { const g = this.guardList(); return g.length > 0 && g.every((x) => x.up); }
    someoneOnMonitor() { return this.guardList().some((x) => x.up); }
    someoneOffMonitor() { return this.guardList().some((x) => !x.up); }
    watched(room) { return !this.glitch[room] && this.guardList().some((g) => g.up && g.cam === room); }
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

      for (const g of this.guardList()) if (g.pingT > 0) g.pingT -= dt;
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
        if (this.kitchenT <= 0) { this.kitchenT = rand(1.4, 3.2); this.emit({ k: 'kitchen' }); }
      }
    }

    onHour(h) {
      this.emit({ k: 'hour', h });
      for (const c of FN.HOURLY_AI[h] || []) this.anims[c].ai = Math.min(20, this.anims[c].ai + 1);
    }

    tickPower(dt) {
      // The camera system costs one bar while anybody has a monitor up.
      this.usage = 1 + (this.doors.L ? 1 : 0) + (this.doors.R ? 1 : 0) +
        (this.lights.L ? 1 : 0) + (this.lights.R ? 1 : 0) + (this.someoneOnMonitor() ? 1 : 0);
      const drain = (this.usage * T.powerPerUsage + (FN.NIGHT_PASSIVE_DRAIN[this.night] || 0)) * this.lenFactor * this.powerMult;
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
      if (a.room === 'OF') {
        a.inT += dt;
        if ((a.inT >= T.officeGrace && this.someoneOffMonitor()) || a.inT >= T.officeForce) this.startJumpscare(c);
        return;
      }
      if (c === 'foxy') { this.tickFoxy(a, dt); return; }
      a.aiT -= dt;
      if (a.aiT > 0) return;
      a.aiT += T.aiInterval[c];
      if (this.roll(a.ai)) this.aiMove(c, a);
    }

    aiMove(c, a) {
      if (c === 'freddy') {
        // Freddy never moves while someone is looking at him.
        if (this.watched(a.room)) return;
        if (a.room === '4B') {
          if (this.doors.R) this.moveTo(c, a, '4A');
          else if (this.someoneOnMonitor()) this.enterOffice(c, a, 'R');
          return;
        }
        this.moveTo(c, a, pick(FN.AI_PATH.freddy[a.room]));
        this.emit({ k: 'laugh' });
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
      this.glitchRoom(from, T.glitchOnMove);
      this.glitchRoom(room, T.glitchOnMove);
      const cue = STEP_CUES[room];
      if (cue) this.emit({ k: 'steps', side: cue[0], vol: cue[1] });
    }

    repel(c, a, side) {
      this.moveTo(c, a, '1B');
      this.emit({ k: 'steps', side, vol: 0.35 });
    }

    enterOffice(c, a, side) {
      a.room = 'OF';
      a.inT = 0;
      a.side = side;
      if (c !== 'freddy') { this.broken[side] = true; this.lights[side] = false; }
      this.emit({ k: 'groan', side });
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
      if (a.stage === 3) {
        a.outT += dt;
        if (this.watched('2A') || a.outT >= T.foxyLeaveTime) this.foxyStartRun(a);
        return;
      }
      // Watching the cove holds Foxy in place, and he stays put for a while after you look away.
      if (this.watched('1C')) { a.seen = true; return; }
      if (a.seen) { a.seen = false; a.lockT = rand(0.8, 12); }
      if (a.lockT > 0) { a.lockT -= dt; return; }
      a.aiT -= dt;
      if (a.aiT > 0) return;
      a.aiT += T.aiInterval.foxy;
      if (this.allOnMonitor() || !this.roll(a.ai)) return;
      a.stage++;
      this.glitchRoom('1C', T.glitchOnMove);
      if (a.stage === 3) a.outT = 0;
    }

    foxyStartRun(a) {
      a.runT = 0;
      a.room = '2A';
      this.emit({ k: 'run' });
    }

    foxyArrive(a) {
      a.runT = -1;
      a.room = '1C';
      a.outT = 0;
      if (!this.doors.L) { this.startJumpscare('foxy'); return; }
      this.power = Math.max(0.01, this.power - (1 + 5 * this.foxyBangs));
      this.foxyBangs++;
      a.stage = pick([0, 1]);
      this.emit({ k: 'bang' });
    }

    // ---- inputs ----
    input(pid, m) {
      const g = this.guards[pid];
      if (!g || !m || this.ended || this.jumpscare || this.powerOut) return;
      const s = m.side;
      if (m.a === 'mon') {
        g.up = !!m.up;
        if (FN.CAMS.includes(m.cam)) g.cam = m.cam;
        if (m.look === 'L' || m.look === 'C' || m.look === 'R') g.look = m.look;
      } else if (m.a === 'ping') {
        if (g.pingT > 0) return;
        g.pingT = T.pingCooldown;
        this.emit({ k: 'ping', pid, name: g.name, color: g.color, cam: g.up ? g.cam : null, side: g.up ? null : g.look });
      } else if (g.up || (s !== 'L' && s !== 'R') || this.broken[s]) {
        // You have to put your monitor down to reach the buttons.
      } else if (m.a === 'door') {
        this.doors[s] = 'on' in m ? !!m.on : !this.doors[s];
      } else if (m.a === 'light') {
        this.lights[s] = 'on' in m ? !!m.on : !this.lights[s];
        if (this.lights[s]) this.lights[s === 'L' ? 'R' : 'L'] = false;
      }
    }

    removePlayer(pid) {
      if (!this.guards[pid]) return;
      const name = this.guards[pid].name;
      delete this.guards[pid];
      if (!this.guardList().length && !this.ended) {
        this.ended = true;
        this.result = { winner: 'none', reason: 'Every guard left their shift.', night: this.night, t: this.t };
        this.emit({ k: 'end' });
      } else {
        this.emit({ k: 'left', name });
      }
    }

    finish(winner) {
      if (this.ended) return;
      this.ended = true;
      this.result = {
        winner, who: this.jumpscare ? this.jumpscare.who : null,
        night: this.night, t: this.t, power: this.power, powerOut: !!this.powerOut,
        guards: this.guardList().map((g) => g.name),
      };
      if (winner === 'guards') this.emit({ k: 'sixam' });
      this.emit({ k: 'end' });
    }

    snapshot() {
      const anims = {};
      for (const c of FN.CHARS) {
        const a = this.anims[c];
        anims[c] = { room: a.room, side: a.side, stage: a.stage, runT: r2(a.runT), inT: r1(a.inT) };
      }
      const guards = {};
      for (const [pid, g] of Object.entries(this.guards)) guards[pid] = { name: g.name, color: g.color, up: g.up, cam: g.cam, look: g.look };
      const glitch = {};
      for (const [k, v] of Object.entries(this.glitch)) glitch[k] = r1(v);
      return {
        t: r2(this.t), hourLen: this.hourLen, hour: this.hour, night: this.night, bonus: this.bonus,
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
