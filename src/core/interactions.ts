import * as THREE from 'three';
import type { Bus } from '../bus/drive';
import type { Input } from './input';
import type { Story } from './story';
import type { StopSpec, StoryStops } from '../world/stops';
import { settings } from './settings';
import { subtitle } from '../content/i18n';

export interface InteractionUi {
  prompt(text: string | null): void;
  say(who: string | null, primary: string, secondary: string | null, seconds?: number): void;
}

/**
 * Entry/exit rules and a deliberately small on-foot controller. Every exterior scene is
 * anchored to its bus: the player can inspect a compact area but can never strand the
 * vehicle or walk far enough to bypass an authored beat.
 */
export class Interactions {
  onFoot = false;
  flashlightOn = false;
  private readonly position = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private lookYaw = 0;
  private lookPitch = 0;
  private activeStop: StopSpec | null = null;
  private doorTransition: 'idle' | 'opening' | 'closing' = 'idle';
  private pendingExit: { bus: Bus; stop: StopSpec } | null = null;

  constructor(
    private readonly stops: StoryStops,
    private readonly story: Story,
    private readonly ui: InteractionUi,
    private readonly onExit: (stop: StopSpec) => void,
    private readonly onEnter: (stop: StopSpec) => void,
    private readonly onInspect: (id: string) => void,
    private readonly onCheckpoint: () => void,
    private readonly setBusDoor: (open: boolean) => void,
    private readonly getBusDoorOpen: () => number,
  ) {}

  get transitioning(): boolean {
    return this.doorTransition !== 'idle';
  }

  /** Advance door-gated entry/exit even while a story choice is covering the HUD. */
  updateTransition(): boolean {
    if (this.doorTransition === 'idle') return false;

    if (this.doorTransition === 'opening') {
      this.ui.prompt(settings.lang === 'ru' ? 'ДВЕРИ ОТКРЫВАЮТСЯ…' : 'DOORS OPENING…');
      if (this.getBusDoorOpen() >= 0.97 && this.pendingExit) {
        const { bus, stop } = this.pendingExit;
        this.pendingExit = null;
        this.doorTransition = 'idle';
        this.finishExit(bus, stop);
      }
      return true;
    }

    this.ui.prompt(settings.lang === 'ru' ? 'ДВЕРИ ЗАКРЫВАЮТСЯ…' : 'DOORS CLOSING…');
    if (this.getBusDoorOpen() <= 0.03) {
      this.doorTransition = 'idle';
      this.ui.prompt(null);
    }
    return true;
  }

