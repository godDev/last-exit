import { settings } from '../core/settings';

/**
 * The whole soundtrack is synthesised. No files means nothing to load, nothing to license,
 * and a radio that can be tuned between stations rather than cross-fading between clips.
 *
 * Two buses, because they are two different places:
 *   cabin  — the engine, the road, the body of the bus. Heard directly.
 *   radio  — everything coming out of the dashboard speaker, and therefore everything that
 *            has to sound like 1991 AM: band-limited, a little squashed, a little dirty.
 */

/** Soft clip, so the radio bus distorts on peaks like a small speaker rather than clicking. */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class AudioSystem {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  /** Things heard directly: engine, tyres, body. */
  readonly cabin: GainNode;
  /** Things heard through the dashboard speaker. */
  readonly radio: GainNode;
  /** The CB set, which is a different, harsher speaker than the radio. */
  readonly cb: GainNode;

  private constructor() {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = settings.masterVolume;
    this.master.connect(this.ctx.destination);

    this.cabin = this.ctx.createGain();
    this.cabin.connect(this.master);

    // --- the dashboard speaker ---------------------------------------------
    this.radio = this.ctx.createGain();
    const radioLow = this.ctx.createBiquadFilter();
    radioLow.type = 'highpass';
    radioLow.frequency.value = 240;
    const radioHigh = this.ctx.createBiquadFilter();
    radioHigh.type = 'lowpass';
    radioHigh.frequency.value = 3600;
    const radioBody = this.ctx.createBiquadFilter();
    radioBody.type = 'peaking';
    radioBody.frequency.value = 1500;
    radioBody.Q.value = 0.9;
    radioBody.gain.value = 5;
    const radioDrive = this.ctx.createWaveShaper();
    radioDrive.curve = driveCurve(2.2);

    this.radio.connect(radioLow);
    radioLow.connect(radioHigh);
    radioHigh.connect(radioBody);
    radioBody.connect(radioDrive);
    radioDrive.connect(this.master);

    // --- the CB ------------------------------------------------------------
    this.cb = this.ctx.createGain();
    const cbBand = this.ctx.createBiquadFilter();
    cbBand.type = 'bandpass';
    cbBand.frequency.value = 1350;
    cbBand.Q.value = 1.6;
    const cbDrive = this.ctx.createWaveShaper();
    cbDrive.curve = driveCurve(4.5);
    this.cb.connect(cbBand);
    cbBand.connect(cbDrive);
    cbDrive.connect(this.master);
  }

  private static instance: AudioSystem | null = null;

  /** Must be called from a user gesture; browsers will not start audio otherwise. */
  static async start(): Promise<AudioSystem> {
    if (!AudioSystem.instance) AudioSystem.instance = new AudioSystem();
    const system = AudioSystem.instance;
    if (system.ctx.state === 'suspended') await system.ctx.resume();
    return system;
  }

  static get current(): AudioSystem | null {
    return AudioSystem.instance;
  }

  /** Freeze every synthesized source while a full-screen menu owns the game. */
  suspend(): Promise<void> {
    return this.ctx.state === 'running' ? this.ctx.suspend() : Promise.resolve();
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  setVolume(value: number): void {
    settings.masterVolume = value;
    this.master.gain.setTargetAtTime(value, this.now, 0.05);
  }
}
