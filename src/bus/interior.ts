import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../render/retroMaterial';
import { Dashboard } from './dashboard';
import { Mirror, LAYER_DIRECT_ONLY } from './mirror';

/**
 * The saloon of a 1970s intercity coach.
 *
 * Cabin-local axes are the camera's: -Z forward, +X the kerb side, +Y up, origin on the
 * road surface under the middle of the bus. The whole shell and the whole run of seats are
 * each merged into one geometry — they never move relative to the bus, so the entire
 * interior costs about three draw calls no matter how long the night gets.
 */

export const FLOOR_Y = 1.05;
export const ROOF_Y = 3.08;
export const HALF_WIDTH = 1.27;
export const BUS_LENGTH = 12.2;
export const DRIVER_X = -0.72;

export const ROW_COUNT = 11;
const ROW_SPACING = 0.82;
const ROW_FIRST_Z = -3.15;
const SEAT_X = 0.75;

/** The driver's eye and the mirror housing, in cabin-local metres. */
export const EYE_LOCAL = new THREE.Vector3(DRIVER_X, 2.05, -4.9);
/**
 * Mounted so that the glance is about 22 degrees up and 28 degrees to the right of the
 * driver's eye: high and off to the side the way a coach mirror is, but comfortably inside
 * a 58 degree field rather than clipped by the top of the screen.
 */
export const MIRROR_MOUNT = new THREE.Vector3(-0.34, 2.3, -5.72);

/** Local position of a seat cushion. side -1 is the driver's side of the aisle. */
export function seatPosition(row: number, side: -1 | 1): THREE.Vector3 {
  return new THREE.Vector3(SEAT_X * side, FLOOR_Y, ROW_FIRST_Z + row * ROW_SPACING);
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

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): THREE.BufferGeometry {
  const geometry = tint(new THREE.BoxGeometry(w, h, d), colour);
  geometry.translate(x, y, z);
  return geometry;
}

function merged(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const result = mergeGeometries(parts);
  if (!result) throw new Error(`could not merge cabin geometry for "${what}"`);
  return result;
}

const PANEL = 0x2b2721;
const TRIM = 0x1d1a16;
const RUBBER = 0x151310;

function buildShell(): THREE.BufferGeometry {
  const front = -BUS_LENGTH / 2;
  const back = BUS_LENGTH / 2;
  const length = BUS_LENGTH;
  const midZ = 0;
  const parts: THREE.BufferGeometry[] = [];

  // floor, with a raised aisle strip so the ribbed rubber reads at a glance
  parts.push(box(HALF_WIDTH * 2, 0.08, length, 0, FLOOR_Y - 0.04, midZ, 0x26221c));
  parts.push(box(0.52, 0.02, length - 1.2, 0, FLOOR_Y + 0.01, midZ + 0.2, RUBBER));

  // roof and the luggage racks under it
  parts.push(box(HALF_WIDTH * 2, 0.08, length, 0, ROOF_Y + 0.04, midZ, 0x232019));
  for (const side of [-1, 1]) {
    parts.push(box(0.46, 0.06, length - 3.4, side * 0.98, ROOF_Y - 0.34, midZ + 0.6, TRIM));
    parts.push(box(0.05, 0.3, length - 3.4, side * 0.75, ROOF_Y - 0.2, midZ + 0.6, TRIM));
  }

  // side walls: sill below the glass, header above it, pillars between
  for (const side of [-1, 1]) {
    const x = side * HALF_WIDTH;
    parts.push(box(0.07, 0.62, length, x, FLOOR_Y + 0.31, midZ, PANEL));
    parts.push(box(0.07, 0.5, length, x, ROOF_Y - 0.25, midZ, PANEL));
    // window pillars
    for (let i = 0; i < 8; i++) {
      const z = front + 2.2 + i * 1.28;
      parts.push(box(0.08, 0.95, 0.11, x, FLOOR_Y + 1.12, z, TRIM));
    }
  }

  // windscreen surround and A-pillars
  parts.push(box(HALF_WIDTH * 2, 0.22, 0.1, 0, ROOF_Y - 0.12, front + 0.1, PANEL));
  for (const side of [-1, 1]) {
    parts.push(box(0.13, 1.6, 0.13, side * (HALF_WIDTH - 0.08), FLOOR_Y + 1.5, front + 0.15, PANEL));
  }
  // the step well and door on the kerb side
  parts.push(box(0.06, 1.95, 0.9, HALF_WIDTH - 0.02, FLOOR_Y + 0.98, front + 1.35, 0x201d18));
  parts.push(box(0.6, 0.16, 0.86, HALF_WIDTH - 0.36, FLOOR_Y - 0.28, front + 1.35, 0x1b1815));

  // rear bulkhead with the emergency door, left open as a frame around the back window
  parts.push(box(HALF_WIDTH * 2, 0.5, 0.09, 0, FLOOR_Y + 0.25, back - 0.05, PANEL));
  parts.push(box(HALF_WIDTH * 2, 0.42, 0.09, 0, ROOF_Y - 0.21, back - 0.05, PANEL));
  parts.push(box(0.12, 1.35, 0.09, -0.62, FLOOR_Y + 1.18, back - 0.05, TRIM));
  parts.push(box(0.12, 1.35, 0.09, 0.62, FLOOR_Y + 1.18, back - 0.05, TRIM));

  // grab rails down the aisle
  parts.push(box(0.045, 0.045, length - 4.2, -0.26, ROOF_Y - 0.46, midZ + 0.9, 0x35312a));
  parts.push(box(0.045, 0.045, length - 4.2, 0.26, ROOF_Y - 0.46, midZ + 0.9, 0x35312a));

  return merged(parts, 'shell');
}

