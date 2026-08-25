export type Lang = 'en' | 'ru';
export type GraphicsQuality = 'low' | 'medium' | 'high';

export const GRAPHICS_PRESETS: Record<GraphicsQuality, {
  renderHeight: number;
  msaaSamples: number;
  label: string;
}> = {
  low: { renderHeight: 540, msaaSamples: 0, label: 'LOW' },
  medium: { renderHeight: 810, msaaSamples: 2, label: 'MEDIUM' },
  high: { renderHeight: 1080, msaaSamples: 4, label: 'HIGH' },
};

export interface Settings {
  lang: Lang;
  masterVolume: number;
  /** 0 = clean render, 1 = full VHS damage. */
  retro: number;
  graphicsQuality: GraphicsQuality;
  /** Internal render height in pixels; width follows 16:9. */
  renderHeight: number;
  showDebug: boolean;
}

const KEY = 'last-exit/settings';

const DEFAULTS: Settings = {
  lang: 'en',
  masterVolume: 0.8,
  retro: 1,
  graphicsQuality: 'medium',
  renderHeight: GRAPHICS_PRESETS.medium.renderHeight,
  showDebug: false,
};

export const settings: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw) as Partial<Settings>;
    const loaded = { ...DEFAULTS, ...saved };
    // Older saves only stored renderHeight. Infer the nearest preset once, then keep the
    // height derived from the named preset so settings cannot drift into invalid states.
    if (!saved.graphicsQuality) {
      loaded.graphicsQuality = (saved.renderHeight ?? 810) >= 960 ? 'high' : (saved.renderHeight ?? 810) <= 600 ? 'low' : 'medium';
    }
    loaded.renderHeight = GRAPHICS_PRESETS[loaded.graphicsQuality].renderHeight;
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
