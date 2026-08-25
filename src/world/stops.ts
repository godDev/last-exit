import * as THREE from 'three';
import type { Shiftable } from './origin';
import { STATION_SPACING, type RoutePath } from './curvature';
import { METRES_PER_MILE } from '../core/units';
import { createRetroMaterial } from '../render/retroMaterial';
import { canvasTexture } from '../render/textures';

export interface StopSpec {
  id: 'mile86' | 'closed-gas' | 'millers-gas' | 'highway-patrol' | 'sunset-motel' | 'final-stop';
  mile: number;
  title: string;
  /** Distance from the marker in which the driver may leave the coach. */
  radius: number;
  /** Facts that must be collected before the driver may leave this authored scene. */
  requiredEvidence?: string[];
}

/**
 * Physical route distances for the playable build. The story still calls the first
 * landmark Mile 86, but the prototype compresses a 400-mile night into a 16-mile play
 * session: the first encounter lands in roughly two minutes, then a new beat arrives
 * every two to three minutes at normal coach speed.
 */
export const STORY_MILES = {
  mile86: 1.6,
  closedGas: 4.0,
  millersGas: 6.5,
  highwayPatrol: 9.0,
  sunsetMotel: 11.5,
  finalStop: 14.0,
  carson: 16.0,
} as const;

export const STORY_STOPS: StopSpec[] = [
  // The girl is a cab-side dialogue. The timetable is visible at the stop and recorded
  // when the scene begins, so the player never has to leave the coach to advance it.
  { id: 'mile86', mile: STORY_MILES.mile86, title: 'MILE 86 BUS STOP', radius: 0.22 },
  { id: 'closed-gas', mile: STORY_MILES.closedGas, title: 'CLOSED SERVICE STATION', radius: 0.22, requiredEvidence: ['closed-gas.car'] },
  { id: 'millers-gas', mile: STORY_MILES.millersGas, title: "MILLER'S GAS & SERVICE", radius: 0.24, requiredEvidence: ['millers.receipt'] },
  { id: 'highway-patrol', mile: STORY_MILES.highwayPatrol, title: 'HIGHWAY PATROL', radius: 0.22 },
  { id: 'sunset-motel', mile: STORY_MILES.sunsetMotel, title: 'SUNSET MOTOR INN', radius: 0.24, requiredEvidence: ['sunset.photo', 'sunset.manifest'] },
  { id: 'final-stop', mile: STORY_MILES.finalStop, title: 'LAST STOP — 30 MILES TO CARSON', radius: 0.22, requiredEvidence: ['final.marker'] },
];

interface StopVisual { spec: StopSpec; object: THREE.Group; placed: boolean; }
export interface Inspectable { id: string; title: string; titleRu?: string; }
export interface DoorInteraction { id: string; title: string; titleRu?: string; open: boolean; }

interface DoorState extends DoorInteraction {
  stopId: StopSpec['id'];
  pivot: THREE.Group;
  target: number;
}

/**
 * Sparse authored landmarks layered over the procedural roadside. They are created only
 * when their route segment is in the live path window, so a 400-mile route stays cheap.
 */
export class StoryStops implements Shiftable {
  readonly group = new THREE.Group();
  private readonly stops: StopVisual[];
  private readonly doors: DoorState[] = [];
  private readonly collisionLocal = new THREE.Vector3();
  private readonly collisionWorld = new THREE.Vector3();

  /** @param mileZero route distance, in metres, that the coach calls mile 0. */
  constructor(private readonly path: RoutePath, private readonly mileZero = 0) {
    this.stops = STORY_STOPS.map((spec) => ({ spec, object: this.makeMarker(spec), placed: false }));
    for (const stop of this.stops) {
      stop.object.visible = false;
      this.group.add(stop.object);
    }
  }

  update(mile: number, dt = 0): void {
    for (const stop of this.stops) {
      // Keep a landmark alive across its whole approach. Fog decides when it first becomes
      // visible; this prevents a structure from popping in only after its warning plays.
      const near = Math.abs(stop.spec.mile - mile) < 0.95;
      // The route only keeps a short live window around the coach. Never let sample()
      // substitute an edge point for an authored stop that is still outside that window:
      // doing that permanently pins the whole scene behind the player.
      if (near && !stop.placed && this.canPlace(stop.spec)) this.place(stop);
      stop.object.visible = near && stop.placed;
    }
    this.updateDoors(dt);
  }

