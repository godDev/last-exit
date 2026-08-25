import * as THREE from 'three';
import { fbm1 } from '../core/rng';

/**
 * Route 17 as a pure function of its seed.
 *
 * The centreline is a chain of stations 20 m apart. Nothing is stored permanently: any
 * station can be regenerated from its index, which is what makes a 400 mile route free.
 */

export const STATION_SPACING = 20;

export interface RoutePoint {
  index: number;
  /** World position of the centre line. */
  x: number;
  y: number;
  z: number;
  /** Radians, 0 = +Z. */
  heading: number;
}

/** Radians per metre. Mostly zero — this is the desert, not a mountain pass. */
export function curvatureAt(index: number, seed: number): number {
  const n = fbm1(index * 0.0055, seed, 3);
  // pow() flattens the middle of the range: long straights, then a curve that means it
  const shaped = Math.sign(n) * Math.pow(Math.abs(n), 2.3);
  return shaped * 0.0024;
}

export function elevationAt(index: number, seed: number): number {
  return fbm1(index * 0.0032, seed + 77, 3) * 9 + fbm1(index * 0.014, seed + 991, 2) * 1.4;
}

/** Ground height offset out in the desert, away from the graded roadbed. */
export function terrainAt(index: number, lateral: number, seed: number): number {
  const a = Math.abs(lateral);
  if (a < 8) return 0;
  const rough = fbm1(index * 0.06 + lateral * 0.31, seed + 313, 3);
  const swell = fbm1(index * 0.011 + lateral * 0.017, seed + 517, 2);
  const scale = Math.min(1, (a - 8) / 90);
  return (rough * 2.2 + swell * 14) * scale * scale;
}

/** Graded roadbed and shoulder profile shared by vehicles and authored roadside scenes. */
export function shoulderHeightAt(lateral: number): number {
  const a = Math.abs(lateral);
  if (a <= 3.65) return 0.08 * (1 - a / 3.65);
  if (a <= 4.4) return THREE.MathUtils.lerp(0, -0.07, (a - 3.65) / 0.75);
  if (a <= 7.2) return THREE.MathUtils.lerp(-0.07, -0.34, (a - 4.4) / 2.8);
  if (a <= 13) return THREE.MathUtils.lerp(-0.34, -0.55, (a - 7.2) / 5.8);
  return -0.55 - Math.min(0.45, (a - 13) * 0.008);
}

export class RoutePath {
  /** Sliding window of stations, ascending by index. */
  readonly points: RoutePoint[] = [];
  /** Accumulated floating-origin correction, for debug readouts only. */
  readonly worldOffset = new THREE.Vector3();

  constructor(private readonly seed: number) {
    this.points.push({ index: 0, x: 0, y: elevationAt(0, seed), z: 0, heading: 0 });
  }

  get firstIndex(): number { return this.points[0].index; }
  get lastIndex(): number { return this.points[this.points.length - 1].index; }

  /**
   * Make sure the window covers [centre - behind, centre + ahead].
   * Returns true when the window moved, i.e. the road mesh needs rewriting.
   */
  ensure(centre: number, behind: number, ahead: number): boolean {
    let moved = false;

    const wantLast = centre + ahead;
    while (this.lastIndex < wantLast) {
      const prev = this.points[this.points.length - 1];
      const index = prev.index + 1;
      // integrate heading over the segment we are about to lay down
      const heading = prev.heading + curvatureAt(prev.index, this.seed) * STATION_SPACING;
      this.points.push({
        index,
        x: prev.x + Math.sin(heading) * STATION_SPACING,
        z: prev.z + Math.cos(heading) * STATION_SPACING,
        y: elevationAt(index, this.seed),
        heading,
      });
      moved = true;
    }

    const wantFirst = centre - behind;
    let drop = 0;
    while (drop < this.points.length - 2 && this.points[drop].index < wantFirst) drop++;
    if (drop > 0) {
      this.points.splice(0, drop);
      moved = true;
    }

    return moved;
  }

  at(index: number): RoutePoint | undefined {
    const i = index - this.firstIndex;
    return this.points[i];
  }

  /** Interpolated centreline frame at an absolute distance in metres. */
  sample(distance: number, out = new THREE.Vector3()): { pos: THREE.Vector3; heading: number } {
    const f = distance / STATION_SPACING;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.at(i);
    const b = this.at(i + 1);
    if (!a || !b) {
      const p = a ?? b ?? this.points[0];
      out.set(p.x, p.y, p.z);
      return { pos: out, heading: p.heading };
    }
    out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    return { pos: out, heading: a.heading + (b.heading - a.heading) * t };
  }

  /** Surface height at an arbitrary distance and lateral offset from Route 17. */
  groundHeightAt(distance: number, lateral: number): number {
    const point = this.sample(distance);
    return point.pos.y
      + shoulderHeightAt(lateral)
      + terrainAt(Math.floor(distance / STATION_SPACING), lateral, this.seed);
  }

  /** Floating origin: pull the whole route back towards zero. */
  shift(offset: THREE.Vector3): void {
    for (const p of this.points) {
      p.x -= offset.x;
      p.y -= offset.y;
      p.z -= offset.z;
    }
    this.worldOffset.add(offset);
  }
}
