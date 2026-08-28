import * as THREE from 'three';
import { createPBRMaterial, enablePBRShadows } from '../render/pbrMaterial';
import { canvasTexture } from '../render/textures';
import type { Bus } from '../bus/drive';
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
  horned: boolean;
  crashed: boolean;
  alongVelocity: number;
  lateralVelocity: number;
  yawOffset: number;
  yawVelocity: number;
  roll: number;
  rollVelocity: number;
  damage: number;
  damageRoot: THREE.Group;
}

export interface TrafficImpact {
  readonly kind: Kind;
  readonly normal: THREE.Vector3;
  readonly penetration: number;
  readonly severity: number;
  readonly otherMass: number;
  readonly otherAlongSpeed: number;
}

export interface TrafficUpdate {
  readonly horn: Kind | null;
  readonly impact: TrafficImpact | null;
}

const BUS_HALF_LENGTH = 6.1;
const BUS_HALF_WIDTH = 1.33;

function vehicleDimensions(vehicle: Vehicle): { centre: number; halfLength: number; halfWidth: number; mass: number } {
  return vehicle.kind === 'truck'
    ? { centre: -1.7, halfLength: 8.65, halfWidth: 1.22, mass: 8_500 }
    : { centre: 0, halfLength: 2.45, halfWidth: 0.96, mass: 1_500 };
}

function crackTexture(): THREE.Texture {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(205,224,232,.86)';
    ctx.lineWidth = 1.35;
    const origins: Array<[number, number]> = [[w * 0.46, h * 0.52], [w * 0.7, h * 0.36]];
    for (let origin = 0; origin < origins.length; origin++) {
      const [cx, cy] = origins[origin];
      for (let ray = 0; ray < 9; ray++) {
        const angle = ray * Math.PI * 2 / 9 + origin * 0.27;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let step = 1; step <= 4; step++) {
          const radius = step * (10 + origin * 3);
          ctx.lineTo(cx + Math.cos(angle + Math.sin(step * 2.3) * 0.1) * radius, cy + Math.sin(angle) * radius * 0.62);
        }
        ctx.stroke();
      }
      for (const radius of [7, 13, 21]) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0.2 + origin, Math.PI * 1.65 + origin);
        ctx.stroke();
      }
    }
  });
}

