import { STORY_MILES } from '../world/stops';
import { newStory, type SaveData, type StoryState } from './story';

/** Entries exposed by the main menu. They are authored starts, not developer teleports. */
export type MenuCheckpointId = 'depot' | 'mile86' | 'closed-gas' | 'millers-gas' | 'highway-patrol' | 'sunset-motel' | 'final-stop';

export interface MenuCheckpoint {
  id: MenuCheckpointId;
  mile: number;
  minutes: number;
  titleKey: string;
  detailKey: string;
}

export const MENU_CHECKPOINTS: readonly MenuCheckpoint[] = [
  { id: 'depot', mile: 0, minutes: 22 * 60 + 30, titleKey: 'menu.checkpoint.depot', detailKey: 'menu.checkpoint.depotDetail' },
  { id: 'mile86', mile: STORY_MILES.mile86, minutes: 23 * 60 + 45, titleKey: 'menu.checkpoint.mile86', detailKey: 'menu.checkpoint.mile86Detail' },
  { id: 'closed-gas', mile: STORY_MILES.closedGas, minutes: 24 * 60 + 1 * 60 + 43, titleKey: 'menu.checkpoint.closedGas', detailKey: 'menu.checkpoint.closedGasDetail' },
  { id: 'millers-gas', mile: STORY_MILES.millersGas, minutes: 24 * 60 + 2 * 60 + 26, titleKey: 'menu.checkpoint.millers', detailKey: 'menu.checkpoint.millersDetail' },
  { id: 'highway-patrol', mile: STORY_MILES.highwayPatrol, minutes: 24 * 60 + 3 * 60 + 15, titleKey: 'menu.checkpoint.patrol', detailKey: 'menu.checkpoint.patrolDetail' },
  { id: 'sunset-motel', mile: STORY_MILES.sunsetMotel, minutes: 24 * 60 + 4 * 60 + 5, titleKey: 'menu.checkpoint.motel', detailKey: 'menu.checkpoint.motelDetail' },
  { id: 'final-stop', mile: STORY_MILES.finalStop, minutes: 24 * 60 + 5 * 60, titleKey: 'menu.checkpoint.final', detailKey: 'menu.checkpoint.finalDetail' },
];

const MILE_86_EVENTS = ['intro.mirror', 'mile86.warning', 'mile86.arrive'];
const ROADSIDE_EVENTS = [...MILE_86_EVENTS, 'roadside.warning', 'roadside.arrive'];
const MILLERS_EVENTS = [...ROADSIDE_EVENTS, 'roadside.man.disappears', 'millers.approach', 'millers.arrive'];
const PATROL_EVENTS = [...MILLERS_EVENTS, 'patrol.stop'];
const MOTEL_EVENTS = [...PATROL_EVENTS, 'motel.approach', 'motel.arrive'];
const FINAL_EVENTS = [...MOTEL_EVENTS, 'radio.missing-bus', 'radio.final-warning', 'final.roster', 'final.approach', 'finale.arrive'];

/**
 * Populate the canonical history required to enter an act safely. Checkpoint selection
 * should test the scene, not leave it half-initialised or replay every earlier trigger.
 */
