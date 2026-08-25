import * as THREE from 'three';
import { settings } from '../core/settings';

/**
 * Physical lighting used by the upgraded PBR materials. The legacy world shader keeps
 * evaluating long headlight cones cheaply; this rig adds local highlights and shadows to
 * hero geometry without multiplying the cost across every procedural roadside object.
 */
export class LightingRig {
  readonly group = new THREE.Group();
  private readonly moon = new THREE.DirectionalLight(0x7187b8, 1.25);
  private readonly skyFill = new THREE.HemisphereLight(0x344b80, 0x21150d, 0.82);
  private readonly cabin = new THREE.PointLight(0xffdfbd, 20.3, 5.6, 1.65);
  private readonly headlights: THREE.SpotLight[] = [];
  private readonly targets: THREE.Object3D[] = [];
  private readonly targetPoint = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group.name = 'physical-lighting-rig';
    this.group.add(this.skyFill, this.moon, this.cabin);

    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 150;
    this.moon.shadow.camera.left = -38;
    this.moon.shadow.camera.right = 38;
    this.moon.shadow.camera.top = 38;
    this.moon.shadow.camera.bottom = -38;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.035;

    for (let i = 0; i < 2; i++) {
      const target = new THREE.Object3D();
      const light = new THREE.SpotLight(0xffe1aa, 720, 125, 0.32, 0.46, 1.25);
      light.target = target;
      light.castShadow = i === 0;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 125;
      light.shadow.bias = -0.00025;
      light.shadow.normalBias = 0.025;
      this.headlights.push(light);
      this.targets.push(target);
      this.group.add(light, target);
    }

    scene.add(this.group);
    this.applyQuality();
  }

  applyQuality(): void {
    const medium = settings.graphicsQuality === 'medium';
    const high = settings.graphicsQuality === 'high';
    this.moon.castShadow = medium || high;
    this.moon.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    this.headlights[0].castShadow = high;
    this.headlights[1].castShadow = false;
  }

  update(
    busPosition: THREE.Vector3,
    cabinPosition: THREE.Vector3,
    headLeft: THREE.Vector3,
    headRight: THREE.Vector3,
    forward: THREE.Vector3,
    moonDirection: THREE.Vector3,
    highBeam: boolean,
  ): void {
    this.cabin.position.copy(cabinPosition);

    // Keep the directional shadow camera near the coach so its texels are spent where the
    // player can see them rather than across the entire procedural route.
    this.moon.target.position.copy(busPosition);
    this.moon.position.copy(busPosition).addScaledVector(moonDirection, 55);
    if (!this.moon.target.parent) this.group.add(this.moon.target);

    this.targetPoint.copy(busPosition).addScaledVector(forward, highBeam ? 95 : 70).setY(busPosition.y + 0.3);
    const origins = [headLeft, headRight];
    for (let i = 0; i < this.headlights.length; i++) {
      this.headlights[i].position.copy(origins[i]);
      this.targets[i].position.copy(this.targetPoint);
      this.headlights[i].distance = highBeam ? 145 : 105;
      this.headlights[i].angle = highBeam ? 0.27 : 0.34;
      this.headlights[i].intensity = highBeam ? 1050 : 720;
    }
  }
}
