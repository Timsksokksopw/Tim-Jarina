import { GlyphAtlas, MAX_LIGHT, hueIndex } from './glyphs';
import type { Flower } from './flower2d';
import type { Rain } from './rain';
import { Bloom, type Desc, type Out } from './bloom3d';
import { TAU, clamp, easeInCubic, easeInOutCubic, easeOutCubic, lerp, rand, smoothstep } from './util';

const NOISE = 0;
const FLYING = 1;
const LOCKED = 2;
const DEAD = 3;

export const FORM_START = 1.6;
const FORM_SPREAD = 8.6;
export const T_IMPLODE = 1.5;
export const T_BURST = 2.7;

const POINTER_R = 110;
const BUCKETS = 48;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  // flight: quadratic bezier start/control
  sx: number;
  sy: number;
  kx: number;
  ky: number;
  t0: number;
  dur: number;
  // formation target
  tx: number;
  ty: number;
  col: number;
  row: number;
  hue: number;
  light: number;
  // noise look before being called
  nh: number;
  nl: number;
  na: number;
  born: number;
  glyph: number;
  flipAt: number;
  callAt: number;
  state: number;
  lockAt: number;
  alpha: number;
  // pointer spring offset
  ox: number;
  oy: number;
  ovx: number;
  ovy: number;
  seed: number;
  // finale
  d: Desc | null;
  fx: number;
  fy: number;
  z: number;
  size: number;
  fh: number;
  fl: number;
  fa: number;
}

export class Swarm {
  ps: P[] = [];
  /** Trail strength of the scene canvas (destination-out alpha per frame). */
  fade = 0.34;
  /** Fraction of the flower that is assembled. */
  progress = 0;
  finaleAt = -1;
  readonly bloom = new Bloom();
  private w = 0;
  private h = 0;
  private flower: Flower | null = null;
  private readonly out: Out = { x: 0, y: 0, z: 0, s: 1, hue: 0, light: 0, a: 1 };
  private glitchUntil = -1;
  private rippleAt = -10;
  private scanFrom = -1;
  private px = 0;
  private py = 0;
  private pointerUntil = -1;
  private readonly bands = new Float32Array(64);
  private order = new Uint32Array(0);
  private bucket = new Uint8Array(0);
  private readonly counts = new Uint32Array(BUCKETS + 1);
  private sizeF = 1;

  constructor(
    private readonly atlas: GlyphAtlas,
    private readonly atlasF: GlyphAtlas,
    private readonly rain: Rain,
  ) {}

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  private spawn(now: number): P {
    return {
      x: rand(0, this.w),
      y: rand(0, this.h),
      vx: rand(-5, 5),
      vy: rand(3, 16),
      sx: 0,
      sy: 0,
      kx: 0,
      ky: 0,
      t0: 0,
      dur: 1,
      tx: 0,
      ty: 0,
      col: 0,
      row: 0,
      hue: 0,
      light: 0,
      nh: hueIndex(rand(0, 360)),
      nl: Math.random() < 0.7 ? 1 : 2,
      na: rand(0.3, 0.75),
      born: now + rand(0.05, 1.4),
      glyph: Math.random() < 0.5 ? 0 : 1,
      flipAt: now + rand(0, 0.8),
      callAt: Infinity,
      state: NOISE,
      lockAt: 0,
      alpha: 1,
      ox: 0,
      oy: 0,
      ovx: 0,
      ovy: 0,
      seed: Math.random(),
      d: null,
      fx: 0,
      fy: 0,
      z: 0,
      size: 1,
      fh: 0,
      fl: 0,
      fa: 1,
    };
  }

  private fly(p: P, now: number, dur: number) {
    const bend = rand(-0.45, 0.45);
    p.sx = p.x;
    p.sy = p.y;
    p.kx = (p.x + p.tx) / 2 - (p.ty - p.y) * bend;
    p.ky = (p.y + p.ty) / 2 + (p.tx - p.x) * bend;
    p.t0 = now;
    p.dur = dur;
    p.state = FLYING;
  }

