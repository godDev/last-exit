import * as THREE from 'three';

import { Renderer } from './render/renderer';
import { LightingRig } from './render/lighting';
import { shared, updateHeadlights, updateMoon, updateTorch } from './render/retroMaterial';
import { Loop } from './core/loop';
import { Input } from './core/input';
import { GameClock } from './core/clock';
import { EventScheduler } from './core/events';
import type { RouteState } from './core/events';
import { Interactions } from './core/interactions';
import { MENU_CHECKPOINTS, makeCheckpointSave, type MenuCheckpointId } from './core/checkpoints';
import { Story, type StoryChoiceScene, type StoryEnding, type StoryStopId } from './core/story';
import { PassengerDirector } from './story/passengerDirector';
import { BoardingCutscene } from './story/boardingCutscene';
import { SEED_ROUTE, mulberry32 } from './core/rng';
import { settings, saveSettings } from './core/settings';
import { RoutePath, STATION_SPACING } from './world/curvature';
import { METRES_PER_MILE } from './core/units';
import { Road, ROAD_AHEAD, ROAD_BEHIND } from './world/road';
import { PropField } from './world/props';
import { Traffic } from './world/traffic';
import { StoryStops, STORY_MILES, STORY_STOPS } from './world/stops';
import { Sky } from './world/sky';
import { DistantLandscape, HeadlightDust } from './world/atmosphere';
import { RoadsideLights } from './world/roadsideLights';
import { FloatingOrigin } from './world/origin';
import { Bus } from './bus/drive';
import { Cabin, EYE_LOCAL, LEFT_MIRROR_MOUNT, MIRROR_MOUNT } from './bus/interior';
import { Roster } from './bus/passengers';
import { LAYER_DIRECT_ONLY, setCabinGlow } from './bus/mirror';
import { AudioSystem } from './audio/context';
import { EngineAudio } from './audio/engine';
import { MenuMusic } from './audio/menuMusic';
import { Radio } from './audio/radio';
import { Hud } from './ui/hud';
import { Journal } from './ui/journal';
import { Choices } from './ui/choices';
import { EndingScreen } from './ui/ending';
import { MainMenu } from './ui/mainMenu';
import { PauseMenu } from './ui/pause';
import { DebugPanel } from './ui/debug';
import { t, subtitle } from './content/i18n';
import { PASSENGERS } from './content/passengers';

/** Everything reachable from the console while tuning. Filled in as systems come up. */
const dev: Record<string, unknown> = {};
const FRESH_SHIFT_KEY = 'last-exit.route17.start-fresh.v1';
const RESTART_CHECKPOINT_KEY = 'last-exit.route17.restart-checkpoint.v1';
type AutoStartMode = 'new' | 'checkpoint';
const autoStartMode = (() => {
  try {
    const requested = sessionStorage.getItem(FRESH_SHIFT_KEY);
    sessionStorage.removeItem(FRESH_SHIFT_KEY);
    // "1" was written by the first menu implementation. Treat it as a checkpoint so an
    // already selected scene never replays the departure narration after this update.
    if (requested === 'new') return 'new' as const;
    return requested ? 'checkpoint' as const : null;
  } catch { return null; }
})();
let savedShift = Story.load();
// Builds before the compressed pacing stored route positions such as Mile 86. They cannot
// be mapped faithfully into the short playable route, so begin a clean shift instead.
if (savedShift && savedShift.mile > STORY_MILES.carson + 0.5) {
  Story.clearSave();
  savedShift = null;
}

// --- plumbing ----------------------------------------------------------------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04050a, 0.0085);
const lighting = new LightingRig(scene);
const camera = new THREE.PerspectiveCamera(58, renderer.aspect, 0.12, 2000);
// the driver sees the world and everything marked "cabin only"; the mirror sees neither
camera.layers.enable(LAYER_DIRECT_ONLY);

const seed = SEED_ROUTE;
const path = new RoutePath(seed);
// start far enough in that the ribbon behind the bus is already populated
const START_STATION = ROAD_BEHIND;
path.ensure(START_STATION, ROAD_BEHIND, ROAD_AHEAD);

const road = new Road(path, seed);
scene.add(road.mesh);

const props = new PropField(path, seed, START_STATION * STATION_SPACING);
scene.add(props.group);

const storyStops = new StoryStops(path, START_STATION * STATION_SPACING);
scene.add(storyStops.group);

const traffic = new Traffic(path, mulberry32(seed ^ 0x7a11));
scene.add(traffic.group);

const sky = new Sky(seed);
scene.add(sky.group);

const landscape = new DistantLandscape(seed);
scene.add(landscape.group);

const dust = new HeadlightDust(seed);
scene.add(dust.points);
const roadsideLights = new RoadsideLights(path);
scene.add(roadsideLights.group);

const bus = new Bus(path, seed, START_STATION);
bus.restoreDamage(savedShift?.busDamage ?? 0);

if (savedShift) {
  const resumeStation = START_STATION + Math.floor(savedShift.mile * METRES_PER_MILE / STATION_SPACING);
  path.ensure(resumeStation, ROAD_BEHIND, ROAD_AHEAD);
  bus.restoreMiles(savedShift.mile);
  road.rebuild();
  props.update(resumeStation, true);
}

const cabin = new Cabin();
cabin.setDamage(bus.damage);
let poleCrackCount = savedShift?.busPoleCracks ?? 0;
cabin.setPoleCracks(poleCrackCount);
scene.add(cabin.group);

const story = new Story(savedShift?.story);
const roster = new Roster(cabin.passengerRoot);
const passengerDirector = new PassengerDirector(roster, story);
passengerDirector.restore();
const boardingCutscene = new BoardingCutscene(cabin);

const origin = new FloatingOrigin(4000);
origin.add(path, bus, props, storyStops);

const input = new Input(window, import.meta.env.DEV, canvas);
const clock = new GameClock();
if (savedShift) clock.minutes = savedShift.minutes;
const hud = new Hud();
const debug = new DebugPanel();
const journal = new Journal();
const choices = new Choices();
let discardSaveOnUnload = false;
function restartShift(): void {
  loadCheckpoint(currentRestartCheckpoint(), 'checkpoint');
}
function startNewShift(): void {
  loadCheckpoint('depot', 'new');
}
function loadCheckpoint(id: MenuCheckpointId, startMode: AutoStartMode = 'checkpoint'): void {
  const save = makeCheckpointSave(id);
  discardSaveOnUnload = true;
  new Story(save.story).autosave(save.mile, save.minutes);
  rememberRestartCheckpoint(id);
  try { sessionStorage.setItem(FRESH_SHIFT_KEY, startMode); } catch { /* the saved checkpoint remains available from Continue */ }
  window.location.reload();
}
function rememberRestartCheckpoint(id: MenuCheckpointId): void {
  try { localStorage.setItem(RESTART_CHECKPOINT_KEY, id); } catch { /* storage is optional */ }
}
function currentRestartCheckpoint(): MenuCheckpointId {
  try {
    const saved = localStorage.getItem(RESTART_CHECKPOINT_KEY);
    if (MENU_CHECKPOINTS.some((checkpoint) => checkpoint.id === saved)) return saved as MenuCheckpointId;
  } catch { /* start from the depot when storage is unavailable */ }
  return 'depot';
}
const endingScreen = new EndingScreen(restartShift);