function buildSeats(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cloth = 0x2f2a33;
  const clothAlt = 0x342d2a;
  const frame = 0x1a1815;

  for (let row = 0; row < ROW_COUNT; row++) {
    const z = ROW_FIRST_Z + row * ROW_SPACING;
    for (const side of [-1, 1] as const) {
      const x = SEAT_X * side;
      const colour = row % 2 === 0 ? cloth : clothAlt;
      // cushion
      parts.push(box(0.98, 0.13, 0.5, x, FLOOR_Y + 0.44, z, colour));
      // backrest, reclined a touch
      const back = box(0.98, 0.66, 0.11, x, FLOOR_Y + 0.83, z + 0.26, colour);
      back.rotateX(0.07);
      parts.push(back);
      // the split between the two seats, and the head rests
      parts.push(box(0.04, 0.6, 0.1, x, FLOOR_Y + 0.85, z + 0.26, frame));
      for (const half of [-1, 1]) {
        parts.push(box(0.4, 0.16, 0.1, x + half * 0.25, FLOOR_Y + 1.2, z + 0.29, colour));
      }
      // pedestal
      parts.push(box(0.16, 0.36, 0.16, x, FLOOR_Y + 0.2, z, frame));
    }
  }

  // the driver's own seat, facing the same way as everyone else
  parts.push(box(0.52, 0.12, 0.48, DRIVER_X, FLOOR_Y + 0.36, -4.62, 0x201d1a));
  parts.push(box(0.52, 0.62, 0.1, DRIVER_X, FLOOR_Y + 0.72, -4.38, 0x201d1a));
  parts.push(box(0.18, 0.32, 0.18, DRIVER_X, FLOOR_Y + 0.16, -4.62, frame));

  return merged(parts, 'seats');
}

export class Cabin {
  readonly group = new THREE.Group();
  readonly dashboard: Dashboard;
  readonly mirror: Mirror;
  /** Where passengers are parented, so the roster never touches cabin structure. */
  readonly passengerRoot = new THREE.Group();

  private readonly domeLights: THREE.Mesh[] = [];
  private readonly mirrorTarget = new THREE.Vector3();

  constructor() {
    const surfaces = createRetroMaterial({
      vertexColors: true,
      // inside the bus there is no distance and therefore no fog
      fogScale: 0,
      ambientBoost: 2.8,
      cabin: 1,
      snap: 0.25,
      side: THREE.DoubleSide,
    });

    const shell = new THREE.Mesh(buildShell(), surfaces);
    const seats = new THREE.Mesh(buildSeats(), surfaces);
    shell.frustumCulled = false;
    seats.frustumCulled = false;
    this.group.add(shell, seats);

    // dim amber dome lights: the only light in the saloon all night
    const lamp = createRetroMaterial({ color: 0xffcc88, mode: 'emissive', emissive: 0.5, snap: 0.2 });
    for (let i = 0; i < 4; i++) {
      const light = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.14), lamp);
      light.rotation.x = Math.PI / 2;
      light.position.set(0, ROOF_Y - 0.06, -3.6 + i * 2.6);
      this.domeLights.push(light);
      this.group.add(light);
    }

    this.dashboard = new Dashboard(DRIVER_X);
    this.group.add(this.dashboard.group);

    this.mirror = new Mirror();
    this.mirror.mesh.position.copy(MIRROR_MOUNT);
    // The glass has to be angled at the driver's face, not left facing down the bus, or
    // all he ever sees is the back of the housing.
    this.mirror.mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      EYE_LOCAL.clone().sub(MIRROR_MOUNT).normalize(),
    );
    this.group.add(this.mirror.mesh);

    this.group.add(this.passengerRoot);
  }

  /**
   * Put the cabin where the bus is. Rotating by heading + PI is what makes cabin-local
   * axes line up with the camera's, so "forward" means the same thing in both.
   */
  sync(position: THREE.Vector3, heading: number, pitch: number, roll: number): void {
    this.group.position.copy(position);
    this.group.rotation.set(pitch * 0.4, heading + Math.PI, roll * 0.4, 'YXZ');
    this.group.updateMatrixWorld(true);
  }

  /** Aim the mirror down the aisle at head height and hand back its world position. */
  aimMirror(): THREE.Vector3 {
    this.mirrorTarget.set(0, FLOOR_Y + 0.95, 5.6);
    this.group.localToWorld(this.mirrorTarget);
    this.mirror.aim(this.group, this.mirrorTarget);
    return this.mirror.worldPosition;
  }

  /** 0 = dome lights off, 1 = full. The saloon lamps and the shader glow move together. */
  setCabinLights(level: number): void {
    for (const light of this.domeLights) {
      (light.material as THREE.ShaderMaterial).uniforms.uEmissive.value = 0.5 * level;
    }
  }

  /** The driver's eye, in world space. */
  eye(out: THREE.Vector3, heave: number): THREE.Vector3 {
    out.copy(EYE_LOCAL);
    out.y += heave;
    return this.group.localToWorld(out);
  }

  /** Hide the parts of the cabin that would sit in front of the lens of the mirror. */
  hideFromMirror(object: THREE.Object3D): void {
    object.traverse((child) => child.layers.set(LAYER_DIRECT_ONLY));
  }
}
