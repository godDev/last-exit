import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../render/retroMaterial';
import { canvasTexture, mileMarkerTexture, signTexture } from '../render/textures';
import { hash1 } from '../core/rng';
import { RoutePath, STATION_SPACING, terrainAt } from './curvature';
import { METRES_PER_MILE } from '../core/units';

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

type Kind = 'pole' | 'delineator' | 'fence' | 'scrub' | 'mile' | 'sign';

interface Slot {
  kind: Kind;
  object: THREE.Object3D;
  free: boolean;
  /** Set when the slot carries per-instance artwork. */
  texture?: THREE.CanvasTexture;
  label?: string;
}

export interface PropCollision {
  normal: THREE.Vector3;
  penetration: number;
  kind: Kind;
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
  const parts = [at(tint(new THREE.CylinderGeometry(0.26, 0.34, 4.2, 6), 0x23301c), 0, 2.1, 0)];
  const armL = at(tint(new THREE.CylinderGeometry(0.16, 0.19, 1.5, 5), 0x23301c), -0.55, 2.6, 0);
  armL.rotateZ(0.55);
  const armLup = at(tint(new THREE.CylinderGeometry(0.15, 0.16, 1.2, 5), 0x23301c), -0.95, 3.4, 0);
  const armR = at(tint(new THREE.CylinderGeometry(0.15, 0.18, 1.1, 5), 0x23301c), 0.5, 3.1, 0);
  armR.rotateZ(-0.6);
  parts.push(armL, armLup, armR);
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

// --- the field ---------------------------------------------------------------

export class PropField {
  readonly group = new THREE.Group();
  private readonly slots = new Map<Kind, Slot[]>();
  private readonly active = new Map<string, Slot>();
  private readonly scrubVariants: THREE.BufferGeometry[];
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

    this.scrubVariants = [buildSaguaro(), buildBush(), buildJoshua(), buildBush()];

    // one geometry per kind, shared by every instance of it
    const pole = buildPole();
    const delineator = buildDelineator();
    const fence = buildFenceSection();

    this.pool('pole', 9, () => new THREE.Mesh(pole, timber));
    this.pool('delineator', 46, () => new THREE.Mesh(delineator, timber));
    this.pool('fence', 16, () => new THREE.Mesh(fence, timber));
    this.pool('scrub', 44, () => new THREE.Mesh(this.scrubVariants[0], vegetation));
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
      list.push({ kind, object, free: true });
    }
    this.slots.set(kind, list);
  }

  private take(kind: Kind): Slot | null {
    const list = this.slots.get(kind)!;
    for (const slot of list) {
      if (slot.free) {
        slot.free = false;
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

      // barbed wire, with gaps where the range opens up
      if (hash1(i, this.seed + 55) > 0.35) wanted.add(`fence|${i}|0`);

      // vegetation
      for (let s = 0; s < 3; s++) {
        if (hash1(i * 31 + s, this.seed + 700) > 0.52) wanted.add(`scrub|${i}|${s}`);
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

      // occasional signage
      if (hash1(i, this.seed + 909) > 0.965) wanted.add(`sign|${i}|0`);
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
      this.active.set(key, slot);
    }
  }

  /** Broad-phase and circle collision against only the small set of pooled active props. */
  collisionAt(position: THREE.Vector3, busRadius: number): PropCollision | null {
    let best: PropCollision | null = null;
    let deepest = 0;
    for (const slot of this.active.values()) {
      const baseRadius = COLLIDER_RADIUS[slot.kind];
      if (!baseRadius || !slot.object.visible) continue;
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
      best = { normal: this.collisionNormal.clone(), penetration, kind: slot.kind };
    }
    return best;
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
