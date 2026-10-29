// Renders every image the game uses. tools/build-assets.js opens
// build-assets.html in a headless browser, calls buildAssets() and writes
// each returned image into assets/img/.
(function () {
  'use strict';
  const FN = window.FN;
  const Art = FN.Art;
  const L = FN.LAYOUT;
  const Sc = Art.scenes;
  const { OFFICE } = L;
  const H = FN.H;

  const QUALITY = 0.82;

  function encode(cv, alpha) {
    // WebP keeps transparency and is far smaller than PNG for these noisy, dark images.
    return { data: cv.toDataURL('image/webp', alpha ? 0.88 : QUALITY), w: cv.width, h: cv.height };
  }

  function crop(src, x, y, w, h) {
    const cv = Art.canvas(w, h);
    cv.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
    return cv;
  }

  function office() {
    const out = {};
    const bg = Sc.buildOffice();
    const full = Art.canvas(OFFICE.W, H);
    const c = full.getContext('2d');
    c.fillStyle = '#000';
    c.fillRect(0, 0, OFFICE.W, H);
    c.drawImage(bg, 0, 0);
    out.office = encode(full, false);

    const D = OFFICE.DOOR;
    const dw = (side) => [D[side].x0, D.top, D[side].x1 - D[side].x0, D.bot - D.top];
    const doorway = (name, side, lit, who) => {
      const cv = Art.canvas(OFFICE.W, H);
      Sc.doorwayInterior(cv.getContext('2d'), side, lit, who);
      out[name] = encode(crop(cv, ...dw(side)), false);
    };
    doorway('door-L-lit', 'L', true, null);
    doorway('door-L-bonnie', 'L', true, 'bonnie');
    doorway('door-R-lit', 'R', true, null);
    doorway('door-R-chica', 'R', true, 'chica');

    // Freddy in the left doorway during a power outage, face lit and unlit.
    for (const [name, light] of [['door-L-freddy-on', 0.5], ['door-L-freddy-off', 0.1]]) {
      const cv = Art.canvas(OFFICE.W, H);
      const cc = cv.getContext('2d');
      cc.fillStyle = '#000';
      cc.fillRect(0, 0, OFFICE.W, H);
      const x = (D.L.x0 + D.L.x1) / 2;
      Art.drawChar(cc, 'freddy', x, D.bot + 80, 0.92, { eyes: 'glow', light });
      if (light > 0.3) for (const [ex, ey] of Art.eyePos('freddy', x, D.bot + 80, 0.92)) Art.glint(cc, ex, ey, 4, '#9fe0ff');
      out[name] = encode(crop(cv, ...dw('L')), false);
    }

    const sh = Art.canvas(OFFICE.W, H);
    Sc.shutter(sh.getContext('2d'), 'L', 1);
    // shutter() darkens itself with a translucent overlay; keep that but make the panel opaque underneath.
    const shut = Art.canvas(D.L.x1 - D.L.x0, D.bot - D.top);
    const scx = shut.getContext('2d');
    scx.fillStyle = '#000';
    scx.fillRect(0, 0, shut.width, shut.height);
    scx.drawImage(sh, D.L.x0, D.top, shut.width, shut.height, 0, 0, shut.width, shut.height);
    out.shutter = encode(shut, false);

    for (const [name, fn] of [['fan-blades', Sc.fanBlades], ['fan-cage', Sc.fanCage]]) {
      const cv = Art.canvas(OFFICE.FAN.size, OFFICE.FAN.size);
      const cc = cv.getContext('2d');
      cc.translate(OFFICE.FAN.size / 2, OFFICE.FAN.size / 2);
      fn(cc);
      out[name] = encode(cv, true);
    }
    return out;
  }

  function rooms() {
    const out = {};
    for (const room of L.ROOMS_DRAWN) {
      const cv = Art.canvas(L.ROOM_W, H);
      Sc.ROOM_DRAW[room](cv.getContext('2d'));
      out['room-' + room] = encode(cv, false);
    }
    out.curtain = encode(Sc.buildCurtain(), false);
    return out;
  }

  function sprites() {
    const out = {};
    for (const s of L.spriteList()) out[s.name] = encode(Art.sprite(s.who, s.pose, s.eyes, s.light).cv, true);
    return out;
  }

  function heads() {
    const out = {};
    const { size, cx, cy, scale } = L.HEAD;
    for (const h of L.headList()) {
      const cv = Art.canvas(size, size);
      Art.drawHeadCloseup(cv.getContext('2d'), h.who, cx, cy, scale, h.jaw, h.eyes, 0);
      out[h.name] = encode(cv, true);
    }
    return out;
  }

  // Six frames of TV static stacked vertically; the game steps through them.
  function noise() {
    const fw = 320, fh = 180, n = 6;
    const cv = Art.canvas(fw, fh * n);
    const c = cv.getContext('2d');
    const img = c.createImageData(fw, fh * n);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.random() * 256;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return { noise: encode(cv, false) };
  }

  window.buildAssets = function () {
    return { ...office(), ...rooms(), ...sprites(), ...heads(), ...noise() };
  };
})();
