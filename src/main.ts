import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './style.css';
import { GlyphAtlas } from './glyphs';
import { buildFlower, flowerRadius, type Rect } from './flower2d';
import { Rain } from './rain';
import { FORM_START, Swarm, T_BURST } from './swarm';
import { Hud } from './hud';
import { Terminal } from './terminal';
import { clamp, sleep } from './util';

const QUESTIONS = [
  { q: 'Wann hat Tim Geburtstag?', a: '13.10.2007' },
  { q: 'Wann sind wir zusammengekommen?', a: '29.05.2026' },
];

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const app = $('#app');
const stageEl = $('#stage');
const sceneCv = $<HTMLCanvasElement>('#scene');
const glowCv = $<HTMLCanvasElement>('#glow');
const lockEl = $('#lock');
const flashEl = $('#flash');
const sctx = sceneCv.getContext('2d')!;
const gctx = glowCv.getContext('2d')!;

const atlas = new GlyphAtlas();
const atlasF = new GlyphAtlas();
const rain = new Rain($<HTMLCanvasElement>('#rain'), atlas);
const swarm = new Swarm(atlas, atlasF, rain);
const hud = new Hud($('#hud'));
const term = new Terminal($('#terminal'));

let stage: 'form' | 'formed' | 'auth' | 'finale' = 'form';
let W = 0;
let H = 0;
let DPR = 1;
let sim = 0;
let formedAt = 0;
let flashed = false;
let bootStep = 0;

function layout() {
  const vv = window.visualViewport;
  const w = Math.round(window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (w === W && h === H && dpr === DPR) return;
  W = w;
  H = h;
  DPR = dpr;
  app.style.setProperty('--app-h', `${H}px`);

  sceneCv.width = Math.round(W * DPR);
  sceneCv.height = Math.round(H * DPR);
  sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  glowCv.width = Math.ceil(W / 4);
  glowCv.height = Math.ceil(H / 4);
  gctx.imageSmoothingQuality = 'high';

  // keep room for the boot log on top and the command line at the bottom
  const top = W < 640 ? Math.min(84, H * 0.13) : clamp(H * 0.07, 30, 84);
  const bottom = clamp(H * 0.27, 140, 235);
  const box: Rect = { x: 0, y: top, w: W, h: Math.max(60, H - top - bottom) };
  const R = flowerRadius(box);
  const font = Math.max(clamp(R / 26, 6.5, 10), R / 40);
  const cw = font * 0.7;
  const ch = font * 0.98;
  atlas.build(font, DPR);
  rain.resize(W, H, DPR, cw, ch);
  swarm.resize(W, H);

  if (stage === 'finale') {
    swarm.layoutFinale(DPR);
    return;
  }
  const f = buildFlower(box, cw, ch);
  swarm.setFlower(f, sim);
  const pad = 14 + cw;
  Object.assign(lockEl.style, {
    left: `${f.bounds.x - pad}px`,
    top: `${f.bounds.y - pad}px`,
    width: `${f.bounds.w + pad * 2}px`,
    height: `${f.bounds.h + pad * 2}px`,
  });
  lockEl.querySelector('span')!.textContent = `obj#01 · flower.bin · ${f.targets.length} nodes`;
}

let resizeTimer = 0;
const scheduleLayout = () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(layout, 140);
};
window.addEventListener('resize', scheduleLayout);
window.visualViewport?.addEventListener('resize', scheduleLayout);
window.visualViewport?.addEventListener('scroll', () => {
  app.style.setProperty('--app-top', `${window.visualViewport!.offsetTop}px`);
});

const bar = (p: number, n: number) => '█'.repeat(Math.round(p * n)).padEnd(n, '░');

const BOOT: [number, () => string][] = [
  [0.1, () => 'bloom/os 2.3.0 · tty0 · secure boot'],
  [0.5, () => '[ ok ] mount /dev/heart'],
  [0.9, () => '[ ok ] handshake aes-256-gcm · 0x7f3a'],
  [1.3, () => `[ .. ] seeding ${swarm.ps.length} nodes`],
];

function flash(kind: 'go' | 'err') {
  flashEl.className = 'flash';
  void flashEl.offsetWidth;
  flashEl.className = `flash ${kind}`;
}

