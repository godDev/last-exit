import type * as THREE from 'three';
import { settings, saveSettings } from '../core/settings';

/**
 * F3. Object and draw-call counts are in here on purpose: the failure mode of a streaming
 * world is not a crash, it is a slow leak of props that were spawned and never recycled.
 */
export class DebugPanel {
  private readonly root: HTMLElement;
  private accum = 0;
  private frames = 0;

  constructor() {
    this.root = document.getElementById('debug')!;
    this.apply();
  }

  toggle(): void {
    settings.showDebug = !settings.showDebug;
    saveSettings();
    this.apply();
  }

  private apply(): void {
    this.root.classList.toggle('hidden', !settings.showDebug);
  }

  update(
    dt: number,
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    sceneStats: { calls: number; triangles: number },
    rows: Record<string, string | number>,
  ): void {
    if (!settings.showDebug) return;
    this.accum += dt;
    this.frames++;
    if (this.accum < 0.25) return;
    const fps = this.frames / this.accum;
    const frameMs = (this.accum / this.frames) * 1000;
    this.accum = 0;
    this.frames = 0;

    let objects = 0;
    scene.traverse(() => objects++);
    const info = gl.info;

    const lines = Object.entries(rows).map(
      ([k, v]) => `${k.padEnd(9)} ${typeof v === 'number' ? v.toFixed(2) : v}`,
    );
    lines.push(
      `${'fps'.padEnd(9)} ${fps.toFixed(1)}`,
      `${'frame ms'.padEnd(9)} ${frameMs.toFixed(2)}`,
      `${'draws'.padEnd(9)} ${sceneStats.calls}`,
      `${'tris'.padEnd(9)} ${sceneStats.triangles}`,
      `${'objects'.padEnd(9)} ${objects}`,
      `${'geom/tex'.padEnd(9)} ${info.memory.geometries}/${info.memory.textures}`,
    );
    this.root.textContent = lines.join('\n');
  }
}
