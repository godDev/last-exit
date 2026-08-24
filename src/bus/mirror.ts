import * as THREE from 'three';
import { createRetroMaterial, shared, updateHeadlights, updateMoon } from '../render/retroMaterial';

/**
 * The rear-view mirror — the whole reason this prototype exists.
 *
 * It is a second camera rendering the cabin into a small texture, which is all it takes
 * mechanically. What makes it a horror instrument is the layer split:
 *
 *   layer 0  the world, the cabin, anything that is simply there
 *   layer 1  visible to the driver only — never appears in the glass
 *   layer 2  visible in the glass only — not in the cabin
 *
 * So "the passenger is gone, but he is still in the mirror" is one call to
 * `object.layers.set(MIRROR_ONLY)`, not a bespoke effect. Every beat in the pitch that
 * turns on the mirror is reachable from here.
 */

export const LAYER_WORLD = 0;
export const LAYER_DIRECT_ONLY = 1;
export const LAYER_MIRROR_ONLY = 2;

/** Deliberately tiny: a bus mirror at 480x270 is barely forty pixels tall. */
const RT_WIDTH = 288;
const RT_HEIGHT = 96;
/**
 * Sized against the frame, not against the real thing. A 0.6 m mirror a metre from the
 * eye covers nearly half the screen and clips on the corner; this reads as a coach mirror
 * and still leaves the windscreen the windscreen.
 */
const GLASS_WIDTH = 0.42;
const GLASS_HEIGHT = GLASS_WIDTH * (RT_HEIGHT / RT_WIDTH);

export interface MirrorOptions {
  /** Exterior coach mirrors are tall and narrow; the saloon glass remains wide. */
  side?: boolean;
}

export class Mirror {
  readonly mesh: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  /** Public so tooling can read the glass back without a screenshot. */
  readonly target: THREE.WebGLRenderTarget;
  private readonly glass: THREE.Mesh;
  /** Rendered every other frame; the mirror does not need 60 Hz. */
  private parity = 0;
  /** World position of the glass, for the "lean in and look" camera move. */
  readonly worldPosition = new THREE.Vector3();

  constructor(options: MirrorOptions = {}) {
    const side = options.side ?? false;
    const targetWidth = side ? 112 : RT_WIDTH;
    const targetHeight = side ? 176 : RT_HEIGHT;
    const glassWidth = side ? 0.24 : GLASS_WIDTH;
    const glassHeight = side ? 0.42 : GLASS_HEIGHT;

    this.target = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      colorSpace: THREE.LinearSRGBColorSpace,
    });

    this.camera = new THREE.PerspectiveCamera(side ? 38 : 30, targetWidth / targetHeight, 0.1, 1200);
    this.camera.layers.set(LAYER_WORLD);
    this.camera.layers.enable(LAYER_MIRROR_ONLY);

    const geometry = new THREE.PlaneGeometry(glassWidth, glassHeight);
    // a mirror swaps left and right; do it once, in the geometry
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));

    this.glass = new THREE.Mesh(
      geometry,
      createRetroMaterial({
        map: this.target.texture,
        // the glass shows its own render, so it must not be lit or fogged again
        mode: 'emissive',
        emissive: 1,
        snap: 0.25,
      }),
    );

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(glassWidth + (side ? 0.075 : 0.06), glassHeight + (side ? 0.07 : 0.055), side ? 0.065 : 0.04),
      createRetroMaterial({ color: 0x14100c, fogScale: 0, ambientBoost: 2.4, cabin: 1, snap: 0.25 }),
    );
    frame.position.z = -0.025;

    this.mesh = new THREE.Group();
    this.mesh.add(frame, this.glass);
    this.mesh.layers.set(LAYER_DIRECT_ONLY);
    frame.layers.set(LAYER_DIRECT_ONLY);
    this.glass.layers.set(LAYER_DIRECT_ONLY);
  }

  /**
   * Aim the mirror camera down the aisle. Called once per frame with the cabin transform,
   * since the bus is moving through the world rather than sitting at the origin.
   */
  aim(cabin: THREE.Object3D, target: THREE.Vector3): void {
    this.mesh.getWorldPosition(this.worldPosition);
    this.camera.position.copy(this.worldPosition);
    this.camera.up.copy(cabin.up);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  /**
   * Draw the glass. The headlight rig is view-space, so it has to be recomputed for this
   * camera and handed back to the caller afterwards — otherwise the world behind the bus
   * is lit as though the driver were sitting in the mirror.
   */
  render(
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    lights: { left: THREE.Vector3; right: THREE.Vector3; direction: THREE.Vector3 },
    moon: THREE.Vector3,
  ): void {
    this.parity ^= 1;
    if (this.parity === 0) return;

    updateHeadlights(this.camera, lights.left, lights.right, lights.direction);
    updateMoon(this.camera, moon);

    const previous = gl.getRenderTarget();
    gl.setRenderTarget(this.target);
    gl.clear();
    gl.render(scene, this.camera);
    gl.setRenderTarget(previous);
  }

  /** Grime and a slight tint, so the glass never looks like a clean video feed. */
  setCondition(dirt: number): void {
    const material = this.glass.material as THREE.ShaderMaterial;
    material.uniforms.uColor.value.setRGB(1 - dirt * 0.25, 1 - dirt * 0.3, 1 - dirt * 0.38);
    material.uniforms.uEmissive.value = 1 - dirt * 0.15;
  }

  /** Exposure compensation for a small mirror render at night. */
  setBrightness(multiplier: number): void {
    const material = this.glass.material as THREE.ShaderMaterial;
    material.uniforms.uEmissive.value = multiplier;
  }

  dispose(): void {
    this.target.dispose();
  }
}

/** Convenience for the story layer: move an object between the world and the glass. */
export function setVisibility(
  object: THREE.Object3D,
  where: 'both' | 'cabin' | 'mirror' | 'nowhere',
): void {
  object.traverse((child) => {
    switch (where) {
      case 'both':
        child.layers.set(LAYER_WORLD);
        break;
      case 'cabin':
        child.layers.set(LAYER_DIRECT_ONLY);
        break;
      case 'mirror':
        child.layers.set(LAYER_MIRROR_ONLY);
        break;
      case 'nowhere':
        child.layers.disableAll();
        break;
    }
  });
}

/**
 * The cabin glow the mirror renders against, tied to the shared uniform block.
 * Intensity 1 is roughly "four tired dome lamps": enough to read a silhouette by, not
 * enough to read a face.
 */
export function setCabinGlow(intensity: number, warm = 1): void {
  shared.uCabinLight.value.setRGB(0.42 * intensity * warm, 0.32 * intensity, 0.17 * intensity);
}
