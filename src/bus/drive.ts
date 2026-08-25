import * as THREE from 'three';
import type { Input } from '../core/input';
import type { RoutePath } from '../world/curvature';
import { STATION_SPACING, terrainAt } from '../world/curvature';
import { fbm1 } from '../core/rng';
import { METRES_PER_MILE, MPH_PER_MS } from '../core/units';

/**
 * A loaded 1970s coach, not a car. The point of the model is weight: it takes a long time
 * to get to 60, longer to stop, and the wheel has to be wound rather than flicked. Four
 * hours of night driving only works if the bus feels like it wants to go straight.
 */

export { METRES_PER_MILE } from '../core/units';

const LENGTH = 12.2;
const MAX_SPEED = 29.5;         // ~66 mph
const MAX_REVERSE_SPEED = 7.0;  // ~16 mph, still safely governed
const ACCEL = 1.15;             // m/s^2, loaded diesel
// A short coach reverse gear multiplies torque strongly. Keep it below forward launch
// acceleration on asphalt, but high enough to back out of sand without hovering at zero.
const REVERSE_ACCEL = 1.08;
const BRAKE = 4.2;
const ENGINE_BRAKE = 0.35;
const DRAG = 0.00055;

/** Full lock is 1/45 m^-1, but lateral acceleration caps long before that. */
const MAX_CURVATURE = 0.022;
const MAX_LATERAL_G = 3.4;      // m/s^2 before the coach protests

const WHEEL_RATE = 1.7;         // how fast the driver can wind the wheel, turns/s
const WHEEL_RETURN = 1.25;      // self-centring

// Geared so that top at a 55 mph cruise sits around 1800 rpm, where a coach actually runs
const GEAR_RATIOS = [0, 3.6, 2.1, 1.4, 0.95, 0.62];
const RPM_PER_MS = 112;         // engine rpm per m/s in 1:1

export type Surface = 'asphalt' | 'shoulder' | 'desert';

export class Bus {
  readonly position = new THREE.Vector3();
  heading = 0;
  speed = 0;

  /** -1..1, mirrored by the steering wheel on the dashboard. */
  wheelAngle = 0;
  yawRate = 0;

  /** Distance along route 17, metres. */
  distance = 0;
  /** Signed offset from the centre line, metres. Positive is the right shoulder. */
  lateral = 0;
  surface: Surface = 'asphalt';

  gear: number | 'R' = 1;
  rpm = 600;
  throttle = 0;
  braking = 0;
  highBeam = false;

  /** Body motion, consumed by the camera and by the cabin audio. */
  pitch = 0;
  roll = 0;
  heave = 0;
  rumble = 0;

  /** Short impulses layered on top of the normal suspension motion after a collision. */
  private impactPitch = 0;
  private impactRoll = 0;
  private impactHeave = 0;
  private impactCooldown = 0;

  private stationCursor = 0;
  private lastAccel = 0;
  private bobPhase = 0;

  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  /** Route distance at the depot gate. Mile 0 is here, not at station 0. */
  private readonly startDistance: number;

  constructor(
    private readonly path: RoutePath,
    private readonly seed: number,
    startStation = 0,
  ) {
    const start = path.at(startStation)!;
    this.position.set(start.x, start.y, start.z);
    this.heading = start.heading;
    this.stationCursor = startStation;
    this.startDistance = startStation * STATION_SPACING;
    this.distance = this.startDistance;
    // start in the right-hand lane, stopped at the depot gate
    this.applyLateral(1.85);
  }

  private applyLateral(offset: number): void {
    this.updateFrame();
    this.position.addScaledVector(this.right, offset);
  }

  private updateFrame(): void {
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(-Math.cos(this.heading), 0, Math.sin(this.heading));
  }

  /**
   * Cruise control for the hands as well as the feet. Not a cheat so much as a tripod:
   * with the wheel held for you it is possible to actually look at the thing being built.
   */
  autopilot = false;
  autopilotSpeed = 26;

  private steerToLane(): void {
    // aim at a point down the road, in the right-hand lane, the way a driver does
    const aim = this.path.sample(this.distance + 40 + this.speed * 1.1);
    const rx = -Math.cos(aim.heading);
    const rz = Math.sin(aim.heading);
    const tx = aim.pos.x + rx * 1.85;
    const tz = aim.pos.z + rz * 1.85;

    const wanted = Math.atan2(tx - this.position.x, tz - this.position.z);
    let error = wanted - this.heading;
    while (error > Math.PI) error -= Math.PI * 2;
    while (error < -Math.PI) error += Math.PI * 2;

    this.wheelAngle = THREE.MathUtils.clamp(error * 4.5, -1, 1);
  }

