import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../render/retroMaterial';
import { canvasTexture, mileMarkerTexture, signTexture } from '../render/textures';
import { hash1 } from '../core/rng';
import { RoutePath, STATION_SPACING, terrainAt } from './curvature';
import { METRES_PER_MILE } from '../core/units';
import { STORY_MILES } from './stops';

/**
 * Everything standing beside the road.
 *
 * Two rules keep this cheap. First, what exists at station N is a pure function of N and
 * the seed, so nothing has to be stored or saved — drive back and the same fence is there.
 * Second, props are only populated as far as the fog allows (about 320 m), not as far as
 * the road mesh reaches, and objects are parked and reused rather than created and thrown
 * away. The object count in the debug panel should sit flat all night.
 */

export const PROP_BEHIND = 4;
export const PROP_AHEAD = 16;

type Kind = 'pole' | 'delineator' | 'fence' | 'scrub' | 'scatter' | 'mile' | 'sign';

interface Slot {
  kind: Kind;
  object: THREE.Object3D;
  free: boolean;
  /** Set when the slot carries per-instance artwork. */
  texture?: THREE.CanvasTexture;
  label?: string;
  /** Knocked roadside furniture stays in the world but must no longer block the coach. */
  knocked: boolean;
  fallElapsed: number;
  fallStart: THREE.Quaternion;
  fallTarget: THREE.Quaternion;
}

export interface PropCollision {
  normal: THREE.Vector3;
  penetration: number;
  kind: Kind;
  object: THREE.Object3D;
}

const COLLIDER_RADIUS: Partial<Record<Kind, number>> = {
  pole: 0.28,
  delineator: 0.13,
  scrub: 0.72,
  mile: 0.28,
  sign: 0.72,
};

/**
 * Attach a flat vertex colour so parts can be merged into one draw call.
 *
 * Also drops the index. three's primitives disagree about that — boxes and cylinders come
 * out indexed, the polyhedra do not — and mergeGeometries silently returns null for a
 * mixed list, which surfaces much later as a missing geometry.
 */
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

function at(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

/** mergeGeometries returns null on mismatched inputs; fail loudly instead. */
function merge(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error(`could not merge geometry for "${what}"`);
  return merged;
}

// --- shared geometry ---------------------------------------------------------

function buildPole(): THREE.BufferGeometry {
  const trunk = at(tint(new THREE.CylinderGeometry(0.12, 0.19, 9.4, 5), 0x2c2118), 0, 4.7, 0);
  const arm = at(tint(new THREE.BoxGeometry(2.1, 0.14, 0.14), 0x2c2118), 0, 8.5, 0);
  const brace = at(tint(new THREE.BoxGeometry(0.9, 0.1, 0.1), 0x2c2118), 0, 8.0, 0);
  brace.rotateZ(0.5);
  const glassL = at(tint(new THREE.BoxGeometry(0.16, 0.2, 0.16), 0x3a4038), -0.85, 8.7, 0);
  const glassR = at(tint(new THREE.BoxGeometry(0.16, 0.2, 0.16), 0x3a4038), 0.85, 8.7, 0);
  return merge([trunk, arm, brace, glassL, glassR], 'pole');
}

function buildDelineator(): THREE.BufferGeometry {
  const post = at(tint(new THREE.BoxGeometry(0.075, 1.05, 0.075), 0x6b6355), 0, 0.52, 0);
  // Albedo well above 1: a retroreflector throws the beam straight back, so it should
  // blow out to white when the headlights find it and be invisible the rest of the time.
  const face = at(tint(new THREE.BoxGeometry(0.1, 0.17, 0.03), 0xffffff), 0, 0.9, 0.05);
  const merged = merge([post, face], 'delineator');
  const colours = merged.attributes.color as THREE.BufferAttribute;
  const start = post.attributes.position.count;
  for (let i = start; i < colours.count; i++) colours.setXYZ(i, 5.5, 3.6, 0.7);
  return merged;
}

function buildFenceSection(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    parts.push(
      at(tint(new THREE.BoxGeometry(0.09, 1.3, 0.09), 0x33291d), 0, 0.65, i * (STATION_SPACING / 3)),
    );
  }
  for (const y of [0.5, 0.85, 1.18]) {
    parts.push(
      at(
        tint(new THREE.BoxGeometry(0.025, 0.025, STATION_SPACING), 0x3d3428),
        0,
        y,
        STATION_SPACING / 2,
      ),
    );
  }
  return merge(parts, 'fence');
}

