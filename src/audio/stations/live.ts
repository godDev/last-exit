import { Station } from './station';
import type { StationHost } from './station';

/**
 * A real internet radio stream, tuned in like any other frequency on the dial.
 *
 * Every other station in this folder is synthesised (see context.ts for why); this one is
 * somebody else's actual broadcast, fetched over the network the first time the dial lands
 * close enough to hear it — never sooner, so a frequency nobody visits costs no bandwidth.
 * A dead link, a blocked host or no connection at all must never take the rest of the radio
 * down with it: it should just sound like an empty patch of the band.
 */
export class LiveStation extends Station {
  private readonly url: string;
  private started = false;
  private failed = false;

  constructor(
    host: StationHost,
    config: { id: string; callsign: string; frequency: number; url: string; width?: number },
  ) {
    super(host, config.id, config.callsign, config.frequency, config.width ?? 9);
    this.url = config.url;
  }

  update(): void {
    if (!this.started && !this.failed && this.sounding) this.start();
  }

  private start(): void {
    this.started = true;
    const element = new Audio();
    element.crossOrigin = 'anonymous';
    element.preload = 'none';
    element.src = this.url;
    element.addEventListener('error', () => { this.failed = true; });

    let source: MediaElementAudioSourceNode;
    try {
      source = this.host.audio.ctx.createMediaElementSource(element);
    } catch (error) {
      // A tainted or unreachable source must not take the rest of the dial down with it.
      console.warn(`live station "${this.id}" could not be connected`, error);
      this.failed = true;
      return;
    }
    source.connect(this.out);

    element.play().catch((error) => {
      console.warn(`live station "${this.id}" could not start`, error);
      this.failed = true;
    });
  }
}
