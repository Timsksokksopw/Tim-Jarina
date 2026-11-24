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

interface Layer {
  n: number;
  len: number;
  wid: number;
  elev: number;
  bend: number;
  cup: number;
  twist: number;
  hue: number;
  y: number;
}

// Fibonacci petal counts, outer to inner
const LAYERS: Layer[] = [
  { n: 13, len: 1.0, wid: 0.19, elev: 0.08, bend: 0.55, cup: 0.35, twist: 0.12, hue: 282, y: 0 },
  { n: 8, len: 0.8, wid: 0.24, elev: 0.42, bend: 0.45, cup: 0.4, twist: 0.14, hue: 312, y: 0.02 },
  { n: 5, len: 0.58, wid: 0.28, elev: 0.82, bend: 0.3, cup: 0.45, twist: 0.1, hue: 334, y: 0.04 },
  { n: 3, len: 0.4, wid: 0.3, elev: 1.15, bend: -0.6, cup: 0.5, twist: 0.08, hue: 350, y: 0.05 },
];

const LEAVES = [
  { s: 0.42, phi: 0.5, len: 0.8, wid: 0.26, elev: 0.35, bend: -0.9, cup: 0.3 },
  { s: 0.66, phi: 0.5 + Math.PI, len: 0.9, wid: 0.28, elev: 0.3, bend: -0.9, cup: 0.3 },
];

const CORE_R = 0.24;
const STEM_LEN = 2.1;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const BEAT = 1.6;

const widthProfile = (u: number) => Math.sin(Math.PI * u ** 1.1) ** 0.7;
const clampLight = (l: number) => (l < 0 ? 0 : l > MAX_LIGHT ? MAX_LIGHT : l);
const depthDim = (z: number) => (z > 0.75 ? 2 : z > 0.15 ? 1 : 0);

const stemPt = { x: 0, y: 0, z: 0 };
function stemAt(s: number) {
  stemPt.x = 0.1 * Math.sin(s * 3.3);
  stemPt.y = -0.02 - s * STEM_LEN;
  stemPt.z = 0.07 * Math.sin(s * 2.2 + 1);
  return stemPt;
}

function samplePetal(): [u: number, v: number, edge: number] {
  const r = Math.random();
  if (r < 0.5) return [Math.random(), (Math.random() < 0.5 ? -1 : 1) * rand(0.94, 1), 1];
  if (r < 0.6) return [Math.random(), rand(-0.04, 0.04), 0.55];
  for (;;) {
    const u = Math.random();
    const v = rand(-1, 1);
    if (Math.random() < widthProfile(u)) return [u, v, Math.abs(v) ** 3 * 0.6];
  }
}