  update(dt: number, input: Input): void {
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    this.throttle = input.isDown('throttle') ? 1 : 0;
    this.braking = input.isDown('brake') ? 1 : 0;
    // Positive wheel angle is a left turn, matching both heading convention and the
    // counter-clockwise motion of the wheel as seen by the driver.
    let steer = input.axis('right', 'left');

    if (this.autopilot) {
      this.steerToLane();
      this.throttle = this.speed < this.autopilotSpeed ? 1 : 0;
      this.braking = this.speed > this.autopilotSpeed + 2 ? 0.4 : 0;
      steer = 0;
    }

    // --- steering wheel -----------------------------------------------------
    if (this.autopilot) {
      // wheelAngle is already set by the lane follower
    } else if (steer !== 0) {
      this.wheelAngle = THREE.MathUtils.clamp(this.wheelAngle + steer * WHEEL_RATE * dt, -1, 1);
    } else {
      const decay = WHEEL_RETURN * dt * (0.35 + Math.min(1, Math.abs(this.speed) / 14));
      this.wheelAngle -= Math.sign(this.wheelAngle) * Math.min(Math.abs(this.wheelAngle), decay);
    }

    // --- longitudinal -------------------------------------------------------
    const grip = this.surface === 'asphalt' ? 1 : this.surface === 'shoulder' ? 0.82 : 0.55;
    let accel = 0;
    if (this.autopilot) {
      accel += this.throttle * ACCEL * grip;
      accel -= this.braking * BRAKE;
    } else {
      const forwardPedal = input.isDown('throttle');
      const reversePedal = input.isDown('brake');
      if (this.speed > 0.08) {
        accel += forwardPedal ? ACCEL * grip : 0;
        accel -= reversePedal ? BRAKE : 0;
      } else if (this.speed < -0.08) {
        // Reverse gear provides extra low-speed torque on loose surfaces. This is capped
        // by the surface speed limit below, so it improves extraction rather than making
        // high-speed reversing effective.
        const reverseGrip = this.surface === 'desert' ? 0.72 : this.surface === 'shoulder' ? 0.9 : 1;
        accel -= reversePedal ? REVERSE_ACCEL * reverseGrip : 0;
        accel += forwardPedal ? BRAKE : 0;
      } else if (reversePedal && !forwardPedal) {
        const reverseGrip = this.surface === 'desert' ? 0.72 : this.surface === 'shoulder' ? 0.9 : 1;
        accel = -REVERSE_ACCEL * reverseGrip;
      } else if (forwardPedal && !reversePedal) {
        accel = ACCEL * grip;
      }

      // Public pedal values describe engine load and service braking, not raw keys.
      // In reverse S is the accelerator and W becomes the brake.
      this.throttle = this.speed < -0.08 ? (reversePedal ? 1 : 0) : (forwardPedal ? 1 : 0);
      this.braking = this.speed > 0.08
        ? (reversePedal ? 1 : 0)
        : this.speed < -0.08
          ? (forwardPedal ? 1 : 0)
          : 0;
    }

    if (this.throttle === 0 && this.braking === 0 && Math.abs(this.speed) > 0.01) {
      accel -= Math.sign(this.speed) * ENGINE_BRAKE;
    }
    accel -= Math.sign(this.speed) * DRAG * this.speed * this.speed;
    if (this.surface !== 'asphalt' && Math.abs(this.speed) > 0.01) {
      // Loose ground must make the loaded coach feel slow and heavy, but resistance must
      // remain below the tractive effort available at full throttle. The previous desert
      // value (0.95) exceeded ACCEL * grip (about 0.63), so the bus always decelerated to
      // zero and appeared to stall. Fade resistance in at walking speed so it can also
      // pull away cleanly after stopping in the field.
      const rollingResistance = this.surface === 'desert' ? 0.38 : 0.18;
      const rollingSpeed = Math.min(1, Math.abs(this.speed) / 1.5);
      accel -= Math.sign(this.speed) * rollingResistance * rollingSpeed;
    }

    const previousSpeed = this.speed;
    this.speed = THREE.MathUtils.clamp(
      this.speed + accel * dt,
      -MAX_REVERSE_SPEED * grip,
      MAX_SPEED * grip,
    );
    // Braking must stop at zero instead of instantly crossing into the opposite gear.
    if ((previousSpeed > 0.08 && this.speed < 0) || (previousSpeed < -0.08 && this.speed > 0)) this.speed = 0;
    this.lastAccel += (accel - this.lastAccel) * Math.min(1, dt * 6);

    // --- yaw ----------------------------------------------------------------
    const wanted = this.wheelAngle * MAX_CURVATURE * this.speed;
    const absSpeed = Math.abs(this.speed);
    const cap = absSpeed > 1 ? MAX_LATERAL_G / absSpeed : 0.9;
    this.yawRate = THREE.MathUtils.clamp(wanted, -cap, cap);
    this.heading += this.yawRate * dt;

    this.updateFrame();
    this.position.addScaledVector(this.forward, this.speed * dt);

    this.trackRoute();
    this.updateDrivetrain(dt);
    this.updateBody(dt);
  }

