import * as THREE from 'three';

/**
 * One shader family for the entire world.
 *
 * Real lights are avoided on purpose: a night highway needs two headlight cones reaching
 * ~100 m across several hundred objects, which is exactly the case where per-object
 * SpotLight + shadow maps collapse in a browser. Here the cones are evaluated per fragment
 * from view-space uniforms, so the cost is the same whether the scene holds ten objects or
 * a thousand — and fog, lighting and the PS1 vertex wobble all live in one place.
 */

export type RetroMode = 'plain' | 'road' | 'emissive';

/** Uniform objects shared by reference across every material, so one write updates all. */
export const shared = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color(0x04050a) },
  uFogDensity: { value: 0.0085 },
  uAmbient: { value: new THREE.Color(0x0d1322) },
  uMoonDir: { value: new THREE.Vector3(0.4, 0.72, -0.55) }, // view space, rewritten per frame
  uMoonColor: { value: new THREE.Color(0x202c46) },
  /** Headlight emitters, view space. */
  uHeadL: { value: new THREE.Vector3() },
  uHeadR: { value: new THREE.Vector3() },
  uHeadDir: { value: new THREE.Vector3(0, 0, -1) },
  uHeadColor: { value: new THREE.Color(0xffeccd) },
  uHeadRange: { value: 105 },
  /** x = cos(inner angle), y = cos(outer angle). */
  uHeadCone: { value: new THREE.Vector2(0.985, 0.8) },
  uHeadIntensity: { value: 1.0 },
  /** Separate handheld beam, so walking with a torch never turns off the coach lamps. */
  uTorch: { value: new THREE.Vector3() },
  uTorchDir: { value: new THREE.Vector3(0, 0, -1) },
  uTorchColor: { value: new THREE.Color(0xffedc9) },
  uTorchRange: { value: 27 },
  uTorchCone: { value: new THREE.Vector2(0.984, 0.72) },
  uTorchIntensity: { value: 0 },
  /** Virtual framebuffer the vertices snap to. */
  uSnapRes: { value: new THREE.Vector2(320, 240) },
  /** Warm glow bleeding back off the road into the cabin. */
  uCabinLight: { value: new THREE.Color(0x1c1408) },
};

