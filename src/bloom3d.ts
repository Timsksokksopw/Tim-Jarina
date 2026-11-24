import { MAX_LIGHT, hueIndex } from './glyphs';
import { TAU, clamp, easeInOutCubic, hash, lerp, rand, smoothstep } from './util';

export const PETAL = 0;
export const CORE = 1;
export const STEM = 2;
export const LEAF = 3;
export const SPARK = 4;

/** Static description of one finale particle; its 3D position is derived from this + time. */
export interface Desc {
  kind: number;
  layer: number;
  phi: number;
  u: number;
  v: number;
  edge: number;
  seed: number;
  delay: number;
  dur: number;
}

export interface Out {
  x: number;
  y: number;
  z: number;
  s: number;
  hue: number;
  light: number;
  a: number;
}

/** A ring of petals: sectors of a bowl whose wall rises from angle a0 to a1 and rolls outwards at the rim. */
interface Layer {
  n: number;
  len: number;
  half: number;
  a0: number;
  a1: number;
  curl: number;
  hue: number;
}

// outer to inner
const LAYERS: Layer[] = [
  { n: 5, len: 1.0, half: 0.78, a0: 0.1, a1: 0.98, curl: 1.45, hue: 330 },
  { n: 5, len: 0.93, half: 0.8, a0: 0.35, a1: 1.24, curl: 1.25, hue: 336 },
  { n: 5, len: 0.84, half: 0.84, a0: 0.58, a1: 1.4, curl: 0.95, hue: 342 },
  { n: 4, len: 0.77, half: 1.02, a0: 0.8, a1: 1.5, curl: 0.7, hue: 347 },
  { n: 3, len: 0.72, half: 1.3, a0: 1.05, a1: 1.6, curl: 0.4, hue: 351 },
];

interface Leaf {
  s: number;
  phi: number;
  len: number;
  wid: number;
  elev: number;
  bend: number;
  cup: number;
  weight: number;
}

const LEAVES: Leaf[] = [
  { s: 0.46, phi: 0.5, len: 0.72, wid: 0.23, elev: 0.5, bend: -0.9, cup: 0.35, weight: 6 },
  { s: 0.68, phi: 0.5 + Math.PI, len: 0.78, wid: 0.25, elev: 0.45, bend: -0.9, cup: 0.35, weight: 7 },
  // sepals
  ...Array.from({ length: 5 }, (_, i) => ({ s: 0, phi: (i / 5) * TAU + 0.6, len: 0.4, wid: 0.075, elev: -0.1, bend: -0.8, cup: 0.4, weight: 1.1 })),
  // thorns
  ...[0.2, 0.34, 0.56, 0.8].map((s, i) => ({ s, phi: i * 2.4 + 1, len: 0.13, wid: 0.03, elev: -0.1, bend: -0.5, cup: 0, weight: 0.4 })),
];
/** Leaves and sepals hide what is behind them; thorns are too thin for that. */
const SOLID_LEAVES = 7;

const STEM_LEN = 1.52;
const PIVOT_Y = -0.22;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const BEAT = 1.6;

// the rolled-up bud in the heart of the rose
const BUD_TURNS = 2.6;
const BUD_R = 0.2;
const BUD_H = 0.77;

const REST_TILT = 0.74;
const MIN_TILT = -0.9;
const MAX_TILT = 1.5;
const DRAG = 0.0085;
/** Seconds without touching the flower until it drifts back to its resting pose. */
const IDLE = 5;

const STEPS = 20;
const GRID = 160;
const GRID_HALF = 1.65;
const CELLS = GRID / (GRID_HALF * 2);

const leafProfile = (u: number) => Math.sin(Math.PI * u ** 0.75) ** 0.9 * (1 - 0.25 * u);
const clampLight = (l: number) => (l < 0 ? 0 : l > MAX_LIGHT ? MAX_LIGHT : l);
const depthDim = (z: number) => (z > 0.75 ? 2 : z > 0.15 ? 1 : 0);

const stemPt = { x: 0, y: 0, z: 0 };
function stemAt(s: number) {
  stemPt.x = 0.08 * Math.sin(s * 3.3);
  stemPt.y = -0.02 - s * STEM_LEN;
  stemPt.z = 0.06 * Math.sin(s * 2.2);
  return stemPt;
}

