/**
 * Trigger scheduler. The whole script of the finished game is meant to live here as data:
 * "at mile 86", "after 01:40", "once the man has been let on board".
 * The prototype only carries a couple of smoke-test triggers.
 */

export interface RouteState {
  /** Miles driven along route 17. */
  mile: number;
  /** Game minutes since midnight of the departure day. */
  minutes: number;
  speedMph: number;
  flags: Set<string>;
}

export interface StoryEvent<Ctx> {
  id: string;
  /** Fire only once (default). Set false for ambient triggers that may repeat. */
  once?: boolean;
  when: (s: RouteState) => boolean;
  run: (ctx: Ctx, s: RouteState) => void;
}

export class EventScheduler<Ctx> {
  private events: Array<StoryEvent<Ctx>> = [];
  private fired = new Set<string>();

  constructor(
    private readonly ctx: Ctx,
    private readonly onFired?: (id: string) => void,
  ) {}

  add(...events: Array<StoryEvent<Ctx>>): void {
    this.events.push(...events);
  }

  update(state: RouteState): void {
    for (const e of this.events) {
      const once = e.once !== false;
      if (once && this.fired.has(e.id)) continue;
      if (!e.when(state)) continue;
      this.fired.add(e.id);
      e.run(this.ctx, state);
      // Persist only after the event has parked the coach, changed the story state or
      // opened its modal. Saving before run() leaves a reload in the pre-event frame.
      this.onFired?.(e.id);
    }
  }

  hasFired(id: string): boolean { return this.fired.has(id); }

  /** Restore one-shot cues so loading a shift cannot replay an old revelation. */
  restore(ids: Iterable<string>): void {
    for (const id of ids) this.fired.add(id);
  }
}

/** Minimal typed pub/sub for cross-system signals (door opened, station tuned, ...). */
export class Signals<M extends Record<string, unknown>> {
  private map = new Map<keyof M, Array<(payload: never) => void>>();

  on<K extends keyof M>(key: K, fn: (payload: M[K]) => void): () => void {
    const list = this.map.get(key) ?? [];
    list.push(fn as (payload: never) => void);
    this.map.set(key, list);
    return () => {
      const cur = this.map.get(key);
      if (cur) this.map.set(key, cur.filter((f) => f !== fn));
    };
  }

  emit<K extends keyof M>(key: K, payload: M[K]): void {
    this.map.get(key)?.forEach((fn) => (fn as (p: M[K]) => void)(payload));
  }
}
