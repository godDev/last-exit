import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../render/retroMaterial';
import { canvasTexture } from '../render/textures';
import { RoutePath } from './curvature';

/**
 * The other traffic on 17. Sparse on purpose — a set of headlights every minute or so is
 * the only company out here, and the gap between them is what makes the road feel long.
 *
 * Lamps are sprites with additive blending rather than lights: at 480x270 an approaching
 * truck reads entirely as two growing white blobs, and a real light would cost far more
 * and look worse.
 */

type Kind = 'car' | 'truck';

interface Vehicle {
  kind: Kind;
  object: THREE.Group;
  active: boolean;
  /** Route distance, metres. */
  distance: number;
  speed: number;
  /** +1 travelling with the bus, -1 oncoming. */
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

function tinted(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
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

function moved(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  g.translate(x, y, z);
  return g;
}

/** +Z is the direction of travel for every vehicle body. */
function buildCar(): THREE.BufferGeometry {
  const body = moved(tinted(new THREE.BoxGeometry(1.85, 0.85, 4.6), 0x241f22), 0, 0.72, 0);
  const cabin = moved(tinted(new THREE.BoxGeometry(1.7, 0.62, 2.3), 0x1b171a), 0, 1.4, -0.25);
  return mergeGeometries([body, cabin])!;
}

function buildTruck(): THREE.BufferGeometry {
  const parts = [
    moved(tinted(new THREE.BoxGeometry(2.45, 1.5, 5.4), 0x2b2620), 0, 1.35, 3.9),
    moved(tinted(new THREE.BoxGeometry(2.3, 1.25, 2.4), 0x211d19), 0, 2.7, 4.6),
    moved(tinted(new THREE.BoxGeometry(2.5, 3.1, 12.5), 0x33302a), 0, 2.3, -5.2),
  ];
  return mergeGeometries(parts)!;
}

export class Traffic {
  readonly group = new THREE.Group();
  private readonly pool: Vehicle[] = [];
  private timer = 12;

  constructor(
    private readonly path: RoutePath,
    private readonly random: () => number,
  ) {
    const paint = createRetroMaterial({ vertexColors: true, snap: 0.7 });
    const head = glareTexture('rgba(255,255,246,1)', 'rgba(255,232,190,0.75)');
    const tail = glareTexture('rgba(255,190,170,1)', 'rgba(210,40,26,0.6)');
    const marker = glareTexture('rgba(255,226,170,1)', 'rgba(226,150,40,0.6)');

    const carGeo = buildCar();
    const truckGeo = buildTruck();

    const makeLamp = (texture: THREE.Texture, size: number, x: number, y: number, z: number) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
        }),
      );
      sprite.scale.setScalar(size);
      sprite.position.set(x, y, z);
      return sprite;
    };

    const build = (kind: Kind): Vehicle => {
      const object = new THREE.Group();
      const isTruck = kind === 'truck';
      object.add(new THREE.Mesh(isTruck ? truckGeo : carGeo, paint));

      const halfWidth = isTruck ? 1.05 : 0.72;
      const front = isTruck ? 6.7 : 2.35;
      const back = isTruck ? -11.5 : -2.35;
      const lampY = isTruck ? 0.95 : 0.62;

      object.add(makeLamp(head, isTruck ? 2.6 : 2.0, -halfWidth, lampY, front));
      object.add(makeLamp(head, isTruck ? 2.6 : 2.0, halfWidth, lampY, front));
      object.add(makeLamp(tail, 0.85, -halfWidth, lampY + 0.2, back));
      object.add(makeLamp(tail, 0.85, halfWidth, lampY + 0.2, back));

      if (isTruck) {
        // the five amber marker lights across the roof of the cab
        for (let i = -2; i <= 2; i++) {
          object.add(makeLamp(marker, 0.42, i * 0.45, 3.4, 4.6));
        }
      }

      object.visible = false;
      this.group.add(object);
      return { kind, object, active: false, distance: 0, speed: 0, direction: -1, lateral: -1.9 };
    };

    for (let i = 0; i < 3; i++) this.pool.push(build('car'));
    for (let i = 0; i < 2; i++) this.pool.push(build('truck'));
  }

  private spawn(busDistance: number): void {
    const free = this.pool.find((v) => !v.active);
    if (!free) return;

    const oncoming = this.random() > 0.32;
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
      // long gaps: the emptiness is the point
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
      v.object.position.set(
        frame.pos.x + rx * v.lateral,
        frame.pos.y,
        frame.pos.z + rz * v.lateral,
      );
      v.object.rotation.set(0, v.direction === 1 ? frame.heading : frame.heading + Math.PI, 0);
    }
  }

  /**
   * 0..1, how much oncoming glare is in the driver's eyes right now. Peaks in the last
   * couple of seconds before the pass, which is when a real driver looks at the fog line.
   */
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
