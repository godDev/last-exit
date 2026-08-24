import type { PassengerSpec } from '../bus/passengers';

export interface PassengerProfile extends PassengerSpec {
  name: string;
  role: string;
  roleRu: string;
  /** Year this person entered the route, not necessarily the wall-clock year on the bus. */
  boarded: 1986 | 2026;
  clue: string;
  clueRu: string;
}

export const PASSENGERS: PassengerProfile[] = [
  { id: 'marian-cole', name: 'Marian Cole', role: 'school secretary', roleRu: 'секретарь школы', boarded: 1986, row: 1, side: -1, coat: 0x3a3630, clue: 'Her newspaper photograph is dated October 1986.', clueRu: 'Её газетная фотография датирована октябрём 1986 года.' },
  { id: 'ray-hollis', name: 'Ray Hollis', role: 'night mechanic', roleRu: 'ночной механик', boarded: 1986, row: 2, side: 1, coat: 0x40372c, clue: 'His work badge expired on the night of the disappearance.', clueRu: 'Его рабочий пропуск истёк в ночь исчезновения.' },
  { id: 'helen-pike', name: 'Helen Pike', role: 'travelling nurse', roleRu: 'выездная медсестра', boarded: 1986, row: 3, side: 1, coat: 0x2a3038, clue: 'Her patient chart is stamped October 14, 1986.', clueRu: 'Её карта пациента помечена 14 октября 1986 года.' },
  { id: 'douglas-ward', name: 'Douglas Ward', role: 'retired surveyor', roleRu: 'геодезист на пенсии', boarded: 1986, row: 4, side: -1, coat: 0x453c30, clue: 'He knows the road layout from before the Carson bypass existed.', clueRu: 'Он знает дорогу ещё до строительства объезда Карсона.' },
  { id: 'lena-ortiz', name: 'Lena Ortiz', role: 'college applicant', roleRu: 'абитуриентка', boarded: 1986, row: 4, side: 1, coat: 0x353b34, clue: 'Her acceptance letter is addressed to a campus that closed in 1993.', clueRu: 'Её письмо о зачислении адресовано в кампус, закрытый в 1993-м.' },
  { id: 'frank-morrow', name: 'Frank Morrow', role: 'produce salesman', roleRu: 'продавец овощей', boarded: 1986, row: 5, side: -1, coat: 0x2f2a2a, clue: 'His receipt lists prices from 1986.', clueRu: 'В его чеке указаны цены 1986 года.' },
  { id: 'audrey-king', name: 'Audrey King', role: 'motel pianist', roleRu: 'пианистка из мотеля', boarded: 1986, row: 5, side: 1, coat: 0x3a3630, clue: 'She recognises the television programme in Room 8.', clueRu: 'Она узнаёт передачу, идущую в номере 8.' },
  { id: 'ben-ryder', name: 'Ben Ryder', role: 'army veteran', roleRu: 'ветеран армии', boarded: 1986, row: 6, side: -1, coat: 0x2a3038, clue: 'His bus ticket has route number 17 and the 1986 date.', clueRu: 'В его билете указан маршрут 17 и дата 1986 года.' },
  { id: 'claire-dunn', name: 'Claire Dunn', role: 'waitress', roleRu: 'официантка', boarded: 1986, row: 7, side: 1, coat: 0x40372c, clue: 'Her name appears in the original passenger manifest.', clueRu: 'Её имя есть в исходном манифесте пассажиров.' },
  { id: 'samuel-reeves', name: 'Samuel Reeves', role: 'radio repairman', roleRu: 'радиомастер', boarded: 1986, row: 8, side: -1, coat: 0x453c30, clue: 'He can identify a broadcast that has not been transmitted yet.', clueRu: 'Он может узнать передачу, которую ещё не транслировали.' },
  { id: 'wendy-kerr', name: 'Wendy Kerr', role: 'runaway', roleRu: 'сбежавшая из дома', boarded: 1986, row: 9, side: 1, coat: 0x353b34, clue: 'Her missing-person notice was printed in 1986.', clueRu: 'Объявление о её пропаже напечатано в 1986 году.' },
  { id: 'nora-vale', name: 'Nora Vale', role: 'unknown traveller', roleRu: 'неизвестная путешественница', boarded: 2026, row: 10, side: -1, coat: 0x2f2a2a, clue: 'A receipt from Miller’s Gas is dated October 2026.', clueRu: 'Чек Miller’s Gas датирован октябрём 2026 года.' },
];

export const INITIAL_PASSENGERS = ['marian-cole', 'ray-hollis', 'helen-pike'];

