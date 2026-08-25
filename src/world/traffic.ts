import * as THREE from 'three';
import { createPBRMaterial, enablePBRShadows } from '../render/pbrMaterial';
import { canvasTexture } from '../render/textures';
import { RoutePath } from './curvature';

/** Sparse, pooled highway traffic. Vehicle forward is +Z. */
type Kind = 'car' | 'truck';

/** One truck for every fifteen cars in the oncoming traffic mix. */
const ONCOMING_TRUCK_CHANCE = 1 / 16;

interface Vehicle {
  kind: Kind;
  object: THREE.Group;
  active: boolean;
  distance: number;
  speed: number;
  direction: 1 | -1;
  lateral: number;
}

function glareTexture(inner: string, outer: string): THREE.Texture {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function mat(color: number, ambientBoost = 1): THREE.MeshStandardMaterial {
  return createPBRMaterial({
    surface: ambientBoost > 1.55 ? 'metal' : ambientBoost < 0.8 ? 'rubber' : 'paint',
    color,
    roughness: THREE.MathUtils.clamp(0.78 - (ambientBoost - 1) * 0.28, 0.24, 0.94),
  });
}

function box(
  parent: THREE.Object3D,
  material: THREE.Material,
  size: [number, number, number],
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

/** A tapered cabin is the single most important cue that this is a car, not two boxes. */
function taperedBox(widthBottom: number, widthTop: number, height: number, depth: number): THREE.BufferGeometry {
  const xb = widthBottom / 2;
  const xt = widthTop / 2;
  const y0 = -height / 2;
  const y1 = height / 2;
  const z = depth / 2;
  const vertices = new Float32Array([
    -xb, y0, -z, xb, y0, -z, xb, y0, z, -xb, y0, z,
    -xt, y1, -z, xt, y1, -z, xt, y1, z, -xt, y1, z,
  ]);
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function wheel(parent: THREE.Object3D, x: number, y: number, z: number, tyre: THREE.Material, hub: THREE.Material, radius = 0.39): void {
  const tyreMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.24, 12), tyre);
  tyreMesh.rotation.z = Math.PI / 2;
  tyreMesh.position.set(x, y, z);
  parent.add(tyreMesh);
  const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, 0.255, 10), hub);
  hubMesh.rotation.z = Math.PI / 2;
  hubMesh.position.set(x, y, z);
  parent.add(hubMesh);
}

function buildCar(paintColor: number): THREE.Group {
  const root = new THREE.Group();
  const paint = mat(paintColor, 1.35);
  const trim = mat(0x17191d, 1.15);
  const glass = mat(0x07111a, 1.55);
  const chrome = mat(0x85888a, 1.6);
  const tyre = mat(0x090909, 0.65);
  const lampGlass = mat(0xd8cfad, 2.2);
  const redGlass = mat(0x7e160f, 1.8);

  // Late-eighties American sedan proportions: long bonnet, low belt line, square tail.
  box(root, paint, [1.88, 0.58, 4.62], [0, 0.68, 0]);
  box(root, paint, [1.78, 0.24, 1.25], [0, 1.02, 1.62]);
  box(root, paint, [1.82, 0.27, 0.95], [0, 1.01, -1.77]);
  const cabin = new THREE.Mesh(taperedBox(1.62, 1.34, 0.74, 2.28), paint);
  cabin.position.set(0, 1.38, -0.18);
  root.add(cabin);

  // Separate panes and pillars read clearly when the bus headlights sweep over the car.
  box(root, glass, [1.31, 0.48, 0.035], [0, 1.43, 0.98]).rotation.x = -0.28;
  box(root, glass, [1.31, 0.46, 0.035], [0, 1.43, -1.34]).rotation.x = 0.28;
  for (const x of [-0.79, 0.79]) {
    box(root, glass, [0.025, 0.43, 0.82], [x, 1.42, 0.31]);
    box(root, glass, [0.025, 0.43, 0.72], [x, 1.42, -0.72]);
    box(root, trim, [0.035, 0.08, 2.02], [x + Math.sign(x) * 0.006, 1.18, -0.18]);
  }
  box(root, trim, [1.92, 0.12, 0.16], [0, 0.55, 2.31]);
  box(root, chrome, [1.82, 0.09, 0.12], [0, 0.48, 2.39]);
  box(root, chrome, [1.82, 0.09, 0.12], [0, 0.51, -2.39]);
  // Grille, inset lamp lenses and registration plate keep the front readable even when
  // additive glare is small or the car is seen in the side mirror.
  box(root, trim, [0.82, 0.22, 0.035], [0, 0.75, 2.326]);
  for (const x of [-0.58, 0.58]) {
    box(root, lampGlass, [0.38, 0.18, 0.035], [x, 0.82, 2.34]);
    box(root, redGlass, [0.4, 0.17, 0.035], [x, 0.78, -2.34]);
    const mirror = box(root, paint, [0.17, 0.11, 0.22], [x < 0 ? -1.01 : 1.01, 1.28, 0.56]);
    mirror.rotation.y = x < 0 ? -0.14 : 0.14;
  }
  box(root, chrome, [0.42, 0.12, 0.025], [0, 0.55, 2.465]);
  // Door cuts and handles break up the slab sides under grazing headlights.
  for (const x of [-0.946, 0.946]) {
    for (const z of [-0.72, 0.38]) box(root, trim, [0.018, 0.58, 0.022], [x, 0.91, z]);
    for (const z of [-0.45, 0.66]) box(root, chrome, [0.02, 0.035, 0.18], [x, 1.08, z]);
  }
  for (const z of [1.46, -1.48]) {
    wheel(root, -0.91, 0.48, z, tyre, chrome);
    wheel(root, 0.91, 0.48, z, tyre, chrome);
  }
  return root;
}

