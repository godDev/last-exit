import { Station, sustain } from './station';
import type { StationHost } from './station';
import { t } from '../../content/i18n';

/**
 * The station that is not on any list.
 *
 * It sits at the bottom of the band below anything licensed, where there should be nothing
 * but atmospheric noise, and it runs the same shape as a real numbers station: an interval
 * signal, a call-up, a group of figures, silence. In the finished game this is where the
 * route talks back; in the prototype it exists to prove the dial can find something the
 * driver was not looking for.
 */

const INTERVAL_TONES = [622.25, 830.61]; // D#5 and G#5 — the classic minor-third marker

export class NumbersStation extends Station {
  private phase: 'interval' | 'call' | 'group' | 'silence' = 'interval';
  private timer = 0;
  private repeats = 0;
  private toneTimer = 0;
  private toneIndex = 0;

  constructor(host: StationHost, private readonly script: string[]) {
    // 512 kHz: below the broadcast band, where a domestic radio has no business receiving
    super(host, 'numbers', '— · —', 512, 7);
  }

  update(dt: number): void {
    this.timer -= dt;

    if (this.phase === 'interval') {
      this.toneTimer -= dt;
      if (this.toneTimer <= 0) {
        this.toneTimer = 1.05;
        if (this.sounding) {
          sustain(
            this.host.audio.ctx,
            this.out,
            this.host.audio.now + 0.02,
            INTERVAL_TONES[this.toneIndex % 2],
            0.85,
            0.14,
            'sine',
          );
        }
        this.toneIndex++;
      }
      if (this.timer <= 0) {
        this.phase = 'call';
        this.timer = 0;
      }
      return;
    }

    if (this.timer > 0) return;

    if (this.phase === 'call') {
      const spoken = this.speak(this.script[0]);
      this.timer = spoken + 1.6;
      this.phase = 'group';
      this.repeats = 0;
      return;
    }

    if (this.phase === 'group') {
      const key = this.script[1 + (this.repeats % (this.script.length - 1))];
      const spoken = this.speak(key);
      this.timer = spoken + 2.2;
      this.repeats++;
      if (this.repeats >= 4) {
        this.phase = 'silence';
        this.timer = spoken + 9;
      }
      return;
    }

    // silence, then the interval signal starts over
    this.phase = 'interval';
    this.timer = 14;
    this.toneTimer = 0;
  }

  private speak(key: string): number {
    const spoken = this.host.voice.speak(t(key), 'numbers', this.out, 1.1, !this.sounding);
    if (this.audible) this.host.caption(this.id, key, spoken + 1.6);
    return spoken;
  }
}
