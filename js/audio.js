// Synthesized sound effects (WebAudio): block hits and breaks per material, footsteps, pickups,
// hurt, eating, explosions, and simple mob voices. Positional sounds fade with distance.
(function (G) {
  'use strict';
  const MC = G.MC;

  class Audio {
    constructor() {
      this.ctx = null;
      this.volume = 0.7;
      this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
      this.noiseBuf = null;
    }

    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = G.AudioContext || G.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

    // A gain+pan node for a sound at a world position (or at the listener when pos is null).
    out(pos, vol) {
      const c = this.ctx;
      const g = c.createGain();
      let v = vol;
      let pan = 0;
      if (pos) {
        const L = this.listener;
        const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 32) return null;
        v *= Math.max(0, 1 - d / 32) ** 1.4;
        // right vector of the listener: (cos yaw, 0, -sin yaw)
        if (d > 0.5) pan = MC.clamp((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d, -1, 1) * 0.7;
      }
      if (v < 0.01) return null;
      g.gain.value = v;
      if (c.createStereoPanner) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        g.connect(p); p.connect(this.master);
      } else g.connect(this.master);
      return g;
    }

    noise(dest, t0, dur, freq, q, type = 'bandpass', attack = 0.003) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + 0.02);
      return f;
    }

    tone(dest, t0, dur, f0, f1, type = 'sine', vol = 1) {
      const c = this.ctx;
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(dest);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }

    // Material sounds: kind = 'break' | 'place' | 'hit' | 'step'
    block(material, kind, pos) {
      if (!this.ctx) return;
      const vol = kind === 'step' ? 0.18 : kind === 'hit' ? 0.22 : 0.55;
      const d = this.out(pos, vol);
      if (!d) return;
      const t = this.ctx.currentTime;
      const dur = kind === 'break' ? 0.22 : kind === 'place' ? 0.12 : 0.07;
      const r = 0.85 + Math.random() * 0.3;
      switch (material) {
        case 'wood': this.noise(d, t, dur, 520 * r, 4); this.tone(d, t, dur * 0.8, 180 * r, 120, 'triangle', 0.5); break;
        case 'gravel': case 'sand': this.noise(d, t, dur * 1.2, (material === 'sand' ? 2600 : 1400) * r, 0.8); break;
        case 'grass': this.noise(d, t, dur, 3200 * r, 0.6, 'highpass'); break;
        case 'glass':
          if (kind === 'break') { for (let i = 0; i < 4; i++) this.tone(d, t + i * 0.02, 0.25, 2200 + Math.random() * 2400, null, 'sine', 0.25); }
          else this.tone(d, t, 0.08, 1800 * r, null, 'sine', 0.3);
          break;
        case 'snow': case 'cloth': this.noise(d, t, dur * 1.1, 900 * r, 0.5, 'lowpass'); break;
        case 'slime': this.tone(d, t, 0.15, 220 * r, 120, 'sine', 0.6); this.noise(d, t, 0.08, 700, 1, 'lowpass'); break;
        default: this.noise(d, t, dur, 1100 * r, 1.5); this.tone(d, t, dur * 0.6, 95 * r, 70, 'square', 0.12);
      }
    }

    play(name, pos, vol = 1) {
      if (!this.ctx) return;
      const d = this.out(pos, vol);
      if (!d) return;
      const t = this.ctx.currentTime;
      const r = 0.9 + Math.random() * 0.2;
      switch (name) {
        case 'pop': this.tone(d, t, 0.09, 900 * r, 1500, 'sine', 0.35); break;
        case 'click': this.tone(d, t, 0.05, 1200, 900, 'square', 0.15); break;
        case 'hurt': this.tone(d, t, 0.2, 420 * r, 180, 'sawtooth', 0.35); this.noise(d, t, 0.1, 700, 1); break;
        case 'eat': for (let i = 0; i < 3; i++) this.noise(d, t + i * 0.11, 0.07, 1500 * r, 1.2); break;
        case 'burp': this.tone(d, t, 0.25, 160, 90, 'sawtooth', 0.3); break;
        case 'splash': this.noise(d, t, 0.45, 1300, 0.5, 'lowpass', 0.02); break;
        case 'swim': this.noise(d, t, 0.25, 900, 0.6, 'lowpass', 0.03); break;
        case 'explode': this.noise(d, t, 1.4, 260, 0.4, 'lowpass', 0.005); this.tone(d, t, 0.9, 70, 30, 'sine', 0.9); break;
        case 'fuse': this.noise(d, t, 1.2, 4500, 2, 'bandpass', 0.05); break;
        case 'door': this.noise(d, t, 0.18, 380 * r, 3); this.tone(d, t, 0.15, 140, 90, 'triangle', 0.4); break;
        case 'chest': this.tone(d, t, 0.3, 130 * r, 90, 'triangle', 0.5); this.noise(d, t, 0.25, 500, 2); break;
        case 'fizz': this.noise(d, t, 0.5, 3000, 0.6, 'highpass', 0.02); break;
        case 'levelup': [523, 659, 784, 1047].forEach((f, i) => this.tone(d, t + i * 0.07, 0.3, f, null, 'triangle', 0.3)); break;
        case 'orb': this.tone(d, t, 0.12, 1400 * r * (1 + Math.random() * 0.5), null, 'sine', 0.2); break;
        case 'bow': this.noise(d, t, 0.25, 900, 2); this.tone(d, t, 0.15, 300, 600, 'triangle', 0.2); break;
        case 'arrowhit': this.noise(d, t, 0.08, 1700, 2); break;
        case 'attack': this.noise(d, t, 0.08, 1100 * r, 0.8); break;
        case 'crit': this.noise(d, t, 0.12, 2400 * r, 0.8); this.tone(d, t, 0.1, 900, 400, 'square', 0.12); break;
        case 'amethyst': [1568, 2093, 2637].forEach((f, i) => this.tone(d, t + i * 0.03, 0.5, f * r, null, 'sine', 0.18)); break;
        case 'zombie': this.tone(d, t, 0.6, 110 * r, 80, 'sawtooth', 0.35); this.noise(d, t, 0.5, 300, 1, 'lowpass'); break;
        case 'skeleton': for (let i = 0; i < 3; i++) this.noise(d, t + i * 0.08, 0.05, 2600, 4); break;
        case 'spider': this.noise(d, t, 0.35, 1800, 6, 'bandpass', 0.05); break;
        case 'creeper': this.noise(d, t, 0.6, 3200, 3, 'bandpass', 0.1); break;
        case 'pig': this.tone(d, t, 0.18, 300 * r, 220, 'sawtooth', 0.25); this.tone(d, t + 0.2, 0.15, 280 * r, 200, 'sawtooth', 0.2); break;
        case 'cow': this.tone(d, t, 0.8, 150 * r, 110, 'sawtooth', 0.3); break;
        case 'sheep': for (let i = 0; i < 4; i++) this.tone(d, t + i * 0.08, 0.09, 420 * r, 380, 'sawtooth', 0.22); break;
        case 'chicken': this.tone(d, t, 0.08, 1300 * r, 900, 'square', 0.12); this.tone(d, t + 0.12, 0.08, 1500 * r, 1000, 'square', 0.1); break;
        case 'goat': this.tone(d, t, 0.45, 340 * r, 260, 'sawtooth', 0.25); break;
        case 'axolotl': this.tone(d, t, 0.15, 1800 * r, 2400, 'sine', 0.15); break;
        case 'squid': this.noise(d, t, 0.3, 600, 1, 'lowpass', 0.05); break;
        case 'player': this.tone(d, t, 0.15, 500 * r, 300, 'sine', 0.2); break;
        default: this.tone(d, t, 0.1, 600, 400, 'sine', 0.2);
      }
    }
  }

  MC.Audio = Audio;
})(globalThis);