  nearest(mile: number): StopSpec | null {
    return STORY_STOPS.find((stop) => Math.abs(stop.mile - mile) <= stop.radius) ?? null;
  }

  inspectableNear(position: THREE.Vector3): Inspectable | null {
    const point = new THREE.Vector3();
    for (const stop of this.stops) {
      if (!stop.object.visible) continue;
      let found: Inspectable | null = null;
      stop.object.traverse((object) => {
        if (found || !object.userData.inspect) return;
        object.getWorldPosition(point);
        if (point.distanceTo(position) < 2.05) found = object.userData.inspect as Inspectable;
      });
      if (found) return found;
    }
    return null;
  }

  doorNear(position: THREE.Vector3): DoorInteraction | null {
    const anchor = new THREE.Vector3();
    for (const door of this.doors) {
      const stop = this.stops.find((candidate) => candidate.spec.id === door.stopId);
      if (!stop?.object.visible) continue;
      door.pivot.localToWorld(anchor.set(0, 0, 0.45));
      if (anchor.distanceTo(position) < 1.65) return door;
    }
    return null;
  }

  toggleDoor(id: string): boolean {
    const door = this.doors.find((candidate) => candidate.id === id);
    if (!door) return false;
    door.open = !door.open;
    door.target = door.open ? 1 : 0;
    return door.open;
  }

