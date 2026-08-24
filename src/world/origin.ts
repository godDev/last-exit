import * as THREE from 'three';

export interface Shiftable {
  shift(offset: THREE.Vector3): void;
}

/**
 * Route 17 is 400 miles long. In float32, coordinates past a few tens of kilometres lose
 * enough precision that geometry visibly crawls and the vertex snapping starts to strobe.
 * So the world is periodically pulled back to the origin instead of letting the bus run away
 * from it. Nothing outside this class needs to know it happened.
 */
export class FloatingOrigin {
  private readonly members: Shiftable[] = [];
  private readonly offset = new THREE.Vector3();
  /** How far the world has been pulled back in total — debug readout only. */
  readonly total = new THREE.Vector3();
  rebases = 0;

  constructor(private readonly threshold = 4000) {}

  add(...members: Shiftable[]): void {
    this.members.push(...members);
  }

  /** Call once per frame with the bus position. Returns true if the world moved. */
  update(anchor: THREE.Vector3): boolean {
    if (anchor.lengthSq() < this.threshold * this.threshold) return false;
    this.offset.set(anchor.x, 0, anchor.z);
    for (const m of this.members) m.shift(this.offset);
    this.total.add(this.offset);
    this.rebases++;
    return true;
  }
}
