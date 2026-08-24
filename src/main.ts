import * as THREE from 'three';

import { Renderer } from './render/renderer';
import { shared, updateHeadlights, updateMoon } from './render/retroMaterial';
import { Loop } from './core/loop';
import { Input } from './core/input';
import { GameClock } from './core/clock';
import { EventScheduler } from './core/events';
import type { RouteState } from './core/events';
import { SEED_ROUTE, mulberry32 } from './core/rng';
import { settings, saveSettings } from './core/settings';
import { RoutePath, STATION_SPACING } from './world/curvature';
import { Road, ROAD_AHEAD, ROAD_BEHIND } from './world/road';
import { PropField } from './world/props';
import { Traffic } from './world/traffic';
import { Sky } from './world/sky';
import { FloatingOrigin } from './world/origin';
import { Bus } from './bus/drive';
import { Cabin, EYE_LOCAL, MIRROR_MOUNT } from './bus/interior';
import { Roster } from './bus/passengers';
import { LAYER_DIRECT_ONLY, setCabinGlow } from './bus/mirror';
import { AudioSystem } from './audio/context';
import { EngineAudio } from './audio/engine';
import { Radio } from './audio/radio';
import { Hud } from './ui/hud';
import { DebugPanel } from './ui/debug';
import { t, subtitle } from './content/i18n';

/** Everything reachable from the console while tuning. Filled in as systems come up. */
const dev: Record<string, unknown> = {};

// --- plumbing ----------------------------------------------------------------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

const scene = new THREE.Scene();
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

const traffic = new Traffic(path, mulberry32(seed ^ 0x7a11));
scene.add(traffic.group);

const sky = new Sky(seed);
scene.add(sky.group);

const bus = new Bus(path, seed, START_STATION);

const cabin = new Cabin();
scene.add(cabin.group);

const roster = new Roster(cabin.passengerRoot);
// Three fares out of Las Palmas. The other nine are the game's problem, not the prototype's.
roster.board({ id: 'coat', row: 1, side: -1 });
roster.board({ id: 'sleeper', row: 3, side: 1 });
roster.board({ id: 'hat', row: 6, side: -1 });

const origin = new FloatingOrigin(4000);
origin.add(path, bus, props);

const input = new Input();
const clock = new GameClock();
const hud = new Hud();
const debug = new DebugPanel();

// --- head --------------------------------------------------------------------
let lookX = 0;
let glance = 0;          // 0 = eyes on the road, 1 = looking into the mirror
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
const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const headQuat = new THREE.Quaternion();

function placeCamera(dt: number): void {
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

  const wanted = input.axis('lookLeft', 'lookRight');
  lookX += (wanted - lookX) * Math.min(1, dt * 7);

  const wantGlance = input.isDown('lookMirror') ? 1 : 0;
  glance += (wantGlance - glance) * Math.min(1, dt * 9);

  camera.position.copy(cabin.eye(eye, bus.heave));

  // a glance to the right is a negative yaw, because +Y rotation turns the view left
  const yaw = THREE.MathUtils.lerp(-lookX * 0.85, mirrorLook.yaw, glance);
  const pitch = THREE.MathUtils.lerp(0, mirrorLook.pitch, glance);
  headEuler.set(pitch, yaw, 0, 'YXZ');
  headQuat.setFromEuler(headEuler);
  camera.quaternion.copy(cabin.group.quaternion).multiply(headQuat);

  const fov = THREE.MathUtils.lerp(REST_FOV, MIRROR_FOV, glance);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  camera.updateMatrixWorld();
}

// --- boot --------------------------------------------------------------------
const boot = document.getElementById('boot')!;
const bootNote = boot.querySelector('[data-i18n="boot.note"]') as HTMLElement;
let started = false;

function refreshBootText(): void {
  bootNote.textContent = t('boot.note');
  boot.querySelectorAll<HTMLElement>('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === settings.lang);
  });
}
refreshBootText();

boot.querySelectorAll<HTMLElement>('.lang-btn').forEach((b) => {
  b.addEventListener('click', () => {
    settings.lang = b.dataset.lang === 'ru' ? 'ru' : 'en';
    saveSettings();
    refreshBootText();
  });
});

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

async function startShift(): Promise<void> {
  if (started) return;
  started = true;
  boot.classList.add('gone');

  try {
    audio = await AudioSystem.start();
    engineAudio = new EngineAudio(audio);
    radio = new Radio(audio, (stationId, key, seconds) => {
      const station = radio?.stations.find((s) => s.id === stationId);
      const line = subtitle(key);
      hud.say(station?.callsign ?? t('who.radio'), line.primary, line.secondary, seconds);
    });
    Object.assign(dev, { audio, radio, engineAudio });
  } catch {
    // audio is a luxury; the road is not
  }

  dispatch('dispatch.checkin');
}

document.getElementById('boot-start')!.addEventListener('click', () => { void startShift(); });

