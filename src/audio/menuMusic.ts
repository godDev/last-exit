import { settings } from '../core/settings';

const MENU_THEME = '/audio/atlasaudio-horror-ambience-512255.mp3';
const MENU_LEVEL = 0.28;

/**
 * Menu ambience is intentionally separate from the in-world Web Audio graph. It lets the
 * browser stream the MP3 efficiently and guarantees the track cannot leak into the bus.
 */
export class MenuMusic {
  private readonly audio = new Audio(MENU_THEME);
  private wanted = false;

  constructor() {
    this.audio.loop = true;
    this.audio.preload = 'auto';
  }

  /** Safe to call before a gesture: browsers defer it, then the next menu click retries. */
  play(): void {
    this.wanted = true;
    this.audio.volume = Math.max(0, Math.min(1, settings.masterVolume * MENU_LEVEL));
    void this.audio.play().catch(() => {
      // Autoplay may be blocked on the initial page load. MainMenu calls play again from
      // its first button click, which is a user gesture and therefore permitted.
    });
  }

  /** Resetting the playhead prevents a quiet menu loop from resuming mid-phrase next visit. */
  stop(): void {
    this.wanted = false;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  /** Allows the menu to retry playback after the user interacts with any control. */
  retryAfterGesture(): void {
    if (this.wanted) this.play();
  }
}
