import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { createRetroMaterial } from '../render/retroMaterial';
import type { Bus } from '../bus/drive';

/** Low-poly mesas beyond the populated roadside. They follow the observer only because
 * they are hundreds of metres away; rotation stays fixed, so the skyline remains stable. */
export class DistantLandscape {
  readonly group = new THREE.Group();

  constructor(seed: number) {
    const rand = mulberry32(seed ^ 0x4d455341);
    const geometry = new THREE.CylinderGeometry(0.58, 1, 1, 7, 3, false);
    const material = createRetroMaterial({
      color: 0x51372f,
      fogScale: 0.13,
      ambientBoost: 3.1,
      snap: 0.32,
    });
    const count = 24;
    const mesas = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.18;
      const radius = 360 + rand() * 250;
      const height = 34 + rand() * 82;
      const width = 48 + rand() * 105;
      dummy.position.set(Math.sin(angle) * radius, -10 + height * 0.36, Math.cos(angle) * radius);
      dummy.scale.set(width, height, width * (0.55 + rand() * 0.6));
      dummy.rotation.y = rand() * Math.PI;
      dummy.updateMatrix();
      mesas.setMatrixAt(i, dummy.matrix);
    }
    mesas.frustumCulled = false;
    this.group.add(mesas);

    // A nearer belt of broken foothills gives the field parallax and separates it from
    // the distant mesas. Instancing keeps the extra depth to one draw call.
    const foothillGeo = new THREE.DodecahedronGeometry(1, 0);
    const foothillMat = createRetroMaterial({
      color: 0x352b24,
      fogScale: 0.32,
      ambientBoost: 2.8,
      snap: 0.24,
    });
    const foothills = new THREE.InstancedMesh(foothillGeo, foothillMat, 38);
    for (let i = 0; i < 38; i++) {
      const angle = (i / 38) * Math.PI * 2 + (rand() - 0.5) * 0.22;
      const radius = 185 + rand() * 175;
      const height = 5 + rand() * 18;
      const width = 12 + rand() * 34;
      dummy.position.set(Math.sin(angle) * radius, -3 + height * 0.28, Math.cos(angle) * radius);
      dummy.scale.set(width, height, width * (0.6 + rand() * 0.7));
      dummy.rotation.set((rand() - 0.5) * 0.18, rand() * Math.PI, (rand() - 0.5) * 0.12);
      dummy.updateMatrix();
      foothills.setMatrixAt(i, dummy.matrix);
    }
    foothills.frustumCulled = false;
    this.group.add(foothills);
  }

  update(camera: THREE.Camera): void {
    this.group.position.set(camera.position.x, 0, camera.position.z);
  }
}

/** Dust motes suspended in the headlight volume. One point cloud, no per-particle objects. */
export class HeadlightDust {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(seed: number) {
    const rand = mulberry32(seed ^ 0x44555354);
    const count = 280;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const z = 3 + Math.pow(rand(), 0.72) * 115;
      const spread = 1.5 + z * 0.095;
      positions[i * 3] = (rand() - 0.5) * spread * 2;
      positions[i * 3 + 1] = 0.15 + rand() * (2.2 + z * 0.012);
      positions[i * 3 + 2] = z;
      sizes[i] = 0.45 + rand() * 1.25;
      phases[i] = rand() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
      vertexShader: `
        attribute float size; attribute float phase;
        uniform float uTime; varying float vAlpha;
        void main(){
          vec3 p=position;
          p.x += sin(uTime*0.45+phase)*0.18;
          p.y += sin(uTime*0.31+phase*1.7)*0.09;
          vec4 mv=modelViewMatrix*vec4(p,1.0);
          gl_Position=projectionMatrix*mv;
          gl_PointSize=size*(78.0/max(22.0,-mv.z));
          vAlpha=smoothstep(120.0,18.0,p.z)*smoothstep(1.0,8.0,p.z);
        }`,
      fragmentShader: `
        precision highp float; uniform float uIntensity; varying float vAlpha;
        void main(){
          vec2 p=gl_PointCoord-0.5; float a=1.0-smoothstep(0.08,0.5,length(p));
          gl_FragColor=vec4(0.95,0.72,0.42,a*vAlpha*0.12*uIntensity);
        }`,
    });
    this.material.toneMapped = false;
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(bus: Bus, elapsed: number): void {
    this.points.position.copy(bus.position);
    this.points.rotation.set(0, bus.heading, 0);
    this.material.uniforms.uTime.value = elapsed;
    this.material.uniforms.uIntensity.value = bus.highBeam ? 1.25 : 0.8;
  }
}
