export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);

export const easeInCubic = (t: number) => t * t * t;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function smoothstep(lo: number, hi: number, x: number) {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hash(x: number) {
  const s = Math.sin(x) * 43758.5453;
  return s - Math.floor(s);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