// --- keys --------------------------------------------------------------------
input.on('toggleDebug', () => debug.toggle());
input.on('toggleLang', () => {
  settings.lang = settings.lang === 'en' ? 'ru' : 'en';
  saveSettings();
  refreshBootText();
});
input.on('highBeam', () => { bus.highBeam = !bus.highBeam; });
input.on('autopilot', () => { bus.autopilot = !bus.autopilot; });
input.on('inspect', () => {
  inspect = inspect + 1 >= INSPECT_VIEWS.length ? -1 : inspect + 1;
  if (inspect < 0) {
    camera.fov = REST_FOV;
    camera.updateProjectionMatrix();
  }
});
input.on('radioPower', () => { radio?.togglePower(); });
input.on('radioSeek', () => { radio?.seek(); });
input.on('horn', () => { engineAudio?.hiss(0.45, 0.18); });

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
 * Two smoke-test triggers, to prove the scheduler fires off mile and time the way the
 * script will need it to. The acts themselves are not this milestone's business.
 */
const events = new EventScheduler({ dispatch, pulseGlitch });
events.add(
  {
    id: 'smoke.mile86',
    when: (s) => s.mile > 0.8,
    run: (c) => c.dispatch('dispatch.mile86'),
  },
  {
    id: 'smoke.repeat',
    when: (s) => s.mile > 2.2 && s.speedMph > 30,
    run: (c) => {
      c.dispatch('dispatch.repeat');
      c.pulseGlitch(0.5);
    },
  },
);

const routeState: RouteState = { mile: 0, minutes: 0, speedMph: 0, flags: new Set<string>() };
let paused = false;
input.on('pause', () => {
  paused = !paused;
  if (paused) hud.say(null, settings.lang === 'ru' ? 'ПАУЗА' : 'PAUSED', null, 9999);
  else hud.clear();
});

// --- frame -------------------------------------------------------------------
const loop = new Loop((dt, elapsed) => {
  if (started && !paused) {
    bus.update(dt, input);
    clock.advance(dt);

    routeState.mile = bus.miles;
    routeState.minutes = clock.minutes;
    routeState.speedMph = bus.speedMph;
    events.update(routeState);
  }

  // keep the ribbon centred on the bus, and pull the world back when it drifts
  const station = Math.round(bus.distance / STATION_SPACING);
  if (path.ensure(station, ROAD_BEHIND, ROAD_AHEAD)) road.rebuild();
  if (origin.update(bus.position)) road.rebuild();
  props.update(station);
  traffic.update(dt, bus.distance);

  cabin.sync(bus.position, bus.heading, bus.pitch, bus.roll);
  placeCamera(dt);
  sky.update(camera, elapsed);
  sky.setDawn(Math.pow(clock.nightProgress, 2.5));

  // the saloon is lit by four tired domes, plus whatever passes the other way
  const glare = traffic.glareAt(bus.distance);
  setCabinGlow(1.9 + glare * 2.4, 1 + glare * 0.35);
  cabin.setCabinLights(0.9);
  // the glass picks up dust and breath as the night goes on, so it never reads as a feed
  cabin.mirror.setCondition(0.18 + clock.nightProgress * 0.22);

  if (radio) {
    radio.tune(input.axis('radioDown', 'radioUp'), dt);
    radio.update(dt);
    cabin.dashboard.setRadio(radio.needle, radio.readout, radio.power);
  }
  engineAudio?.update(dt, bus);

  roster.update(elapsed, -bus.yawRate * bus.speed * 0.02);
  cabin.dashboard.update({
    speedMph: bus.speedMph,
    rpm: bus.rpm,
    wheelAngle: bus.wheelAngle,
    miles: bus.miles,
    clock: clock.format(),
    highBeam: bus.highBeam,
  });

  // headlights sit on the body, aimed slightly down, and never follow the steering
  bus.localToWorld(-1.02, 0.95, 6.1, headL);
  bus.localToWorld(1.02, 0.95, 6.1, headR);
  headDir.copy(bus.forwardVector).setY(bus.highBeam ? -0.035 : -0.075).normalize();

  shared.uHeadRange.value = bus.highBeam ? 165 : 105;
  shared.uHeadCone.value.set(bus.highBeam ? 0.992 : 0.985, bus.highBeam ? 0.9 : 0.8);
  shared.uHeadIntensity.value = bus.highBeam ? 2.6 : 2.2;

  // the mirror renders first and leaves the shader uniforms pointing at its own camera,
  // so the world rig has to be restored before the main pass
  cabin.aimMirror();
  cabin.mirror.render(
    renderer.gl,
    scene,
    { left: headL, right: headR, direction: headDir },
    sky.moonDirection,
  );
  updateHeadlights(camera, headL, headR, headDir);
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
  });

  renderer.present(scene, camera, elapsed);
  input.endFrame();
});

window.addEventListener('resize', () => {
  camera.aspect = renderer.aspect;
  camera.updateProjectionMatrix();
});
camera.aspect = renderer.aspect;
camera.updateProjectionMatrix();

loop.start();

// a handle for poking at the sim from the console while tuning
Object.assign(dev, { bus, path, clock, renderer, scene, camera, cabin, roster, traffic, loop, input });
Object.assign(window as unknown as Record<string, unknown>, { LAST_EXIT: dev });
