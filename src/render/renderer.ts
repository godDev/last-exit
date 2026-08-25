import * as THREE from 'three';
import { PostPass } from './post';
import { GRAPHICS_PRESETS, settings, type GraphicsQuality } from '../core/settings';
import { shared } from './retroMaterial';

/**
 * Draws the world into a small offscreen buffer, then blows it up through the VHS pass.
 *
 * Colour management is switched off deliberately. Nothing here is physically lit, the
 * palette is authored by hand, and an automatic sRGB transform in the middle would mean
 * the colour picked in code is not the colour on screen.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly post: PostPass;
  /** Public so tooling can read the frame back without depending on a screenshot. */
  readonly target: THREE.WebGLRenderTarget;
  private width = 480;
  private height = 270;

  constructor(canvas: HTMLCanvasElement) {
    THREE.ColorManagement.enabled = false;

    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setPixelRatio(1); // the upscale is the effect; a sharp one would defeat it
    this.gl.setClearColor(0x000000, 1);
    this.gl.autoClear = true;
    this.gl.shadowMap.enabled = settings.graphicsQuality !== 'low';
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    // The scene renders twice into mirrors before the main view. Updating shadow maps on
    // every render would triple their cost, so the loop explicitly requests one update.
    this.gl.shadowMap.autoUpdate = false;

    this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.target.samples = GRAPHICS_PRESETS[settings.graphicsQuality].msaaSamples;

    this.post = new PostPass(this.target.texture);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get aspect(): number {
    return this.width / this.height;
  }

  get resolution(): string { return `${this.width}x${this.height}`; }

  applyGraphicsQuality(quality: GraphicsQuality): void {
    settings.graphicsQuality = quality;
    const preset = GRAPHICS_PRESETS[quality];
    settings.renderHeight = preset.renderHeight;
    this.target.samples = preset.msaaSamples;
    this.gl.shadowMap.enabled = quality !== 'low';
    this.resize();
  }

  requestShadowUpdate(): void {
    if (this.gl.shadowMap.enabled) this.gl.shadowMap.needsUpdate = true;
  }

  resize(): void {
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(180, window.innerHeight);
    this.gl.setSize(w, h, false);

    this.height = settings.renderHeight;
    // Keep the internal target at the window aspect. The old 1440 cap squeezed a 900p
    // target on 16:9 displays and the fullscreen pass stretched it back out.
    this.width = Math.min(1920, Math.round((this.height * w) / h / 2) * 2);
    this.target.setSize(this.width, this.height);
    this.post.setSource(this.target.texture, this.width, this.height);
    shared.uSnapRes.value.set(this.width * 0.86, this.height * 0.86);
  }

  /**
   * Cost of the world itself. `gl.info` resets on every render call, so by the time the
   * frame is on screen it only describes the fullscreen quad — snapshot it in between.
   */
  readonly stats = { calls: 0, triangles: 0 };

  /** Render the world small, then present it large through the tape. */
  present(scene: THREE.Scene, camera: THREE.Camera, elapsed: number): void {
    shared.uTime.value = elapsed;
    this.post.time = elapsed;
    // Preserve the tape mood without letting chroma bleed and vertex damage erase faces.
    this.post.retro = settings.retro * 0.5;

    this.gl.setRenderTarget(this.target);
    this.gl.clear();
    this.gl.render(scene, camera);
    this.stats.calls = this.gl.info.render.calls;
    this.stats.triangles = this.gl.info.render.triangles;

    this.gl.setRenderTarget(null);
    this.gl.render(this.post.scene, this.post.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.gl.dispose();
  }
}
