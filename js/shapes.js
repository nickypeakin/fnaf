// Block geometry: which boxes (in 1/16ths of a block) make up each block shape, which texture each
// face uses, collision boxes, light emission, and the block state chosen when a player places it.
// Shared by the mesher (worker), physics and raycasting (page).
(function (G) {
  'use strict';
  const MC = G.MC;
  const B = MC.B, BLOCKS = MC.BLOCKS;
  const { blockId, blockState } = MC;

  // Horizontal facing: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x).
  const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  MC.DIR = DIR;
  // Face index (see MC.FACES) for each horizontal facing.
  MC.FACING_FACE = [5, 0, 4, 1];
  MC.FACE_FACING = { 5: 0, 0: 1, 4: 2, 1: 3 };

  // Rotate a north-facing box clockwise (seen from above) by f quarter turns.
  function rot(box, f) {
    let [x0, y0, z0, x1, y1, z1] = box;
    for (let i = 0; i < f; i++) {
      const nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1;
      x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1;
    }
    return [x0, y0, z0, x1, y1, z1, box[6]];
  }
  const flipY = (b) => [b[0], 16 - b[4], b[2], b[3], 16 - b[1], b[5], b[6]];

  const FULL = [[0, 0, 0, 16, 16, 16]];
  const cache = new Map();

  const connects = (v, self) => {
    const b = BLOCKS[blockId(v)];
    if (!b) return false;
    if (b.opaque) return true;
    if (self === 'fence') return b.shape === 'fence' || b.shape === 'gate';
    if (self === 'wall') return b.shape === 'wall';
    if (self === 'pane') return b.shape === 'pane' || b.shape === 'glass' || b.shape === 'tglass';
    return false;
  };

  // nb(dx, dy, dz) returns the neighbouring block value (only needed for fences, walls and panes).
  MC.shapeBoxes = function (v, nb) {
    const id = blockId(v), st = blockState(v);
    const b = BLOCKS[id];
    switch (b.shape) {
      case 'fence': case 'wall': case 'pane': {
        const out = [];
        if (b.shape === 'fence') out.push([6, 0, 6, 10, 16, 10]);
        else if (b.shape === 'wall') out.push([4, 0, 4, 12, 16, 12]);
        else out.push([7, 0, 7, 9, 16, 9]);
        for (let f = 0; f < 4; f++) {
          const [dx, dz] = DIR[f];
          if (!nb || !connects(nb(dx, 0, dz), b.shape)) continue;
          if (b.shape === 'fence') { out.push(rot([7, 12, 0, 9, 15, 6], f)); out.push(rot([7, 6, 0, 9, 9, 6], f)); }
          else if (b.shape === 'wall') out.push(rot([5, 0, 0, 11, 14, 4], f));
          else out.push(rot([7, 0, 0, 9, 16, 7], f));
        }
        return out;
      }
    }
    const key = v;
    let r = cache.get(key);
    if (r) return r;
    r = shapeOf(b, st);
    cache.set(key, r);
    return r;
  };

  function shapeOf(b, st) {
    switch (b.shape) {
      case 'cube': case 'leaves': case 'glass': case 'tglass': case 'liquid': return FULL;
      case 'slab': return st === 2 ? FULL : st === 1 ? [[0, 8, 0, 16, 16, 16]] : [[0, 0, 0, 16, 8, 16]];
      case 'stairs': {
        const f = st & 3, top = st & 4;
        let boxes = [[0, 0, 0, 16, 8, 16], rot([0, 8, 0, 16, 16, 8], f)];
        if (top) boxes = boxes.map(flipY);
        return boxes;
      }
      case 'gate': {
        const f = st & 3, open = st & 4;
        if (open) return [rot([0, 5, 7, 2, 16, 9], f), rot([14, 5, 7, 16, 16, 9], f)];
        return [rot([0, 5, 7, 16, 15, 9], f)];
      }
      case 'door': {
        const f = st & 3, open = st & 4;
        return [rot(open ? [0, 0, 0, 3, 16, 16] : [0, 0, 0, 16, 16, 3], f)];
      }
      case 'trapdoor': {
        const f = st & 3, open = st & 4, top = st & 8;
        if (open) return [rot([0, 0, 13, 16, 16, 16], f)];
        return [top ? [0, 13, 0, 16, 16, 16] : [0, 0, 0, 16, 3, 16]];
      }
      case 'ladder': return [rot([0, 0, 0, 16, 16, 1], st & 3)];
      case 'flat': {
        if (b.key === 'spore_blossom') return [[1, 15, 1, 15, 16, 15]];
        if (b.key === 'big_dripleaf') return [[0, 14, 0, 16, 15, 16], [7, 0, 7, 9, 14, 9, 'stem']];
        // glow lichen: a thin layer on one face of the block
        const f = st % 6;
        if (f === 2) return [[0, 15, 0, 16, 16, 16]];
        if (f === 3) return [[0, 0, 0, 16, 1, 16]];
        return [rot([0, 0, 0, 16, 16, 1], f)];
      }
      case 'torch': {
        if (st === 0) return [[7, 0, 7, 9, 13, 9]];
        return [rot([7, 3, 0, 9, 16, 2], (st - 1) & 3)];
      }
      case 'lantern': return st ? [[5, 1, 5, 11, 8, 11], [6, 8, 6, 10, 10, 10]] : [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]];
      case 'carpet': return [[0, 0, 0, 16, 1, 16]];
      case 'layer': return [[0, 0, 0, 16, 2, 16]];
      case 'plate': return [[1, 0, 1, 15, 1, 15]];
      case 'button': {
        const f = st % 6;
        if (f === 2 || f === 3) return [[5, f === 3 ? 14 : 0, 6, 11, f === 3 ? 16 : 2, 10]];
        return [rot([5, 6, 0, 11, 10, 2], f >= 4 ? (f === 4 ? 2 : 0) : f === 0 ? 1 : 3)];
      }
      case 'bed': return [[0, 3, 0, 16, 9, 16], [0, 0, 0, 3, 3, 3], [13, 0, 13, 16, 3, 16]];
      case 'cactus': return [[1, 0, 1, 15, 16, 15]];
      case 'chest': return [[1, 0, 1, 15, 14, 15]];
      case 'candle': return [[7, 0, 7, 9, 6, 9]];
      case 'rod': return [[7, 0, 7, 9, 13, 9], [6, 12, 6, 10, 16, 10]];
      case 'chain': return st === 1 ? [[0, 7, 7, 16, 9, 9]] : st === 2 ? [[7, 7, 0, 9, 9, 16]] : [[7, 0, 7, 9, 16, 9]];
      case 'cake': return [[1, 0, 1, 15, 8, 15]];
      case 'campfire': return [[0, 0, 0, 16, 4, 16]];
      default: return FULL;
    }
  }

  // Boxes used for walking into things (block units). Fences and walls are 1.5 tall.
  MC.collisionBoxes = function (v, nb) {
    const b = BLOCKS[blockId(v)];
    if (!b || !b.solid) return null;
    if (b.shape === 'gate' && (blockState(v) & 4)) return null;
    const boxes = MC.shapeBoxes(v, nb);
    const tall = b.shape === 'fence' || b.shape === 'wall' || b.shape === 'gate';
    return boxes.map((x) => [x[0] / 16, x[1] / 16, x[2] / 16, x[3] / 16, tall ? 1.5 : x[4] / 16, x[5] / 16]);
  };

  // Boxes used when aiming at a block (plants get a slightly smaller box).
  MC.selectBoxes = function (v, nb) {
    const b = BLOCKS[blockId(v)];
    if (!b || b.shape === 'none' || b.shape === 'liquid') return null;
    if (b.shape === 'cross') return [[2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16]];
    return MC.shapeBoxes(v, nb).map((x) => [x[0] / 16, x[1] / 16, x[2] / 16, x[3] / 16, x[4] / 16, x[5] / 16]);
  };

  // Texture name for one face of a block, honouring log axis, facing fronts and door halves.
  MC.faceTexName = function (v, face) {
    const b = BLOCKS[blockId(v)], st = blockState(v);
    const t = b.tex;
    if (b.key === 'wheat') return 'wheat_stage' + Math.min(7, st);
    if (b.key === 'cave_vines') return st & 1 ? 'cave_vines_lit' : 'cave_vines';
    if (typeof t === 'string') return t;
    if (t.end) {
      const axis = b.state === 'axis' ? st : 0;
      const faceAxis = face <= 1 ? 1 : face <= 3 ? 0 : 2;
      return faceAxis === axis ? t.end : t.side;
    }
    if (b.shape === 'door') return st & 8 ? t.top : t.bottom;
    if (t.front && (b.state === 'facing' || b.state === 'facing_lit')) {
      if (MC.FACING_FACE[st & 3] === face) return t.front;
    } else if (t.front && face === 5) return t.front;
    if (face === 2) return t.top || t.side;
    if (face === 3) return t.bottom || t.top || t.side;
    return t.side || t.top;
  };

  // Light a block gives off; some depend on state (a lit furnace, a lamp switched on).
  MC.lightOf = function (v) {
    const b = BLOCKS[blockId(v)];
    if (!b) return 0;
    const st = blockState(v);
    if (b.state === 'facing_lit') return st & 4 ? 13 : 0;
    if (b.state === 'lit') return st & 1 ? 15 : 0;
    if (b.state === 'berries') return st & 1 ? 14 : 0;
    return b.light;
  };

  // How much light a block blocks (0 = clear, 15 = solid).
  const OPACITY = new Uint8Array(BLOCKS.length);
  for (const b of BLOCKS) OPACITY[b.id] = b.opacity;
  MC.OPACITY = OPACITY;
  const EMIT = new Uint8Array(BLOCKS.length);
  for (const b of BLOCKS) EMIT[b.id] = b.light || (b.state === 'lit' || b.state === 'facing_lit' || b.state === 'berries' ? 1 : 0);
  MC.EMIT = EMIT;

  // ---- placement: choose a state from where the player clicked ----
  // ctx: {face: face index clicked (on the block we placed against), hy: hit height 0..1, yaw}
  MC.facingFromYaw = function (yaw) {
    // yaw 0 looks toward -z (north); increases turning left (toward -x)
    const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const q = Math.round(a / (Math.PI / 2)) % 4; // 0 north, 1 west, 2 south, 3 east
    return [0, 3, 2, 1][q];
  };

  MC.placeState = function (b, ctx) {
    const look = MC.facingFromYaw(ctx.yaw);
    const toPlayer = (look + 2) & 3;
    const upperHalf = ctx.face === 3 || (ctx.face !== 2 && ctx.hy > 0.5);
    switch (b.state) {
      case 'axis': return ctx.face <= 1 ? 1 : ctx.face >= 4 ? 2 : 0;
      case 'facing': case 'facing_lit': return b.shape === 'ladder' ? wallFacing(ctx.face, look) : toPlayer;
      case 'stairs': return look | (upperHalf ? 4 : 0);
      case 'slab': return upperHalf ? 1 : 0;
      case 'door': return look;
      case 'gate': return look;
      case 'trapdoor': return look | (upperHalf ? 8 : 0);
      case 'torch': return ctx.face === 2 || ctx.face === 3 ? 0 : 1 + wallFacing(ctx.face, look);
      case 'face': return b.shape === 'flat' ? flatFace(ctx.face) : ctx.face;
      case 'face6': return ctx.face;
      case 'hanging': return ctx.face === 3 ? 1 : 0;
      default: return 0;
    }
  };
  // Direction from this block toward the wall it hangs on.
  function wallFacing(face, look) {
    if (face === 0) return 3; // clicked the east side of a block: wall is to our west
    if (face === 1) return 1;
    if (face === 4) return 0;
    if (face === 5) return 2;
    return look;
  }
  function flatFace(face) {
    if (face === 2) return 3;
    if (face === 3) return 2;
    return wallFacing(face, 0);
  }
})(globalThis);
