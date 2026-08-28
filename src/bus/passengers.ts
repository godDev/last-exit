import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../render/retroMaterial';
import { seatPosition, FLOOR_Y } from './interior';
import { setVisibility } from './mirror';
import { NORA_RED_LOOK, type PassengerLookId } from '../content/passengerLooks';

/** Low-poly people: human silhouettes and readable faces without losing the retro style. */

export type Presence = 'both' | 'cabin' | 'mirror' | 'nowhere';

export interface PassengerSpec {
  id: string;
  /** Row 0 is directly behind the driver's bulkhead. */
  row: number;
  side: -1 | 1;
  coat: number;
  boarded?: number;
  look?: PassengerLookId;
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

export function passengerAppearanceSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function cabinMaterial(color: number, ambientBoost = 3): THREE.ShaderMaterial {
  return createRetroMaterial({ color, fogScale: 0, ambientBoost, cabin: 1, snap: 0.14 });
}

interface StandingRig {
  readonly root: THREE.Group;
  readonly torso: THREE.Group;
  readonly leftArm: THREE.Group;
  readonly rightArm: THREE.Group;
  readonly leftThigh: THREE.Group;
  readonly rightThigh: THREE.Group;
  readonly leftShin: THREE.Group;
  readonly rightShin: THREE.Group;
}

function standingRig(spec: PassengerSpec, variation: number, skinColor: number, hairColor: number): StandingRig {
  const isNora = spec.look === NORA_RED_LOOK.id;
  const root = new THREE.Group();
  root.name = `${spec.id}-articulated-boarding-figure`;
  const clothes = cabinMaterial(isNora ? NORA_RED_LOOK.dress : spec.coat, 3.1);
  const skin = cabinMaterial(isNora ? NORA_RED_LOOK.skin : skinColor, 3.35);
  const hair = cabinMaterial(isNora ? NORA_RED_LOOK.hair : hairColor, isNora ? 3.25 : 2.5);
  const shoes = cabinMaterial(isNora ? NORA_RED_LOOK.shoes : 0x151414, 2.25);
  const trim = cabinMaterial(0x24211d, 2.4);
  const torso = new THREE.Group();
  torso.position.y = 0.88;
  root.add(torso);

  const coatBody = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.68, 10), clothes);
  coatBody.position.y = 0.32;
  coatBody.scale.z = 0.78;
  torso.add(coatBody);
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 6), clothes);
  shoulders.position.y = 0.58;
  shoulders.scale.set(1.12, 0.55, 0.78);
  torso.add(shoulders);
  // Collar and vertical seam keep the coat readable when the passenger turns in the aisle.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.024, 6, 12, Math.PI * 1.45), trim);
  collar.position.set(0, 0.66, -0.095);
  collar.rotation.x = Math.PI / 2;
  torso.add(collar);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.48, 0.012), trim);
  seam.position.set(0, 0.27, -0.225);
  torso.add(seam);

  if (isNora) {
    coatBody.scale.set(0.88, 0.9, 0.69);
    coatBody.position.y = 0.37;
    shoulders.scale.set(0.98, 0.46, 0.72);
    collar.visible = false;
    seam.visible = false;
    // A fitted bodice and flared knee-length skirt create a clear red-dress silhouette.
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.205, 0.35, 12), clothes);
    waist.position.set(0, 0.28, 0);
    waist.scale.z = 0.76;
    torso.add(waist);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.34, 0.54, 12), clothes);
    skirt.position.set(0, -0.05, 0.015);
    skirt.scale.z = 0.8;
    torso.add(skirt);
    for (const side of [-1, 1]) {
      // The contour shares the exact bodice material: form comes from light, not a colour patch.
      const contour = new THREE.Mesh(new THREE.SphereGeometry(0.098, 14, 9), clothes);
      contour.scale.set(0.92, 0.67, 0.44);
      contour.position.set(side * 0.078, 0.51, -0.132);
      torso.add(contour);
    }
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.018, 6, 16), cabinMaterial(NORA_RED_LOOK.dressShadow, 3));
    belt.rotation.x = Math.PI / 2;
    belt.scale.z = 0.74;
    belt.position.y = 0.2;
    torso.add(belt);
    const neckline = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 7, 20, Math.PI), cabinMaterial(NORA_RED_LOOK.skin, 3.2));
    neckline.position.set(0, 0.655, -0.145);
    neckline.rotation.set(Math.PI / 2, 0, Math.PI);
    neckline.scale.y = 0.72;
    torso.add(neckline);
    const centreSeam = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.38, 0.009), cabinMaterial(NORA_RED_LOOK.dressShadow, 2.9));
    centreSeam.position.set(0, 0.38, -0.195);
    torso.add(centreSeam);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.13, 8), skin);
  neck.position.y = 0.72;
  torso.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.91;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 11, 8), skin);
  skull.scale.set(0.9 + (variation % 5) * 0.025, 1.12, 0.92);
  head.add(skull);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.153, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.58), hair);
  hairCap.position.y = 0.025;
  hairCap.scale.set(0.94, 1.03 + ((variation >>> 5) % 4) * 0.04, 0.95);
  head.add(hairCap);
  if (isNora) {
    // Long pale locks frame the same face seen at the stop and later above the seat.
    for (const side of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.043, 0.35, 4, 8), hair);
      lock.position.set(side * 0.125, -0.13, 0.025);
      lock.rotation.z = side * 0.1;
      head.add(lock);
    }
    const backHair = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 4, 9), hair);
    backHair.position.set(0, -0.14, 0.095);
    backHair.scale.x = 1.35;
    head.add(backHair);
    const roots = new THREE.Mesh(
      new THREE.SphereGeometry(0.154, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.28),
      cabinMaterial(NORA_RED_LOOK.hairRoot, 2.75),
    );
    roots.position.y = 0.035;
    roots.scale.set(0.94, 1.02, 0.95);
    head.add(roots);
    for (const side of [-1, 1]) {
      const highlight = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.29, 3, 6), cabinMaterial(NORA_RED_LOOK.hairHighlight, 3.1));
      highlight.position.set(side * 0.105, -0.13, -0.018);
      highlight.rotation.z = side * 0.1;
      head.add(highlight);
    }
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 6), skin);
    chin.scale.set(0.92, 0.48, 0.65);
    chin.position.set(0, -0.112, -0.055);
    head.add(chin);
  }
  if ((variation & 3) === 0) {
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.035), hair);
    fringe.position.set(0, 0.08, -0.13);
    fringe.rotation.z = -0.08;
    head.add(fringe);
  }
  const eyeWhite = cabinMaterial(0xbeb39d, 2.45);
  const pupil = cabinMaterial(isNora ? NORA_RED_LOOK.eyes : 0x17120f, 2.45);
  for (const side of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 5), eyeWhite);
    white.scale.set(1.08, 0.54, 0.38);
    white.position.set(side * 0.052, 0.015, -0.134);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 7, 4), pupil);
    iris.scale.z = 0.38;
    iris.position.set(side * 0.052, 0.015, -0.151);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.053, 0.009, 0.009), hair);
    brow.position.set(side * 0.052, 0.065, -0.14);
    brow.rotation.z = side * ((((variation >>> 10) % 7) - 3) * 0.025);
    head.add(white, iris, brow);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.06, 7), skin);
  nose.position.set(0, -0.025, -0.148);
  nose.rotation.x = -Math.PI / 2;
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(isNora ? 0.074 : 0.067, isNora ? 0.014 : 0.01, 0.009), cabinMaterial(isNora ? NORA_RED_LOOK.lips : 0x643b35, 3));
  mouth.position.set(0, -0.085, -0.142);
  head.add(nose, mouth);

  const makeArm = (side: -1 | 1): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.255, 0.58, 0);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(isNora ? 0.053 : 0.064, 0.35, 4, 7), isNora ? skin : clothes);
    sleeve.position.y = -0.22;
    arm.add(sleeve);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), skin);
    hand.position.set(0, -0.48, -0.015);
    hand.scale.set(0.82, 1.15, 0.72);
    arm.add(hand);
    torso.add(arm);
    return arm;
  };
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  const makeLeg = (side: -1 | 1): { thigh: THREE.Group; shin: THREE.Group } => {
    const thigh = new THREE.Group();
    thigh.position.set(side * 0.115, 0.9, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(isNora ? 0.064 : 0.078, 0.32, 4, 7), isNora ? skin : clothes);
    upper.position.y = -0.22;
    thigh.add(upper);
    const shin = new THREE.Group();
    shin.position.y = -0.46;
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(isNora ? 0.058 : 0.065, 0.32, 4, 7), isNora ? skin : clothes);
    lower.position.y = -0.22;
    shin.add(lower);
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 5), shoes);
    shoe.position.set(0, -0.45, -0.075);
    shoe.scale.set(0.9, 0.58, 1.48);
    shin.add(shoe);
    thigh.add(shin);
    root.add(thigh);
    return { thigh, shin };
  };
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  // Deterministic personal accessories are part of the saved visual identity.
  if (!isNora && (variation & 1) === 0) {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.14), cabinMaterial(0x30261f, 2.6));
    bag.position.set(0.31, 0.82, 0.05);
    bag.rotation.z = -0.08;
    root.add(bag);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 6, 12, Math.PI), trim);
    strap.position.set(0.2, 1.18, 0.02);
    strap.rotation.z = -0.35;
    root.add(strap);
  } else if (!isNora && (variation & 7) === 3) {
    const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.42, 0.035), cabinMaterial(0x5b3b32, 3));
    scarf.position.set(0.04, 1.35, -0.18);
    scarf.rotation.z = -0.06;
    root.add(scarf);
  }

  root.scale.set(isNora ? 0.98 : 0.94 + (variation % 9) * 0.01, isNora ? 1.035 : 0.96 + ((variation >>> 8) % 8) * 0.01, 1);
  root.visible = false;
  return { root, torso, leftArm, rightArm, leftThigh: leftLeg.thigh, rightThigh: rightLeg.thigh, leftShin: leftLeg.shin, rightShin: rightLeg.shin };
}