function buildTruck(paintColor: number): THREE.Group {
  const root = new THREE.Group();
  const paint = mat(paintColor, 1.3);
  const trailer = mat(0x5a5b56, 1.25);
  const glass = mat(0x07121b, 1.55);
  const trim = mat(0x1b1c1d, 0.9);
  const chrome = mat(0x929493, 1.65);
  const tyre = mat(0x080808, 0.6);
  const lampGlass = mat(0xe1d5b2, 2.2);
  const redGlass = mat(0x80170f, 1.9);

  // Conventional tractor: engine hood, upright cab, sleeper and a separate trailer.
  box(root, paint, [2.38, 1.05, 2.35], [0, 1.13, 5.65]);
  box(root, chrome, [2.05, 0.68, 0.12], [0, 1.13, 6.86]);
  box(root, paint, [2.28, 2.45, 2.15], [0, 2.2, 3.82]);
  box(root, paint, [2.22, 2.7, 1.15], [0, 2.28, 2.35]);
  box(root, glass, [1.92, 0.72, 0.035], [0, 2.68, 4.91]).rotation.x = -0.08;
  for (const x of [-1.151, 1.151]) box(root, glass, [0.025, 0.76, 0.78], [x, 2.58, 4.05]);
  box(root, chrome, [2.48, 0.2, 0.23], [0, 0.62, 6.91]);
  box(root, trim, [2.06, 0.12, 1.25], [0, 0.76, 5.77]);
  for (const x of [-0.78, 0.78]) {
    box(root, lampGlass, [0.52, 0.24, 0.04], [x, 1.28, 6.85]);
    // Convex mirrors on long stalks are a strong truck silhouette cue.
    box(root, chrome, [0.035, 0.52, 0.035], [x < 0 ? -1.32 : 1.32, 2.7, 4.72]);
    box(root, trim, [0.18, 0.32, 0.08], [x < 0 ? -1.32 : 1.32, 2.92, 4.75]);
  }

  // Trailer is raised above its frame and has visible ribs instead of one featureless slab.
  box(root, trim, [2.35, 0.2, 12.2], [0, 0.94, -4.15]);
  box(root, trailer, [2.48, 3.15, 11.85], [0, 2.55, -4.38]);
  for (let z = -9.7; z <= 0.8; z += 1.5) {
    box(root, chrome, [2.505, 0.045, 0.055], [0, 1.16, z]);
  }
  box(root, chrome, [2.51, 0.12, 11.72], [0, 1.02, -4.38]);
  for (const x of [-0.9, 0.9]) box(root, redGlass, [0.38, 0.2, 0.04], [x, 1.15, -10.32]);
  for (const z of [4.05, 5.65, -7.75, -9.05]) {
    wheel(root, -1.19, 0.63, z, tyre, chrome, 0.52);
    wheel(root, 1.19, 0.63, z, tyre, chrome, 0.52);
  }
  // Exhaust stacks instantly establish scale in silhouette.
  for (const x of [-0.91, 0.91]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.4, 8), chrome);
    stack.position.set(x, 3.25, 2.75);
    root.add(stack);
  }
  return root;
}

