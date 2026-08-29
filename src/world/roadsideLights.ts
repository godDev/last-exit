import * as THREE from 'three';
import { settings } from '../core/settings';
import { createPBRMaterial } from '../render/pbrMaterial';
import { createRetroMaterial } from '../render/retroMaterial';
import { canvasTexture } from '../render/textures';
import { RoutePath, STATION_SPACING } from './curvature';

interface LampSlot {
  fixture: THREE.Group;
  bulb: THREE.Mesh;
  glow: THREE.Sprite;
  light: THREE.PointLight;
  lightPool: THREE.Mesh;
  station: number;
  falling: boolean;
  fallElapsed: number;
  fallStart: THREE.Quaternion;
  fallTarget: THREE.Quaternion;
  rankedIntensity: number;
}

export interface RoadsideLightCollision {
  normal: THREE.Vector3;
  penetration: number;
  fixture: THREE.Object3D;
}

/** Sparse sodium highway lamps, pooled and positioned from route station indices. */
export class RoadsideLights {
  readonly group = new THREE.Group();
  private readonly slots: LampSlot[] = [];
  private readonly glowTexture: THREE.Texture;
  private readonly collisionNormal = new THREE.Vector3();
  private readonly fallenStations = new Map<number, THREE.Vector3>();

  constructor(private readonly path: RoutePath) {
    this.group.name = 'roadside-warm-lamps';
    this.glowTexture = canvasTexture(64, 64, (ctx, w, h) => {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gradient.addColorStop(0, 'rgba(255,238,184,1)');
      gradient.addColorStop(0.18, 'rgba(255,174,65,.9)');
      gradient.addColorStop(1, 'rgba(255,110,20,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    });

    const poleMaterial = createPBRMaterial({ surface: 'metal', color: 0x3c3b36, roughness: 0.66 });
    const bulbMaterial = createRetroMaterial({ color: 0xffb34f, mode: 'emissive', emissive: 2.4, snap: 0.1 });
    const poolMaterial = createRetroMaterial({
      map: this.glowTexture,
      mode: 'emissive',
      emissive: 0.72,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      side: THREE.DoubleSide,
      snap: 0.08,
    });
    poolMaterial.blending = THREE.AdditiveBlending;
    for (let i = 0; i < 10; i++) {
      const fixture = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 7.2, 8), poleMaterial);
      pole.position.y = 3.6;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.1), poleMaterial);
      arm.position.set(-0.52, 7.08, 0);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.34), poleMaterial);
      neck.position.set(-1.03, 6.96, 0);
      const bulb = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.16), bulbMaterial.clone());
      bulb.rotation.x = Math.PI / 2;
      bulb.position.set(-1.03, 6.84, 0);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }));
      glow.scale.setScalar(2.6);
      glow.position.set(-1.03, 6.82, 0);
      const light = new THREE.PointLight(0xffa43d, 0, 25, 1.65);
      light.position.set(-1.03, 6.65, 0);
      const lightPool = new THREE.Mesh(new THREE.CircleGeometry(6.4, 28), poolMaterial.clone());
      lightPool.rotation.x = -Math.PI / 2;
      lightPool.position.set(-1.03, 0.035, 0);
      lightPool.renderOrder = 2;
      fixture.add(pole, arm, neck, bulb, glow, light, lightPool);
      this.group.add(fixture);
      this.slots.push({
        fixture,
        bulb,
        glow,
        light,
        lightPool,
        station: Number.NaN,
        falling: false,
        fallElapsed: 0,
        fallStart: new THREE.Quaternion(),
        fallTarget: new THREE.Quaternion(),
        rankedIntensity: 0,
      });
    }
  }

  update(busDistance: number, dt = 0): void {
    const centre = Math.round(busDistance / STATION_SPACING);
    const base = Math.floor(centre / 5) * 5;
    const activeLights = settings.graphicsQuality === 'high' ? 4 : settings.graphicsQuality === 'medium' ? 3 : 2;
    const ranked: Array<{ slot: LampSlot; gap: number }> = [];

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const station = base + (i - 2) * 5;
      const point = this.path.at(station);
      slot.fixture.visible = Boolean(point);
      slot.rankedIntensity = 0;
      if (!point) continue;
      const stationChanged = slot.station !== station;
      slot.station = station;
      const side = (Math.floor(station / 5) & 1) === 0 ? -1 : 1;
      const rx = -Math.cos(point.heading);
      const rz = Math.sin(point.heading);
      slot.fixture.position.set(point.x + rx * side * 6.1, point.y - 0.28, point.z + rz * side * 6.1);
      slot.fixture.rotation.set(0, point.heading + (side > 0 ? Math.PI : 0), 0);
      if (stationChanged) {
        const fallenDirection = this.fallenStations.get(station);
        if (fallenDirection) this.prepareFall(slot, fallenDirection, true);
        else {
          slot.falling = false;
          slot.fallElapsed = 0;
        }
      }
      ranked.push({ slot, gap: Math.abs(station * STATION_SPACING - busDistance) });
    }

    ranked.sort((a, b) => a.gap - b.gap);
    for (let i = 0; i < Math.min(activeLights, ranked.length); i++) {
      ranked[i].slot.rankedIntensity = 135;
    }

    for (const slot of this.slots) {
      if (!slot.fixture.visible) continue;
      let brightness = 1;
      if (slot.falling) {
        slot.fallElapsed += dt;
        const fallT = THREE.MathUtils.smoothstep(slot.fallElapsed, 0, 1.15);
        slot.fixture.quaternion.copy(slot.fallStart).slerp(slot.fallTarget, fallT);

        // The damaged sodium lamp coughs irregularly for a moment, then its remaining
        // light drains away over several seconds instead of switching off in one frame.
        if (slot.fallElapsed < 0.9) {
          const flicker = Math.sin(slot.fallElapsed * 41 + slot.station * 0.17)
            * Math.sin(slot.fallElapsed * 23 + 0.8);
          brightness = 0.62 + Math.max(0, flicker) * 0.38;
        } else {
          const fade = 1 - THREE.MathUtils.smoothstep(slot.fallElapsed, 0.9, 3.45);
          const dyingFlicker = 0.86 + Math.sin(slot.fallElapsed * 29) * 0.14 * fade;
          brightness = Math.max(0, fade * dyingFlicker);
        }
      }

      slot.light.intensity = slot.rankedIntensity * brightness;
      const bulbMaterialForSlot = slot.bulb.material as THREE.ShaderMaterial;
      if (bulbMaterialForSlot.uniforms?.uEmissive) {
        bulbMaterialForSlot.uniforms.uEmissive.value = 2.4 * brightness;
      }
      (slot.glow.material as THREE.SpriteMaterial).opacity = brightness;
      (slot.lightPool.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.48 * brightness;
    }
  }

  /** Circle collision for the narrow lamp base; fallen fixtures stop blocking the bus. */
  collisionAt(position: THREE.Vector3, busRadius: number): RoadsideLightCollision | null {
    let best: RoadsideLightCollision | null = null;
    let deepest = 0;
    for (const slot of this.slots) {
      if (!slot.fixture.visible || slot.falling) continue;
      const dx = position.x - slot.fixture.position.x;
      const dz = position.z - slot.fixture.position.z;
      const reach = busRadius + 0.16;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= reach * reach) continue;
      const distance = Math.sqrt(Math.max(distanceSq, 0.0001));
      const penetration = reach - distance;
      if (penetration <= deepest) continue;
      deepest = penetration;
      this.collisionNormal.set(dx / distance, 0, dz / distance);
      best = { normal: this.collisionNormal.clone(), penetration, fixture: slot.fixture };
    }
    return best;
  }

  /** Start a base-hinged fall and the lamp's delayed flicker/fade sequence. */
  knockDown(hit: RoadsideLightCollision, direction: THREE.Vector3): boolean {
    const slot = this.slots.find((candidate) => candidate.fixture === hit.fixture);
    if (!slot || slot.falling) return false;
    const shove = direction.clone().setY(0).normalize();
    this.fallenStations.set(slot.station, shove.clone());
    this.prepareFall(slot, shove, false);
    return true;
  }

  private prepareFall(slot: LampSlot, shove: THREE.Vector3, complete: boolean): void {
    slot.falling = true;
    slot.fallElapsed = complete ? 3.45 : 0;
    slot.fallStart.copy(slot.fixture.quaternion);
    const axis = new THREE.Vector3(shove.z, 0, -shove.x).normalize();
    const fall = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI * 0.47);
    slot.fallTarget.copy(fall).multiply(slot.fallStart);
    if (complete) slot.fixture.quaternion.copy(slot.fallTarget);
  }
}
