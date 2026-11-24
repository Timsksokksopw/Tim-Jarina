interface Line {
  text: string;
  shown: number;
  key?: string;
}

/** Tiny boot log in the top-left corner, typed out character by character. */
export class Hud {
  private lines: Line[] = [];
  private dirty = true;

  constructor(private readonly el: HTMLElement) {}

  private get max() {
    return window.innerWidth < 640 ? 4 : 7;
  }

  push(text: string) {
    this.lines.push({ text, shown: 0 });
    this.trim();
  }

  /** Updates a live line in place (e.g. a progress bar) as long as it is the last one. */
  live(key: string, text: string) {
    const last = this.lines[this.lines.length - 1];
    if (last && last.key === key) {
      if (last.text !== text) {
        last.text = text;
        last.shown = text.length;
        this.dirty = true;
      }
      return;
    }
    this.lines.push({ text, shown: text.length, key });
    this.trim();
  }

  private trim() {
    while (this.lines.length > this.max) this.lines.shift();
    this.dirty = true;
  }

  update(dt: number) {
    const typing = this.lines.find((l) => l.shown < l.text.length);
    if (typing) {
      typing.shown = Math.min(typing.text.length, typing.shown + Math.max(1, Math.round(dt * 110)));
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const out: string[] = [];
    for (const l of this.lines) {
      out.push(l.text.slice(0, l.shown));
      if (l.shown < l.text.length) break;
    }
    this.el.textContent = out.join('\n');
  }
}