/** Outline-heavy sampling: rolled rim and sides make the petals readable, the rest fills the surface. */
function samplePetal(): [u: number, v: number, edge: number] {
  const r = Math.random();
  if (r < 0.25) return [rand(0.975, 1), rand(-1, 1), 1];
  if (r < 0.34) return [rand(0.45, 1), (Math.random() < 0.5 ? -1 : 1) * rand(0.97, 1), 0.85];
  return [Math.random() ** 0.6, rand(-1, 1), 0];
}

function sampleLeaf(): [u: number, v: number, edge: number] {
  const r = Math.random();
  if (r < 0.45) return [Math.random(), (Math.random() < 0.5 ? -1 : 1) * rand(0.94, 1), 1];
  if (r < 0.58) return [Math.random(), rand(-0.05, 0.05), 0.7];
  for (;;) {
    const u = Math.random();
    const v = rand(-1, 1);
    if (Math.random() < leafProfile(u)) return [u, v, Math.abs(v) ** 3 * 0.5];
  }
}

/** The "unlocked" flower: a draggable 3D rose with a rolled bud, data-stream stem and fireflies. */
export class Bloom {
  cx = 0;
  cy = 0;
  S = 100;
  private readonly D = 4.4;
  private t = 0;
  private open = 0;
  private beat = 0;
  private waveR = -1;
  private waveA = 0;
  private cr = 1;
  private sr = 0;
  private ct = 1;
  private st = 0;
  private hueShift = 0;
  private nCore = 1;
  private spin = 0;
  private flush = 0;

  // orientation: idles on its own, follows the pointer while dragged, then coasts
  private yaw = 0.6;
  private tilt = REST_TILT;
  private vYaw = 0;
  private vTilt = 0;
  private dragging = false;
  private idle = IDLE;
  private dragYaw = 0;
  private dragTilt = 0;

  // meridian curve of every layer for the current frame
  private readonly pr = new Float32Array(LAYERS.length * (STEPS + 1));
  private readonly py = new Float32Array(LAYERS.length * (STEPS + 1));
  private readonly pa = new Float32Array(LAYERS.length * (STEPS + 1));
  // coarse depth buffer so that front petals really hide what is behind them
  private readonly depth = new Float32Array(GRID * GRID);
  private readonly mesh = new Float32Array(64 * 16 * 3);
  // scratch: last surface point (world space) and its normal
  private wx = 0;
  private wy = 0;
  private wz = 0;
  private nx = 0;
  private ny = 1;
  private nz = 0;
  private wave = 0;

  layout(w: number, h: number) {
    this.S = Math.max(40, Math.min(w * 0.45, h * 0.385));
    this.cx = w / 2;
    this.cy = h / 2;
  }

  grab() {
    this.dragging = true;
    this.vYaw = this.vTilt = 0;
    this.dragYaw = this.dragTilt = 0;
  }

  /** Pointer movement in CSS px while grabbed. */
  drag(dx: number, dy: number) {
    if (!this.dragging) return;
    this.dragYaw += dx * DRAG;
    this.dragTilt += dy * DRAG;
  }

  release() {
    this.dragging = false;
    this.idle = 0;
  }

