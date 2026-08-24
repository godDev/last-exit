import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../render/retroMaterial';
import { seatPosition, FLOOR_Y } from './interior';
import { setVisibility } from './mirror';

/**
 * The people on board.
 *
 * Faces are deliberately absent: at the resolution the mirror renders at, a silhouette
 * with the suggestion of a head reads as a person, and the player's own eye supplies the
 * rest. What each figure has instead is a set of dials the story can turn — where it is
 * visible from, whether it sways with the bus, and whether the light catches its eyes.
 */

export type Presence = 'both' | 'cabin' | 'mirror' | 'nowhere';

export interface PassengerSpec {
  id: string;
  /** Row 0 is directly behind the driver's bulkhead. */
  row: number;
  side: -1 | 1;
  coat: number;
  /** Which year's boarding this figure belongs to. Unused by the prototype; the deduction
   *  layer in the finished game keys off it. */
  boarded?: number;
}

function tint(source: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  const colour = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = colour.r;
    array[i * 3 + 1] = colour.g;
    array[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = tint(new THREE.BoxGeometry(w, h, d), 0xffffff);
  geometry.translate(x, y, z);
  return geometry;
}

/** Seated body, origin on the cushion, facing -Z like everything else in the cabin. */
function buildBody(): THREE.BufferGeometry {
  const parts = [
    box(0.42, 0.22, 0.42, 0, 0.62, 0.06),           // hips
    box(0.4, 0.52, 0.27, 0, 0.99, 0.02),            // torso
    box(0.13, 0.44, 0.16, -0.25, 0.98, 0.02),       // arms
    box(0.13, 0.44, 0.16, 0.25, 0.98, 0.02),
    box(0.17, 0.2, 0.42, -0.11, 0.45, -0.3),        // thighs
    box(0.17, 0.2, 0.42, 0.11, 0.45, -0.3),
    box(0.14, 0.4, 0.15, -0.11, 0.24, -0.48),       // shins
    box(0.14, 0.4, 0.15, 0.11, 0.24, -0.48),
  ];
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('could not merge passenger body');
  return merged;
}

function buildHead(): THREE.BufferGeometry {
  const parts = [
    box(0.12, 0.1, 0.12, 0, 1.3, 0.02),             // neck
    box(0.2, 0.25, 0.21, 0, 1.47, 0.01),            // head
    box(0.21, 0.08, 0.22, 0, 1.58, 0.015),          // hair line
  ];
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('could not merge passenger head');
  return merged;
}

export class Passenger {
  readonly object = new THREE.Group();
  readonly spec: PassengerSpec;

  /** How much the figure moves with the bus. Zero is the wrong answer for a living body. */
  sway = 1;
  /** 0 for anyone ordinary. */
  eyeshine = 0;

  private readonly eyes: THREE.Mesh;
  private readonly phase: number;
  private readonly basePosition = new THREE.Vector3();
  private presence: Presence = 'both';

  constructor(
    spec: PassengerSpec,
    bodyGeometry: THREE.BufferGeometry,
    headGeometry: THREE.BufferGeometry,
    headMaterial: THREE.ShaderMaterial,
  ) {
    this.spec = spec;
    this.phase = (spec.row * 1.7 + (spec.side + 1) * 0.9) % 6.283;

    const coat = createRetroMaterial({
      color: spec.coat,
      vertexColors: true,
      fogScale: 0,
      ambientBoost: 2.8,
      cabin: 1,
      snap: 0.3,
    });

    this.object.add(new THREE.Mesh(bodyGeometry, coat));
    this.object.add(new THREE.Mesh(headGeometry, headMaterial));

    // two pinpricks that only exist when something wants them to
    this.eyes = new THREE.Mesh(
      new THREE.PlaneGeometry(0.115, 0.016),
      createRetroMaterial({ color: 0xfff2d0, mode: 'emissive', emissive: 0, snap: 0.2 }),
    );
    this.eyes.position.set(0, 1.5, -0.107);
    this.eyes.rotation.y = Math.PI;
    this.object.add(this.eyes);

    this.basePosition.copy(seatPosition(spec.row, spec.side));
    this.basePosition.y = FLOOR_Y + 0.5;
    this.object.position.copy(this.basePosition);
  }

  setPresence(where: Presence): void {
    this.presence = where;
    setVisibility(this.object, where);
  }

  get where(): Presence { return this.presence; }

  update(elapsed: number, lean: number): void {
    // the whole saloon leans together on a curve; a figure that does not is wrong
    const breathe = Math.sin(elapsed * 0.9 + this.phase) * 0.012;
    this.object.rotation.z = lean * this.sway;
    this.object.rotation.x = breathe * this.sway;
    this.object.position.y = this.basePosition.y + breathe * 0.5 * this.sway;

    (this.eyes.material as THREE.ShaderMaterial).uniforms.uEmissive.value = this.eyeshine;
  }
}

const COATS = [0x3a3630, 0x2a3038, 0x40372c, 0x2f2a2a, 0x353b34, 0x453c30];

export class Roster {
  readonly passengers: Passenger[] = [];
  private readonly bodyGeometry = buildBody();
  private readonly headGeometry = buildHead();
  private readonly headMaterial = createRetroMaterial({
    color: 0x6b5a4c,
    vertexColors: true,
    fogScale: 0,
    ambientBoost: 2.8,
    cabin: 1,
    snap: 0.3,
  });

  constructor(private readonly root: THREE.Object3D) {}

  board(spec: Omit<PassengerSpec, 'coat'> & { coat?: number }): Passenger {
    const full: PassengerSpec = {
      ...spec,
      coat: spec.coat ?? COATS[this.passengers.length % COATS.length],
    };
    const passenger = new Passenger(full, this.bodyGeometry, this.headGeometry, this.headMaterial);
    this.passengers.push(passenger);
    this.root.add(passenger.object);
    return passenger;
  }

  find(id: string): Passenger | undefined {
    return this.passengers.find((p) => p.spec.id === id);
  }

  update(elapsed: number, lean: number): void {
    for (const p of this.passengers) p.update(elapsed, lean);
  }

  /** How many the driver can see from his seat right now. */
  countVisible(where: Presence): number {
    return this.passengers.filter((p) => p.where === where || p.where === 'both').length;
  }
}
