import { Station } from './station';
import type { StationHost } from './station';
import type { Timbre } from '../voice';
import { noiseSource, noiseBurst } from '../noise';
import { t } from '../../content/i18n';

/**
 * Every station on the band that is somebody talking: the weather, the preacher, the
 * ball game, the county scanner. They differ only in voice, pacing and what sits behind
 * them, so they are one class with a specification rather than four near-identical ones.
 */

export interface TalkSpec {
  id: string;
  callsign: string;
  frequency: number;
  width?: number;
  timbre: Timbre;
  /** i18n keys, spoken in order and then round again. */
  script: string[];
  /** Seconds of air between lines. */
  gap: [min: number, max: number];
  /** An optional bed under the voice: crowd noise, room tone, dead air. */
  bed?: { frequency: number; q: number; level: number; kind?: 'white' | 'pink' | 'brown' };
  /** Squelch bursts in the silence, for the scanner. */
  chatter?: boolean;
  gain?: number;
}

export class TalkStation extends Station {
  private index = 0;
  private timer = 0;
  private chatterTimer = 2;
  private readonly spec: TalkSpec;
  private readonly bedGain?: GainNode;

  constructor(host: StationHost, spec: TalkSpec) {
    super(host, spec.id, spec.callsign, spec.frequency, spec.width ?? 11);
    this.spec = spec;
    // start each station somewhere else in its own script, so the band is not synchronised
    this.index = Math.floor(Math.random() * spec.script.length);
    this.timer = Math.random() * 4;

    if (spec.bed) {
      const ctx = host.audio.ctx;
      const source = noiseSource(ctx, spec.bed.kind ?? 'pink');
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = spec.bed.frequency;
      filter.Q.value = spec.bed.q;
      source.gain.gain.value = spec.bed.level;
      source.gain.connect(filter);
      filter.connect(this.out);
      this.bedGain = source.gain;
    }
  }

  update(dt: number): void {
    this.timer -= dt;

    if (this.timer <= 0) {
      const key = this.spec.script[this.index % this.spec.script.length];
      this.index++;

      // the line is timed whether or not it is heard, so tuning in lands mid-programme
      const spoken = this.host.voice.speak(
        t(key),
        this.spec.timbre,
        this.out,
        this.spec.gain ?? 1,
        !this.sounding,
      );
      if (this.audible) this.host.caption(this.id, key, spoken + 1.4);

      const [min, max] = this.spec.gap;
      this.timer = spoken + min + Math.random() * (max - min);
    }

    if (this.spec.chatter && this.sounding) {
      this.chatterTimer -= dt;
      if (this.chatterTimer <= 0) {
        this.chatterTimer = 1.5 + Math.random() * 6;
        noiseBurst(
          this.host.audio.ctx,
          this.out,
          this.host.audio.now,
          0.05 + Math.random() * 0.1,
          1200 + Math.random() * 1400,
          3,
          0.1,
        );
      }
    }

    // the crowd swells when the announcer stops for breath
    if (this.bedGain && this.spec.bed) {
      const target = this.spec.bed.level * (this.timer > 1.2 ? 1.5 : 0.7);
      this.bedGain.gain.setTargetAtTime(target, this.host.audio.now, 0.6);
    }
  }
}
