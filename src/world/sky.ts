import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

/**
 * Desert sky, 1991: no light pollution for eighty miles in any direction, so the Milky Way
 * is a real light source and the horizon is the only thing separating ground from space.
 * Drawn first, depth-write off, so everything else simply covers it.
 */

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // pin to the far plane
  }
`;

const DOME_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uGlow;
  uniform float uGlowAmount;
  varying vec3 vDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float ridge(float x) {
    float broad = sin(x * 2.7 + 0.8) * 0.46 + sin(x * 6.1 - 1.4) * 0.22;
    float detail = sin(x * 13.7 + 2.1) * 0.08 + sin(x * 24.0) * 0.035;
    return broad + detail;
  }

  void main() {
    float h = clamp(vDir.y, -1.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.55, h));

    // Several broad, almost invisible airglow bands give the clear desert atmosphere
    // depth without turning the sky into a conventional cloudy backdrop.
    float airBand = sin(atan(vDir.x, vDir.z) * 3.0 + h * 18.0) * 0.5 + 0.5;
    float airMask = smoothstep(0.02, 0.16, h) * (1.0 - smoothstep(0.18, 0.42, h));
    col += vec3(0.010, 0.014, 0.025) * airBand * airMask;

    // the galactic band, running high and to one side
    float band = 1.0 - abs(dot(normalize(vDir), normalize(vec3(0.62, 0.55, -0.56))));
    float milky = smoothstep(0.62, 1.0, band) * smoothstep(-0.02, 0.3, h);
    float mottle = 0.48 + 0.52 * hash13(floor(vDir * 90.0));
    float dustLane = 0.68 + 0.32 * sin(vDir.x * 47.0 + vDir.z * 31.0);
    col += vec3(0.060, 0.064, 0.086) * milky * mottle * dustLane;

    // sodium haze of a town somewhere below the horizon
    float townDir = max(0.0, dot(normalize(vec3(vDir.x, 0.0, vDir.z)), vec3(0.0, 0.0, 1.0)));
    float townGlow = pow(townDir, 12.0) * smoothstep(0.16, -0.02, h);
    col += uGlow * townGlow * uGlowAmount;

    // Two distant desert ridges live in the sky shader, so they cost no world geometry
    // and remain perfectly stable through floating-origin rebases.
    float azimuth = atan(vDir.x, vDir.z);
    float farLine = 0.018 + ridge(azimuth + 0.7) * 0.018;
    float nearLine = 0.002 + ridge(azimuth * 0.83 - 1.8) * 0.031;
    float farRidge = 1.0 - smoothstep(farLine - 0.006, farLine + 0.004, h);
    float nearRidge = 1.0 - smoothstep(nearLine - 0.006, nearLine + 0.004, h);
    col = mix(col, vec3(0.018, 0.021, 0.032), farRidge * 0.72);
    col = mix(col, vec3(0.008, 0.009, 0.014), nearRidge * 0.90);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float size;
  attribute float phase;
  uniform float uTime;
  varying float vMag;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;
    float twinkle = 0.82 + 0.18 * sin(uTime * 1.7 + phase * 6.283);
    vMag = twinkle;
    gl_PointSize = size;
  }
`;

const STAR_FRAG = /* glsl */ `
  precision highp float;
  varying float vMag;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float core = 1.0 - smoothstep(0.18, 1.0, dot(p, p));
    gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * vMag * (0.65 + core * 0.7), core);
  }
`;

export class Sky {
  readonly group = new THREE.Group();
  private starMat: THREE.ShaderMaterial;
  private domeMat: THREE.ShaderMaterial;
  private moon: THREE.Mesh;
  /** Direction the moonlight comes from, used by the world shader. */
  readonly moonDirection = new THREE.Vector3(0.44, 0.62, -0.65).normalize();

  constructor(seed: number) {
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uHorizon: { value: new THREE.Color(0x05060c) },
        uZenith: { value: new THREE.Color(0x0a1024) },
        uGlow: { value: new THREE.Color(0x2a1c0c) },
        uGlowAmount: { value: 1 },
      },
    });
    this.domeMat.toneMapped = false;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), this.domeMat);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    this.group.add(dome);

    // --- stars --------------------------------------------------------------
    const rand = mulberry32(seed ^ 0x5747);
    const COUNT = 1400;
    const pos = new Float32Array(COUNT * 3);
    const size = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // upper hemisphere, biased away from the horizon haze
      const u = rand();
      const y = Math.pow(rand(), 0.7);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = u * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r * 900;
      pos[i * 3 + 1] = y * 900;
      pos[i * 3 + 2] = Math.sin(a) * r * 900;
      const bright = rand();
      size[i] = bright > 0.985 ? 4 : bright > 0.9 ? 2.5 : 1.4;
      phase[i] = rand();
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));

    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      depthWrite: false,
      depthTest: false,
      uniforms: { uTime: { value: 0 } },
    });
    this.starMat.toneMapped = false;
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -999;
    this.group.add(stars);

    // --- moon ---------------------------------------------------------------
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xd2d6e2,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(26, 20), moonMat);
    this.moon.position.copy(this.moonDirection).multiplyScalar(900);
    this.moon.renderOrder = -998;
    this.moon.frustumCulled = false;
    this.group.add(this.moon);

    // Low-contrast maria and craters keep the moon from reading as a flat UI circle. The
    // markings are separate geometry so they retain the deliberately coarse silhouette.
    const lunarDark = new THREE.MeshBasicMaterial({
      color: 0x838b9e,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const craterSpecs: Array<[number, number, number, number]> = [
      [-7.5, 5.5, 5.8, 3.9], [8.2, 1.5, 4.2, 5.1], [-2.0, -7.2, 3.1, 2.6],
      [5.8, 9.0, 2.4, 1.8], [-10.5, -4.0, 2.1, 3.0],
    ];
    for (const [x, y, sx, sy] of craterSpecs) {
      const crater = new THREE.Mesh(new THREE.CircleGeometry(1, 10), lunarDark);
      crater.position.set(x, y, 0.02);
      crater.scale.set(sx, sy, 1);
      crater.renderOrder = -997;
      crater.frustumCulled = false;
      this.moon.add(crater);
    }

    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(72, 28),
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position.z=gl_Position.w; }`,
        fragmentShader: `precision highp float; varying vec2 vUv; void main(){ float d=length(vUv-0.5)*2.0; float a=pow(max(0.0,1.0-d),2.6)*0.16; gl_FragColor=vec4(0.28,0.38,0.66,a); }`,
      }),
    );
    halo.position.copy(this.moon.position).multiplyScalar(0.999);
    halo.renderOrder = -999;
    halo.frustumCulled = false;
    this.group.add(halo);

    this.group.renderOrder = -1000;
    this.group.frustumCulled = false;
  }

  update(camera: THREE.Camera, elapsed: number): void {
    this.group.position.setFromMatrixPosition(camera.matrixWorld);
    this.starMat.uniforms.uTime.value = elapsed;
    this.moon.quaternion.copy(camera.quaternion);
  }

  /** 0 = the dead middle of the night, 1 = first grey before Carson. */
  setDawn(t: number): void {
    this.domeMat.uniforms.uHorizon.value.setRGB(
      0.02 + t * 0.11,
      0.023 + t * 0.10,
      0.047 + t * 0.13,
    );
    this.domeMat.uniforms.uZenith.value.setRGB(
      0.039 + t * 0.05,
      0.063 + t * 0.06,
      0.141 + t * 0.09,
    );
  }
}
