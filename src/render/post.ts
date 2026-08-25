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

  float lastExitLuma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  // Five taps are enough to bloom lamps and instrument glass at this resolution. Keeping
  // it restrained preserves the low-fi silhouette instead of washing the night grey.
  vec3 bloom(vec2 uv) {
    vec2 px = 1.8 / uSourceRes;
    vec3 sum = texture2D(tDiffuse, uv).rgb * 2.0;
    sum += texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb;
    sum += texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb;
    sum += texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb;
    sum += texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb;
    sum += texture2D(tDiffuse, uv + px).rgb * 0.65;
    sum += texture2D(tDiffuse, uv - px).rgb * 0.65;
    sum += texture2D(tDiffuse, uv + vec2(px.x, -px.y)).rgb * 0.65;
    sum += texture2D(tDiffuse, uv + vec2(-px.x, px.y)).rgb * 0.65;
    sum *= 0.125;
    return sum * smoothstep(0.20, 0.72, lastExitLuma(sum));
  }

  float windshieldDust(vec2 uv) {
    // Sparse fixed flecks on the glass. Two scales avoid an obvious repeated noise field.
    vec2 p = floor(uv * vec2(118.0, 67.0));
    float seed = hash12(p + 71.3);
    vec2 local = fract(uv * vec2(118.0, 67.0)) - 0.5;
    float fleck = (1.0 - smoothstep(0.04, 0.17, length(local))) * step(0.982, seed);
    vec2 p2 = floor(uv * vec2(43.0, 25.0));
    float haze = step(0.972, hash12(p2 + 19.7)) * 0.22;
    return fleck + haze;
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
    float bandMask = smoothstep(0.975, 1.0, band) * uGlitch;
    float slip = step(0.9982, hash12(vec2(floor(uTime * 12.0), 3.0))) * uGlitch;
    float lineNoise = (hash12(vec2(floor(uv.y * uSourceRes.y), floor(uTime * 24.0))) - 0.5);
    uv.x += lineNoise * (uGlitch * 0.003 + bandMask * 0.012 + slip * 0.03);

    // Slow vertical tracking error and a thin switching line near the bottom of frame.
    float trackingPos = fract(uTime * 0.047);
    float tracking = exp(-abs(uv.y - trackingPos) * 190.0);
    uv.x += sin(uv.y * 210.0 + uTime * 7.0) * tracking * 0.009 * uRetro * uGlitch;

    uv = clamp(uv, vec2(0.0005), vec2(0.9995));

    // --- chroma separation --------------------------------------------------
    float ca = (0.00065 + uGlitch * 0.004) * uRetro;
    vec3 col;
    col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;

    // Recover edge definition lost to the low-resolution target before applying tape
    // damage. This makes instruments, faces and vehicle panel lines clearer while broad
    // VHS colour bleed remains visible around them.
    vec2 sharpPx = 1.0 / uSourceRes;
    vec3 neighbourhood =
      texture2D(tDiffuse, uv + vec2(sharpPx.x, 0.0)).rgb +
      texture2D(tDiffuse, uv - vec2(sharpPx.x, 0.0)).rgb +
      texture2D(tDiffuse, uv + vec2(0.0, sharpPx.y)).rgb +
      texture2D(tDiffuse, uv - vec2(0.0, sharpPx.y)).rgb;
    vec3 sharpened = col * 1.44 - neighbourhood * 0.11;
    col = mix(col, max(vec3(0.0), sharpened), 0.42);

    // Magnetic tape retains a faint delayed copy of high-contrast edges. Restrict the
    // ghost to a narrow horizontal offset so faces and vehicle silhouettes stay legible.
    vec3 delayed = texture2D(tDiffuse, uv - vec2(0.0055 + uGlitch * 0.008, 0.0)).rgb;
    float ghostEdge = max(0.0, lastExitLuma(delayed) - lastExitLuma(col));
    col += delayed * ghostEdge * (0.12 + 0.14 * uRetro);

    // Optical spill around the moon, headlamps, signs and dashboard bulbs.
    col += bloom(uv) * mix(0.12, 0.34, uRetro);

    // Dust becomes visible only where bright scenery back-lights the windscreen.
    float brightBehind = smoothstep(0.10, 0.62, lastExitLuma(col));
    float dust = windshieldDust(uv) * brightBehind;
    col += vec3(0.16, 0.135, 0.09) * dust * (0.20 + 0.24 * uRetro);


    // A very restrained horizontal flare from the hottest lamps and reflective signs.
    vec3 flareSample = texture2D(tDiffuse, vec2(uv.x + 0.025, uv.y)).rgb;
    float flare = smoothstep(0.72, 1.15, lastExitLuma(flareSample));
    col += vec3(0.18, 0.11, 0.055) * flare * 0.16;

    // A restrained night grade: lift colour separation in the blacks while warm light
    // remains warm. The S-curve keeps the horizon from turning into a flat blue band.
    col = max(col, 0.0);
    col = clamp(col, 0.0, 1.0);
    vec3 graded = col * col * (3.0 - 2.0 * col);
    // Keep some linear response so the dashboard and asphalt retain detail in the toe.
    col = mix(col, graded, 0.68);
    col += vec3(0.0025, 0.0035, 0.0060) * smoothstep(0.18, 0.0, lastExitLuma(col));
    float luma = lastExitLuma(col);
    col = mix(vec3(luma), col, 1.10);
    col *= vec3(0.96, 1.0, 1.08);

    // --- colour damage ------------------------------------------------------
    vec2 pixel = uv * uSourceRes;

    // 5-bit-per-channel output, dithered so the night sky bands into grain, not stripes
    float levels = mix(255.0, 31.0, uRetro);
    col += bayer(pixel) / levels;
    col = floor(col * levels + 0.5) / levels;

    // luminance noise: film grain and tape hiss are the same gesture here
    float grain = hash12(pixel + fract(uTime) * 913.0) - 0.5;
    col += grain * (0.0035 + uGlitch * 0.09) * uRetro;

    // Short-lived white RF scratches, sparse enough not to obscure authored detail.
    float rfLine = step(0.992, hash12(vec2(floor(pixel.y), floor(uTime * 18.0))));
    float rfGrain = hash12(vec2(floor(pixel.x * 0.35), floor(uTime * 30.0)));
    col += vec3(rfGrain) * rfLine * 0.075 * uRetro * uGlitch;
    col += vec3(0.055, 0.07, 0.09) * tracking * uRetro * uGlitch;

    // --- the display itself -------------------------------------------------
    float scan = 1.0 - 0.055 * uRetro * step(0.5, fract(pixel.y * 0.5));
    col *= scan;

    float vig = 1.0 - smoothstep(0.28, 1.65, r2) * 0.34 * uRetro;
    col *= clamp(vig, 0.0, 1.0);

    // Very faint glass reflection keeps the image from reading like a flat pixel canvas.
    col += vec3(0.015, 0.019, 0.028) * pow(max(0.0, 1.0 - length(centred - vec2(-0.48, 0.42))), 5.0) * uRetro;

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
