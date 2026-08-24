/** Game clock. The shift starts 22:30 and must reach Carson around 06:00. */

const SHIFT_START_MINUTES = 22 * 60 + 30;

export class GameClock {
  /** Minutes since midnight of the departure day; can exceed 1440 past midnight. */
  minutes = SHIFT_START_MINUTES;
  /** Game minutes per real second. 1 real minute -> 1 game hour at 60. */
  scale = 20;
  paused = false;

  advance(dtSeconds: number): void {
    if (this.paused) return;
    this.minutes += (dtSeconds * this.scale) / 60;
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
    const end = 24 * 60 + 6 * 60;
    return Math.min(1, Math.max(0, (this.minutes - SHIFT_START_MINUTES) / (end - SHIFT_START_MINUTES)));
  }
}
