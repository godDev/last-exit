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
    en: 'W / S  drive and brake     A / D  steer     E  interact\nMOUSE  look     LEFT SHIFT  sprint on foot     SPACE  mirror\nCLICK  capture mouse     ESC  menu',
    ru: 'W / S  газ, тормоз и задний ход     A / D  руль     E  взаимодействие\nМЫШЬ  обзор     ЛЕВЫЙ SHIFT  бег снаружи     SPACE  зеркало\nКЛИК  захватить мышь     ESC  меню',
  },
  'boot.context': { en: 'WESTERN TRAILS  /  ROUTE 17  /  OCTOBER 1991', ru: 'WESTERN TRAILS  /  МАРШРУТ 17  /  ОКТЯБРЬ 1991' },
  'boot.brief': {
    en: 'Las Palmas → Carson. One overnight shift.\nKeep the coach on the road. Count who is aboard.',
    ru: 'Лас-Пальмас → Карсон. Одна ночная смена.\nДержи автобус на дороге. Считай пассажиров.',
  },
  'boot.start': { en: 'START SHIFT', ru: 'НАЧАТЬ СМЕНУ' },
  'menu.aria': { en: 'Main menu', ru: 'Главное меню' },
  'menu.brief': { en: 'THE LAST ROUTE LEAVES AT 22:30.', ru: 'ПОСЛЕДНИЙ РЕЙС ОТПРАВЛЯЕТСЯ В 22:30.' },
  'menu.continue': { en: 'CONTINUE SHIFT', ru: 'ПРОДОЛЖИТЬ СМЕНУ' },
  'menu.resumeAt': { en: 'AUTOSAVE', ru: 'АВТОСОХРАНЕНИЕ' },
  'menu.noSave': { en: 'NO ACTIVE SHIFT', ru: 'НЕТ АКТИВНОЙ СМЕНЫ' },
  'menu.mile': { en: 'MILE', ru: 'МИЛЯ' },
  'menu.newShift': { en: 'NEW SHIFT', ru: 'НОВАЯ СМЕНА' },
  'menu.newShiftDetail': { en: 'Start at Las Palmas depot.', ru: 'Начать у депо в Лас-Пальмас.' },
  'menu.checkpoints': { en: 'SELECT CHECKPOINT', ru: 'ВЫБРАТЬ ЧЕКПОИНТ' },
  'menu.checkpointsDetail': { en: 'Begin from an authored route act.', ru: 'Начать с выбранного акта маршрута.' },
  'menu.checkpointHeading': { en: 'ROUTE CHECKPOINTS', ru: 'ЧЕКПОИНТЫ МАРШРУТА' },
  'menu.checkpoint.depot': { en: 'LAS PALMAS DEPOT', ru: 'ДЕПО ЛАС-ПАЛМАС' },
  'menu.checkpoint.depotDetail': { en: '22:30 · Departure', ru: '22:30 · Отправление' },
  'menu.checkpoint.mile86': { en: 'MILE 86', ru: '86-Я МИЛЯ' },
  'menu.checkpoint.mile86Detail': { en: '23:45 · The lit bus stop', ru: '23:45 · Остановка с включённым светом' },
  'menu.checkpoint.closedGas': { en: 'CLOSED SERVICE STATION', ru: 'ЗАКРЫТАЯ СЕРВИСНАЯ СТАНЦИЯ' },
  'menu.checkpoint.closedGasDetail': { en: '01:43 · A man beside a sedan', ru: '01:43 · Мужчина у седана' },
  'menu.checkpoint.millers': { en: 'MILLER’S GAS', ru: 'MILLER’S GAS' },
  'menu.checkpoint.millersDetail': { en: '02:26 · The station is still open', ru: '02:26 · Станция всё ещё открыта' },
  'menu.checkpoint.patrol': { en: 'HIGHWAY PATROL', ru: 'ДОРОЖНАЯ ПОЛИЦИЯ' },
  'menu.checkpoint.patrolDetail': { en: '03:15 · Documents, please', ru: '03:15 · Предъявите документы' },
  'menu.checkpoint.motel': { en: 'SUNSET MOTOR INN', ru: 'SUNSET MOTOR INN' },
  'menu.checkpoint.motelDetail': { en: '04:05 · Rooms 7 and 8', ru: '04:05 · Номера 7 и 8' },
  'menu.checkpoint.final': { en: 'LAST STOP', ru: 'ПОСЛЕДНЯЯ ОСТАНОВКА' },
  'menu.checkpoint.finalDetail': { en: '05:00 · Thirty miles to Carson', ru: '05:00 · Тридцать миль до Карсона' },
  'menu.language': { en: 'Language', ru: 'Язык' },
  'menu.atmosphereLabel': { en: 'NIGHT SERVICE', ru: 'НОЧНОЙ РЕЙС' },
  'menu.atmosphere': {
    en: 'October, 1991.\nA night route through the desert.\nThe passengers remember a trip you do not.',
    ru: 'Октябрь 1991-го.\nНочной рейс через пустыню.\nПассажиры помнят поездку, которой ты не помнишь.',
  },
  'menu.controls': { en: 'CLICK TO CAPTURE MOUSE  /  ESC TO RETURN HERE', ru: 'КЛИКНИ ДЛЯ ЗАХВАТА МЫШИ  /  ESC — ВЕРНУТЬСЯ СЮДА' },
  'pause.title': { en: 'SHIFT PAUSED', ru: 'СМЕНА ПРИОСТАНОВЛЕНА' },
  'pause.continue': { en: 'CONTINUE SHIFT', ru: 'ПРОДОЛЖИТЬ СМЕНУ' },
  'pause.menu': { en: 'RETURN TO MAIN MENU', ru: 'В ГЛАВНОЕ МЕНЮ' },
  'pause.menuHint': { en: 'Returning to the menu saves this shift automatically.', ru: 'При выходе в меню смена сохраняется автоматически.' },
  'pause.restart': { en: 'RESTART CHECKPOINT', ru: 'НАЧАТЬ С ЧЕКПОИНТА' },
  'pause.restartHint': { en: 'Restarting returns to the current route checkpoint.', ru: 'Перезапуск вернёт к текущему чекпоинту маршрута.' },

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
  'flashlight.on': { en: 'FLASHLIGHT ON', ru: 'ФОНАРЬ ВКЛЮЧЁН' },
  'flashlight.off': { en: 'FLASHLIGHT OFF', ru: 'ФОНАРЬ ВЫКЛЮЧЕН' },

  'choice.navigate': { en: '↑ ↓ select  ·  ENTER confirm  ·  1–3 quick choice', ru: '↑ ↓ выбор  ·  ENTER подтвердить  ·  1–3 быстрый выбор' },
  'choice.mile86.title': { en: 'A girl looks through the door glass. “Please. I need to get to Carson.” The Route 17 timetable behind her is dated October 14, 1986.', ru: 'Девушка смотрит в стекло двери: «Пожалуйста. Мне нужно в Карсон». За её спиной расписание Route 17 от 14 октября 1986 года.' },
  'choice.mile86.board': { en: 'Open the door and let her on.', ru: 'Открыть дверь и впустить её.' },
  'choice.mile86.pass': { en: 'Keep the doors closed and drive on.', ru: 'Не открывать двери и ехать дальше.' },
  'choice.mile86.radio': { en: 'Call dispatch for help.', ru: 'Вызвать диспетчера.' },
  'choice.roadside.title': { en: 'A man stands beside a dead sedan. He says his car has broken down.', ru: 'У заглохшего седана стоит мужчина. Он говорит, что машина сломалась.' },
  'choice.roadside.board': { en: 'Let him on the bus.', ru: 'Впустить его в автобус.' },
  'choice.roadside.leave': { en: 'Leave him on the shoulder.', ru: 'Оставить его на обочине.' },
  'choice.roadside.radio': { en: 'Call for roadside assistance.', ru: 'Вызвать помощь на дороге.' },
  'choice.patrol.title': { en: 'The Highway Patrol officer waits beside your window.', ru: 'Офицер дорожной полиции ждёт у твоего окна.' },
  'choice.patrol.documents': { en: 'Hand over license and registration.', ru: 'Передать права и документы.' },
  'choice.patrol.question': { en: 'Ask why he stopped the bus.', ru: 'Спросить, почему он остановил автобус.' },
  'choice.patrol.silent': { en: 'Say nothing.', ru: 'Ничего не говорить.' },
  'choice.finale.title': { en: 'Thirty miles to Carson. One passenger cannot arrive. Choose, or drive on.', ru: 'До Карсона тридцать миль. Один пассажир не должен прибыть. Выбери — или езжай дальше.' },
  'choice.finale.refuse': { en: 'Drive on. Do not choose anyone.', ru: 'Ехать дальше. Никого не выбирать.' },

  'intro.objective': {
    en: 'LAS PALMAS, 22:30. Take Route 17 to Carson. Three passengers are already aboard.',
    ru: 'ЛАС-ПАЛМАС, 22:30. Веди маршрут 17 до Карсона. В салоне уже трое пассажиров.',
  },
  'intro.mirror': {
    en: 'A driver checks the road, the clock, and the mirror. Hold SPACE to look back.',
    ru: 'Водитель следит за дорогой, часами и зеркалом. Удерживай SPACE, чтобы взглянуть назад.',
  },
  'scene.mile86.approach': { en: 'Mile 86 ahead. The stop light is on.', ru: 'Впереди 86-я миля. На остановке горит свет.' },
  'scene.roadside.approach': { en: 'Closed service station ahead. A car is waiting on the shoulder.', ru: 'Впереди закрытая сервисная станция. На обочине ждёт машина.' },
  'scene.millers.approach': { en: 'Miller’s Gas is still lit. It should have closed hours ago.', ru: 'У Miller’s Gas всё ещё горит свет. Она должна была закрыться много часов назад.' },
  'scene.motel.approach': { en: 'Sunset Motor Inn ahead. The vacancy sign is dark.', ru: 'Впереди Sunset Motor Inn. Табличка VACANCY не горит.' },
  'scene.finale.approach': { en: 'Carson is thirty miles away. Stop at the marker and check the journal.', ru: 'До Карсона тридцать миль. Остановись у знака и проверь журнал.' },
  'scene.millers.fallback': { en: 'A receipt slides from beneath the fare box. The date reads October 2026.', ru: 'Из-под кассы выскальзывает чек. На нём дата: октябрь 2026 года.' },
  'scene.final.missed': { en: 'You pass the last marker. The road refuses to end.', ru: 'Ты проезжаешь последний знак. Дорога отказывается заканчиваться.' },

  'ending.arrival.title': { en: 'CARSON — 06:00', ru: 'КАРСОН — 06:00' },
  'ending.arrival.detail': { en: 'Nora steps into the desert. Dawn reaches the road to Carson.', ru: 'Нора выходит в пустыню. Рассвет касается дороги на Карсон.' },
  'ending.route-continues.title': { en: 'ROUTE CONTINUES', ru: 'МАРШРУТ ПРОДОЛЖАЕТСЯ' },
  'ending.route-continues.detail': { en: 'The passenger returns in the mirror. Carson changes to Las Palmas.', ru: 'Пассажир возвращается в зеркале. Карсон превращается в Лас-Пальмас.' },
  'ending.no-final-stop.title': { en: 'NO FINAL STOP', ru: 'ПОСЛЕДНЕЙ ОСТАНОВКИ НЕТ' },
  'ending.no-final-stop.detail': { en: 'The saloon empties, but the mirror fills with people.', ru: 'Салон пустеет, но зеркало заполняется людьми.' },
  'ending.restart': { en: 'START A NEW SHIFT', ru: 'НАЧАТЬ НОВУЮ СМЕНУ' },

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
  'dispatch.mile86.radio': {
    en: 'Seventeen, there is no unit available. Do not stop. Do not turn around.',
    ru: 'Семнадцатый, свободных экипажей нет. Не останавливайся. Не разворачивайся.',
  },
  'dispatch.roadside': {
    en: 'Copy. County reports a disabled vehicle near the closed service station.',
    ru: 'Принято. Округ сообщает о заглохшей машине у закрытой станции обслуживания.',
  },
  'dispatch.patrol': {
    en: 'Bus seventeen, dispatch. Highway Patrol is asking for you. Keep your radio clear.',
    ru: 'Автобус семнадцать, диспетчерская. Тебя запрашивает дорожная полиция. Освободи радиоэфир.',
  },
  'radio.story.missing': {
    en: 'State Police are searching for Western Trails bus number seventeen, missing since October fourteenth, nineteen eighty-six.',
    ru: 'Полиция штата разыскивает автобус Western Trails номер семнадцать, пропавший четырнадцатого октября тысяча девятьсот восемьдесят шестого года.',
  },
  'radio.story.count': {
    en: 'Count what you carry, driver. Count it twice before Carson.',
    ru: 'Пересчитай, что везёшь, водитель. Пересчитай дважды до Карсона.',
  },

  'inspect.mile86.timetable': { en: 'The last printed departure is October 14, 1986.', ru: 'Последний напечатанный рейс датирован 14 октября 1986 года.' },
  'inspect.closed-gas.phone': { en: 'The receiver is warm, but there is no dial tone.', ru: 'Трубка тёплая, но в ней нет гудка.' },
  'inspect.closed-gas.car': { en: 'The engine is cold. The keys are still in it.', ru: 'Двигатель холодный. Ключи всё ещё в замке.' },
  'inspect.millers.pump': { en: 'The pump meter is still running, though the power is out.', ru: 'Счётчик колонки работает, хотя электричества нет.' },
  'inspect.millers.receipt': { en: 'A receipt is dated October 2026.', ru: 'Чек датирован октябрём 2026 года.' },
  'inspect.sunset.room7': { en: 'The bed is made. A driver’s jacket hangs in the closet.', ru: 'Кровать застелена. В шкафу висит водительская куртка.' },
  'inspect.sunset.room8': { en: 'A television inside speaks to someone who is not there.', ru: 'Телевизор внутри говорит с тем, кого здесь нет.' },
  'inspect.sunset.photo': { en: 'Western Trails staff, 1986. Your face is circled in grease pencil.', ru: 'Сотрудники Western Trails, 1986 год. Твоё лицо обведено жирным карандашом.' },
  'inspect.sunset.manifest': { en: 'Eleven passengers. One driver. October 14, 1986.', ru: 'Одиннадцать пассажиров. Один водитель. 14 октября 1986 года.' },
  'inspect.final.marker': { en: 'The distance to Carson has not changed.', ru: 'Расстояние до Карсона не изменилось.' },
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

/** UI language is exclusive: Russian mode should not duplicate every line in English. */
export function subtitle(key: string): { primary: string; secondary: string | null } {
  const line = STRINGS[key];
  if (!line) return { primary: key, secondary: null };
  if (settings.lang === 'en') return { primary: line.en, secondary: null };
  return {
    primary: line.ru,
    secondary: null,
  };
}
