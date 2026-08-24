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
export interface Inspectable { id: string; title: string; }

/**
 * Sparse authored landmarks layered over the procedural roadside. They are created only
 * when their route segment is in the live path window, so a 400-mile route stays cheap.
 */
export class StoryStops implements Shiftable {
  readonly group = new THREE.Group();
  private readonly stops: StopVisual[];

  /** @param mileZero route distance, in metres, that the coach calls mile 0. */
  constructor(private readonly path: RoutePath, private readonly mileZero = 0) {
    this.stops = STORY_STOPS.map((spec) => ({ spec, object: this.makeMarker(spec), placed: false }));
    for (const stop of this.stops) {
      stop.object.visible = false;
      this.group.add(stop.object);
    }
  }

  update(mile: number): void {
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

  shift(offset: THREE.Vector3): void { this.group.position.sub(offset); }

  private place(stop: StopVisual): void {
    const point = this.path.sample(this.mileZero + stop.spec.mile * METRES_PER_MILE);
    const right = new THREE.Vector3(-Math.cos(point.heading), 0, Math.sin(point.heading));
    // StoryStops itself moves with the floating origin. Convert the current route-space
    // position back into the parent's local space so a stop first placed after a rebase
    // is not shifted a second time.
    const local = this.group.worldToLocal(point.pos.clone()).addScaledVector(right, 8.5);
    stop.object.position.copy(local);
    stop.object.rotation.y = point.heading + Math.PI;
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
    const addBox = (size: THREE.Vector3, position: THREE.Vector3, material = dark, inspect?: Inspectable) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
      mesh.position.copy(position);
      if (inspect) mesh.userData.inspect = inspect;
      root.add(mesh);
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
      addBox(new THREE.Vector3(8.8, 0.24, 4.4), new THREE.Vector3(-3.5, 3.4, 0));
      addBox(new THREE.Vector3(0.28, 3.4, 0.28), new THREE.Vector3(-7.1, 1.7, -1.7));
      addBox(new THREE.Vector3(0.28, 3.4, 0.28), new THREE.Vector3(0.1, 1.7, -1.7));
      addBox(new THREE.Vector3(1.05, 1.75, 0.72), new THREE.Vector3(-3.8, 0.9, 1.6), dark, {
        id: 'millers.pump', title: 'PUMP 2 — OUT OF SERVICE',
      });
      addBox(new THREE.Vector3(4.4, 2.6, 1.5), new THREE.Vector3(-7.4, 1.3, 2.1), dark, {
        id: 'millers.receipt', title: "MILLER'S CASH REGISTER",
      });
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