  /**
   * Resolve an impact against a static obstacle. The bus has a scalar forward velocity,
   * so the sideways impulse becomes displacement and yaw while the forward component is
   * removed as lost speed. Returns true only for the first frame of a distinct impact.
   */
  impact(normal: THREE.Vector3, penetration: number): boolean {
    // Always separate the body so it cannot remain embedded when the cooldown is active.
    this.position.addScaledVector(normal, Math.max(0.03, penetration + 0.04));
    if (this.impactCooldown > 0) return false;

    this.updateFrame();
    const side = THREE.MathUtils.clamp(normal.dot(this.right), -1, 1);
    const frontal = Math.max(0, -normal.dot(this.forward));
    const severity = THREE.MathUtils.clamp(Math.abs(this.speed) / 18, 0.18, 1);

    // A glancing scrape retains more momentum; a square hit sheds most of it.
    const retained = THREE.MathUtils.clamp(0.58 - frontal * 0.32 + Math.abs(side) * 0.18, 0.18, 0.72);
    this.speed *= retained;
    this.heading += side * (0.055 + severity * 0.09);
    this.wheelAngle = THREE.MathUtils.clamp(this.wheelAngle + side * 0.38, -1, 1);
    this.yawRate += side * severity * 0.42;

    this.impactPitch -= (0.025 + frontal * 0.055) * severity;
    this.impactRoll += side * (0.045 + severity * 0.075);
    this.impactHeave += 0.025 + severity * 0.045;
    this.rumble = Math.max(this.rumble, 0.9);
    this.impactCooldown = 0.42;
    return true;
  }

  /** Project the free-moving bus back onto the route to get mile and lane position. */
  private trackRoute(): void {
    const pts = this.path.points;
    const clampIndex = (i: number) =>
      Math.min(pts[pts.length - 2].index, Math.max(pts[0].index, i));

    this.stationCursor = clampIndex(this.stationCursor);

    const project = (index: number) => {
      const a = this.path.at(index)!;
      const fx = Math.sin(a.heading);
      const fz = Math.cos(a.heading);
      const dx = this.position.x - a.x;
      const dz = this.position.z - a.z;
      return { along: dx * fx + dz * fz, lateral: dz * fx - dx * fz, a };
    };

    let p = project(this.stationCursor);
    let guard = 0;
    while (p.along > STATION_SPACING && guard++ < 64) {
      const next = clampIndex(this.stationCursor + 1);
      if (next === this.stationCursor) break;
      this.stationCursor = next;
      p = project(this.stationCursor);
    }
    while (p.along < 0 && guard++ < 64) {
      const prev = clampIndex(this.stationCursor - 1);
      if (prev === this.stationCursor) break;
      this.stationCursor = prev;
      p = project(this.stationCursor);
    }

    this.distance = this.stationCursor * STATION_SPACING + p.along;
    this.lateral = p.lateral;

    const a = Math.abs(this.lateral);
    this.surface = a <= 3.65 ? 'asphalt' : a <= 7.2 ? 'shoulder' : 'desert';

    // follow the roadbed vertically
    const ground = this.path.sample(this.distance).pos.y;
    this.position.y += (ground - this.position.y) * 0.25;
  }

