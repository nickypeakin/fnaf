// Where things are on screen. Shared by the game (which places images and
// page elements) and tools/build-assets (which draws those images), so the
// two always agree. All coordinates are in the 1280x720 game space.
(function () {
  'use strict';
  const FN = window.FN;

  // The office is a 1600px-wide panorama you look around in.
  const DOOR = { L: { x0: 82, x1: 272 }, R: { x0: 1328, x1: 1518 }, top: 128, bot: 600 };
  const POSTER = { x: 420, y: 150, w: 200, h: 250 };
  const OFFICE = {
    W: 1600,
    DOOR,
    PANEL: { L: 318, R: 1282 }, // button column x
    BTN: { door: 356, light: 428, r: 21 },
    POSTER,
    // Freddy's nose on the poster (it honks).
    NOSE: { x: POSTER.x + POSTER.w * 0.5, y: POSTER.y + POSTER.h * 1.12 + (-478 + 4) * (POSTER.w / 600) * 1.15, r: 9 },
    SCREENS: [[716, 360, 178, 118], [608, 408, 104, 76]],
    FAN: { x: 1011, y: 400, size: 140 },
    // Where an animatronic stands once it's inside (feet x, feet y, scale).
    INVADER: { L: [430, 830, 1.3], R: [1170, 830, 1.3] },
  };

  // Each camera image is 1480px wide and pans slowly back and forth.
  const ROOM_W = 1480;

  // Who stands where on each camera: feet x, feet y, scale, eye style, brightness.
  const SPOTS = {
    '1A': { freddy: [740, 615, 0.7, 'normal', 0.85], bonnie: [500, 618, 0.66, 'normal', 0.8], chica: [990, 618, 0.66, 'normal', 0.8] },
    '1B': { bonnie: [300, 650, 0.6, 'normal', 0.6], chica: [1180, 650, 0.6, 'normal', 0.6], freddy: [760, 470, 0.32, 'glow', 0.3] },
    '2A': { bonnie: [740, 590, 0.42, 'dark', 0.5] },
    '2B': { bonnie: [880, 1030, 1.45, 'empty', 0.45] },
    '3': { bonnie: [760, 780, 0.95, 'dark', 0.45] },
    '4A': { chica: [640, 615, 0.46, 'normal', 0.6], freddy: [860, 605, 0.44, 'glow', 0.4] },
    '4B': { chica: [900, 1030, 1.4, 'dark', 0.45], freddy: [430, 1000, 1.25, 'glow', 0.35] },
    '5': { bonnie: [880, 930, 1.2, 'dark', 0.45] },
    '7': { chica: [700, 670, 0.64, 'normal', 0.6], freddy: [960, 680, 0.62, 'glow', 0.4] },
  };
  // Darkness per camera: light centre x, y and how dark the edges get.
  const ROOM_LIGHT = {
    '1A': [740, 330, 0.55], '1B': [740, 380, 0.7], '1C': [740, 360, 0.65], '2A': [740, 380, 0.72], '2B': [880, 380, 0.65],
    '3': [760, 400, 0.7], '4A': [740, 380, 0.72], '4B': [600, 380, 0.65], '5': [760, 380, 0.7], '7': [800, 380, 0.7],
  };

  // Pirate Cove: the curtained stage, how far the curtains part at each of Foxy's stages, and where he shows up.
  const COVE = {
    rect: [430, 120, 620, 440],
    gaps: [0, 70, 380, 420],
    peek: ['foxy', 760, 760, 0.62, 'normal', 0.5],
    out: ['foxy', 740, 650, 0.68, 'normal', 0.7],
  };
  const FOXY_RUN = ['foxy', 'run', 'normal', 0.75];
  const INVADER_LOOK = ['dark', 0.55];

  // The camera map, drawn at (860, 340).
  const MAP = {
    x: 860, y: 340,
    rooms: {
      '1A': [148, 6, 124, 46], '1B': [100, 60, 220, 118], '1C': [50, 112, 44, 56], '5': [6, 58, 60, 48],
      '7': [330, 60, 62, 92], '6': [320, 190, 72, 72], '2A': [128, 186, 44, 128], '3': [62, 246, 60, 44],
      '2B': [128, 314, 44, 40], '4A': [248, 186, 44, 128], '4B': [248, 314, 44, 40], OF: [184, 306, 52, 48],
      LD: [172, 316, 12, 32], RD: [236, 316, 12, 32],
    },
    cams: {
      '1A': [184, 12], '1B': [140, 120], '1C': [36, 168], '5': [6, 108], '7': [350, 106], '6': [342, 232],
      '2A': [118, 230], '3': [52, 296], '2B': [118, 334], '4A': [262, 230], '4B': [262, 334],
    },
  };

  // Character images: drawn at scale 1 on a 600x820 sheet with the feet at (300, 800).
  const SPRITE = { w: 600, h: 820, ox: 300, oy: 800 };
  // Close-up heads (jumpscares, title screen): a 1000x1000 sheet, head centre at (500, 520), drawn at scale 2.
  const HEAD = { size: 1000, cx: 500, cy: 520, scale: 2 };

  const spriteName = (who, pose, eyes, light) => `spr-${who}-${pose}-${eyes}-${Math.round(light * 100)}`;

  // Every character image the game needs, so the builder can draw them and the game can preload them.
  function spriteList() {
    const list = [];
    const add = (who, pose, eyes, light) => {
      const name = spriteName(who, pose, eyes, light);
      if (!list.some((s) => s.name === name)) list.push({ name, who, pose, eyes, light });
    };
    for (const room of Object.values(SPOTS)) {
      for (const [who, spot] of Object.entries(room)) add(who, 'stand', spot[3], spot[4]);
    }
    add(COVE.peek[0], 'stand', COVE.peek[4], COVE.peek[5]);
    add(COVE.out[0], 'stand', COVE.out[4], COVE.out[5]);
    add(...FOXY_RUN);
    for (const who of ['freddy', 'bonnie', 'chica']) add(who, 'stand', ...INVADER_LOOK);
    return list;
  }

  const JAWS = { a: 0.5, b: 1 };
  const headName = (who, jaw, eyes) => `head-${who}-${jaw}-${eyes}`;
  function headList() {
    const list = [];
    for (const who of FN.CHARS) {
      const eyes = who === 'freddy' ? 'glow' : 'dark';
      for (const jaw of Object.keys(JAWS)) list.push({ name: headName(who, jaw, eyes), who, jaw: JAWS[jaw], eyes });
    }
    list.push({ name: headName('freddy', 'shut', 'normal'), who: 'freddy', jaw: 0, eyes: 'normal' });
    list.push({ name: headName('freddy', 'shut', 'dark'), who: 'freddy', jaw: 0, eyes: 'dark' });
    return list;
  }

  const ROOMS_DRAWN = ['1A', '1B', '1C', '2A', '2B', '3', '4A', '4B', '5', '7'];

  FN.LAYOUT = {
    OFFICE, ROOM_W, SPOTS, ROOM_LIGHT, COVE, FOXY_RUN, INVADER_LOOK, MAP, SPRITE, HEAD, ROOMS_DRAWN,
    spriteName, spriteList, headName, headList,
  };
})();
