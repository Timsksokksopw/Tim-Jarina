export const HUE_STEPS = 72;
export const LIGHTS = [0.14, 0.26, 0.4, 0.53, 0.66, 0.79, 0.93];
export const MAX_LIGHT = LIGHTS.length - 1;

export const hueIndex = (deg: number) => ((Math.round(deg / 5) % HUE_STEPS) + HUE_STEPS) % HUE_STEPS;

export function lightIndex(l: number) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < LIGHTS.length; i++) {
    const d = Math.abs(LIGHTS[i] - l);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Returns [hue in degrees, lightness 0..1]. */
export function rgbToHueLight(r: number, g: number, b: number): [number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, (max + min) / 2];
}

/** Pre-rendered "0"/"1" sprites for every hue × lightness bucket; drawImage is far cheaper than fillText. */
export class GlyphAtlas {
  readonly canvas = document.createElement('canvas');
  font = 0;
  private sw = 1;
  private sh = 1;
  private dw = 1;
  private dh = 1;
  private key = '';

  build(fontPx: number, dpr: number, oversample = 1) {
    const key = `${fontPx}|${dpr}|${oversample}`;
    if (key === this.key) return;
    this.key = key;

    const px = Math.max(4, fontPx * dpr * oversample);
    const pad = Math.ceil(px * 0.22);
    const sw = Math.ceil(px * 0.62) + pad * 2;
    const sh = Math.ceil(px * 0.86) + pad * 2;
    const c = this.canvas;
    c.width = LIGHTS.length * 2 * sw;
    c.height = HUE_STEPS * sh;

    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.font = `500 ${px}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const m = g.measureText('0');
    const baseline = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    g.shadowBlur = px * 0.22;

    for (let h = 0; h < HUE_STEPS; h++) {
      for (let l = 0; l < LIGHTS.length; l++) {
        const color = `hsl(${h * 5}, 100%, ${LIGHTS[l] * 100}%)`;
        g.fillStyle = color;
        g.shadowColor = color;
        for (let k = 0; k < 2; k++) {
          g.fillText(k ? '1' : '0', (l * 2 + k) * sw + sw / 2, h * sh + sh / 2 + baseline);
        }
      }
    }

    this.sw = sw;
    this.sh = sh;
    this.dw = sw / (dpr * oversample);
    this.dh = sh / (dpr * oversample);
    this.font = fontPx;
  }

  /** Height of one sprite in CSS px at size 1. */
  get height() {
    return this.dh;
  }

  draw(ctx: CanvasRenderingContext2D, hue: number, light: number, glyph: number, x: number, y: number, size = 1) {
    const w = this.dw * size;
    const h = this.dh * size;
    ctx.drawImage(this.canvas, (light * 2 + glyph) * this.sw, hue * this.sh, this.sw, this.sh, x - w / 2, y - h / 2, w, h);
  }
}