export const EVIDENCE: Record<string, { title: string; detail: string; titleRu: string; detailRu: string }> = {
  'mile86.nora-boarded': { title: 'Mile 86 passenger', detail: 'The girl gave no name when she boarded, but took a seat near the back.', titleRu: 'Пассажир с 86-й мили', detailRu: 'Девушка не назвала имени, когда вошла, но заняла место в конце салона.' },
  'mile86.nora-mirror': { title: 'Girl in the mirror', detail: 'You drove past Mile 86, yet her reflection remained in the rear-view glass.', titleRu: 'Девушка в зеркале', detailRu: 'Ты проехал 86-ю милю, но её отражение осталось в салонном зеркале.' },
  'mile86.dispatch-denial': { title: 'Dispatch denial', detail: 'Dispatch had no unit for the girl at Mile 86 and told you not to turn around.', titleRu: 'Отказ диспетчера', detailRu: 'У диспетчера не было экипажа для девушки с 86-й мили, и он приказал не разворачиваться.' },
  'mile86.timetable': { title: 'Route 17 timetable', detail: 'The last printed departure is October 14, 1986.', titleRu: 'Расписание маршрута 17', detailRu: 'Последний напечатанный рейс датирован 14 октября 1986 года.' },
  'closed-gas.frank-boarded': { title: 'Passenger from the shoulder', detail: 'The stranded man boarded and chose the last row.', titleRu: 'Пассажир с обочины', detailRu: 'Мужчина с обочины вошёл в автобус и сел на последний ряд.' },
  'closed-gas.left-behind': { title: 'Man on the shoulder', detail: 'You left the stranded man beside a sedan whose engine was already cold.', titleRu: 'Мужчина на обочине', detailRu: 'Ты оставил мужчину у седана, чей двигатель уже остыл.' },
  'closed-gas.assistance': { title: 'Roadside call', detail: 'Dispatch acknowledged the disabled sedan, but no other vehicle came.', titleRu: 'Вызов помощи', detailRu: 'Диспетчер подтвердил заглохший седан, но другой автомобиль так и не приехал.' },
  'closed-gas.car': { title: 'Abandoned sedan', detail: 'The engine is cold, but its keys are still in the ignition.', titleRu: 'Брошенный седан', detailRu: 'Двигатель холодный, но ключи всё ещё в замке зажигания.' },
  'millers.pump': { title: 'Pump 2 meter', detail: 'The meter runs although the station has no power.', titleRu: 'Счётчик колонки 2', detailRu: 'Счётчик работает, хотя на станции нет электричества.' },
  'millers.receipt': { title: 'Miller’s receipt', detail: 'The transaction is dated October 2026.', titleRu: 'Чек Miller’s Gas', detailRu: 'Операция датирована октябрём 2026 года.' },
  'miller.nora-boarded': { title: 'Nora at Miller’s', detail: 'After Miller’s Gas, Nora is present in the saloon rather than only in the mirror.', titleRu: 'Нора у Miller’s', detailRu: 'После Miller’s Gas Нора находится в салоне, а не только в зеркале.' },
  'man.mirror': { title: 'Open rear door', detail: 'The stranded man vanished from the cabin but remained in the mirror.', titleRu: 'Задняя дверь', detailRu: 'Мужчина с обочины исчез из салона, но остался в зеркале.' },
  'patrol.bus17': { title: 'Highway Patrol report', detail: 'The officer recognised Bus 17 as a vehicle missing since 1986.', titleRu: 'Отчёт дорожной полиции', detailRu: 'Офицер узнал Bus 17, пропавший ещё в 1986 году.' },
  'sunset.room7': { title: 'Room 7', detail: 'A driver’s jacket is waiting in the open room.', titleRu: 'Номер 7', detailRu: 'В открытом номере ждёт водительская куртка.' },
  'sunset.room8': { title: 'Room 8', detail: 'A television speaks inside a room closed for five years.', titleRu: 'Номер 8', detailRu: 'Телевизор говорит в номере, закрытом уже пять лет.' },
  'sunset.photo': { title: 'Western Trails photograph', detail: 'The driver in the 1986 staff photograph is you.', titleRu: 'Фотография Western Trails', detailRu: 'Водитель на фотографии сотрудников 1986 года — ты.' },
  'sunset.manifest': { title: 'Original passenger manifest', detail: 'The 1986 list contains eleven passengers and the driver’s name.', titleRu: 'Исходный манифест пассажиров', detailRu: 'В списке 1986 года — одиннадцать пассажиров и имя водителя.' },
  'final.marker': { title: 'Carson distance marker', detail: 'The last thirty miles refuse to become twenty-nine.', titleRu: 'Указатель на Карсон', detailRu: 'Последние тридцать миль отказываются превращаться в двадцать девять.' },
};

export function passenger(id: string): PassengerProfile | undefined {
  return PASSENGERS.find((profile) => profile.id === id);
}
