import { hueIndex, type GlyphAtlas } from './glyphs';
import { rand } from './util';

const TICK = 1 / 30;

/** Classic falling binary rain on its own canvas; cells occupied by the flower stay dark. */
export class Rain {
  colorful = false;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private cw = 8;
  private ch = 10;
  private cols = 0;
  private rows = 0;
  private head = new Float32Array(0);
  private speed = new Float32Array(0);
  private last = new Int32Array(0);
  private occ = new Uint8Array(0);
  private acc = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly atlas: GlyphAtlas,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(w: number, h: number, dpr: number, cw: number, ch: number) {
    this.w = w;
    this.h = h;
    this.cw = cw;
    this.ch = ch;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, w, h);
    this.cols = Math.ceil(w / cw);
    this.rows = Math.ceil(h / ch) + 1;
    this.head = new Float32Array(this.cols);
    this.speed = new Float32Array(this.cols);
    this.last = new Int32Array(this.cols).fill(-1);
    this.occ = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < this.cols; i++) this.reset(i, true);
  }

  private reset(i: number, initial = false) {
    this.head[i] = initial ? rand(-this.rows * 1.2, 0) : rand(-this.rows * 0.8, -2);
    this.speed[i] = rand(5, 20);
  }

  mark(col: number, row: number) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) this.occ[row * this.cols + col] = 1;
  }

  clearMarks() {
    this.occ.fill(0);
  }

  update(dt: number, t: number) {
    this.acc += dt;
    if (this.acc < TICK) return;
    const step = this.acc;
    this.acc = 0;
    const g = this.ctx;
    const A = this.atlas;
    const { cols, rows, cw, ch, occ } = this;
    g.fillStyle = 'rgba(0, 0, 0, 0.12)';
    g.fillRect(0, 0, this.w, this.h);
    for (let i = 0; i < cols; i++) {
      this.head[i] += this.speed[i] * step;
      const r = Math.floor(this.head[i]);
      if (r !== this.last[i]) {
        const x = (i + 0.5) * cw;
        const hue = this.colorful ? hueIndex(i * 9 + t * 40) : hueIndex(140);
        const pr = this.last[i];
        if (pr >= 0 && pr < rows && !occ[pr * cols + i]) {
          const y = (pr + 0.5) * ch;
          g.fillStyle = '#000';
          g.fillRect(x - cw / 2, y - ch / 2, cw, ch);
          A.draw(g, hue, 2, Math.random() < 0.5 ? 0 : 1, x, y);
        }
        if (r >= 0 && r < rows && !occ[r * cols + i]) A.draw(g, hue, 6, Math.random() < 0.5 ? 0 : 1, x, (r + 0.5) * ch);
        this.last[i] = r;
      }
      if (r > rows + 6) this.reset(i);
    }
  }
}