export class Traffic {
  readonly group = new THREE.Group();
  private readonly pool: Vehicle[] = [];
  private timer = 12;
  private hasSpawnedOncoming = false;

  constructor(private readonly path: RoutePath, private readonly random: () => number) {
    const head = glareTexture('rgba(255,255,246,1)', 'rgba(255,232,190,0.75)');
    const tail = glareTexture('rgba(255,190,170,1)', 'rgba(210,40,26,0.6)');
    const marker = glareTexture('rgba(255,226,170,1)', 'rgba(226,150,40,0.6)');
    const paints = [0x354b58, 0x632d2a, 0x4a463c, 0x213b32, 0x6a6559];

    const makeLamp = (texture: THREE.Texture, size: number, x: number, y: number, z: number) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      sprite.scale.setScalar(size);
      sprite.position.set(x, y, z);
      return sprite;
    };

    const build = (kind: Kind, index: number): Vehicle => {
      const object = kind === 'truck' ? buildTruck(paints[(index + 2) % paints.length]) : buildCar(paints[index % paints.length]);
      const isTruck = kind === 'truck';
      const halfWidth = isTruck ? 0.88 : 0.68;
      const front = isTruck ? 6.94 : 2.42;
      const back = isTruck ? -10.34 : -2.43;
      const lampY = isTruck ? 1.3 : 0.8;
      object.add(makeLamp(head, isTruck ? 1.65 : 1.25, -halfWidth, lampY, front));
      object.add(makeLamp(head, isTruck ? 1.65 : 1.25, halfWidth, lampY, front));
      object.add(makeLamp(tail, isTruck ? 0.68 : 0.58, -halfWidth, lampY, back));
      object.add(makeLamp(tail, isTruck ? 0.68 : 0.58, halfWidth, lampY, back));
      if (isTruck) for (let i = -2; i <= 2; i++) object.add(makeLamp(marker, 0.3, i * 0.42, 3.5, 4.91));
      enablePBRShadows(object);
      object.visible = false;
      this.group.add(object);
      return { kind, object, active: false, distance: 0, speed: 0, direction: -1, lateral: -1.9 };
    };

    for (let i = 0; i < 3; i++) this.pool.push(build('car', i));
    for (let i = 0; i < 2; i++) this.pool.push(build('truck', i));
  }

  private spawn(busDistance: number): void {
    const oncoming = this.random() > 0.32;
    const firstOncoming = oncoming && !this.hasSpawnedOncoming;
    const kind: Kind = firstOncoming || (oncoming && this.random() < ONCOMING_TRUCK_CHANCE) ? 'truck' : 'car';
    const free = this.pool.find((vehicle) => !vehicle.active && vehicle.kind === kind);
    if (!free) return;
    if (oncoming) this.hasSpawnedOncoming = true;
    free.active = true;
    free.object.visible = true;
    free.direction = oncoming ? -1 : 1;
    if (oncoming) {
      free.distance = busDistance + 470;
      free.lateral = -1.9;
      free.speed = 21 + this.random() * 8;
    } else {
      free.distance = busDistance + 130 + this.random() * 180;
      free.lateral = 1.85;
      free.speed = free.kind === 'truck' ? 19 + this.random() * 4 : 23 + this.random() * 5;
    }
  }

  update(dt: number, busDistance: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.spawn(busDistance);
      this.timer = 16 + this.random() * 55;
    }
    for (const v of this.pool) {
      if (!v.active) continue;
      v.distance += v.direction * v.speed * dt;
      const ahead = v.distance - busDistance;
      if (ahead < -55 || ahead > 540) {
        v.active = false;
        v.object.visible = false;
        continue;
      }
      const frame = this.path.sample(v.distance);
      const rx = -Math.cos(frame.heading);
      const rz = Math.sin(frame.heading);
      v.object.position.set(frame.pos.x + rx * v.lateral, frame.pos.y, frame.pos.z + rz * v.lateral);
      v.object.rotation.set(0, v.direction === 1 ? frame.heading : frame.heading + Math.PI, 0);
    }
  }

  glareAt(busDistance: number): number {
    let worst = 0;
    for (const v of this.pool) {
      if (!v.active || v.direction !== -1) continue;
      const gap = v.distance - busDistance;
      if (gap < -12 || gap > 200) continue;
      worst = Math.max(worst, 1 - Math.min(1, Math.abs(gap) / 200));
    }
    return worst;
  }
}
