import type { AudioSystem } from './context';
import { Voice } from './voice';
import { noiseSource } from './noise';
import { Station } from './stations/station';
import type { StationHost } from './stations/station';
import { CountryStation } from './stations/music';
import { TalkStation } from './stations/talk';
import { NumbersStation } from './stations/numbers';
import { SCRIPTS } from '../content/radioScripts';
import { fbm1 } from '../core/rng';

/**
 * The dashboard radio.
 *
 * The dial is a real position on a real band, not a playlist index. Stations occupy a
 * few kilohertz each and everything between them is noise, so finding one is an act
 * rather than a menu choice — and at night, on AM, a station can fade out mid-sentence
 * because the ionosphere moved. That last part is not decoration: it is the excuse the
 * story needs for a broadcast to arrive that nobody transmitted.
 */

export const BAND_MIN = 505;
export const BAND_MAX = 1700;

/** kHz per second while the tuning key is held. */
const TUNE_RATE = 34;

export class Radio implements StationHost {
  readonly stations: Station[] = [];
  readonly voice: Voice;

  power = false;
  dial = 1180;

  private readonly staticGain: GainNode;
  private readonly staticFilter: BiquadFilterNode;
  private readonly whistle: OscillatorNode;
  private readonly whistleGain: GainNode;
  private readonly output: GainNode;
  private elapsed = 0;

  /** The line currently on air, if it is worth putting on screen. */
  private currentCaption: { stationId: string; key: string; until: number } | null = null;

  constructor(
    readonly audio: AudioSystem,
    private readonly onCaption: (stationId: string, key: string, seconds: number) => void,
  ) {
    this.voice = new Voice(audio);
    const ctx = audio.ctx;

    // everything the radio makes passes through one gain, so the power switch is real
    this.output = audio.radio;
    this.output.gain.value = 0;

    const hiss = noiseSource(ctx, 'white');
    this.staticGain = hiss.gain;
    this.staticFilter = ctx.createBiquadFilter();
    this.staticFilter.type = 'bandpass';
    this.staticFilter.frequency.value = 1400;
    this.staticFilter.Q.value = 0.4;
    this.staticGain.connect(this.staticFilter);
    this.staticFilter.connect(this.output);

    // the heterodyne whine either side of a station, before the carrier locks
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistle.frequency.value = 1000;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain);
    this.whistleGain.connect(this.output);
    this.whistle.start();

    this.stations.push(
      new CountryStation(this),
      new TalkStation(this, {
        id: 'kzqa',
        callsign: 'KZQ-A 1490 · NEWS',
        frequency: 1490,
        timbre: 'anchor',
        script: SCRIPTS.weather,
        gap: [1.6, 3.4],
        bed: { frequency: 300, q: 0.5, level: 0.012, kind: 'brown' },
      }),
      new TalkStation(this, {
        id: 'gospel',
        callsign: 'KGSP 1330 · GOSPEL',
        frequency: 1330,
        timbre: 'preacher',
        script: SCRIPTS.preacher,
        gap: [1.2, 2.6],
        bed: { frequency: 220, q: 0.4, level: 0.02, kind: 'brown' },
      }),
      new TalkStation(this, {
        id: 'sports',
        callsign: 'KBSN 860 · SPORTS',
        frequency: 860,
        timbre: 'sports',
        script: SCRIPTS.sports,
        gap: [0.8, 2.2],
        bed: { frequency: 700, q: 0.35, level: 0.03, kind: 'pink' },
      }),
      new TalkStation(this, {
        id: 'scanner',
        callsign: 'COUNTY BAND',
        frequency: 640,
        width: 7,
        timbre: 'police',
        script: SCRIPTS.scanner,
        gap: [6, 22],
        chatter: true,
        gain: 0.9,
      }),
      new NumbersStation(this, SCRIPTS.numbers),
    );
  }

  // --- StationHost ----------------------------------------------------------
  caption(stationId: string, key: string, seconds: number): void {
    this.currentCaption = { stationId, key, until: this.elapsed + seconds };
    this.onCaption(stationId, key, seconds);
  }

  // --- controls -------------------------------------------------------------
  togglePower(): void {
    this.power = !this.power;
    this.output.gain.setTargetAtTime(this.power ? 1 : 0, this.audio.now, this.power ? 0.25 : 0.06);
    if (!this.power) this.currentCaption = null;
  }

  tune(direction: number, dt: number): void {
    if (direction === 0) return;
    this.dial = Math.min(BAND_MAX, Math.max(BAND_MIN, this.dial + direction * TUNE_RATE * dt));
  }

  /** Jump to the next station up the band, wrapping at the top. */
  seek(): void {
    const sorted = [...this.stations].sort((a, b) => a.frequency - b.frequency);
    const next = sorted.find((s) => s.frequency > this.dial + 2) ?? sorted[0];
    this.dial = next.frequency;
  }

  // --- per frame ------------------------------------------------------------
  update(dt: number): void {
    this.elapsed += dt;

    let best: Station | null = null;
    let bestSignal = 0;

    for (const station of this.stations) {
      const distance = Math.abs(this.dial - station.frequency);
      let signal = Math.max(0, 1 - distance / station.width);
      signal = Math.pow(signal, 1.5);
      signal *= this.propagation(station);
      if (!this.power) signal = 0;

      station.setSignal(signal);
      station.update(dt);

      if (signal > bestSignal) {
        bestSignal = signal;
        best = station;
      }
    }

    const now = this.audio.now;

    // between stations there is only the band itself
    this.staticGain.gain.setTargetAtTime(this.power ? (1 - bestSignal) * 0.3 : 0, now, 0.08);
    this.staticFilter.frequency.setTargetAtTime(900 + (1 - bestSignal) * 1300, now, 0.15);

    // the whine peaks either side of a lock and vanishes on it
    const beat = bestSignal * (1 - bestSignal) * 4;
    this.whistleGain.gain.setTargetAtTime(this.power ? beat * 0.03 : 0, now, 0.05);
    if (best) {
      const offset = Math.abs(this.dial - best.frequency);
      this.whistle.frequency.setTargetAtTime(
        Math.min(3400, 260 + offset * 230),
        now,
        0.05,
      );
    }

    if (this.currentCaption && this.elapsed > this.currentCaption.until) {
      this.currentCaption = null;
    }
  }

  /**
   * Night-time skip. A distant transmitter on AM after dark comes and goes over tens of
   * seconds, which is why the dial is never quite reliable.
   */
  private propagation(station: Station): number {
    const local = station.id === 'krdx' || station.id === 'kzqa';
    if (local) return 1;
    const wander = fbm1(this.elapsed * 0.055 + station.frequency * 0.01, 0x5c1f, 2);
    return station.id === 'numbers'
      ? 0.55 + wander * 0.45
      : 0.72 + wander * 0.28;
  }

  /** What to print on the dial readout. */
  get readout(): string {
    const khz = Math.round(this.dial);
    if (!this.power) return '';
    let best: Station | null = null;
    let bestSignal = 0.4;
    for (const s of this.stations) {
      if (s.signal > bestSignal) { bestSignal = s.signal; best = s; }
    }
    return best ? `${best.callsign}` : `${khz} kHz`;
  }

  /** 0..1 position of the needle across the dial glass. */
  get needle(): number {
    return (this.dial - BAND_MIN) / (BAND_MAX - BAND_MIN);
  }
}
