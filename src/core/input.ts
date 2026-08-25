/** Keyboard state. Physical codes, so WASD works on any layout (including ЙЦУКЕН). */

export type Action =
  | 'throttle' | 'brake' | 'left' | 'right'
  | 'interact'
  | 'sprint'
  | 'lookMirror' | 'lookLeft' | 'lookRight'
  | 'radioPower' | 'radioUp' | 'radioDown' | 'radioSeek'
  | 'highBeam' | 'horn' | 'wipers'
  | 'toggleDebug' | 'toggleLang' | 'toggleJournal' | 'ghost' | 'pause' | 'autopilot' | 'inspect'
  | 'choiceOne' | 'choiceTwo' | 'choiceThree' | 'choiceNext' | 'choicePrevious' | 'choiceConfirm'
  | 'jumpMile86' | 'jumpRoadside' | 'jumpMillers' | 'jumpMotel' | 'jumpFinale' | 'resetShift';

const HELD: Record<string, Action> = {
  KeyW: 'throttle', ArrowUp: 'throttle',
  KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'lookMirror',
  KeyQ: 'lookLeft',
  KeyX: 'lookRight',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  BracketLeft: 'radioDown',
  BracketRight: 'radioUp',
};

const TAPPED: Record<string, Action> = {
  Digit1: 'choiceOne',
  Digit2: 'choiceTwo',
  Digit3: 'choiceThree',
  ArrowDown: 'choiceNext',
  ArrowUp: 'choicePrevious',
  Enter: 'choiceConfirm',
  KeyE: 'interact',
  KeyQ: 'lookLeft',
  KeyR: 'radioPower',
  KeyT: 'radioSeek',
  KeyH: 'highBeam',
  KeyF: 'horn',
  KeyV: 'wipers',
  F3: 'toggleDebug',
  F5: 'jumpMile86',
  F6: 'jumpRoadside',
  F7: 'jumpMillers',
  F8: 'jumpMotel',
  F9: 'jumpFinale',
  F10: 'resetShift',
  KeyL: 'toggleLang',
  KeyJ: 'toggleJournal',
  KeyG: 'ghost',
  KeyP: 'autopilot',
  KeyC: 'inspect',
  Escape: 'pause',
};

const DEV_ONLY = new Set<Action>([
  'toggleDebug', 'ghost', 'inspect',
  'jumpMile86', 'jumpRoadside', 'jumpMillers', 'jumpMotel', 'jumpFinale', 'resetShift',
]);

export class Input {
  private held = new Set<Action>();
  private tapped = new Set<Action>();
  private listeners = new Map<Action, Array<() => void>>();
  private mouseDX = 0;
  private mouseDY = 0;

  constructor(
    target: Window = window,
    private readonly developerTools = false,
    pointerElement?: HTMLElement,
  ) {
    target.addEventListener('keydown', (e) => {
      const h = HELD[e.code];
      if (h) { this.held.add(h); e.preventDefault(); }
      const t = TAPPED[e.code];
      if (t && (!DEV_ONLY.has(t) || this.developerTools) && !e.repeat) {
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

    if (pointerElement) {
      pointerElement.addEventListener('click', () => {
        if (document.pointerLockElement !== pointerElement) void pointerElement.requestPointerLock();
      });
      target.addEventListener('mousemove', (event) => {
        if (document.pointerLockElement !== pointerElement) return;
        this.mouseDX += Math.max(-180, Math.min(180, event.movementX));
        this.mouseDY += Math.max(-180, Math.min(180, event.movementY));
      });
    }
  }

  isDown(a: Action): boolean { return this.held.has(a); }

  /** Relative pointer motion accumulated since the previous rendered frame. */
  consumeMouse(): { x: number; y: number } {
    const delta = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }

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
