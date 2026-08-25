import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../render/retroMaterial';
import { seatPosition, FLOOR_Y } from './interior';
import { setVisibility } from './mirror';

/** Low-poly people: human silhouettes and readable faces without losing the retro style. */

export type Presence = 'both' | 'cabin' | 'mirror' | 'nowhere';

export interface PassengerSpec {
  id: string;
  /** Row 0 is directly behind the driver's bulkhead. */
  row: number;
  side: -1 | 1;
  coat: number;
  boarded?: number;
}

function transformed(
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  geometry.scale(...scale);
  geometry.rotateX(rotation[0]);
  geometry.rotateY(rotation[1]);
  geometry.rotateZ(rotation[2]);
  geometry.translate(...position);
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

function merge(parts: THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
  const result = mergeGeometries(parts, false);
  if (!result) throw new Error(`could not merge passenger ${label}`);
  result.computeVertexNormals();
  return result;
}

/** Seated clothing, origin on the cushion and facing -Z. */
function buildClothes(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    // A tapered chest and rounded shoulders read much more naturally than the old boxes.
    transformed(new THREE.CylinderGeometry(0.23, 0.27, 0.5, 8), [0, 0.98, 0.04], [1, 1, 0.72]),
    transformed(new THREE.SphereGeometry(0.25, 8, 5), [0, 0.77, 0.05], [1, 0.65, 0.82]),
    transformed(new THREE.CapsuleGeometry(0.075, 0.31, 3, 6), [-0.25, 0.96, 0.01], [1, 1, 0.9], [0.08, 0, -0.12]),
    transformed(new THREE.CapsuleGeometry(0.075, 0.31, 3, 6), [0.25, 0.96, 0.01], [1, 1, 0.9], [0.08, 0, 0.12]),
    // Upper legs point towards the aisle/front; lower legs hang from the knee.
    transformed(new THREE.CapsuleGeometry(0.09, 0.25, 3, 6), [-0.115, 0.5, -0.18], [1, 1, 1], [Math.PI / 2.55, 0, 0]),
    transformed(new THREE.CapsuleGeometry(0.09, 0.25, 3, 6), [0.115, 0.5, -0.18], [1, 1, 1], [Math.PI / 2.55, 0, 0]),
    transformed(new THREE.CapsuleGeometry(0.072, 0.29, 3, 6), [-0.115, 0.25, -0.39], [1, 1, 1], [0.06, 0, 0]),
    transformed(new THREE.CapsuleGeometry(0.072, 0.29, 3, 6), [0.115, 0.25, -0.39], [1, 1, 1], [0.06, 0, 0]),
  ];
  return merge(parts, 'clothing');
}

function buildSkin(): THREE.BufferGeometry {
  return merge([
    transformed(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 8), [0, 1.29, 0.025]),
    transformed(new THREE.SphereGeometry(0.145, 10, 7), [0, 1.46, 0], [0.88, 1.12, 0.9]),
    transformed(new THREE.SphereGeometry(0.032, 7, 5), [-0.13, 1.47, 0]),
    transformed(new THREE.SphereGeometry(0.032, 7, 5), [0.13, 1.47, 0]),
    transformed(new THREE.ConeGeometry(0.026, 0.065, 6), [0, 1.455, -0.13], [1, 1, 1], [-Math.PI / 2, 0, 0]),
    transformed(new THREE.SphereGeometry(0.066, 7, 5), [-0.23, 0.73, -0.11], [0.72, 1.05, 0.72]),
    transformed(new THREE.SphereGeometry(0.066, 7, 5), [0.23, 0.73, -0.11], [0.72, 1.05, 0.72]),
  ], 'skin');
}

function buildHair(): THREE.BufferGeometry {
  return merge([
    transformed(new THREE.SphereGeometry(0.151, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.56), [0, 1.485, 0.012], [0.91, 1.02, 0.93]),
    transformed(new THREE.SphereGeometry(0.045, 7, 4), [-0.115, 1.505, -0.075], [0.75, 1.35, 0.55]),
  ], 'hair');
}

