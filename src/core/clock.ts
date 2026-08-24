/** Game clock. The shift starts 22:30 and must reach Carson around 06:00. */

const SHIFT_START_MINUTES = 22 * 60 + 30;
const SHIFT_END_MINUTES = 24 * 60 + 6 * 60;

/**
 * The night is paced by the route, not by a stopwatch. This keeps authored revelations
 * at their intended hour whether the player drives carefully, pauses to inspect a clue,
 * or uses the accessibility autopilot.
 */
const ROUTE_TIMELINE: Array<{ mile: number; minutes: number }> = [
  { mile: 0, minutes: SHIFT_START_MINUTES },
  { mile: 1.6, minutes: 23 * 60 + 45 },
  { mile: 4.0, minutes: 24 * 60 + 1 * 60 + 43 },
  { mile: 6.5, minutes: 24 * 60 + 2 * 60 + 26 },
  { mile: 9.0, minutes: 24 * 60 + 3 * 60 + 15 },
  { mile: 11.5, minutes: 24 * 60 + 4 * 60 + 5 },
  { mile: 14.0, minutes: 24 * 60 + 5 * 60 },
  { mile: 16.0, minutes: SHIFT_END_MINUTES },
];

export class GameClock {
  /** Minutes since midnight of the departure day; can exceed 1440 past midnight. */
  minutes = SHIFT_START_MINUTES;
  paused = false;

  /** Move the wall clock forward to the authored time for the current route mile. */
  syncRoute(mile: number): void {
    if (this.paused) return;
    const target = routeMinutesAt(Math.max(0, mile));
    // Reversing to recover from a missed stop must not make the night run backwards.
    this.minutes = Math.max(this.minutes, target);
  }

  /** 24h wall clock, e.g. "01:43". */
  format(): string {
    const total = Math.floor(this.minutes) % (24 * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** 0 at 22:30, 1 at 06:00 — used to drive sky tint and fatigue. */
  get nightProgress(): number {
    return Math.min(1, Math.max(0, (this.minutes - SHIFT_START_MINUTES) / (SHIFT_END_MINUTES - SHIFT_START_MINUTES)));
  }
}

function routeMinutesAt(mile: number): number {
  const last = ROUTE_TIMELINE[ROUTE_TIMELINE.length - 1];
  if (mile >= last.mile) return last.minutes;
  for (let i = 1; i < ROUTE_TIMELINE.length; i++) {
    const next = ROUTE_TIMELINE[i];
    if (mile > next.mile) continue;
    const previous = ROUTE_TIMELINE[i - 1];
    const t = (mile - previous.mile) / (next.mile - previous.mile);
    return previous.minutes + (next.minutes - previous.minutes) * t;
  }
  return SHIFT_START_MINUTES;
}
