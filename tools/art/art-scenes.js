// Draws the office, every camera room and the bits the game animates. Runs only in
// tools/build-assets.html, which saves the results as the images in assets/.
(function () {
  'use strict';
  const FN = window.FN;
  const Art = FN.Art;
  const { canvas, rng, rr, ell, poly, line, FONT } = Art;
  const H = FN.H;

  // ================= shared helpers =================
  function checker(c, x, y, w, h, size, a, b) {
    for (let j = 0; j * size < h; j++) {
      for (let i = 0; i * size < w; i++) {
        c.fillStyle = (i + j) % 2 ? a : b;
        c.fillRect(x + i * size, y + j * size, Math.min(size, w - i * size), Math.min(size, h - j * size));
      }
    }
  }

  function grime(c, x, y, w, h, seed, n = 120, alpha = 0.25) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
      const gx = x + r() * w, gy = y + r() * h * 0.6;
      const g = c.createLinearGradient(gx, gy, gx, gy + 40 + r() * 160);
      g.addColorStop(0, `rgba(0,0,0,${alpha * r()})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(gx, gy, 2 + r() * 10, 40 + r() * 160);
    }
  }

  function vignette(c, cx, cy, r0, r1, w, h, alpha) {
    const g = c.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${alpha})`);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  function text(c, s, x, y, size, color, align = 'left', font = FONT) {
    c.font = `${size}px ${font}`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(s, x, y);
  }
  Art.text = text;

  function star(c, x, y, r, color) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r * 0.45 : r;
      pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]);
    }
    poly(c, pts, color);
  }

  // A simple 3D projector for corridors and rooms: x right, y up, z forward.
  function projector(vx, vy, f) {
    const P = (x, y, z) => [vx + (x * f) / z, vy - (y * f) / z];
    const quad = (c, pts, color) => poly(c, pts.map((p) => P(p[0], p[1], p[2])), color);
    return { P, quad };
  }

  function floorTiles(c, pr, x0, x1, z0, z1, y, tile, a, b) {
    for (let z = z0, j = 0; z < z1; z += tile, j++) {
      for (let x = x0, i = 0; x < x1; x += tile, i++) {
        pr.quad(c, [[x, y, z], [x + tile, y, z], [x + tile, y, z + tile], [x, y, z + tile]], (i + j) % 2 ? a : b);
      }
    }
  }

  // Kids' crayon drawing of an animatronic.
  function crayon(c, x, y, w, h, seed) {
    const r = rng(seed);
    c.save();
    c.translate(x + w / 2, y + h / 2);
    c.rotate((r() - 0.5) * 0.2);
    c.fillStyle = '#cfc9b6';
    c.fillRect(-w / 2, -h / 2, w, h);
    const cols = ['#b5342e', '#3c5cb8', '#c9a227', '#7a4a28', '#5a52c0', '#2f8a3a'];
    c.lineWidth = Math.max(2, w / 30);
    c.lineCap = 'round';
    const n = 1 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const col = cols[Math.floor(r() * cols.length)];
      const fx = (n === 1 ? 0 : (k - 0.5) * w * 0.45);
      c.strokeStyle = col;
      c.beginPath();
      c.arc(fx, -h * 0.12, w * 0.15, 0, Math.PI * 2);
      c.stroke();
      line(c, fx, -h * 0.12 + w * 0.15, fx, h * 0.25);
      line(c, fx - w * 0.14, h * 0.05, fx + w * 0.14, h * 0.05);
      line(c, fx, h * 0.25, fx - w * 0.1, h * 0.4);
      line(c, fx, h * 0.25, fx + w * 0.1, h * 0.4);
      line(c, fx - w * 0.1, -h * 0.25, fx - w * 0.12, -h * 0.36);
      line(c, fx + w * 0.1, -h * 0.25, fx + w * 0.12, -h * 0.36);
      ell(c, fx - w * 0.05, -h * 0.14, 1.5, 1.5, '#111');
      ell(c, fx + w * 0.05, -h * 0.14, 1.5, 1.5, '#111');
    }
    c.restore();
  }

  function celebratePoster(c, x, y, w, h) {
    c.fillStyle = '#1a2350';
    c.fillRect(x, y, w, h);
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    const s = w / 600;
    Art.drawChar(c, 'bonnie', x + w * 0.22, y + h * 1.18, s * 1.05, { light: 0.85 });
    Art.drawChar(c, 'chica', x + w * 0.78, y + h * 1.18, s * 1.05, { light: 0.85 });
    Art.drawChar(c, 'freddy', x + w * 0.5, y + h * 1.12, s * 1.15, { light: 0.9 });
    c.restore();
    c.font = `bold ${Math.round(w * 0.15)}px "Archivo Black", "Arial Black", Impact, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = '#e8c43a';
    c.fillText('CELEBRATE!', x + w / 2, y + h * 0.04);
    c.strokeStyle = '#0c0c10';
    c.lineWidth = 4;
    c.strokeRect(x, y, w, h);
  }

  // ================= office =================
  const { DOOR, PANEL, BTN, POSTER } = FN.LAYOUT.OFFICE;
  const OW = FN.LAYOUT.OFFICE.W;

  function buildOffice() {
    const cv = canvas(OW, H);
    const c = cv.getContext('2d');
    let g = c.createLinearGradient(0, 0, 0, 140);
    g.addColorStop(0, '#060709');
    g.addColorStop(1, '#141519');
    c.fillStyle = g;
    c.fillRect(0, 0, OW, 140);
    g = c.createLinearGradient(0, 70, 0, 560);
    g.addColorStop(0, '#26282e');
    g.addColorStop(1, '#1a1b1f');
    c.fillStyle = g;
    c.fillRect(0, 70, OW, 490);
    grime(c, 0, 70, OW, 480, 11, 220, 0.35);

    // ceiling beam, vents and dangling wires
    c.fillStyle = '#0e0f12';
    c.fillRect(0, 60, OW, 16);
    for (const vx of [520, 1080]) {
      c.fillStyle = '#1d1f23';
      c.fillRect(vx, 20, 120, 40);
      for (let i = 0; i < 6; i++) { c.fillStyle = '#0b0c0e'; c.fillRect(vx + 8, 26 + i * 6, 104, 3); }
    }
    c.strokeStyle = '#08080a';
    c.lineWidth = 3;
    const wr = rng(5);
    for (let i = 0; i < 9; i++) {
      const x0 = 320 + wr() * 960, x1 = x0 + (wr() - 0.5) * 300;
      c.beginPath();
      c.moveTo(x0, 70);
      c.bezierCurveTo(x0, 150 + wr() * 80, x1, 150 + wr() * 80, x1, 70);
      c.stroke();
    }

    // checkered band along the wall
    checker(c, 0, 470, OW, 44, 22, '#8d8b84', '#101010');
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 470, OW, 44);
    c.fillStyle = '#121214';
    c.fillRect(0, 514, OW, 10);

    // floor
    const pr = projector(OW / 2, 470, 900);
    floorTiles(c, pr, -6, 6, 1.1, 6, -0.45, 0.5, '#2a2a2c', '#0f0f10');
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 524, OW, 200);

    // posters and drawings
    celebratePoster(c, POSTER.x, POSTER.y, POSTER.w, POSTER.h);
    for (let i = 0; i < 7; i++) {
      crayon(c, 980 + (i % 4) * 66 + (i > 3 ? 30 : 0), 160 + Math.floor(i / 4) * 95, 58, 78, 100 + i);
    }
    c.fillStyle = '#b8b3a0';
    c.save();
    c.translate(760, 200);
    c.rotate(-0.04);
    c.fillRect(-60, -40, 120, 80);
    text(c, 'SAFETY', 0, -22, 22, '#222', 'center');
    text(c, 'FIRST!', 0, 2, 22, '#222', 'center');
    text(c, '- management', 0, 26, 14, '#444', 'center');
    c.restore();

    // door frames + panels
    for (const side of ['L', 'R']) {
      const d = DOOR[side];
      c.fillStyle = '#0d0e10';
      c.fillRect(d.x0 - 30, DOOR.top - 40, d.x1 - d.x0 + 60, DOOR.bot - DOOR.top + 60);
      c.fillStyle = '#34363b';
      c.fillRect(d.x0 - 20, DOOR.top - 30, d.x1 - d.x0 + 40, DOOR.bot - DOOR.top + 40);
      c.save();
      c.beginPath();
      c.rect(d.x0 - 20, DOOR.top - 30, d.x1 - d.x0 + 40, 26);
      c.clip();
      for (let x = d.x0 - 40; x < d.x1 + 40; x += 28) poly(c, [[x, DOOR.top - 4], [x + 14, DOOR.top - 4], [x + 40, DOOR.top - 30], [x + 26, DOOR.top - 30]], '#b8961e');
      c.restore();
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(d.x0 - 20, DOOR.top - 30, d.x1 - d.x0 + 40, 26);
      for (const [sx, sy] of [[d.x0 - 10, DOOR.top + 20], [d.x1 + 10, DOOR.top + 20], [d.x0 - 10, DOOR.bot - 10], [d.x1 + 10, DOOR.bot - 10]]) ell(c, sx, sy, 3, 3, '#1a1b1e');

      const px = PANEL[side];
      c.fillStyle = '#1b1c20';
      rr(c, px - 34, 300, 68, 168, 6);
      c.fill();
      c.fillStyle = '#2b2d32';
      rr(c, px - 30, 304, 60, 160, 5);
      c.fill();
      text(c, 'DOOR', px, BTN.door - 32, 15, '#8a8c90', 'center');
      text(c, 'LIGHT', px, BTN.light - 32, 15, '#8a8c90', 'center');
      ell(c, px, BTN.door, BTN.r + 5, BTN.r + 5, '#101113');
      ell(c, px, BTN.light, BTN.r + 5, BTN.r + 5, '#101113');
    }

    // desk
    poly(c, [[430, 498], [1170, 498], [1214, 546], [386, 546]], '#3a332b');
    g = c.createLinearGradient(0, 546, 0, 720);
    g.addColorStop(0, '#27221d');
    g.addColorStop(1, '#0c0b09');
    c.fillStyle = g;
    c.fillRect(386, 546, 828, 180);
    line(c, 386, 546, 1214, 546, '#4a4238', 3);
    // monitors
    c.fillStyle = '#25262a';
    rr(c, 596, 396, 128, 104, 8);
    c.fill();
    c.fillStyle = '#2d2e32';
    rr(c, 700, 344, 210, 158, 10);
    c.fill();
    c.fillStyle = '#1f2023';
    c.fillRect(760, 488, 90, 14);
    c.fillStyle = '#08100c';
    rr(c, 716, 360, 178, 118, 8);
    c.fill();
    rr(c, 608, 408, 104, 76, 6);
    c.fill();
    // papers, cup, cupcake
    const pr2 = rng(77);
    for (let i = 0; i < 6; i++) {
      c.save();
      c.translate(450 + pr2() * 260, 510 + pr2() * 24);
      c.rotate((pr2() - 0.5) * 0.6);
      c.fillStyle = `rgb(${150 + pr2() * 30},${148 + pr2() * 30},${135 + pr2() * 20})`;
      c.fillRect(-34, -10, 68, 22);
      c.restore();
    }
    c.fillStyle = '#9a2420';
    poly(c, [[1098, 452], [1138, 452], [1132, 512], [1104, 512]], '#9a2420');
    ell(c, 1118, 452, 21, 6, '#d8d2c4');
    line(c, 1124, 452, 1132, 418, '#d8d2c4', 4);
    poly(c, [[530, 496], [586, 496], [578, 520], [538, 520]], '#c84c7a');
    ell(c, 558, 490, 32, 16, '#e8a2bc');
    ell(c, 550, 487, 5, 6, '#eee');
    ell(c, 566, 487, 5, 6, '#eee');
    ell(c, 551, 488, 2, 3, '#111');
    ell(c, 567, 488, 2, 3, '#111');
    // fan stand
    c.fillStyle = '#2a2b2e';
    c.fillRect(1004, 420, 14, 84);
    ell(c, 1011, 506, 44, 10, '#202124');

    // baked lighting: a dim lamp over the desk, darkness at the edges
    vignette(c, OW / 2, 300, 160, 900, OW, H, 0.75);
    g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(0.3, 'rgba(0,0,0,0)');
    g.addColorStop(0.85, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = g;
    c.fillRect(0, 0, OW, H);

    for (const side of ['L', 'R']) c.clearRect(DOOR[side].x0, DOOR.top, DOOR[side].x1 - DOOR[side].x0, DOOR.bot - DOOR.top);
    return cv;
  }

  function doorwayInterior(c, side, lit, who) {
    const d = DOOR[side];
    const w = d.x1 - d.x0;
    c.save();
    c.beginPath();
    c.rect(d.x0, DOOR.top, w, DOOR.bot - DOOR.top);
    c.clip();
    c.fillStyle = '#000';
    c.fillRect(d.x0, DOOR.top, w, DOOR.bot - DOOR.top);
    if (lit) {
      const vx = side === 'L' ? d.x0 + w * 0.66 : d.x0 + w * 0.34;
      const vy = 330;
      const near = side === 'L' ? d.x0 : d.x1;
      const far = side === 'L' ? d.x1 : d.x0;
      poly(c, [[d.x0, DOOR.bot], [d.x1, DOOR.bot], [vx + 24, vy + 50], [vx - 24, vy + 50]], '#5e574a');
      poly(c, [[near, DOOR.top], [vx - (side === 'L' ? 24 : -24), vy - 70], [vx - (side === 'L' ? 24 : -24), vy + 50], [near, DOOR.bot]], '#463f35');
      poly(c, [[far, DOOR.top], [vx + (side === 'L' ? 24 : -24), vy - 70], [vx + (side === 'L' ? 24 : -24), vy + 50], [far, DOOR.bot]], '#2f2a23');
      c.fillStyle = '#0a0908';
      c.fillRect(vx - 24, vy - 70, 48, 120);
      for (let i = 0; i < 6; i++) {
        const t = i / 6;
        c.fillStyle = i % 2 ? 'rgba(220,215,200,0.25)' : 'rgba(0,0,0,0.3)';
        const y0 = DOOR.bot - (DOOR.bot - vy - 50) * t;
        c.fillRect(d.x0, y0 - 6, w, 5);
      }
      if (who) Art.drawChar(c, who, d.x0 + w * 0.5, DOOR.bot + 80, 0.92, { light: 0.95 });
      const g = c.createRadialGradient(d.x0 + w / 2, DOOR.top, 10, d.x0 + w / 2, DOOR.top + 200, 420);
      g.addColorStop(0, 'rgba(255,240,200,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0.25)');
      c.fillStyle = g;
      c.fillRect(d.x0, DOOR.top, w, DOOR.bot - DOOR.top);
    }
    c.restore();
  }

  function shutter(c, side, amt) {
    if (amt < 0.01) return;
    const d = DOOR[side];
    const w = d.x1 - d.x0;
    const y1 = DOOR.top + (DOOR.bot - DOOR.top) * amt;
    c.save();
    c.beginPath();
    c.rect(d.x0, DOOR.top, w, y1 - DOOR.top);
    c.clip();
    const g = c.createLinearGradient(d.x0, 0, d.x1, 0);
    g.addColorStop(0, '#3c3f44');
    g.addColorStop(0.5, '#5b5e64');
    g.addColorStop(1, '#3a3d42');
    c.fillStyle = g;
    c.fillRect(d.x0, DOOR.top, w, y1 - DOOR.top);
    for (let y = y1 - 34; y > DOOR.top; y -= 36) {
      c.fillStyle = '#26282c';
      c.fillRect(d.x0, y, w, 4);
      c.fillStyle = '#767a81';
      c.fillRect(d.x0, y + 4, w, 1);
    }
    c.beginPath();
    c.rect(d.x0, y1 - 24, w, 24);
    c.clip();
    c.fillStyle = '#141414';
    c.fillRect(d.x0, y1 - 24, w, 24);
    for (let x = d.x0 - 30; x < d.x1 + 30; x += 30) poly(c, [[x, y1], [x + 15, y1], [x + 39, y1 - 24], [x + 24, y1 - 24]], '#c9a42a');
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(d.x0, DOOR.top, w, y1 - DOOR.top);
  }


  // The fan is split so the game can spin the blades under a still cage.
  function fanBlades(c) {
    ell(c, 0, 0, 60, 60, 'rgba(48,50,54,0.55)');
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 3; i++) {
        c.save();
        c.rotate(-k * 0.18 + (i * Math.PI * 2) / 3);
        ell(c, 0, -30, 17, 30, `rgba(80,82,88,${0.5 - k * 0.15})`);
        c.restore();
      }
    }
    ell(c, 0, 0, 10, 10, '#1b1c1f');
  }

  function fanCage(c) {
    c.strokeStyle = '#3e4045';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(0, 0, 62, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      line(c, Math.cos(a) * 12, Math.sin(a) * 12, Math.cos(a) * 62, Math.sin(a) * 62);
    }
  }


  // ================= camera rooms =================
  const RW = FN.LAYOUT.ROOM_W;


  const ROOM_DRAW = {
    '1A'(c) {
      c.fillStyle = '#09080b';
      c.fillRect(0, 0, RW, H);
      for (let x = 0; x < RW; x += 64) {
        const g = c.createLinearGradient(x, 0, x + 64, 0);
        g.addColorStop(0, '#1a0a20');
        g.addColorStop(0.5, '#3a1846');
        g.addColorStop(1, '#1a0a20');
        c.fillStyle = g;
        c.fillRect(x, 50, 64, 520);
      }
      for (let x = 0; x < RW; x += 90) { c.fillStyle = '#4a1c56'; c.beginPath(); c.arc(x + 45, 50, 45, 0, Math.PI); c.fill(); }
      c.fillStyle = '#2a0f30';
      c.fillRect(0, 0, RW, 52);
      const r = rng(3);
      for (let i = 0; i < 14; i++) {
        const sx = 60 + r() * (RW - 120), sy = 120 + r() * 160;
        line(c, sx, 50, sx, sy, '#3c3a30', 1);
        star(c, sx, sy, 10 + r() * 8, '#8f8240');
      }
      let g = c.createLinearGradient(0, 560, 0, 650);
      g.addColorStop(0, '#3d2716');
      g.addColorStop(1, '#1b1109');
      c.fillStyle = g;
      c.fillRect(0, 560, RW, 90);
      for (let y = 572; y < 650; y += 16) line(c, 0, y, RW, y, 'rgba(0,0,0,0.4)', 2);
      c.fillStyle = '#0d0905';
      c.fillRect(0, 650, RW, 70);
      for (const sx of [80, RW - 200]) { c.fillStyle = '#0c0c0e'; c.fillRect(sx, 380, 120, 190); ell(c, sx + 60, 440, 34, 34, '#1d1d22'); ell(c, sx + 60, 520, 24, 24, '#1d1d22'); }
      for (const lx of [500, 740, 990]) {
        g = c.createRadialGradient(lx, 600, 10, lx, 600, 170);
        g.addColorStop(0, 'rgba(255,230,190,0.18)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(lx - 200, 450, 400, 200);
      }
    },
    '1B'(c) {
      c.fillStyle = '#0b0c0f';
      c.fillRect(0, 0, RW, H);
      c.fillStyle = '#1d1f25';
      c.fillRect(0, 60, RW, 300);
      grime(c, 0, 60, RW, 300, 21, 120, 0.3);
      checker(c, 0, 300, RW, 30, 15, '#6e6c66', '#0d0d0d');
      for (let i = 0; i < 5; i++) { c.fillStyle = ['#3a2440', '#24384a', '#4a3a20', '#3a2420', '#203a2a'][i]; c.fillRect(110 + i * 270, 130, 110, 140); }
      const pr = projector(740, 300, 700);
      floorTiles(c, pr, -6, 6, 1, 9, -0.6, 0.45, '#3a3a3c', '#141415');
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(0, 330, RW, 400);
      for (const tx of [-2.2, 2.2]) {
        pr.quad(c, [[tx - 0.5, -0.22, 1.4], [tx + 0.5, -0.22, 1.4], [tx + 0.5, -0.22, 8], [tx - 0.5, -0.22, 8]], '#8c897f');
        pr.quad(c, [[tx - 0.5, -0.22, 1.4], [tx + 0.5, -0.22, 1.4], [tx + 0.5, -0.4, 1.4], [tx - 0.5, -0.4, 1.4]], '#5a5850');
        for (let z = 1.8; z < 8; z += 0.9) {
          for (const off of [-0.32, 0.32]) {
            const [hx, hy] = pr.P(tx + off, -0.22, z);
            const s = 70 / z;
            ell(c, hx, hy, s * 0.5, s * 0.16, '#c8c4b8');
            const col = ['#b03a3a', '#3a6ab0', '#c0a030', '#3a9a4a'][Math.floor(z * 3 + off * 5 + 10) % 4];
            poly(c, [[hx - s * 0.18, hy - s * 0.05], [hx + s * 0.18, hy - s * 0.05], [hx, hy - s * 0.6]], col);
          }
        }
      }
      c.strokeStyle = 'rgba(160,60,140,0.5)';
      c.lineWidth = 3;
      for (let k = 0; k < 4; k++) {
        c.beginPath();
        for (let x = 0; x <= RW; x += 40) c.lineTo(x, 70 + k * 18 + (x / 40) % 2 * 14);
        c.stroke();
      }
    },
    '1C'(c) {
      c.fillStyle = '#0a090c';
      c.fillRect(0, 0, RW, H);
      c.fillStyle = '#1c1a20';
      c.fillRect(0, 60, RW, 520);
      grime(c, 0, 60, RW, 500, 31, 100, 0.3);
      checker(c, 0, 520, RW, 30, 15, '#66645e', '#0d0d0d');
      c.fillStyle = '#060506';
      c.fillRect(430, 120, 620, 440);
      c.fillStyle = '#2e1830';
      c.fillRect(410, 96, 660, 34);
      for (let x = 430; x < 1050; x += 50) star(c, x + 25, 113, 9, '#9a8a40');
      let g = c.createLinearGradient(0, 560, 0, 640);
      g.addColorStop(0, '#3a2414');
      g.addColorStop(1, '#170e07');
      c.fillStyle = g;
      c.fillRect(380, 556, 720, 80);
      c.fillStyle = '#121214';
      c.fillRect(0, 636, RW, 84);
      c.fillStyle = '#4a3a28';
      c.fillRect(1162, 520, 8, 150);
      c.fillRect(1290, 520, 8, 150);
      c.fillStyle = '#c8c0a8';
      c.fillRect(1130, 440, 200, 104);
      c.font = 'bold 28px "Archivo Black", "Arial Black", Impact, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#7a1d18';
      c.fillText('SORRY!', 1230, 468);
      c.font = 'bold 20px "Archivo Black", "Arial Black", Impact, sans-serif';
      c.fillStyle = '#222';
      c.fillText('OUT OF ORDER', 1230, 510);
    },
    '2A'(c) { corridor(c, { vx: 740, seed: 41, posters: true, light: true }); },
    '2B'(c) { corridor(c, { vx: 1060, seed: 51, posters: true, big: 'left' }); },
    '4A'(c) { corridor(c, { vx: 740, seed: 61, drawings: true }); },
    '4B'(c) { corridor(c, { vx: 420, seed: 71, drawings: true, big: 'right' }); },
    '3'(c) {
      c.fillStyle = '#0b0b0d';
      c.fillRect(0, 0, RW, H);
      c.fillStyle = '#202024';
      c.fillRect(200, 40, 1080, 560);
      grime(c, 200, 40, 1080, 560, 81, 120, 0.35);
      const r = rng(9);
      for (let y = 130; y < 560; y += 140) {
        c.fillStyle = '#3a2e22';
        c.fillRect(240, y, 1000, 14);
        for (let x = 260; x < 1220;) {
          const bw = 50 + r() * 90, bh = 40 + r() * 70;
          c.fillStyle = r() < 0.6 ? `rgb(${70 + r() * 40},${55 + r() * 30},${35 + r() * 20})` : `rgb(${60 + r() * 60},${60 + r() * 60},${70 + r() * 60})`;
          if (r() < 0.75) c.fillRect(x, y - bh, bw, bh);
          x += bw + 8 + r() * 30;
        }
      }
      c.fillStyle = '#18181b';
      c.fillRect(0, 600, RW, 120);
      line(c, 360, 640, 420, 260, '#6a5a3a', 8);
      ell(c, 360, 650, 40, 18, '#8a8a80');
      c.fillStyle = '#3a4a6a';
      poly(c, [[1040, 600], [1120, 600], [1110, 690], [1050, 690]], '#3a4a6a');
      c.fillStyle = '#0b0b0d';
      c.fillRect(0, 0, 200, H);
      c.fillRect(1280, 0, 200, H);
    },
    '5'(c) {
      c.fillStyle = '#0b0b0d';
      c.fillRect(0, 0, RW, H);
      c.fillStyle = '#1c1d21';
      c.fillRect(0, 40, RW, 540);
      grime(c, 0, 40, RW, 540, 91, 140, 0.35);
      c.fillStyle = '#2e261e';
      c.fillRect(120, 250, 900, 14);
      // spare heads on the shelf
      const heads = [['freddy', 220], ['bonnie', 420], ['freddy', 620], ['chica', 820]];
      for (const [who, hx] of heads) {
        c.save();
        c.beginPath();
        c.rect(hx - 110, 60, 220, 192);
        c.clip();
        Art.drawChar(c, who, hx, 250 + 0.4 * 420, 0.4, { eyes: 'empty', light: 0.55 });
        c.restore();
      }
      c.fillStyle = '#2a241e';
      c.fillRect(100, 520, 1000, 26);
      c.strokeStyle = '#6e7076';
      c.lineWidth = 7;
      c.lineCap = 'round';
      line(c, 380, 500, 820, 500);
      line(c, 820, 500, 900, 470);
      ell(c, 930, 460, 36, 30, '#5a5c62');
      ell(c, 918, 456, 7, 7, '#111');
      ell(c, 944, 456, 7, 7, '#111');
      for (let x = 420; x < 800; x += 40) line(c, x, 500, x + 10, 480);
      c.fillStyle = '#121214';
      c.fillRect(0, 580, RW, 140);
    },
    '7'(c) {
      const pr = projector(740, 330, 740);
      c.fillStyle = '#0a0a0c';
      c.fillRect(0, 0, RW, H);
      const zf = 4.5;
      pr.quad(c, [[-1, 1, 1], [-1, 1, zf], [-1, -1, zf], [-1, -1, 1]], '#25242a');
      pr.quad(c, [[1, 1, 1], [1, 1, zf], [1, -1, zf], [1, -1, 1]], '#1f1e23');
      pr.quad(c, [[-1, 1, 1], [1, 1, 1], [1, 1, zf], [-1, 1, zf]], '#0b0b0d');
      floorTiles(c, pr, -1, 1, 1, zf, -1, 0.25, '#4a4a4c', '#121213');
      pr.quad(c, [[-1, 1, zf], [1, 1, zf], [1, -1, zf], [-1, -1, zf]], '#18171b');
      pr.quad(c, [[-0.35, 0.4, zf], [0.35, 0.4, zf], [0.35, -1, zf], [-0.35, -1, zf]], '#060607');
      for (const [x, label, col] of [[-1, 'BOYS', '#3a6ab0'], [1, 'GIRLS', '#b04a7a']]) {
        pr.quad(c, [[x, 0.5, 2], [x, 0.5, 2.9], [x, -1, 2.9], [x, -1, 2]], '#2c2a2a');
        const [sx, sy] = pr.P(x, 0.68, 2.45);
        c.fillStyle = col;
        c.fillRect(sx - 34, sy - 13, 68, 26);
        text(c, label, sx, sy, 22, '#eee', 'center');
      }
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(0, 0, RW, H);
    },
  };

  function corridor(c, o) {
    const zf = 6;
    const pr = projector(o.vx, 320, o.big ? 900 : 740);
    c.fillStyle = '#0a0a0c';
    c.fillRect(0, 0, RW, H);
    pr.quad(c, [[-1, 1.1, 0.6], [-1, 1.1, zf], [-1, -1, zf], [-1, -1, 0.6]], '#27262c');
    pr.quad(c, [[1, 1.1, 0.6], [1, 1.1, zf], [1, -1, zf], [1, -1, 0.6]], '#1f1e24');
    pr.quad(c, [[-1, 1.1, 0.6], [1, 1.1, 0.6], [1, 1.1, zf], [-1, 1.1, zf]], '#0b0b0d');
    floorTiles(c, pr, -1, 1, 0.6, zf, -1, 0.25, '#4a4a4c', '#121213');
    for (const x of [-1, 1]) {
      for (let z = 0.6, i = 0; z < zf; z += 0.12, i++) {
        pr.quad(c, [[x, -0.25, z], [x, -0.25, z + 0.12], [x, -0.4, z + 0.12], [x, -0.4, z]], i % 2 ? '#5e5c56' : '#0e0e0e');
        pr.quad(c, [[x, -0.4, z], [x, -0.4, z + 0.12], [x, -0.55, z + 0.12], [x, -0.55, z]], i % 2 ? '#0e0e0e' : '#5e5c56');
      }
    }
    pr.quad(c, [[-1, 1.1, zf], [1, 1.1, zf], [1, -1, zf], [-1, -1, zf]], '#141317');
    pr.quad(c, [[-0.4, 0.5, zf], [0.4, 0.5, zf], [0.4, -1, zf], [-0.4, -1, zf]], '#040405');
    const r = rng(o.seed);
    for (const x of [-1, 1]) {
      for (let z = 1.2; z < zf - 0.6; z += 0.9 + r() * 0.5) {
        if (o.posters) {
          const col = ['#3a2440', '#24384a', '#4a3a20', '#5a2a20'][Math.floor(r() * 4)];
          pr.quad(c, [[x, 0.75, z], [x, 0.75, z + 0.45], [x, 0.05, z + 0.45], [x, 0.05, z]], col);
          pr.quad(c, [[x, 0.62, z + 0.08], [x, 0.62, z + 0.37], [x, 0.45, z + 0.37], [x, 0.45, z + 0.08]], 'rgba(220,200,120,0.35)');
        }
        if (o.drawings) {
          for (let k = 0; k < 3; k++) {
            const zz = z + k * 0.17, yy = 0.55 - (k % 2) * 0.35;
            pr.quad(c, [[x, yy, zz], [x, yy, zz + 0.14], [x, yy - 0.22, zz + 0.14], [x, yy - 0.22, zz]], '#a8a290');
            const [dx, dy] = pr.P(x, yy - 0.1, zz + 0.07);
            const s = 30 / zz;
            c.strokeStyle = ['#b5342e', '#3c5cb8', '#c9a227'][k];
            c.lineWidth = Math.max(1, s / 6);
            c.beginPath();
            c.arc(dx, dy - s * 0.1, s * 0.3, 0, Math.PI * 2);
            c.stroke();
          }
        }
      }
    }
    if (o.big) {
      const x = o.big === 'left' ? -1 : 1;
      if (o.posters) {
        const [ax, ay] = pr.P(x, 0.85, 0.95);
        const [bx, by] = pr.P(x, -0.05, 1.6);
        const left = Math.min(ax, bx), w = Math.abs(bx - ax);
        celebratePoster(c, left, ay, w, by - ay);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(left, ay, w, by - ay);
      } else {
        for (let k = 0; k < 6; k++) {
          const z = 0.9 + (k % 3) * 0.32, y = 0.75 - Math.floor(k / 3) * 0.5;
          const [ax, ay] = pr.P(x, y, z);
          const [bx, by] = pr.P(x, y - 0.38, z + 0.26);
          crayon(c, Math.min(ax, bx), ay, Math.abs(bx - ax), by - ay, 300 + k + o.seed);
        }
      }
    }
    if (o.light) {
      const [lx, ly] = pr.P(0, 1.08, 3.2);
      c.fillStyle = '#c8c4a8';
      c.fillRect(lx - 30, ly - 3, 60, 6);
    }
    grime(c, 0, 0, RW, H, o.seed + 5, 80, 0.25);
  }

  // feet x, feet y, scale, eye style, brightness

  function buildCurtain() {
    const cv = canvas(320, 440);
    const c = cv.getContext('2d');
    for (let x = 0; x < 320; x += 40) {
      const g = c.createLinearGradient(x, 0, x + 40, 0);
      g.addColorStop(0, '#2a1036');
      g.addColorStop(0.5, '#56287a');
      g.addColorStop(1, '#2a1036');
      c.fillStyle = g;
      c.fillRect(x, 0, 40, 440);
    }
    const r = rng(17);
    for (let i = 0; i < 26; i++) star(c, 10 + r() * 300, 20 + r() * 400, 6 + r() * 6, 'rgba(230,210,120,0.75)');
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(0, 0, 320, 440);
    return cv;
  }


  Art.scenes = { buildOffice, doorwayInterior, shutter, fanBlades, fanCage, ROOM_DRAW, buildCurtain, vignette, text };
})();
