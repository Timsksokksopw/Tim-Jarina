import { sleep } from './util';

export type Kind = 'sys' | 'dim' | 'cmd' | 'q' | 'ok' | 'err' | 'echo';

const MAX_LINES = 14;

export class Terminal {
  private readonly log: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private resolve: ((value: string) => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    this.log = root.querySelector('.term-log') as HTMLElement;
    this.form = root.querySelector('form') as HTMLFormElement;
    this.input = root.querySelector('input') as HTMLInputElement;
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = this.input.value.trim();
      if (!this.resolve || !value) return;
      const resolve = this.resolve;
      this.resolve = null;
      this.input.value = '';
      this.form.hidden = true;
      resolve(value);
    });
    root.addEventListener('pointerdown', () => this.focus());
  }

  get waiting() {
    return this.resolve !== null;
  }

  show() {
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('on');
  }

  hide() {
    this.input.blur();
    this.root.classList.remove('on');
    this.root.classList.add('off');
    setTimeout(() => (this.root.hidden = true), 900);
  }

  focus() {
    if (this.resolve) this.input.focus({ preventScroll: true });
  }

  print(text: string, kind: Kind = 'sys') {
    const el = document.createElement('div');
    el.className = `l ${kind}`;
    el.textContent = text;
    this.log.append(el);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    return el;
  }

  async type(text: string, kind: Kind = 'sys', cps = 60) {
    const el = this.print('', kind);
    for (let i = 1; i <= text.length; i++) {
      el.textContent = text.slice(0, i);
      await sleep((1000 / cps) * (0.4 + Math.random() * 1.2));
    }
  }

  async spin(label: string, ms: number) {
    const el = this.print('', 'dim');
    const frames = '|/-\\';
    const end = performance.now() + ms;
    for (let i = 0; performance.now() < end; i++) {
      el.textContent = `${label} ${frames[i % frames.length]}`;
      await sleep(70);
    }
    el.remove();
  }

  async progress(label: string, ms: number) {
    const el = this.print('', 'dim');
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      el.textContent = `${label} [${'█'.repeat(Math.round(p * 16)).padEnd(16, '░')}] ${Math.round(p * 100)}%`;
      await sleep((ms / steps) * (0.5 + Math.random()));
    }
  }

  read(): Promise<string> {
    this.form.hidden = false;
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.focus();
    });
  }
}
