import type { AudioSystem } from './context';
import { noiseSource, noiseBurst } from './noise';
import type { Bus } from '../bus/drive';

/**
 * The bus itself.
 *
 * A six-cylinder four-stroke fires three times per revolution, so the engine note is
 * rpm/20 Hz and everything else is harmonics of it. Building it from oscillators rather
 * than a looped sample means it tracks the gearbox exactly — including the drop in pitch
 * every time the box shifts up, which is most of what makes a bus sound heavy.
 */
export class EngineAudio {
  private readonly osc: OscillatorNode[] = [];
  private readonly oscGain: GainNode[] = [];
  private readonly combustion: GainNode;
  private readonly combustionFilter: BiquadFilterNode;
  private readonly tyres: GainNode;
  private readonly tyreFilter: BiquadFilterNode;
  private readonly wind: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly gravel: GainNode;
  private readonly gravelFilter: BiquadFilterNode;
  private readonly bus: GainNode;

  private nextGravel = 0;

  constructor(private readonly audio: AudioSystem) {
    const ctx = audio.ctx;

    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(audio.cabin);

    // --- firing order -------------------------------------------------------
    // fundamental plus two harmonics; the fundamental carries the weight
    const partials = [
      { ratio: 1, gain: 0.14, type: 'sawtooth' as OscillatorType },
      { ratio: 2, gain: 0.055, type: 'square' as OscillatorType },
      { ratio: 0.5, gain: 0.1, type: 'sine' as OscillatorType },
    ];
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = 40 * partial.ratio;
      const gain = ctx.createGain();
      gain.gain.value = partial.gain;
      osc.connect(gain);

      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowpass';
      shelf.frequency.value = 900;
      gain.connect(shelf);
      shelf.connect(this.bus);

      osc.start();
      this.osc.push(osc);
      this.oscGain.push(gain);
    }

    // the ragged, unpitched half of a diesel
    const comb = noiseSource(ctx, 'brown');
    this.combustion = comb.gain;
    this.combustionFilter = ctx.createBiquadFilter();
    this.combustionFilter.type = 'bandpass';
    this.combustionFilter.frequency.value = 160;
    this.combustionFilter.Q.value = 0.7;
    this.combustion.connect(this.combustionFilter);
    this.combustionFilter.connect(this.bus);

    // --- road ---------------------------------------------------------------
    const road = noiseSource(ctx, 'pink');
    this.tyres = road.gain;
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 500;
    this.tyreFilter.Q.value = 0.5;
    this.tyres.connect(this.tyreFilter);
    this.tyreFilter.connect(this.bus);

    const air = noiseSource(ctx, 'white');
    this.wind = air.gain;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 2400;
    this.windFilter.Q.value = 0.35;
    this.wind.connect(this.windFilter);
    this.windFilter.connect(this.bus);

    const loose = noiseSource(ctx, 'white');
    this.gravel = loose.gain;
    this.gravelFilter = ctx.createBiquadFilter();
    this.gravelFilter.type = 'bandpass';
    this.gravelFilter.frequency.value = 1500;
    this.gravelFilter.Q.value = 0.6;
    this.gravel.connect(this.gravelFilter);
    this.gravelFilter.connect(this.bus);
  }

  update(dt: number, bus: Bus): void {
    const now = this.audio.now;
    const smooth = 0.06;

    // six cylinders, four stroke: three firing events per revolution
    const fundamental = Math.max(18, (bus.rpm / 60) * 3);
    for (let i = 0; i < this.osc.length; i++) {
      const ratio = [1, 2, 0.5][i];
      this.osc[i].frequency.setTargetAtTime(fundamental * ratio, now, smooth);
    }

    // under load the note opens up; coasting, it closes
    const load = bus.throttle > 0 ? 1 : 0.45;
    this.combustionFilter.frequency.setTargetAtTime(
      120 + fundamental * 1.6 + load * 220,
      now,
      smooth,
    );
    this.combustion.gain.setTargetAtTime(0.055 + load * 0.05, now, smooth);
    for (let i = 0; i < this.oscGain.length; i++) {
      const base = [0.14, 0.055, 0.1][i];
      this.oscGain[i].gain.setTargetAtTime(base * (0.55 + load * 0.55), now, smooth);
    }

    const speed = Math.min(1, Math.abs(bus.speed) / 29);
    this.tyres.gain.setTargetAtTime(speed * speed * 0.16, now, smooth);
    this.tyreFilter.frequency.setTargetAtTime(300 + speed * 700, now, smooth);
    this.wind.gain.setTargetAtTime(Math.pow(speed, 3) * 0.075, now, smooth);
    this.windFilter.frequency.setTargetAtTime(1600 + speed * 2200, now, smooth);

    this.gravel.gain.setTargetAtTime(bus.rumble * speed * 0.14, now, 0.03);

    // individual stones, not a wash of noise
    if (bus.rumble > 0.15) {
      this.nextGravel -= dt * (4 + bus.rumble * Math.abs(bus.speed) * 1.4);
      if (this.nextGravel <= 0) {
        this.nextGravel = 0.3 + Math.random() * 0.5;
        noiseBurst(this.audio.ctx, this.bus, now, 0.05, 900 + Math.random() * 2200, 3, 0.09);
      }
    }
  }

  /** Air brakes and the door: short, loud and diegetic. */
  hiss(duration = 0.7, peak = 0.22): void {
    noiseBurst(this.audio.ctx, this.bus, this.audio.now, duration, 2600, 0.8, peak);
  }
}