type ChoiceScene = StoryChoiceScene;
let activeChoice: ChoiceScene | null = null;
let heldByPatrol = false;
let heldAtStoryStop = false;
let paused = false;
let autosaveElapsed = 0;
let scriptedStop: StoryStopId | null = null;

function setPaused(value: boolean): void {
  paused = value;
  if (value) {
    if (document.pointerLockElement) document.exitPointerLock();
    pauseMenu.show();
  } else {
    pauseMenu.hide();
    hud.clear();
  }
}

function returnToMainMenu(): void {
  persistShift();
  void audio?.suspend();
  paused = false;
  journal.close();
  pauseMenu.hide();
  if (document.pointerLockElement) document.exitPointerLock();
  started = false;
  savedShift = Story.load();
  mainMenu.show(savedShift);
}

const pauseMenu = new PauseMenu(() => setPaused(false), restartShift, returnToMainMenu);

function persistShift(): void {
  story.autosave(bus.miles, clock.minutes, bus.damage, poleCrackCount);
}

function stopMile(stopId: StoryStopId): number {
  const stop = STORY_STOPS.find((candidate) => candidate.id === stopId);
  return stop?.mile ?? 0;
}

function parkAtStoryStop(stopId: StoryStopId): void {
  const mile = stopMile(stopId);
  const station = START_STATION + Math.floor(mile * METRES_PER_MILE / STATION_SPACING);
  path.ensure(station, ROAD_BEHIND, ROAD_AHEAD);
  bus.restoreMiles(mile);
  road.rebuild();
  props.update(station, true);
  storyStops.update(mile);
  heldByPatrol = stopId === 'highway-patrol';
  heldAtStoryStop = !heldByPatrol;
}

/**
 * A story beat should feel like the driver is pulling into a turnout, not like the world
 * skipped a few hundred metres. This briefly borrows lane-following and eases the coach
 * down to walking speed before the exact parking correction.
 */
function beginScriptedStop(stopId: StoryStopId): void {
  scriptedStop = stopId;
  rememberRestartCheckpoint(stopId);
  story.checkpoint({ kind: 'stop', stopId });
}

function updateScriptedStop(dt: number): void {
  if (!scriptedStop) return;
  const stopId = scriptedStop;
  const remaining = (stopMile(stopId) - bus.miles) * METRES_PER_MILE;
  if (remaining <= 1.5 || (remaining < 5 && bus.speed < 3.2)) {
    scriptedStop = null;
    parkAtStoryStop(stopId);
    engineAudio?.hiss(0.55, 0.14);
    if (stopId === 'mile86') openChoice('mile86', 'mile86');
    return;
  }

  // 1.25 m/s² leaves a comfortable margin for the coach's engine braking. The small
  // offset makes it settle at the turnout rather than hover at a crawl far before it.
  const targetSpeed = Math.min(23, Math.max(0, Math.sqrt(Math.max(0, 2.5 * (remaining - 7))) - 1.5));
  const wasAutopilot = bus.autopilot;
  const wasAutopilotSpeed = bus.autopilotSpeed;
  bus.autopilot = true;
  bus.autopilotSpeed = targetSpeed;
  bus.update(dt, input);
  bus.autopilot = wasAutopilot;
  bus.autopilotSpeed = wasAutopilotSpeed;
}

function choiceSceneForStop(stopId: StoryStopId): ChoiceScene | null {
  const scenes: Partial<Record<StoryStopId, ChoiceScene>> = {
    mile86: 'mile86',
    'closed-gas': 'stranded-man',
    'highway-patrol': 'patrol',
    'final-stop': 'finale',
  };
  return scenes[stopId] ?? null;
}

const interactions = new Interactions(storyStops, story, hud, (stop) => {
  heldAtStoryStop = false;
  const acts = {
    'mile86': 'mile86',
    'closed-gas': 'gas',
    'millers-gas': 'gas',
    'highway-patrol': 'patrol',
    'sunset-motel': 'motel',
    'final-stop': 'finale',
  } as const;
  story.setAct(acts[stop.id]);
  persistShift();
}, (stop) => {
  if (stop.id === 'millers-gas' && story.has('inspected:millers.receipt') && !story.has('miller.returned')) {
    const nora = roster.find('nora-vale');
    const noraWasMirror = nora?.where === 'mirror';
    if (!nora) passengerDirector.board('nora-vale');
    passengerDirector.setAppearance('nora-vale', { presence: 'both' });
    // Ray was sitting beside the player a moment ago; now he only exists in the glass.
    passengerDirector.mirrorOnly('ray-hollis', 1.4);
    story.evidence('miller.nora-boarded');
    story.flag('miller.returned');
    if (!nora || noraWasMirror) {
      beginPassengerBoarding(
        'nora-vale',
        'NORA VALE',
        settings.lang === 'ru' ? 'Она проходит в салон и занимает своё место.' : 'She walks into the saloon and takes her seat.',
      );
    } else {
      hud.say(null, settings.lang === 'ru' ? 'НОРА СМОТРИТ НА КАССУ.' : 'NORA IS WATCHING THE FARE BOX.', null, 4);
    }
  }
  if (stop.id === 'sunset-motel' && story.has('inspected:sunset.manifest') && !story.has('motel.roster-revealed')) {
    for (const profile of PASSENGERS) {
      if (profile.boarded === 1986) passengerDirector.board(profile.id);
    }
    story.flag('motel.roster-revealed');
    hud.say(null, settings.lang === 'ru' ? 'ВСЕ МЕСТА ЗАНЯТЫ.' : 'EVERY SEAT IS TAKEN.', settings.lang === 'ru' ? 'Ты не слышал, как они вошли.' : 'You did not hear them board.', 4);
  }
  const choiceScene = choiceSceneForStop(stop.id);
  if (choiceScene) openChoice(choiceScene, stop.id);
}, persistShift, persistShift, (open) => cabin.setDoorOpen(open), () => cabin.doorOpenAmount);

