import { clamp, TAU } from './util';
import { hueIndex, lightIndex, rgbToHueLight } from './glyphs';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Target {
  x: number;
  y: number;
  col: number;
  row: number;
  hue: number;
  light: number;
  /** 0..1 growth order: stem first, then leaves, then the blossom from the inside out. */
  order: number;
}

export interface Flower {
  targets: Target[];
  head: { x: number; y: number; r: number };
  bounds: Rect;
}

type Pt = { x: number; y: number };

export const flowerRadius = (box: Rect) => Math.max(20, Math.min(box.w / 2.15, box.h / 3.08));

function bezier(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

function petalPath(g: CanvasRenderingContext2D, len: number, wid: number) {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(-wid, -len * 0.15, -wid * 1.15, -len * 0.75, 0, -len);
  g.bezierCurveTo(wid * 1.15, -len * 0.75, wid, -len * 0.15, 0, 0);
  g.closePath();
}

function leafPath(g: CanvasRenderingContext2D, len: number, wid: number) {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(len * 0.3, -wid * 1.25, len * 0.75, -wid * 0.95, len, 0);
  g.bezierCurveTo(len * 0.7, wid * 0.85, len * 0.3, wid, 0, 0);
  g.closePath();
}

/**
 * Paints a flower into an offscreen canvas and samples it on the global character grid,
 * so every glyph of the flower sits on the same grid as the background rain.
 */
export function buildFlower(box: Rect, cw: number, ch: number): Flower {
  const W = Math.max(2, Math.floor(box.w));
  const H = Math.max(2, Math.floor(box.h));
  const R = flowerRadius(box);
  const hx = W / 2;
  const hy = (H - 3 * R) / 2 + R;
  const cell = Math.min(cw, ch);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;

  const cells = new Map<number, Target>();
  const c0 = Math.ceil(box.x / cw - 0.5);
  const c1 = Math.floor((box.x + W) / cw - 0.5);
  const r0 = Math.ceil(box.y / ch - 0.5);
  const r1 = Math.floor((box.y + H) / ch - 0.5);

  const sample = (order: (x: number, y: number) => number, hueJitter: number) => {
    const data = g.getImageData(0, 0, W, H).data;
    for (let row = r0; row <= r1; row++) {
      const y = (row + 0.5) * ch;
      const ly = Math.floor(y - box.y);
      if (ly < 0 || ly >= H) continue;
      for (let col = c0; col <= c1; col++) {
        const x = (col + 0.5) * cw;
        const lx = Math.floor(x - box.x);
        if (lx < 0 || lx >= W) continue;
        const i = (ly * W + lx) * 4;
        if (data[i + 3] < 120) continue;
        const [h, l] = rgbToHueLight(data[i], data[i + 1], data[i + 2]);
        cells.set(row * 100000 + col, {
          x,
          y,
          col,
          row,
          hue: hueIndex(h + (Math.random() - 0.5) * hueJitter),
          light: lightIndex(l),
          order: order(lx, ly),
        });
      }
    }
    g.clearRect(0, 0, W, H);
  };

  // stem
  const S: Pt[] = [
    { x: hx, y: hy + 0.15 * R },
    { x: hx + 0.24 * R, y: hy + 0.85 * R },
    { x: hx - 0.26 * R, y: hy + 1.45 * R },
    { x: hx + 0.04 * R, y: hy + 2 * R },
  ];
  const stemAt = (t: number) => bezier(S[0], S[1], S[2], S[3], t);
  const stemPath = () => {
    g.beginPath();
    g.moveTo(S[0].x, S[0].y);
    g.bezierCurveTo(S[1].x, S[1].y, S[2].x, S[2].y, S[3].x, S[3].y);
  };
  const lw = Math.max(0.075 * R, 2.4 * cell);
  const stemGrad = g.createLinearGradient(0, S[3].y, 0, S[0].y);
  stemGrad.addColorStop(0, 'hsl(155, 85%, 24%)');
  stemGrad.addColorStop(1, 'hsl(125, 90%, 44%)');
  g.lineCap = 'round';
  g.strokeStyle = stemGrad;
  g.lineWidth = lw;
  stemPath();
  g.stroke();
  if (lw > 3 * cell) {
    g.save();
    g.translate(-lw * 0.22, 0);
    g.strokeStyle = 'hsl(110, 100%, 62%)';
    g.lineWidth = lw * 0.28;
    stemPath();
    g.stroke();
    g.restore();
  }
  sample((_, y) => 0.02 + 0.26 * clamp((S[3].y - y) / (S[3].y - S[0].y), 0, 1), 0);

  // leaves, lower one grows first
  const leaves = [
    { t: 0.72, ang: Math.PI + 0.4, len: 0.9 * R, wid: 0.27 * R },
    { t: 0.5, ang: -0.32, len: 0.82 * R, wid: 0.25 * R },
  ];
  leaves.forEach((lf, k) => {
    const base = stemAt(lf.t);
    g.save();
    g.translate(base.x, base.y);
    g.rotate(lf.ang);
    const grad = g.createLinearGradient(0, 0, lf.len, 0);
    grad.addColorStop(0, 'hsl(152, 85%, 24%)');
    grad.addColorStop(0.55, 'hsl(132, 90%, 42%)');
    grad.addColorStop(1, 'hsl(100, 100%, 60%)');
    leafPath(g, lf.len, lf.wid);
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'hsl(150, 80%, 13%)';
    g.lineWidth = cell * 0.8;
    g.stroke();
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(lf.len * 0.5, -lf.wid * 0.12, lf.len * 0.9, 0);
    g.strokeStyle = 'hsl(95, 100%, 70%)';
    g.lineWidth = cell * 0.55;
    g.stroke();
    g.restore();
    sample((x, y) => 0.24 + 0.06 * k + 0.14 * clamp(Math.hypot(x - base.x, y - base.y) / lf.len, 0, 1), 0);
  });

  // blossom
  g.save();
  g.translate(hx, hy);
  const ring = (n: number, len: number, wid: number, rot: number, hues: number[], lift: number) => {
    for (let i = 0; i < n; i++) {
      const h = hues[i % hues.length];
      g.save();
      g.rotate(rot + (i / n) * TAU);
      const grad = g.createLinearGradient(0, 0, 0, -len);
      grad.addColorStop(0, `hsl(${h}, 95%, ${28 + lift}%)`);
      grad.addColorStop(0.5, `hsl(${h + 6}, 100%, ${54 + lift}%)`);
      grad.addColorStop(1, `hsl(${h + 14}, 100%, ${78 + lift * 0.5}%)`);
      petalPath(g, len, wid);
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = `hsl(${h}, 90%, 15%)`;
      g.lineWidth = cell * 0.9;
      g.stroke();
      g.restore();
    }
  };
  ring(8, R, 0.5 * R, 0, [330, 305, 342, 318, 296, 336, 312, 348], 0);
  ring(8, 0.74 * R, 0.4 * R, Math.PI / 8, [338, 318, 350, 326, 310, 344, 322, 354], 4);
  ring(6, 0.48 * R, 0.28 * R, 0.3, [352, 2, 346, 358, 340, 6], 8);
  const cr = 0.22 * R;
  const center = g.createRadialGradient(0, 0, 0, 0, 0, cr);
  center.addColorStop(0, 'hsl(54, 100%, 80%)');
  center.addColorStop(0.55, 'hsl(44, 100%, 58%)');
  center.addColorStop(1, 'hsl(30, 100%, 46%)');
  g.beginPath();
  g.arc(0, 0, cr, 0, TAU);
  g.fillStyle = center;
  g.fill();
  g.strokeStyle = 'hsl(24, 100%, 22%)';
  g.lineWidth = cell * 0.9;
  g.stroke();
  g.restore();
  sample((x, y) => {
    const d = Math.hypot(x - hx, y - hy) / R;
    if (d < 0.24) return 0.42 + 0.25 * d;
    const a = (Math.atan2(y - hy, x - hx) + Math.PI) / TAU;
    return 0.5 + 0.4 * clamp((d - 0.2) / 0.8, 0, 1) + 0.04 * a;
  }, 10);

  const targets = Array.from(cells.values());
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of targets) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x);
    maxY = Math.max(maxY, t.y);
  }
  if (!targets.length) minX = minY = maxX = maxY = 0;

  return {
    targets,
    head: { x: box.x + hx, y: box.y + hy, r: R },
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}