function buildSaguaro(): THREE.BufferGeometry {
  const colour = 0x2c3f24;
  const trunkHeight = 4.2;
  const trunkTopRadius = 0.25;
  const parts: THREE.BufferGeometry[] = [
    at(tint(new THREE.CylinderGeometry(trunkTopRadius, 0.32, trunkHeight, 8), colour), 0, trunkHeight / 2, 0),
    // A domed cap keeps the trunk from ending in an obviously flat, cut-off cylinder top.
    at(tint(new THREE.SphereGeometry(trunkTopRadius, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), colour), 0, trunkHeight, 0),
  ];

  // Each arm is an elbow that leans out from the trunk, then a tip that curves most of
  // the way back to vertical. Both segments are built at the origin, rotated, and only
  // then translated into place — rotating a cylinder that had already been translated
  // away from the origin used to spin the whole arm around the plant's root instead of
  // tilting it, flinging it off to the side and leaving it looking disconnected.
  const addArm = (
    side: -1 | 1,
    attachHeight: number,
    lean: number,
    elbowLength: number,
    tipLength: number,
  ): THREE.BufferGeometry[] => {
    const attachX = side * 0.24;
    const elbowAngle = -side * lean;

    const elbow = tint(new THREE.CylinderGeometry(0.1, 0.14, elbowLength, 6), colour);
    elbow.translate(0, elbowLength / 2, 0); // pivot at the elbow's own base
    elbow.rotateZ(elbowAngle);
    elbow.translate(attachX, attachHeight, 0); // then place that base on the trunk

    // The tip starts exactly where the elbow ends, computed from the same rotation
    // rather than a second, unrelated offset that could drift apart from it.
    const tipBaseX = attachX - Math.sin(elbowAngle) * elbowLength;
    const tipBaseY = attachHeight + Math.cos(elbowAngle) * elbowLength;
    const tipAngle = elbowAngle * 0.3;

    const tip = tint(new THREE.CylinderGeometry(0.09, 0.11, tipLength, 6), colour);
    tip.translate(0, tipLength / 2, 0);
    tip.rotateZ(tipAngle);
    tip.translate(tipBaseX, tipBaseY, 0);

    const capX = tipBaseX - Math.sin(tipAngle) * tipLength;
    const capY = tipBaseY + Math.cos(tipAngle) * tipLength;
    const cap = at(tint(new THREE.SphereGeometry(0.095, 6, 4), colour), capX, capY, 0);

    return [elbow, tip, cap];
  };

  parts.push(...addArm(-1, 2.15, 0.62, 1.25, 1.05));
  parts.push(...addArm(1, 1.7, 0.58, 1.05, 1.2));
  return merge(parts, 'saguaro');
}

function buildBush(): THREE.BufferGeometry {
  const a = at(tint(new THREE.IcosahedronGeometry(0.85, 0), 0x1e2415), 0, 0.5, 0);
  a.scale(1, 0.55, 1);
  const b = at(tint(new THREE.IcosahedronGeometry(0.55, 0), 0x232a18), 0.7, 0.35, 0.4);
  b.scale(1, 0.6, 1);
  return merge([a, b], 'bush');
}

function buildJoshua(): THREE.BufferGeometry {
  const parts = [at(tint(new THREE.CylinderGeometry(0.2, 0.3, 2.6, 5), 0x2a2418), 0, 1.3, 0)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const limb = at(
      tint(new THREE.CylinderGeometry(0.1, 0.14, 1.4, 4), 0x2a2418),
      Math.cos(a) * 0.6,
      2.9,
      Math.sin(a) * 0.6,
    );
    limb.rotateZ(Math.cos(a) * 0.7);
    limb.rotateX(-Math.sin(a) * 0.7);
    parts.push(limb);
    const tuft = at(
      tint(new THREE.IcosahedronGeometry(0.42, 0), 0x1c2413),
      Math.cos(a) * 1.05,
      3.5,
      Math.sin(a) * 1.05,
    );
    parts.push(tuft);
  }
  return merge(parts, 'joshua');
}

function buildAgave(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 11; i++) {
    const angle = (i / 11) * Math.PI * 2;
    const blade = tint(new THREE.ConeGeometry(0.14, 1.15 + (i % 3) * 0.12, 4), i % 2 ? 0x26301d : 0x303923);
    blade.rotateZ(Math.PI * (0.25 + (i % 2) * 0.035));
    blade.rotateY(angle);
    blade.translate(Math.cos(angle) * 0.28, 0.38, Math.sin(angle) * 0.28);
    parts.push(blade);
  }
  return merge(parts, 'agave');
}