function openChoice(choiceScene: ChoiceScene, stopId: StoryStopId): void {
  if (choices.active || story.has(`choice:${choiceScene}`)) return;
  activeChoice = choiceScene;
  story.checkpoint({ kind: 'choice', stopId, scene: choiceScene });
  if (choiceScene === 'mile86') {
    story.evidence('mile86.timetable');
    choices.show(t('choice.mile86.title'), [
      { id: 'board', text: t('choice.mile86.board') },
      { id: 'pass', text: t('choice.mile86.pass') },
      { id: 'radio', text: t('choice.mile86.radio') },
    ]);
  } else if (choiceScene === 'stranded-man') {
    choices.show(t('choice.roadside.title'), [
      { id: 'board', text: t('choice.roadside.board') },
      { id: 'leave', text: t('choice.roadside.leave') },
      { id: 'radio', text: t('choice.roadside.radio') },
    ]);
  } else if (choiceScene === 'patrol') {
    choices.show(t('choice.patrol.title'), [
      { id: 'documents', text: t('choice.patrol.documents') },
      { id: 'question', text: t('choice.patrol.question') },
      { id: 'silent', text: t('choice.patrol.silent') },
    ]);
  } else {
    choices.show(t('choice.finale.title'), [
      ...PASSENGERS.map((profile) => ({ id: profile.id, text: profile.name })),
      { id: 'refuse', text: t('choice.finale.refuse') },
    ]);
  }
  persistShift();
}

function beginPassengerBoarding(id: string, label: string, completedLine: string): boolean {
  if (!passengerDirector.board(id)) return false;
  const figure = passengerDirector.figure(id);
  if (!figure) return false;
  heldAtStoryStop = true;
  engineAudio?.hiss(0.5, 0.14);
  hud.say(null, settings.lang === 'ru' ? 'ДВЕРИ ОТКРЫВАЮТСЯ — ПОСАДКА' : 'DOORS OPENING — BOARDING', null, 2);
  const startedBoarding = boardingCutscene.start(figure, () => {
    heldAtStoryStop = false;
    story.checkpoint({ kind: 'driving' });
    engineAudio?.hiss(0.42, 0.12);
    hud.say(null, label, completedLine, 4);
    persistShift();
  });
  if (!startedBoarding) heldAtStoryStop = false;
  return startedBoarding;
}

function showEnding(ending: StoryEnding): void {
  bus.speed = 0;
  paused = true;
  journal.close();
  hud.clear();
  endingScreen.show(ending);
}

function finishEnding(ending: StoryEnding, picked?: string): void {
  if (story.has('ending:arrival') || story.has('ending:route-continues') || story.has('ending:no-final-stop')) {
    showEnding(ending);
    return;
  }
  if (ending === 'route-continues' && picked) passengerDirector.mirrorOnly(picked, 1.6);
  if (ending === 'no-final-stop') {
    for (const profile of PASSENGERS) passengerDirector.mirrorOnly(profile.id, 1.15);
  }
  story.flag(`ending:${ending}`);
  story.setAct('finale');
  story.checkpoint({ kind: 'ending', ending });
  persistShift();
  showEnding(ending);
}

function applyChoice(scene: ChoiceScene, picked: string): void {
  let boardingStarted = false;
  story.choose(scene, picked);
  story.setAct(scene === 'mile86' ? 'mile86' : scene === 'stranded-man' ? 'gas' : scene === 'patrol' ? 'patrol' : 'finale');

  if (scene === 'mile86') {
    if (picked === 'board') {
      story.evidence('mile86.nora-boarded');
      boardingStarted = beginPassengerBoarding(
        'nora-vale',
        'NORA VALE',
        settings.lang === 'ru' ? 'Она занимает последнее место и не называет имени.' : 'She takes the last seat without giving her name.',
      );
    } else if (picked === 'radio') {
      dispatch('dispatch.mile86.radio');
      story.evidence('mile86.dispatch-denial');
      story.flag('nora.deferred');
    } else {
      hud.say(null, 'MILE 86', settings.lang === 'ru' ? 'Девушка остаётся в зеркале ещё долго после остановки.' : 'The girl stays in the mirror long after the stop has gone.', 4);
      passengerDirector.board('nora-vale');
      passengerDirector.mirrorOnly('nora-vale');
      story.evidence('mile86.nora-mirror');
    }
  } else if (scene === 'stranded-man') {
    if (picked === 'board') {
      story.evidence('closed-gas.frank-boarded');
      boardingStarted = beginPassengerBoarding(
        'frank-morrow',
        settings.lang === 'ru' ? 'МУЖЧИНА С ОБОЧИНЫ' : 'STRANDED MAN',
        settings.lang === 'ru' ? 'Он садится в конце салона и не смотрит в окно.' : 'He sits at the back and does not look out the window.',
      );
    } else if (picked === 'radio') {
      dispatch('dispatch.roadside');
      story.evidence('closed-gas.assistance');
    } else {
      story.evidence('closed-gas.left-behind');
      hud.say(null, 'SHOULDER', settings.lang === 'ru' ? 'Седан исчезает в тумане позади.' : 'The sedan disappears into the fog behind you.', 4);
    }
  } else if (scene === 'patrol') {
    story.evidence('patrol.bus17');
    const line = picked === 'documents'
      ? settings.lang === 'ru' ? 'Сэр… где вы взяли этот автобус?' : 'Sir… where did you get this bus?'
      : picked === 'question'
        ? settings.lang === 'ru' ? 'Офицер смотрит на номер семнадцать, затем отводит взгляд от окон.' : 'The officer looks at the number seventeen, then away from the windows.'
        : settings.lang === 'ru' ? 'Офицер ждёт. Он ни разу не смотрит в салон.' : 'The officer waits. He never looks into the saloon.';
    hud.say(settings.lang === 'ru' ? 'ДОРОЖНАЯ ПОЛИЦИЯ' : 'HIGHWAY PATROL', line, null, 5);
  } else {
    const ending = picked === 'nora-vale' ? 'arrival' : picked === 'refuse' ? 'no-final-stop' : 'route-continues';
    story.choose('final-passenger', picked);
    if (ending === 'no-final-stop') {
      finishEnding(ending, picked);
    } else {
      // The last decision is not a menu-shaped cut to credits. The player gets to feel
      // the final thirty miles and see the consequence in the cabin before Carson.
      story.flag(`pending:${ending}`);
      if (ending === 'arrival') passengerDirector.setAppearance('nora-vale', { presence: 'nowhere' });
      else passengerDirector.mirrorOnly(picked, 1.6);
      hud.say(null,
        ending === 'arrival'
          ? (settings.lang === 'ru' ? 'НОРА ВЫШЛА.' : 'NORA HAS LEFT THE BUS.')
          : (settings.lang === 'ru' ? 'ПАССАЖИР ОСТАЛСЯ В ЗЕРКАЛЕ.' : 'THE PASSENGER REMAINS IN THE MIRROR.'),
        settings.lang === 'ru' ? 'До Карсона ещё тридцать миль.' : 'Thirty miles remain to Carson.',
        5,
      );
    }
  }
  if (scene === 'patrol') heldByPatrol = false;
  if (!boardingStarted) heldAtStoryStop = false;
  if (!endingScreen.visible) story.checkpoint({ kind: 'driving' });
  persistShift();
}

function resolveChoice(): void {
  const picked = choices.resolve(input);
  if (!picked || !activeChoice) return;
  const scene = activeChoice;
  activeChoice = null;
  applyChoice(scene, picked);
}

