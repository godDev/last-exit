import * as THREE from 'three';
import type { Passenger } from '../bus/passengers';
import { EYE_LOCAL, FLOOR_Y, type Cabin } from '../bus/interior';

type Stage = 'idle' | 'opening' | 'walking' | 'sitting' | 'closing' | 'returning';

export class BoardingCutscene {
  private stage: Stage = 'idle';
  private passenger: Passenger | null = null;
  private points: THREE.Vector3[] = [];
  private segmentLengths: number[] = [];
  private totalLength = 0;
  private distance = 0;
  private sitElapsed = 0;
  private walkCycle = 0;
  private returnElapsed = 0;
  private onFinished: (() => void) | null = null;
  private readonly position = new THREE.Vector3();
  private readonly targetLocal = new THREE.Vector3();
  private readonly targetWorld = new THREE.Vector3();
  private readonly eyeWorld = new THREE.Vector3();
  private readonly desiredDirection = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();

  constructor(private readonly cabin: Cabin) {}

  get active(): boolean { return this.stage !== 'idle'; }

  start(passenger: Passenger, onFinished: () => void): boolean {
    if (this.active) return false;
    const seat = passenger.seat;
    this.passenger = passenger;
    this.onFinished = onFinished;
    this.stage = 'opening';
    this.distance = 0;
    this.sitElapsed = 0;
    this.walkCycle = 0;
    this.returnElapsed = 0;
    this.viewDirection.set(0, 0, 0);

    // Feet follow the actual three-step entrance before turning into the aisle. The final
    // short diagonal is the passenger stepping sideways into their assigned seat.
    this.points = [
      new THREE.Vector3(3.35, 0.03, -4.68),
      new THREE.Vector3(2.35, 0.03, -4.68),
      new THREE.Vector3(2.02, 0.61, -4.68),
      new THREE.Vector3(1.7, 0.82, -4.68),
      new THREE.Vector3(1.28, FLOOR_Y, -4.68),
      new THREE.Vector3(0.25, FLOOR_Y, -4.32),
      new THREE.Vector3(0, FLOOR_Y, seat.z - 0.12),
      new THREE.Vector3(seat.x * 0.82, FLOOR_Y, seat.z),
    ];
    this.segmentLengths = [];
    this.totalLength = 0;
    for (let index = 0; index < this.points.length - 1; index++) {
      const length = this.points[index].distanceTo(this.points[index + 1]);
      this.segmentLengths.push(length);
      this.totalLength += length;
    }
    passenger.startBoarding(this.points[0]);
    this.cabin.setDoorOpen(true);
    return true;
  }

  update(dt: number): void {
    const passenger = this.passenger;
    if (!passenger) return;
    if (this.stage === 'opening') {
      passenger.setBoardingPose(this.points[0], Math.PI / 2, 0, 0);
      if (this.cabin.doorOpenAmount >= 0.96) this.stage = 'walking';
      return;
    }

    if (this.stage === 'walking') {
      const speed = 1.72;
      this.distance = Math.min(this.totalLength, this.distance + dt * speed);
      this.walkCycle += dt * speed / 0.72;
      const { position, direction } = this.samplePath(this.distance);
      const yaw = Math.atan2(-direction.x, -direction.z);
      passenger.setBoardingPose(position, yaw, this.walkCycle, 0);
      if (this.distance >= this.totalLength - 0.001) {
        this.stage = 'sitting';
        this.sitElapsed = 0;
      }
      return;
    }

    if (this.stage === 'sitting') {
      this.sitElapsed += dt;
      const sit = THREE.MathUtils.smoothstep(this.sitElapsed, 0.05, 1.05);
      const finalPoint = this.points[this.points.length - 1];
      passenger.setBoardingPose(finalPoint, passenger.spec.side < 0 ? -Math.PI / 2 : Math.PI / 2, this.walkCycle, sit);
      if (this.sitElapsed >= 1.12) {
        passenger.finishBoarding();
        this.cabin.setDoorOpen(false);
        this.stage = 'closing';
      }
      return;
    }

    if (this.stage === 'closing' && this.cabin.doorOpenAmount <= 0.035) {
      this.stage = 'returning';
      this.returnElapsed = 0;
      return;
    }

    if (this.stage === 'returning') {
      this.returnElapsed += dt;
      if (this.returnElapsed < 0.8) return;
      this.stage = 'idle';
      this.passenger = null;
      const finished = this.onFinished;
      this.onFinished = null;
      finished?.();
    }
  }

  placeCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    const passenger = this.passenger;
    if (!passenger) return;
    this.eyeWorld.copy(EYE_LOCAL);
    this.cabin.group.localToWorld(this.eyeWorld);
    camera.position.copy(this.eyeWorld);

    // The driver's eyes lead the passenger from the doorway into the aisle. Once the
    // passenger sits, keep looking toward their seat until the folding doors close.
    if (this.stage === 'returning') {
      this.desiredDirection.set(0, 0, -1).applyQuaternion(this.cabin.group.quaternion).normalize();
    } else {
      this.targetLocal.copy(passenger.object.position);
      this.targetLocal.y += this.stage === 'sitting' || this.stage === 'closing' ? 1.15 : 1.55;
      this.targetWorld.copy(this.targetLocal);
      this.cabin.group.localToWorld(this.targetWorld);
      this.desiredDirection.copy(this.targetWorld).sub(camera.position).normalize();
    }
    if (this.viewDirection.lengthSq() < 0.1) {
      this.viewDirection.set(0, 0, -1).applyQuaternion(this.cabin.group.quaternion).normalize();
    }
    const turn = 1 - Math.exp(-dt * 3.1);
    this.viewDirection.lerp(this.desiredDirection, turn).normalize();
    camera.up.set(0, 1, 0);
    camera.lookAt(this.targetWorld.copy(camera.position).add(this.viewDirection));
    if (Math.abs(camera.fov - 52) > 0.01) {
      camera.fov = 52;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  private samplePath(distance: number): { position: THREE.Vector3; direction: THREE.Vector3 } {
    let remaining = distance;
    for (let index = 0; index < this.segmentLengths.length; index++) {
      const length = this.segmentLengths[index];
      if (remaining <= length || index === this.segmentLengths.length - 1) {
        const start = this.points[index];
        const end = this.points[index + 1];
        const t = length > 0 ? THREE.MathUtils.clamp(remaining / length, 0, 1) : 1;
        this.position.lerpVectors(start, end, t);
        return { position: this.position, direction: end.clone().sub(start).normalize() };
      }
      remaining -= length;
    }
    return { position: this.position.copy(this.points[this.points.length - 1]), direction: new THREE.Vector3(1, 0, 0) };
  }
}