function buildVehicleDamage(kind: Kind): THREE.Group {
  const root = new THREE.Group();
  root.name = `${kind}-persistent-collision-damage`;
  const bentMetal = mat(0x25282a, 0.88);
  const exposedMetal = mat(0x66635b, 1.4);
  const brokenLamp = mat(0x32100d, 0.8);
  const front = kind === 'truck' ? 6.93 : 2.39;
  const width = kind === 'truck' ? 2.18 : 1.72;
  const panelY = kind === 'truck' ? 1.15 : 0.79;

  const crushedPanel = box(root, bentMetal, [width, kind === 'truck' ? 0.72 : 0.42, 0.12], [0, panelY, front + 0.055]);
  crushedPanel.rotation.x = -0.12;
  crushedPanel.rotation.z = 0.045;
  for (const side of [-1, 1]) {
    const crease = box(root, exposedMetal, [0.055, kind === 'truck' ? 0.68 : 0.38, 0.07], [side * width * 0.31, panelY, front + 0.13]);
    crease.rotation.z = side * 0.34;
    const lamp = box(root, brokenLamp, [kind === 'truck' ? 0.46 : 0.34, 0.15, 0.035], [side * width * 0.32, panelY + 0.08, front + 0.16]);
    lamp.rotation.z = side * 0.09;
  }

  const cracks = new THREE.Mesh(
    new THREE.PlaneGeometry(kind === 'truck' ? 1.88 : 1.27, kind === 'truck' ? 0.7 : 0.47),
    new THREE.MeshBasicMaterial({
      map: crackTexture(),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  cracks.position.set(0, kind === 'truck' ? 2.68 : 1.44, kind === 'truck' ? 4.94 : 1.005);
  cracks.rotation.x = kind === 'truck' ? -0.08 : -0.28;
  root.add(cracks);
  root.visible = false;
  return root;
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
      const damageRoot = buildVehicleDamage(kind);
      object.add(damageRoot);
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
      return {
        kind,
        object,
        active: false,
        distance: 0,
        speed: 0,
        direction: -1,
        lateral: -1.9,
        horned: false,
        crashed: false,
        alongVelocity: 0,
        lateralVelocity: 0,
        yawOffset: 0,
        yawVelocity: 0,
        roll: 0,
        rollVelocity: 0,
        damage: 0,
        damageRoot,
      };
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
    free.horned = false;
    free.crashed = false;
    free.alongVelocity = 0;
    free.lateralVelocity = 0;
    free.yawOffset = 0;
    free.yawVelocity = 0;
    free.roll = 0;
    free.rollVelocity = 0;
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

  private placeVehicle(vehicle: Vehicle): void {
    const frame = this.path.sample(vehicle.distance);
    const rx = -Math.cos(frame.heading);
    const rz = Math.sin(frame.heading);
    vehicle.object.position.set(
      frame.pos.x + rx * vehicle.lateral,
      frame.pos.y,
      frame.pos.z + rz * vehicle.lateral,
    );
    const baseHeading = vehicle.direction === 1 ? frame.heading : frame.heading + Math.PI;
    vehicle.object.rotation.set(0, baseHeading + vehicle.yawOffset, vehicle.roll, 'YXZ');
  }

  update(dt: number, bus: Bus, canInteract = true): TrafficUpdate {
    const busDistance = bus.distance;
    let horn: Kind | null = null;
    let impact: TrafficImpact | null = null;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.spawn(busDistance);
      this.timer = 16 + this.random() * 55;
    }
    for (const v of this.pool) {
      if (!v.active) continue;
      if (v.crashed) {
        v.distance += v.alongVelocity * dt;
        v.lateral += v.lateralVelocity * dt;
        v.yawOffset += v.yawVelocity * dt;
        v.roll += v.rollVelocity * dt;
        const groundDrag = Math.exp(-dt * 0.72);
        const sideDrag = Math.exp(-dt * 1.35);
        v.alongVelocity *= groundDrag;
        v.lateralVelocity *= sideDrag;
        v.yawVelocity *= Math.exp(-dt * 1.1);
        v.rollVelocity += (-v.roll * 8.5 - v.rollVelocity * 4.8) * dt;
      } else {
        v.distance += v.direction * v.speed * dt;
      }
      const ahead = v.distance - busDistance;
      if (ahead < -90 || ahead > 540 || Math.abs(v.lateral) > 18) {
        v.active = false;
        v.object.visible = false;
        continue;
      }

      const dimensions = vehicleDimensions(v);
      const vehicleCentre = v.distance + v.direction * dimensions.centre;
      const centreGap = vehicleCentre - busDistance;
      const closingSpeed = Math.max(0, bus.speed - v.direction * v.speed);
      const lateralGap = Math.abs(bus.lateral - v.lateral);
      const contactDistance = BUS_HALF_LENGTH + dimensions.halfLength;

      // An oncoming driver only leans on the horn when both vehicles occupy the same lane
      // and the time-to-contact has fallen below roughly two and a half seconds.
      if (canInteract && !v.crashed && !v.horned && v.direction === -1 && centreGap > contactDistance) {
        const timeToContact = (centreGap - contactDistance) / Math.max(0.1, closingSpeed);
        if (lateralGap < BUS_HALF_WIDTH + dimensions.halfWidth - 0.18 && timeToContact < 2.45) {
          v.horned = true;
          horn ??= v.kind;
        }
      }

      if (canInteract && !impact) {
        const longitudinalPenetration = contactDistance - Math.abs(centreGap);
        const lateralPenetration = BUS_HALF_WIDTH + dimensions.halfWidth - lateralGap;
        if (longitudinalPenetration > 0 && lateralPenetration > 0) {
          const frame = this.path.sample(busDistance);
          const forward = new THREE.Vector3(Math.sin(frame.heading), 0, Math.cos(frame.heading));
          const right = new THREE.Vector3(-Math.cos(frame.heading), 0, Math.sin(frame.heading));
          const normal = longitudinalPenetration < lateralPenetration
            ? forward.multiplyScalar(centreGap >= 0 ? -1 : 1)
            : right.multiplyScalar(bus.lateral >= v.lateral ? 1 : -1);
          const penetration = Math.min(longitudinalPenetration, lateralPenetration);
          if (v.crashed) {
            // A wreck remains a solid obstacle after the first impact. Separate the coach
            // every frame of continued contact, but do not repeatedly add cosmetic damage.
            bus.blockByVehicle(normal, penetration);
            this.placeVehicle(v);
            continue;
          }
          const relativeAlong = bus.speed - v.direction * v.speed;
          const severity = THREE.MathUtils.clamp(Math.abs(relativeAlong) / 48, 0.18, 1);
          const sideOffset = THREE.MathUtils.clamp((v.lateral - bus.lateral) / (BUS_HALF_WIDTH + dimensions.halfWidth), -1, 1);
          const throwSide = Math.abs(sideOffset) > 0.06
            ? Math.sign(sideOffset)
            : (((Math.floor(v.distance * 0.17) & 1) === 0) ? -1 : 1);
          const restitution = 0.1;
          const busMass = 11_000;
          const vehicleAlong = v.direction * v.speed;

          // One-dimensional momentum conservation handles the violent fore/aft exchange;
          // the small off-centre component produces the believable spin into the shoulder.
          v.alongVelocity = (
            (dimensions.mass - restitution * busMass) * vehicleAlong
            + (1 + restitution) * busMass * bus.speed
          ) / (busMass + dimensions.mass);
          v.lateralVelocity = throwSide * (2.2 + severity * (v.kind === 'truck' ? 3.6 : 7.2));
          v.yawVelocity = throwSide * (0.45 + severity * (v.kind === 'truck' ? 0.85 : 1.8));
          v.rollVelocity = -throwSide * (0.18 + severity * (v.kind === 'truck' ? 0.3 : 0.75));
          v.crashed = true;
          v.damage = THREE.MathUtils.clamp(v.damage + 0.38 + severity * 0.62, 0, 1);
          v.damageRoot.visible = true;
          v.damageRoot.scale.set(0.92 + v.damage * 0.08, 0.82 + v.damage * 0.18, 0.75 + v.damage * 0.25);

          impact = {
            kind: v.kind,
            normal,
            penetration,
            severity,
            otherMass: dimensions.mass,
            otherAlongSpeed: vehicleAlong,
          };
        }
      }

      this.placeVehicle(v);
    }
    return { horn, impact };
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