  update(dt: number, bus: Bus, input: Input): void {
    if (this.updateTransition()) return;
    if (!this.onFoot) {
      const nearby = this.stops.nearest(bus.miles);
      const stopped = bus.speedMph <= 1;
      const available = nearby && !this.completed(nearby) ? nearby : null;
      this.ui.prompt(available && stopped ? this.exitPrompt(available) : null);
      if (available && stopped && input.wasTapped('interact')) this.beginExit(bus, available);
      return;
    }

    const forward = this.direction.set(Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
    // Camera looks along +direction, so its screen-right vector is direction x up.
    // The old inverse cross product made A move right and D move left.
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    move.addScaledVector(forward, input.axis('brake', 'throttle'));
    move.addScaledVector(right, input.axis('left', 'right'));
    const walkSpeed = input.isDown('sprint') ? 5.0 : 2.8;
    if (move.lengthSq() > 0) this.position.addScaledVector(move.normalize(), dt * walkSpeed);

    // The zone is a generous circle centred on the door. The old 13 m radius could be
    // reached before some scenery had been inspected and felt like movement had broken.
    const door = bus.localToWorld(2.05, 0, 4.7);
    const delta = this.position.clone().sub(door).setY(0);
    if (delta.length() > 28) this.position.copy(door).addScaledVector(delta.normalize(), 28);

    // Story props are physical during an exterior scene: walls, pumps, counters and door
    // leaves all push the walking camera out instead of letting it cut through the model.
    this.stops.resolveWalkCollision(this.position);

    // Follow the actual procedural surface under the player, including shoulder slope and
    // desert undulation. Binding Y to the parked bus worked only near the door and caused
    // the camera to sink into raised terrain farther into the field.
    const standingEyeY = bus.groundHeightAt(this.position) + 1.68;
    this.position.y += (standingEyeY - this.position.y) * Math.min(1, dt * 18);

    const atDoor = this.position.distanceTo(door.setY(this.position.y)) < 2.1;
    const buildingDoor = this.stops.doorNear(this.position);
    const inspect = this.stops.inspectableNear(this.position);
    const missing = this.missingEvidence();
    this.ui.prompt(
      atDoor
        ? missing.length > 0
          ? (settings.lang === 'ru' ? 'СНАЧАЛА НАЙДИ УЛИКУ' : 'FIND THE CLUE FIRST')
          : (settings.lang === 'ru' ? 'E  ВОЙТИ В АВТОБУС' : 'E  RETURN TO BUS')
        : buildingDoor
          ? `${settings.lang === 'ru'
            ? buildingDoor.open ? 'E  ЗАКРЫТЬ ДВЕРЬ' : 'E  ОТКРЫТЬ ДВЕРЬ'
            : buildingDoor.open ? 'E  CLOSE DOOR' : 'E  OPEN DOOR'}  ·  ${settings.lang === 'ru' ? buildingDoor.titleRu ?? buildingDoor.title : buildingDoor.title}`
        : inspect
          ? `${settings.lang === 'ru' ? 'E  ОСМОТРЕТЬ' : 'E  INSPECT'}  ·  ${settings.lang === 'ru' ? inspect.titleRu ?? inspect.title : inspect.title}`
          : null,
    );
    if (!input.wasTapped('interact')) return;
    if (atDoor && missing.length === 0) this.enter();
    else if (atDoor) this.ui.say(null,
      settings.lang === 'ru' ? 'СЦЕНА НЕ ЗАКОНЧЕНА.' : 'THE SCENE IS NOT FINISHED.',
      settings.lang === 'ru' ? 'Осмотри нужные предметы, затем возвращайся в автобус.' : 'Inspect the important objects, then return to the bus.',
      3,
    );
    else if (buildingDoor) {
      const open = this.stops.toggleDoor(buildingDoor.id);
      this.ui.say(null,
        settings.lang === 'ru'
          ? open ? 'ДВЕРЬ МАГАЗИНА ОТКРЫТА.' : 'ДВЕРЬ МАГАЗИНА ЗАКРЫТА.'
          : open ? 'THE STORE DOOR IS OPEN.' : 'THE STORE DOOR IS CLOSED.',
        null,
        1.4,
      );
    }
    else if (inspect) this.inspect(inspect.id);
  }

  placeCamera(camera: THREE.PerspectiveCamera, input: Input, dt: number): void {
    const turn = input.axis('lookLeft', 'lookRight');
    this.lookYaw -= turn * 1.65 * dt;
    const mouse = input.consumeMouse();
    this.lookYaw -= mouse.x * 0.0022;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - mouse.y * 0.0019, -1.05, 1.05);
    camera.position.copy(this.position);
    const horizontal = Math.cos(this.lookPitch);
    this.direction.set(
      Math.sin(this.lookYaw) * horizontal,
      Math.sin(this.lookPitch),
      Math.cos(this.lookYaw) * horizontal,
    );
    camera.up.copy(this.up);
    camera.lookAt(this.position.clone().add(this.direction));
    camera.updateMatrixWorld();
  }

  /** The torch is deliberately manual: darkness is part of the exterior investigation. */
  toggleFlashlight(): boolean {
    if (!this.onFoot) return false;
    this.flashlightOn = !this.flashlightOn;
    return this.flashlightOn;
  }