/** The "unlocked" flower: a rotating 3D bloom with a phyllotaxis heart, data-stream stem and fireflies. */
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
  private div = GOLDEN;
  private nCore = 1;
  private spin = 0;

  layout(w: number, h: number) {
    this.S = Math.max(40, Math.min(w * 0.42, h * 0.42));
    this.cx = w / 2;
    this.cy = h / 2 - 0.17 * this.S;
  }

  makeDescs(n: number): Desc[] {
    const out: Desc[] = [];
    const nCore = Math.round(n * 0.05);
    const nStem = Math.round(n * 0.07);
    const nLeaf = Math.round(n * 0.08);
    const nSpark = Math.round(n * 0.05);
    const nPetal = n - nCore - nStem - nLeaf - nSpark;
    this.nCore = Math.max(1, nCore);

    const weights = LAYERS.map((L) => L.n * L.len * L.wid);
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
          phi: ((i % L.n) / L.n) * TAU + li * GOLDEN,
          u,
          v,
          edge,
          seed: Math.random(),
          delay: 0.12 + (LAYERS.length - 1 - li) * 0.14 + rand(0, 0.25),
          dur: rand(1.4, 2.1),
        });
      }
    });
    for (let i = 0; i < nCore; i++) {
      out.push({ kind: CORE, layer: i, phi: 0, u: 0, v: 0, edge: 0, seed: Math.random(), delay: rand(0, 0.15), dur: rand(1, 1.5) });
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
    for (let i = 0; i < nLeaf; i++) {
      const [u, v, edge] = samplePetal();
      const k = i % LEAVES.length;
      out.push({ kind: LEAF, layer: k, phi: LEAVES[k].phi, u, v, edge, seed: Math.random(), delay: 0.6 + rand(0, 0.4), dur: rand(1.5, 2.2) });
    }
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
  frame(t: number) {
    this.t = t;
    this.open = easeInOutCubic(clamp((t - 0.15) / 3.4, 0, 1));
    const rot = 0.6 + t * 0.23;
    const tilt = 0.78 + 0.12 * Math.sin(t * 0.17);
    this.cr = Math.cos(rot);
    this.sr = Math.sin(rot);
    this.ct = Math.cos(tilt);
    this.st = Math.sin(tilt);
    const c = t % BEAT;
    this.beat = Math.exp(-(((c - 0.06) / 0.07) ** 2)) + 0.65 * Math.exp(-(((c - 0.34) / 0.08) ** 2));
    this.waveR = c * 1.15;
    this.waveA = (1 - c / BEAT) * this.open;
    this.hueShift = 38 * Math.sin(t * 0.13) + 22 * Math.sin(t * 0.29 + 1);
    this.div = GOLDEN + 0.0018 * Math.sin(t * 0.21);
    // every 12 s the petal rings counter-rotate one full turn while the colours run through the rainbow
    const cyc = t % 12;
    this.spin = cyc > 8 ? easeInOutCubic((cyc - 8) / 4) : 0;
  }

  private project(X: number, Y: number, Z: number, o: Out) {
    const x1 = X * this.cr - Z * this.sr;
    const z1 = X * this.sr + Z * this.cr;
    const y2 = Y * this.ct + z1 * this.st;
    const z2 = z1 * this.ct - Y * this.st;
    const f = this.D / (this.D + z2);
    o.x = this.cx + x1 * this.S * f;
    o.y = this.cy - y2 * this.S * f;
    o.z = z2;
    o.s = f;
  }

  /** A curved, cupped sheet (petal or leaf) growing from (ox,oy,oz). Returns the heartbeat wave strength. */
  private sheet(
    len: number,
    wid: number,
    elev: number,
    bend: number,
    cup: number,
    phi: number,
    u: number,
    v: number,
    ox: number,
    oy: number,
    oz: number,
    withWave: boolean,
    o: Out,
  ) {
    const s = u * len;
    const k = bend / len;
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
    const half = wid * widthProfile(u);
    const lat = v * half;
    const cupOff = cup * v * v * half;
    let rr = r - cupOff * Math.sin(a);
    let wave = 0;
    if (withWave) {
      const d = (rr - this.waveR) / 0.12;
      wave = this.waveA * Math.exp(-d * d);
      rr *= 1 + wave * 0.08;
    }
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    this.project(ox + rr * cp - lat * sp, oy + y + cupOff * Math.cos(a) + wave * 0.05, oz + rr * sp + lat * cp, o);
    return wave;
  }

  place(d: Desc, o: Out) {
    const op = this.open;
    const t = this.t;
    switch (d.kind) {
      case PETAL: {
        const L = LAYERS[d.layer];
        const breathe = Math.sin(t * 0.8 + d.layer * 1.3 + d.phi * 2) * 0.045 * op;
        const wave = this.sheet(
          L.len * lerp(0.5, 1, op),
          L.wid * lerp(0.5, 1, op),
          lerp(1.42, L.elev, op) + breathe,
          L.bend * op,
          L.cup,
          d.phi + L.twist * d.u + (d.layer % 2 ? 1 : -1) * this.spin * TAU,
          d.u,
          d.v,
          0,
          L.y,
          0,
          true,
          o,
        );
        o.hue = hueIndex(L.hue + d.u * 42 + d.v * 10 + this.hueShift + wave * 70 + this.spin * 360 + d.layer * 90 * Math.sin(Math.PI * this.spin));
        o.light = clampLight(1 + Math.round(d.edge * 3.6 + d.u * 1.1 + wave * 2.5) - depthDim(o.z));
        o.s *= 1 + d.edge * 0.12;
        o.a = 1;
        break;
      }
      case CORE: {
        const i = d.layer;
        const rn = Math.sqrt((i + 0.5) / this.nCore);
        const r = CORE_R * rn * (1 + 0.1 * this.beat) * lerp(0.6, 1, op);
        const ang = i * this.div + t * 0.35;
        this.project(r * Math.cos(ang), 0.07 + 0.09 * (1 - rn * rn) + 0.02 * this.beat, r * Math.sin(ang), o);
        o.hue = hueIndex(52 - rn * 30 + 10 * Math.sin(i * 0.05 + t * 1.5));
        o.light = clampLight(Math.round(5 - rn * 2.2 + this.beat * 1.2));
        o.s *= 0.9;
        o.a = 1;
        break;
      }
      case STEM: {
        const s = (((d.u - t * 0.11) % 1) + 1) % 1;
        const p = stemAt(s);
        const rad = 0.04 * Math.sqrt(d.v) * (1 - 0.35 * s);
        this.project(p.x + rad * Math.cos(d.phi), p.y, p.z + rad * Math.sin(d.phi), o);
        const pulse = 0.5 + 0.5 * Math.sin(s * 28 + t * 5);
        o.hue = hueIndex(140 + 30 * Math.sin(s * 9 - t * 1.6) + this.hueShift * 0.3);
        o.light = clampLight(1 + Math.round(pulse * 3) - depthDim(o.z));
        o.s *= 0.85;
        o.a = smoothstep(0, 0.06, s) * (1 - smoothstep(0.9, 1, s));
        break;
      }
      case LEAF: {
        const lf = LEAVES[d.layer];
        const p = stemAt(lf.s);
        this.sheet(
          lf.len * lerp(0.4, 1, op),
          lf.wid * lerp(0.4, 1, op),
          lerp(1.2, lf.elev, op),
          lf.bend * op,
          lf.cup,
          lf.phi + Math.sin(t * 0.6 + d.layer) * 0.06,
          d.u,
          d.v,
          p.x,
          p.y,
          p.z,
          false,
          o,
        );
        o.hue = hueIndex(118 + d.u * 30 + d.v * 8 + this.hueShift * 0.25);
        o.light = clampLight(1 + Math.round(d.edge * 2.4 + d.u * 1.2) - depthDim(o.z));
        o.a = 1;
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
        o.a = Math.sin(Math.PI * life) * 0.9;
      }
    }
  }
}
