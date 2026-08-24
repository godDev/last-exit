/** Keyboard state. Physical codes, so WASD works on any layout (including ЙЦУКЕН). */

export type Action =
  | 'throttle' | 'brake' | 'left' | 'right'
  | 'lookMirror' | 'lookLeft' | 'lookRight'
  | 'radioPower' | 'radioUp' | 'radioDown' | 'radioSeek'
  | 'highBeam' | 'horn' | 'wipers'
  | 'toggleDebug' | 'toggleLang' | 'ghost' | 'pause' | 'autopilot' | 'inspect';

const HELD: Record<string, Action> = {
  KeyW: 'throttle', ArrowUp: 'throttle',
  KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'lookMirror',
  KeyQ: 'lookLeft',
  KeyE: 'lookRight',
  BracketLeft: 'radioDown',
  BracketRight: 'radioUp',
};

const TAPPED: Record<string, Action> = {
  KeyR: 'radioPower',
  KeyT: 'radioSeek',
  KeyH: 'highBeam',
  KeyF: 'horn',
  KeyV: 'wipers',
  F3: 'toggleDebug',
  KeyL: 'toggleLang',
  KeyG: 'ghost',
  KeyP: 'autopilot',
  KeyC: 'inspect',
  Escape: 'pause',
};

export class Input {
  private held = new Set<Action>();
  private tapped = new Set<Action>();
  private listeners = new Map<Action, Array<() => void>>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const h = HELD[e.code];
      if (h) { this.held.add(h); e.preventDefault(); }
      const t = TAPPED[e.code];
      if (t && !e.repeat) {
        this.tapped.add(t);
        this.listeners.get(t)?.forEach((fn) => fn());
        e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => {
      const h = HELD[e.code];
      if (h) this.held.delete(h);
    });
    target.addEventListener('blur', () => this.held.clear());
  }

  isDown(a: Action): boolean { return this.held.has(a); }

  /** True once per press. Call endFrame() after all consumers have polled. */
  wasTapped(a: Action): boolean { return this.tapped.has(a); }

  on(a: Action, fn: () => void): void {
    const list = this.listeners.get(a) ?? [];
    list.push(fn);
    this.listeners.set(a, list);
  }

  endFrame(): void { this.tapped.clear(); }

  /** -1..1 steering, +1..0 throttle etc. */
  axis(neg: Action, pos: Action): number {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }
}
