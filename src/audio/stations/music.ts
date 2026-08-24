import { Station, pluck, sustain, midi } from './station';
import type { StationHost } from './station';
import { noiseBurst } from '../noise';
import { mulberry32 } from '../../core/rng';

/**
 * KRDX 1180 — country, all night, out of somewhere with a bigger transmitter than a town.
 *
 * A bar-at-a-time scheduler: it stays about a second ahead of the clock and writes notes
 * into the future, which is the only way to get steady timing out of WebAudio. The song is
 * generated rather than looped, so it never repeats exactly across a four hundred mile
 * night, and it keeps playing while the driver is elsewhere on the dial.
 */

const BPM = 92;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

/** I - IV - V in G, plus the vi that every other country song reaches for. */
const PROGRESSIONS = [
  [55, 55, 60, 62],
  [55, 60, 55, 62],
  [55, 52, 60, 62],
  [55, 55, 62, 60],
];

/** Major triad plus the sixth: enough to sound like a pedal steel without a pedal steel. */
const CHORD_TONES = [0, 4, 7, 9, 12, 16];
const MELODY_SCALE = [0, 2, 4, 7, 9, 12, 14, 16];

export class CountryStation extends Station {
  private nextBarTime = 0;
  private bar = 0;
  private readonly random = mulberry32(0x1180);
  private progression = PROGRESSIONS[0];

  constructor(host: StationHost) {
    super(host, 'krdx', 'KRDX 1180 · COUNTRY', 1180, 12);
  }

  update(_dt: number): void {
    const ctx = this.host.audio.ctx;
    const now = this.host.audio.now;
    if (this.nextBarTime === 0) this.nextBarTime = now + 0.15;

    // schedule about a second ahead; anything less and the browser drifts audibly
    while (this.nextBarTime < now + 1.1) {
      this.scheduleBar(ctx, this.nextBarTime);
      this.nextBarTime += BAR;
      this.bar++;
      if (this.bar % 8 === 0) {
        this.progression = PROGRESSIONS[Math.floor(this.random() * PROGRESSIONS.length)];
      }
    }
  }

  private scheduleBar(ctx: AudioContext, at: number): void {
    // the programme keeps its own time whether or not anyone is listening
    if (!this.sounding) return;

    const root = this.progression[this.bar % 4];
    const out = this.out;

    // --- upright bass: root on one, fifth on three -------------------------
    sustain(ctx, out, at, midi(root - 24), BEAT * 0.9, 0.22, 'triangle');
    sustain(ctx, out, at + BEAT * 2, midi(root - 24 + 7), BEAT * 0.9, 0.19, 'triangle');

    // --- acoustic guitar: boom-chick, eighth notes -------------------------
    for (let eighth = 0; eighth < 8; eighth++) {
      const t = at + eighth * (BEAT / 2);
      const offbeat = eighth % 2 === 1;
      const tone = CHORD_TONES[Math.floor(this.random() * CHORD_TONES.length)];
      pluck(ctx, out, t, midi(root + tone), offbeat ? 0.22 : 0.35, offbeat ? 0.06 : 0.1);
    }

    // --- brushes on two and four -------------------------------------------
    for (const beat of [1, 3]) {
      noiseBurst(ctx, out, at + beat * BEAT, 0.13, 2400, 1.1, 0.075);
    }
    for (let eighth = 0; eighth < 8; eighth++) {
      noiseBurst(ctx, out, at + eighth * (BEAT / 2), 0.05, 5200, 2.2, 0.016);
    }

    // --- pedal steel, one long note every other bar ------------------------
    if (this.bar % 2 === 0) {
      const tone = MELODY_SCALE[Math.floor(this.random() * MELODY_SCALE.length)];
      sustain(ctx, out, at + BEAT * 0.5, midi(root + 12 + tone), BAR * 0.8, 0.08, 'sine', 0.006);
    }
  }
}