  makeDescs(n: number): Desc[] {
    const out: Desc[] = [];
    const nCore = Math.round(n * 0.09);
    const nStem = Math.round(n * 0.06);
    const nLeaf = Math.round(n * 0.13);
    const nSpark = Math.round(n * 0.04);
    const nPetal = n - nCore - nStem - nLeaf - nSpark;
    this.nCore = Math.max(1, nCore);

    const weights = LAYERS.map((L) => L.n * L.len * L.half * (0.35 + 0.65 * L.len * Math.cos(L.a1 * 0.7)));
    const wsum = weights.reduce((a, b) => a + b, 0);
    let placed = 0;
    LAYERS.forEach((L, li) => {
      const cnt = li === LAYERS.length - 1 ? nPetal - placed : Math.round((nPetal * weights[li]) / wsum);
      placed += cnt;
      for (let i = 0; i < cnt; i++) {
        const [u, v, edge] = samplePetal();
        out.push({
          kind: PETAL,
          layer: li,
          phi: this.petalPhi(li, i % L.n),
          u,
          v,
          edge,
          seed: Math.random(),
          delay: 0.12 + (LAYERS.length - 1 - li) * 0.12 + rand(0, 0.25),
          dur: rand(1.4, 2.1),
        });
      }
    });
    for (let i = 0; i < nCore; i++) {
      const rim = Math.random() < 0.5;
      out.push({
        kind: CORE,
        layer: i,
        phi: 0,
        u: Math.sqrt((i + 0.5) / this.nCore),
        v: rim ? rand(0.96, 1) : rand(0.3, 1),
        edge: rim ? 1 : 0,
        seed: Math.random(),
        delay: rand(0, 0.15),
        dur: rand(1, 1.5),
      });
    }
    for (let i = 0; i < nStem; i++) {
      out.push({
        kind: STEM,
        layer: 0,
        phi: rand(0, TAU),
        u: Math.random(),
        v: Math.random(),
        edge: 0,
        seed: Math.random(),
        delay: 0.5 + rand(0, 0.4),
        dur: rand(1.5, 2.2),
      });
    }
    const lsum = LEAVES.reduce((a, l) => a + l.weight, 0);
    let done = 0;
    LEAVES.forEach((lf, k) => {
      const cnt = k === LEAVES.length - 1 ? nLeaf - done : Math.min(nLeaf - done, Math.round((nLeaf * lf.weight) / lsum));
      done += cnt;
      for (let i = 0; i < cnt; i++) {
        const [u, v, edge] = sampleLeaf();
        out.push({ kind: LEAF, layer: k, phi: lf.phi, u, v, edge, seed: Math.random(), delay: 0.6 + rand(0, 0.4), dur: rand(1.5, 2.2) });
      }
    });
    for (let i = 0; i < nSpark; i++) {
      out.push({
        kind: SPARK,
        layer: 0,
        phi: rand(0, TAU),
        u: Math.random(),
        v: Math.random(),
        edge: 0,
        seed: Math.random(),
        delay: 0.8 + rand(0, 0.8),
        dur: rand(1.2, 2),
      });
    }
    return out;
  }

  /** t = seconds since the burst. */
  frame(t: number, dt: number) {
    this.t = t;
    this.open = easeInOutCubic(clamp((t - 0.15) / 3.4, 0, 1));
    this.orient(t, dt);
    this.cr = Math.cos(this.yaw);
    this.sr = Math.sin(this.yaw);
    this.ct = Math.cos(this.tilt);
    this.st = Math.sin(this.tilt);
    const c = t % BEAT;
    this.beat = Math.exp(-(((c - 0.06) / 0.07) ** 2)) + 0.65 * Math.exp(-(((c - 0.34) / 0.08) ** 2));
    this.waveR = c * 1.15;
    this.waveA = (1 - c / BEAT) * this.open;
    this.hueShift = 9 * Math.sin(t * 0.13) + 6 * Math.sin(t * 0.29 + 1);
    // every 16 s the petal rings shift on by one petal while the colours drift through violet to blue and back
    const cyc = t % 16;
    this.spin = cyc > 12 ? easeInOutCubic((cyc - 12) / 4) : 0;
    this.flush = Math.sin(Math.PI * this.spin);
    this.buildProfiles();
    this.buildDepth();
  }

  private orient(t: number, dt: number) {
    if (dt <= 0) return;
    if (this.dragging) {
      const before = this.tilt;
      this.yaw += this.dragYaw;
      this.tilt = clamp(this.tilt + this.dragTilt, MIN_TILT, MAX_TILT);
      // smoothed pointer speed becomes the momentum on release
      const k = 1 - Math.exp(-dt * 18);
      this.vYaw += (clamp(this.dragYaw / dt, -14, 14) - this.vYaw) * k;
      this.vTilt += (clamp((this.tilt - before) / dt, -8, 8) - this.vTilt) * k;
      this.dragYaw = this.dragTilt = 0;
      return;
    }
    this.idle += dt;
    const calm = smoothstep(0.4, 2.5, this.idle);
    this.yaw += (this.vYaw + 0.23 * calm) * dt;
    this.tilt = clamp(this.tilt + this.vTilt * dt, MIN_TILT, MAX_TILT);
    this.vYaw *= Math.exp(-2.2 * dt);
    this.vTilt *= Math.exp(-3.5 * dt);
    const back = smoothstep(IDLE, IDLE + 3, this.idle);
    const rest = REST_TILT + 0.1 * Math.sin(t * 0.17);
    this.tilt += (rest - this.tilt) * (1 - Math.exp(-1.1 * back * dt));
  }