export class Passenger {
  readonly object = new THREE.Group();
  readonly spec: PassengerSpec;
  sway = 1;
  eyeshine = 0;

  private readonly shine: THREE.Mesh;
  private readonly phase: number;
  private readonly basePosition = new THREE.Vector3();
  private readonly seatedFigure: THREE.Group;
  private readonly standing: StandingRig;
  private presence: Presence = 'both';
  private boarding = false;

  constructor(
    spec: PassengerSpec,
    clothesGeometry: THREE.BufferGeometry,
    skinGeometry: THREE.BufferGeometry,
    hairGeometry: THREE.BufferGeometry,
    shoesGeometry: THREE.BufferGeometry,
    appearanceSeed = passengerAppearanceSeed(spec.id),
  ) {
    this.spec = spec;
    const variation = appearanceSeed;
    this.phase = (spec.row * 1.7 + (spec.side + 1) * 0.9) % 6.283;

    const isNora = spec.look === NORA_RED_LOOK.id;
    const skinTones = [0x916d56, 0x76513f, 0xa77b5e, 0x654638, 0x8a6048];
    const hairTones = [0x171412, 0x2a211b, 0x3a2b20, 0x5a493c, 0x242328];
    const figure = new THREE.Group();
    const selectedSkin = isNora ? NORA_RED_LOOK.skin : skinTones[variation % skinTones.length];
    const selectedHair = isNora ? NORA_RED_LOOK.hair : hairTones[(variation >>> 4) % hairTones.length];
    figure.add(
      new THREE.Mesh(clothesGeometry, cabinMaterial(isNora ? NORA_RED_LOOK.dress : spec.coat)),
      new THREE.Mesh(skinGeometry, cabinMaterial(selectedSkin, 3.35)),
      new THREE.Mesh(hairGeometry, cabinMaterial(selectedHair, isNora ? 3.25 : 2.5)),
      new THREE.Mesh(shoesGeometry, cabinMaterial(isNora ? NORA_RED_LOOK.shoes : 0x171717, 2.2)),
    );

    if (isNora) {
      const red = cabinMaterial(NORA_RED_LOOK.dress, 3.15);
      const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.235, 0.47, 12), red);
      bodice.position.set(0, 0.99, 0.005);
      bodice.scale.z = 0.74;
      figure.add(bodice);
      for (const side of [-1, 1]) {
        const contour = new THREE.Mesh(new THREE.SphereGeometry(0.098, 14, 9), red);
        contour.scale.set(0.9, 0.65, 0.43);
        contour.position.set(side * 0.077, 1.115, -0.132);
        figure.add(contour);
      }
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.31, 0.5, 12), red);
      skirt.position.set(0, 0.68, -0.03);
      skirt.rotation.x = 0.2;
      skirt.scale.z = 0.82;
      figure.add(skirt);
      const hairMat = cabinMaterial(NORA_RED_LOOK.hair, 3.25);
      const hairShadow = cabinMaterial(NORA_RED_LOOK.hairShadow, 2.8);
      for (const side of [-1, 1]) {
        const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.043, 0.32, 4, 8), hairMat);
        lock.position.set(side * 0.128, 1.38, 0.01);
        lock.rotation.z = side * 0.08;
        figure.add(lock);
        const lowlight = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.27, 3, 6), hairShadow);
        lowlight.position.set(side * 0.11, 1.37, 0.018);
        lowlight.rotation.z = side * 0.08;
        figure.add(lowlight);
      }
      const roots = new THREE.Mesh(new THREE.SphereGeometry(0.153, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.27), cabinMaterial(NORA_RED_LOOK.hairRoot, 2.8));
      roots.position.set(0, 1.515, 0.012);
      roots.scale.set(0.92, 1.03, 0.94);
      figure.add(roots);
      const neckline = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.011, 7, 20, Math.PI), cabinMaterial(NORA_RED_LOOK.skin, 3.2));
      neckline.position.set(0, 1.205, -0.15);
      neckline.rotation.set(Math.PI / 2, 0, Math.PI);
      neckline.scale.y = 0.72;
      figure.add(neckline);
    }

    // A small but complete face. At normal driving distance these merge into a believable
    // expression; during a mirror glance the separate sclerae, pupils, brows and mouth
    // remain readable instead of becoming the old single dark stripe.
    const face = new THREE.Group();
    const eyeWhite = cabinMaterial(0xd2c6ad, 3.8);
    const pupil = cabinMaterial(isNora ? NORA_RED_LOOK.eyes : 0x17120f, 2.5);
    const feature = cabinMaterial(selectedHair, 2.8);
    const lipTones = [0x603b36, 0x70433d, 0x53342f, 0x76473f];
    const lips = cabinMaterial(isNora ? NORA_RED_LOOK.lips : lipTones[(variation >>> 7) % lipTones.length], 3.1);
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
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.038, 7, 4), cabinMaterial(selectedSkin, 3.1));
    chin.scale.set(1.1, 0.38, 0.5);
    chin.position.set(0, 1.35, -0.126);
    face.add(chin);
    face.scale.x = isNora ? 0.94 : 0.9 + ((variation >>> 18) % 9) * 0.025;
    figure.add(face);

    this.shine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.098, 0.014),
      createRetroMaterial({ color: 0xfff2d0, mode: 'emissive', emissive: 0, snap: 0.1 }),
    );
    this.shine.position.set(0, 1.495, -0.158);
    this.shine.rotation.y = Math.PI;
    figure.add(this.shine);

    // Small deterministic differences keep a row of passengers from looking cloned.
    figure.scale.set(isNora ? 0.98 : 0.94 + (variation % 9) * 0.01, isNora ? 1.035 : 0.96 + ((variation >>> 8) % 8) * 0.01, 1);
    figure.rotation.y = isNora ? 0 : (((variation >>> 12) % 9) - 4) * 0.018;
    this.seatedFigure = figure;
    this.standing = standingRig(spec, variation, selectedSkin, selectedHair);
    this.object.add(figure);
    this.object.add(this.standing.root);

    this.basePosition.copy(seatPosition(spec.row, spec.side));
    this.basePosition.y = FLOOR_Y + 0.5;
    this.object.position.copy(this.basePosition);
  }

  setPresence(where: Presence): void {
    this.presence = where;
    setVisibility(this.object, where);
  }

  get where(): Presence { return this.presence; }

  get seat(): THREE.Vector3 { return this.basePosition.clone(); }

  startBoarding(position: THREE.Vector3): void {
    this.boarding = true;
    this.setPresence('both');
    this.object.position.copy(position);
    this.object.rotation.set(0, 0, 0);
    this.seatedFigure.visible = false;
    this.standing.root.visible = true;
  }

  setBoardingPose(position: THREE.Vector3, yaw: number, gait: number, sit: number): void {
    this.object.position.copy(position);
    this.object.rotation.set(0, yaw, 0);
    const stride = Math.sin(gait * Math.PI * 2);
    const liftLeft = Math.max(0, Math.sin(gait * Math.PI * 2));
    const liftRight = Math.max(0, -Math.sin(gait * Math.PI * 2));
    this.standing.leftArm.rotation.x = -stride * 0.42 * (1 - sit);
    this.standing.rightArm.rotation.x = stride * 0.42 * (1 - sit);
    this.standing.leftThigh.rotation.x = stride * 0.48 + sit * 1.15;
    this.standing.rightThigh.rotation.x = -stride * 0.48 + sit * 1.15;
    this.standing.leftShin.rotation.x = -liftLeft * 0.72 - sit * 1.0;
    this.standing.rightShin.rotation.x = -liftRight * 0.72 - sit * 1.0;
    this.standing.torso.rotation.x = sit * 0.16;
    this.standing.torso.rotation.z = stride * 0.018 * (1 - sit);
    this.standing.root.position.y = Math.abs(stride) * 0.018 * (1 - sit) - sit * 0.46;
  }

  finishBoarding(): void {
    this.boarding = false;
    this.standing.root.visible = false;
    this.seatedFigure.visible = true;
    this.object.position.copy(this.basePosition);
    this.object.rotation.set(0, 0, 0);
  }

  update(elapsed: number, lean: number): void {
    if (this.boarding) {
      (this.shine.material as THREE.ShaderMaterial).uniforms.uEmissive.value = this.eyeshine;
      return;
    }
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

  board(spec: Omit<PassengerSpec, 'coat'> & { coat?: number }, appearanceSeed?: number): Passenger {
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
      appearanceSeed,
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