const VERT = /* glsl */ `
  uniform vec2 uSnapRes;
  uniform float uSnapAmount;

  varying vec3 vPosView;
  varying vec3 vNormalView;
  varying vec2 vUv;
  varying vec3 vTint;

  void main() {
    vUv = uv;
    #ifdef USE_VCOLOR
      vTint = color;
    #else
      vTint = vec3(1.0);
    #endif

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vPosView = mvPosition.xyz;
    vNormalView = normalize(normalMatrix * normal);

    vec4 clip = projectionMatrix * mvPosition;

    // PS1 had no subpixel precision: vertices landed on whole framebuffer pixels.
    if (clip.w > 0.0 && uSnapAmount > 0.0) {
      vec2 halfRes = uSnapRes * 0.5;
      vec2 ndc = clip.xy / clip.w;
      vec2 snapped = (floor(ndc * halfRes) + 0.5) / halfRes;
      clip.xy = mix(ndc, snapped, uSnapAmount) * clip.w;
    }

    gl_Position = clip;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uAmbient;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  uniform vec3 uHeadL;
  uniform vec3 uHeadR;
  uniform vec3 uHeadDir;
  uniform vec3 uHeadColor;
  uniform float uHeadRange;
  uniform vec2 uHeadCone;
  uniform float uHeadIntensity;
  uniform vec3 uTorch;
  uniform vec3 uTorchDir;
  uniform vec3 uTorchColor;
  uniform float uTorchRange;
  uniform vec2 uTorchCone;
  uniform float uTorchIntensity;
  uniform vec3 uCabinLight;

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFogScale;
  uniform float uAmbientBoost;
  uniform float uEmissive;
  uniform float uCabin;
  uniform float uRoughness;
  uniform float uMetalness;

  #ifdef USE_MAP
    uniform sampler2D uMap;
  #endif

  varying vec3 vPosView;
  varying vec3 vNormalView;
  varying vec2 vUv;
  varying vec3 vTint;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 headlight(vec3 origin, vec3 N) {
    vec3 toLight = origin - vPosView;
    float dist = length(toLight);
    vec3 L = toLight / max(dist, 0.001);
    float cosAngle = dot(-L, uHeadDir);
    float cone = smoothstep(uHeadCone.y, uHeadCone.x, cosAngle);
    if (cone <= 0.0) return vec3(0.0);
    float atten = clamp(1.0 - dist / uHeadRange, 0.0, 1.0);
    atten *= atten;
    // Half lambert: the road is hit at a grazing angle, so a pure N.L term leaves it black.
    float diff = dot(N, L) * 0.5 + 0.5;
    return uHeadColor * cone * atten * diff * uHeadIntensity;
  }

  float headlightSpecular(vec3 origin, vec3 N, vec3 V) {
    vec3 toLight = origin - vPosView;
    float dist = length(toLight);
    vec3 L = toLight / max(dist, 0.001);
    float cone = smoothstep(uHeadCone.y, uHeadCone.x, dot(-L, uHeadDir));
    float atten = clamp(1.0 - dist / uHeadRange, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float glossPower = mix(96.0, 7.0, uRoughness);
    float energy = mix(1.25, 0.22, uRoughness);
    return pow(max(0.0, dot(N, H)), glossPower) * energy * cone * atten * atten;
  }

  vec3 torchlight(vec3 N) {
    if (uTorchIntensity <= 0.0) return vec3(0.0);
    vec3 toLight = uTorch - vPosView;
    float dist = length(toLight);
    vec3 L = toLight / max(dist, 0.001);
    float cone = smoothstep(uTorchCone.y, uTorchCone.x, dot(-L, uTorchDir));
    float atten = clamp(1.0 - dist / uTorchRange, 0.0, 1.0);
    atten *= atten;
    float diff = dot(N, L) * 0.5 + 0.5;
    return uTorchColor * cone * atten * diff * uTorchIntensity;
  }

  void main() {
    vec3 N = normalize(vNormalView);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(-vPosView);

    vec3 albedo = uColor * vTint;
    float alpha = uOpacity;
    float roadReflect = 0.0;

    #ifdef USE_MAP
      vec4 texel = texture2D(uMap, vUv);
      albedo *= texel.rgb;
      alpha *= texel.a;
    #endif

    #ifdef ROAD_MARKINGS
      float u = vUv.x;          // metres from the centre line
      float v = vUv.y;          // metres along the route
      float au = abs(u);

      // Fine, even asphalt grain. Route-space cracks, tar repairs and worn ruts were
      // removed so new defects no longer appear under the coach as the ribbon advances.
      float grain = hash21(floor(vec2(u * 2.7, v * 2.7)));
      albedo *= 0.86 + grain * 0.28;

      // Pale aggregate on the shoulder catches the edge of the beam one pebble at a time.
      float shoulder = smoothstep(3.8, 5.8, au) * (1.0 - smoothstep(6.0, 8.0, au));
      float pebble = step(0.84, hash21(floor(vec2(u * 4.6, v * 3.7))));
      albedo += vec3(0.055, 0.047, 0.034) * shoulder * pebble;

      // Desert floor: several scales of fixed route-space detail prevent the wide field
      // from reading as one flat brown polygon. Broad dry washes sit beneath small stone
      // clusters and pale mineral patches, all stable as the floating origin moves.
      float field = smoothstep(7.5, 12.0, au);
      float soil = hash21(floor(vec2(u * 0.18, v * 0.15)));
      float fineSoil = hash21(floor(vec2(u * 1.15, v * 0.9)));
      albedo *= 1.0 + field * ((soil - 0.5) * 0.20 + (fineSoil - 0.5) * 0.075);
      float washWave = abs(sin(v * 0.035 + u * 0.082 + sin(v * 0.011) * 2.4));
      float wash = field * smoothstep(0.72, 0.96, washWave) * step(0.58, soil);
      albedo = mix(albedo, albedo * vec3(0.72, 0.68, 0.62), wash * 0.42);
      float mineral = field * step(0.965, hash21(floor(vec2(u * 0.42, v * 0.38))));
      albedo += vec3(0.07, 0.055, 0.035) * mineral;
      float fieldStone = field * step(0.982, hash21(floor(vec2(u * 2.8, v * 2.2))));
      albedo += vec3(0.10, 0.075, 0.045) * fieldStone;

      // dashed yellow centre line: 3 m stripe every 12 m
      float dash = step(mod(v, 12.0), 3.0);
      float centre = step(au, 0.09) * dash;
      // solid white fog lines at the edge of the travelled lanes
      float edge = step(3.42, au) * step(au, 3.58);

      float wear = 0.55 + 0.45 * hash21(floor(vec2(v * 0.7, u)));
      albedo = mix(albedo, vec3(0.62, 0.52, 0.13) * wear, centre);
      albedo = mix(albedo, vec3(0.60, 0.58, 0.54) * wear, edge);
      roadReflect = (centre * 0.34 + edge * 0.26) * wear;

    #endif

    #ifdef EMISSIVE
      vec3 lit = albedo * uEmissive;
    #else
      vec3 light = uAmbient * uAmbientBoost;
      light += uMoonColor * (dot(N, uMoonDir) * 0.5 + 0.5);
      light += headlight(uHeadL, N);
      light += headlight(uHeadR, N);
      light += torchlight(N);
      light += uCabinLight * uCabin;
      vec3 diffuseAlbedo = albedo * (1.0 - uMetalness * 0.72);
      vec3 lit = diffuseAlbedo * light;
      // Small, deliberately quantised highlights give windscreens, paint, wet asphalt and
      // chrome a sense of material without replacing the hand-authored retro lighting.
      float moonRim = pow(1.0 - max(0.0, dot(N, V)), 3.0) * max(0.0, dot(N, uMoonDir));
      float beamSpec = headlightSpecular(uHeadL, N, V) + headlightSpecular(uHeadR, N, V);
      vec3 f0 = mix(vec3(0.04), albedo, uMetalness);
      lit += mix(uMoonColor, f0, uMetalness) * moonRim * mix(0.16, 0.04, uRoughness);
      lit += uHeadColor * f0 * beamSpec * uHeadIntensity * 0.32;
      #ifdef ROAD_MARKINGS
        // Retroreflective paint returns a small warm flash directly to the driver.
        float beamFacing = smoothstep(0.10, 0.92, 1.0 - abs(vPosView.x) / max(1.0, -vPosView.z));
        lit += uHeadColor * roadReflect * beamFacing * 0.16;
      #endif
    #endif

    // exp2 fog straight to night. Draw distance is an art decision here, not a budget one.
    float dist = length(vPosView);
    // Slightly denser near the road surface: this separates foreground props from the
    // horizon and makes headlight range feel volumetric without a separate fog pass.
    float groundFog = 1.0 + smoothstep(4.5, -1.5, vPosView.y) * 0.16;
    float f = 1.0 - exp(-pow(dist * uFogDensity * uFogScale * groundFog, 2.0));
    lit = mix(lit, uFogColor, clamp(f, 0.0, 1.0));

    gl_FragColor = vec4(lit, alpha);
  }
`;