  /**
   * Keep the walking camera outside every marked box. Collision happens in each mesh's
   * local space, so it stays correct when a stop is rotated with the road or a door swings.
   */
  resolveWalkCollision(position: THREE.Vector3, radius = 0.28): void {
    for (let pass = 0; pass < 2; pass++) {
      let adjusted = false;
      for (const stop of this.stops) {
        if (!stop.object.visible) continue;
        stop.object.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || !object.userData.walkCollider) return;
          const geometry = object.geometry as THREE.BufferGeometry;
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          const bounds = geometry.boundingBox;
          if (!bounds) return;

          const local = object.worldToLocal(this.collisionLocal.copy(position));
          const playerFeet = local.y - 1.68;
          if (playerFeet > bounds.max.y || local.y < bounds.min.y) return;

          const minX = bounds.min.x - radius;
          const maxX = bounds.max.x + radius;
          const minZ = bounds.min.z - radius;
          const maxZ = bounds.max.z + radius;
          if (local.x <= minX || local.x >= maxX || local.z <= minZ || local.z >= maxZ) return;

          const toMinX = local.x - minX;
          const toMaxX = maxX - local.x;
          const toMinZ = local.z - minZ;
          const toMaxZ = maxZ - local.z;
          const smallest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          const pad = 0.006;
          if (smallest === toMinX) local.x = minX - pad;
          else if (smallest === toMaxX) local.x = maxX + pad;
          else if (smallest === toMinZ) local.z = minZ - pad;
          else local.z = maxZ + pad;

          object.localToWorld(this.collisionWorld.copy(local));
          position.x = this.collisionWorld.x;
          position.z = this.collisionWorld.z;
          adjusted = true;
        });
      }
      if (!adjusted) return;
    }
  }

  shift(offset: THREE.Vector3): void { this.group.position.sub(offset); }

  private updateDoors(dt: number): void {
    if (dt <= 0) return;
    for (const door of this.doors) {
      const wanted = door.target * 1.3;
      door.pivot.rotation.y += (wanted - door.pivot.rotation.y) * (1 - Math.exp(-dt * 8));
    }
  }

  private place(stop: StopVisual): void {
    const point = this.path.sample(this.mileZero + stop.spec.mile * METRES_PER_MILE);
    const right = new THREE.Vector3(-Math.cos(point.heading), 0, Math.sin(point.heading));
    // StoryStops itself moves with the floating origin. Convert the current route-space
    // position back into the parent's local space so a stop first placed after a rebase
    // is not shifted a second time.
    // Miller's occupies a real forecourt rather than clipping into the shoulder. It sits
    // deeper in the field, while the other compact route landmarks remain close to the bus.
    const routeDistance = this.mileZero + stop.spec.mile * METRES_PER_MILE;
    const roadsideOffset = stop.spec.id === 'millers-gas' ? 13.5 : 8.5;
    const local = this.group.worldToLocal(point.pos.clone()).addScaledVector(right, roadsideOffset);
    // The authored model's floor is at local Y = 0. Anchor it to the same terrain profile
    // the road and player use, so a distant forecourt never appears to float above the sand.
    const ground = this.path.groundHeightAt(routeDistance, roadsideOffset);
    local.y += ground - point.pos.y;
    stop.object.position.copy(local);
    stop.object.rotation.set(0, point.heading + Math.PI, 0);
    if (stop.spec.id === 'millers-gas') {
      // The forecourt follows the shoulder's long, gentle fall away from the highway.
      // Limiting the lean preserves vertical-looking walls when local terrain is noisy.
      const outerGround = this.path.groundHeightAt(routeDistance, roadsideOffset + 13);
      stop.object.rotateZ(THREE.MathUtils.clamp(Math.atan2(outerGround - ground, 13), -0.045, 0.045));
    }
    stop.placed = true;
  }

  private canPlace(spec: StopSpec): boolean {
    const station = Math.floor((this.mileZero + spec.mile * METRES_PER_MILE) / STATION_SPACING);
    return Boolean(this.path.at(station) && this.path.at(station + 1));
  }

  private makeMarker(spec: StopSpec): THREE.Group {
    const root = new THREE.Group();
    const dark = createRetroMaterial({ color: 0x2a241c, ambientBoost: 1.8, snap: 0.5 });
    const glow = createRetroMaterial({ color: 0xffb347, mode: 'emissive', emissive: 1.4, snap: 0.35 });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 0.16), dark);
    pole.position.y = 1.6;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.72, 0.12), dark);
    sign.position.set(0, 3.15, 0);
    const signTexture = canvasTexture(512, 96, (ctx) => {
      ctx.fillStyle = '#17130f';
      ctx.fillRect(0, 0, 512, 96);
      ctx.strokeStyle = '#c68a3a';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, 504, 88);
      ctx.fillStyle = '#f0c77c';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const words = spec.title.split(' ');
      const split = words.length > 3 ? Math.ceil(words.length / 2) : words.length;
      const top = words.slice(0, split).join(' ');
      const bottom = words.slice(split).join(' ');
      ctx.fillText(top, 256, bottom ? 34 : 48);
      if (bottom) ctx.fillText(bottom, 256, 67);
    });
    const signFace = new THREE.Mesh(
      new THREE.PlaneGeometry(3.64, 0.62),
      createRetroMaterial({ map: signTexture, snap: 0.35, side: THREE.DoubleSide, ambientBoost: 2.5 }),
    );
    signFace.position.set(0, 3.15, -0.071);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.13), glow);
    lamp.position.set(0, 3.15, -0.08);
    root.add(pole, sign, signFace, lamp);
    root.userData.title = spec.title;
    const addBox = (
      size: THREE.Vector3,
      position: THREE.Vector3,
      material = dark,
      inspect?: Inspectable,
      solid = size.y >= 0.45,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
      mesh.position.copy(position);
      if (inspect) mesh.userData.inspect = inspect;
      // Low slabs and curbs are ground detail; standing-height furniture and walls keep
      // the player out. Individual doors also receive this marker while they animate.
      if (solid) mesh.userData.walkCollider = true;
      root.add(mesh);
      return mesh;
    };
    const addPerson = (position: THREE.Vector3, coat: number) => {
      const person = new THREE.Group();
      const clothing = createRetroMaterial({ color: coat, ambientBoost: 3.5, snap: 0.45 });
      const skin = createRetroMaterial({ color: 0x8a6a55, ambientBoost: 3.2, snap: 0.45 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(.42, .92, .25), clothing);
      body.position.y = .76;
      const head = new THREE.Mesh(new THREE.BoxGeometry(.23, .26, .22), skin);
      head.position.y = 1.38;
      person.add(body, head);
      person.position.copy(position);
      root.add(person);
    };

    if (spec.id === 'mile86') {
      addBox(new THREE.Vector3(4.2, 0.12, 1.5), new THREE.Vector3(-2.4, 2.25, 0));
      addBox(new THREE.Vector3(0.12, 2.2, 0.12), new THREE.Vector3(-4.2, 1.1, 0));
      addBox(new THREE.Vector3(0.12, 2.2, 0.12), new THREE.Vector3(-0.6, 1.1, 0));
      addBox(new THREE.Vector3(2.1, 0.22, 0.5), new THREE.Vector3(-2.4, 0.55, 0.15), dark, {
        id: 'mile86.timetable', title: 'FADED ROUTE 17 TIMETABLE',
      });
      // The player must see the girl before deciding whether she is real.
      addPerson(new THREE.Vector3(-1.2, 0, -1.35), 0x5b4248);
    } else if (spec.id === 'closed-gas') {
      addBox(new THREE.Vector3(4.6, 2.3, 1.4), new THREE.Vector3(-4.2, 1.15, 1.6), dark, {
        id: 'closed-gas.phone', title: 'DEAD PAY PHONE',
      });
      addBox(new THREE.Vector3(1, 1.7, .7), new THREE.Vector3(-1.5, .85, .8), dark, {
        id: 'closed-gas.car', title: 'ABANDONED SEDAN',
      });
      addPerson(new THREE.Vector3(-.35, 0, -.85), 0x3b454d);
    } else if (spec.id === 'millers-gas') {
      // Forecourt: the old station is deliberately more substantial than a single prop.
      // Its closest pump is still well clear of the road, leaving an actual apron for the
      // coach to pull alongside rather than a building that intersects the lane.
      const tile = (texture: THREE.CanvasTexture, x: number, y: number) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(x, y);
        return texture;
      };
      const concreteTexture = tile(canvasTexture(192, 192, (ctx, w, h) => {
        ctx.fillStyle = '#595650';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 86; i++) {
          const x = (i * 47) % w;
          const y = (i * 83) % h;
          const size = 1 + (i % 4);
          ctx.fillStyle = i % 3 ? '#47443e' : '#6d6960';
          ctx.fillRect(x, y, size, size);
        }
        ctx.strokeStyle = '#35332f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(8, 35); ctx.lineTo(62, 45); ctx.lineTo(91, 81); ctx.lineTo(154, 87); ctx.lineTo(186, 126);
        ctx.moveTo(22, 161); ctx.lineTo(68, 138); ctx.lineTo(107, 147); ctx.lineTo(143, 172);
        ctx.stroke();
        ctx.fillStyle = 'rgba(23, 20, 16, .34)';
        ctx.beginPath();
        ctx.ellipse(140, 43, 25, 12, .1, 0, Math.PI * 2);
        ctx.fill();
      }), 6, 3);
      const wallTexture = tile(canvasTexture(192, 128, (ctx, w, h) => {
        ctx.fillStyle = '#665b49';
        ctx.fillRect(0, 0, w, h);
        for (let y = 10; y < h; y += 17) {
          ctx.fillStyle = '#4d4538';
          ctx.fillRect(0, y, w, 3);
          ctx.fillStyle = 'rgba(186, 158, 108, .18)';
          ctx.fillRect(0, y + 3, w, 1);
        }
        for (let i = 0; i < 25; i++) {
          ctx.fillStyle = i % 2 ? 'rgba(30, 24, 18, .22)' : 'rgba(194, 164, 107, .14)';
          ctx.fillRect((i * 37) % w, (i * 61) % h, 2 + (i % 7), 3 + (i % 11));
        }
        ctx.fillStyle = 'rgba(31, 25, 19, .2)';
        ctx.fillRect(23, 0, 8, h);
        ctx.fillRect(141, 0, 5, h);
      }), 2.5, 2.2);
      const trimTexture = tile(canvasTexture(192, 64, (ctx, w, h) => {
        ctx.fillStyle = '#2b2721';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#b57632';
        ctx.fillRect(0, 10, w, 8);
        ctx.fillStyle = '#e1b65e';
        ctx.fillRect(0, 18, w, 3);
        ctx.fillStyle = '#58371c';
        for (let x = 6; x < w; x += 27) ctx.fillRect(x, 10, 8, 11);
        ctx.fillStyle = 'rgba(0, 0, 0, .32)';
        for (let i = 0; i < 18; i++) ctx.fillRect((i * 29) % w, (i * 17) % h, 3 + (i % 5), 2);
      }), 3, 2);
      const pumpTexture = tile(canvasTexture(96, 128, (ctx, w, h) => {
        ctx.fillStyle = '#803127';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#b24b33';
        ctx.fillRect(9, 7, w - 18, 18);
        ctx.fillStyle = '#211e1b';
        ctx.fillRect(16, 35, w - 32, 31);
        ctx.fillStyle = '#9bb2ae';
        ctx.fillRect(21, 40, w - 42, 17);
        ctx.fillStyle = '#d8c894';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('REGULAR', w / 2, 53);
        ctx.fillStyle = '#48231e';
        for (let i = 0; i < 13; i++) ctx.fillRect((i * 23) % w, 75 + (i * 19) % 45, 5 + (i % 5), 3);
      }), 1, 1);
      const concrete = createRetroMaterial({ color: 0xffffff, map: concreteTexture, ambientBoost: 2.1, snap: 0.4 });
      const wall = createRetroMaterial({ color: 0xffffff, map: wallTexture, ambientBoost: 2.4, snap: 0.4 });
      const trim = createRetroMaterial({ color: 0xffffff, map: trimTexture, ambientBoost: 2.2, snap: 0.4 });
      const windowLight = createRetroMaterial({ color: 0xffca72, mode: 'emissive', emissive: 0.62, snap: 0.32 });
      const coldLight = createRetroMaterial({ color: 0x9fb4bd, mode: 'emissive', emissive: 0.38, snap: 0.32 });
      const red = createRetroMaterial({ color: 0xffffff, map: pumpTexture, ambientBoost: 2.4, snap: 0.38 });

      // Cracked concrete forecourt, raised curbs and a dark drainage strip.
      addBox(new THREE.Vector3(18.5, 0.14, 10.5), new THREE.Vector3(7.2, .07, 0), concrete);
      addBox(new THREE.Vector3(18.5, 0.1, .26), new THREE.Vector3(7.2, .13, -5.05), trim);
      addBox(new THREE.Vector3(18.5, 0.1, .26), new THREE.Vector3(7.2, .13, 5.05), trim);
      addBox(new THREE.Vector3(9.2, 0.08, .35), new THREE.Vector3(10.9, .16, 3.9), trim);

      // Store: actual four walls and a doorway, rather than one solid cuboid. The front
      // faces the road (negative local X), so the player can open the door and enter.
      addBox(new THREE.Vector3(7.0, .1, 5.55), new THREE.Vector3(11.2, .19, 0), concrete, undefined, false);
      addBox(new THREE.Vector3(.18, 3.15, 5.8), new THREE.Vector3(14.72, 1.58, 0), wall);
      addBox(new THREE.Vector3(7.2, 3.15, .18), new THREE.Vector3(11.2, 1.58, -2.81), wall);
      addBox(new THREE.Vector3(7.2, 3.15, .18), new THREE.Vector3(11.2, 1.58, 2.81), wall);
      addBox(new THREE.Vector3(.18, 3.15, 1.7), new THREE.Vector3(7.68, 1.58, -2.0), wall);
      addBox(new THREE.Vector3(.18, 3.15, 2.48), new THREE.Vector3(7.68, 1.58, 1.56), wall);
      addBox(new THREE.Vector3(.18, .48, 1.62), new THREE.Vector3(7.68, 2.91, -.34), wall);
      addBox(new THREE.Vector3(7.55, .26, 6.15), new THREE.Vector3(11.2, 3.24, 0), trim);

      // Lit, dirty front panes make the stocked room readable from the forecourt without
      // becoming solid duplicate walls over the facade segments.
      addBox(new THREE.Vector3(.035, 1.3, 1.36), new THREE.Vector3(7.57, 1.93, -2.0), windowLight, undefined, false);
      addBox(new THREE.Vector3(.035, 1.3, 1.74), new THREE.Vector3(7.57, 1.93, 1.6), coldLight, undefined, false);
      for (const z of [-2.68, -1.32, .5, 1.85, 2.68]) {
        addBox(new THREE.Vector3(.2, 1.58, .08), new THREE.Vector3(7.52, 1.9, z), trim);
      }

      // A hinged glazed door occupies the deliberate gap in the front wall. Its panel is
      // also a collider, so it blocks the entrance while closed and swings out of the way.
      const storeDoor = new THREE.Group();
      storeDoor.position.set(7.52, 1.42, -1.15);
      const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(.1, 1.92, 1.62), trim);
      doorPanel.position.set(0, 0, .81);
      doorPanel.userData.walkCollider = true;
      const doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.28), coldLight);
      doorGlass.rotation.y = Math.PI / 2;
      doorGlass.position.set(-.056, .14, .81);
      const doorHandle = new THREE.Mesh(new THREE.BoxGeometry(.08, .06, .34), windowLight);
      doorHandle.position.set(-.08, -.12, 1.25);
      storeDoor.add(doorPanel, doorGlass, doorHandle);
      root.add(storeDoor);
      this.doors.push({
        id: 'millers.store-door',
        title: "MILLER'S STORE DOOR",
        titleRu: 'ДВЕРЬ МАГАЗИНА MILLER’S',
        stopId: spec.id,
        pivot: storeDoor,
        open: false,
        target: 0,
      });
      addBox(new THREE.Vector3(.4, .09, 1.55), new THREE.Vector3(7.8, .32, -.34), trim, undefined, false);

      // Interior: the counter sits along the side, never across the entrance. Its rear
      // remains more than a metre from the wall/shelves, leaving a believable cashier aisle.
      const shelfWood = createRetroMaterial({ color: 0x423426, ambientBoost: 2.45, snap: .32 });
      const packageTexture = (base: string, stripe: string, label: string) => canvasTexture(72, 112, (ctx, w, h) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#15130f';
        ctx.fillRect(5, 5, w - 10, h - 10);
        ctx.fillStyle = base;
        ctx.fillRect(8, 8, w - 16, h - 16);
        ctx.fillStyle = stripe;
        ctx.fillRect(8, 38, w - 16, 26);
        ctx.fillStyle = '#f2dfad';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, 51);
        ctx.fillStyle = 'rgba(255,255,255,.32)';
        ctx.fillRect(13, 15, w - 26, 5);
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        for (let i = 0; i < 5; i++) ctx.fillRect(12 + i * 10, 80 + (i % 2) * 5, 7, 3);
      });
      const snackRed = createRetroMaterial({ color: 0xffffff, map: packageTexture('#8c3028', '#d8a43c', 'CHIPS'), ambientBoost: 2.7, snap: .25 });
      const snackYellow = createRetroMaterial({ color: 0xffffff, map: packageTexture('#a36f26', '#e1c45e', 'CANDY'), ambientBoost: 2.7, snap: .25 });
      const snackBlue = createRetroMaterial({ color: 0xffffff, map: packageTexture('#294f64', '#a6c8c4', 'SODA'), ambientBoost: 2.7, snap: .25 });
      const counter = addBox(new THREE.Vector3(3.0, 1.2, .72), new THREE.Vector3(11.2, .79, 1.18), shelfWood);
      counter.userData.walkCollider = true;
      const register = addBox(new THREE.Vector3(.42, .24, .58), new THREE.Vector3(11.72, 1.48, .8), dark, {
        id: 'millers.receipt', title: "MILLER'S CASH REGISTER", titleRu: 'КАССА MILLER’S',
      });
      register.userData.walkCollider = true;
      addBox(new THREE.Vector3(.32, .18, .12), new THREE.Vector3(11.51, 1.68, .8), coldLight, undefined, false);
      addBox(new THREE.Vector3(.54, .12, .12), new THREE.Vector3(11.64, 1.35, .8), trim, undefined, false);
      // Small retail display on the customer side of the counter: labelled packets retain
      // their artwork at close range instead of reading as flat coloured blocks.
      addBox(new THREE.Vector3(.28, .42, .22), new THREE.Vector3(10.22, 1.62, .8), snackRed, undefined, false);
      addBox(new THREE.Vector3(.24, .34, .22), new THREE.Vector3(10.58, 1.58, .79), snackYellow, undefined, false);
      addBox(new THREE.Vector3(.23, .46, .2), new THREE.Vector3(10.92, 1.64, .79), snackBlue, undefined, false);

      const addShelf = (x: number, z: number, alongZ: boolean) => {
        const long = 2.1;
        if (alongZ) {
          addBox(new THREE.Vector3(.36, 2.05, .12), new THREE.Vector3(x, 1.18, z - long / 2), shelfWood);
          addBox(new THREE.Vector3(.36, 2.05, .12), new THREE.Vector3(x, 1.18, z + long / 2), shelfWood);
          for (const y of [.5, 1.08, 1.66]) addBox(new THREE.Vector3(.42, .08, long + .12), new THREE.Vector3(x, y, z), shelfWood, undefined, false);
          for (let row = 0; row < 3; row++) {
            for (let column = 0; column < 5; column++) {
              const product = [snackRed, snackYellow, snackBlue][(row + column) % 3];
              addBox(new THREE.Vector3(.24, .3, .25), new THREE.Vector3(x - .18, .72 + row * .58, z - .78 + column * .39), product, undefined, false);
            }
          }
        } else {
          addBox(new THREE.Vector3(.12, 2.05, .36), new THREE.Vector3(x - long / 2, 1.18, z), shelfWood);
          addBox(new THREE.Vector3(.12, 2.05, .36), new THREE.Vector3(x + long / 2, 1.18, z), shelfWood);
          for (const y of [.5, 1.08, 1.66]) addBox(new THREE.Vector3(long + .12, .08, .42), new THREE.Vector3(x, y, z), shelfWood, undefined, false);
          for (let row = 0; row < 3; row++) {
            for (let column = 0; column < 5; column++) {
              const product = [snackBlue, snackYellow, snackRed][(row + column) % 3];
              addBox(new THREE.Vector3(.25, .3, .24), new THREE.Vector3(x - .78 + column * .39, .72 + row * .58, z - .18), product, undefined, false);
            }
          }
        }
      };
      addShelf(14.28, -1.32, true);
      addShelf(14.28, 1.28, true);
      addShelf(12.35, -2.46, false);
      addBox(new THREE.Vector3(.72, 2.2, 1.02), new THREE.Vector3(13.8, 1.17, -2.18), coldLight);
      addBox(new THREE.Vector3(.75, 1.9, .07), new THREE.Vector3(13.42, 1.18, -2.18), dark, undefined, false);
      addBox(new THREE.Vector3(1.7, .055, .42), new THREE.Vector3(11.3, 2.88, -.3), windowLight, undefined, false);

      // The projecting roadside sign is a texture rather than a glowing generic box.
      const millersSignTexture = canvasTexture(512, 96, (ctx) => {
        ctx.fillStyle = '#211b16';
        ctx.fillRect(0, 0, 512, 96);
        ctx.strokeStyle = '#c68a3a';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 504, 88);
        ctx.fillStyle = '#f0c77c';
        ctx.font = 'bold 29px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText("MILLER'S GAS", 256, 48);
      });
      const millersSign = new THREE.Mesh(
        new THREE.PlaneGeometry(4.7, .88),
        createRetroMaterial({ map: millersSignTexture, snap: .34, side: THREE.DoubleSide, ambientBoost: 2.8 }),
      );
      millersSign.position.set(7.37, 3.0, 0);
      millersSign.rotation.y = -Math.PI / 2;
      root.add(millersSign);

      // Canopy and its four supports: it shelters two pumps and gives the scene a readable silhouette.
      addBox(new THREE.Vector3(10.4, .26, 7.2), new THREE.Vector3(3.4, 4.28, 0), trim);
      addBox(new THREE.Vector3(10.9, .12, 7.65), new THREE.Vector3(3.4, 4.13, 0), dark);
      for (const x of [-1.15, 7.95]) {
        for (const z of [-2.68, 2.68]) addBox(new THREE.Vector3(.3, 4.05, .3), new THREE.Vector3(x, 2.02, z), trim);
      }

      const addPump = (z: number, inspect?: Inspectable) => {
        addBox(new THREE.Vector3(1.12, 1.9, .9), new THREE.Vector3(2.6, .96, z), red, inspect);
        addBox(new THREE.Vector3(.78, .56, .06), new THREE.Vector3(2.02, 1.3, z), coldLight);
        addBox(new THREE.Vector3(.18, 1.05, .14), new THREE.Vector3(3.16, 1.78, z + .32), trim);
        addBox(new THREE.Vector3(.54, .08, .54), new THREE.Vector3(2.6, 1.95, z), trim);
        addBox(new THREE.Vector3(.1, .72, .12), new THREE.Vector3(3.22, 1.1, z - .26), dark);
      };
      addPump(-1.72);
      addPump(1.72, { id: 'millers.pump', title: 'PUMP 2 — OUT OF SERVICE' });

      // Peripheral clutter makes the forecourt feel closed in haste rather than empty by design.
      addBox(new THREE.Vector3(.72, .95, .72), new THREE.Vector3(15.0, .47, 3.85), trim);
      addBox(new THREE.Vector3(.78, .84, .78), new THREE.Vector3(16.05, .42, 3.85), dark);
      addBox(new THREE.Vector3(1.85, .58, 1.05), new THREE.Vector3(14.25, .3, -3.75), trim);
      addBox(new THREE.Vector3(.16, 2.25, .16), new THREE.Vector3(-.75, 1.12, 4.25), dark);
      addBox(new THREE.Vector3(.85, .72, .1), new THREE.Vector3(-.75, 2.25, 4.25), windowLight);
    } else if (spec.id === 'highway-patrol') {
      addBox(new THREE.Vector3(4.7, 1.15, 1.8), new THREE.Vector3(-3.2, .58, 1.4), dark, {
        id: 'patrol.cruiser', title: 'HIGHWAY PATROL CRUISER',
      });
      addBox(new THREE.Vector3(.65, .12, .3), new THREE.Vector3(-3.2, 1.25, 1.4), glow);
      addPerson(new THREE.Vector3(-1.15, 0, .2), 0x303238);
    } else if (spec.id === 'sunset-motel') {
      addBox(new THREE.Vector3(11, 2.8, 2.8), new THREE.Vector3(-5.1, 1.4, 1.8));
      addBox(new THREE.Vector3(0.16, 5.4, 0.16), new THREE.Vector3(-8.7, 2.7, -0.2));
      addBox(new THREE.Vector3(4.2, 1.1, 0.16), new THREE.Vector3(-8.7, 5.05, -0.2), glow);
      addBox(new THREE.Vector3(1.05, 2.1, 0.1), new THREE.Vector3(-4.8, 1.05, 0.32), dark, {
        id: 'sunset.room8', title: 'ROOM 8 — LOCKED',
      });
      addBox(new THREE.Vector3(1.05, 2.1, 0.1), new THREE.Vector3(-6.15, 1.05, 0.32), dark, {
        id: 'sunset.room7', title: 'ROOM 7 — OPEN',
      });
      addBox(new THREE.Vector3(.82, .62, .08), new THREE.Vector3(-6.2, 1.82, 0.2), dark, {
        id: 'sunset.photo', title: 'WESTERN TRAILS STAFF PHOTOGRAPH',
      });
      addBox(new THREE.Vector3(1.4, 1.05, .55), new THREE.Vector3(-8.2, .55, .1), dark, {
        id: 'sunset.manifest', title: 'MOTEL FRONT DESK',
      });
    } else {
      addBox(new THREE.Vector3(3.3, 0.16, 0.7), new THREE.Vector3(-2.2, 0.7, 0), dark, {
        id: 'final.marker', title: 'CARSON — 30 MILES',
      });
    }
    return root;
  }
}
