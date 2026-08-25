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
/** Driver-side exterior mirror: it must look along the left flank, not down the aisle. */
// Outside the driver's window, close to the A-pillar: visible without a full head turn.
export const LEFT_MIRROR_MOUNT = new THREE.Vector3(-1.48, 2.25, -5.55);

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
const COACH_WHEEL_RADIUS = 0.47;

function buildShell(): THREE.BufferGeometry {
  const front = -BUS_LENGTH / 2;
  const back = BUS_LENGTH / 2;
  const length = BUS_LENGTH;
  const midZ = 0;
  const parts: THREE.BufferGeometry[] = [];

  // floor, with a raised aisle strip so the ribbed rubber reads at a glance
  parts.push(box(HALF_WIDTH * 2, 0.08, length, 0, FLOOR_Y - 0.04, midZ, 0x26221c));
  parts.push(box(0.52, 0.02, length - 1.2, 0, FLOOR_Y + 0.01, midZ + 0.2, RUBBER));
  // moulded anti-slip ribs and aluminium aisle edging
  for (let z = front + 0.8; z < back - 0.45; z += 0.22) {
    parts.push(box(0.46, 0.008, 0.018, 0, FLOOR_Y + 0.024, z, 0x35312b));
  }
  for (const side of [-1, 1]) {
    parts.push(box(0.025, 0.025, length - 1.2, side * 0.28, FLOOR_Y + 0.035, 0.2, 0x625b4d));
  }

  // roof and the luggage racks under it
  parts.push(box(HALF_WIDTH * 2, 0.08, length, 0, ROOF_Y + 0.04, midZ, 0x232019));
  // longitudinal ceiling seams and a central service channel
  parts.push(box(0.38, 0.035, length - 1.0, 0, ROOF_Y - 0.025, 0.2, 0x191713));
  for (const side of [-1, 1]) {
    parts.push(box(0.018, 0.025, length - 1.0, side * 0.23, ROOF_Y - 0.052, 0.2, 0x4b4439));
  }
  for (const side of [-1, 1]) {
    parts.push(box(0.46, 0.06, length - 3.4, side * 0.98, ROOF_Y - 0.34, midZ + 0.6, TRIM));
    parts.push(box(0.05, 0.3, length - 3.4, side * 0.75, ROOF_Y - 0.2, midZ + 0.6, TRIM));
  }

  // side walls: sill below the glass, header above it, pillars between
  for (const side of [-1, 1]) {
    const x = side * HALF_WIDTH;
    parts.push(box(0.07, 0.62, length, x, FLOOR_Y + 0.31, midZ, PANEL));
    parts.push(box(0.07, 0.5, length, x, ROOF_Y - 0.25, midZ, PANEL));
    // waist rail, lower kick strip and stamped panel dividers
    parts.push(box(0.085, 0.055, length - 0.4, x - side * 0.012, FLOOR_Y + 0.62, 0.1, 0x50483c));
    parts.push(box(0.085, 0.045, length - 0.4, x - side * 0.012, FLOOR_Y + 0.08, 0.1, 0x171511));
    for (let z = front + 0.72; z < back - 0.4; z += 0.82) {
      parts.push(box(0.085, 0.5, 0.018, x - side * 0.012, FLOOR_Y + 0.32, z, 0x171511));
    }
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
  // door frame, latch and yellow passenger grab handle
  parts.push(box(0.075, 1.72, 0.045, HALF_WIDTH - 0.07, FLOOR_Y + 1.02, front + 0.92, 0x4d463b));
  parts.push(box(0.075, 1.72, 0.045, HALF_WIDTH - 0.07, FLOOR_Y + 1.02, front + 1.78, 0x4d463b));
  parts.push(box(0.09, 0.18, 0.035, HALF_WIDTH - 0.12, FLOOR_Y + 1.0, front + 1.0, 0x8d742c));
  parts.push(box(0.055, 0.72, 0.055, HALF_WIDTH - 0.3, FLOOR_Y + 1.38, front + 1.82, 0xb28a30));

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

function decalTexture(text: string, background: string, foreground: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('could not create coach decal canvas');

  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#e1c977';
  context.fillRect(0, 4, canvas.width, 4);
  context.fillRect(0, canvas.height - 8, canvas.width, 4);
  context.fillStyle = foreground;
  context.font = 'bold 25px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

interface ExteriorWheel {
  /** The axle group retains its Z alignment while its local Y axis rolls the tyre. */
  readonly roll: THREE.Group;
  readonly steer: THREE.Group | null;
}

interface ExteriorDoorLeaf {
  readonly pivot: THREE.Group;
  /** The two leaves fold outwards in opposite directions from their outer hinges. */
  readonly openingDirection: number;
}

export class Cabin {
  readonly group = new THREE.Group();
  readonly dashboard: Dashboard;
  readonly mirror: Mirror;
  readonly leftMirror: Mirror;
  /** Where passengers are parented, so the roster never touches cabin structure. */
  readonly passengerRoot = new THREE.Group();

  private readonly domeLights: THREE.Mesh[] = [];
  private readonly mirrorTarget = new THREE.Vector3();
  private readonly leftMirrorTarget = new THREE.Vector3();
  private readonly leftMirrorCamera = new THREE.Vector3();
  private readonly exteriorWheels: ExteriorWheel[] = [];
  private readonly exteriorDoorLeaves: ExteriorDoorLeaf[] = [];
  private readonly brakeLampMaterials: THREE.ShaderMaterial[] = [];
  private readonly headlampMaterials: THREE.ShaderMaterial[] = [];
  private doorOpen = 0;
  private doorTarget = 0;

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
    this.group.add(shell, seats, this.buildExterior());

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

    // Keep the proven wide render surface. The previous portrait render target produced
    // a black sampled texture on the exterior glass on some WebGL implementations.
    this.leftMirror = new Mirror({ exterior: true });
    this.leftMirror.mesh.position.copy(LEFT_MIRROR_MOUNT);
    this.leftMirror.mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      EYE_LOCAL.clone().sub(LEFT_MIRROR_MOUNT).normalize(),
    );
    this.group.add(this.leftMirror.mesh);

    this.group.add(this.passengerRoot);
  }

  /**
   * Exterior coach body. The cabin used to be readable only as a box of interior panels
   * once the player stepped outside. This second skin gives it the broad painted panels,
   * dark glazing and heavy running gear of a late-70s route coach, while leaving every
   * inward-facing window surface culled so it cannot obstruct the driver's view.
   */
  private buildExterior(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'route-coach-exterior';

    const paintParts: THREE.BufferGeometry[] = [];
    const trimParts: THREE.BufferGeometry[] = [];
    const chromeParts: THREE.BufferGeometry[] = [];
    const glassMaterial = createRetroMaterial({
      color: 0x0d1820,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      snap: 0.25,
      ambientBoost: 0.7,
    });
    const add = (
      target: THREE.BufferGeometry[],
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      colour: number,
    ) => target.push(box(w, h, d, x, y, z, colour));

    const front = -BUS_LENGTH / 2;
    const back = BUS_LENGTH / 2;
    const sideX = 1.365;
    const addSideGlass = (side: number, width: number, height: number, y: number, z: number): void => {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), glassMaterial);
      pane.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      pane.position.set(side * (sideX + 0.082), y, z);
      root.add(pane);
    };

    // Long lower panels, waist stripe and roof cap turn the saloon shell into a painted
    // vehicle rather than an exposed room. The narrow dark belt also gives the livery a
    // recognisable silhouette at headlight range.
    for (const side of [-1, 1]) {
      const x = side * sideX;
      add(paintParts, 0.11, 0.84, BUS_LENGTH - 0.42, x, 1.17, 0, 0x34444d);
      add(paintParts, 0.1, 0.16, BUS_LENGTH - 0.5, x + side * 0.012, 1.53, 0, 0xd1c29d);
      add(paintParts, 0.108, 0.12, BUS_LENGTH - 0.48, x + side * 0.015, 0.83, 0, 0x26323a);
      add(trimParts, 0.13, 0.055, BUS_LENGTH - 0.4, x + side * 0.025, 0.64, 0, 0x121416);
      add(trimParts, 0.13, 0.06, BUS_LENGTH - 0.42, x + side * 0.024, 1.67, 0, 0x17191a);
      add(chromeParts, 0.045, 0.045, BUS_LENGTH - 0.7, x + side * 0.078, 1.46, 0, 0x9b9d93);

      // Individual tinted panes read clearly from outside. They sit outside the interior
      // wall and use front-face culling by default, making them invisible from the cabin.
      const paneZ = [-4.44, -3.18, -1.92, -0.66, 0.6, 1.86, 3.12, 4.38];
      if (side < 0) {
        // Driver's sliding window fills the otherwise blank bay ahead of the first saloon pane.
        addSideGlass(side, 0.62, 1.08, 2.24, -5.22);
        add(trimParts, 0.08, 1.2, 0.06, x + side * 0.085, 2.23, -5.55, 0x17191a);
        add(trimParts, 0.08, 1.2, 0.06, x + side * 0.085, 2.23, -4.89, 0x17191a);
      }
      for (const z of paneZ) {
        if (side > 0 && z < -3.75) continue; // passenger door occupies the front kerb bay
        addSideGlass(side, 1.05, 1.02, 2.24, z);
        add(trimParts, 0.08, 1.18, 0.06, x + side * 0.085, 2.23, z - 0.58, 0x17191a);
        add(trimParts, 0.08, 1.18, 0.06, x + side * 0.085, 2.23, z + 0.58, 0x17191a);
      }
      // A narrow rear quarter window closes the last dark gap before the emergency exit.
      addSideGlass(side, 0.62, 1.02, 2.24, 5.2);
      add(trimParts, 0.08, 1.18, 0.06, x + side * 0.085, 2.23, 4.85, 0x17191a);
      add(trimParts, 0.08, 1.18, 0.06, x + side * 0.085, 2.23, 5.55, 0x17191a);
      add(trimParts, 0.08, 0.07, BUS_LENGTH - 1.25, x + side * 0.08, 1.69, 0.15, 0x141618);
      add(trimParts, 0.08, 0.07, BUS_LENGTH - 1.25, x + side * 0.08, 2.82, 0.15, 0x141618);
    }

    // Roof rain gutter and the slightly proud front/rear caps make the body feel pressed
    // from separate steel panels instead of being one cuboid.
    add(paintParts, 2.78, 0.2, BUS_LENGTH - 0.1, 0, 3.18, 0, 0x2e3d45);
    add(trimParts, 0.06, 0.08, BUS_LENGTH - 0.22, -1.39, 3.1, 0, 0x151719);
    add(trimParts, 0.06, 0.08, BUS_LENGTH - 0.22, 1.39, 3.1, 0, 0x151719);
    add(paintParts, 2.7, 0.74, 0.16, 0, 1.16, front - 0.06, 0x374852);
    add(paintParts, 2.7, 0.26, 0.16, 0, 2.98, front - 0.06, 0x2d3d45);
    add(paintParts, 2.7, 0.74, 0.16, 0, 1.16, back + 0.06, 0x33434c);
    add(paintParts, 2.7, 0.26, 0.16, 0, 2.98, back + 0.06, 0x2c3b43);

    // Split windscreen and rear glass. These panes only render from the exterior-facing
    // side, preserving the unobstructed first-person windshield already in the cabin.
    for (const x of [-0.61, 0.61]) {
      const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), glassMaterial);
      windscreen.rotation.y = Math.PI;
      windscreen.position.set(x, 2.25, front - 0.15);
      root.add(windscreen);
      const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.04), glassMaterial);
      rearGlass.position.set(x, 2.23, back + 0.15);
      root.add(rearGlass);
    }
    add(trimParts, 0.085, 1.28, 0.07, 0, 2.25, front - 0.18, 0x151719);
    add(trimParts, 0.085, 1.24, 0.07, 0, 2.23, back + 0.18, 0x151719);
    for (const x of [-1.25, 1.25]) {
      add(trimParts, 0.11, 1.34, 0.07, x, 2.26, front - 0.18, 0x151719);
      add(trimParts, 0.11, 1.28, 0.07, x, 2.24, back + 0.18, 0x151719);
    }
    add(trimParts, 2.66, 0.08, 0.07, 0, 1.63, front - 0.18, 0x151719);
    add(trimParts, 2.66, 0.08, 0.07, 0, 2.88, front - 0.18, 0x151719);
    add(trimParts, 2.66, 0.08, 0.07, 0, 1.64, back + 0.18, 0x151719);
    add(trimParts, 2.66, 0.08, 0.07, 0, 2.82, back + 0.18, 0x151719);

    root.add(
      new THREE.Mesh(merged(paintParts, 'exterior paint'), createRetroMaterial({ vertexColors: true, snap: 0.45 })),
      new THREE.Mesh(merged(trimParts, 'exterior trim'), createRetroMaterial({ vertexColors: true, snap: 0.35 })),
      new THREE.Mesh(merged(chromeParts, 'exterior chrome'), createRetroMaterial({ vertexColors: true, snap: 0.22, ambientBoost: 1.18 })),
    );

    this.addCoachDoor(root, sideX, glassMaterial);
    this.addCoachLights(root, front, back);
    this.addCoachWheels(root);
    this.addCoachDecals(root, front, back);
    return root;
  }

  private addCoachDoor(root: THREE.Group, sideX: number, glassMaterial: THREE.ShaderMaterial): void {
    const panel = createRetroMaterial({ color: 0x34444d, snap: 0.32 });
    const trim = createRetroMaterial({ color: 0x151719, snap: 0.22 });
    const chrome = createRetroMaterial({ color: 0x9b9d93, snap: 0.16, ambientBoost: 1.15 });
    const stepLamp = createRetroMaterial({ color: 0xffb64a, mode: 'emissive', emissive: 0.9, snap: 0.12 });
    const outsideX = sideX + 0.11;

    // Stationary frame and sill stay with the body while the two leaves fold away from it.
    for (const z of [-5.54, -3.82]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.58, 0.065), trim);
      jamb.position.set(outsideX, 2.16, z);
      root.add(jamb);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 1.76), trim);
    header.position.set(outsideX, 2.93, -4.68);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 1.76), trim);
    sill.position.set(outsideX, 1.42, -4.68);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 1.52), trim);
    step.position.set(sideX + 0.28, 0.88, -4.68);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.32), stepLamp);
    lamp.position.set(sideX + 0.18, 1.02, -4.68);
    root.add(header, sill, step, lamp);

    const makeLeaf = (hingeZ: number, extension: number, openingDirection: number): void => {
      const pivot = new THREE.Group();
      pivot.position.set(outsideX, 2.16, hingeZ);
      const midZ = extension * 0.41;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.42, 0.82), panel);
      body.position.set(0, 0, midZ);
      const glazing = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.94), glassMaterial);
      glazing.rotation.y = Math.PI / 2;
      glazing.position.set(0.056, 0.16, midZ);
      const waist = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.075, 0.78), trim);
      waist.position.set(0.01, -0.26, midZ);
      const innerStile = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.33, 0.06), trim);
      innerStile.position.set(0.01, 0, hingeZ < -4.6 ? 0.79 : -0.79);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.21), chrome);
      handle.position.set(0.07, -0.08, midZ + extension * 0.24);
      pivot.add(body, glazing, waist, innerStile, handle);
      root.add(pivot);
      this.exteriorDoorLeaves.push({ pivot, openingDirection });
    };

    makeLeaf(-5.54, 1, 1);
    makeLeaf(-3.82, -1, -1);
  }

  private addCoachLights(root: THREE.Group, front: number, back: number): void {
    const housing = createRetroMaterial({ color: 0x161719, snap: 0.2 });
    const headlamp = createRetroMaterial({ color: 0xffe4ae, mode: 'emissive', emissive: 1.25, snap: 0.12 });
    const marker = createRetroMaterial({ color: 0xffa238, mode: 'emissive', emissive: 0.82, snap: 0.12 });
    const tail = createRetroMaterial({ color: 0xcd332b, mode: 'emissive', emissive: 0.72, snap: 0.12 });
    this.headlampMaterials.push(headlamp);
    this.brakeLampMaterials.push(tail);

    for (const x of [-0.94, 0.94]) {
      const surround = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.3, 0.07), housing);
      surround.position.set(x, 1.14, front - 0.175);
      root.add(surround);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.17, 0.022), headlamp);
      lens.position.set(x, 1.14, front - 0.222);
      root.add(lens);
    }
    // An inset grille and five bars give the flat front a believable diesel cooling bay.
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.32, 0.035), housing);
    grille.position.set(0, 0.98, front - 0.18);
    root.add(grille);
    const grilleBar = createRetroMaterial({ color: 0x73766f, snap: 0.16, ambientBoost: 1.08 });
    for (let y = 0.86; y <= 1.1; y += 0.06) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.018, 0.025), grilleBar);
      bar.position.set(0, y, front - 0.205);
      root.add(bar);
    }

    for (const x of [-1.14, 1.14]) {
      const sideMarker = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.025), marker);
      sideMarker.position.set(x, 2.96, front - 0.19);
      root.add(sideMarker);
      const rearLamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.025), tail);
      rearLamp.position.set(x, 1.18, back + 0.205);
      root.add(rearLamp);
      const rearMarker = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.025), marker);
      rearMarker.position.set(x, 2.96, back + 0.2);
      root.add(rearMarker);
    }

    const bumperMaterial = createRetroMaterial({ color: 0x777a76, snap: 0.2, ambientBoost: 1.22 });
    for (const z of [front - 0.18, back + 0.18]) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.16, 0.16), bumperMaterial);
      bumper.position.set(0, 0.68, z);
      root.add(bumper);
    }
  }

  private addCoachWheels(root: THREE.Group): void {
    const tyreMaterial = createRetroMaterial({ color: 0x101113, snap: 0.45, ambientBoost: 0.8 });
    const rimMaterial = createRetroMaterial({ color: 0x8d918e, snap: 0.18, ambientBoost: 1.2 });
    const hubMaterial = createRetroMaterial({ color: 0x363a3b, snap: 0.16, ambientBoost: 1.1 });
    const flapMaterial = createRetroMaterial({ color: 0x121314, snap: 0.3 });

    for (const z of [-3.72, 3.72]) {
      for (const side of [-1, 1]) {
        const steering = new THREE.Group();
        steering.position.set(side * 1.4, COACH_WHEEL_RADIUS + 0.03, z);
        const roll = new THREE.Group();
        roll.rotation.z = Math.PI / 2;
        steering.add(roll);

        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(COACH_WHEEL_RADIUS, COACH_WHEEL_RADIUS, 0.25, 12), tyreMaterial);
        roll.add(tyre);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.265, 10), rimMaterial);
        rim.position.y = side * 0.014;
        roll.add(rim);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.282, 10), hubMaterial);
        hub.position.y = side * 0.03;
        roll.add(hub);
        // A faceted ring is cheap but keeps the hub from reading as a flat grey coin.
        for (let spoke = 0; spoke < 5; spoke++) {
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.292, 6), hubMaterial);
          const angle = (spoke / 5) * Math.PI * 2;
          bolt.position.set(Math.cos(angle) * 0.19, side * 0.035, Math.sin(angle) * 0.19);
          roll.add(bolt);
        }
        root.add(steering);
        this.exteriorWheels.push({ roll, steer: z < 0 ? steering : null });

        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.38), flapMaterial);
        flap.position.set(side * 1.38, 0.43, z + 0.58);
        root.add(flap);
      }
    }
  }

  private addCoachDecals(root: THREE.Group, front: number, back: number): void {
    const sideDecal = createRetroMaterial({
      map: decalTexture('ROUTE 17  ·  NIGHT LINE', '#21313a', '#e7d9b4'),
      snap: 0.14,
      ambientBoost: 1.12,
    });
    for (const side of [-1, 1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.28), sideDecal);
      decal.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      decal.position.set(side * 1.43, 1.26, 0.95);
      root.add(decal);
    }

    const plate = createRetroMaterial({
      map: decalTexture('N 17', '#d8d1b9', '#17202a'),
      snap: 0.1,
      ambientBoost: 1.2,
    });
    for (const z of [front - 0.235, back + 0.235]) {
      const license = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.16), plate);
      if (z < 0) license.rotation.y = Math.PI;
      license.position.set(0, 0.79, z);
      root.add(license);
    }
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

  /** Keep the exterior's mechanical details coupled to the driving model. */
  setExteriorMotion(distance: number, steering: number, braking: number, highBeam: boolean): void {
    const rotation = distance / COACH_WHEEL_RADIUS;
    for (const wheel of this.exteriorWheels) {
      wheel.roll.rotation.y = rotation;
      if (wheel.steer) wheel.steer.rotation.y = steering * 0.42;
    }
    for (const lamp of this.brakeLampMaterials) {
      lamp.uniforms.uEmissive.value = braking > 0.05 ? 2.1 : 0.72;
    }
    for (const lamp of this.headlampMaterials) {
      lamp.uniforms.uEmissive.value = highBeam ? 2.1 : 1.25;
    }
  }

  /** Request the folding passenger door to open for an exterior stop or close for departure. */
  setDoorOpen(open: boolean): void {
    this.doorTarget = open ? 1 : 0;
  }

  /** Smooth door movement is kept here with the body, rather than in interaction logic. */
  updateExterior(dt: number): void {
    this.doorOpen += (this.doorTarget - this.doorOpen) * (1 - Math.exp(-dt * 7));
    for (const leaf of this.exteriorDoorLeaves) {
      leaf.pivot.rotation.y = leaf.openingDirection * this.doorOpen * 1.22;
    }
  }

  /** Aim the mirror down the aisle at head height and hand back its world position. */
  aimMirror(): THREE.Vector3 {
    this.mirrorTarget.set(0, FLOOR_Y + 0.95, 5.6);
    this.group.localToWorld(this.mirrorTarget);
    this.mirror.aim(this.group, this.mirrorTarget);
    return this.mirror.worldPosition;
  }

  /** Aim the exterior glass down the left side of the coach and behind it, never through the cabin. */
  aimLeftMirror(): THREE.Vector3 {
    // Keep the sightline just outside the body and let it meet the road behind. The old
    // short, strongly outward aim landed entirely in the unlit desert, which looked like
    // an empty black texture at the beginning of the shift.
    this.leftMirrorTarget.set(-1.62, FLOOR_Y + 0.5, 20);
    this.group.localToWorld(this.leftMirrorTarget);
    // The optical viewpoint sits slightly outside the housing. Keeping it at the glass
    // put the near half of its narrow portrait FOV into the opaque coach side panel.
    this.leftMirrorCamera.set(-2.02, 2.22, -5.35);
    this.group.localToWorld(this.leftMirrorCamera);
    this.leftMirror.aim(this.group, this.leftMirrorTarget, this.leftMirrorCamera);
    return this.leftMirror.worldPosition;
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