  setFlower(f: Flower, now: number) {
    this.flower = f;
    const T = f.targets;
    this.rain.clearMarks();
    while (this.ps.length < T.length) this.ps.push(this.spawn(now));
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      if (i >= T.length) {
        if (p.state !== DEAD) {
          p.state = DEAD;
          p.alpha = 1;
        }
        continue;
      }
      const t = T[i];
      const moved = p.tx !== t.x || p.ty !== t.y;
      p.tx = t.x;
      p.ty = t.y;
      p.col = t.col;
      p.row = t.row;
      p.hue = t.hue;
      p.light = t.light;
      p.callAt = FORM_START + t.order * FORM_SPREAD + (p.seed - 0.5) * 0.7;
      if (p.state === DEAD) {
        p.state = NOISE;
        p.born = now - 2;
      }
      if (p.state === LOCKED) {
        if (moved) this.fly(p, now, rand(0.7, 1.2));
        else this.rain.mark(p.col, p.row);
      } else if (p.state === FLYING) {
        this.fly(p, now, Math.max(0.5, p.t0 + p.dur - now));
      }
    }
  }

  glitch(now: number) {
    this.glitchUntil = now + 0.55;
  }

  ripple(now: number) {
    this.rippleAt = now;
  }

  startScan(now: number) {
    this.scanFrom = now;
  }

  pointer(x: number, y: number, now: number) {
    this.px = x;
    this.py = y;
    this.pointerUntil = now + 1.2;
  }

  pointerOut() {
    this.pointerUntil = -1;
  }

  /** Tap/click shockwave: kicks nearby glyphs away, the springs pull them back. */
  burst(x: number, y: number) {
    for (const p of this.ps) {
      const dx = p.x + p.ox - x;
      const dy = p.y + p.oy - y;
      const d = Math.hypot(dx, dy);
      if (d > 260 || d < 1e-3) continue;
      const m = (1400 * (1 - d / 260)) / d;
      p.ovx += dx * m;
      p.ovy += dy * m;
    }
  }

  private spring(p: P, dt: number, now: number, damp: number) {
    const active = now < this.pointerUntil;
    if (!active && p.ox * p.ox + p.oy * p.oy + p.ovx * p.ovx + p.ovy * p.ovy < 0.01) {
      p.ox = p.oy = p.ovx = p.ovy = 0;
      return;
    }
    let fx = -60 * p.ox;
    let fy = -60 * p.oy;
    if (active) {
      const dx = p.x + p.ox - this.px;
      const dy = p.y + p.oy - this.py;
      const d2 = dx * dx + dy * dy;
      if (d2 < POINTER_R * POINTER_R && d2 > 1e-3) {
        const d = Math.sqrt(d2);
        const f = 1 - d / POINTER_R;
        const m = (2600 * f * f) / d;
        fx += dx * m;
        fy += dy * m;
      }
    }
    p.ovx = (p.ovx + fx * dt) * damp;
    p.ovy = (p.ovy + fy * dt) * damp;
    p.ox += p.ovx * dt;
    p.oy += p.ovy * dt;
  }

  update(dt: number, now: number) {
    const damp = Math.exp(-8 * dt);
    if (this.finaleAt >= 0) {
      this.updateFinale(dt, now, damp);
      return;
    }
    const { w, h } = this;
    let locked = 0;
    for (const p of this.ps) {
      if (p.state === NOISE) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > h + 12) {
          p.y = -12;
          p.x = rand(0, w);
        }
        if (p.x < -12) p.x = w + 12;
        else if (p.x > w + 12) p.x = -12;
        if (now >= p.callAt) this.fly(p, now, rand(1.5, 2.4));
      } else if (p.state === FLYING) {
        const k = clamp((now - p.t0) / p.dur, 0, 1);
        const e = easeInOutCubic(k);
        const u = 1 - e;
        p.x = u * u * p.sx + 2 * u * e * p.kx + e * e * p.tx;
        p.y = u * u * p.sy + 2 * u * e * p.ky + e * e * p.ty;
        if (k >= 1) {
          p.state = LOCKED;
          p.lockAt = now;
          this.rain.mark(p.col, p.row);
        }
      } else if (p.state === DEAD) {
        p.alpha -= dt * 1.5;
      }
      if (p.state === LOCKED) locked++;
      if (now >= p.flipAt) {
        p.glyph ^= 1;
        p.flipAt = now + (p.state === FLYING ? rand(0.03, 0.14) : p.state === LOCKED ? rand(1.2, 8) : rand(0.1, 0.9));
      }
      this.spring(p, dt, now, damp);
    }
    const ps = this.ps;
    while (ps.length && ps[ps.length - 1].state === DEAD && ps[ps.length - 1].alpha <= 0) ps.pop();
    const total = this.flower ? this.flower.targets.length : 0;
    this.progress = total ? locked / total : 0;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    if (this.finaleAt >= 0) {
      this.drawFinale(ctx, now);
      return;
    }
    const A = this.atlas;
    const f = this.flower;
    const glitch = now < this.glitchUntil;
    if (glitch) for (let i = 0; i < this.bands.length; i++) this.bands[i] = Math.random() < 0.3 ? rand(-28, 28) : 0;

    const band = A.height * 3;
    let scanY = -Infinity;
    if (f && this.scanFrom >= 0) {
      const c = (now - this.scanFrom) % 5.5;
      if (c < 1.8) scanY = f.bounds.y - band + (c / 1.8) * (f.bounds.h + band * 2);
    }
    const rip = now - this.rippleAt;
    const ripOn = f !== null && rip < 1.4;
    const ripR = rip * (f ? f.head.r : 0) * 1.8;
    const ripW = f ? f.head.r * 0.22 : 1;

    let curA = -1;
    for (const p of this.ps) {
      let hue: number;
      let light: number;
      let a: number;
      let x = p.x + p.ox;
      let y = p.y + p.oy;
      if (p.state === NOISE || p.state === DEAD) {
        hue = p.nh;
        light = p.nl;
        a = p.state === DEAD ? Math.max(0, p.alpha) * p.na : p.na * smoothstep(p.born, p.born + 1.2, now);
      } else if (p.state === FLYING) {
        const k = clamp((now - p.t0) / p.dur, 0, 1);
        hue = k < 0.35 ? p.nh : p.hue;
        light = Math.round(lerp(p.nl, Math.min(MAX_LIGHT, p.light + 2), k));
        a = lerp(p.na, 1, k);
      } else {
        const since = now - p.lockAt;
        hue = p.hue;
        light = since < 0.1 ? MAX_LIGHT : Math.round(lerp(MAX_LIGHT, p.light, smoothstep(0.1, 0.8, since)));
        a = 1;
        const dy = Math.abs(p.ty - scanY);
        if (dy < band) light = Math.min(MAX_LIGHT, light + Math.round(2.4 * (1 - dy / band)));
        if (ripOn) {
          const hx = p.tx - f.head.x;
          const hy = p.ty - f.head.y;
          const dd = Math.hypot(hx, hy);
          const q = 1 - Math.abs(dd - ripR) / ripW;
          if (q > 0) {
            light = Math.min(MAX_LIGHT, light + Math.round(3 * q));
            const s = (5 * q) / (dd || 1);
            x += hx * s;
            y += hy * s;
          }
        }
        if (glitch) {
          x += this.bands[Math.floor(p.row / 3) & 63];
          if (Math.random() < 0.35) {
            hue = hueIndex(350);
            light = Math.min(MAX_LIGHT, light + 1);
          }
        }
      }
      if (a <= 0.01) continue;
      if (a !== curA) {
        ctx.globalAlpha = a;
        curA = a;
      }
      A.draw(ctx, hue, light, p.glyph, x, y);
    }
    ctx.globalAlpha = 1;
  }

  layoutFinale(dpr: number) {
    this.bloom.layout(this.w, this.h);
    const font = clamp(this.bloom.S / 30, 5.5, 11);
    this.atlasF.build(font, dpr, 1.7);
    this.sizeF = this.atlas.font / font;
  }

  startFinale(now: number, dpr: number) {
    this.ps = this.ps.filter((p) => p.state !== DEAD);
    this.finaleAt = now;
    // from here on the pointer turns the rose instead of pushing glyphs away
    this.pointerOut();
    this.rain.clearMarks();
    this.layoutFinale(dpr);
    const S = this.bloom.S;
    const descs = this.bloom.makeDescs(Math.max(this.ps.length, clamp(Math.round(S * S * 0.09), 5200, 9000)));
    while (this.ps.length < descs.length) {
      const p = this.spawn(now);
      p.state = LOCKED;
      p.alpha = 0;
      p.x = this.bloom.cx;
      p.y = this.bloom.cy;
      this.ps.push(p);
    }
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      p.d = descs[i];
      p.fx = p.x;
      p.fy = p.y;
    }
    this.order = new Uint32Array(this.ps.length);
    this.bucket = new Uint8Array(this.ps.length);
  }

  private updateFinale(dt: number, now: number, damp: number) {
    const tf = now - this.finaleAt;
    const B = this.bloom;
    const o = this.out;
    B.frame(Math.max(0, tf - T_BURST), dt);
    this.fade = tf < T_IMPLODE ? 0.3 : tf < T_BURST ? 0.14 : lerp(0.12, 0.36, smoothstep(T_BURST, T_BURST + 3.5, tf));

    for (const p of this.ps) {
      if (tf < T_IMPLODE) {
        // overload: the old flower trembles and its colours start racing
        const amp = 7 * smoothstep(0.25, T_IMPLODE, tf);
        p.x = p.fx + rand(-amp, amp);
        p.y = p.fy + rand(-amp, amp);
        p.fh = hueIndex(p.hue * 5 + ((p.fx + p.fy) * 0.45 - tf * 520) * smoothstep(0, 0.6, tf));
        p.fl = Math.min(MAX_LIGHT, p.light + Math.floor(tf * 2.4));
        p.fa = p.alpha;
        p.size = this.sizeF;
        p.z = 0;
      } else if (tf < T_BURST) {
        // implosion: everything spirals into a singularity
        const k = clamp((tf - T_IMPLODE - p.seed * 0.35) / (T_BURST - T_IMPLODE - 0.35), 0, 1);
        const e = easeInCubic(k);
        const dx = p.fx - B.cx;
        const dy = p.fy - B.cy;
        const a = e * (2.4 + p.seed * 2.4);
        const s = 1 - e;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        p.x = B.cx + (dx * c - dy * sn) * s;
        p.y = B.cy + (dx * sn + dy * c) * s;
        p.fh = hueIndex(p.seed * 360 + tf * 240);
        p.fl = k > 0.6 ? MAX_LIGHT : MAX_LIGHT - 1;
        p.fa = p.alpha;
        p.size = this.sizeF * (1 + e * 0.5);
        p.z = 0;
      } else {
        // supernova: unwind along a spiral into the 3D bloom
        const d = p.d!;
        B.place(d, o);
        const k = clamp((tf - T_BURST - d.delay) / d.dur, 0, 1);
        if (k <= 0) {
          const a = tf * 9 + p.seed * TAU;
          const r = 2 + p.seed * 14;
          p.x = B.cx + Math.cos(a) * r;
          p.y = B.cy + Math.sin(a) * r * 0.55;
          p.fh = hueIndex(p.seed * 360 + tf * 300);
          p.fl = MAX_LIGHT;
          p.fa = 0.85;
          p.size = 0.75;
          p.z = -2;
        } else {
          const e = easeOutCubic(k);
          const sw = (1 - e) * (2.6 + p.seed * 2.4);
          const s = e + Math.sin(Math.PI * e) * 0.5;
          const dx = o.x - B.cx;
          const dy = o.y - B.cy;
          const c = Math.cos(sw);
          const sn = Math.sin(sw);
          p.x = B.cx + (dx * c - dy * sn) * s;
          p.y = B.cy + (dx * sn + dy * c) * s;
          p.fh = o.hue;
          p.fl = Math.min(MAX_LIGHT, o.light + Math.round((1 - k) * 3));
          p.fa = o.a * Math.min(1, k * 4);
          p.size = o.s;
          p.z = o.z;
        }
      }
      if (now >= p.flipAt) {
        p.glyph ^= 1;
        p.flipAt = now + (tf < T_BURST + 2 ? rand(0.03, 0.12) : rand(0.4, 4.5));
      }
      this.spring(p, dt, now, damp);
    }
  }

  private drawFinale(ctx: CanvasRenderingContext2D, now: number) {
    const tf = now - this.finaleAt;
    const A = this.atlasF;
    const ps = this.ps;
    const n = ps.length;
    const order = this.order;

    if (tf >= T_BURST) {
      // painter's order: far buckets first
      const counts = this.counts;
      const bucket = this.bucket;
      counts.fill(0);
      for (let i = 0; i < n; i++) {
        let b = (((1.6 - ps[i].z) / 3.2) * BUCKETS) | 0;
        b = b < 0 ? 0 : b >= BUCKETS ? BUCKETS - 1 : b;
        bucket[i] = b;
        counts[b + 1]++;
      }
      for (let b = 0; b < BUCKETS; b++) counts[b + 1] += counts[b];
      for (let i = 0; i < n; i++) order[counts[bucket[i]]++] = i;
    } else {
      for (let i = 0; i < n; i++) order[i] = i;
    }

    let curA = -1;
    for (let j = 0; j < n; j++) {
      const p = ps[order[j]];
      const a = p.fa;
      if (a <= 0.02) continue;
      if (a !== curA) {
        ctx.globalAlpha = a;
        curA = a;
      }
      A.draw(ctx, p.fh, p.fl, p.glyph, p.x + p.ox, p.y + p.oy, p.size);
    }
    ctx.globalAlpha = 1;

    // shockwave rings lying in the flower's plane
    const k = (tf - T_BURST) / 1.2;
    if (k > 0 && k < 1) {
      const B = this.bloom;
      const R = Math.hypot(this.w, this.h) * 0.7;
      for (let i = 0; i < 2; i++) {
        const kk = clamp(k * 1.25 - i * 0.25, 0, 1);
        if (kk <= 0 || kk >= 1) continue;
        const r = easeOutCubic(kk) * R;
        ctx.beginPath();
        ctx.ellipse(B.cx, B.cy, r, r * 0.5, 0, 0, TAU);
        ctx.strokeStyle = i ? `hsla(320, 100%, 70%, ${(1 - kk) * 0.7})` : `rgba(255, 255, 255, ${(1 - kk) * 0.85})`;
        ctx.lineWidth = 1 + (1 - kk) * 10;
        ctx.stroke();
      }
    }
  }
}
