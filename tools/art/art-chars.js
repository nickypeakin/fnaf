// Procedural animatronic art, used by tools/build-assets.html to draw the character
// images in assets/. Figures are drawn once per (character, pose,
// eyes, brightness) into a cached sprite, shaded so they read as 3D in the dark.
(function () {
  'use strict';
  const FN = window.FN;

  const Art = (FN.Art = FN.Art || {});
  const FONT = '"VT323", "Courier New", monospace';
  Art.FONT = FONT;

  // ---------- small drawing helpers shared by every art file ----------
  Art.canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  Art.rng = (seed) => {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  };
  Art.rr = (c, x, y, w, h, r) => {
    c.beginPath();
    r = Math.min(r, w / 2, h / 2);
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };
  Art.ell = (c, x, y, rx, ry, color, rot = 0) => {
    c.beginPath();
    c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
    if (color) { c.fillStyle = color; c.fill(); }
  };
  Art.poly = (c, pts, color) => {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    if (color) { c.fillStyle = color; c.fill(); }
  };
  Art.line = (c, x1, y1, x2, y2, color, w) => {
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    if (color) c.strokeStyle = color;
    if (w) c.lineWidth = w;
    c.stroke();
  };
  // Mix a #rrggbb colour toward black (amt < 0) or white (amt > 0).
  Art.shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
    return `rgb(${r},${g},${b})`;
  };

  const { rr, ell, poly, line, shade } = Art;

  const PAL = {
    freddy: { body: '#7b4a28', dark: '#4f2d16', light: '#c99a68', iris: '#4aa8dc', nose: '#151515', brow: '#1a1008' },
    bonnie: { body: '#5a52c0', dark: '#352f80', light: '#b7aee6', iris: '#d2366f', nose: '#c22a3c', brow: null },
    chica: { body: '#e2bb2c', dark: '#a27e14', light: '#f6e391', iris: '#8b4fc2', nose: '#f08c2a', brow: '#2a1a08' },
    foxy: { body: '#b03c22', dark: '#702010', light: '#dba27c', iris: '#f2d244', nose: '#2a120a', brow: '#2a0c06' },
  };
  Art.PAL = PAL;
  const HEAD_Y = -478;
  const HEAD = { freddy: [92, 82], bonnie: [82, 86], chica: [88, 82], foxy: [80, 74] };

  function legs(c, who, p, run) {
    for (const s of [-1, 1]) {
      c.save();
      c.translate(s * 46, -178);
      if (run) c.rotate(s * 0.38);
      if (who === 'foxy') {
        c.lineCap = 'round';
        line(c, 0, 20, 0, 160, '#7d7f84', 15);
        ell(c, 0, 92, 12, 12, '#55575c');
        line(c, -18, 168, 22, 168, '#55575c', 16);
      } else {
        c.fillStyle = p.body;
        rr(c, -29, 0, 58, 166, 24);
        c.fill();
        ell(c, 0, 168, 46, 18, who === 'chica' ? '#e8862a' : p.dark);
      }
      c.restore();
    }
    if (who === 'foxy') {
      poly(c, [[-96, -212], [96, -212], [92, -146], [62, -132], [42, -150], [12, -128], [-18, -150], [-52, -128], [-92, -146]], '#5c3a22');
    }
  }

  function torso(c, who, p) {
    ell(c, 0, -282, 114, 126, p.body);
    if (who === 'foxy') {
      ell(c, 0, -276, 66, 78, p.light);
      poly(c, [[-92, -252], [-60, -272], [-42, -222], [-66, -196], [-94, -210]], '#1c1c1f');
      c.lineCap = 'round';
      line(c, -82, -240, -54, -206, '#8a8c90', 5);
      line(c, -74, -204, -58, -252, '#6a6c70', 4);
      poly(c, [[70, -330], [96, -320], [92, -290], [66, -296]], '#1c1c1f');
    } else {
      ell(c, 0, -266, 78, 94, p.light);
    }
    if (who === 'chica') {
      poly(c, [[-74, -362], [74, -362], [64, -232], [-64, -232]], '#f2eee2');
      c.font = 'bold 34px "Archivo Black", "Arial Black", Impact, sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      const cols = ['#7a3fb0', '#d0332e', '#2f9a3a', '#e0791e', '#2f68c8', '#c22a8a'];
      const words = [["LET'S", -318], ['EAT!!!', -270]];
      let k = 0;
      for (const [wd, y] of words) {
        let x = -c.measureText(wd).width / 2;
        for (const ch of wd) {
          c.fillStyle = cols[k++ % cols.length];
          c.fillText(ch, x, y);
          x += c.measureText(ch).width;
        }
      }
    }
    if (who === 'freddy' || who === 'bonnie') {
      const col = who === 'freddy' ? '#111' : '#c22a3c';
      poly(c, [[0, -394], [-40, -414], [-40, -374]], col);
      poly(c, [[0, -394], [40, -414], [40, -374]], col);
      ell(c, 0, -394, 11, 11, col);
    }
  }

  function arms(c, who, p, run) {
    c.lineCap = 'round';
    for (const s of [-1, 1]) {
      let hx = s * 138, hy = -196;
      if (run && s === 1) { hx = 178; hy = -350; }
      c.strokeStyle = p.body;
      c.lineWidth = 46;
      c.beginPath();
      c.moveTo(s * 100, -366);
      c.quadraticCurveTo(s * 146, -300, hx, hy);
      c.stroke();
      if (who === 'foxy' && s === -1) {
        c.fillStyle = '#4a4c50';
        rr(c, hx - 20, hy - 6, 40, 26, 6);
        c.fill();
        c.strokeStyle = '#d0d4da';
        c.lineWidth = 11;
        c.beginPath();
        c.arc(hx - 10, hy + 54, 26, -Math.PI / 2.2, Math.PI * 0.85);
        c.stroke();
      } else {
        ell(c, hx, hy + 8, 27, 25, who === 'foxy' ? '#7d7f84' : p.light);
      }
    }
    if (who === 'freddy') {
      c.fillStyle = '#151515';
      rr(c, -150, -272, 22, 74, 6);
      c.fill();
      ell(c, -139, -284, 22, 22, '#6e7075');
      ell(c, -145, -290, 7, 7, '#9a9ca0');
    }
    if (who === 'chica') {
      // Mr. Cupcake, staring back.
      poly(c, [[106, -224], [170, -224], [160, -184], [116, -184]], '#e8608e');
      ell(c, 138, -232, 38, 24, '#f6b8cc');
      ell(c, 126, -236, 7, 8, '#fff');
      ell(c, 150, -236, 7, 8, '#fff');
      ell(c, 127, -235, 3, 4, '#111');
      ell(c, 151, -235, 3, 4, '#111');
      c.fillStyle = '#f2f0e8';
      rr(c, 135, -290, 6, 34, 2);
      c.fill();
      ell(c, 138, -296, 5, 9, '#ffcc40');
    }
  }

  // Everything on the head except the eyes and lids.
  function headBase(c, who, p, jaw, cy) {
    const [hrx, hry] = HEAD[who];
    if (who === 'freddy') {
      for (const s of [-1, 1]) { ell(c, s * 70, cy - 64, 28, 28, p.body); ell(c, s * 70, cy - 64, 14, 14, p.dark); }
    } else if (who === 'bonnie') {
      ell(c, -42, cy - 152, 27, 94, p.body, -0.16);
      ell(c, -42, cy - 150, 13, 72, p.light, -0.16);
      ell(c, 46, cy - 146, 27, 92, p.body, 0.22);
      ell(c, 46, cy - 144, 13, 70, p.light, 0.22);
    } else if (who === 'foxy') {
      for (const s of [-1, 1]) {
        poly(c, [[s * 34, cy - 60], [s * 84, cy - 26], [s * 88, cy - 132]], p.body);
        poly(c, [[s * 50, cy - 56], [s * 78, cy - 38], [s * 80, cy - 106]], p.light);
      }
    }
    ell(c, 0, cy, hrx, hry, p.body);
    if (who === 'chica') {
      ell(c, -22, cy - 84, 9, 22, p.body, -0.4);
      ell(c, 0, cy - 94, 9, 24, p.body);
      ell(c, 20, cy - 84, 9, 22, p.body, 0.4);
      ell(c, -58, cy + 20, 16, 10, 'rgba(240,120,120,0.45)');
      ell(c, 58, cy + 20, 16, 10, 'rgba(240,120,120,0.45)');
    }

    const my = cy + 44;
    const jo = jaw * 74;
    const mw = who === 'foxy' ? 66 : 58;
    if (jo > 1) ell(c, 0, my + jo / 2 + 4, mw - 8, jo / 2 + 14, '#120303');
    c.save();
    c.translate(0, jo);
    ell(c, 0, my + 18, mw, 26, who === 'chica' ? '#d97a1e' : shade(p.light, -0.08));
    c.fillStyle = '#ece6d6';
    for (let i = -3; i <= 3; i++) {
      const tx = i * 14;
      if (who === 'foxy') poly(c, [[tx - 6, my + 4], [tx + 6, my + 4], [tx, my - 10]], '#ece6d6');
      else { rr(c, tx - 6, my - 2, 12, 12, 2); c.fill(); }
    }
    c.restore();
    if (who === 'chica') ell(c, 0, my - 8, 68, 30, '#f08c2a');
    else ell(c, 0, my - 14, who === 'foxy' ? 70 : 64, 36, p.light);
    c.fillStyle = '#ece6d6';
    for (let i = -3; i <= 3; i++) {
      const tx = i * 14;
      if (who === 'foxy') poly(c, [[tx - 6, my + 12], [tx + 6, my + 12], [tx, my + 28]], '#ece6d6');
      else if (who !== 'chica') { rr(c, tx - 6, my + 10, 12, 13, 2); c.fill(); }
    }
    if (who === 'freddy') ell(c, 0, my - 40, 19, 12, p.nose);
    if (who === 'bonnie') ell(c, 0, my - 40, 16, 11, p.nose);
    if (who === 'foxy') ell(c, 0, my - 44, 16, 11, p.nose);
    if (who === 'freddy') {
      ell(c, 0, cy - 76, 56, 11, '#0c0c0c');
      c.fillStyle = '#0c0c0c';
      rr(c, -36, cy - 148, 72, 74, 6);
      c.fill();
      c.fillStyle = '#2b2b2b';
      c.fillRect(-36, cy - 94, 72, 12);
    }
  }

  // Eye styles: normal (whites + iris), dark (black sockets, pinprick pupils),
  // glow (black sockets, glowing pupils), empty (black sockets).
  function eyes(c, who, p, style, cy, dim) {
    const ex = who === 'chica' ? 38 : 34;
    const ey = cy - 18;
    for (const s of [-1, 1]) {
      const x = s * ex;
      if (style === 'normal') {
        ell(c, x, ey, 21, 23, '#f2f0ea');
        ell(c, x + s * 2, ey + 3, 11, 12, p.iris);
        ell(c, x + s * 2, ey + 3, 5, 6, '#050505');
        ell(c, x + s * 2 - 3, ey - 1, 2.5, 2.5, '#fff');
        if (dim > 0) ell(c, x, ey, 22, 24, `rgba(0,0,0,${dim})`);
      } else {
        ell(c, x, ey, 21, 23, '#030303');
        if (style !== 'empty') {
          c.save();
          c.shadowColor = style === 'glow' ? p.iris : '#ffffff';
          c.shadowBlur = 20;
          ell(c, x, ey + 2, style === 'glow' ? 6 : 4.5, style === 'glow' ? 6 : 4.5, style === 'glow' ? '#fff8e0' : '#e8e8e8');
          c.restore();
        }
      }
    }
  }

  function lids(c, who, p, cy, dim) {
    const ex = who === 'chica' ? 38 : 34;
    const ey = cy - 18;
    const lid = shade(p.dark, -dim);
    for (const s of [-1, 1]) {
      const x = s * ex;
      c.beginPath();
      c.ellipse(x, ey - 7, 25, 20, 0, Math.PI, 0);
      c.fillStyle = lid;
      c.fill();
      if (p.brow) {
        c.lineCap = 'round';
        line(c, x - s * 22, ey - 34, x + s * 18, ey - 30 + (who === 'freddy' ? -6 : 0), p.brow, 9);
      }
    }
    if (who === 'foxy') {
      c.fillStyle = '#0a0a0a';
      rr(c, -62, ey - 58, 46, 24, 8);
      c.fill();
      line(c, -64, ey - 48, -84, ey - 30, '#0a0a0a', 4);
      line(c, -18, ey - 48, 40, ey - 70, '#0a0a0a', 4);
    }
  }

  function figure(c, who, pose) {
    const p = PAL[who];
    const run = pose === 'run';
    legs(c, who, p, run);
    torso(c, who, p);
    c.fillStyle = '#3a3a3e';
    rr(c, -26, -410, 52, 54, 10);
    c.fill();
    arms(c, who, p, run);
    headBase(c, who, p, 0, HEAD_Y);
  }

  // ---------- sprite cache ----------
  const SPR = { ...FN.LAYOUT.SPRITE, s: 1 };
  const cache = new Map();

  function shadeLayer(c, cv, light) {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    const g = c.createRadialGradient(cv.width * 0.44, cv.height * 0.28, 10, cv.width * 0.5, cv.height * 0.45, cv.height * 0.72);
    g.addColorStop(0, 'rgba(255,236,210,0.10)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    c.fillStyle = g;
    c.fillRect(0, 0, cv.width, cv.height);
    // Grime: years of pizza grease and dust.
    const r = Art.rng(cv.width * 7 + cv.height);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(${r() < 0.5 ? '20,12,6' : '60,50,30'},${0.08 + r() * 0.18})`;
      const s = 1 + r() * 5;
      c.fillRect(r() * cv.width, r() * cv.height, s, s * (0.5 + r()));
    }
    if (light < 1) {
      c.fillStyle = `rgba(0,0,0,${1 - light})`;
      c.fillRect(0, 0, cv.width, cv.height);
    }
    c.restore();
  }

  Art.sprite = function (who, pose = 'stand', eyeStyle = 'normal', light = 1) {
    const key = `${who}|${pose}|${eyeStyle}|${light}`;
    let sp = cache.get(key);
    if (sp) return sp;
    const cv = Art.canvas(SPR.w * SPR.s, SPR.h * SPR.s);
    const c = cv.getContext('2d');
    c.scale(SPR.s, SPR.s);
    c.translate(SPR.ox, SPR.oy);
    if (pose === 'run') c.rotate(0.22);
    figure(c, who, pose);
    shadeLayer(c, cv, light);
    eyes(c, who, PAL[who], eyeStyle, HEAD_Y, 1 - light);
    lids(c, who, PAL[who], HEAD_Y, Math.min(0.9, 0.3 + (1 - light)));
    // Dark and glowing eyes get a glint so they catch the eye in a dim camera feed.
    if (eyeStyle === 'glow' || eyeStyle === 'dark') {
      const ex = who === 'chica' ? 38 : 34;
      for (const x of [-ex, ex]) Art.glint(c, x, HEAD_Y - 16, 4, eyeStyle === 'glow' ? '#ffffff' : '#dddddd');
    }
    sp = { cv };
    cache.set(key, sp);
    return sp;
  };

  // Draw a character with its feet at (x, y). scale 1 = about 640px tall.
  Art.drawChar = function (ctx, who, x, y, scale, opt = {}) {
    const sp = Art.sprite(who, opt.pose || 'stand', opt.eyes || 'normal', opt.light == null ? 1 : opt.light);
    const k = scale / SPR.s;
    ctx.drawImage(sp.cv, x - SPR.ox * scale, y - SPR.oy * scale, sp.cv.width * k, sp.cv.height * k);
  };

  // Eye position (screen space) for a character drawn with drawChar, for adding glints on top of dark scenes.
  Art.eyePos = function (who, x, y, scale) {
    const ex = (who === 'chica' ? 38 : 34) * scale;
    const ey = y + (HEAD_Y - 18) * scale;
    return [[x - ex, ey], [x + ex, ey]];
  };

  Art.glint = function (ctx, x, y, r, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = r * 4;
    ell(ctx, x, y, r, r, '#fff');
    ctx.restore();
  };

  // ---------- jumpscare / close-up head ----------
  let jsCanvas = null;
  Art.drawHeadCloseup = function (ctx, who, cx, cy, scale, jaw, eyeStyle, rot = 0) {
    const tw = ctx.canvas.width, th = ctx.canvas.height;
    if (!jsCanvas || jsCanvas.width !== tw || jsCanvas.height !== th) jsCanvas = Art.canvas(tw, th);
    const c = jsCanvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, tw, th);
    c.translate(cx, cy);
    c.rotate(rot);
    c.scale(scale, scale);
    c.translate(0, -HEAD_Y);
    const p = PAL[who];
    c.save();
    c.translate(0, 0);
    torso(c, who, p);
    c.fillStyle = '#3a3a3e';
    rr(c, -26, -410, 52, 54, 10);
    c.fill();
    headBase(c, who, p, jaw, HEAD_Y);
    c.restore();
    shadeLayer(c, jsCanvas, 0.95);
    eyes(c, who, p, eyeStyle, HEAD_Y, 0);
    lids(c, who, p, HEAD_Y, 0.35);
    ctx.drawImage(jsCanvas, 0, 0);
  };
})();