/** Accepts 13.10.2007, 13.10.07, 13,10,07, 13/10/2007, 2007-10-13, 13102007 … */
function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let d: number;
  let m: number;
  let y: number;
  let r = s.match(/^(\d{1,2})\s*[.,\/\- ]\s*(\d{1,2})\s*[.,\/\- ]\s*(\d{4}|\d{2})\.?$/);
  if (r) [d, m, y] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{4})\s*[.\/\-]\s*(\d{1,2})\s*[.\/\-]\s*(\d{1,2})$/))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{2})(\d{2})(\d{4})$/))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else return null;
  if (y < 100) y += 2000;
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

async function authenticate() {
  term.show();
  await sleep(450);
  await term.type('$ ./unlock --target herz.tim', 'cmd', 38);
  await sleep(250);
  await term.type('[*] verschlüsselte blume gefunden · 2 sicherheitsfragen', 'dim', 70);
  for (let i = 0; i < QUESTIONS.length; i++) {
    const { q, a } = QUESTIONS[i];
    await sleep(300);
    await term.type(`[?] frage ${i + 1}/${QUESTIONS.length} · ${q}`, 'q', 45);
    for (;;) {
      const raw = await term.read();
      term.print(`> ${raw}`, 'echo');
      await term.spin('[~] prüfe signatur', 700);
      if (normalizeDate(raw) === a) {
        swarm.ripple(sim);
        await term.type(`[+] korrekt · zugriffsstufe ${i + 1}/${QUESTIONS.length} freigegeben`, 'ok', 70);
        break;
      }
      swarm.glitch(sim);
      flash('err');
      await term.type('[!] zugriff verweigert · versuch es nochmal', 'err', 70);
    }
  }
  await sleep(250);
  await term.progress('[*] entschlüssele bloom.core', 1500);
  await term.type('[+] ZUGRIFF GEWÄHRT', 'ok', 30);
  await sleep(600);
  term.hide();
  startFinale();
}

function startFinale() {
  stage = 'finale';
  app.classList.add('finale', 'granted', 'shake');
  lockEl.classList.remove('on');
  rain.colorful = true;
  swarm.startFinale(sim, DPR);
  hud.push('[ ok ] access granted · bloom.exe --forever');
  setTimeout(() => app.classList.remove('granted'), 2000);
}

function story() {
  while (bootStep < BOOT.length && sim >= BOOT[bootStep][0]) hud.push(BOOT[bootStep++][1]());
  if (stage === 'form' && sim >= FORM_START) {
    const p = swarm.progress;
    hud.live('compile', `compiling flower.bin [${bar(p, 14)}] ${String(Math.floor(p * 100)).padStart(3)}%`);
    if (p >= 1) {
      stage = 'formed';
      formedAt = sim;
      hud.push(`[ ok ] render complete · ${swarm.ps.length} nodes`);
      lockEl.classList.add('on');
      swarm.startScan(sim);
    }
  } else if (stage === 'formed' && sim - formedAt > 1.6) {
    stage = 'auth';
    hud.push('[ !! ] payload encrypted · auth required');
    void authenticate();
  } else if (stage === 'finale' && !flashed && sim - swarm.finaleAt >= T_BURST) {
    flashed = true;
    flash('go');
    app.classList.remove('shake');
  }
}

let last = 0;
function frame(now: number) {
  const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0;
  last = now;
  sim += dt;

  rain.update(dt, sim);
  swarm.update(dt, sim);

  sctx.globalCompositeOperation = 'destination-out';
  sctx.fillStyle = `rgba(0, 0, 0, ${swarm.fade})`;
  sctx.fillRect(0, 0, W, H);
  sctx.globalCompositeOperation = 'source-over';
  swarm.draw(sctx, sim);

  gctx.clearRect(0, 0, glowCv.width, glowCv.height);
  gctx.drawImage(sceneCv, 0, 0, glowCv.width, glowCv.height);

  hud.update(dt);
  story();
  requestAnimationFrame(frame);
}

stageEl.addEventListener('pointermove', (e) => swarm.pointer(e.clientX, e.clientY, sim));
stageEl.addEventListener('pointerdown', (e) => {
  swarm.pointer(e.clientX, e.clientY, sim);
  swarm.burst(e.clientX, e.clientY);
  term.focus();
});
stageEl.addEventListener('pointerleave', () => swarm.pointerOut());
stageEl.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') swarm.pointerOut();
});
window.addEventListener('keydown', () => {
  if (term.waiting && document.activeElement?.id !== 'cmd') term.focus();
});

async function boot() {
  try {
    await Promise.race([document.fonts.load('500 32px "JetBrains Mono"'), sleep(2500)]);
  } catch {
    // system monospace fallback is fine
  }
  layout();
  requestAnimationFrame(frame);
}

void boot();