// --- head --------------------------------------------------------------------
let lookX = 0;
let mouseYaw = 0;
let mousePitch = 0;
let glance = 0;          // 0 = eyes on the road, 1 = looking into the mirror
let leftMirrorGlance = 0;
let leftMirrorLatched = false;
const REST_FOV = 58;
const MIRROR_FOV = 38;

/**
 * Where the driver's head has to turn to put the mirror in the middle of the view.
 * Derived from the two local positions rather than typed in, so moving the mirror in the
 * cabin model cannot silently break the glance.
 */
const mirrorLook = (() => {
  const d = MIRROR_MOUNT.clone().sub(EYE_LOCAL).normalize();
  return {
    pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)),
    yaw: Math.atan2(-d.x, -d.z),
  };
})();

/** The side glass is outside the driver's peripheral view, so a generic 45° look is not enough. */
const leftMirrorLook = (() => {
  const d = LEFT_MIRROR_MOUNT.clone().sub(EYE_LOCAL).normalize();
  return {
    pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)),
    yaw: Math.atan2(-d.x, -d.z),
  };
})();

/**
 * Fixed vantage points inside the cabin, for checking that the thing being modelled is
 * actually the shape it is meant to be. Placing the wheel and the gauges by eye from the
 * driver's seat alone is how they ended up half inside the dash.
 */
const INSPECT_VIEWS: Array<{ from: THREE.Vector3; at: THREE.Vector3 }> = [
  { from: new THREE.Vector3(0.75, 2.25, -3.9), at: new THREE.Vector3(-0.72, 1.72, -5.62) },
  { from: new THREE.Vector3(-1.15, 1.95, -4.2), at: new THREE.Vector3(-0.72, 1.7, -5.7) },
  { from: new THREE.Vector3(-0.72, 2.55, -4.35), at: new THREE.Vector3(-0.72, 1.6, -5.7) },
];
let inspect = -1;

const eye = new THREE.Vector3();
const headL = new THREE.Vector3();
const headR = new THREE.Vector3();
const headDir = new THREE.Vector3();
const torchPosition = new THREE.Vector3();
const torchDirection = new THREE.Vector3(0, 0, -1);
const cabinLightPosition = new THREE.Vector3();
const collisionProbe = new THREE.Vector3();
const downwardLookOffset = new THREE.Vector3();
const driverReachHeadOffset = new THREE.Vector3();
const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const headQuat = new THREE.Quaternion();

