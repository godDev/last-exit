import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { canvasTexture } from '../render/textures';
import { LAYER_DIRECT_ONLY } from './mirror';
import { createPBRMaterial } from '../render/pbrMaterial';

/**
 * The driver's station.
 *
 * Speed, revs, mileage and the time are not HUD text — they are objects the driver has to
 * look down at, which is the only way the clock reaching 06:00 ever means anything.
 *
 * Cabin-local axes match the camera: -Z is forward, +X is the kerb side, +Y is up, and the
 * eye sits at (DRIVER_X, 2.05, -4.90). Everything below is placed by its angle from that
 * eye, because in a cab the only question that matters is whether the driver can see it:
 *
 *   dash top surface   13 - 22 degrees down     the ledge he looks over
 *   instrument pod     ~11 degrees down          clears the ledge, reads at a glance
 *   top of the wheel   ~22 degrees down          frames the pod from below
 *
 * The other constraint is depth. The dash has to stop well forward of the wheel, or the
 * cowl swallows both the rim and the bottom half of the gauges.
 */

const GAUGE_START = 2.36;  // needle angle at minimum, radians
const GAUGE_END = -2.36;   // and at maximum

// --- the driver station, in cabin-local metres --------------------------------
const DASH_Z = -5.92;        // centre of the cowl
const DASH_FACE_Z = -5.72;   // the face turned towards the driver; nothing may go behind it
const POD_Z = -5.86;
const POD_Y = 1.82;
const WHEEL_Z = -5.34;
const WHEEL_Y = 1.7;
const WHEEL_RADIUS = 0.225;
/** Tilt of the column, and therefore of the wheel: 34 degrees off horizontal, coach style. */
const COLUMN_TILT = 0.588;
/** Rake of the instrument pod, shared by the gauges, the clock and the radio. */
const POD_TILT = 0.42;

export interface DashboardActions {
  radioPowerPress: boolean;
  radioSeekDirection: number;
  radioTuneDirection: number;
}

/**
 * The pod's own axes in cabin space. The gauge faces look along +normal; anything meant to
 * sit behind them has to be offset along -normal, which is the mistake worth naming: a
 * housing placed at the same point as the dials simply covers them.
 */
const POD_NORMAL = { y: Math.sin(POD_TILT), z: Math.cos(POD_TILT) };
const POD_UP = { y: Math.cos(POD_TILT), z: -Math.sin(POD_TILT) };

function behindPod(distance: number): [number, number] {
  return [POD_Y - POD_NORMAL.y * distance, POD_Z - POD_NORMAL.z * distance];
}

function faceTexture(
  label: string,
  ticks: number,
  labelEvery: number,
  maxValue: number,
  unit: string,
): THREE.CanvasTexture {
  return canvasTexture(160, 160, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;

    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#4a4238';
    ctx.lineWidth = 3;
    ctx.stroke();

    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      const angle = GAUGE_START + (GAUGE_END - GAUGE_START) * t;
      const dx = -Math.sin(angle);
      const dy = -Math.cos(angle);
      const major = i % labelEvery === 0;

      ctx.strokeStyle = major ? '#e8d8b8' : '#6f6553';
      ctx.lineWidth = major ? 5 : 2;
      const outer = w / 2 - 8;
      const inner = outer - (major ? 18 : 10);
      ctx.beginPath();
      ctx.moveTo(cx + dx * inner, cy + dy * inner);
      ctx.lineTo(cx + dx * outer, cy + dy * outer);
      ctx.stroke();

      if (major) {
        ctx.fillStyle = '#d9c9a8';
        ctx.font = 'bold 21px "Arial Narrow", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(t * maxValue)), cx + dx * (inner - 16), cy + dy * (inner - 16));
      }
    }

    ctx.fillStyle = '#8d8271';
    ctx.font = '13px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(unit, cx, cy + 36);
    ctx.font = '10px "Arial Narrow", Arial, sans-serif';
    ctx.fillStyle = '#5f574a';
    ctx.fillText(label, cx, cy + 52);
  });
}

/**
 * The dial glass of an AM set: a lit scale with the callsign printed under it. Redrawn
 * only when the words change — the needle is a mesh and slides for free.
 */
function dialFace(
  readout: string,
  powered: boolean,
  existing?: THREE.CanvasTexture,
): THREE.CanvasTexture {
  return canvasTexture(
    320,
    80,
    (ctx, w, h) => {
      ctx.fillStyle = powered ? '#241605' : '#0a0a0c';
      ctx.fillRect(0, 0, w, h);

      if (powered) {
        const glow = ctx.createLinearGradient(0, 0, 0, h);
        glow.addColorStop(0, 'rgba(255,170,60,0.30)');
        glow.addColorStop(1, 'rgba(255,120,20,0.05)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
      }

      const ink = powered ? '#ffd79a' : '#3a352c';
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.font = 'bold 15px "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // the printed band, 55 through 170, the way it was on the glass
      for (let khz = 550; khz <= 1700; khz += 100) {
        const x = ((khz - 505) / (1700 - 505)) * (w - 16) + 8;
        const major = (khz - 550) % 200 === 0;
        ctx.lineWidth = major ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 6);
        ctx.lineTo(x, major ? 22 : 15);
        ctx.stroke();
        if (major) ctx.fillText(String(khz / 10), x, 24);
      }

      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 17px "Arial Narrow", Arial, sans-serif';
      ctx.fillText(readout, w / 2, h - 5);
    },
    existing,
  );
}

