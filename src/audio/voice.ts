import type { AudioSystem } from './context';
import { noiseBurst } from './noise';

/**
 * Speech without a voice actor and without the browser's speech synthesiser.
 *
 * `speechSynthesis` cannot be routed into a WebAudio graph, so a TTS voice would arrive
 * unfiltered and sit outside the radio entirely — clean, modern and wrong. Instead each
 * syllable is a pitched buzz pushed through two formant filters with a consonant burst in
 * front of it, which is roughly how a vowel is made. It carries cadence, accent and mood
 * while staying deliberately unintelligible, so the subtitle does the actual talking.
 */

interface Vowel { f1: number; f2: number; }

const VOWELS: Vowel[] = [
  { f1: 730, f2: 1090 }, // a
  { f1: 530, f2: 1840 }, // e
  { f1: 270, f2: 2290 }, // i
  { f1: 570, f2: 840 },  // o
  { f1: 300, f2: 870 },  // u
  { f1: 640, f2: 1190 }, // schwa-ish
];

export type Timbre = 'dispatch' | 'preacher' | 'anchor' | 'sports' | 'police' | 'numbers';

interface TimbreSpec {
  pitch: number;
  /** Syllables per second. */
  rate: number;
  /** How far the pitch wanders over a phrase. */
  melody: number;
  breathy: number;
  squelch: boolean;
}

const TIMBRES: Record<Timbre, TimbreSpec> = {
  dispatch: { pitch: 104, rate: 4.4, melody: 0.1, breathy: 0.5, squelch: true },
  preacher: { pitch: 96, rate: 3.1, melody: 0.34, breathy: 0.35, squelch: false },
  anchor: { pitch: 116, rate: 4.7, melody: 0.09, breathy: 0.3, squelch: false },
  sports: { pitch: 132, rate: 5.6, melody: 0.28, breathy: 0.25, squelch: false },
  police: { pitch: 100, rate: 5.2, melody: 0.06, breathy: 0.6, squelch: true },
  numbers: { pitch: 150, rate: 2.2, melody: 0.0, breathy: 0.15, squelch: false },
};

/** Stable per-syllable choices, so a line sounds the same every time it is spoken. */
function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function syllabify(word: string): number {
  const letters = word.replace(/[^a-zа-яё]/gi, '');
  if (letters.length === 0) return 0;
  const groups = letters.toLowerCase().match(/[aeiouyаеёиоуыэюя]+/g);
  return Math.max(1, Math.min(5, groups ? groups.length : Math.ceil(letters.length / 3)));
}

export class Voice {
  private active: AudioScheduledSourceNode[] = [];

  constructor(private readonly audio: AudioSystem) {}

  /**
   * Speak a line. Returns how long it will take, so the subtitle can be held for exactly
   * as long as the mouth is moving.
   *
   * `silent` runs the same timing without scheduling a single node. A station the driver
   * is not tuned to still has to keep its own clock — otherwise every programme on the
   * band would restart from the top the moment the needle found it.
   */
  speak(text: string, timbre: Timbre, destination: AudioNode, gain = 1, silent = false): number {
    const ctx = this.audio.ctx;
    const spec = TIMBRES[timbre];
    const seed = hashText(text);

    let t = this.audio.now + 0.02;
    const start = t;

    if (spec.squelch) {
      if (!silent) noiseBurst(ctx, destination, t, 0.09, 1800, 2.5, 0.13 * gain);
      t += 0.13;
    }

    const words = text.split(/\s+/).filter(Boolean);
    let syllableIndex = 0;
    const totalSyllables = words.reduce((sum, w) => sum + syllabify(w), 0) || 1;

    for (const word of words) {
      const count = syllabify(word);
      for (let s = 0; s < count; s++) {
        const r = (seed + syllableIndex * 2654435761) >>> 0;
        const rand = (n: number) => ((r >>> (n * 5)) & 0x1f) / 31;

        const vowel = VOWELS[(r >>> 3) % VOWELS.length];
        const phrase = syllableIndex / totalSyllables;
        // statements fall away at the end; the rise on a question is not modelled here
        const contour = 1 + spec.melody * (Math.sin(phrase * 5.2 + (r % 7)) * 0.5 - phrase * 0.55);
        const pitch = spec.pitch * contour * (0.96 + rand(1) * 0.08);
        const duration = (1 / spec.rate) * (0.68 + rand(2) * 0.5);

        if (!silent) this.syllable(destination, t, duration, pitch, vowel, spec, gain, rand(3));

        t += duration;
        syllableIndex++;
      }
      // the gap between words, longer where the punctuation asks for it
      t += /[,;:]$/.test(word) ? 0.19 : /[.!?]$/.test(word) ? 0.34 : 0.045;
    }

    if (spec.squelch) {
      if (!silent) noiseBurst(ctx, destination, t + 0.05, 0.07, 1500, 3, 0.1 * gain);
      t += 0.12;
    }

    return t - start;
  }

  private syllable(
    destination: AudioNode,
    when: number,
    duration: number,
    pitch: number,
    vowel: Vowel,
    spec: TimbreSpec,
    gain: number,
    variation: number,
  ): void {
    const ctx = this.audio.ctx;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitch * 0.94, when);
    osc.frequency.linearRampToValueAtTime(pitch, when + duration * 0.3);
    osc.frequency.linearRampToValueAtTime(pitch * 0.97, when + duration);

    const scale = pitch / 110;
    // Q is kept low on purpose. A narrow bandpass is a more accurate formant and throws
    // away nearly all the energy of the source, which leaves the speaker inaudible under
    // the static; these are wide enough to pass a voice.
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = vowel.f1 * scale;
    f1.Q.value = 3.2;

    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = vowel.f2 * scale;
    f2.Q.value = 4.2;

    // the chest under the formants, without which the voice is all whistle
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 900 * scale;
    body.Q.value = 0.7;

    const mix = ctx.createGain();
    mix.gain.value = 0.45;

    const env = ctx.createGain();
    const peak = 0.6 * gain * (0.8 + variation * 0.4);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak, when + Math.min(0.035, duration * 0.3));
    env.gain.setValueAtTime(peak, when + duration * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(f1);
    osc.connect(f2);
    osc.connect(body);
    f1.connect(mix);
    f2.connect(mix);
    body.connect(mix);
    mix.connect(env);
    env.connect(destination);

    osc.start(when);
    osc.stop(when + duration + 0.02);
    this.track(osc);

    // the consonant in front of the vowel
    if (variation > 0.25) {
      noiseBurst(
        ctx,
        destination,
        when,
        0.035,
        1400 + variation * 3500,
        2,
        0.05 * gain * spec.breathy,
      );
    }
  }

  private track(node: AudioScheduledSourceNode): void {
    this.active.push(node);
    node.addEventListener('ended', () => {
      const i = this.active.indexOf(node);
      if (i >= 0) this.active.splice(i, 1);
    });
  }

  /** Cut the speaker off mid-word, which is sometimes exactly what should happen. */
  stop(): void {
    for (const node of this.active) {
      try { node.stop(); } catch { /* already finished */ }
    }
    this.active.length = 0;
  }
}