  private updateDrivetrain(dt: number): void {
    const absSpeed = Math.abs(this.speed);
    if (this.speed < -0.05) {
      this.gear = 'R';
      const targetRpm = Math.max(620, absSpeed * RPM_PER_MS * 3.9);
      this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 5);
      return;
    }
    if (this.gear === 'R') this.gear = 1;
    const targetRpm = Math.max(560, absSpeed * RPM_PER_MS * GEAR_RATIOS[this.gear]);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 5);
    if (this.rpm > 2150 && this.gear < GEAR_RATIOS.length - 1) this.gear++;
    else if (this.rpm < 1050 && this.gear > 1) this.gear--;
  }

  private updateBody(dt: number): void {
    const absSpeed = Math.abs(this.speed);
    this.bobPhase += dt * (2.2 + absSpeed * 0.24);

    // expansion joints in the concrete, felt more than heard
    const seam = fbm1(this.distance * 0.09, this.seed + 4001, 2);
    const gravel = this.surface === 'asphalt' ? 0 : this.surface === 'shoulder' ? 0.55 : 1;
    this.rumble += (gravel * Math.min(1, absSpeed / 12) - this.rumble) * Math.min(1, dt * 8);

    const speedScale = Math.min(1, absSpeed / 20);
    this.impactPitch *= Math.pow(0.035, dt);
    this.impactRoll *= Math.pow(0.045, dt);
    this.impactHeave *= Math.pow(0.025, dt);

    const targetHeave =
      seam * 0.022 * speedScale +
      Math.sin(this.bobPhase * 1.7) * 0.008 * speedScale +
      (Math.random() - 0.5) * 0.05 * this.rumble +
      this.impactHeave;
    this.heave += (targetHeave - this.heave) * Math.min(1, dt * 12);

    const targetPitch = -this.lastAccel * 0.012 + Math.sin(this.bobPhase * 0.9) * 0.0025 + this.impactPitch;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);

    const latG = this.yawRate * this.speed;
    const targetRoll = -latG * 0.02 + (Math.random() - 0.5) * 0.006 * this.rumble + this.impactRoll;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 5);
  }

  get miles(): number { return (this.distance - this.startDistance) / METRES_PER_MILE; }
  get speedMph(): number { return Math.abs(this.speed) * MPH_PER_MS; }

  /** Restore a parked coach to a route mile after the path window has been prepared. */
  restoreMiles(miles: number): void {
    const distance = this.startDistance + Math.max(0, miles) * METRES_PER_MILE;
    const sample = this.path.sample(distance);
    this.distance = distance;
    this.stationCursor = Math.floor(distance / STATION_SPACING);
    this.position.copy(sample.pos);
    this.heading = sample.heading;
    this.speed = 0;
    this.wheelAngle = 0;
    this.yawRate = 0;
    // Story stops and restored saves must not leave the audio model believing the driver
    // still has the pedal down at motorway speed while the coach is frozen in place.
    this.throttle = 0;
    this.braking = 0;
    this.gear = 1;
    this.rpm = 620;
    this.lastAccel = 0;
    this.rumble = 0;
    this.updateFrame();
    this.position.addScaledVector(this.right, 1.85);
  }

  /** World-space point from bus-local (right, up, forward) metres. */
  localToWorld(right: number, up: number, forward: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.updateFrame();
    return out
      .copy(this.position)
      .addScaledVector(this.right, right)
      .addScaledVector(this.forward, forward)
      .setY(this.position.y + up);
  }

  get forwardVector(): THREE.Vector3 { this.updateFrame(); return this.forward; }
  get rightVector(): THREE.Vector3 { this.updateFrame(); return this.right; }

  /** Approximate the procedural road/field surface beneath an arbitrary nearby point. */
  groundHeightAt(position: THREE.Vector3): number {
    this.updateFrame();
    const fromBusX = position.x - this.position.x;
    const fromBusZ = position.z - this.position.z;
    const along = fromBusX * this.forward.x + fromBusZ * this.forward.z;
    const sampleDistance = this.distance + along;
    const frame = this.path.sample(sampleDistance);
    const routeRightX = -Math.cos(frame.heading);
    const routeRightZ = Math.sin(frame.heading);
    const dx = position.x - frame.pos.x;
    const dz = position.z - frame.pos.z;
    const lateral = dx * routeRightX + dz * routeRightZ;
    const a = Math.abs(lateral);

    let graded = 0;
    if (a <= 3.65) graded = 0.08 * (1 - a / 3.65);
    else if (a <= 4.4) graded = THREE.MathUtils.lerp(0, -0.07, (a - 3.65) / 0.75);
    else if (a <= 7.2) graded = THREE.MathUtils.lerp(-0.07, -0.34, (a - 4.4) / 2.8);
    else if (a <= 13) graded = THREE.MathUtils.lerp(-0.34, -0.55, (a - 7.2) / 5.8);
    else graded = -0.55 - Math.min(0.45, (a - 13) * 0.008);

    return frame.pos.y + graded + terrainAt(Math.floor(sampleDistance / STATION_SPACING), lateral, this.seed);
  }

  get headlightLeft(): THREE.Vector3 { return this.localToWorld(-1.02, 0.95, LENGTH * 0.5); }
  get headlightRight(): THREE.Vector3 { return this.localToWorld(1.02, 0.95, LENGTH * 0.5); }

  shift(offset: THREE.Vector3): void { this.position.sub(offset); }
}
