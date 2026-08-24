import { settings } from '../core/settings';

/**
 * Every line of the game lives here as a pair. The world speaks English — the signage,
 * the dispatcher, the radio are all part of the setting — and Russian rides underneath
 * as a subtitle. Keys are namespaced by system so the script can grow without collisions.
 */

export interface Line {
  en: string;
  ru: string;
}

export const STRINGS: Record<string, Line> = {
  'boot.note': {
    en: 'W  throttle / brake from reverse   S  brake / reverse\nA / D  steer left / right\nSPACE  glance at the mirror   Q / E  look around\nR  radio   [ ]  tune   T  seek\nH  high beams   P  autopilot   C  inspect the cab\nF3  diagnostics',
    ru: 'W / S  газ и тормоз\nA / D  руль\nSPACE  взгляд в зеркало   Q / E  осмотреться\nR  радио   [ ]  настройка   T  поиск\nH  дальний свет   P  автопилот   C  осмотр кабины\nF3  диагностика',
  },

  'hud.mile': { en: 'MILE', ru: 'МИЛЯ' },
  'hud.route': { en: 'RTE 17', ru: 'МАРШРУТ 17' },
  'hud.mph': { en: 'MPH', ru: 'МИЛЬ/Ч' },

  'sign.lasPalmas': { en: 'LAS PALMAS', ru: 'ЛАС-ПАЛМАС' },
  'sign.redCreek': { en: 'RED CREEK', ru: 'РЕД-КРИК' },
  'sign.ashford': { en: 'ASHFORD', ru: 'ЭШФОРД' },
  'sign.silverLake': { en: 'SILVER LAKE', ru: 'СИЛВЕР-ЛЕЙК' },
  'sign.carson': { en: 'CARSON', ru: 'КАРСОН' },

  'who.dispatch': { en: 'DISPATCH', ru: 'ДИСПЕТЧЕР' },
  'who.radio': { en: 'RADIO', ru: 'РАДИО' },
  'who.driver': { en: 'YOU', ru: 'ТЫ' },

  'dispatch.checkin': {
    en: 'Bus seventeen, dispatch. Copy your departure, twenty-two thirty-one. Road is yours tonight.',
    ru: 'Автобус семнадцать, диспетчерская. Отправление в 22:31 принято. Дорога сегодня твоя.',
  },
  'dispatch.mile86': {
    en: 'Bus seventeen. Do not stop at Mile eighty-six.',
    ru: 'Автобус семнадцать. На восемьдесят шестой миле не останавливайся.',
  },
  'dispatch.repeat': {
    en: 'Seventeen, acknowledge. Do not stop at Mile eighty-six.',
    ru: 'Семнадцатый, подтверди приём. На восемьдесят шестой миле не останавливайся.',
  },
};

/**
 * Add lines from a content module. Scripts that belong to one system — the radio, an act,
 * a set of newspaper clippings — are written next to that system and registered here, so
 * this file does not become the place every string in the game has to pass through.
 */
export function register(entries: Record<string, Line>): void {
  Object.assign(STRINGS, entries);
}

export function t(key: string): string {
  const line = STRINGS[key];
  if (!line) return key;
  return settings.lang === 'ru' ? line.ru : line.en;
}

/** The English original plus, when the player reads Russian, the translation under it. */
export function subtitle(key: string): { primary: string; secondary: string | null } {
  const line = STRINGS[key];
  if (!line) return { primary: key, secondary: null };
  if (settings.lang === 'en') return { primary: line.en, secondary: null };
  return {
    primary: line.ru,
    secondary: settings.dualSubtitles ? line.en : null,
  };
}
