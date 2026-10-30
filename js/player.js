// The local player's body: walking, sprinting, sneaking (with edge guard), jumping, swimming,
// climbing, flying in creative, step-up onto slabs, fall damage and collisions with block boxes.
(function (G) {
  'use strict';
  const MC = G.MC;

  const W = 0.3; // half width of the player's box
  const GRAVITY = 32, JUMP = 9.0, TERMINAL = 78;
  const SPEED = { walk: 4.317, sprint: 5.612, sneak: 1.31, fly: 10.9, flySprint: 21.8, swim: 2.2 };

  class Player {
    constructor(world) {
      this.world = world;
      this.x = 0.5; this.y = 100; this.z = 0.5;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.yaw = 0; this.pitch = 0;
      this.onGround = false;
      this.flying = false;
      this.sneaking = false;
      this.sprinting = false;
      this.mode = 'survival';
      this.fallDist = 0;
      this.inWater = false; this.inLava = false; this.eyeInWater = false; this.eyeInLava = false;
      this.inPowder = false; this.climbing = false;
      this.bob = 0; this.walkDist = 0;
      this.frozen = true; // until the chunks around the spawn are loaded
      this.boxes = [];
      this.onLand = null; // (fallDistance) -> void
      this.onStep = null; // footstep sounds
      this.lastStep = 0;
      this.noclip = false;
    }

    get height() { return this.sneaking && !this.flying ? 1.5 : 1.8; }
    get eye() { return this.y + (this.sneaking && !this.flying ? 1.27 : 1.62); }

    look() {
      const cp = Math.cos(this.pitch);
      return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
    }

    // input: {forward, back, left, right, jump, sneak, sprint}
    update(dt, input) {
      if (this.frozen) { this.vx = this.vy = this.vz = 0; return; }
      const w = this.world;
      const creative = this.mode === 'creative' || this.mode === 'spectator';
      if (!creative) this.flying = false;
      if (this.mode === 'spectator') this.flying = true;
      this.noclip = this.mode === 'spectator';
      this.sneaking = !!input.sneak && !this.flying;

      const t = w.touching(this.x - W, this.y, this.z - W, this.x + W, this.y + this.height, this.z + W);
      this.inWater = t.water; this.inLava = t.lava; this.climbing = t.climb && !this.flying; this.inPowder = t.powder;
      const ey = Math.floor(this.eye);
      const eb = w.def(Math.floor(this.x), ey, Math.floor(this.z));
      this.eyeInWater = !!(eb && eb.liquid === 'water');
      this.eyeInLava = !!(eb && eb.liquid === 'lava');
      const inFluid = this.inWater || this.inLava;

      // wanted horizontal direction
      let fx = 0, fz = 0;
      if (input.forward) fz -= 1;
      if (input.back) fz += 1;
      if (input.left) fx -= 1;
      if (input.right) fx += 1;
      const len = Math.hypot(fx, fz);
      if (len > 0) { fx /= len; fz /= len; }
      if (!input.forward || this.sneaking || (this.food != null && this.food <= 6 && !creative)) this.sprinting = false;
      else if (input.sprint) this.sprinting = true;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      // rotate (fx, fz) by yaw: forward is (-sin, -cos)
      const dx = fx * cy + fz * sy, dz = -fx * sy + fz * cy;

      let speed = this.flying ? (this.sprinting ? SPEED.flySprint : SPEED.fly)
        : this.sneaking ? SPEED.sneak : this.sprinting ? SPEED.sprint : SPEED.walk;
      if (inFluid && !this.flying) speed = this.inLava ? 1.2 : this.sprinting ? 3.6 : SPEED.swim;
      if (t.web) speed *= 0.25;
      if (this.inPowder) speed *= 0.6;
      if (this.usingItem) speed *= 0.3;

      const accel = this.flying ? 10 : this.onGround ? 22 : inFluid ? 8 : 5;
      const k = Math.min(1, accel * dt);
      this.vx += (dx * speed - this.vx) * k;
      this.vz += (dz * speed - this.vz) * k;

      if (this.flying) {
        let vyT = 0;
        if (input.jump) vyT += SPEED.fly * 0.75;
        if (input.sneak || input.down) vyT -= SPEED.fly * 0.75;
        this.vy += (vyT - this.vy) * Math.min(1, 12 * dt);
        this.sneaking = false;
      } else if (inFluid) {
        this.vy -= (this.inLava ? 6 : 9) * dt;
        this.vy *= Math.pow(this.inLava ? 0.1 : 0.2, dt);
        if (input.jump) this.vy = Math.min(this.vy + 28 * dt, this.inLava ? 2 : 3.4);
        if (input.sneak) this.vy -= 8 * dt;
        // hop out of the water onto a ledge
        if (input.jump && this.hitWall && !this.eyeInWater) this.vy = 6.5;
      } else if (this.climbing) {
        this.vy -= GRAVITY * dt;
        if (input.jump || (this.hitWall && len > 0)) this.vy = 2.6;
        else if (this.sneaking) this.vy = 0;
        else this.vy = Math.max(this.vy, -2.6);
      } else if (this.inPowder) {
        this.vy = input.jump ? 1.5 : -1.2;
      } else {
        this.vy -= GRAVITY * dt;
        if (t.web) this.vy = Math.max(this.vy, -1);
        if (input.jump && this.onGround) {
          this.vy = JUMP;
          if (this.sprinting) { this.vx += -sy * 2.2; this.vz += -cy * 2.2; }
          if (this.onJump) this.onJump();
        }
      }
      if (this.vy < -TERMINAL) this.vy = -TERMINAL;

      // move
      let mx = this.vx * dt, my = this.vy * dt, mz = this.vz * dt;
      if (t.web) { my *= 0.3; }
      const wasGround = this.onGround;
      const startY = this.y;
      if (this.noclip) { this.x += mx; this.y += my; this.z += mz; this.onGround = false; }
      else this.moveCollide(mx, my, mz, wasGround);

      // fall damage
      if (this.onGround) {
        if (this.fallDist > 0 && this.onLand) this.onLand(this.fallDist);
        this.fallDist = 0;
      } else if (this.y < startY) this.fallDist += startY - this.y;
      if (inFluid || this.climbing || this.flying || this.inPowder || t.web) this.fallDist = 0;
      if (this.flying && this.onGround && this.mode !== 'spectator') this.flying = false;

      // walking bob and footsteps
      const hs = Math.hypot(this.vx, this.vz);
      if (this.onGround && hs > 0.5) {
        this.walkDist += hs * dt;
        if (this.walkDist - this.lastStep > (this.sprinting ? 2.2 : 1.8)) {
          this.lastStep = this.walkDist;
          if (this.onStep && !this.sneaking) this.onStep();
        }
      }
      this.bob += ((this.onGround && !this.flying ? Math.min(1, hs / 4.3) : 0) - this.bob) * Math.min(1, dt * 10);

      if (this.y < MC.MIN_Y - 64) this.y = MC.MIN_Y - 64; // the void
    }

    // Axis-separated movement against block boxes, with sneaking edge guard and step-up.
    moveCollide(mx, my, mz, wasGround) {
      const h = this.height;
      const sneakGuard = this.sneaking && wasGround && !this.flying;
      if (sneakGuard) {
        // don't walk off ledges while sneaking
        const step = 0.05;
        while (mx !== 0 && !this.groundBelow(this.x + mx, this.z)) mx = Math.abs(mx) < step ? 0 : mx - Math.sign(mx) * step;
        while (mz !== 0 && !this.groundBelow(this.x, this.z + mz)) mz = Math.abs(mz) < step ? 0 : mz - Math.sign(mz) * step;
        while (mx !== 0 && mz !== 0 && !this.groundBelow(this.x + mx, this.z + mz)) {
          mx = Math.abs(mx) < step ? 0 : mx - Math.sign(mx) * step;
          mz = Math.abs(mz) < step ? 0 : mz - Math.sign(mz) * step;
        }
      }
      const r = this.sweep(this.x, this.y, this.z, mx, my, mz, h);
      // try stepping up 0.6 blocks if we bumped into something while on the ground
      if ((wasGround || this.climbing) && (r.hx || r.hz) && my <= 0) {
        const up = this.sweep(this.x, this.y, this.z, 0, 0.6, 0, h);
        const side = this.sweep(up.x, up.y, up.z, mx, 0, mz, h);
        const down = this.sweep(side.x, side.y, side.z, 0, -(up.y - this.y) + Math.min(0, my), 0, h);
        const d0 = (r.x - this.x) ** 2 + (r.z - this.z) ** 2, d1 = (down.x - this.x) ** 2 + (down.z - this.z) ** 2;
        if (d1 > d0 + 1e-6 && down.hy) {
          this.stepUp = down.y - r.y;
          Object.assign(r, down);
          r.hy = true; r.hitDown = true;
        }
      }
      this.hitWall = r.hx || r.hz;
      if (r.hx) this.vx = 0;
      if (r.hz) this.vz = 0;
      if (r.hy) this.vy = 0;
      this.onGround = r.hitDown;
      this.x = r.x; this.y = r.y; this.z = r.z;
    }

    groundBelow(x, z) {
      const out = this.world.boxesIn(x - W + 0.001, this.y - 0.6, z - W + 0.001, x + W - 0.001, this.y - 0.001, z + W - 0.001, this.boxes);
      for (const b of out) if (b[4] > this.y - 0.6 && b[1] < this.y && b[0] < x + W && b[3] > x - W && b[2] < z + W && b[5] > z - W) return true;
      return false;
    }

    sweep(x, y, z, mx, my, mz, h) {
      const boxes = this.world.boxesIn(
        Math.min(x - W, x - W + mx), Math.min(y, y + my), Math.min(z - W, z - W + mz),
        Math.max(x + W, x + W + mx), Math.max(y + h, y + h + my), Math.max(z + W, z + W + mz), this.boxes);
      const E = 1e-7;
      const r = { x, y, z, hx: false, hy: false, hz: false, hitDown: false };
      // y
      for (const b of boxes) {
        if (b[0] >= r.x + W - E || b[3] <= r.x - W + E || b[2] >= r.z + W - E || b[5] <= r.z - W + E) continue;
        if (my < 0 && b[4] <= r.y + E && b[4] > r.y + my) { my = b[4] - r.y; r.hy = true; r.hitDown = true; }
        else if (my > 0 && b[1] >= r.y + h - E && b[1] < r.y + h + my) { my = b[1] - (r.y + h); r.hy = true; }
      }
      r.y += my;
      // x
      for (const b of boxes) {
        if (b[1] >= r.y + h - E || b[4] <= r.y + E || b[2] >= r.z + W - E || b[5] <= r.z - W + E) continue;
        if (mx < 0 && b[3] <= r.x - W + E && b[3] > r.x - W + mx) { mx = b[3] - (r.x - W); r.hx = true; }
        else if (mx > 0 && b[0] >= r.x + W - E && b[0] < r.x + W + mx) { mx = b[0] - (r.x + W); r.hx = true; }
      }
      r.x += mx;
      // z
      for (const b of boxes) {
        if (b[1] >= r.y + h - E || b[4] <= r.y + E || b[0] >= r.x + W - E || b[3] <= r.x - W + E) continue;
        if (mz < 0 && b[5] <= r.z - W + E && b[5] > r.z - W + mz) { mz = b[5] - (r.z - W); r.hz = true; }
        else if (mz > 0 && b[2] >= r.z + W - E && b[2] < r.z + W + mz) { mz = b[2] - (r.z + W); r.hz = true; }
      }
      r.z += mz;
      return r;
    }

    // Is the block cell overlapping the player's body? (to stop placing blocks inside yourself)
    intersects(x0, y0, z0, x1, y1, z1) {
      return x0 < this.x + W && x1 > this.x - W && y0 < this.y + this.height && y1 > this.y && z0 < this.z + W && z1 > this.z - W;
    }

    // If stuck inside a block (after placing sand on yourself etc.), nudge upward.
    unstick() {
      const out = this.world.boxesIn(this.x - W + 0.01, this.y + 0.01, this.z - W + 0.01, this.x + W - 0.01, this.y + this.height - 0.01, this.z + W - 0.01, this.boxes);
      for (const b of out) {
        if (b[0] < this.x + W - 0.01 && b[3] > this.x - W + 0.01 && b[1] < this.y + this.height - 0.01 && b[4] > this.y + 0.01 && b[2] < this.z + W - 0.01 && b[5] > this.z - W + 0.01) {
          this.y = Math.max(this.y, b[4]);
        }
      }
    }
  }

  Player.WIDTH = W * 2;
  MC.Player = Player;
})(globalThis);
