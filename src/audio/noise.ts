/**
 * Noise, which turns out to be most of this soundtrack: tyre roar, wind, tape hiss,
 * the space between stations, the brushes on a snare drum, and the breath in a voice.
 */

const cache = new WeakMap<AudioContext, Map<string, AudioBuffer>>();

export type NoiseKind = 'white' | 'pink' | 'brown';

/** One long buffer per kind, looped forever. Generating this per voice would be wasteful. */
export function noiseBuffer(ctx: AudioContext, kind: NoiseKind = 'white', seconds = 4): AudioBuffer {
  let perContext = cache.get(ctx);
  if (!perContext) {
    perContext = new Map();
    cache.set(ctx, perContext);
  }
  const key = `${kind}:${seconds}`;
  const existing = perContext.get(key);
  if (existing) return existing;

  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === 'white') {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's economical pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }

  perContext.set(key, buffer);
  return buffer;
}

/** A looping noise source already wired to a gain, ready to be shaped. */
export function noiseSource(
  ctx: AudioContext,
  kind: NoiseKind = 'white',
): { source: AudioBufferSourceNode; gain: GainNode } {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, kind);
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  source.start();
  return { source, gain };
}

/** One-shot burst: gravel under the tyres, a squelch on the police band, a rim shot. */
export function noiseBurst(
  ctx: AudioContext,
  destination: AudioNode,
  when: number,
  duration: number,
  frequency: number,
  q: number,
  peak: number,
  kind: NoiseKind = 'white',
): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, kind);
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = q;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + duration * 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(when);
  source.stop(when + duration + 0.05);
}