function buildShoes(): THREE.BufferGeometry {
  return merge([
    transformed(new THREE.SphereGeometry(0.09, 7, 4), [-0.115, 0.075, -0.46], [0.9, 0.55, 1.35]),
    transformed(new THREE.SphereGeometry(0.09, 7, 4), [0.115, 0.075, -0.46], [0.9, 0.55, 1.35]),
  ], 'shoes');
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function cabinMaterial(color: number, ambientBoost = 3): THREE.ShaderMaterial {
  return createRetroMaterial({ color, fogScale: 0, ambientBoost, cabin: 1, snap: 0.14 });
}

export class Passenger {
  readonly object = new THREE.Group();
  readonly spec: PassengerSpec;
  sway = 1;
  eyeshine = 0;

  private readonly shine: THREE.Mesh;
  private readonly phase: number;
  private readonly basePosition = new THREE.Vector3();
  private presence: Presence = 'both';

  constructor(
    spec: PassengerSpec,
    clothesGeometry: THREE.BufferGeometry,
    skinGeometry: THREE.BufferGeometry,
    hairGeometry: THREE.BufferGeometry,
    shoesGeometry: THREE.BufferGeometry,
  ) {
    this.spec = spec;
    const variation = hashId(spec.id);
    this.phase = (spec.row * 1.7 + (spec.side + 1) * 0.9) % 6.283;

    const skinTones = [0x916d56, 0x76513f, 0xa77b5e, 0x654638, 0x8a6048];
    const hairTones = [0x171412, 0x2a211b, 0x3a2b20, 0x5a493c, 0x242328];
    const figure = new THREE.Group();
    figure.add(
      new THREE.Mesh(clothesGeometry, cabinMaterial(spec.coat)),
      new THREE.Mesh(skinGeometry, cabinMaterial(skinTones[variation % skinTones.length], 3.35)),
      new THREE.Mesh(hairGeometry, cabinMaterial(hairTones[(variation >>> 4) % hairTones.length], 2.5)),
      new THREE.Mesh(shoesGeometry, cabinMaterial(0x171717, 2.2)),
    );

    // A small but complete face. At normal driving distance these merge into a believable
    // expression; during a mirror glance the separate sclerae, pupils, brows and mouth
    // remain readable instead of becoming the old single dark stripe.
    const face = new THREE.Group();
    const eyeWhite = cabinMaterial(0xd2c6ad, 3.8);
    const pupil = cabinMaterial(0x17120f, 2.5);
    const feature = cabinMaterial(hairTones[(variation >>> 4) % hairTones.length], 2.8);
    const lipTones = [0x603b36, 0x70433d, 0x53342f, 0x76473f];
    const lips = cabinMaterial(lipTones[(variation >>> 7) % lipTones.length], 3.1);
    const eyeGap = 0.052 + ((variation >>> 9) % 4) * 0.004;
    const browTilt = (((variation >>> 13) % 7) - 3) * 0.035;
    for (const side of [-1, 1]) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.027, 8, 5), eyeWhite);
      white.scale.set(1.18, 0.62, 0.48);
      white.position.set(side * eyeGap, 1.495, -0.132);
      face.add(white);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.012, 7, 4), pupil);
      iris.scale.z = 0.42;
      iris.position.set(side * eyeGap, 1.495, -0.15);
      face.add(iris);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.009, 0.009), feature);
      brow.position.set(side * eyeGap, 1.545, -0.139);
      brow.rotation.z = side * browTilt;
      face.add(brow);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07 + (variation % 3) * 0.008, 0.011, 0.009), lips);
    mouth.position.set(0, 1.395, -0.145);
    mouth.rotation.z = (((variation >>> 16) % 5) - 2) * 0.018;
    face.add(mouth);
    // Nasolabial shadow and chin give the face depth under the weak dome lamps.
    const noseShadow = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.045, 0.008), feature);
    noseShadow.position.set(0.018, 1.445, -0.148);
    noseShadow.rotation.z = -0.1;
    face.add(noseShadow);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.038, 7, 4), cabinMaterial(skinTones[variation % skinTones.length], 3.1));
    chin.scale.set(1.1, 0.38, 0.5);
    chin.position.set(0, 1.35, -0.126);
    face.add(chin);
    face.scale.x = 0.9 + ((variation >>> 18) % 9) * 0.025;
    figure.add(face);

    this.shine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.098, 0.014),
      createRetroMaterial({ color: 0xfff2d0, mode: 'emissive', emissive: 0, snap: 0.1 }),
    );
    this.shine.position.set(0, 1.495, -0.158);
    this.shine.rotation.y = Math.PI;
    figure.add(this.shine);

    // Small deterministic differences keep a row of passengers from looking cloned.
    figure.scale.set(0.94 + (variation % 9) * 0.01, 0.96 + ((variation >>> 8) % 8) * 0.01, 1);
    figure.rotation.y = (((variation >>> 12) % 9) - 4) * 0.018;
    this.object.add(figure);

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
    const breathe = Math.sin(elapsed * 0.9 + this.phase) * 0.012;
    const glance = Math.sin(elapsed * 0.17 + this.phase) * 0.009;
    this.object.rotation.z = lean * this.sway;
    this.object.rotation.x = breathe * this.sway;
    this.object.rotation.y = glance * this.sway;
    this.object.position.y = this.basePosition.y + breathe * 0.5 * this.sway;
    (this.shine.material as THREE.ShaderMaterial).uniforms.uEmissive.value = this.eyeshine;
  }
}

const COATS = [0x3a3630, 0x2a3038, 0x40372c, 0x2f2a2a, 0x353b34, 0x453c30];

export class Roster {
  readonly passengers: Passenger[] = [];
  private readonly clothesGeometry = buildClothes();
  private readonly skinGeometry = buildSkin();
  private readonly hairGeometry = buildHair();
  private readonly shoesGeometry = buildShoes();

  constructor(private readonly root: THREE.Object3D) {}

  board(spec: Omit<PassengerSpec, 'coat'> & { coat?: number }): Passenger {
    const full: PassengerSpec = {
      ...spec,
      coat: spec.coat ?? COATS[this.passengers.length % COATS.length],
    };
    const passenger = new Passenger(
      full,
      this.clothesGeometry,
      this.skinGeometry,
      this.hairGeometry,
      this.shoesGeometry,
    );
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

  countVisible(where: Presence): number {
    return this.passengers.filter((p) => p.where === where || p.where === 'both').length;
  }
}