export interface RetroOptions {
  mode?: RetroMode;
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  /** 0 = stable geometry, 1 = full PS1 wobble. */
  snap?: number;
  /** Multiplier on global fog density. 0 keeps cabin surfaces out of the fog. */
  fogScale?: number;
  ambientBoost?: number;
  /** PBR-compatible surface controls used by the hybrid retro shader. */
  roughness?: number;
  metalness?: number;
  /** Only used by mode 'emissive'. */
  emissive?: number;
  /** How much warm bounce light from the headlights this surface receives. */
  cabin?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  alphaTest?: number;
}

export function createRetroMaterial(opts: RetroOptions = {}): THREE.ShaderMaterial {
  const mode = opts.mode ?? 'plain';
  const defines: Record<string, string> = {};
  if (mode === 'road') defines.ROAD_MARKINGS = '1';
  if (mode === 'emissive') defines.EMISSIVE = '1';
  if (opts.map) defines.USE_MAP = '1';
  if (opts.vertexColors) defines.USE_VCOLOR = '1';

  const material = new THREE.ShaderMaterial({
    defines,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: opts.transparent ?? false,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
    alphaTest: opts.alphaTest ?? 0,
    // three still needs to know, so it declares the `color` attribute for us
    vertexColors: opts.vertexColors ?? false,
    uniforms: {
      // shared by reference — written once per frame in renderer.ts
      ...shared,
      // per material
      uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
      uOpacity: { value: opts.opacity ?? 1 },
      uSnapAmount: { value: opts.snap ?? 1 },
      uFogScale: { value: opts.fogScale ?? 1 },
      uAmbientBoost: { value: opts.ambientBoost ?? 1 },
      uEmissive: { value: opts.emissive ?? 1 },
      uCabin: { value: opts.cabin ?? 0 },
      uRoughness: { value: opts.roughness ?? 0.72 },
      uMetalness: { value: opts.metalness ?? 0 },
      uMap: { value: opts.map ?? null },
    },
  });

  material.toneMapped = false;
  return material;
}

const _v = new THREE.Vector3();

/** Recompute the view-space headlight rig. Call once per camera, per frame. */
export function updateHeadlights(
  camera: THREE.Camera,
  leftWorld: THREE.Vector3,
  rightWorld: THREE.Vector3,
  dirWorld: THREE.Vector3,
): void {
  const view = camera.matrixWorldInverse;
  shared.uHeadL.value.copy(_v.copy(leftWorld).applyMatrix4(view));
  shared.uHeadR.value.copy(_v.copy(rightWorld).applyMatrix4(view));
  shared.uHeadDir.value.copy(_v.copy(dirWorld).transformDirection(view).normalize());
}

/** Recompute the view-space handheld torch. Its intensity is zero when the torch is off. */
export function updateTorch(camera: THREE.Camera, world: THREE.Vector3, direction: THREE.Vector3): void {
  const view = camera.matrixWorldInverse;
  shared.uTorch.value.copy(_v.copy(world).applyMatrix4(view));
  shared.uTorchDir.value.copy(_v.copy(direction).transformDirection(view).normalize());
}

export function updateMoon(camera: THREE.Camera, dirWorld: THREE.Vector3): void {
  shared.uMoonDir.value.copy(
    _v.copy(dirWorld).transformDirection(camera.matrixWorldInverse).normalize(),
  );
}
