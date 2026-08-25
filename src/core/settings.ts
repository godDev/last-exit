export type Lang = 'en' | 'ru';

export interface Settings {
  lang: Lang;
  /** Show the English line under the translation. */
  dualSubtitles: boolean;
  masterVolume: number;
  /** 0 = clean render, 1 = full VHS damage. */
  retro: number;
  /** Internal render height in pixels; width follows 16:9. */
  renderHeight: number;
  showDebug: boolean;
}

const KEY = 'last-exit/settings';

const DEFAULTS: Settings = {
  lang: 'en',
  dualSubtitles: true,
  masterVolume: 0.8,
  retro: 1,
  // Still deliberately low-resolution, but with enough detail for the dashboard,
  // road furniture and distant silhouettes to read on modern displays.
  renderHeight: 810,
  showDebug: false,
};

export const settings: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const loaded = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    // Migrate old low-resolution saves so faces and dashboard detail remain legible.
    loaded.renderHeight = Math.max(810, loaded.renderHeight);
    return loaded;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode; run with defaults */
  }
}