/** A whole patch of foreground detail in one draw call. */
function buildStoneScatter(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.399 + variant * 0.7;
    const radius = 0.5 + (i % 4) * 0.62;
    const size = 0.12 + ((i * 7 + variant) % 5) * 0.055;
    const stone = tint(new THREE.DodecahedronGeometry(size, 0), i % 3 === 0 ? 0x544331 : 0x403426);
    stone.scale(1.2 + (i % 2) * 0.5, 0.55 + (i % 3) * 0.16, 0.9);
    stone.rotateY(angle * 1.7);
    stone.translate(Math.cos(angle) * radius, size * 0.42, Math.sin(angle) * radius);
    parts.push(stone);
  }
  // Dry grass clumps add fine silhouettes between the stones.
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.17 + variant;
    const x = Math.cos(angle) * (0.7 + (i % 3) * 0.55);
    const z = Math.sin(angle) * (0.7 + (i % 3) * 0.55);
    for (let bladeIndex = -1; bladeIndex <= 1; bladeIndex++) {
      const blade = tint(new THREE.ConeGeometry(0.025, 0.38 + (i % 2) * 0.16, 3), 0x5b512c);
      blade.rotateZ(bladeIndex * 0.22);
      blade.translate(x + bladeIndex * 0.06, 0.2, z);
      parts.push(blade);
    }
  }
  if (variant === 2) {
    const branch = tint(new THREE.CylinderGeometry(0.035, 0.055, 2.2, 5), 0x302419);
    branch.rotateZ(Math.PI / 2.35);
    branch.translate(0.2, 0.22, 0.1);
    parts.push(branch);
  }
  return merge(parts, `stone scatter ${variant}`);
}

// --- the field ---------------------------------------------------------------

export class PropField {
  readonly group = new THREE.Group();
  private readonly slots = new Map<Kind, Slot[]>();
  private readonly active = new Map<string, Slot>();
  private readonly knockedStates = new Map<string, { direction: THREE.Vector3; normal: THREE.Vector3 }>();
  private readonly scrubVariants: THREE.BufferGeometry[];
  private readonly scatterVariants: THREE.BufferGeometry[];
  private lastFirst = Number.NaN;
  private readonly collisionNormal = new THREE.Vector3();

  /**
   * @param mileZero route distance, in metres, that the signage should call mile 0.
   */
  constructor(
    private readonly path: RoutePath,
    private readonly seed: number,
    private readonly mileZero = 0,
  ) {
    const vegetation = createRetroMaterial({ vertexColors: true, snap: 0.85 });
    const timber = createRetroMaterial({ vertexColors: true, snap: 0.85 });

    this.scrubVariants = [buildSaguaro(), buildBush(), buildJoshua(), buildAgave(), buildBush()];
    this.scatterVariants = [buildStoneScatter(0), buildStoneScatter(1), buildStoneScatter(2)];

    // one geometry per kind, shared by every instance of it
    const pole = buildPole();
    const delineator = buildDelineator();
    const fence = buildFenceSection();

    this.pool('pole', 9, () => new THREE.Mesh(pole, timber));
    this.pool('delineator', 46, () => new THREE.Mesh(delineator, timber));
    this.pool('fence', 16, () => new THREE.Mesh(fence, timber));
    this.pool('scrub', 44, () => new THREE.Mesh(this.scrubVariants[0], vegetation));
    this.pool('scatter', 72, () => new THREE.Mesh(this.scatterVariants[0], vegetation));
    this.pool('mile', 3, () => this.buildPlate(0.42, 0.84, 1.25));
    this.pool('sign', 4, () => this.buildPlate(1.5, 1.05, 2.2));
  }

