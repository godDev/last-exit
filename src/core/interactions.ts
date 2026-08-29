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
  private readonly busRight = new THREE.Vector3();
  private readonly busForward = new THREE.Vector3();
  private lookYaw = 0;
  private lookPitch = 0;
  private activeStop: StopSpec | null = null;
  private doorTransition: 'idle' | 'turning' | 'opening' | 'exiting' | 'entering' | 'closing' = 'idle';
  private pendingExit: { bus: Bus; stop: StopSpec } | null = null;
  private pendingEntry: { bus: Bus; stop: StopSpec | null } | null = null;
  private exitElapsed = 0;
  private entryElapsed = 0;
  private entryDuration = 1;
  private readonly exitLocal = new THREE.Vector3();
  private readonly exitNextLocal = new THREE.Vector3();
  private readonly exitLookLocal = new THREE.Vector3();
  private readonly exitWorld = new THREE.Vector3();
  private readonly exitLookWorld = new THREE.Vector3();
  private readonly entryStartLookLocal = new THREE.Vector3();
  private readonly entryPath: Array<{ time: number; position: [number, number, number] }> = [];

  private static readonly EXIT_TURN_DURATION = 1.15;
  private static readonly EXIT_DURATION = 5.75;
  private static readonly EXIT_PATH: ReadonlyArray<{ time: number; position: readonly [number, number, number] }> = [
    // bus-local coordinates: right, eye height above road, forward toward the windscreen
    { time: 0, position: [-0.42, 2.12, 5.12] },
    { time: 0.72, position: [-0.5, 2.64, 4.9] },
    { time: 1.25, position: [-0.32, 2.73, 4.74] },
    { time: 2.05, position: [0.58, 2.73, 4.7] },
    { time: 2.7, position: [1.17, 2.73, 4.69] },
    // Descend the physical treads one by one. The extra transition points prevent the
    // large last height change from reading as a jump off the bus.
    { time: 3.15, position: [1.43, 2.68, 4.69] },
    { time: 3.58, position: [1.58, 2.51, 4.69] },
    { time: 4.0, position: [1.73, 2.43, 4.69] },
    { time: 4.42, position: [1.9, 2.27, 4.69] },
    { time: 4.85, position: [2.1, 2.05, 4.69] },
    { time: 5.3, position: [2.32, 1.78, 4.7] },
    { time: 5.75, position: [2.58, 1.73, 4.74] },
  ];

  private static readonly ENTRY_GUIDES: ReadonlyArray<readonly [number, number, number]> = [
    // Outside approach, lower/middle/upper treads, cab floor, turn to the seat, sit.
    [2.32, 1.78, 4.72],
    [2.1, 2.05, 4.7],
    [1.9, 2.27, 4.69],
    [1.7, 2.43, 4.69],
    [1.55, 2.51, 4.69],
    [1.4, 2.68, 4.69],
    [1.16, 2.73, 4.69],
    [0.58, 2.73, 4.7],
    [-0.25, 2.73, 4.74],
    [-0.5, 2.64, 4.9],
    [-0.72, 2.05, 4.9],
  ];

  /** Time-aware cubic interpolation keeps velocity continuous through every path marker. */
  private sampleTimedPath(
    path: ReadonlyArray<{ time: number; position: readonly [number, number, number] }>,
    duration: number,
    time: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const clampedTime = THREE.MathUtils.clamp(time, 0, duration);
    let index = 0;
    while (index < path.length - 2 && clampedTime > path[index + 1].time) index++;

    const current = path[index];
    const next = path[index + 1];
    const previous = path[Math.max(0, index - 1)];
    const following = path[Math.min(path.length - 1, index + 2)];
    const span = Math.max(0.001, next.time - current.time);
    const t = THREE.MathUtils.clamp((clampedTime - current.time) / span, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const component = (axis: 0 | 1 | 2): number => {
      const p0 = current.position[axis];
      const p1 = next.position[axis];
      const incomingDuration = Math.max(0.001, next.time - previous.time);
      const outgoingDuration = Math.max(0.001, following.time - current.time);
      const incomingSlope = (p1 - previous.position[axis]) / incomingDuration;
      const outgoingSlope = (following.position[axis] - p0) / outgoingDuration;
      return h00 * p0 + h10 * incomingSlope * span + h01 * p1 + h11 * outgoingSlope * span;
    };

    return out.set(component(0), component(1), component(2));
  }

  private sampleExitPath(time: number, out: THREE.Vector3): THREE.Vector3 {
    return this.sampleTimedPath(Interactions.EXIT_PATH, Interactions.EXIT_DURATION, time, out);
  }

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

  get exitCutsceneActive(): boolean {
    const leaving = Boolean(this.pendingExit)
      && (this.doorTransition === 'turning' || this.doorTransition === 'opening' || this.doorTransition === 'exiting');
    return leaving || (Boolean(this.pendingEntry) && this.doorTransition === 'entering');
  }

  get exitCameraOutside(): boolean {
    return (this.doorTransition === 'exiting' && this.exitElapsed >= 3.2)
      || (this.doorTransition === 'entering' && this.entryElapsed <= this.entryDuration * 0.58);
  }

  /** Advance door-gated entry/exit even while a story choice is covering the HUD. */
  updateTransition(dt = 0): boolean {
    if (this.doorTransition === 'idle') return false;

    if (this.doorTransition === 'turning') {
      this.exitElapsed = Math.min(Interactions.EXIT_TURN_DURATION, this.exitElapsed + dt);
      this.ui.prompt(settings.lang === 'ru' ? 'ПОДГОТОВКА К ВЫХОДУ…' : 'PREPARING TO EXIT…');
      if (this.exitElapsed >= Interactions.EXIT_TURN_DURATION && this.pendingExit) {
        this.doorTransition = 'opening';
        this.exitElapsed = 0;
        this.setBusDoor(true);
      }
      return true;
    }

    if (this.doorTransition === 'opening') {
      this.ui.prompt(settings.lang === 'ru' ? 'ДВЕРИ ОТКРЫВАЮТСЯ…' : 'DOORS OPENING…');
      if (this.getBusDoorOpen() >= 0.97 && this.pendingExit) {
        this.doorTransition = 'exiting';
        this.exitElapsed = 0;
      }
      return true;
    }

    if (this.doorTransition === 'exiting') {
      this.exitElapsed = Math.min(Interactions.EXIT_DURATION, this.exitElapsed + dt);
      this.ui.prompt(settings.lang === 'ru' ? 'ВЫХОД ИЗ АВТОБУСА…' : 'LEAVING THE BUS…');
      if (this.exitElapsed >= Interactions.EXIT_DURATION && this.pendingExit) {
        const { bus, stop } = this.pendingExit;
        this.pendingExit = null;
        this.doorTransition = 'idle';
        this.finishExit(bus, stop);
      }
      return true;
    }

    if (this.doorTransition === 'entering') {
      this.entryElapsed = Math.min(this.entryDuration, this.entryElapsed + dt);
      this.ui.prompt(settings.lang === 'ru' ? 'ПОСАДКА В АВТОБУС…' : 'ENTERING THE BUS…');
      if (this.entryElapsed >= this.entryDuration && this.pendingEntry) this.finishEnter();
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
    if (this.updateTransition(dt)) return;
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
    // Cap a single walking step below the collision capsule radius so a long frame cannot
    // tunnel through the thin coach wall.
    if (move.lengthSq() > 0) this.position.addScaledVector(move.normalize(), Math.min(dt, 0.05) * walkSpeed);

    // The zone is a generous circle centred on the door. The old 13 m radius could be
    // reached before some scenery had been inspected and felt like movement had broken.
    const door = bus.localToWorld(2.05, 0, 4.7);
    const delta = this.position.clone().sub(door).setY(0);
    if (delta.length() > 28) this.position.copy(door).addScaledVector(delta.normalize(), 28);

    // Story props are physical during an exterior scene: walls, pumps, counters and door
    // leaves all push the walking camera out instead of letting it cut through the model.
    this.stops.resolveWalkCollision(this.position);
    this.resolveBusCollision(bus);

    // Outside, follow the procedural terrain. Inside the doorway, climb the visible lower
    // and middle treads before settling at the saloon floor height.
    const standingEyeY = this.standingEyeHeight(bus);
    this.position.y += (standingEyeY - this.position.y) * Math.min(1, dt * 10);

    const local = this.busLocalPosition(bus);
    // Offer the return action at the foot of the open doorway. The cutscene now owns
    // the climb, so the player no longer has to walk most of the way inside first.
    const insideDoorway = local.right < 2.68
      && local.right > 0.35
      && local.forward > 3.82
      && local.forward < 5.54;
    const buildingDoor = this.stops.doorNear(this.position);
    const inspect = this.stops.inspectableNear(this.position);
    const missing = this.missingEvidence();
    this.ui.prompt(
      insideDoorway
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
    if (insideDoorway && missing.length === 0) this.beginEnter(bus);
    else if (insideDoorway) this.ui.say(null,
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

  /** Position in bus-local coordinates: +right is the passenger door, +forward the nose. */
  private busLocalPosition(bus: Bus): { right: number; forward: number } {
    this.busRight.copy(bus.rightVector);
    this.busForward.copy(bus.forwardVector);
    const dx = this.position.x - bus.position.x;
    const dz = this.position.z - bus.position.z;
    return {
      right: dx * this.busRight.x + dz * this.busRight.z,
      forward: dx * this.busForward.x + dz * this.busForward.z,
    };
  }

  /** A capsule against four coach walls, with one opening matching the folding doorway. */
  private resolveBusCollision(bus: Bus): void {
    const local = this.busLocalPosition(bus);
    let x = local.right;
    let z = local.forward;
    const radius = 0.28;
    const halfWidth = 1.43;
    const halfLength = 6.12;
    const doorRear = 3.74;
    const doorFront = 5.62;
    const doorPassable = this.getBusDoorOpen() >= 0.88;

    const pushFromSegment = (ax: number, az: number, bx: number, bz: number): void => {
      const sx = bx - ax;
      const sz = bz - az;
      const lengthSq = sx * sx + sz * sz;
      const t = THREE.MathUtils.clamp(((x - ax) * sx + (z - az) * sz) / lengthSq, 0, 1);
      const closestX = ax + sx * t;
      const closestZ = az + sz * t;
      let nx = x - closestX;
      let nz = z - closestZ;
      const distanceSq = nx * nx + nz * nz;
      if (distanceSq >= radius * radius) return;

      let distance = Math.sqrt(distanceSq);
      if (distance < 0.0001) {
        // Choose the side the camera already occupies when it lands exactly on a wall.
        if (Math.abs(sx) < Math.abs(sz)) nx = x >= ax ? 1 : -1;
        else nz = z >= az ? 1 : -1;
        distance = 1;
      } else {
        nx /= distance;
        nz /= distance;
      }
      const correction = radius - (distanceSq < 0.0001 ? 0 : distance);
      x += nx * correction;
      z += nz * correction;
    };

    const pushFromBox = (
      minX: number,
      maxX: number,
      minZ: number,
      maxZ: number,
      clearance = 0.18,
    ): void => {
      const left = minX - clearance;
      const right = maxX + clearance;
      const rear = minZ - clearance;
      const front = maxZ + clearance;
      if (x <= left || x >= right || z <= rear || z >= front) return;
      const distances = [x - left, right - x, z - rear, front - z];
      const nearest = Math.min(...distances);
      if (nearest === distances[0]) x = left;
      else if (nearest === distances[1]) x = right;
      else if (nearest === distances[2]) z = rear;
      else z = front;
    };

    pushFromSegment(-halfWidth, -halfLength, -halfWidth, halfLength);
    pushFromSegment(-halfWidth, halfLength, halfWidth, halfLength);
    pushFromSegment(halfWidth, -halfLength, halfWidth, doorRear);
    if (!doorPassable) pushFromSegment(halfWidth, doorRear, halfWidth, doorFront);
    pushFromSegment(halfWidth, doorFront, halfWidth, halfLength);
    pushFromSegment(halfWidth, -halfLength, -halfWidth, -halfLength);

    // Eleven paired passenger benches. Their collider includes the seated passenger, arm
    // rests and backrest, while retaining a narrow but continuous central aisle.
    for (let row = 0; row < 11; row++) {
      const seatForward = 3.05 - row * 0.82;
      pushFromBox(-1.24, -0.26, seatForward - 0.38, seatForward + 0.38);
      pushFromBox(0.26, 1.24, seatForward - 0.38, seatForward + 0.38);
    }

    // Front-cabin equipment is not part of the passenger grid.
    pushFromBox(-1.0, -0.44, 4.38, 5.02, 0.2);  // driver's seat and seated body
    pushFromBox(-0.28, -0.02, 5.18, 5.5, 0.16); // fare box
    pushFromBox(-1.22, 1.04, 5.5, 5.98, 0.16);  // dashboard and knee panel

    this.position.x = bus.position.x + this.busRight.x * x + this.busForward.x * z;
    this.position.z = bus.position.z + this.busRight.z * x + this.busForward.z * z;
  }

  private standingEyeHeight(bus: Bus): number {
    const local = this.busLocalPosition(bus);
    const onDoorAxis = local.forward > 3.72 && local.forward < 5.64;
    const insideBody = local.right < 1.43
      && local.right > -1.43
      && local.forward > -6.12
      && local.forward < 6.12;
    let feetY = bus.groundHeightAt(this.position);

    if (insideBody) feetY = bus.position.y + 1.05;
    else if (onDoorAxis && local.right < 2.12) {
      if (local.right > 1.82) feetY = bus.position.y + 0.64;
      else if (local.right > 1.52) feetY = bus.position.y + 0.86;
      else feetY = bus.position.y + 1.05;
    }
    return feetY + 1.68;
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

  /** First-person seat transfer: walk between the road and the driver's cushion. */
  placeExitCamera(camera: THREE.PerspectiveCamera): void {
    const bus = this.pendingExit?.bus ?? this.pendingEntry?.bus;
    if (!bus) return;

    if (this.doorTransition === 'entering') {
      this.sampleTimedPath(this.entryPath, this.entryDuration, this.entryElapsed, this.exitLocal);
      bus.localToWorld(this.exitLocal.x, this.exitLocal.y, this.exitLocal.z, this.exitWorld);

      // Lead the eyes along the next section of the route, then turn naturally from the
      // aisle toward the windscreen while the body lowers onto the cushion.
      this.sampleTimedPath(
        this.entryPath,
        this.entryDuration,
        this.entryElapsed + 0.68,
        this.exitNextLocal,
      );
      this.exitNextLocal.y = Math.max(this.exitLocal.y - 0.08, 1.72);
      const acquirePath = THREE.MathUtils.smoothstep(this.entryElapsed, 0.08, 0.72);
      this.exitLookLocal.copy(this.entryStartLookLocal).lerp(this.exitNextLocal, acquirePath);
      const faceWheel = THREE.MathUtils.smoothstep(
        this.entryElapsed,
        Math.max(0, this.entryDuration - 1.45),
        Math.max(0.01, this.entryDuration - 0.12),
      );
      this.exitNextLocal.set(-0.72, 2.02, 9.5);
      this.exitLookLocal.lerp(this.exitNextLocal, faceWheel);
    } else if (this.doorTransition === 'turning') {
      const rawTurn = THREE.MathUtils.clamp(this.exitElapsed / Interactions.EXIT_TURN_DURATION, 0, 1);
      const turn = rawTurn * rawTurn * rawTurn * (rawTurn * (rawTurn * 6 - 15) + 10);
      // Lean around the seat and fare box while turning the head. This keeps the opening
      // leaves visible instead of letting nearby cab geometry cover the lens.
      this.exitLocal.set(
        THREE.MathUtils.lerp(-0.72, -0.42, turn),
        THREE.MathUtils.lerp(2.05, 2.12, turn),
        THREE.MathUtils.lerp(4.9, 5.12, turn),
      );
      bus.localToWorld(this.exitLocal.x, this.exitLocal.y, this.exitLocal.z, this.exitWorld);
      // Begin looking down the road, then turn naturally toward the opening door.
      this.exitLookLocal.set(
        THREE.MathUtils.lerp(-0.72, 1.28, turn),
        THREE.MathUtils.lerp(2.02, 1.9, turn),
        THREE.MathUtils.lerp(9.5, 4.68, turn),
      );
    } else if (this.doorTransition === 'opening') {
      // Hold the completed seated look while the doors open. Separating these phases
      // makes the driver's intention legible and avoids a simultaneous camera/door rush.
      this.exitLocal.set(-0.42, 2.12, 5.12);
      bus.localToWorld(this.exitLocal.x, this.exitLocal.y, this.exitLocal.z, this.exitWorld);
      this.exitLookLocal.set(1.28, 1.9, 4.68);
    } else {
      // Hermite interpolation preserves momentum across path markers. The previous
      // per-segment easing reached zero velocity at every marker and felt like a series
      // of small starts and stops, especially while descending the steps.
      this.sampleExitPath(this.exitElapsed, this.exitLocal);
      bus.localToWorld(this.exitLocal.x, this.exitLocal.y, this.exitLocal.z, this.exitWorld);

      // Look along a continuously sampled point ahead instead of snapping the gaze to
      // the next waypoint. Blend out of the seated door gaze during the stand-up motion.
      this.sampleExitPath(this.exitElapsed + 0.7, this.exitNextLocal);
      this.exitNextLocal.x += THREE.MathUtils.lerp(0.42, 0.85,
        THREE.MathUtils.smoothstep(this.exitElapsed, 4.1, 5.35));
      this.exitNextLocal.y = Math.max(this.exitLocal.y - 0.1, 1.72);
      const gazeBlend = THREE.MathUtils.smoothstep(this.exitElapsed, 0.35, 1.25);
      this.exitLookLocal.set(1.25, 1.95, 4.68).lerp(this.exitNextLocal, gazeBlend);
    }

    bus.localToWorld(this.exitLookLocal.x, this.exitLookLocal.y, this.exitLookLocal.z, this.exitLookWorld);
    camera.position.copy(this.exitWorld);
    camera.up.copy(this.up);
    camera.lookAt(this.exitLookWorld);
    if (Math.abs(camera.fov - 56) > 0.01) {
      camera.fov = 56;
      camera.updateProjectionMatrix();
    }
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
    this.doorTransition = 'turning';
    this.exitElapsed = 0;
    this.ui.prompt(settings.lang === 'ru' ? 'ПОДГОТОВКА К ВЫХОДУ…' : 'PREPARING TO EXIT…');
  }

  private finishExit(bus: Bus, stop: StopSpec): void {
    this.onFoot = true;
    this.flashlightOn = false;
    this.activeStop = stop;
    const door = bus.localToWorld(2.58, 0.05, 4.74);
    this.position.copy(door).add(new THREE.Vector3(0, 1.68, 0));
    // Continue looking away from the open doorway when mouse control is handed back.
    this.lookYaw = bus.heading - Math.PI / 2;
    this.lookPitch = 0;
    this.story.flag(`visited:${stop.id}`);
    this.story.checkpoint({ kind: 'stop', stopId: stop.id });
    this.onExit(stop);
    // The patrol scene is a conversation at the driver's window, not a scavenger hunt.
    // Stops with required evidence keep the player outside until the clue is found.
    if (!stop.requiredEvidence?.length) {
      this.beginEnter(bus);
      return;
    }
    this.ui.say(null, stop.title,
      settings.lang === 'ru'
        ? 'Осмотри нужный предмет, затем вернись в автобус, чтобы решить, что делать дальше.'
        : 'Inspect the important object, then return to the bus to decide what to do next.',
      5,
    );
  }

  private beginEnter(bus: Bus): void {
    if (this.pendingEntry) return;
    const stop = this.activeStop;
    const local = this.busLocalPosition(bus);
    const start: [number, number, number] = [
      local.right,
      this.position.y - bus.position.y,
      local.forward,
    ];

    this.entryPath.length = 0;
    this.entryPath.push({ time: 0, position: start });
    let elapsed = 0;
    let previous = start;
    for (const guide of Interactions.ENTRY_GUIDES) {
      // If the player already stepped onto a tread, continue inward from that point
      // instead of pulling the camera back outside before beginning the animation.
      if (guide[0] >= start[0] - 0.04) continue;
      const dx = guide[0] - previous[0];
      const dy = guide[1] - previous[1];
      const dz = guide[2] - previous[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      elapsed += THREE.MathUtils.clamp(distance / 0.82, 0.32, 0.82);
      const point: [number, number, number] = [guide[0], guide[1], guide[2]];
      this.entryPath.push({ time: elapsed, position: point });
      previous = point;
    }

    // The doorway trigger is always outside the driver's eye, but retain a safe final
    // point if a future level edit moves it deeper into the cab.
    if (this.entryPath.length < 2) {
      elapsed = 0.9;
      this.entryPath.push({ time: elapsed, position: [-0.72, 2.05, 4.9] });
    }
    this.entryDuration = elapsed;
    this.entryElapsed = 0;
    this.pendingEntry = { bus, stop };
    this.doorTransition = 'entering';
    this.flashlightOn = false;

    // Preserve the exact view direction at the moment control is taken, expressed in
    // bus-local coordinates, so the first cutscene frame cannot snap the driver's head.
    const lookDistance = 4;
    if (this.direction.lengthSq() < 0.5) {
      const horizontal = Math.cos(this.lookPitch);
      this.direction.set(
        Math.sin(this.lookYaw) * horizontal,
        Math.sin(this.lookPitch),
        Math.cos(this.lookYaw) * horizontal,
      );
    }
    this.entryStartLookLocal.set(
      start[0] + this.direction.dot(this.busRight) * lookDistance,
      start[1] + this.direction.y * lookDistance,
      start[2] + this.direction.dot(this.busForward) * lookDistance,
    );
    this.ui.prompt(settings.lang === 'ru' ? 'ПОСАДКА В АВТОБУС…' : 'ENTERING THE BUS…');
  }

  private finishEnter(): void {
    const pending = this.pendingEntry;
    if (!pending) return;
    const { stop } = pending;
    this.pendingEntry = null;
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
