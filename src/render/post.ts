import * as THREE from 'three';

/**
 * The 1991 pass. Everything that makes the picture look like a fifth-generation console
 * routed through a tired VCR happens here, after the scene has been drawn at 480x270.
 *
 * Order matters: warp the sampling coordinates first (lens + tape wobble), then sample,
 * then damage the colour (quantise, dither, bleed), then overlay the display itself
 * (scanlines, vignette). Doing it the other way round would dither the scanlines.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform vec2 uSourceRes;
  uniform float uTime;
  uniform float uRetro;    // master intensity, 0 = clean
  uniform float uGlitch;   // story-driven tape damage
  uniform float uFade;     // 1 = fully black

  varying vec2 vUv;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // 4x4 ordered Bayer. Cheap, stable under motion, and period-correct.
  float bayer(vec2 pixel) {
    vec2 p = mod(floor(pixel), 4.0);
    float i = p.x + p.y * 4.0;
    float m = 0.0;
    if (i < 0.5) m = 0.0;       else if (i < 1.5) m = 8.0;
    else if (i < 2.5) m = 2.0;  else if (i < 3.5) m = 10.0;
    else if (i < 4.5) m = 12.0; else if (i < 5.5) m = 4.0;
    else if (i < 6.5) m = 14.0; else if (i < 7.5) m = 6.0;
    else if (i < 8.5) m = 3.0;  else if (i < 9.5) m = 11.0;
    else if (i < 10.5) m = 1.0; else if (i < 11.5) m = 9.0;
    else if (i < 12.5) m = 15.0;else if (i < 13.5) m = 7.0;
    else if (i < 14.5) m = 13.0;else m = 5.0;
    return m / 16.0 - 0.5;
  }

  void main() {
    vec2 uv = vUv;

    // --- CRT geometry -------------------------------------------------------
    vec2 centred = uv * 2.0 - 1.0;
    float r2 = dot(centred, centred);
    centred *= 1.0 + r2 * 0.018 * uRetro;
    uv = centred * 0.5 + 0.5;

    // --- tape transport -----------------------------------------------------
    // A slow head-switching band plus rare whole-frame slip.
    float band = fract(uv.y * 1.7 - uTime * 0.06);
    float bandMask = smoothstep(0.985, 1.0, band) * (0.35 + uGlitch);
    float slip = step(0.9982, hash12(vec2(floor(uTime * 12.0), 3.0))) * (0.4 + uGlitch);
    float lineNoise = (hash12(vec2(floor(uv.y * uSourceRes.y), floor(uTime * 24.0))) - 0.5);
    uv.x += lineNoise * (0.0016 * uRetro + bandMask * 0.012 + slip * 0.03);

    uv = clamp(uv, vec2(0.0005), vec2(0.9995));

    // --- chroma separation --------------------------------------------------
    float ca = (0.0012 + uGlitch * 0.004) * uRetro;
    vec3 col;
    col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;

    // --- colour damage ------------------------------------------------------
    vec2 pixel = uv * uSourceRes;

    // 5-bit-per-channel output, dithered so the night sky bands into grain, not stripes
    float levels = mix(255.0, 31.0, uRetro);
    col += bayer(pixel) / levels;
    col = floor(col * levels + 0.5) / levels;

    // luminance noise: film grain and tape hiss are the same gesture here
    float grain = hash12(pixel + fract(uTime) * 913.0) - 0.5;
    col += grain * (0.035 + uGlitch * 0.09) * uRetro;

    // --- the display itself -------------------------------------------------
    float scan = 1.0 - 0.16 * uRetro * step(0.5, fract(pixel.y * 0.5));
    col *= scan;

    float vig = 1.0 - r2 * 0.28 * uRetro;
    col *= clamp(vig, 0.0, 1.0);

    col *= 1.0 - uFade;

    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export class PostPass {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: THREE.ShaderMaterial;

  constructor(source: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: source },
        uSourceRes: { value: new THREE.Vector2(480, 270) },
        uTime: { value: 0 },
        uRetro: { value: 1 },
        uGlitch: { value: 0 },
        uFade: { value: 1 },
      },
    });
    this.material.toneMapped = false;

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSource(texture: THREE.Texture, width: number, height: number): void {
    this.material.uniforms.tDiffuse.value = texture;
    this.material.uniforms.uSourceRes.value.set(width, height);
  }

  set time(t: number) { this.material.uniforms.uTime.value = t; }
  set retro(v: number) { this.material.uniforms.uRetro.value = v; }
  set glitch(v: number) { this.material.uniforms.uGlitch.value = v; }
  set fade(v: number) { this.material.uniforms.uFade.value = v; }
  get fade(): number { return this.material.uniforms.uFade.value as number; }
}