export function makeCheckpointSave(id: MenuCheckpointId): SaveData {
  const checkpoint = MENU_CHECKPOINTS.find((entry) => entry.id === id) ?? MENU_CHECKPOINTS[0];
  const story = newStory();

  if (id === 'depot') return { version: 3, story, mile: checkpoint.mile, minutes: checkpoint.minutes };

  completeMile86(story);
  if (id === 'mile86') {
    story.flags = [];
    story.choices = {};
    story.evidence = ['mile86.timetable'];
    story.passengers = ['marian-cole', 'ray-hollis', 'helen-pike'];
    story.firedEvents = MILE_86_EVENTS;
    story.act = 'mile86';
    story.checkpoint = { kind: 'choice', stopId: 'mile86', scene: 'mile86' };
    return { version: 3, story, mile: checkpoint.mile, minutes: checkpoint.minutes };
  }

  completeRoadside(story);
  if (id === 'closed-gas') {
    story.firedEvents = ROADSIDE_EVENTS;
    story.checkpoint = { kind: 'choice', stopId: 'closed-gas', scene: 'stranded-man' };
    return { version: 3, story, mile: checkpoint.mile, minutes: checkpoint.minutes };
  }

  if (id === 'millers-gas') {
    story.firedEvents = MILLERS_EVENTS;
    story.checkpoint = { kind: 'stop', stopId: 'millers-gas' };
    return { version: 3, story, mile: checkpoint.mile, minutes: checkpoint.minutes };
  }

  completeMillers(story);
  if (id === 'highway-patrol') {
    story.firedEvents = PATROL_EVENTS;
    story.checkpoint = { kind: 'choice', stopId: 'highway-patrol', scene: 'patrol' };
    return { version: 3, story, mile: checkpoint.mile, minutes: checkpoint.minutes };
  }

  completePatrol(story);
  if (id === 'sunset-motel') {
    story.firedEvents = MOTEL_EVENTS;
    story.checkpoint = { kind: 'stop', stopId: 'sunset-motel' };
    return { version: 3, story, mile: checkpoint.mile, minutes: checkpoint.minutes };
  }

  completeMotel(story);
  completeFinaleSetup(story);
  story.firedEvents = FINAL_EVENTS;
  story.checkpoint = { kind: 'stop', stopId: 'final-stop' };
  return { version: 3, story, mile: checkpoint.mile, minutes: checkpoint.minutes };
}

function addUnique(list: string[], ...items: string[]): void {
  for (const item of items) if (!list.includes(item)) list.push(item);
}

function choose(story: StoryState, id: string, value: string): void {
  story.choices[id] = value;
  addUnique(story.flags, `choice:${id}`);
}

function evidence(story: StoryState, id: string): void {
  addUnique(story.evidence, id);
}

function flag(story: StoryState, id: string): void {
  addUnique(story.flags, id);
}

function appearance(story: StoryState, id: string, presence: 'both' | 'mirror', sway: number, eyeshine: number): void {
  story.appearances[id] = { presence, sway, eyeshine };
}

function completeMile86(story: StoryState): void {
  story.act = 'gas';
  choose(story, 'mile86', 'board');
  evidence(story, 'mile86.timetable');
  evidence(story, 'mile86.nora-boarded');
  addUnique(story.passengers, 'nora-vale');
}

function completeRoadside(story: StoryState): void {
  choose(story, 'stranded-man', 'board');
  evidence(story, 'closed-gas.car');
  evidence(story, 'closed-gas.frank-boarded');
  evidence(story, 'man.mirror');
  addUnique(story.passengers, 'frank-morrow');
  appearance(story, 'frank-morrow', 'mirror', 0, 1.5);
}

function completeMillers(story: StoryState): void {
  evidence(story, 'millers.receipt');
  evidence(story, 'miller.nora-boarded');
  flag(story, 'miller.returned');
  appearance(story, 'nora-vale', 'both', 1, 0);
}

function completePatrol(story: StoryState): void {
  story.act = 'patrol';
  choose(story, 'patrol', 'documents');
  evidence(story, 'patrol.bus17');
}

function completeMotel(story: StoryState): void {
  story.act = 'motel';
  evidence(story, 'sunset.photo');
  evidence(story, 'sunset.manifest');
  flag(story, 'motel.roster-revealed');
  addUnique(story.passengers,
    'douglas-ward', 'lena-ortiz', 'audrey-king', 'ben-ryder', 'claire-dunn', 'samuel-reeves', 'wendy-kerr',
  );
}

function completeFinaleSetup(story: StoryState): void {
  story.act = 'finale';
  evidence(story, 'final.marker');
  flag(story, 'final.roster-ready');
  story.passengers = [
    'marian-cole', 'ray-hollis', 'helen-pike', 'douglas-ward', 'lena-ortiz', 'frank-morrow',
    'audrey-king', 'ben-ryder', 'claire-dunn', 'samuel-reeves', 'wendy-kerr', 'nora-vale',
  ];
  for (const id of story.passengers) appearance(story, id, 'both', 1, 0);
}
