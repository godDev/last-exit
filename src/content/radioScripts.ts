import { register } from './i18n';
import type { Line } from './i18n';

/**
 * What is on the air tonight.
 *
 * The prototype's stations are ordinary on purpose: a forecast, a sermon, a ball game
 * nobody is awake for, a county scanner. The point of writing them straight is that when
 * the script later slips one wrong sentence into the rotation — a bulletin about a bus
 * that went missing in 1986 — it arrives in the same voice as the weather.
 */

const LINES: Record<string, Line> = {
  // --- KZQ-A, news and weather ---------------------------------------------
  'radio.weather.1': {
    en: 'Clear across the basin tonight, lows in the low forties, winds out of the northwest at ten.',
    ru: 'Ночью по всей котловине ясно, минимум около плюс пяти, ветер северо-западный, пять метров.',
  },
  'radio.weather.2': {
    en: 'Highway department reports no delays on state route seventeen through the county line.',
    ru: 'Дорожная служба: на семнадцатом шоссе до границы округа задержек нет.',
  },
  'radio.weather.3': {
    en: 'You are listening to KZQ, Ashford. The time is coming up on eleven o’clock.',
    ru: 'Вы слушаете KZQ, Эшфорд. Время приближается к одиннадцати часам.',
  },
  'radio.weather.4': {
    en: 'Livestock advisory remains in effect for the open range south of Red Creek.',
    ru: 'Предупреждение о выпасе скота к югу от Ред-Крика остаётся в силе.',
  },
  'radio.weather.5': {
    en: 'Overnight temperatures falling. Travellers are advised to watch for fog in the low ground.',
    ru: 'Ночью холодает. Водителям советуют опасаться тумана в низинах.',
  },

  // --- KGSP, all-night gospel -----------------------------------------------
  'radio.preacher.1': {
    en: 'And the road, beloved, the road is longer than the man who walks it.',
    ru: 'И дорога, возлюбленные, дорога длиннее того, кто по ней идёт.',
  },
  'radio.preacher.2': {
    en: 'There is a mercy in arriving. Not every traveller is granted it.',
    ru: 'В том, чтобы доехать, есть милость. Она даётся не каждому путнику.',
  },
  'radio.preacher.3': {
    en: 'Some of you are hearing me at this hour because you cannot sleep. I know why.',
    ru: 'Кто-то слышит меня в этот час, потому что не может уснуть. Я знаю почему.',
  },
  'radio.preacher.4': {
    en: 'Count what you carry, brother. Count it twice before the morning.',
    ru: 'Пересчитай, что везёшь, брат. Пересчитай дважды до утра.',
  },

  // --- KBSN, a game from three time zones away ------------------------------
  'radio.sports.1': {
    en: 'Two out, bottom of the ninth, and the crowd here has not sat down in ten minutes.',
    ru: 'Два аута, конец девятого, и трибуны здесь не садятся уже десять минут.',
  },
  'radio.sports.2': {
    en: 'He steps out of the box. Takes his time. Everybody in this park is taking their time.',
    ru: 'Он выходит из зоны. Не торопится. В этом парке сегодня никто не торопится.',
  },
  'radio.sports.3': {
    en: 'Swing and a miss, and that is strike two on the evening.',
    ru: 'Замах мимо — и это второй страйк за вечер.',
  },
  'radio.sports.4': {
    en: 'Folks, if you are just joining us out on the road somewhere, you picked a good inning.',
    ru: 'Друзья, если вы только поймали нас где-то на трассе — вы выбрали хороший иннинг.',
  },

  // --- county scanner --------------------------------------------------------
  'radio.scanner.1': {
    en: 'Unit four, we have a vehicle on the shoulder marker eighty-one, no occupants.',
    ru: 'Четвёртый, машина на обочине у отметки восемьдесят один, в салоне никого.',
  },
  'radio.scanner.2': {
    en: 'Copy that. Advise on the plate when you have it.',
    ru: 'Принято. Как только будет номер — сообщи.',
  },
  'radio.scanner.3': {
    en: 'Dispatch, be advised, second report of a pedestrian near mile eighty-six.',
    ru: 'Диспетчер, повторное сообщение о пешеходе у восемьдесят шестой мили.',
  },
  'radio.scanner.4': {
    en: 'Negative on that. Nothing out there. Nothing there the last time either.',
    ru: 'Отрицательно. Там ничего. И в прошлый раз ничего не было.',
  },
  'radio.scanner.5': {
    en: 'All units, clear the channel.',
    ru: 'Всем постам, освободить канал.',
  },

  // --- 512 kHz ---------------------------------------------------------------
  'radio.numbers.call': {
    en: 'Seventeen. Seventeen. Seventeen. Message follows.',
    ru: 'Семнадцать. Семнадцать. Семнадцать. Далее сообщение.',
  },
  'radio.numbers.1': {
    en: 'Group one. Four. Two. Nine. Zero. One. Four.',
    ru: 'Группа один. Четыре. Два. Девять. Ноль. Один. Четыре.',
  },
  'radio.numbers.2': {
    en: 'Group two. One. Nine. Eight. Six. One. Two.',
    ru: 'Группа два. Один. Девять. Восемь. Шесть. Один. Два.',
  },
  'radio.numbers.3': {
    en: 'Group three. Eight. Six. Zero. Zero. Zero. Zero.',
    ru: 'Группа три. Восемь. Шесть. Ноль. Ноль. Ноль. Ноль.',
  },
};

register(LINES);

export const SCRIPTS = {
  weather: [
    'radio.weather.1',
    'radio.weather.3',
    'radio.weather.2',
    'radio.weather.5',
    'radio.weather.4',
  ],
  preacher: [
    'radio.preacher.1',
    'radio.preacher.2',
    'radio.preacher.4',
    'radio.preacher.3',
  ],
  sports: ['radio.sports.1', 'radio.sports.2', 'radio.sports.3', 'radio.sports.4'],
  scanner: [
    'radio.scanner.1',
    'radio.scanner.2',
    'radio.scanner.3',
    'radio.scanner.4',
    'radio.scanner.5',
  ],
  /** First entry is the call-up; the rest are the groups it repeats. */
  numbers: ['radio.numbers.call', 'radio.numbers.1', 'radio.numbers.2', 'radio.numbers.3'],
};