function ledPanel(
  text: string,
  colour: string,
  width = 128,
  height = 48,
  existing?: THREE.CanvasTexture,
): THREE.CanvasTexture {
  return canvasTexture(
    width,
    height,
    (ctx, w, h) => {
      ctx.fillStyle = '#07070a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = colour;
      ctx.font = `bold ${Math.round(h * 0.66)}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 1);
    },
    existing,
  );
}

export class Dashboard {
  readonly group = new THREE.Group();
  readonly wheel = new THREE.Group();

  private readonly speedNeedle = new THREE.Mesh();
  private readonly revNeedle = new THREE.Mesh();
  private clockTexture: THREE.CanvasTexture;
  private odoTexture: THREE.CanvasTexture;
  private lastClock = '';
  private lastOdo = -1;
  private highBeamLamp: THREE.Mesh;
  private dialTexture: THREE.CanvasTexture;
  private dialNeedle: THREE.Mesh;
  private lastDialText = '';
  private lastPowered = false;
  private readonly dialWidth = 0.29;
  private readonly stalk = new THREE.Group();
  private readonly gearStick = new THREE.Group();
  private readonly radioPowerButton = new THREE.Mesh();
  private readonly radioTuneKnob = new THREE.Group();
  private readonly radioPowerHandTarget = new THREE.Object3D();
  private readonly radioTuneHandTarget = new THREE.Object3D();
  private readonly clutchPedal = new THREE.Group();
  private readonly brakePedal = new THREE.Group();
  private readonly acceleratorPedal = new THREE.Group();
  private readonly leftBoot = new THREE.Group();
  private readonly rightBoot = new THREE.Group();
  private readonly leftThigh = new THREE.Mesh();
  private readonly leftShin = new THREE.Mesh();
  private readonly leftKnee = new THREE.Mesh();
  private readonly rightThigh = new THREE.Mesh();
  private readonly rightShin = new THREE.Mesh();
  private readonly rightKnee = new THREE.Mesh();
  private readonly torso = new THREE.Group();
  private readonly leftShoulderAnchor = new THREE.Object3D();
  private readonly rightShoulderAnchor = new THREE.Object3D();
  private readonly leftUpperArm = new THREE.Mesh();
  private readonly leftForearm = new THREE.Mesh();
  private readonly rightUpperArm = new THREE.Mesh();
  private readonly rightForearm = new THREE.Mesh();
  private readonly leftElbowJoint = new THREE.Mesh();
  private readonly rightElbowJoint = new THREE.Mesh();
  private readonly leftHand = new THREE.Group();
  private readonly rightHand = new THREE.Group();
  private readonly rightCuff = new THREE.Mesh();
  private readonly gearHandTarget = new THREE.Object3D();
  private readonly legFrom = new THREE.Vector3();
  private readonly legTo = new THREE.Vector3();
  private readonly legMid = new THREE.Vector3();
  private readonly legDirection = new THREE.Vector3();
  private readonly legUp = new THREE.Vector3(0, 1, 0);
  private readonly armUp = new THREE.Vector3(0, 1, 0);
  private readonly leftShoulder = new THREE.Vector3();
  private readonly rightShoulder = new THREE.Vector3();
  private readonly leftElbow = new THREE.Vector3();
  private readonly rightElbow = new THREE.Vector3();
  private readonly leftGrip = new THREE.Vector3();
  private readonly rightGrip = new THREE.Vector3();
  private readonly gearGrip = new THREE.Vector3();
  private readonly radioGrip = new THREE.Vector3();
  private readonly shiftElbow = new THREE.Vector3();
  private readonly radioElbow = new THREE.Vector3();
  private readonly armDirection = new THREE.Vector3();
  private readonly armElbowBase = new THREE.Vector3();
  private readonly armBendDirection = new THREE.Vector3();
  private readonly gearHandDirection = new THREE.Vector3(0, -1, -0.18).normalize();
  private readonly gearHandQuaternion = new THREE.Quaternion();
  private readonly wheelGripLeft = new THREE.Vector3();
  private readonly wheelGripRight = new THREE.Vector3();
  private readonly leftWheelTarget = new THREE.Vector3();
  private readonly rightWheelTarget = new THREE.Vector3();
  private readonly leftFingerJoints: THREE.Group[] = [];
  private readonly rightFingerJoints: THREE.Group[] = [];
  private readonly leftThumbJoints: THREE.Group[] = [];
  private readonly rightThumbJoints: THREE.Group[] = [];
  private lastGear: number | 'R' | null = null;
  private lastMoving = false;
  private clutchTime = 0;
  private shiftHandTime = 0;
  private readonly shiftHandDuration = 0.92;
  private radioMode: 'idle' | 'power' | 'tune' | 'seek' = 'idle';
  private radioPhase: 'reach' | 'operate' | 'return' = 'reach';
  private radioPhaseTime = 0;
  private radioHandBlend = 0;
  private radioBodyLean = 0;
  private radioDirection = 0;
  private radioMinimumTuneTime = 0;
  private pendingRadioPower = 0;
  private pendingRadioSeek = 0;
  private readonly dashboardActions: DashboardActions = {
    radioPowerPress: false,
    radioSeekDirection: 0,
    radioTuneDirection: 0,
  };

  private driverVisible = true;

  constructor(private readonly driverX: number) {
    // Dark, but with enough value separation for the moulded layers to remain legible
    // under the restrained cabin light.
    const shell = createRetroMaterial({
      color: 0x25231f,
      fogScale: 0,
      ambientBoost: 1.65,
      cabin: 0.72,
      snap: 0.2,
    });
    const trim = createRetroMaterial({
      color: 0x181714,
      fogScale: 0,
      ambientBoost: 1.55,
      cabin: 0.68,
      snap: 0.2,
    });
    const dashTop = createRetroMaterial({ color: 0x312e28, fogScale: 0, ambientBoost: 1.75, cabin: 0.7, roughness: 0.86, snap: 0.16 });
    const fasciaMaterial = createRetroMaterial({ color: 0x292722, fogScale: 0, ambientBoost: 1.68, cabin: 0.74, roughness: 0.72, snap: 0.16 });
    const podMaterial = createRetroMaterial({ color: 0x35312b, fogScale: 0, ambientBoost: 1.82, cabin: 0.76, roughness: 0.62, snap: 0.14 });

    // --- the moulded dash ---------------------------------------------------
    // Shallow and pushed forward: it ends 36 cm ahead of the wheel hub instead of
    // reaching back over it.
    // The cowl and the fascia below it are tilted in opposite directions to follow the
    // dash's compound curve (see the eye-line angles at the top of this file). Built at
    // their visible thickness alone, that opposite tilt opens a sliver of a gap right at
    // the seam between them once the driver's free-look pitch strays from dead level —
    // reading as a stray dark plane hanging in front of the gauges. The cowl is the
    // farther of the two from the eye, so thickening it downward, well behind the
    // fascia's visible face, closes that gap without changing anything the default,
    // straight-ahead view shows.
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.24, 0.4), dashTop);
    cowl.position.set(0, 1.62, DASH_Z);
    cowl.rotation.x = -0.12;

    // Keep the fascia shallow below the gauges. A full-height rectangular slab crosses
    // the driver's downward view and hides the animated knees and pedals.
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.26, 0.09), fasciaMaterial);
    fascia.position.set(0, 1.6, DASH_FACE_Z);
    fascia.rotation.x = 0.18;

    // The lower dash has a real driver footwell instead of one solid black box. Only the
    // narrow outer return and passenger-side panel remain around the opening.
    const leftKneeReturn = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, 0.32), shell);
    leftKneeReturn.position.set(-1.16, 1.2, -5.9);
    const passengerKneePanel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.26, 0.32), shell);
    passengerKneePanel.position.set(0.48, 1.2, -5.9);

    this.group.add(cowl, fascia, leftKneeReturn, passengerKneePanel);

    // Layered vinyl panels, seams and visible fasteners keep the broad dashboard from
    // reading as three primitive boxes from the driver's seat.
    const seamMaterial = createRetroMaterial({ color: 0x4a4337, fogScale: 0, ambientBoost: 2.2, cabin: 0.9, snap: 0.15 });
    // Raised piping at the front edge catches a narrow highlight and separates the top
    // pad from the vertical fascia instead of letting both merge into one rectangle.
    const dashPiping = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.018, 0.022), seamMaterial);
    dashPiping.position.set(0, 1.69, DASH_FACE_Z + 0.055);
    dashPiping.rotation.x = 0.08;
    this.group.add(dashPiping);
    for (const x of [-1.02, -0.46, 0.36, 0.98]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.27, 0.012), seamMaterial);
      seam.position.set(x, 1.52, DASH_FACE_Z + 0.052);
      seam.rotation.x = 0.18;
      this.group.add(seam);
    }
    for (const x of [-1.12, -0.34, 0.42, 1.12]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 8), seamMaterial);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(x, 1.61, DASH_FACE_Z + 0.063);
      this.group.add(screw);
    }

    // Two recessed demister vents with individual slats.
    for (const ventX of [-1.02, 0.72]) {
      const vent = new THREE.Group();
      vent.position.set(ventX, 1.735, DASH_Z + 0.055);
      vent.rotation.x = -0.12;
      const recess = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.018, 0.085), trim);
      vent.add(recess);
      for (let i = -3; i <= 3; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.07), seamMaterial);
        slat.position.x = i * 0.038;
        vent.add(slat);
      }
      this.group.add(vent);
    }

    // --- the instrument pod ---------------------------------------------------
    // The housing goes 11 cm along -normal, i.e. behind the dial faces. Put it at the same
    // point as the cluster and it hides every gauge in the bus.
    const [bodyY, bodyZ] = behindPod(0.11);
    const podBody = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.25, 0.2), podMaterial);
    podBody.position.set(driverX, bodyY, bodyZ);
    podBody.rotation.x = -POD_TILT;
    this.group.add(podBody);

    // a thin lip along the top, kept shallow so it does not cross the horizon
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.032, 0.1), dashTop);
    hood.position.set(driverX, POD_Y + POD_UP.y * 0.13, POD_Z + POD_UP.z * 0.13);
    hood.rotation.x = -0.52;
    this.group.add(hood);

    const cluster = new THREE.Group();
    cluster.position.set(driverX, POD_Y, POD_Z);
    cluster.rotation.x = -POD_TILT;
    this.group.add(cluster);

    // Slightly larger than a real coach cluster. At 480x270 a 12 cm dial is twenty pixels
    // across and unreadable; this is the smallest that still reads at a glance.
    const speedFace = this.buildGauge(
      faceTexture('WESTERN TRAILS', 8, 2, 80, 'M.P.H.'),
      0.1,
      -0.115,
      this.speedNeedle,
    );
    const revFace = this.buildGauge(
      faceTexture('DIESEL', 6, 2, 30, 'RPM x100'),
      0.075,
      0.135,
      this.revNeedle,
    );
    cluster.add(speedFace, revFace);

    // Auxiliary pressure and temperature dials complete the heavy-vehicle cluster.
    const auxNeedleA = new THREE.Mesh();
    const auxNeedleB = new THREE.Mesh();
    const air = this.buildGauge(faceTexture('AIR', 4, 2, 12, 'BAR'), 0.045, 0.025, auxNeedleA);
    air.position.y = -0.064;
    const temp = this.buildGauge(faceTexture('WATER', 4, 2, 120, 'C'), 0.045, 0.135, auxNeedleB);
    temp.position.y = -0.068;
    auxNeedleA.rotation.z = -0.35;
    auxNeedleB.rotation.z = 0.4;
    cluster.add(air, temp);

    // odometer, set into the face of the speedometer like the real thing
    this.odoTexture = ledPanel('00000.0', '#cfc6b2', 128, 32);
    const odo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.105, 0.026),
      createRetroMaterial({ map: this.odoTexture, mode: 'emissive', emissive: 0.75, snap: 0.2 }),
    );
    odo.position.set(-0.115, -0.042, 0.012);
    cluster.add(odo);

    // --- high beam telltale, between the dials --------------------------------
    this.highBeamLamp = new THREE.Mesh(
      new THREE.CircleGeometry(0.013, 8),
      createRetroMaterial({ color: 0x3366dd, mode: 'emissive', emissive: 0.1, snap: 0.2 }),
    );
    this.highBeamLamp.position.set(0.014, 0.062, 0.012);
    cluster.add(this.highBeamLamp);

    // --- clock, on the cowl to the left of the pod ----------------------------
    this.clockTexture = ledPanel('22:30', '#63e08a', 128, 48);
    const clock = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.056),
      createRetroMaterial({ map: this.clockTexture, mode: 'emissive', emissive: 0.9, snap: 0.2 }),
    );
    clock.position.set(driverX - 0.4, POD_Y - 0.02, POD_Z + 0.01);
    clock.rotation.x = -POD_TILT;
    this.group.add(clock);

    // --- the radio, on the cowl on the kerb side of the pod --------------------
    const radio = new THREE.Group();
    // Centre-dash would be authentic and useless: at this eye position it lands past the
    // right edge of a 16:9 frame.
    radio.position.set(-0.26, POD_Y - 0.02, POD_Z + 0.01);
    radio.rotation.x = -POD_TILT;
    this.group.add(radio);

    const bezel = new THREE.Mesh(new THREE.BoxGeometry(this.dialWidth + 0.05, 0.115, 0.05), trim);
    bezel.position.z = -0.025;
    radio.add(bezel);

    this.dialTexture = dialFace('', false);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(this.dialWidth, 0.072),
      createRetroMaterial({ map: this.dialTexture, mode: 'emissive', emissive: 1, snap: 0.2 }),
    );
    glass.position.z = 0.003;
    radio.add(glass);

    this.dialNeedle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.005, 0.066),
      createRetroMaterial({ color: 0xff4a2a, mode: 'emissive', emissive: 1.4, snap: 0.2 }),
    );
    this.dialNeedle.position.z = 0.005;
    radio.add(this.dialNeedle);

    const radioControlX = this.dialWidth / 2 + 0.042;
    const powerBezel = new THREE.Mesh(
      new THREE.TorusGeometry(0.019, 0.004, 6, 14),
      createRetroMaterial({ color: 0x665e52, fogScale: 0, ambientBoost: 2.25, cabin: 1, snap: 0.16 }),
    );
    powerBezel.position.set(-radioControlX, 0, 0.012);
    radio.add(powerBezel);
    this.radioPowerButton.geometry = new THREE.CylinderGeometry(0.014, 0.014, 0.019, 10);
    this.radioPowerButton.material = createRetroMaterial({ color: 0x9d4b35, fogScale: 0, ambientBoost: 2.5, cabin: 1.08, snap: 0.14 });
    this.radioPowerButton.rotation.x = Math.PI / 2;
    this.radioPowerButton.position.set(-radioControlX, 0, 0.02);
    radio.add(this.radioPowerButton);
    this.radioPowerHandTarget.position.set(-radioControlX, 0, 0.065);
    radio.add(this.radioPowerHandTarget);

    this.radioTuneKnob.position.set(radioControlX, 0, 0.018);
    const tuneKnobBody = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.034, 12), trim);
    tuneKnobBody.rotation.x = Math.PI / 2;
    this.radioTuneKnob.add(tuneKnobBody);
    const tuneMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.017, 0.006),
      createRetroMaterial({ color: 0xd3c4a4, fogScale: 0, ambientBoost: 2.5, cabin: 1.1, snap: 0.12 }),
    );
    tuneMarker.position.set(0, 0.012, 0.02);
    this.radioTuneKnob.add(tuneMarker);
    radio.add(this.radioTuneKnob);
    this.radioTuneHandTarget.position.set(radioControlX, 0, 0.072);
    radio.add(this.radioTuneHandTarget);

    // a row of rocker switches, because a dash with nothing on it reads as a prop
    for (let i = 0; i < 5; i++) {
      const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.026, 0.016), trim);
      rocker.position.set(0.02 + i * 0.045, 1.72, DASH_FACE_Z + 0.04);
      rocker.rotation.x = 0.18;
      this.group.add(rocker);
    }

    // Coloured warning telltales and engraved label bars below the switch bank.
    for (let i = 0; i < 4; i++) {
      const colour = [0xb83222, 0xd18a24, 0x4a9b56, 0xb83222][i];
      const telltale = new THREE.Mesh(
        new THREE.CircleGeometry(0.009, 8),
        createRetroMaterial({ color: colour, mode: 'emissive', emissive: i === 2 ? 0.7 : 0.25, snap: 0.15 }),
      );
      telltale.position.set(0.035 + i * 0.055, 1.67, DASH_FACE_Z + 0.058);
      telltale.rotation.x = 0.18;
      this.group.add(telltale);
    }

    // --- the column ------------------------------------------------------------
    // Runs down and forward from the hub, so the wheel is fitted to a shaft rather than
    // stuck onto the dash.
    const axisY = Math.cos(COLUMN_TILT);
    const axisZ = Math.sin(COLUMN_TILT);
    const onColumn = (distance: number): [number, number] => [
      WHEEL_Y - axisY * distance,
      WHEEL_Z - axisZ * distance,
    ];

    const [colY, colZ] = onColumn(0.29);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.062, 0.58, 8), shell);
    column.position.set(driverX, colY, colZ);
    column.rotation.x = COLUMN_TILT;
    this.group.add(column);

    const [shroudY, shroudZ] = onColumn(0.1);
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 8), trim);
    shroud.position.set(driverX, shroudY, shroudZ);
    shroud.rotation.x = COLUMN_TILT;
    this.group.add(shroud);

    // indicator stalk, on the left of the column where the driver's hand falls
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.2, 6), trim);
    arm.rotation.z = Math.PI / 2;
    arm.position.x = -0.1;
    this.stalk.add(arm);
    const [stalkY, stalkZ] = onColumn(0.07);
    this.stalk.position.set(driverX, stalkY, stalkZ);
    this.stalk.rotation.x = COLUMN_TILT * 0.4;
    this.group.add(this.stalk);

    // --- the wheel --------------------------------------------------------------
    this.buildWheel(trim);
    this.buildHands();
    this.wheel.position.set(driverX, WHEEL_Y, WHEEL_Z);
    // Perpendicular to the column. Getting this wrong by even twenty degrees makes the
    // wheel look stuck onto the dash rather than fitted to the shaft.
    this.wheel.rotation.x = -(Math.PI / 2 - COLUMN_TILT);
    this.group.add(this.wheel);

    // --- floor-mounted gearbox lever ------------------------------------------
    // The old coach uses a long manual lever beside the driver's right knee. Keep it
    // separate from the dashboard so its silhouette remains readable against the aisle.
    const gearLever = new THREE.Group();
    gearLever.position.set(driverX + 0.48, 1.08, -4.88);

    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.24), shell);
    mount.position.y = 0.025;
    gearLever.add(mount);
    const mountBoltMaterial = createRetroMaterial({ color: 0x69665f, fogScale: 0, ambientBoost: 2.3, cabin: 1, snap: 0.1 });
    for (const x of [-0.072, 0.072]) for (const z of [-0.09, 0.09]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 8), mountBoltMaterial);
      bolt.position.set(x, 0.057, z);
      gearLever.add(bolt);
    }

    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.105, 0.17, 10), trim);
    boot.position.y = 0.13;
    gearLever.add(boot);
    // Raised folds stop the gaiter reading as a smooth traffic cone.
    const bootFoldMaterial = createRetroMaterial({ color: 0x343028, fogScale: 0, ambientBoost: 1.8, cabin: 0.8, snap: 0.12 });
    for (const y of [0.075, 0.12, 0.165]) {
      const foldRadius = THREE.MathUtils.lerp(0.095, 0.048, (y - 0.075) / 0.09);
      const fold = new THREE.Mesh(new THREE.TorusGeometry(foldRadius, 0.008, 5, 12), bootFoldMaterial);
      fold.rotation.x = Math.PI / 2;
      fold.position.y = y;
      gearLever.add(fold);
    }

    const shaftMaterial = createRetroMaterial({ color: 0x77746d, fogScale: 0, ambientBoost: 2.5, cabin: 1, snap: 0.1 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.43, 10), shaftMaterial);
    shaft.position.set(0, 0.37, -0.055);
    shaft.rotation.x = -0.25;
    this.gearStick.add(shaft);

    // Pull-up collar for reverse and a small retaining ferrule below the knob.
    const knobMaterial = createRetroMaterial({ color: 0x211e19, fogScale: 0, ambientBoost: 2.1, cabin: 0.9, snap: 0.1 });
    const reverseCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.022, 0.055, 12), knobMaterial);
    reverseCollar.position.set(0, 0.535, -0.095);
    reverseCollar.rotation.x = -0.25;
    this.gearStick.add(reverseCollar);
    const collarRing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.004, 6, 14), shaftMaterial);
    collarRing.rotation.x = Math.PI / 2 - 0.25;
    collarRing.position.set(0, 0.558, -0.101);
    this.gearStick.add(collarRing);

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), knobMaterial);
    knob.scale.set(1, 0.86, 1.08);
    knob.position.set(0, 0.59, -0.11);
    this.gearStick.add(knob);

    const shiftPattern = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#b9b2a2';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#292722';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      // The driver's "rose": three gates joined by the neutral channel.
      for (const x of [34, 64, 94]) {
        ctx.beginPath();
        ctx.moveTo(x, 38);
        ctx.lineTo(x, 90);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(34, 64);
      ctx.lineTo(94, 64);
      ctx.stroke();
      ctx.fillStyle = '#171613';
      ctx.font = 'bold 19px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const [label, x, y] of [['1', 23, 27], ['2', 23, 101], ['3', 64, 27], ['4', 64, 101], ['5', 105, 27], ['R', 105, 101]] as const) {
        ctx.fillText(label, x, y);
      }
    });
    const shiftCap = new THREE.Mesh(
      new THREE.CircleGeometry(0.041, 20),
      createRetroMaterial({ map: shiftPattern, fogScale: 0, ambientBoost: 2.8, cabin: 1.1, snap: 0.08 }),
    );
    shiftCap.rotation.x = -Math.PI / 2;
    shiftCap.position.set(0, 0.643, -0.11);
    this.gearStick.add(shiftCap);
    const capBezel = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.004, 6, 20), shaftMaterial);
    capBezel.rotation.x = Math.PI / 2;
    capBezel.position.set(0, 0.644, -0.11);
    this.gearStick.add(capBezel);

    // The palm target sits above the cap, not inside the knob. It follows every movement
    // through the H-pattern while the curled fingers wrap down around the sides.
    this.gearHandTarget.position.set(0, 0.705, -0.11);
    this.gearStick.add(this.gearHandTarget);

    gearLever.add(this.gearStick);

    this.group.add(gearLever);

    // --- foot controls ---------------------------------------------------------
    const pedalMetal = createPBRMaterial({ surface: 'metal', color: 0x54534d, roughness: 0.48 });
    const pedalRubber = createPBRMaterial({ surface: 'rubber', color: 0x171614 });
    // An unlit rubber footwell stays readable below the pedals even though the road and
    // underside of the coach are almost black. Its top remains below the pedal pivots,
    // so it cannot cover their movement or the driver's boots.
    const footwellFloorMaterial = new THREE.MeshBasicMaterial({ color: 0x625f58, fog: false });
    const footwellFloor = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.035, 5), footwellFloorMaterial);
    footwellFloor.position.set(driverX, 0.81, -4);
    this.group.add(footwellFloor);
    const floorRibMaterial = new THREE.MeshBasicMaterial({ color: 0x777168, fog: false });
    for (let rib = 0; rib < 12; rib++) {
      const floorRib = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.008, 0.025), floorRibMaterial);
      floorRib.position.set(driverX, 0.833, -5.7 + rib * 0.21);
      this.group.add(floorRib);
    }
    const pedalSpecs: Array<[THREE.Group, number, number, number]> = [
      [this.clutchPedal, driverX - 0.17, 0.12, -0.05],
      [this.brakePedal, driverX + 0.01, 0.13, 0.02],
      [this.acceleratorPedal, driverX + 0.19, 0.09, 0.09],
    ];
    for (const [pedal, x, width, lean] of pedalSpecs) {
      // Pivot low on the front bulkhead, beneath the dashboard rather than directly
      // below the steering wheel. The boot rests on the face from above.
      pedal.position.set(x, 0.78, -5.72);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.31, 0.025), pedalMetal);
      arm.position.set(0, 0.13, 0.02);
      arm.rotation.x = -0.24;
      const face = new THREE.Mesh(new THREE.BoxGeometry(width, 0.075, 0.035), pedalRubber);
      face.position.set(0, 0.29 + lean, 0.1);
      face.rotation.x = -0.42;
      pedal.add(arm, face);
      // Three moulded ribs retain grip on wet boots.
      for (let rib = -1; rib <= 1; rib++) {
        const grip = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, 0.008, 0.008), pedalMetal);
        grip.position.set(0, 0.29 + lean + rib * 0.021, 0.122);
        grip.rotation.x = -0.42;
        pedal.add(grip);
      }
      this.group.add(pedal);
    }

    // --- driver's legs --------------------------------------------------------
    // These materials sit directly below the cabin lamp. Their albedo is reduced by
    // 30% to keep the driver's legs from looking independently floodlit in first person.
    const denim = createPBRMaterial({ surface: 'fabric', color: 0x0f1012, roughness: 0.98 });
    const fadedDenim = createPBRMaterial({ surface: 'fabric', color: 0x222327, roughness: 1 });
    // Deep brown leather: kept warm enough to read as brown under the cabin lamp,
    // but darker than the previous pass.
    const bootLeather = createPBRMaterial({ surface: 'paint', color: 0x24160d, roughness: 0.88, metalness: 0 });
    const bootSole = createPBRMaterial({ surface: 'rubber', color: 0x17130f });
    const driedMud = createPBRMaterial({ surface: 'plastic', color: 0x4e3c29, roughness: 1 });

    const configureLeg = (thigh: THREE.Mesh, shin: THREE.Mesh, knee: THREE.Mesh): void => {
      thigh.geometry = new THREE.CylinderGeometry(0.09, 0.115, 1, 12);
      thigh.material = denim;
      shin.geometry = new THREE.CylinderGeometry(0.073, 0.09, 1, 12);
      shin.material = denim;
      knee.geometry = new THREE.SphereGeometry(0.095, 12, 8);
      knee.material = fadedDenim;
      knee.scale.set(1.04, 0.9, 1.08);
      this.group.add(thigh, shin, knee);
    };
    configureLeg(this.leftThigh, this.leftShin, this.leftKnee);
    configureLeg(this.rightThigh, this.rightShin, this.rightKnee);

    const buildBoot = (boot: THREE.Group): void => {
      const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.075, 0.18, 10), bootLeather);
      ankle.position.set(0, 0.08, 0.055);
      // Flattened ellipsoids make a rounded shoe silhouette without the long capsule
      // end faces that can clip across the first-person camera at steep view angles.
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 9), bootLeather);
      body.scale.set(0.72, 0.52, 1.38);
      body.position.set(0, 0.002, -0.055);
      body.rotation.x = -0.1;
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 7), bootLeather);
      toe.scale.set(1, 0.65, 1.18);
      toe.position.set(0, -0.002, -0.18);
      const sole = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 8), bootSole);
      sole.scale.set(0.76, 0.18, 1.55);
      sole.position.set(0, -0.065, -0.075);
      const heel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.065, 0.09), bootSole);
      heel.position.set(0, -0.075, 0.055);
      boot.add(ankle, body, toe, sole, heel);
      for (const [x, z, scale] of [[-0.035, -0.2, 0.7], [0.04, -0.13, 0.52], [-0.045, 0.0, 0.42]] as const) {
        const mud = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 5), driedMud);
        mud.scale.set(scale, 0.22, scale * 1.35);
        mud.position.set(x, 0.052, z);
        boot.add(mud);
      }
      // Simple dark lace ladder across the instep.
      for (let lace = 0; lace < 4; lace++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.007, 0.012), bootSole);
        strip.position.set(0, 0.065, -0.105 + lace * 0.035);
        boot.add(strip);
      }
      // Denim cuff overlaps the boot shaft, hiding the mechanical joint between meshes.
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.079, 0.086, 0.12, 10), denim);
      cuff.position.set(0, 0.17, 0.055);
      const wornHem = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.009, 6, 12), fadedDenim);
      wornHem.rotation.x = Math.PI / 2;
      wornHem.position.set(0, 0.115, 0.055);
      boot.add(cuff, wornHem);
      this.group.add(boot);
    };
    this.leftBoot.position.set(driverX - 0.17, 1.27, -5.46);
    this.rightBoot.position.set(driverX + 0.19, 1.27, -5.46);
    buildBoot(this.leftBoot);
    buildBoot(this.rightBoot);
    this.poseDriverLegs();

    // --- driver's ancillary equipment ----------------------------------------
    const equipmentPlastic = createPBRMaterial({ surface: 'plastic', color: 0x26231e, roughness: 0.72 });
    const fareBox = new THREE.Group();
    fareBox.position.set(driverX + 0.57, 1.36, -5.34);
    const fareBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.38, 0.2), equipmentPlastic);
    const fareTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.18), pedalMetal);
    fareTop.position.y = 0.205;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.025), pedalRubber);
    slot.position.set(0, 0.226, -0.015);
    fareBox.add(fareBody, fareTop, slot);
    this.group.add(fareBox);

    this.poseDriverUpperBody(0);

    // the whole binnacle belongs to the driver's eyes, not to the mirror
    this.group.traverse((child) => child.layers.set(LAYER_DIRECT_ONLY));
  }

  private poseDriverLegs(): void {
    const poseLeg = (
      thigh: THREE.Mesh,
      shin: THREE.Mesh,
      knee: THREE.Mesh,
      boot: THREE.Group,
      hipX: number,
    ): void => {
      // The upper leg begins below the driver's viewpoint/seat, bends at a visible
      // knee and enters the boot through the denim cuff. This keeps the body reading
      // as one continuous seated driver instead of several floating props.
      // Keep the whole upper leg in front of the eye plane. Starting it behind the
      // camera makes the cylinder cross the near plane and explode into a black bar.
      this.legFrom.set(hipX, 1.58, -4.98);
      this.legTo.set(boot.position.x, boot.position.y + 0.23, boot.position.z + 0.055);
      this.legMid.set(
        THREE.MathUtils.lerp(this.legFrom.x, this.legTo.x, 0.53),
        1.43,
        -5.18,
      );
      this.alignLegSegment(thigh, this.legFrom, this.legMid);
      this.alignLegSegment(shin, this.legMid, this.legTo);
      knee.position.copy(this.legMid);
    };

    poseLeg(this.leftThigh, this.leftShin, this.leftKnee, this.leftBoot, this.driverX - 0.12);
    poseLeg(this.rightThigh, this.rightShin, this.rightKnee, this.rightBoot, this.driverX + 0.12);
  }

  private alignLegSegment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    this.legDirection.subVectors(to, from);
    const length = this.legDirection.length();
    mesh.position.copy(from).addScaledVector(this.legDirection, 0.5);
    mesh.scale.set(1, length, 1);
    mesh.quaternion.setFromUnitVectors(this.legUp, this.legDirection.normalize());
  }

  private buildWheel(trim: THREE.ShaderMaterial): void {
    // Lifted above the rest of the dash: the rim is the one part of the cab the driver's
    // own hands are on, and it has to read as a shape rather than dissolve into the dark.
    const rimMaterial = createRetroMaterial({
      color: 0x2a251d,
      fogScale: 0,
      ambientBoost: 2.6,
      cabin: 1.3,
      snap: 0.2,
    });

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(WHEEL_RADIUS, 0.024, 14, 32),
      rimMaterial,
    );
    this.wheel.add(rim);

    // Leather wrap seam: small raised stitches around the driver's side of the rim.
    const stitchMaterial = createRetroMaterial({ color: 0x8a7353, fogScale: 0, ambientBoost: 2.8, cabin: 1.2, snap: 0.1 });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.005, 0.006), stitchMaterial);
      stitch.position.set(Math.cos(a) * WHEEL_RADIUS, Math.sin(a) * WHEEL_RADIUS, 0.024);
      stitch.rotation.z = a;
      this.wheel.add(stitch);
    }

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 10), trim);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.014, 12), rimMaterial);
    pad.rotation.x = Math.PI / 2;
    pad.position.z = 0.032;
    this.wheel.add(pad);

    const badge = new THREE.Mesh(
      new THREE.CircleGeometry(0.032, 12),
      createRetroMaterial({ color: 0x6b5b3e, fogScale: 0, ambientBoost: 2.8, cabin: 1, snap: 0.1 }),
    );
    badge.position.z = 0.041;
    this.wheel.add(badge);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(new THREE.CircleGeometry(0.006, 6), stitchMaterial);
      bolt.position.set(Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.043);
      this.wheel.add(bolt);
    }

    // Three spokes at two, six and ten o'clock, which leaves twelve open — that gap is
    // what the driver reads the gauges through.
    for (const clockPosition of [2, 6, 10]) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, WHEEL_RADIUS - 0.05, 0.017),
        rimMaterial,
      );
      spoke.position.y = 0.05 + (WHEEL_RADIUS - 0.05) / 2;
      const holder = new THREE.Group();
      holder.add(spoke);
      holder.rotation.z = -(clockPosition / 12) * Math.PI * 2;
      this.wheel.add(holder);
    }
  }

  /** Builds a continuous first-person driver: torso, articulated sleeves and hands. */
  private buildHands(): void {
    const skin = createRetroMaterial({ color: 0xae7658, fogScale: 0, ambientBoost: 2.45, cabin: 1.12, snap: 0.2 });
    const jacket = createRetroMaterial({ color: 0x354149, fogScale: 0, ambientBoost: 2.35, cabin: 1.12, roughness: 0.94, snap: 0.18 });
    const jacketFade = createRetroMaterial({ color: 0x4d5a62, fogScale: 0, ambientBoost: 2.4, cabin: 1.15, roughness: 0.96, snap: 0.16 });
    const jacketSeam = createRetroMaterial({ color: 0x1d252a, fogScale: 0, ambientBoost: 2, cabin: 0.96, snap: 0.22 });
    const torsoFabric = new THREE.MeshBasicMaterial({ color: 0x344148, fog: false });

    // The chest stays below and behind the eye plane. It is visible when looking down,
    // but never intersects the first-person camera or covers the windscreen.
    // The torso group pivots from the driver's waist. This lets the whole upper body
    // lean toward distant controls instead of making either sleeve grow longer.
    this.torso.position.set(this.driverX, 1.15, -4.78);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.28, 5, 12), torsoFabric);
    chest.scale.set(1.28, 1, 0.58);
    chest.position.set(0, 0.24, -0.12);
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.42, 4, 10), jacket);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.scale.z = 0.72;
    shoulders.position.set(0, 0.52, -0.04);
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.31, 0.012), jacketSeam);
    zip.position.set(0, 0.31, -0.265);
    this.leftShoulderAnchor.position.set(-0.27, 0.52, -0.05);
    this.rightShoulderAnchor.position.set(0.27, 0.52, -0.05);
    this.torso.add(chest, shoulders, zip, this.leftShoulderAnchor, this.rightShoulderAnchor);
    this.group.add(this.torso);

    const configureSleeve = (upper: THREE.Mesh, forearm: THREE.Mesh, elbow: THREE.Mesh): void => {
      upper.geometry = new THREE.CylinderGeometry(0.052, 0.068, 1, 10);
      upper.material = jacket;
      forearm.geometry = new THREE.CylinderGeometry(0.042, 0.054, 1, 10);
      forearm.material = jacket;
      elbow.geometry = new THREE.SphereGeometry(0.06, 10, 7);
      elbow.material = jacketFade;
      elbow.scale.set(1, 0.9, 1);
      this.group.add(upper, forearm, elbow);
    };
    configureSleeve(this.leftUpperArm, this.leftForearm, this.leftElbowJoint);
    configureSleeve(this.rightUpperArm, this.rightForearm, this.rightElbowJoint);

    const makeHand = (hand: THREE.Group, side: -1 | 1): void => {
      const fingerJoints = side < 0 ? this.leftFingerJoints : this.rightFingerJoints;
      const thumbJoints = side < 0 ? this.leftThumbJoints : this.rightThumbJoints;
      const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.029, 0.047, 4, 10), skin);
      palm.scale.set(1.12, 1, 0.72);
      palm.position.y = -0.003;

      // Four separate two-bone fingers. Their distal joints curl behind the rim while
      // gripping and unfold during a hand-over-hand transfer.
      for (let finger = 0; finger < 4; finger++) {
        const root = new THREE.Group();
        root.position.set((finger - 1.5) * 0.015, 0.032 + Math.abs(finger - 1.5) * -0.003, 0);
        root.rotation.x = -0.12;
        const proximal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0078, 0.02, 3, 7), skin);
        proximal.position.y = 0.014;
        const distalJoint = new THREE.Group();
        distalJoint.position.y = 0.033;
        distalJoint.rotation.x = -1.02;
        const distal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0072, 0.018, 3, 7), skin);
        distal.position.y = 0.012;
        distalJoint.add(distal);
        root.add(proximal, distalJoint);
        hand.add(root);
        fingerJoints.push(distalJoint);
      }

      // The thumb uses the same skin material as the rest of the hand; the old dark
      // thumb was the brown patch that looked pasted onto each fist.
      const thumbRoot = new THREE.Group();
      thumbRoot.position.set(side * 0.026, -0.002, 0.006);
      thumbRoot.rotation.z = side * 0.92;
      const thumbBase = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.014, 3, 7), skin);
      thumbBase.position.y = 0.011;
      const thumbTipJoint = new THREE.Group();
      thumbTipJoint.position.y = 0.024;
      thumbTipJoint.rotation.x = -0.62;
      const thumbTip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0072, 0.011, 3, 7), skin);
      thumbTip.position.y = 0.008;
      thumbTipJoint.add(thumbTip);
      thumbRoot.add(thumbBase, thumbTipJoint);
      hand.add(thumbRoot);
      thumbJoints.push(thumbTipJoint);

      const cuff = side > 0 ? this.rightCuff : new THREE.Mesh();
      cuff.geometry = new THREE.CylinderGeometry(0.041, 0.046, 0.055, 9);
      cuff.material = jacketFade;
      cuff.position.y = -0.065;
      hand.add(palm, cuff);
      this.group.add(hand);
    };
    makeHand(this.leftHand, -1);
    makeHand(this.rightHand, 1);

    const gripAt = (clockPosition: number, target: THREE.Vector3): void => {
      const theta = (clockPosition / 12) * Math.PI * 2;
      target.set(Math.sin(theta) * WHEEL_RADIUS, Math.cos(theta) * WHEEL_RADIUS, 0.035);
    };
    gripAt(9.75, this.wheelGripLeft);
    gripAt(2.25, this.wheelGripRight);
  }

  private poseDriverUpperBody(shiftBlend: number): void {
    // Reaching the radio starts at the waist and shoulder. The head/camera follows a
    // smaller version of this motion in main.ts, preserving a true first-person view.
    this.radioBodyLean = this.radioHandBlend * (1 - shiftBlend);
    this.torso.rotation.x = -0.42 * this.radioBodyLean;
    this.torso.rotation.y = 0.1 * this.radioBodyLean;
    this.rightShoulderAnchor.position.x = 0.27 + 0.018 * this.radioBodyLean;
    this.rightShoulderAnchor.position.z = -0.05 - 0.055 * this.radioBodyLean;
    this.torso.updateMatrixWorld(true);
    this.leftShoulderAnchor.getWorldPosition(this.leftShoulder);
    this.group.worldToLocal(this.leftShoulder);
    this.rightShoulderAnchor.getWorldPosition(this.rightShoulder);
    this.group.worldToLocal(this.rightShoulder);

    const steering = this.wheel.rotation.z;
    const eased = (from: number, to: number, value: number): number => {
      const t = THREE.MathUtils.clamp((value - from) / (to - from), 0, 1);
      return t * t * (3 - 2 * t);
    };
    // On a left turn the left hand transfers first and the right follows near full lock;
    // a right turn mirrors the sequence. New local angles are fixed once caught, so the
    // regripped hand resumes rotating with the wheel instead of hovering in screen space.
    const leftTransfer = steering >= 0
      ? eased(0.9, 1.55, steering)
      : eased(1.55, 1.95, -steering);
    const rightTransfer = steering <= 0
      ? eased(0.9, 1.55, -steering)
      : eased(1.55, 1.95, steering);
    const leftTargetAngle = steering >= 0 ? 2.45 : -3.6;
    const rightTargetAngle = steering <= 0 ? -2.45 : 3.6;
    this.leftWheelTarget.set(
      Math.sin(leftTargetAngle) * WHEEL_RADIUS,
      Math.cos(leftTargetAngle) * WHEEL_RADIUS,
      0.035,
    );
    this.rightWheelTarget.set(
      Math.sin(rightTargetAngle) * WHEEL_RADIUS,
      Math.cos(rightTargetAngle) * WHEEL_RADIUS,
      0.035,
    );
    this.leftGrip.lerpVectors(this.wheelGripLeft, this.leftWheelTarget, leftTransfer);
    this.rightGrip.lerpVectors(this.wheelGripRight, this.rightWheelTarget, rightTransfer);
    // Hands cross the chord above the spokes rather than sliding around the leather.
    this.leftGrip.z += Math.sin(leftTransfer * Math.PI) * 0.085;
    this.rightGrip.z += Math.sin(rightTransfer * Math.PI) * 0.085;

    // Grip points are in wheel space, so rotation about both the tilted column and the
    // steering axis is inherited exactly after the transfer has been calculated.
    this.wheel.localToWorld(this.leftGrip);
    this.group.worldToLocal(this.leftGrip);
    this.wheel.localToWorld(this.rightGrip);
    this.group.worldToLocal(this.rightGrip);

    if (this.radioMode !== 'idle' && this.radioHandBlend > 0) {
      const radioTarget = this.radioMode === 'power'
        ? this.radioPowerHandTarget
        : this.radioTuneHandTarget;
      radioTarget.getWorldPosition(this.radioGrip);
      this.group.worldToLocal(this.radioGrip);
      this.rightGrip.lerp(this.radioGrip, this.radioHandBlend);
    }

    this.gearHandTarget.getWorldPosition(this.gearGrip);
    this.group.worldToLocal(this.gearGrip);
    this.rightGrip.lerp(this.gearGrip, shiftBlend);

    const preferElbow = (
      shoulder: THREE.Vector3,
      grip: THREE.Vector3,
      elbow: THREE.Vector3,
      side: -1 | 1,
    ): void => {
      elbow.lerpVectors(shoulder, grip, 0.52);
      elbow.x += side * 0.115;
      // The right elbow travels forward over the tall floor shifter while steering.
      // Moving it straight upward brings the sleeve too close to the first-person camera;
      // forward depth keeps it visually above the knob without filling the lower view.
      elbow.y -= side > 0 ? 0.12 : 0.14;
      elbow.z += side > 0 ? -0.11 : 0.035;
    };
    preferElbow(this.leftShoulder, this.leftGrip, this.leftElbow, -1);
    preferElbow(this.rightShoulder, this.rightGrip, this.rightElbow, 1);
    // Approach the controls from below and to the right. A straight camera-to-button
    // approach makes the forearm appear as a large sleeve end and hides the fingers.
    const radioElbowX = this.radioMode === 'power'
      ? this.driverX + 0.38
      : this.driverX + 0.52;
    this.radioElbow.set(radioElbowX, 1.53, -5.38);
    this.rightElbow.lerp(this.radioElbow, this.radioHandBlend * 0.84);
    // While changing gear, the right elbow tucks beside the body before extending to the
    // knob. This is the visible difference between an arm reaching and a rigid rod
    // pivoting from the shoulder.
    this.shiftElbow.set(this.driverX + 0.34, 1.37, -4.65);
    this.rightElbow.lerp(this.shiftElbow, shiftBlend * 0.72);

    // Solve both elbows with fixed anatomical segment lengths. Previously each cylinder
    // was scaled directly between shoulder and hand, so a radio reach visibly stretched
    // the entire arm. The preferred elbow points above only choose the bend direction.
    this.solveArmElbow(this.leftShoulder, this.leftGrip, this.leftElbow);
    this.solveArmElbow(this.rightShoulder, this.rightGrip, this.rightElbow);

    this.alignArmSegment(this.leftUpperArm, this.leftShoulder, this.leftElbow);
    this.alignArmSegment(this.leftForearm, this.leftElbow, this.leftGrip);
    this.alignArmSegment(this.rightUpperArm, this.rightShoulder, this.rightElbow);
    this.alignArmSegment(this.rightForearm, this.rightElbow, this.rightGrip);
    this.leftElbowJoint.position.copy(this.leftElbow);
    this.rightElbowJoint.position.copy(this.rightElbow);
    this.poseHand(this.leftHand, this.leftElbow, this.leftGrip);
    this.poseHand(this.rightHand, this.rightElbow, this.rightGrip);
    // At the gear lever the wrist rolls over the cap: the palm remains above it while
    // the fingers point down around the knob. Blending the orientation avoids a snap as
    // the hand leaves and returns to the wheel.
    this.gearHandQuaternion.setFromUnitVectors(this.armUp, this.gearHandDirection);
    this.rightHand.quaternion.slerp(this.gearHandQuaternion, shiftBlend);
    // The cuff is aligned with the hand during normal steering. At the sharply rolled
    // gear-grip pose its circular end would detach visually and look like a green ball;
    // collapse it smoothly while the forearm itself supplies the sleeve-to-hand join.
    const cuffScale = THREE.MathUtils.lerp(1, 0.02, shiftBlend);
    this.rightCuff.scale.setScalar(cuffScale);
    const leftGripStrength = 1 - Math.sin(leftTransfer * Math.PI) * 0.88;
    const steeringRightGrip = 1 - Math.sin(rightTransfer * Math.PI) * 0.88;
    // A hand arriving at the gear knob closes again even if a steering transfer was in
    // progress when the automatic gearbox change started.
    const rightGripStrength = THREE.MathUtils.lerp(steeringRightGrip, 1, shiftBlend);
    this.setHandGrip(this.leftFingerJoints, this.leftThumbJoints, leftGripStrength);
    const radioGripStrength = this.radioMode === 'power' ? 0.5 : 0.92;
    const radioFingerBlend = this.radioHandBlend * (1 - shiftBlend);
    this.setHandGrip(
      this.rightFingerJoints,
      this.rightThumbJoints,
      THREE.MathUtils.lerp(rightGripStrength, radioGripStrength, radioFingerBlend),
    );
    if (this.radioMode === 'power' && this.rightFingerJoints.length >= 4 && radioFingerBlend > 0) {
      // The index finger sits next to the thumb on the right hand. Keep it straight while
      // the other three fingers support the palm against the radio face.
      this.rightFingerJoints[3].rotation.x = THREE.MathUtils.lerp(
        this.rightFingerJoints[3].rotation.x,
        -0.1,
        radioFingerBlend,
      );
    } else if ((this.radioMode === 'tune' || this.radioMode === 'seek') && radioFingerBlend > 0) {
      const fingerRoll = Math.sin(this.radioTuneKnob.rotation.z * 2) * 0.08 * radioFingerBlend;
      this.rightFingerJoints[3].rotation.x += fingerRoll;
      if (this.rightThumbJoints[0]) this.rightThumbJoints[0].rotation.x -= fingerRoll;
    }
  }

  private solveArmElbow(
    shoulder: THREE.Vector3,
    grip: THREE.Vector3,
    elbow: THREE.Vector3,
  ): void {
    const upperLength = 0.44;
    const forearmLength = 0.43;
    this.armDirection.subVectors(grip, shoulder);
    const targetDistance = Math.max(0.001, this.armDirection.length());
    this.armDirection.multiplyScalar(1 / targetDistance);
    const solvedDistance = THREE.MathUtils.clamp(
      targetDistance,
      Math.abs(upperLength - forearmLength) + 0.002,
      upperLength + forearmLength - 0.002,
    );
    const along = (
      upperLength * upperLength
      - forearmLength * forearmLength
      + solvedDistance * solvedDistance
    ) / (2 * solvedDistance);
    const bendHeight = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    this.armElbowBase.copy(shoulder).addScaledVector(this.armDirection, along);
    this.armBendDirection.subVectors(elbow, this.armElbowBase);
    this.armBendDirection.addScaledVector(
      this.armDirection,
      -this.armBendDirection.dot(this.armDirection),
    );
    if (this.armBendDirection.lengthSq() < 0.000001) this.armBendDirection.set(0, -1, 0);
    this.armBendDirection.normalize();
    elbow.copy(this.armElbowBase).addScaledVector(this.armBendDirection, bendHeight);
  }

  /** Amount the driver's head should follow the upper body toward the radio. */
  get firstPersonBodyLean(): number {
    return this.radioBodyLean;
  }

  /** Show the seated first-person body only while the player is actually driving. */
  setDriverVisible(visible: boolean): void {
    if (visible === this.driverVisible) return;
    this.driverVisible = visible;
    for (const part of [
      this.torso,
      this.leftUpperArm,
      this.leftForearm,
      this.rightUpperArm,
      this.rightForearm,
      this.leftElbowJoint,
      this.rightElbowJoint,
      this.leftHand,
      this.rightHand,
      this.leftThigh,
      this.leftShin,
      this.leftKnee,
      this.rightThigh,
      this.rightShin,
      this.rightKnee,
      this.leftBoot,
      this.rightBoot,
    ]) part.visible = visible;
  }

  private alignArmSegment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    this.armDirection.subVectors(to, from);
    const length = this.armDirection.length();
    mesh.position.copy(from).addScaledVector(this.armDirection, 0.5);
    mesh.scale.set(1, length, 1);
    mesh.quaternion.setFromUnitVectors(this.armUp, this.armDirection.normalize());
  }

  private poseHand(hand: THREE.Group, elbow: THREE.Vector3, grip: THREE.Vector3): void {
    this.armDirection.subVectors(grip, elbow).normalize();
    hand.position.copy(grip).addScaledVector(this.armDirection, 0.012);
    hand.quaternion.setFromUnitVectors(this.armUp, this.armDirection);
  }

  private setHandGrip(fingers: THREE.Group[], thumbs: THREE.Group[], strength: number): void {
    const grip = THREE.MathUtils.clamp(strength, 0, 1);
    for (const joint of fingers) joint.rotation.x = THREE.MathUtils.lerp(-0.18, -1.02, grip);
    for (const joint of thumbs) joint.rotation.x = THREE.MathUtils.lerp(-0.12, -0.76, grip);
  }

  private buildGauge(
    face: THREE.CanvasTexture,
    radius: number,
    x: number,
    needle: THREE.Mesh,
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.x = x;

    const dial = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 20),
      createRetroMaterial({ map: face, mode: 'emissive', emissive: 0.62, snap: 0.2 }),
    );
    group.add(dial);

    const bezel = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.009, 4, 16),
      createRetroMaterial({ color: 0x2e2a24, fogScale: 0, ambientBoost: 2.4, cabin: 1, snap: 0.2 }),
    );
    bezel.position.z = 0.004;
    group.add(bezel);

    const innerBezel = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.88, 0.0035, 4, 20),
      createRetroMaterial({ color: 0x706556, fogScale: 0, ambientBoost: 2.4, cabin: 1, snap: 0.12 }),
    );
    innerBezel.position.z = 0.006;
    group.add(innerBezel);

    // Convex-looking instrument glass and a small reflected highlight.
    const gaugeGlass = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.86, 24),
      createRetroMaterial({ color: 0x9cb2bd, mode: 'emissive', emissive: 0.08, transparent: true, opacity: 0.11, depthWrite: false, snap: 0.1 }),
    );
    gaugeGlass.position.z = 0.012;
    group.add(gaugeGlass);
    const highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 0.62, 0.006),
      createRetroMaterial({ color: 0xb8d7e2, mode: 'emissive', emissive: 0.32, transparent: true, opacity: 0.28, depthWrite: false, snap: 0.1 }),
    );
    highlight.position.set(-radius * 0.13, radius * 0.42, 0.014);
    highlight.rotation.z = -0.24;
    group.add(highlight);

    needle.geometry = new THREE.BoxGeometry(0.008, radius * 0.86, 0.004);
    needle.material = createRetroMaterial({
      color: 0xd8452a,
      mode: 'emissive',
      emissive: 0.85,
      snap: 0.2,
    });
    // pivot near the base of the pointer, with a short counterweight behind it
    needle.geometry.translate(0, radius * 0.4, 0);
    needle.position.z = 0.009;
    group.add(needle);

    const pin = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.075, radius * 0.09, 0.012, 10),
      createRetroMaterial({ color: 0x27221c, fogScale: 0, ambientBoost: 2.2, cabin: 1, snap: 0.1 }),
    );
    pin.rotation.x = Math.PI / 2;
    pin.position.z = 0.016;
    group.add(pin);

    return group;
  }

  requestRadioPower(): void {
    this.pendingRadioPower = Math.min(3, this.pendingRadioPower + 1);
  }

  requestRadioSeek(direction = 1): void {
    this.pendingRadioSeek = THREE.MathUtils.clamp(this.pendingRadioSeek + Math.sign(direction), -4, 4);
  }

  private startRadioInteraction(mode: 'power' | 'tune' | 'seek', direction = 0): void {
    this.radioMode = mode;
    this.radioPhase = 'reach';
    this.radioPhaseTime = 0;
    this.radioDirection = Math.sign(direction);
    this.radioMinimumTuneTime = mode === 'tune' ? 0.16 : 0;
  }

  private updateRadioInteraction(dt: number, tuneInput: number, gearBusy: boolean): DashboardActions {
    const actions = this.dashboardActions;
    actions.radioPowerPress = false;
    actions.radioSeekDirection = 0;
    actions.radioTuneDirection = 0;

    if (!gearBusy && this.radioMode === 'idle') {
      if (this.pendingRadioPower > 0) {
        this.pendingRadioPower--;
        this.startRadioInteraction('power');
      } else if (this.pendingRadioSeek !== 0) {
        const direction = Math.sign(this.pendingRadioSeek);
        this.pendingRadioSeek -= direction;
        this.startRadioInteraction('seek', direction);
      } else if (tuneInput !== 0) {
        this.startRadioInteraction('tune', tuneInput);
      }
    }

    if (!gearBusy && this.radioMode !== 'idle') {
      this.radioPhaseTime += dt;
      if (this.radioPhase === 'reach' && this.radioPhaseTime >= 0.34) {
        this.radioPhase = 'operate';
        this.radioPhaseTime = 0;
        if (this.radioMode === 'power') actions.radioPowerPress = true;
        else if (this.radioMode === 'seek') actions.radioSeekDirection = this.radioDirection;
      } else if (this.radioPhase === 'operate') {
        if (this.radioMode === 'tune') {
          if (tuneInput !== 0) this.radioDirection = Math.sign(tuneInput);
          this.radioMinimumTuneTime = Math.max(0, this.radioMinimumTuneTime - dt);
          actions.radioTuneDirection = this.radioDirection;
          this.radioTuneKnob.rotation.z += this.radioDirection * dt * 6.5;
          if (tuneInput === 0 && this.radioMinimumTuneTime <= 0) {
            this.radioPhase = 'return';
            this.radioPhaseTime = 0;
          }
        } else {
          if (this.radioMode === 'seek') this.radioTuneKnob.rotation.z += this.radioDirection * dt * 9;
          if (this.radioPhaseTime >= 0.18) {
            this.radioPhase = 'return';
            this.radioPhaseTime = 0;
          }
        }
      } else if (this.radioPhase === 'return' && this.radioPhaseTime >= 0.34) {
        this.radioMode = 'idle';
        this.radioPhaseTime = 0;
      }
    }

    const smooth = (value: number): number => {
      const t = THREE.MathUtils.clamp(value, 0, 1);
      return t * t * (3 - 2 * t);
    };
    this.radioHandBlend = this.radioMode === 'idle'
      ? 0
      : this.radioPhase === 'reach'
        ? smooth(this.radioPhaseTime / 0.34)
        : this.radioPhase === 'return'
          ? 1 - smooth(this.radioPhaseTime / 0.34)
          : 1;
    const buttonPress = this.radioMode === 'power' && this.radioPhase === 'operate'
      ? Math.sin(THREE.MathUtils.clamp(this.radioPhaseTime / 0.18, 0, 1) * Math.PI)
      : 0;
    this.radioPowerButton.position.z = 0.02 - buttonPress * 0.009;
    return actions;
  }

  update(data: {
    dt: number;
    speedMph: number;
    signedSpeed: number;
    rpm: number;
    wheelAngle: number;
    gear: number | 'R';
    forwardPressed: boolean;
    reversePressed: boolean;
    miles: number;
    clock: string;
    highBeam: boolean;
    radioTuneDirection: number;
  }): DashboardActions {
    const speedT = THREE.MathUtils.clamp(data.speedMph / 80, 0, 1);
    this.speedNeedle.rotation.z = GAUGE_START + (GAUGE_END - GAUGE_START) * speedT;

    const revT = THREE.MathUtils.clamp(data.rpm / 3000, 0, 1);
    this.revNeedle.rotation.z = GAUGE_START + (GAUGE_END - GAUGE_START) * revT;

    // rotation order is XYZ, so the spin about Z happens before the column tilt about X
    const visualWheelAngle = data.wheelAngle;
    const wheelMagnitude = Math.pow(Math.abs(visualWheelAngle), 1.18);
    this.wheel.rotation.z = Math.sign(visualWheelAngle) * wheelMagnitude * 2;

    // Follow the H-pattern engraved on the knob. At rest the lever returns to the neutral
    // channel; forward gears alternate front/back while moving across the three gates.
    const moving = data.speedMph >= 0.5;
    const positions: Record<number | 'R', { x: number; z: number }> = {
      1: { x: -0.16, z: 0.14 },
      2: { x: 0.13, z: 0.14 },
      3: { x: -0.16, z: 0 },
      4: { x: 0.13, z: 0 },
      5: { x: -0.16, z: -0.14 },
      R: { x: 0.14, z: -0.14 },
    };
    const lever = moving ? positions[data.gear] ?? positions[5] : { x: 0, z: 0 };

    // The clutch follows each actual gearbox transition, including entering reverse. The
    // short hold makes the movement readable without keeping it down between gears.
    let shiftStarted = false;
    if (this.lastGear === null) this.lastGear = data.gear;
    else if (data.gear !== this.lastGear) {
      this.lastGear = data.gear;
      shiftStarted = true;
    }
    if (moving !== this.lastMoving) {
      this.lastMoving = moving;
      shiftStarted = true;
    }
    if (shiftStarted) {
      this.clutchTime = 0.44;
      this.shiftHandTime = this.shiftHandDuration;
    }
    this.shiftHandTime = Math.max(0, this.shiftHandTime - data.dt);
    const shiftPhase = this.shiftHandTime > 0
      ? 1 - this.shiftHandTime / this.shiftHandDuration
      : 1;
    const smoothstep = (from: number, to: number, value: number): number => {
      const t = THREE.MathUtils.clamp((value - from) / (to - from), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const handReach = smoothstep(0, 0.3, shiftPhase);
    const handReturn = 1 - smoothstep(0.68, 1, shiftPhase);
    const shiftHandBlend = this.shiftHandTime > 0 ? Math.min(handReach, handReturn) : 0;
    const radioActions = this.updateRadioInteraction(
      data.dt,
      data.radioTuneDirection,
      this.shiftHandTime > 0,
    );
    // The lever waits until the fingers arrive, then crosses the gate while the hand is
    // wrapped around the knob. This avoids the common mechanical-looking sequence where
    // the gearbox moves first and the arm chases it afterwards.
    const leverResponse = shiftStarted || (this.shiftHandTime > 0 && shiftPhase < 0.24)
      ? 0
      : 1 - Math.exp(-data.dt * 13);
    this.gearStick.rotation.x = THREE.MathUtils.lerp(this.gearStick.rotation.x, lever.x, leverResponse);
    this.gearStick.rotation.z = THREE.MathUtils.lerp(this.gearStick.rotation.z, lever.z, leverResponse);
    this.clutchTime = Math.max(0, this.clutchTime - data.dt);

    const reversing = data.signedSpeed < -0.08;
    const gasDown = data.forwardPressed || (data.reversePressed && reversing);
    const brakeDown = data.reversePressed && !reversing;
    const pedalResponse = 1 - Math.exp(-data.dt * 15);
    const depress = (pedal: THREE.Group, down: boolean, travel: number): void => {
      pedal.rotation.x = THREE.MathUtils.lerp(pedal.rotation.x, down ? travel : 0, pedalResponse);
    };
    depress(this.clutchPedal, this.clutchTime > 0, -0.22);
    depress(this.brakePedal, brakeDown, -0.18);
    depress(this.acceleratorPedal, gasDown, -0.14);
    // Boots follow the same hinge direction as the pedals. The right foot also slides
    // across the footwell when moving from accelerator to brake.
    this.leftBoot.rotation.x = THREE.MathUtils.lerp(this.leftBoot.rotation.x, this.clutchTime > 0 ? -0.18 : 0, pedalResponse);
    const rightPress = brakeDown ? -0.15 : gasDown ? -0.12 : 0;
    this.rightBoot.rotation.x = THREE.MathUtils.lerp(this.rightBoot.rotation.x, rightPress, pedalResponse);
    this.rightBoot.position.x = THREE.MathUtils.lerp(
      this.rightBoot.position.x,
      brakeDown ? this.driverX + 0.01 : this.driverX + 0.19,
      1 - Math.exp(-data.dt * 10),
    );
    // Lift the sole during the lateral transfer. At either pedal it settles back down,
    // so the right foot visibly moves from gas to brake instead of gliding sideways.
    const pedalTravel = THREE.MathUtils.clamp(
      (this.rightBoot.position.x - (this.driverX + 0.01)) / 0.18,
      0,
      1,
    );
    this.rightBoot.position.y = 1.27 + Math.sin(pedalTravel * Math.PI) * 0.075;
    this.poseDriverLegs();
    this.poseDriverUpperBody(shiftHandBlend);

    if (data.clock !== this.lastClock) {
      this.lastClock = data.clock;
      ledPanel(data.clock, '#63e08a', 128, 48, this.clockTexture);
    }

    const tenths = Math.floor(Math.max(0, data.miles) * 10);
    if (tenths !== this.lastOdo) {
      this.lastOdo = tenths;
      const text = (tenths / 10).toFixed(1).padStart(7, '0');
      ledPanel(text, '#cfc6b2', 128, 32, this.odoTexture);
    }

    const lamp = this.highBeamLamp.material as THREE.ShaderMaterial;
    lamp.uniforms.uEmissive.value = data.highBeam ? 1.6 : 0.08;
    return radioActions;
  }

  /** @param needle 0..1 across the band. */
  setRadio(needle: number, readout: string, powered: boolean): void {
    this.dialNeedle.position.x = (needle - 0.5) * (this.dialWidth - 0.014);
    this.dialNeedle.visible = powered;
    if (readout !== this.lastDialText || powered !== this.lastPowered) {
      this.lastDialText = readout;
      this.lastPowered = powered;
      dialFace(readout, powered, this.dialTexture);
    }
  }
}
