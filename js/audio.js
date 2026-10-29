// Every sound is synthesized with WebAudio, so there are no audio files to ship.
(function () {
  'use strict';
  const FN = window.FN;

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  const loops = {};
  let muted = false;
  try { muted = localStorage.getItem('fnaf-muted') === '1'; } catch (e) { /* storage blocked */ }

  let failed = false;
  function init() {
    if (failed) return;
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      setup(AC);
    } catch (e) {
      // Some privacy tools block or break Web Audio; the game just runs silently then.
      console.warn('sound unavailable:', e);
      failed = true;
      ctx = null;
    }
  }

  function setup(AC) {
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const now = () => ctx.currentTime;

  function out(pan = 0, vol = 1) {
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(master);
    } else g.connect(master);
    return g;
  }

  function noise(dest, { t = now(), dur = 0.3, type = 'lowpass', freq = 1000, q = 1, vol = 0.5, attack = 0.005, loop = false } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = loop || dur > 1.9;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    if (!loop) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    if (!loop) src.stop(t + dur + 0.05);
    return { src, f, g };
  }

  function tone(dest, { t = now(), dur = 0.3, type = 'sine', freq = 440, to = null, vol = 0.3, attack = 0.005, release = null } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (release || dur));
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + (release || dur) + 0.05);
    return o;
  }

  function distortion(amount) {
    const ws = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    ws.curve = curve;
    return ws;
  }

  // ---- one-shot sounds ----
  const SFX = {
    door(o) {
      const d = out(o.pan, 0.9);
      noise(d, { dur: 0.35, freq: 500, vol: 0.6 });
      tone(d, { dur: 0.45, freq: 110, to: 40, vol: 0.7 });
      tone(d, { t: now() + 0.02, dur: 0.12, type: 'square', freq: 220, to: 150, vol: 0.12 });
    },
    dud(o) {
      const d = out(o.pan, 0.6);
      tone(d, { dur: 0.08, type: 'square', freq: 160, vol: 0.2 });
      tone(d, { t: now() + 0.11, dur: 0.08, type: 'square', freq: 120, vol: 0.2 });
    },
    click() { tone(out(0, 0.5), { dur: 0.04, type: 'square', freq: 1800, vol: 0.12 }); },
    blip() {
      const d = out(0, 0.5);
      tone(d, { dur: 0.05, type: 'square', freq: 900, vol: 0.12 });
      noise(d, { dur: 0.18, type: 'highpass', freq: 2500, vol: 0.25 });
    },
    camUp() {
      const d = out(0, 0.6);
      noise(d, { dur: 0.25, type: 'bandpass', freq: 1800, q: 0.7, vol: 0.35, attack: 0.05 });
      tone(d, { dur: 0.06, type: 'square', freq: 600, vol: 0.06 });
    },
    camDown() {
      const d = out(0, 0.6);
      noise(d, { dur: 0.25, type: 'bandpass', freq: 900, q: 0.7, vol: 0.35, attack: 0.05 });
    },
    steps(o) {
      const d = out(o.pan, o.vol || 0.5);
      for (let i = 0; i < 4; i++) {
        const t = now() + i * (0.34 + Math.random() * 0.06);
        tone(d, { t, dur: 0.18, freq: 70 + Math.random() * 15, to: 40, vol: 0.55 });
        noise(d, { t, dur: 0.09, freq: 700, vol: 0.25 });
      }
    },
    run() {
      const d = out(-0.8, 0.8);
      for (let i = 0; i < 12; i++) {
        const t = now() + 0.3 + i * 0.18;
        const v = 0.15 + (i / 12) * 0.75;
        tone(d, { t, dur: 0.12, freq: 85, to: 45, vol: v });
        noise(d, { t, dur: 0.06, freq: 1100, vol: v * 0.4 });
      }
    },
    bang() {
      const d = out(-0.8, 1);
      for (let i = 0; i < 4; i++) {
        const t = now() + i * 0.24 + Math.random() * 0.04;
        noise(d, { t, dur: 0.3, freq: 400, vol: 0.9 });
        tone(d, { t, dur: 0.35, freq: 140, to: 60, vol: 0.8 });
        tone(d, { t, dur: 0.5, type: 'triangle', freq: 523, to: 500, vol: 0.06 });
      }
    },
    kitchen(o) {
      const d = out(0.5, o.vol || 0.35);
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const t = now() + i * (0.08 + Math.random() * 0.25);
        const base = 500 + Math.random() * 900;
        for (const r of [1, 1.47, 2.09, 2.76]) tone(d, { t, dur: 0.5 + Math.random() * 0.4, type: 'triangle', freq: base * r, vol: 0.06 });
        noise(d, { t, dur: 0.08, type: 'highpass', freq: 3000, vol: 0.2 });
      }
    },
    laugh(o) {
      const d = out(0.3, o.vol || 0.45);
      const shaper = distortion(20);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 600;
      f.Q.value = 2;
      shaper.connect(f).connect(d);
      for (let i = 0; i < 3; i++) {
        const t = now() + i * 0.26;
        const o2 = ctx.createOscillator();
        o2.type = 'sawtooth';
        o2.frequency.setValueAtTime(150 - i * 12, t);
        o2.frequency.exponentialRampToValueAtTime(95 - i * 8, t + 0.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        o2.connect(g).connect(shaper);
        o2.start(t);
        o2.stop(t + 0.3);
      }
    },
    groan(o) {
      const d = out(o.pan, 0.35);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      f.connect(d);
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      const t = now();
      o2.frequency.setValueAtTime(75, t);
      o2.frequency.linearRampToValueAtTime(52, t + 1.6);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const lg = ctx.createGain();
      lg.gain.value = 4;
      lfo.connect(lg).connect(o2.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      o2.connect(g).connect(f);
      o2.start(t); lfo.start(t);
      o2.stop(t + 1.9); lfo.stop(t + 1.9);
    },
    jumpscare() {
      const d = out(0, 1.4);
      const shaper = distortion(60);
      shaper.connect(d);
      const t = now();
      for (const base of [380, 523, 610, 870]) {
        const o2 = ctx.createOscillator();
        o2.type = 'sawtooth';
        o2.frequency.setValueAtTime(base, t);
        for (let i = 1; i < 16; i++) o2.frequency.setValueAtTime(base * (0.8 + Math.random() * 0.5), t + i * 0.09);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35, t);
        g.gain.setValueAtTime(0.35, t + 1.2);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
        o2.connect(g).connect(shaper);
        o2.start(t);
        o2.stop(t + 1.7);
      }
      noise(d, { dur: 1.6, type: 'bandpass', freq: 2500, q: 0.5, vol: 0.9, attack: 0.001 });
    },
    powerout() {
      const d = out(0, 0.9);
      tone(d, { dur: 1.6, type: 'sawtooth', freq: 240, to: 30, vol: 0.25 });
      tone(d, { dur: 0.08, type: 'square', freq: 90, vol: 0.4 });
      noise(d, { dur: 0.6, freq: 300, vol: 0.5 });
    },
    ping() {
      const d = out(0, 0.6);
      tone(d, { dur: 0.12, type: 'square', freq: 880, vol: 0.12 });
      tone(d, { t: now() + 0.13, dur: 0.18, type: 'square', freq: 1320, vol: 0.12 });
    },
    honk() { tone(out(0, 0.6), { dur: 0.16, type: 'square', freq: 370, to: 330, vol: 0.25 }); },
    chime() {
      const d = out(0, 0.8);
      const notes = [1046, 1318, 1568, 2093, 1568, 2093];
      notes.forEach((f, i) => {
        const t = now() + i * 0.45;
        tone(d, { t, dur: 2.2, type: 'sine', freq: f, vol: 0.25 });
        tone(d, { t, dur: 1.2, type: 'sine', freq: f * 2.01, vol: 0.06 });
      });
      // A crowd of kids cheering, faked with swept band-passed noise.
      for (let i = 0; i < 3; i++) {
        const t = now() + 2.8 + i * 0.5;
        const n = noise(d, { t, dur: 1.4, type: 'bandpass', freq: 900, q: 3, vol: 0.4, attack: 0.15 });
        n.f.frequency.setValueAtTime(800, t);
        n.f.frequency.linearRampToValueAtTime(1800, t + 0.4);
        n.f.frequency.linearRampToValueAtTime(1200, t + 1.3);
      }
    },
    tick() { tone(out(0, 0.4), { dur: 0.03, type: 'square', freq: 2400, vol: 0.08 }); },
  };

  function play(name, o = {}) {
    if (!ctx || muted || !SFX[name]) return;
    try { SFX[name](o); } catch (e) { console.warn('sfx', name, e); }
  }

  // ---- loops: started/stopped by name, gain ramps for smooth fades ----
  function makeLoop(name) {
    const d = out(0, 1);
    const g = d;
    g.gain.value = 0;
    const parts = [];
    if (name === 'fan') {
      const n = noise(d, { loop: true, freq: 380, q: 0.5, vol: 0.16, attack: 0.01 });
      parts.push(n.src);
      const o = ctx.createOscillator(); o.frequency.value = 58; const og = ctx.createGain(); og.gain.value = 0.03;
      o.connect(og).connect(d); o.start(); parts.push(o);
    } else if (name === 'ambience') {
      for (const f of [55, 58.3, 110.4]) {
        const o = ctx.createOscillator(); o.frequency.value = f; const og = ctx.createGain(); og.gain.value = 0.05;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.1;
        const lg = ctx.createGain(); lg.gain.value = 0.04; lfo.connect(lg).connect(og.gain);
        o.connect(og).connect(d); o.start(); lfo.start(); parts.push(o, lfo);
      }
      const n = noise(d, { loop: true, freq: 120, vol: 0.12 });
      parts.push(n.src);
    } else if (name === 'buzz') {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 3;
      const og = ctx.createGain(); og.gain.value = 0.08;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 9;
      const lg = ctx.createGain(); lg.gain.value = 0.03; lfo.connect(lg).connect(og.gain);
      o.connect(f).connect(og).connect(d); o.start(); lfo.start(); parts.push(o, lfo);
    } else if (name === 'static') {
      const n = noise(d, { loop: true, type: 'bandpass', freq: 3200, q: 0.6, vol: 0.12 });
      parts.push(n.src);
    } else if (name === 'heavystatic') {
      const n = noise(d, { loop: true, type: 'highpass', freq: 1200, vol: 0.3 });
      parts.push(n.src);
    } else if (name === 'music') {
      const stop = musicBox(d);
      parts.push({ stop });
    } else if (name === 'tension') {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 41;
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 43.5;
      const og = ctx.createGain(); og.gain.value = 0.18;
      o.connect(og); o2.connect(og); og.connect(d); o.start(); o2.start(); parts.push(o, o2);
    }
    return { g, parts };
  }

  function loop(name, on, vol = 1, pan = 0) {
    if (!ctx) return;
    let l = loops[name];
    if (on && !l) l = loops[name] = makeLoop(name);
    if (!l) return;
    const target = on ? vol : 0;
    l.g.gain.cancelScheduledValues(now());
    l.g.gain.setTargetAtTime(target, now(), 0.08);
    if (!on) {
      delete loops[name];
      setTimeout(() => {
        for (const p of l.parts) { try { p.stop(); } catch (e) { /* already stopped */ } }
        try { l.g.disconnect(); } catch (e) { /* already disconnected */ }
      }, 500);
    }
  }

  function stopAll() { for (const k of Object.keys(loops)) loop(k, false); }

  // Bizet's "Toreador" refrain (public domain) as a tinny music box.
  function musicBox(dest) {
    const Q = 0.3;
    const N = { C4: 261.6, D4: 293.7, F4: 349.2, G4: 392, A4: 440, Bb4: 466.2, C5: 523.3, D5: 587.3 };
    const tune = [
      ['C5', 1], ['D5', 0.5], ['C5', 0.5], ['A4', 1], ['A4', 1], ['A4', 0.5], ['G4', 0.5], ['A4', 0.5], ['Bb4', 0.5], ['A4', 2],
      ['Bb4', 1.5], ['G4', 0.5], ['C5', 1], ['A4', 1], ['F4', 1], ['D4', 0.5], ['G4', 0.5], ['C4', 2],
      ['G4', 1], ['C5', 0.5], ['Bb4', 0.5], ['A4', 1], ['G4', 1], ['A4', 0.5], ['Bb4', 0.5], ['A4', 1], ['G4', 2],
    ];
    let stopped = false;
    let timer = null;
    const playOnce = () => {
      if (stopped) return;
      let t = now() + 0.05;
      for (const [n, len] of tune) {
        const f = N[n] * 2;
        tone(dest, { t, dur: len * Q * 2.5, type: 'sine', freq: f, vol: 0.18 });
        tone(dest, { t, dur: len * Q, type: 'triangle', freq: f * 3, vol: 0.03 });
        t += len * Q;
      }
      timer = setTimeout(playOnce, (t - now()) * 1000 + 600);
    };
    playOnce();
    return () => { stopped = true; clearTimeout(timer); };
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('fnaf-muted', m ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, now(), 0.05);
  }

  FN.Audio = { init, play, loop, stopAll, setMuted, isMuted: () => muted };
})();
