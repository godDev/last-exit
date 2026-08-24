/**
 * Almost nothing.
 *
 * Speed, mileage and the time are on the dashboard where the driver has to look for them,
 * so the DOM layer is left with the two things that have no physical home in the cabin:
 * subtitles, and the name of whatever the radio has found.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly subs: HTMLElement;
  private subTimer = 0;
  private lastStation = '';

  constructor() {
    this.root = document.getElementById('hud')!;
    this.subs = document.getElementById('subtitles')!;
  }

  update(dt: number, data: { station?: string | null }): void {
    const station = data.station ?? '';
    if (station !== this.lastStation) {
      this.lastStation = station;
      this.root.innerHTML = station
        ? `<div class="slot"></div><div class="slot"><span>${station}</span></div>`
        : '';
    }

    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.subs.classList.add('hidden');
    }
  }

  /** Show a spoken line. `who` is a short speaker tag: DISPATCH, RADIO, ... */
  say(who: string | null, primary: string, secondary: string | null, seconds = 5): void {
    this.subs.classList.remove('hidden');
    this.subs.innerHTML =
      (who ? `<span class="who">${who}</span>` : '') +
      `<span class="line">${primary}</span>` +
      (secondary ? `<span class="line secondary">${secondary}</span>` : '');
    this.subTimer = seconds;
  }

  clear(): void {
    this.subTimer = 0;
    this.subs.classList.add('hidden');
  }
}