  /** A post with a printed panel: mile markers and roadside signage share the shape. */
  private buildPlate(width: number, height: number, top: number): THREE.Object3D {
    const group = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, top, 0.09),
      createRetroMaterial({ color: 0x4a4438, snap: 0.85 }),
    );
    post.position.y = top / 2;
    group.add(post);

    const texture = canvasTexture(4, 4, (ctx) => {
      ctx.fillStyle = '#888';
      ctx.fillRect(0, 0, 4, 4);
    });
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      createRetroMaterial({ map: texture, snap: 0.85, side: THREE.DoubleSide }),
    );
    panel.position.y = top + height / 2 - 0.12;
    panel.name = 'panel';
    group.add(panel);
    group.userData.texture = texture;
    return group;
  }

  private pool(kind: Kind, count: number, make: () => THREE.Object3D): void {
    const list: Slot[] = [];
    for (let i = 0; i < count; i++) {
      const object = make();
      object.visible = false;
      object.frustumCulled = true;
      this.group.add(object);
      list.push({
        kind,
        object,
        free: true,
        knocked: false,
        fallElapsed: 0,
        fallStart: new THREE.Quaternion(),
        fallTarget: new THREE.Quaternion(),
      });
    }
    this.slots.set(kind, list);
  }

  private take(kind: Kind): Slot | null {
    const list = this.slots.get(kind)!;
    for (const slot of list) {
      if (slot.free) {
        slot.free = false;
        slot.knocked = false;
        slot.fallElapsed = 0;
        slot.object.visible = true;
        return slot;
      }
    }
    return null; // pool exhausted: the world quietly thins out rather than stuttering
  }

  /** Place a prop in the frame of the route at `index`, offset sideways and along. */
  private place(
    object: THREE.Object3D,
    index: number,
    lateral: number,
    along = 0,
    facing: 'road' | 'along' = 'road',
  ): boolean {
    const point = this.path.at(index);
    if (!point) return false;
    const rx = -Math.cos(point.heading);
    const rz = Math.sin(point.heading);
    const fx = Math.sin(point.heading);
    const fz = Math.cos(point.heading);

    object.position.set(
      point.x + rx * lateral + fx * along,
      point.y + terrainAt(point.index, lateral, this.seed) - 0.35,
      point.z + rz * lateral + fz * along,
    );
    // signs face oncoming traffic; fences and poles run with the road
    object.rotation.set(0, facing === 'road' ? point.heading + Math.PI : point.heading, 0);
    return true;
  }

  /** Rebuild the population. Cheap enough to run whenever the station window moves. */
  update(centre: number, force = false): void {
    const first = centre - PROP_BEHIND;
    if (!force && first === this.lastFirst) return;
    this.lastFirst = first;

    const last = centre + PROP_AHEAD;
    const wanted = new Set<string>();

    for (let i = first; i <= last; i++) {
      if (!this.path.at(i)) continue;

      // power line, one side only, every third station
      if (i % 3 === 0) wanted.add(`pole|${i}|0`);

      // delineators both sides of the travelled way
      wanted.add(`delineator|${i}|0`);
      wanted.add(`delineator|${i}|1`);

      // Barbed wire has a deliberate break at Miller's Gas; the forecourt must have a
      // drivable entrance rather than a procedural fence running through its pumps.
      if (!this.isMillersForecourt(i) && hash1(i, this.seed + 55) > 0.35) wanted.add(`fence|${i}|0`);

      // vegetation
      for (let s = 0; s < 3; s++) {
        if (hash1(i * 31 + s, this.seed + 700) > 0.52) wanted.add(`scrub|${i}|${s}`);
      }
      // Low field detail is denser than landmark vegetation, but each entry is a merged
      // patch of stones and grass rather than dozens of individual draw calls.
      for (let s = 0; s < 4; s++) {
        if (hash1(i * 43 + s, this.seed + 1700) > 0.27) wanted.add(`scatter|${i}|${s}`);
      }

      // mile markers, wherever a whole mile falls inside this station
      const d0 = i * STATION_SPACING;
      const d1 = d0 + STATION_SPACING;
      if (
        Math.floor((d0 - this.mileZero) / METRES_PER_MILE) !==
        Math.floor((d1 - this.mileZero) / METRES_PER_MILE)
      ) {
        wanted.add(`mile|${i}|0`);
      }

      // Occasional signage. Held back until dispatch has already named Mile 86 (see
      // mile86.warning in main.ts), so a background highway sign is never the player's
      // first hint of the number the dispatcher is about to say.
      const signMile = (d0 - this.mileZero) / METRES_PER_MILE;
      if (signMile > STORY_MILES.mile86 - 0.94 && hash1(i, this.seed + 909) > 0.965) wanted.add(`sign|${i}|0`);
    }

    // retire everything that fell out of range
    for (const [key, slot] of this.active) {
      if (!wanted.has(key)) {
        slot.free = true;
        slot.object.visible = false;
        this.active.delete(key);
      }
    }

    // and bring in what is new
    for (const key of wanted) {
      if (this.active.has(key)) continue;
      const [kind, indexText, slotText] = key.split('|');
      const index = Number(indexText);
      const sub = Number(slotText);
      const slot = this.take(kind as Kind);
      if (!slot) continue;
      if (!this.dress(slot, index, sub)) {
        slot.free = true;
        slot.object.visible = false;
        continue;
      }
      const knockedState = this.knockedStates.get(key);
      if (knockedState) {
        const shoveDistance = slot.kind === 'pole' ? 0.12 : 0.45;
        const normalDistance = slot.kind === 'pole' ? 0.08 : 0.28;
        slot.object.position.addScaledVector(knockedState.direction, shoveDistance);
        slot.object.position.addScaledVector(knockedState.normal, normalDistance);
        this.prepareFall(slot, knockedState.direction, true);
      }
      this.active.set(key, slot);
    }
  }

  /** Broad-phase and circle collision against only the small set of pooled active props. */
  collisionAt(position: THREE.Vector3, busRadius: number): PropCollision | null {
    let best: PropCollision | null = null;
    let deepest = 0;
    for (const slot of this.active.values()) {
      const baseRadius = COLLIDER_RADIUS[slot.kind];
      if (!baseRadius || !slot.object.visible || slot.knocked) continue;
      const radius = baseRadius * Math.max(slot.object.scale.x, slot.object.scale.z);
      const dx = position.x - slot.object.position.x;
      const dz = position.z - slot.object.position.z;
      const reach = busRadius + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;

      const distance = Math.sqrt(Math.max(d2, 0.0001));
      const penetration = reach - distance;
      if (penetration <= deepest) continue;
      deepest = penetration;
      this.collisionNormal.set(dx / distance, 0, dz / distance);
      best = { normal: this.collisionNormal.clone(), penetration, kind: slot.kind, object: slot.object };
    }
    return best;
  }

  /**
   * Small roadside furniture should yield to a forty-thousand-pound coach. The pooled
   * object remains visible where it fell, then is reset when it leaves the population window.
   */
  knockDown(hit: PropCollision, direction: THREE.Vector3): boolean {
    if (hit.kind !== 'pole' && hit.kind !== 'delineator' && hit.kind !== 'mile' && hit.kind !== 'sign') return false;
    const activeEntry = [...this.active.entries()].find(([, candidate]) => candidate.object === hit.object);
    const slot = activeEntry?.[1];
    if (!slot || slot.knocked) return false;
    const shove = direction.clone().setY(0).normalize();
    if (activeEntry) this.knockedStates.set(activeEntry[0], { direction: shove.clone(), normal: hit.normal.clone() });
    hit.object.position.addScaledVector(shove, hit.kind === 'pole' ? 0.12 : 0.45);
    hit.object.position.addScaledVector(hit.normal, hit.kind === 'pole' ? 0.08 : 0.28);
    this.prepareFall(slot, shove, false);
    return true;
  }

  private prepareFall(slot: Slot, shove: THREE.Vector3, complete: boolean): void {
    slot.knocked = true;
    const duration = slot.kind === 'pole' ? 1.2 : 0.72;
    slot.fallElapsed = complete ? duration : 0;
    slot.fallStart.copy(slot.object.quaternion);
    const axis = new THREE.Vector3(shove.z, 0, -shove.x).normalize();
    const fall = new THREE.Quaternion().setFromAxisAngle(
      axis,
      slot.kind === 'pole' ? Math.PI * 0.48 : Math.PI * 0.43,
    );
    slot.fallTarget.copy(fall).multiply(slot.fallStart);
    if (complete) slot.object.quaternion.copy(slot.fallTarget);
  }

  /** Animate knocked furniture around its ground-level geometry anchor. */
  animate(dt: number): void {
    for (const slot of this.active.values()) {
      if (!slot.knocked) continue;
      slot.fallElapsed += dt;
      const duration = slot.kind === 'pole' ? 1.2 : 0.72;
      const t = THREE.MathUtils.smoothstep(slot.fallElapsed, 0, duration);
      slot.object.quaternion.copy(slot.fallStart).slerp(slot.fallTarget, t);
    }
  }

  private dress(slot: Slot, index: number, sub: number): boolean {
    switch (slot.kind) {
      case 'pole':
        return this.place(slot.object, index, -11.5, 0, 'along');

      case 'delineator':
        return this.place(slot.object, index, sub === 0 ? 4.25 : -4.25, 0, 'road');

      case 'fence':
        return this.place(slot.object, index, 13.5, 0, 'along');

      case 'scrub': {
        const mesh = slot.object as THREE.Mesh;
        const pick = hash1(index * 91 + sub, this.seed + 12);
        mesh.geometry = this.scrubVariants[Math.floor(pick * this.scrubVariants.length)];
        const side = hash1(index * 13 + sub, this.seed + 31) > 0.5 ? 1 : -1;
        const lateral = side * (9 + hash1(index * 7 + sub, this.seed + 44) * 42);
        const along = hash1(index * 5 + sub, this.seed + 88) * STATION_SPACING;
        const ok = this.place(slot.object, index, lateral, along, 'along');
        const scale = 0.7 + hash1(index * 3 + sub, this.seed + 21) * 0.7;
        slot.object.scale.setScalar(scale);
        slot.object.rotation.y = hash1(index + sub, this.seed + 5) * Math.PI * 2;
        return ok;
      }

      case 'scatter': {
        const mesh = slot.object as THREE.Mesh;
        const pick = hash1(index * 113 + sub, this.seed + 812);
        mesh.geometry = this.scatterVariants[Math.floor(pick * this.scatterVariants.length)];
        const side = hash1(index * 19 + sub, this.seed + 831) > 0.5 ? 1 : -1;
        const lateral = side * (8.5 + hash1(index * 29 + sub, this.seed + 844) * 68);
        const along = hash1(index * 37 + sub, this.seed + 855) * STATION_SPACING;
        const ok = this.place(slot.object, index, lateral, along, 'along');
        const scale = 0.72 + hash1(index * 17 + sub, this.seed + 866) * 0.85;
        slot.object.scale.setScalar(scale);
        slot.object.rotation.y = hash1(index * 23 + sub, this.seed + 877) * Math.PI * 2;
        return ok;
      }

      case 'mile': {
        const mile = Math.floor(((index + 1) * STATION_SPACING - this.mileZero) / METRES_PER_MILE);
        const label = `mile:${mile}`;
        if (slot.label !== label) {
          const panel = (slot.object as THREE.Group).getObjectByName('panel') as THREE.Mesh;
          const material = panel.material as THREE.ShaderMaterial;
          material.uniforms.uMap.value = mileMarkerTexture(
            mile,
            slot.object.userData.texture as THREE.CanvasTexture,
          );
          slot.label = label;
        }
        return this.place(slot.object, index, 5.4, 0, 'road');
      }

      case 'sign': {
        const roll = hash1(index, this.seed + 4242);
        const spec = pickSign(roll, (index * STATION_SPACING - this.mileZero) / METRES_PER_MILE);
        if (slot.label !== spec.label) {
          const panel = (slot.object as THREE.Group).getObjectByName('panel') as THREE.Mesh;
          const material = panel.material as THREE.ShaderMaterial;
          material.uniforms.uMap.value = signTexture(
            spec.kind,
            spec.lines,
            slot.object.userData.texture as THREE.CanvasTexture,
          );
          slot.label = spec.label;
        }
        return this.place(slot.object, index, 7.4, 0, 'road');
      }
    }
  }

  private isMillersForecourt(index: number): boolean {
    const millersStation = Math.round((this.mileZero + STORY_MILES.millersGas * METRES_PER_MILE) / STATION_SPACING);
    return Math.abs(index - millersStation) <= 2;
  }

  shift(offset: THREE.Vector3): void {
    for (const slot of this.active.values()) slot.object.position.sub(offset);
  }
}

/** Signage content. Deliberately a lookup so the script can add its own later. */
function pickSign(roll: number, mile: number): { kind: 'destination' | 'warning' | 'speed' | 'service'; lines: string[]; label: string } {
  const remaining = Math.max(1, Math.round(86 - mile));
  if (roll > 0.992) {
    return { kind: 'service', lines: ['GAS', 'FOOD', `${remaining} MILES`], label: `svc${remaining}` };
  }
  if (roll > 0.985) {
    return { kind: 'warning', lines: ['SOFT', 'SHOULDER'], label: 'soft' };
  }
  if (roll > 0.978) {
    return { kind: 'speed', lines: ['55'], label: 'spd55' };
  }
  return {
    kind: 'destination',
    lines: ['RED CREEK', `${remaining}`],
    label: `dest${remaining}`,
  };
}