  private petalPhi(li: number, i: number) {
    return (i / LAYERS[li].n) * TAU + li * GOLDEN;
  }

  private buildProfiles() {
    const { open, t, pr, py, pa } = this;
    for (let li = 0; li < LAYERS.length; li++) {
      const L = LAYERS[li];
      const breathe = Math.sin(t * 0.8 + li * 1.3) * 0.035 * open - this.beat * 0.02 * open;
      const a0 = lerp(1.3, L.a0, open) + breathe;
      const a1 = lerp(1.58, L.a1, open) + breathe;
      const curl = L.curl * open;
      const ds = (L.len * lerp(0.5, 1, open)) / STEPS;
      let r = 0.035;
      let y = 0;
      const o = li * (STEPS + 1);
      for (let j = 0; j <= STEPS; j++) {
        const u = j / STEPS;
        const a = lerp(a0, a1, smoothstep(0, 0.55, u)) - curl * smoothstep(0.66, 1, u);
        pr[o + j] = r;
        py[o + j] = y;
        pa[o + j] = a;
        r += Math.cos(a) * ds;
        y += Math.sin(a) * ds;
      }
    }
  }

  /** Rasterises petals, bud and leaves into the depth buffer. */
  private buildDepth() {
    this.depth.fill(Infinity);
    for (let li = 0; li < LAYERS.length; li++) {
      for (let i = 0; i < LAYERS[li].n; i++) {
        const phi = this.petalPhi(li, i);
        this.raster(10, 10, (a, b) => this.petalPoint(li, phi, a, b * 2 - 1));
      }
    }
    this.raster(60, 3, (a, b) => this.budPoint(a, lerp(0.1, 1, b)));
    for (let k = 0; k < SOLID_LEAVES; k++) this.raster(8, 4, (a, b) => this.leafPoint(k, a, b * 2 - 1));
  }

