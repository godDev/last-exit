export type Tick = (dt: number, elapsed: number) => void;

/** RAF loop with a clamped dt so an alt-tab does not teleport the bus into the desert. */
export class Loop {
  private last = 0;
  private elapsed = 0;
  private raf = 0;
  private running = false;
  fps = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(private readonly tick: Tick) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const step = (now: number) => {
      this.raf = requestAnimationFrame(step);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.elapsed += dt;

      this.fpsAccum += dt;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAccum;
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }

      this.tick(dt, this.elapsed);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /**
   * Advance one frame by hand. requestAnimationFrame is parked whenever the page is not
   * being composited, which makes an unattended tab impossible to inspect; this gives
   * tooling a way to drive the simulation deterministically.
   */
  step(dt = 1 / 60): void {
    this.elapsed += dt;
    this.tick(dt, this.elapsed);
  }
}