function placeCamera(dt: number): void {
  if (interactions.exitCutsceneActive) {
    interactions.placeExitCamera(camera);
    return;
  }
  if (interactions.onFoot) {
    interactions.placeCamera(camera, input, dt);
    return;
  }
  if (boardingCutscene.active) {
    boardingCutscene.placeCamera(camera, dt);
    return;
  }
  if (inspect >= 0) {
    const view = INSPECT_VIEWS[inspect];
    camera.position.copy(view.from);
    cabin.group.localToWorld(camera.position);
    const target = view.at.clone();
    cabin.group.localToWorld(target);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    if (camera.fov !== 46) {
      camera.fov = 46;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    return;
  }

  const mouse = input.consumeMouse();
  mouseYaw = THREE.MathUtils.clamp(mouseYaw - mouse.x * 0.0022, -1.32, 1.32);
  mousePitch = THREE.MathUtils.clamp(mousePitch - mouse.y * 0.0019, -0.45, 0.48);

  const wanted = input.isDown('lookRight') ? 1 : 0;
  lookX += (wanted - lookX) * Math.min(1, dt * 7);

  // Q works both as a held glance and as a toggle. Previously a normal quick key press
  // could begin and end between rendered frames, leaving the mirror hidden throughout.
  if (input.wasTapped('lookLeft')) leftMirrorLatched = !leftMirrorLatched;
  const wantLeftMirror = input.isDown('lookLeft') || leftMirrorLatched ? 1 : 0;
  leftMirrorGlance += (wantLeftMirror - leftMirrorGlance) * Math.min(1, dt * 9);

  const wantGlance = input.isDown('lookMirror') ? 1 : 0;
  glance += (wantGlance - glance) * Math.min(1, dt * 9);

  camera.position.copy(cabin.eye(eye, bus.heave));

  // The camera is the driver's head. When the body reaches for the radio it follows the
  // shoulders slightly, so the player never watches a headless torso lean away below.
  const bodyLean = cabin.dashboard.firstPersonBodyLean;
  driverReachHeadOffset.set(bodyLean * 0.018, bodyLean * -0.025, bodyLean * -0.1);
  driverReachHeadOffset.applyQuaternion(cabin.group.quaternion);
  camera.position.add(driverReachHeadOffset);

  // a glance to the right is a negative yaw, because +Y rotation turns the view left
  const freeYaw = THREE.MathUtils.lerp(mouseYaw - lookX * 0.85, leftMirrorLook.yaw, leftMirrorGlance);
  const freePitch = THREE.MathUtils.lerp(mousePitch, leftMirrorLook.pitch, leftMirrorGlance);
  const yaw = THREE.MathUtils.lerp(freeYaw, mirrorLook.yaw, glance);
  const pitch = THREE.MathUtils.lerp(freePitch, mirrorLook.pitch, glance);
  // Looking into the footwell is not a pure neck rotation: the driver naturally lifts
  // and draws the head back. This keeps close cab panels out of the near field, where
  // their low-poly edges otherwise expand into giant black zigzags across the screen.
  const downwardLook = THREE.MathUtils.clamp(-pitch / 0.45, 0, 1);
  downwardLookOffset.set(0, downwardLook * 0.56, downwardLook * 0.72);
  downwardLookOffset.applyQuaternion(cabin.group.quaternion);
  camera.position.add(downwardLookOffset);
  headEuler.set(pitch, yaw, 0, 'YXZ');
  headQuat.setFromEuler(headEuler);
  camera.quaternion.copy(cabin.group.quaternion).multiply(headQuat);

  const fov = THREE.MathUtils.lerp(REST_FOV, MIRROR_FOV, Math.max(glance, leftMirrorGlance));
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  camera.updateMatrixWorld();
}

// --- boot --------------------------------------------------------------------
let started = false;
let shiftInitialized = false;
const menuMusic = new MenuMusic();

const mainMenu = new MainMenu({
  continueShift: () => { void startShift(); },
  newShift: startNewShift,
  selectCheckpoint: loadCheckpoint,
  setLanguage: (lang) => {
    settings.lang = lang;
    saveSettings();
    mainMenu.refresh();
    journal.refresh(story);
  },
  setGraphicsQuality: (quality) => {
    renderer.applyGraphicsQuality(quality);
    lighting.applyQuality();
    saveSettings();
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    mainMenu.refresh();
  },
  showMenuMusic: () => menuMusic.play(),
  hideMenuMusic: () => menuMusic.stop(),
  retryMenuMusic: () => menuMusic.retryAfterGesture(),
});
mainMenu.show(savedShift);

// --- sound -------------------------------------------------------------------
// Built on the first click, because no browser will start an AudioContext before one.
let audio: AudioSystem | null = null;
let engineAudio: EngineAudio | null = null;
let radio: Radio | null = null;

/** A line over the CB. Held on screen for exactly as long as the voice takes. */
function dispatch(key: string): void {
  const line = subtitle(key);
  let seconds = 5;
  if (audio && radio) seconds = radio.voice.speak(t(key), 'dispatch', audio.cb, 1.15) + 1.6;
  hud.say(t('who.dispatch'), line.primary, line.secondary, seconds);
}

function storyRadio(key: string): void {
  // Important information has a physical fallback elsewhere. These broadcasts are rewards
  // for tuning in, never subtitles from a radio the player has turned off.
  if (!radio?.isTuned('kzqa')) return;
  const line = subtitle(key);
  let seconds = 5;
  if (audio) seconds = radio.voice.speak(t(key), 'anchor', audio.radio, 0.9) + 1;
  hud.say(t('who.radio'), line.primary, line.secondary, seconds);
}

/** Re-entering a saved shift resumes the same audio graph instead of layering a second bus on top. */
async function ensureAudio(): Promise<void> {
  try {
    audio = await AudioSystem.start();
    if (!engineAudio) {
      engineAudio = new EngineAudio(audio);
    }
    if (!radio) {
      radio = new Radio(audio, (stationId, key, seconds) => {
        const station = radio?.stations.find((s) => s.id === stationId);
        const line = subtitle(key);
        hud.say(station?.callsign ?? t('who.radio'), line.primary, line.secondary, seconds);
      });
    }
    Object.assign(dev, { audio, radio, engineAudio });
  } catch {
    // audio is a luxury; the road is not
  }
}

async function startShift(playDepartureIntro = false): Promise<void> {
  if (started) return;
  started = true;
  mainMenu.hide();

  await ensureAudio();

  if (shiftInitialized) return;
  shiftInitialized = true;
  hydrateCheckpoint();
  if (endingScreen.visible) return;

  // A selected checkpoint is already mid-shift. Its authored state has its own scene or
  // choice, so never layer the Las Palmas dispatch and objective over it.
  if (!playDepartureIntro) return;
  dispatch('dispatch.checkin');
  const intro = subtitle('intro.objective');
  hud.queue(null, intro.primary, intro.secondary, 5);
}

if (autoStartMode) void startShift(autoStartMode === 'new');
canvas.addEventListener('click', () => {
  if (started && !audio) void ensureAudio();
});

// --- keys --------------------------------------------------------------------
input.on('toggleDebug', () => debug.toggle());
input.on('toggleLang', () => {
  settings.lang = settings.lang === 'en' ? 'ru' : 'en';
  saveSettings();
  mainMenu.refresh();
  journal.refresh(story);
});
input.on('toggleJournal', () => {
  if (!endingScreen.visible) journal.toggle(story);
});
input.on('highBeam', () => {
  if (!interactions.onFoot && !interactions.transitioning && !boardingCutscene.active) bus.highBeam = !bus.highBeam;
});
input.on('autopilot', () => {
  if (!interactions.onFoot && !interactions.transitioning && !boardingCutscene.active) bus.autopilot = !bus.autopilot;
});
input.on('inspect', () => {
  inspect = inspect + 1 >= INSPECT_VIEWS.length ? -1 : inspect + 1;
  if (inspect < 0) {
    camera.fov = REST_FOV;
    camera.updateProjectionMatrix();
  }
});
input.on('radioPower', () => {
  if (!interactions.onFoot && !interactions.transitioning && !boardingCutscene.active) cabin.dashboard.requestRadioPower();
});
input.on('radioSeek', () => {
  if (!interactions.onFoot && !interactions.transitioning && !boardingCutscene.active) cabin.dashboard.requestRadioSeek(1);
});
input.on('horn', () => {
  if (interactions.transitioning) return;
  if (!interactions.onFoot && !interactions.transitioning && !boardingCutscene.active) {
    engineAudio?.hiss(0.45, 0.18);
    return;
  }
  const on = interactions.toggleFlashlight();
  hud.say(null, on ? t('flashlight.on') : t('flashlight.off'), null, 1.2);
});

/** Testing travel keeps long-route content practical to tune without simulating eighty real miles. */
function jumpToStoryMile(mile: number): void {
  const station = START_STATION + Math.floor(mile * METRES_PER_MILE / STATION_SPACING);
  path.ensure(station, ROAD_BEHIND, ROAD_AHEAD);
  bus.restoreMiles(mile);
  road.rebuild();
  props.update(station, true);
  storyStops.update(mile);
  hud.say(null, 'ROUTE 17', `Mile ${Math.round(mile)} — testing jump`, 2);
}
input.on('jumpMile86', () => jumpToStoryMile(STORY_MILES.mile86 - 0.5));
input.on('jumpRoadside', () => jumpToStoryMile(STORY_MILES.closedGas - 0.5));
input.on('jumpMillers', () => jumpToStoryMile(STORY_MILES.millersGas - 0.5));
input.on('jumpMotel', () => jumpToStoryMile(STORY_MILES.sunsetMotel - 0.5));
input.on('jumpFinale', () => jumpToStoryMile(STORY_MILES.finalStop - 0.5));
input.on('resetShift', () => {
  restartShift();
});

/**
 * The demonstration this milestone exists for. G steps through what the layer split makes
 * possible without a line of special-case code:
 *   0  three fares, in the cabin and in the glass, as they should be
 *   1  the cabin is empty — and the glass is not
 *   2  the glass is full, and nothing in it is breathing
 */
let ghostStage = 0;
input.on('ghost', () => {
  ghostStage = (ghostStage + 1) % 3;
  for (const p of roster.passengers) {
    p.setPresence(ghostStage === 0 ? 'both' : 'mirror');
    p.sway = ghostStage === 2 ? 0 : 1;
    p.eyeshine = ghostStage === 2 ? 1.8 : 0;
  }
});

// --- tape damage -------------------------------------------------------------
// One dial the story can turn when the world is not behaving. Decays on its own.
let glitch = 0;
function pulseGlitch(amount: number): void {
  glitch = Math.max(glitch, amount);
}

// --- triggers ----------------------------------------------------------------
/**
 * Route acts are data-driven: each fires once and leaves a persistent choice/evidence state.
 */
const events = new EventScheduler({
  dispatch,
  pulseGlitch,
  openChoice,
  storyRadio,
  say: (key: string) => {
    const line = subtitle(key);
    hud.say(null, line.primary, line.secondary, 5);
  },
  queue: (key: string) => {
    const line = subtitle(key);
    hud.queue(null, line.primary, line.secondary, 5);
  },
  stopAt: (mile: number) => {
    const stop = STORY_STOPS.find((candidate) => Math.abs(candidate.mile - mile) < 0.001);
    if (!stop) return;
    beginScriptedStop(stop.id);
  },
  stopForPatrol: () => {
    beginScriptedStop('highway-patrol');
  },
}, (id) => {
  story.markEvent(id);
  persistShift();
});
events.add(
  {
    id: 'intro.mirror',
    when: (s) => s.mile > 0.25,
    run: (c) => c.say('intro.mirror'),
  },
  {
    id: 'mile86.warning',
    when: (s) => s.mile > STORY_MILES.mile86 - 0.94 && !s.flags.has('choice:mile86'),
    run: (c) => {
      c.dispatch('dispatch.mile86');
      const line = subtitle('scene.mile86.approach');
      hud.queue(null, line.primary, line.secondary, 4);
    },
  },
  {
    id: 'mile86.arrive',
    when: (s) => s.mile > STORY_MILES.mile86 - 0.18 && !s.flags.has('choice:mile86'),
    run: (c) => c.stopAt(STORY_MILES.mile86),
  },
  {
    id: 'roadside.warning',
    when: (s) => s.mile > STORY_MILES.closedGas - 0.94 && !s.flags.has('choice:stranded-man'),
    run: (c) => {
      c.dispatch('dispatch.roadside');
      c.queue('scene.roadside.approach');
    },
  },
  {
    id: 'roadside.arrive',
    when: (s) => s.mile > STORY_MILES.closedGas - 0.18 && !s.flags.has('choice:stranded-man'),
    run: (c) => c.stopAt(STORY_MILES.closedGas),
  },
  {
    id: 'roadside.man.disappears',
    when: (s) => s.flags.has('choice:stranded-man') && s.mile > STORY_MILES.closedGas + 0.75 && !s.flags.has('man.disappeared'),
    run: () => {
      if (story.state.choices['stranded-man'] !== 'board') return;
      passengerDirector.mirrorOnly('frank-morrow', 1.5);
      story.flag('man.disappeared');
      story.evidence('man.mirror');
      pulseGlitch(0.55);
    },
  },
  {
    id: 'millers.approach',
    when: (s) => s.mile > STORY_MILES.millersGas - 0.92 && !s.flags.has('miller.returned'),
    run: (c) => c.say('scene.millers.approach'),
  },
  {
    id: 'millers.arrive',
    when: (s) => s.mile > STORY_MILES.millersGas - 0.18 && !s.flags.has('miller.returned'),
    run: (c) => c.stopAt(STORY_MILES.millersGas),
  },
  {
    id: 'patrol.stop',
    when: (s) => s.mile > STORY_MILES.highwayPatrol - 0.1 && !s.flags.has('choice:patrol'),
    run: (c) => { c.stopForPatrol(); c.dispatch('dispatch.patrol'); },
  },
  {
    id: 'motel.approach',
    when: (s) => s.mile > STORY_MILES.sunsetMotel - 0.92 && !s.flags.has('motel.roster-revealed'),
    run: (c) => c.say('scene.motel.approach'),
  },
  {
    id: 'motel.arrive',
    when: (s) => s.mile > STORY_MILES.sunsetMotel - 0.18 && !s.flags.has('motel.roster-revealed'),
    run: (c) => c.stopAt(STORY_MILES.sunsetMotel),
  },
  {
    id: 'radio.missing-bus',
    when: (s) => s.mile > STORY_MILES.highwayPatrol + 0.45 && Boolean(radio?.isTuned('kzqa')),
    run: (c) => c.storyRadio('radio.story.missing'),
  },
  {
    id: 'radio.final-warning',
    when: (s) => s.mile > STORY_MILES.finalStop - 1 && Boolean(radio?.isTuned('kzqa')),
    run: (c) => c.storyRadio('radio.story.count'),
  },
  {
    id: 'final.roster',
    when: (s) => s.mile > STORY_MILES.finalStop - 0.6 && !s.flags.has('final.roster-ready'),
    run: () => {
      for (const profile of PASSENGERS) {
        passengerDirector.board(profile.id);
        passengerDirector.setAppearance(profile.id, { presence: 'both' });
      }
      story.flag('final.roster-ready');
      hud.say(null, settings.lang === 'ru' ? 'САЛОН ПОЛОН.' : 'THE SALOON IS FULL.', settings.lang === 'ru' ? 'Ты не видел, как занялись пустые места.' : 'You did not see the empty seats fill.', 4);
    },
  },
  {
    id: 'final.approach',
    when: (s) => s.mile > STORY_MILES.finalStop - 0.25 && !s.flags.has('choice:final-passenger'),
    run: (c) => c.say('scene.finale.approach'),
  },
  {
    id: 'finale.arrive',
    when: (s) => s.mile > STORY_MILES.finalStop - 0.18 && !s.flags.has('choice:final-passenger'),
    run: (c) => c.stopAt(STORY_MILES.finalStop),
  },
  {
    id: 'finale.arrival',
    when: (s) => s.mile >= STORY_MILES.carson && (s.flags.has('pending:arrival') || s.flags.has('pending:route-continues')),
    run: () => finishEnding(story.has('pending:arrival') ? 'arrival' : 'route-continues', story.state.choices['final-passenger']),
  },
);
events.restore(story.state.firedEvents);

function hydrateCheckpoint(): void {
  const checkpoint = story.state.checkpoint;
  if (checkpoint.kind === 'driving') return;
  if (checkpoint.kind === 'ending') {
    showEnding(checkpoint.ending);
    return;
  }
  parkAtStoryStop(checkpoint.stopId);
  if (checkpoint.kind === 'choice') openChoice(checkpoint.scene, checkpoint.stopId);
  else if (checkpoint.stopId === 'mile86' && !story.has('choice:mile86')) openChoice('mile86', 'mile86');
}

function recoverInterruptedScene(): void {
  if (!story.recoverInterruptedScene()) return;
  const checkpoint = story.state.checkpoint;
  if (checkpoint.kind === 'stop' || checkpoint.kind === 'choice') {
    parkAtStoryStop(checkpoint.stopId);
    if (checkpoint.kind === 'choice') openChoice(checkpoint.scene, checkpoint.stopId);
    else if (checkpoint.stopId === 'mile86' && !story.has('choice:mile86')) openChoice('mile86', 'mile86');
  }
  persistShift();
}

const routeState: RouteState = { mile: 0, minutes: 0, speedMph: 0, flags: new Set<string>() };
input.on('pause', () => {
  if (!started) return;
  if (endingScreen.visible || choices.active) return;
  if (journal.visible) {
    journal.close();
    return;
  }
  setPaused(!paused);
});

// --- frame -------------------------------------------------------------------
const loop = new Loop((dt, elapsed) => {
  if (started && !paused) {
    recoverInterruptedScene();
    // A player cannot be asked to make a careful narrative decision while the coach
    // quietly rolls past it. Journal and choice screens hold this single-player moment.
    const narrativeLocked = choices.active || journal.visible || boardingCutscene.active;
    if (scriptedStop) updateScriptedStop(dt);
    else if (!interactions.onFoot && !interactions.transitioning && !heldByPatrol && !heldAtStoryStop && !narrativeLocked) bus.update(dt, input);
    clock.syncRoute(bus.miles);

    routeState.mile = bus.miles;
    routeState.minutes = clock.minutes;
    routeState.speedMph = bus.speedMph;
    routeState.flags.clear();
    story.state.flags.forEach((flag) => routeState.flags.add(flag));
    if (!journal.visible) events.update(routeState);
    if (!journal.visible) resolveChoice();

    if (story.state.checkpoint.kind === 'driving') {
      autosaveElapsed += dt;
      if (autosaveElapsed >= 20) {
        autosaveElapsed = 0;
        persistShift();
      }
    }
  }

  // keep the ribbon centred on the bus, and pull the world back when it drifts
  const station = Math.round(bus.distance / STATION_SPACING);
  if (path.ensure(station, ROAD_BEHIND, ROAD_AHEAD)) road.rebuild();
  if (origin.update(bus.position)) road.rebuild();
  props.update(station);
  props.animate(dt);
  roadsideLights.update(bus.distance, dt);
  storyStops.update(bus.miles, dt);
  storyStops.setMile86PassengerVisible(story.state.choices.mile86 !== 'board');
  boardingCutscene.update(dt);

  // The coach body is approximated by a circle around its centre for roadside props.
  // This is intentionally forgiving at the corners, where a first-person driver cannot
  // judge centimetres, while still making posts, signs and vegetation physically real.
  // Probe the front axle first (where an impact is perceived), then the body centre for
  // broadside scrapes. This approximates the long coach as a two-circle capsule.
  bus.localToWorld(0, 0.65, 5.25, collisionProbe);
  // Holding S at walking speed is an intentional "get me out" action: a cactus or post
  // cannot repeatedly bounce the coach and prevent a reverse manoeuvre.
  const reversingOut = input.isDown('brake') && bus.speed <= 0.3;
  const collisionDisabled = interactions.onFoot || reversingOut;
  const frontPropHit = collisionDisabled ? null : props.collisionAt(collisionProbe, 1.34);
  const frontLampHit = collisionDisabled ? null : roadsideLights.collisionAt(collisionProbe, 1.34);
  const bodyPropHit = collisionDisabled || frontPropHit ? null : props.collisionAt(bus.position, 1.38);
  const bodyLampHit = collisionDisabled || frontLampHit ? null : roadsideLights.collisionAt(bus.position, 1.38);
  // Lamp poles and procedural props occupy disjoint roadside bands. Prefer the lamp if
  // both broad-phase circles overlap due to an extreme off-road angle.
  const lampHit = frontLampHit ?? bodyLampHit;
  const propHit = lampHit ? null : frontPropHit ?? bodyPropHit;
  const obstacleNormal = lampHit?.normal ?? propHit?.normal;
  const obstaclePenetration = lampHit?.penetration ?? propHit?.penetration ?? 0;
  const hitAtWindscreen = Boolean(
    (lampHit ? lampHit === frontLampHit : propHit === frontPropHit)
    && obstacleNormal
    && -obstacleNormal.dot(bus.forwardVector) > 0.42,
  );
  const hitPole = Boolean(lampHit || propHit?.kind === 'pole');
  const speedBeforeObstacle = Math.abs(bus.speed);
  const yielded = lampHit
    ? roadsideLights.knockDown(lampHit, bus.forwardVector)
    : propHit ? props.knockDown(propHit, bus.forwardVector) : false;

  if (hitPole && obstacleNormal) {
    const impacted = bus.impact(obstacleNormal, obstaclePenetration);
    if (impacted || yielded) {
      const severity = THREE.MathUtils.clamp(speedBeforeObstacle / 18, 0.2, 1);
      pulseGlitch(0.4 + severity * 0.2);
      engineAudio?.collision(severity);
      hud.say(null, settings.lang === 'ru' ? 'УДАР О СТОЛБ' : 'POLE IMPACT', null, 1.25);
    }
    // Only a genuine forward hit at useful speed touches the windscreen crack layer.
    // Side and rear contacts can topple the pole but never create glass damage.
    if (impacted && hitAtWindscreen && speedBeforeObstacle > 3) {
      poleCrackCount = Math.min(8, poleCrackCount + 1);
      cabin.setPoleCracks(poleCrackCount);
      persistShift();
    }
  } else if (yielded) {
    pulseGlitch(0.34);
    engineAudio?.hiss(0.32, 0.12);
  } else if (propHit && bus.impact(propHit.normal, propHit.penetration)) {
    pulseGlitch(0.34);
    engineAudio?.hiss(0.7, 0.28);
    hud.say(null, settings.lang === 'ru' ? 'СТОЛКНОВЕНИЕ' : 'IMPACT', null, 1.15);
  }
  const trafficFrame = traffic.update(
    dt,
    bus,
    !interactions.onFoot && !interactions.transitioning && !boardingCutscene.active && !scriptedStop && !heldAtStoryStop && !heldByPatrol,
  );
  if (trafficFrame.horn) engineAudio?.trafficHorn(trafficFrame.horn === 'truck');
  if (trafficFrame.impact) {
    const hit = trafficFrame.impact;
    if (bus.vehicleImpact(hit.normal, hit.penetration, hit.otherMass, hit.otherAlongSpeed, hit.severity)) {
      cabin.setDamage(bus.damage);
      pulseGlitch(0.42 + hit.severity * 0.38);
      engineAudio?.collision(hit.severity);
      hud.say(
        null,
        settings.lang === 'ru' ? 'АВАРИЯ — АВТОБУС ПОВРЕЖДЁН' : 'CRASH — COACH DAMAGED',
        null,
        1.7,
      );
      persistShift();
    }
  }

  cabin.sync(bus.position, bus.heading, bus.pitch, bus.roll);
  cabin.setExteriorMotion(bus.distance, bus.wheelAngle, bus.braking, bus.highBeam);
  cabin.setDamage(bus.damage);
  // The physical side mirror should never drift into the forward view as a black block.
  // Keep the housing alive for the whole eased camera move, not merely while the physical
  // key is down. This also prevents a black/pop frame when Q is released.
  cabin.leftMirror.mesh.visible = leftMirrorGlance > 0.01 || input.isDown('lookLeft') || leftMirrorLatched;
  if (choices.active || endingScreen.visible || boardingCutscene.active) {
    interactions.updateTransition(dt);
    hud.prompt(boardingCutscene.active
      ? (settings.lang === 'ru' ? 'ИДЁТ ПОСАДКА ПАССАЖИРА…' : 'PASSENGER BOARDING…')
      : null);
  }
  else interactions.update(dt, bus, input);
  // The arms, torso and legs are the player character, not a second seated NPC.
  // Hide them for every on-foot mission and restore them on re-entry to the coach.
  const driverSeated = !interactions.onFoot;
  const driverAtControls = driverSeated && !interactions.transitioning && !boardingCutscene.active;
  // A first-person cutscene turns the camera farther than a real neck would. Hide only
  // the player's body during that turn so shoulders and arms cannot cross the near plane;
  // the separately built driver seat and its leather headrest remain in the cabin.
  cabin.dashboard.setDriverVisible(driverSeated && !boardingCutscene.active && !interactions.exitCutsceneActive);
  cabin.dashboard.setDriverControlsEnabled(driverAtControls);
  cabin.setExteriorVisibleToDriver(interactions.onFoot || interactions.exitCameraOutside);
  cabin.updateExterior(dt);
  placeCamera(dt);
  // The desert is still a moonlit outdoor space, not a black void. The torch is for
  // reading the detail of an object, while this lift keeps the stop navigable when off.
  shared.uAmbient.value.setHex(interactions.onFoot ? 0x17223b : 0x0d1322);
  sky.update(camera, elapsed);
  sky.setDawn(Math.pow(clock.nightProgress, 2.5));
  landscape.update(camera);
  dust.update(bus, elapsed);

  // the saloon is lit by four tired domes, plus whatever passes the other way
  const glare = traffic.glareAt(bus.distance);
  setCabinGlow(2.05 + glare * 1.65, 0.72 + glare * 0.12);
  cabin.setCabinLights(0.64);
  // the glass picks up dust and breath as the night goes on, so it never reads as a feed
  cabin.mirror.setCondition(0.1 + clock.nightProgress * 0.12);
  cabin.mirror.setBrightness(2.1);
  // The driver's exterior glass sees the unlit road behind the coach, so it needs a
  // deliberate low-light lift rather than pretending rear headlights exist.
  cabin.leftMirror.setBrightness(3.6);

  engineAudio?.update(dt, bus);

  roster.update(elapsed, -bus.yawRate * bus.speed * 0.02);
  const dashboardActions = cabin.dashboard.update({
    dt,
    speedMph: bus.speedMph,
    signedSpeed: bus.speed,
    rpm: bus.rpm,
    wheelAngle: bus.wheelAngle,
    gear: bus.gear,
    forwardPressed: driverAtControls && input.isDown('throttle'),
    reversePressed: driverAtControls && input.isDown('brake'),
    miles: bus.miles,
    clock: clock.format(),
    highBeam: bus.highBeam,
    radioTuneDirection: driverAtControls ? input.axis('radioDown', 'radioUp') : 0,
  });
  if (radio) {
    if (driverAtControls && dashboardActions.radioPowerPress) radio.togglePower();
    if (driverAtControls && dashboardActions.radioSeekDirection !== 0) {
      radio.seek(dashboardActions.radioSeekDirection);
    }
    if (driverAtControls) radio.tune(dashboardActions.radioTuneDirection, dt);
    radio.update(dt);
    cabin.dashboard.setRadio(radio.needle, radio.readout, radio.power);
  }

  // Headlights sit on the body, aimed slightly down, and never follow the steering.
  bus.localToWorld(-1.02, 0.95, 6.1, headL);
  bus.localToWorld(1.02, 0.95, 6.1, headR);
  headDir.copy(bus.forwardVector).setY(bus.highBeam ? -0.035 : -0.075).normalize();
  shared.uHeadRange.value = bus.highBeam ? 165 : 105;
  shared.uHeadCone.value.set(bus.highBeam ? 0.992 : 0.985, bus.highBeam ? 0.9 : 0.8);
  shared.uHeadIntensity.value = bus.highBeam ? 3.2 : 2.75;
  bus.localToWorld(-0.55, 2.35, 4.75, cabinLightPosition);
  lighting.update(
    bus.position,
    cabinLightPosition,
    headL,
    headR,
    bus.forwardVector,
    sky.moonDirection,
    bus.highBeam,
  );
  renderer.requestShadowUpdate();

  const torchOn = interactions.onFoot && interactions.flashlightOn;
  if (torchOn) {
    camera.getWorldDirection(torchDirection);
    torchDirection.y -= 0.08;
    torchDirection.normalize();
    torchPosition.copy(camera.position).addScaledVector(torchDirection, 0.16);
  }
  shared.uTorchIntensity.value = torchOn ? 2.4 : 0;

  // the mirror renders first and leaves the shader uniforms pointing at its own camera,
  // so the world rig has to be restored before the main pass
  cabin.aimMirror();
  cabin.aimLeftMirror();
  cabin.mirror.render(
    renderer.gl,
    scene,
    { left: headL, right: headR, direction: headDir },
    sky.moonDirection,
  );
  cabin.leftMirror.render(
    renderer.gl,
    scene,
    { left: headL, right: headR, direction: headDir },
    sky.moonDirection,
  );
  updateHeadlights(camera, headL, headR, headDir);
  updateTorch(camera, torchPosition, torchDirection);
  updateMoon(camera, sky.moonDirection);

  if (started && renderer.post.fade > 0 && !paused) {
    renderer.post.fade = Math.max(0, renderer.post.fade - dt * 0.7);
  }
  if (paused) renderer.post.fade = Math.min(0.62, renderer.post.fade + dt * 2.4);

  // a mirror holding people the cabin has lost puts the tape under strain
  const wrongness = ghostStage > 0 ? 0.18 + glance * 0.3 : 0;
  glitch = Math.max(glitch * Math.pow(0.35, dt), wrongness);
  renderer.post.glitch = glitch;

  hud.update(dt, { station: radio?.power ? radio.readout : null });
  debug.update(dt, renderer.gl, scene, renderer.stats, {
    fps: Math.round(loop.fps),
    mile: bus.miles,
    mph: bus.speedMph,
    lat: bus.lateral,
    surf: bus.surface,
    gear: bus.gear,
    rpm: Math.round(bus.rpm),
    time: clock.format(),
    rebase: origin.rebases,
    ghost: ghostStage,
    seed: seed.toString(16),
    quality: settings.graphicsQuality,
    res: renderer.resolution,
  });

  renderer.present(scene, camera, elapsed);
  input.endFrame();
});

window.addEventListener('resize', () => {
  camera.aspect = renderer.aspect;
  camera.updateProjectionMatrix();
});
window.addEventListener('pagehide', () => {
  if (started && !discardSaveOnUnload) persistShift();
});
camera.aspect = renderer.aspect;
camera.updateProjectionMatrix();

loop.start();

// a handle for poking at the sim from the console while tuning
Object.assign(dev, { bus, path, clock, renderer, scene, cabin, roster, passengerDirector, traffic, loop, input, story, storyStops, interactions, journal });
Object.assign(window as unknown as Record<string, unknown>, { LAST_EXIT: dev });