  private raster(nu: number, nv: number, point: (a: number, b: number) => void) {
    const m = this.mesh;
    const row = (nv + 1) * 3;
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        point(i / nu, j / nv);
        const x1 = this.wx * this.cr - this.wz * this.sr;
        const z1 = this.wx * this.sr + this.wz * this.cr;
        const Y = this.wy - PIVOT_Y;
        const z2 = z1 * this.ct - Y * this.st;
        const f = this.D / (this.D + z2);
        const q = i * row + j * 3;
        m[q] = (x1 * f + GRID_HALF) * CELLS;
        m[q + 1] = (GRID_HALF - (Y * this.ct + z1 * this.st) * f) * CELLS;
        m[q + 2] = z2;
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const q = i * row + j * 3;
        this.tri(q, q + 3, q + row);
        this.tri(q + 3, q + row + 3, q + row);
      }
    }
  }

  private tri(a: number, b: number, c: number) {
    const m = this.mesh;
    const ax = m[a];
    const ay = m[a + 1];
    const bx = m[b];
    const by = m[b + 1];
    const cx = m[c];
    const cy = m[c + 1];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-6) return;
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5));
    const x1 = Math.min(GRID - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
    const y1 = Math.min(GRID - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
    const inv = 1 / area;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const wb = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) * inv;
        if (wb < 0) continue;
        const wc = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * inv;
        if (wc < 0 || wb + wc > 1) continue;
        const z = m[a + 2] * (1 - wb - wc) + m[b + 2] * wb + m[c + 2] * wc;
        const q = y * GRID + x;
        if (z < this.depth[q]) this.depth[q] = z;
      }
    }
  }

  /** 1 = in plain sight, 0 = hidden behind another part of the flower. */
  private visible(o: Out) {
    const gx = Math.floor(((o.x - this.cx) / this.S + GRID_HALF) * CELLS);
    const gy = Math.floor(((o.y - this.cy) / this.S + GRID_HALF) * CELLS);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return 1;
    return 1 - smoothstep(0.045, 0.12, o.z - this.depth[gy * GRID + gx]);
  }

  private project(X: number, Y: number, Z: number, o: Out) {
    const x1 = X * this.cr - Z * this.sr;
    const z1 = X * this.sr + Z * this.cr;
    const Y1 = Y - PIVOT_Y;
    const y2 = Y1 * this.ct + z1 * this.st;
    const z2 = z1 * this.ct - Y1 * this.st;
    const f = this.D / (this.D + z2);
    o.x = this.cx + x1 * this.S * f;
    o.y = this.cy - y2 * this.S * f;
    o.z = z2;
    o.s = f;
  }

  /** Diffuse light 0..1 for the last surface point, lit from the upper left in front. Both sides are lit. */
  private shade() {
    const x = this.nx * this.cr - this.nz * this.sr;
    const z1 = this.nx * this.sr + this.nz * this.cr;
    const y = this.ny * this.ct + z1 * this.st;
    const z = z1 * this.ct - this.ny * this.st;
    const flip = z > 0 ? -1 : 1;
    return Math.max(0, flip * (-0.42 * x + 0.62 * y - 0.66 * z));
  }

  private petalPoint(li: number, phi: number, u: number, v: number) {
    const L = LAYERS[li];
    // rounded shoulders and a tiny pointed tip, like a real rose petal
    const su = u * (0.97 - 0.24 * Math.abs(v) ** 2.6 + 0.03 * Math.exp(-((v / 0.18) ** 2)));
    const f = clamp(su, 0, 1) * STEPS;
    const j = Math.min(STEPS - 1, Math.floor(f));
    const k = f - j;
    const o = li * (STEPS + 1) + j;
    let r = lerp(this.pr[o], this.pr[o + 1], k);
    let y = lerp(this.py[o], this.py[o + 1], k);
    const a = lerp(this.pa[o], this.pa[o + 1], k);
    const ang =
      phi +
      v * L.half * (0.62 + 0.38 * smoothstep(0, 0.6, u)) * (1 - 0.1 * smoothstep(0.75, 1, u)) +
      (((li % 2 ? 1 : -1) * this.spin) / L.n) * TAU;
    // one side tucks under the neighbour, the rim is slightly wavy
    r *= 1 + 0.075 * v;
    y += (0.022 * Math.sin(v * 4.2 + phi * 3) - 0.02 * v) * u * u * u * this.open;
    const d = (r - this.waveR) / 0.12;
    this.wave = this.waveA * Math.exp(-d * d);
    r *= 1 + this.wave * 0.035;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    this.wx = r * c;
    this.wy = y + this.wave * 0.02;
    this.wz = r * s;
    const sa = Math.sin(a);
    this.nx = -sa * c;
    this.ny = Math.cos(a);
    this.nz = -sa * s;
  }

  private budPoint(u: number, v: number) {
    const ang = u * BUD_TURNS * TAU + this.t * 0.12;
    const r = (0.015 + (BUD_R - 0.015) * u) * (0.5 + 0.5 * Math.sin(Math.PI * (0.15 + 0.6 * v))) * (1 + 0.06 * this.beat);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    this.wx = r * c;
    this.wy = (BUD_H - 0.06 * u + 0.015 * Math.sin(ang * 1.5)) * v * lerp(0.6, 1, this.open);
    this.wz = r * s;
    this.nx = c;
    this.ny = 0.25;
    this.nz = s;
  }

  /** A curved, cupped sheet growing from the stem. */
  private leafPoint(index: number, u: number, v: number) {
    const lf = LEAVES[index];
    const op = this.open;
    const p = stemAt(lf.s);
    const len = lf.len * lerp(0.4, 1, op);
    const elev = lerp(1.2, lf.elev, op);
    const s = u * len;
    const k = (lf.bend * op) / len;
    let r: number;
    let y: number;
    if (Math.abs(k) < 1e-3) {
      r = s * Math.cos(elev);
      y = s * Math.sin(elev);
    } else {
      r = (Math.sin(elev + k * s) - Math.sin(elev)) / k;
      y = (Math.cos(elev) - Math.cos(elev + k * s)) / k;
    }
    const a = elev + k * s;
    const half = lf.wid * lerp(0.4, 1, op) * leafProfile(u);
    const lat = v * half;
    const cupOff = lf.cup * v * v * half;
    const rr = r - cupOff * Math.sin(a);
    const phi = lf.phi + (index < 2 ? Math.sin(this.t * 0.6 + index) * 0.06 : 0);
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    this.wx = p.x + rr * cp - lat * sp;
    this.wy = p.y + y + cupOff * Math.cos(a);
    this.wz = p.z + rr * sp + lat * cp;
    this.nx = -Math.sin(a) * cp;
    this.ny = Math.cos(a);
    this.nz = -Math.sin(a) * sp;
  }

  place(d: Desc, o: Out) {
    const t = this.t;
    switch (d.kind) {
      case PETAL: {
        const L = LAYERS[d.layer];
        this.petalPoint(d.layer, d.phi, d.u, d.v);
        this.project(this.wx, this.wy, this.wz, o);
        const lit = this.shade();
        const light = d.edge > 0 ? 3.4 + d.edge * 0.7 + lit * 1.2 + this.wave : 0.75 + lit * 2.1 + d.u * 0.9 + this.wave * 1.6;
        o.hue = hueIndex(L.hue + d.u * 9 + d.v * 4 + this.hueShift + this.wave * 14 - this.flush * (85 + d.layer * 16));
        o.light = clampLight(Math.round(light) - (o.z > 0.5 ? 1 : 0));
        o.s *= 1 + d.edge * 0.08;
        o.a = this.visible(o);
        break;
      }
      case CORE: {
        this.budPoint(d.u, d.v);
        this.project(this.wx, this.wy, this.wz, o);
        o.hue = hueIndex(356 + 12 * Math.sin(d.u * 9 - t * 1.5) + this.hueShift - this.flush * 60);
        o.light = clampLight(Math.round((d.edge ? 4.2 : 1 + d.v * 1.2) + this.beat * 1.2));
        o.s *= 0.88;
        o.a = this.visible(o);
        break;
      }
      case STEM: {
        const s = (((d.u - t * 0.11) % 1) + 1) % 1;
        const p = stemAt(s);
        const rad = 0.045 * Math.sqrt(d.v) * (1 - 0.25 * s);
        this.project(p.x + rad * Math.cos(d.phi), p.y, p.z + rad * Math.sin(d.phi), o);
        const pulse = 0.5 + 0.5 * Math.sin(s * 28 + t * 5);
        o.hue = hueIndex(135 + 18 * Math.sin(s * 9 - t * 1.6) + this.hueShift * 0.3);
        o.light = clampLight(1 + Math.round(pulse * 3) - depthDim(o.z));
        o.s *= 0.85;
        o.a = smoothstep(0, 0.06, s) * (1 - smoothstep(0.9, 1, s)) * this.visible(o);
        break;
      }
      case LEAF: {
        this.leafPoint(d.layer, d.u, d.v);
        this.project(this.wx, this.wy, this.wz, o);
        o.hue = hueIndex(118 + d.u * 26 + d.v * 8 + this.hueShift * 0.25);
        o.light = clampLight(Math.round(0.7 + this.shade() * 1.4 + d.edge * 2 + d.u * 0.6) - depthDim(o.z));
        o.s *= d.layer < 2 ? 1 : 0.82;
        o.a = this.visible(o);
        break;
      }
      default: {
        const speed = 0.07 + d.v * 0.07;
        const life = (d.seed + t * speed) % 1;
        const cycle = Math.floor(d.seed + t * speed);
        const ang = hash(cycle * 12.9898 + d.u * 78.233) * TAU + life * 1.6;
        const r = 0.25 + hash(cycle * 39.346 + d.u * 11.135) * 1.05;
        this.project(Math.cos(ang) * r, 0.05 + life * 1.9 + 0.06 * Math.sin(life * 12 + d.seed * 20), Math.sin(ang) * r, o);
        o.hue = hueIndex(d.seed * 360 + t * 40);
        o.light = clampLight(4 + Math.round(2 * Math.sin(life * 40 + d.seed * 9)));
        o.s *= 0.8;
        o.a = Math.sin(Math.PI * life) * 0.9 * this.visible(o);
      }
    }
  }
}
