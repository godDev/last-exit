import type { AudioSystem } from '../context';
import type { Voice } from '../voice';

/**
 * A station is a thing that is always broadcasting, whether or not anyone is listening.
 * That is the point: the dial finds programmes already in progress, and a station keeps
 * running its schedule while the driver is somewhere else on the band.
 */

export interface StationHost {
  audio: AudioSystem;
  voice: Voice;
  /** Put a line on screen, attributed to this station. */
  caption(stationId: string, key: string, seconds: number): void;
}

export abstract class Station {
  readonly out: GainNode;
  /** 0 = lost in the noise, 1 = locked on. */
  signal = 0;

  constructor(
    protected readonly host: StationHost,
    readonly id: string,
    readonly callsign: string,
    /** Dial position, kHz. */
    readonly frequency: number,
    /** How far either side of the frequency the station can still be heard, kHz. */
    readonly width = 11,
  ) {
    this.out = host.audio.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(host.audio.radio);
  }

  setSignal(strength: number): void {
    this.signal = strength;
    // squared, so the station comes up sharply as the needle lands on it
    this.out.gain.setTargetAtTime(strength * strength, this.host.audio.now, 0.07);
  }

  /** True once the station is loud enough for a caption to be worth reading. */
  protected get audible(): boolean {
    return this.signal > 0.45;
  }

  /** Below this, the programme keeps its own time but makes no sound. */
  protected get sounding(): boolean {
    return this.signal > 0.12;
  }

  abstract update(dt: number): void;
}

/**
 * A plucked note. Not a true Karplus-Strong loop: a feedback delay line has to be torn
 * down by hand, and through a 240-3600 Hz AM speaker the difference does not survive.
 */
export function pluck(
  ctx: AudioContext,
  destination: AudioNode,
  when: number,
  frequency: number,
  duration: number,
  level: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = frequency;

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.value = frequency * 2.004; // slight detune keeps it from sounding synthetic

  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(Math.min(6000, frequency * 9), when);
  tone.frequency.exponentialRampToValueAtTime(Math.max(220, frequency * 1.6), when + duration);
  tone.Q.value = 0.8;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(level, when + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  const mix = ctx.createGain();
  mix.gain.value = 0.6;

  osc.connect(mix);
  body.connect(mix);
  mix.connect(tone);
  tone.connect(env);
  env.connect(destination);

  osc.start(when);
  body.start(when);
  osc.stop(when + duration + 0.02);
  body.stop(when + duration + 0.02);
}

/** A held, bowed tone: bass notes and the pedal steel. */
export function sustain(
  ctx: AudioContext,
  destination: AudioNode,
  when: number,
  frequency: number,
  duration: number,
  level: number,
  type: OscillatorType = 'sine',
  vibrato = 0,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;

  if (vibrato > 0) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.value = frequency * vibrato;
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(when);
    lfo.stop(when + duration + 0.05);
  }

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(level, when + duration * 0.18);
  env.gain.setValueAtTime(level, when + duration * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  osc.connect(env);
  env.connect(destination);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

/** Equal temperament from a MIDI note number. */
export function midi(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}