  private beginExit(bus: Bus, stop: StopSpec): void {
    // The interaction prompt deliberately has a forgiving approach radius. Once the
    // driver commits to leaving the bus, park it at the authored turnout so the compact
    // on-foot area is actually reachable rather than dozens of metres down the shoulder.
    bus.restoreMiles(stop.mile);
    bus.speed = 0;
    this.pendingExit = { bus, stop };
    this.doorTransition = 'opening';
    this.setBusDoor(true);
    this.ui.prompt(settings.lang === 'ru' ? 'ДВЕРИ ОТКРЫВАЮТСЯ…' : 'DOORS OPENING…');
  }

  private finishExit(bus: Bus, stop: StopSpec): void {
    this.onFoot = true;
    this.flashlightOn = false;
    this.activeStop = stop;
    const door = bus.localToWorld(2.3, 0.05, 4.7);
    this.position.copy(door).add(new THREE.Vector3(0, 1.68, 0));
    this.lookYaw = bus.heading;
    this.lookPitch = 0;
    this.story.flag(`visited:${stop.id}`);
    this.story.checkpoint({ kind: 'stop', stopId: stop.id });
    this.onExit(stop);
    // The patrol scene is a conversation at the driver's window, not a scavenger hunt.
    // Stops with required evidence keep the player outside until the clue is found.
    if (!stop.requiredEvidence?.length) {
      this.enter();
      return;
    }
    this.ui.say(null, stop.title,
      settings.lang === 'ru'
        ? 'Осмотри нужный предмет, затем вернись в автобус, чтобы решить, что делать дальше.'
        : 'Inspect the important object, then return to the bus to decide what to do next.',
      5,
    );
  }

  private enter(): void {
    const stop = this.activeStop;
    this.onFoot = false;
    this.flashlightOn = false;
    this.activeStop = null;
    this.doorTransition = 'closing';
    this.setBusDoor(false);
    this.story.checkpoint({ kind: 'driving' });
    if (stop) this.onEnter(stop);
    this.onCheckpoint();
    this.ui.prompt(settings.lang === 'ru' ? 'ДВЕРИ ЗАКРЫВАЮТСЯ…' : 'DOORS CLOSING…');
  }

  private inspect(id: string): void {
    this.story.evidence(id);
    this.story.flag(`inspected:${id}`);
    this.onInspect(id);
    this.onCheckpoint();
    const line = subtitle(`inspect.${id}`);
    this.ui.say(null, line.primary, line.secondary, 4);
  }

  private exitPrompt(stop: StopSpec): string {
    const labels: Partial<Record<StopSpec['id'], { en: string; ru: string }>> = {
      mile86: { en: 'E  EXIT BUS AND LOOK AROUND', ru: 'E  ВЫЙТИ И ОСМОТРЕТЬСЯ' },
      'closed-gas': { en: 'E  EXIT BUS AND LOOK AROUND', ru: 'E  ВЫЙТИ И ОСМОТРЕТЬСЯ' },
      'highway-patrol': { en: 'E  SPEAK TO THE OFFICER', ru: 'E  ПОГОВОРИТЬ С ОФИЦЕРОМ' },
      'final-stop': { en: 'E  EXIT BUS AND CHECK THE MARKER', ru: 'E  ВЫЙТИ И ПРОВЕРИТЬ УКАЗАТЕЛЬ' },
    };
    const action = labels[stop.id];
    const label = action
      ? settings.lang === 'ru' ? action.ru : action.en
      : settings.lang === 'ru' ? 'E  ВЫЙТИ' : 'E  EXIT BUS';
    return `${label}  ·  ${stop.title}`;
  }

  private missingEvidence(): string[] {
    return (this.activeStop?.requiredEvidence ?? []).filter((id) => !this.story.has(`inspected:${id}`));
  }

  private completed(stop: StopSpec): boolean {
    const flags: Record<StopSpec['id'], string> = {
      mile86: 'choice:mile86',
      'closed-gas': 'choice:stranded-man',
      'millers-gas': 'miller.returned',
      'highway-patrol': 'choice:patrol',
      'sunset-motel': 'motel.roster-revealed',
      'final-stop': 'choice:finale',
    };
    return this.story.has(flags[stop.id]);
  }
}
