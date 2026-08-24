import * as THREE from 'three';
import { RoutePath, STATION_SPACING, terrainAt } from './curvature';
import { createRetroMaterial } from '../render/retroMaterial';

/**
 * The road, its shoulders and the desert either side are a single ribbon mesh: one draw
 * call for the whole visible world floor. Lane markings are not geometry and not a texture
 * — they are computed in the fragment shader from the lateral UV, so they never z-fight
 * with the asphalt and never blur at a grazing angle.
 */

interface CrossPoint {
  /** Metres from the centre line. */
  u: number;
  /** Height relative to the graded roadbed. */
  dy: number;
  color: number;
}

const CROSS: CrossPoint[] = [
  { u: -300, dy: -1.3, color: 0x151309 },
  { u: -110, dy: -1.0, color: 0x1f1a12 },
  { u: -34, dy: -0.75, color: 0x2a2318 },
  { u: -13, dy: -0.55, color: 0x342b1e },
  { u: -7.2, dy: -0.34, color: 0x3b3124 },
  { u: -4.4, dy: -0.07, color: 0x4a3f2e },
  { u: -3.75, dy: -0.02, color: 0x51452f },
  { u: -3.65, dy: 0.0, color: 0x333336 },
  { u: 0, dy: 0.08, color: 0x38383b },
  { u: 3.65, dy: 0.0, color: 0x333336 },
  { u: 3.75, dy: -0.02, color: 0x51452f },
  { u: 4.4, dy: -0.07, color: 0x4a3f2e },
  { u: 7.2, dy: -0.34, color: 0x3b3124 },
  { u: 13, dy: -0.55, color: 0x342b1e },
  { u: 34, dy: -0.75, color: 0x2a2318 },
  { u: 110, dy: -1.0, color: 0x1f1a12 },
  { u: 300, dy: -1.3, color: 0x151309 },
];

/** How far the marking phase repeats. Keeping local UVs small protects float precision. */
const DASH_CYCLE = 12;

export const ROAD_BEHIND = 12; // stations kept behind the bus, for the rear window
export const ROAD_AHEAD = 26;  // ~520 m, comfortably past the fog wall

export class Road {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private uvs: Float32Array;
  private colors: Float32Array;
  private readonly stations: number;
  private readonly cols = CROSS.length;

  constructor(private readonly path: RoutePath, private readonly seed: number) {
    this.stations = ROAD_BEHIND + ROAD_AHEAD + 1;
    const count = this.stations * this.cols;

    this.positions = new Float32Array(count * 3);
    this.uvs = new Float32Array(count * 2);
    this.colors = new Float32Array(count * 3);

    const indices: number[] = [];
    for (let s = 0; s < this.stations - 1; s++) {
      for (let c = 0; c < this.cols - 1; c++) {
        const a = s * this.cols + c;
        const b = a + 1;
        const d = a + this.cols;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(indices);

    const material = createRetroMaterial({
      mode: 'road',
      vertexColors: true,
      // The road is the one surface the player stares at for four hours; full vertex
      // snapping on quads this large turns into seasickness.
      snap: 0.35,
      // the ribbon is authored from one cross-section; double-siding it means the
      // winding can never quietly cull the ground away
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.rebuild();
  }

  /** Rewrite the ribbon from the current station window. Cheap: ~650 vertices. */
  rebuild(): void {
    const pts = this.path.points;
    const first = this.path.firstIndex;
    // preserve the dash phase across rebuilds while keeping v small
    const phase = (((first * STATION_SPACING) % DASH_CYCLE) + DASH_CYCLE) % DASH_CYCLE;

    const tmpColor = new THREE.Color();

    for (let s = 0; s < this.stations; s++) {
      const p = pts[Math.min(s, pts.length - 1)];
      const cos = Math.cos(p.heading);
      const sin = Math.sin(p.heading);
      // right-hand side of the direction of travel
      const rx = -cos;
      const rz = sin;
      const v = (p.index - first) * STATION_SPACING + phase;

      for (let c = 0; c < this.cols; c++) {
        const cp = CROSS[c];
        const i = (s * this.cols + c) * 3;
        const j = (s * this.cols + c) * 2;

        this.positions[i] = p.x + rx * cp.u;
        this.positions[i + 1] = p.y + cp.dy + terrainAt(p.index, cp.u, this.seed);
        this.positions[i + 2] = p.z + rz * cp.u;

        this.uvs[j] = cp.u;
        this.uvs[j + 1] = v;

        tmpColor.setHex(cp.color);
        this.colors[i] = tmpColor.r;
        this.colors[i + 1] = tmpColor.g;
        this.colors[i + 2] = tmpColor.b;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.uv.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
