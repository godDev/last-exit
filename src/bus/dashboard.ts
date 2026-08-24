import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { canvasTexture } from '../render/textures';
import { LAYER_DIRECT_ONLY } from './mirror';

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

  constructor(driverX: number) {
    // Kept dark deliberately. The dash fills the bottom third of every frame for four
    // hours; it has to read as a silhouette with lit instruments in it, not as a surface.
    const shell = createRetroMaterial({
      color: 0x17150f,
      fogScale: 0,
      ambientBoost: 1.15,
      cabin: 0.5,
      snap: 0.2,
    });
    const trim = createRetroMaterial({
      color: 0x101009,
      fogScale: 0,
      ambientBoost: 1.35,
      cabin: 0.6,
      snap: 0.2,
    });

    // --- the moulded dash ---------------------------------------------------
    // Shallow and pushed forward: it ends 36 cm ahead of the wheel hub instead of
    // reaching back over it.
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.06, 0.4), shell);
    cowl.position.set(0, 1.71, DASH_Z);
    cowl.rotation.x = -0.12;

    const fascia = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.42, 0.09), shell);
    fascia.position.set(0, 1.52, DASH_FACE_Z);
    fascia.rotation.x = 0.18;

    const knees = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.34, 0.4), shell);
    knees.position.set(0, 1.2, -5.9);

    this.group.add(cowl, fascia, knees);

    // --- the instrument pod ---------------------------------------------------
    // The housing goes 11 cm along -normal, i.e. behind the dial faces. Put it at the same
    // point as the cluster and it hides every gauge in the bus.
    const [bodyY, bodyZ] = behindPod(0.11);
    const podBody = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.25, 0.2), trim);
    podBody.position.set(driverX, bodyY, bodyZ);
    podBody.rotation.x = -POD_TILT;
    this.group.add(podBody);

    // a thin lip along the top, kept shallow so it does not cross the horizon
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.032, 0.1), shell);
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

    for (const side of [-1, 1]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.032, 8), trim);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(side * (this.dialWidth / 2 + 0.042), 0, 0.01);
      radio.add(knob);
    }

    // a row of rocker switches, because a dash with nothing on it reads as a prop
    for (let i = 0; i < 5; i++) {
      const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.026, 0.016), trim);
      rocker.position.set(0.02 + i * 0.045, 1.72, DASH_FACE_Z + 0.04);
      rocker.rotation.x = 0.18;
      this.group.add(rocker);
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
    this.wheel.position.set(driverX, WHEEL_Y, WHEEL_Z);
    // Perpendicular to the column. Getting this wrong by even twenty degrees makes the
    // wheel look stuck onto the dash rather than fitted to the shaft.
    this.wheel.rotation.x = -(Math.PI / 2 - COLUMN_TILT);
    this.group.add(this.wheel);

    // the whole binnacle belongs to the driver's eyes, not to the mirror
    this.group.traverse((child) => child.layers.set(LAYER_DIRECT_ONLY));
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
      new THREE.TorusGeometry(WHEEL_RADIUS, 0.021, 6, 26),
      rimMaterial,
    );
    this.wheel.add(rim);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 10), trim);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.014, 12), rimMaterial);
    pad.rotation.x = Math.PI / 2;
    pad.position.z = 0.032;
    this.wheel.add(pad);

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

    return group;
  }

  update(data: {
    speedMph: number;
    rpm: number;
    wheelAngle: number;
    miles: number;
    clock: string;
    highBeam: boolean;
  }): void {
    const speedT = THREE.MathUtils.clamp(data.speedMph / 80, 0, 1);
    this.speedNeedle.rotation.z = GAUGE_START + (GAUGE_END - GAUGE_START) * speedT;

    const revT = THREE.MathUtils.clamp(data.rpm / 3000, 0, 1);
    this.revNeedle.rotation.z = GAUGE_START + (GAUGE_END - GAUGE_START) * revT;

    // rotation order is XYZ, so the spin about Z happens before the column tilt about X
    this.wheel.rotation.z = -data.wheelAngle * 2.6;

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
