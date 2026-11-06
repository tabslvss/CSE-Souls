import * as THREE from 'three';
import { setVhsEnabled, vhsEnabled } from './fx/vhsSetting';

const MIN_INTERNAL_HEIGHT = 240;
const MAX_INTERNAL_HEIGHT = 300;

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * The PS1 look: the scene is drawn small, then each low-res pixel is gamma-corrected, pushed
 * up or down by a 4x4 Bayer pattern, and rounded to 32 levels per channel. That is the 15-bit
 * color and ordered dithering the original console's GPU used.
 */
const DITHER_SHADER = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uResolution;
  uniform float uLevels;
  uniform float uDitherStrength;
  uniform float uVignette;
  uniform float uDamage;
  varying vec2 vUv;

  const float BAYER[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );

  void main() {
    vec2 pixel = floor(vUv * uResolution);
    vec3 color = texture2D(tScene, (pixel + 0.5) / uResolution).rgb;
    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));

    // Slight warm grade, so shadows lean toward old gold.
    color *= vec3(1.04, 0.99, 0.88);

    vec2 centered = vUv - 0.5;
    color *= 1.0 - dot(centered, centered) * uVignette;

    // Only with the tape off. The tape pass draws its own, and getting hurt must show either way.
    color = mix(color, vec3(0.42, 0.015, 0.02) + color * 0.3, smoothstep(0.1, 0.5, dot(centered, centered) * 1.6) * uDamage * 0.85);

    int index = int(mod(pixel.x, 4.0)) + 4 * int(mod(pixel.y, 4.0));
    float threshold = (BAYER[index] + 0.5) / 16.0 - 0.5;
    color += threshold * uDitherStrength / uLevels;
    color = floor(color * uLevels + 0.5) / uLevels;

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Remembers the last frames: each frame fades into this buffer, so anything moving leaves a smear
 * behind it, drifting up and slightly out of register, like a tape head that can't quite let go.
 */
const ECHO_SHADER = /* glsl */ `
  uniform sampler2D tCurrent;
  uniform sampler2D tPrevious;
  uniform vec2 uResolution;
  uniform float uDecay;
  uniform float uDrift;
  varying vec2 vUv;

  void main() {
    vec3 current = texture2D(tCurrent, vUv).rgb;
    vec2 back = vUv - vec2(0.0, uDrift / uResolution.y);
    vec3 previous = vec3(
      texture2D(tPrevious, back + vec2(uDrift / uResolution.x, 0.0)).r,
      texture2D(tPrevious, back).g,
      texture2D(tPrevious, back - vec2(uDrift / uResolution.x, 0.0)).b
    );
    gl_FragColor = vec4(mix(current, previous, uDecay), 1.0);
  }
`;

/**
 * The tape. The PS1 picture goes through what a worn VHS deck would do to it: color is carried at
 * a fraction of the picture's sharpness, so it bleeds sideways while brightness stays crisp, which
 * is why the dither survives. Then line wobble, drifting tracking bands, head-switching noise at
 * the bottom edge, scanlines and a soft glow around highlights. uMotion at 0 stills all movement.
 */
const VHS_SHADER = /* glsl */ `
  uniform sampler2D tPicture;
  uniform sampler2D tEcho;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMotion;
  uniform float uIntensity;
  uniform float uGlitch;
  uniform float uEcho;
  uniform float uDamage;
  uniform float uImpact;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  const mat3 TO_YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 TO_RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);

  void main() {
    vec2 uv = vUv;
    float line = floor(uv.y * uResolution.y);
    float pixelX = 1.0 / uResolution.x;
    float time = uTime * uMotion;

    // Tape wobble: slow and small. Lines lean together rather than jittering apart.
    float wobble = sin(uv.y * 7.0 + time * 1.3) * 0.5 + sin(uv.y * 23.0 - time * 2.1) * 0.25;
    float shift = wobble * 0.32 * uIntensity * uMotion * pixelX;

    // Two tracking bands drift up the picture. Inside one, lines tear sideways and go noisy.
    float band1 = fract(time * 0.041 + 0.2);
    float band2 = fract(time * 0.087 + 0.65);
    float dist1 = abs(uv.y - band1);
    float dist2 = abs(uv.y - band2);
    float inBand = smoothstep(0.022 + uGlitch * 0.03, 0.0, dist1) + smoothstep(0.012 + uGlitch * 0.045, 0.0, dist2) * 0.7;
    float tearNoise = hash(vec2(line, floor(time * 24.0))) - 0.5;
    shift += inBand * tearNoise * pixelX * (2.2 + uGlitch * 10.0) * uMotion * min(1.0, uIntensity * 1.6);

    // A hit knocks whole blocks of lines sideways for a moment.
    if (uGlitch > 0.02) {
      float block = floor(uv.y * 14.0 + hash(vec2(floor(time * 18.0), 3.0)) * 14.0);
      float pushed = step(1.0 - uGlitch * 0.5, hash(vec2(block, floor(time * 30.0))));
      shift += pushed * (hash(vec2(block, 9.0)) - 0.5) * uGlitch * 16.0 * pixelX * uMotion;
    }

    // Head switching: the bottom few lines of a frame are always wrecked on tape.
    float headEdge = 7.0 / uResolution.y;
    float inHead = 1.0 - smoothstep(headEdge * 0.55, headEdge, uv.y);
    shift += inHead * (0.5 + hash(vec2(line, floor(time * 30.0)))) * 7.0 * pixelX * min(1.0, uIntensity * 1.5) * (0.25 + uMotion * 0.75);

    uv.x += shift;

    // Brightness comes from the exact pixel. Sampling at its center keeps the dither crisp.
    vec2 pixelUv = (floor(uv * uResolution) + 0.5) / uResolution;
    vec3 sharp = texture2D(tPicture, pixelUv).rgb;

    // The echo holds where things just were, dark things as well as bright ones. A dark body
    // rolling across dark ground has to smear too, and that takes a mix and not just adding light.
    vec3 echo = texture2D(tEcho, uv).rgb;
    vec3 ghost = max(echo - sharp, vec3(0.0));
    vec3 combined = mix(sharp, echo, uEcho * 0.6) + ghost * uEcho * 0.55;

    // Color from a wide smear of neighbors, smeared further on a hit.
    float bleed = pixelX * (1.1 + uIntensity * 1.6 + uGlitch * 6.0);
    vec3 smear = texture2D(tPicture, uv + vec2(-bleed * 1.5, 0.0)).rgb * 0.3
      + texture2D(tPicture, uv + vec2(-bleed * 0.5, 0.0)).rgb * 0.3
      + texture2D(tPicture, uv + vec2(bleed * 0.5, 0.0)).rgb * 0.25
      + texture2D(tPicture, uv + vec2(bleed * 1.5, 0.0)).rgb * 0.15;
    vec3 yiq = TO_YIQ * combined;
    vec3 smearYiq = TO_YIQ * (mix(smear, echo, uEcho * 0.6) + ghost * uEcho * 0.55);
    float chromaMix = 0.55 + 0.45 * min(1.0, uIntensity * 1.7);
    yiq.yz = mix(yiq.yz, smearYiq.yz * (1.0 + 0.05 * uIntensity), chromaMix);
    vec3 color = TO_RGB * yiq;

    // Red and blue slide apart, a little always and a lot on a hit.
    float split = pixelX * (0.25 * uIntensity + uGlitch * 3.4);
    if (split > 0.0) {
      vec3 right = texture2D(tPicture, pixelUv + vec2(split, 0.0)).rgb;
      vec3 left = texture2D(tPicture, pixelUv - vec2(split, 0.0)).rgb;
      color.r += (right.r - sharp.r) * 0.85;
      color.b += (left.b - sharp.b) * 0.85;
    }

    // Soft phosphor: highlights spill to the right and glow a little.
    vec3 near = texture2D(tPicture, uv - vec2(pixelX * 1.5, 0.0)).rgb;
    color += max(near - 0.72, vec3(0.0)) * 0.55 * uIntensity;

    // Faint noise, stronger inside the tracking bands.
    float grainTime = floor(uTime * 24.0) * (0.15 + uMotion * 0.85);
    float grain = hash(vec2(floor(vUv.x * uResolution.x), line) + grainTime * 0.37) - 0.5;
    color += grain * (0.028 * uIntensity + inBand * 0.08 * min(1.0, uIntensity * 1.5) + uGlitch * 0.035);
    color += inHead * (hash(vec2(floor(vUv.x * uResolution.x * 0.5), line + grainTime)) - 0.5) * 0.2 * min(1.0, uIntensity * 1.5);

    // Tape lifts its blacks and tames its whites.
    color = mix(color, color * 0.96 + 0.018, min(1.0, uIntensity * 1.3));

    // Scanlines belong to the low-res lines, so the picture still reads as about 270 lines.
    float scan = fract(vUv.y * uResolution.y);
    float scanline = 1.0 - (0.09 + 0.16 * uIntensity) * smoothstep(0.55, 1.0, abs(scan - 0.5) * 2.0);
    color *= scanline;

    // A blow landing: for a few frames the blacks crush and the middle punches up, like a deck
    // overloading. It's how the whole picture takes part in the hit without a white flash.
    if (uImpact > 0.001) {
      vec2 fromCenter = vUv - 0.5;
      float crush = smoothstep(0.06, 0.8, color.r * 0.3 + color.g * 0.6 + color.b * 0.1);
      color = mix(color, color * (0.28 + crush * 1.3), uImpact * 0.7);
      color *= 1.0 - uImpact * 0.55 * smoothstep(0.08, 0.42, dot(fromCenter, fromCenter));
    }

    // Taking damage bleeds red in from the edges, and pulls color out of the middle.
    if (uDamage > 0.001) {
      vec2 centered = vUv - 0.5;
      float edge = smoothstep(0.1, 0.5, dot(centered, centered) * 1.6);
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, vec3(gray), uDamage * 0.3);
      color = mix(color, vec3(0.42, 0.015, 0.02) + color * 0.3, edge * uDamage * 0.85);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

/** Shared by every PSX material, so vertices all snap to the same coarse grid. */
export const snapUniform = { value: new THREE.Vector2(160, 120) };

/** A calm base look, so the game stays readable. Hits and rolls push above it for a moment. */
const BASE_INTENSITY = 0.55;
const BASE_ECHO = 0.14;
const GLITCH_DECAY = 5;
const ECHO_DECAY = 2.2;
const DAMAGE_DECAY = 1.6;
const IMPACT_DECAY = 11;
/** Longest gap between frames the tape effects will step over, so a hidden tab doesn't jump. */
const MAX_FRAME_SECONDS = 0.1;

/** The tape controls. Everything decays on its own, so callers only ever push. */
export class VhsControls {
  /** Overall strength from 0 to 1, for the calm base look. Spikes are added on top. */
  intensity = BASE_INTENSITY;
  /** @internal */ glitchLevel = 0;
  /** @internal */ echoLevel = 0;
  /** @internal */ damageLevel = 0;
  /** @internal */ impactLevel = 0;

  /** Tracking tear, block shifts and RGB split: 0.25 for a normal hit, 0.5 heavy, 0.8 a kill or a big hit taken. */
  glitch(amount: number): void {
    this.glitchLevel = Math.min(1, Math.max(this.glitchLevel, amount));
  }

  /** Stronger ghost trails behind moving things: about 0.5 on a roll, 0.25 while running. */
  echo(amount: number): void {
    this.echoLevel = Math.min(1, Math.max(this.echoLevel, amount));
  }

  /** Red bleeding in from the screen's edges when you take damage: the share of health lost, or so. */
  damageFlash(amount: number): void {
    this.damageLevel = Math.min(1, Math.max(this.damageLevel, amount));
  }

  /** The picture itself taking the blow, for a few frames: about 0.3 normal, 0.6 heavy, 1 a kill. */
  impact(amount: number): void {
    this.impactLevel = Math.min(1, Math.max(this.impactLevel, amount));
  }

  /** The player's setting, saved in the browser. Off skips the whole tape pass. */
  get enabled(): boolean {
    return vhsEnabled();
  }

  set enabled(on: boolean) {
    setVhsEnabled(on);
  }
}

export class PsxRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly vhs = new VhsControls();
  private readonly target: THREE.WebGLRenderTarget;
  private readonly picture: THREE.WebGLRenderTarget;
  private echoFront: THREE.WebGLRenderTarget;
  private echoBack: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly echoMaterial: THREE.ShaderMaterial;
  private readonly vhsMaterial: THREE.ShaderMaterial;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private lastNow = 0;
  private tapeTime = Math.random() * 50;
  private echoFresh = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);

    // Half-float keeps dark gradients smooth until the dither pass quantizes them.
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });

    // Linear filtering, so taps between pixels give the tape's soft chroma from a single fetch.
    const tapeOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    };
    this.picture = new THREE.WebGLRenderTarget(4, 4, tapeOptions);
    this.echoFront = new THREE.WebGLRenderTarget(4, 4, tapeOptions);
    this.echoBack = new THREE.WebGLRenderTarget(4, 4, tapeOptions);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: DITHER_SHADER,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uResolution: { value: new THREE.Vector2(4, 4) },
        uLevels: { value: 31 },
        uDitherStrength: { value: 1 },
        uVignette: { value: 1.1 },
        uDamage: { value: 0 },
      },
    });
    this.echoMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: ECHO_SHADER,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tCurrent: { value: this.picture.texture },
        tPrevious: { value: this.echoBack.texture },
        uResolution: { value: new THREE.Vector2(4, 4) },
        uDecay: { value: 0.8 },
        uDrift: { value: 0.3 },
      },
    });
    this.vhsMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: VHS_SHADER,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPicture: { value: this.picture.texture },
        tEcho: { value: this.echoFront.texture },
        uResolution: { value: new THREE.Vector2(4, 4) },
        uTime: { value: 0 },
        uMotion: { value: 1 },
        uIntensity: { value: BASE_INTENSITY },
        uGlitch: { value: 0 },
        uEcho: { value: BASE_ECHO },
        uDamage: { value: 0 },
        uImpact: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    const internalHeight = Math.min(MAX_INTERNAL_HEIGHT, Math.max(MIN_INTERNAL_HEIGHT, Math.round(height / 3)));
    const internalWidth = Math.max(1, Math.round((internalHeight * width) / Math.max(1, height)));
    this.target.setSize(internalWidth, internalHeight);
    this.picture.setSize(internalWidth, internalHeight);
    this.echoFront.setSize(internalWidth, internalHeight);
    this.echoBack.setSize(internalWidth, internalHeight);
    this.echoFresh = false;
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(internalWidth, internalHeight);
    (this.echoMaterial.uniforms.uResolution.value as THREE.Vector2).set(internalWidth, internalHeight);
    (this.vhsMaterial.uniforms.uResolution.value as THREE.Vector2).set(internalWidth, internalHeight);
    snapUniform.value.set(internalWidth / 2, internalHeight / 2);
  }

  /** Draws a frame. seconds is optional: it defaults to real elapsed time, which is what the tape wants. */
  render(scene: THREE.Scene, camera: THREE.Camera, seconds?: number): void {
    const now = performance.now();
    const frame = Math.min(MAX_FRAME_SECONDS, seconds ?? (now - this.lastNow) / 1000);
    this.lastNow = now;

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);

    // Before the choice below, so a spike can't sit frozen until the tape is turned back on.
    const vhs = this.vhs;
    vhs.glitchLevel *= Math.exp(-GLITCH_DECAY * frame);
    vhs.echoLevel *= Math.exp(-ECHO_DECAY * frame);
    vhs.damageLevel *= Math.exp(-DAMAGE_DECAY * frame);
    vhs.impactLevel *= Math.exp(-IMPACT_DECAY * frame);

    if (!vhsEnabled() || this.vhs.intensity <= 0) {
      this.material.uniforms.uDamage.value = vhs.damageLevel;
      this.quad.material = this.material;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.quadScene, this.quadCamera);
      this.echoFresh = false;
      return;
    }

    this.material.uniforms.uDamage.value = 0;
    this.quad.material = this.material;
    this.renderer.setRenderTarget(this.picture);
    this.renderer.render(this.quadScene, this.quadCamera);

    this.tapeTime += frame;
    // Reduced motion keeps the tape's color and removes everything that moves.
    const still = this.reducedMotion.matches;

    const echoAmount = still ? 0 : Math.min(0.85, BASE_ECHO * (vhs.intensity / BASE_INTENSITY) + vhs.echoLevel * 0.7);
    if (!still) {
      // Frame-rate independent: the same smear length whether the game runs at 30 or 60 fps.
      const decay = Math.exp(-frame * (9 - 6 * vhs.echoLevel));
      const echoUniforms = this.echoMaterial.uniforms;
      echoUniforms.uDecay.value = this.echoFresh ? decay : 0;
      echoUniforms.uDrift.value = 0.2 + vhs.echoLevel * 0.5;
      echoUniforms.tPrevious.value = this.echoBack.texture;
      this.quad.material = this.echoMaterial;
      this.renderer.setRenderTarget(this.echoFront);
      this.renderer.render(this.quadScene, this.quadCamera);
      this.echoFresh = true;
    }

    const uniforms = this.vhsMaterial.uniforms;
    uniforms.tEcho.value = this.echoFront.texture;
    uniforms.uTime.value = this.tapeTime;
    uniforms.uMotion.value = still ? 0 : 1;
    uniforms.uIntensity.value = vhs.intensity;
    uniforms.uGlitch.value = still ? 0 : vhs.glitchLevel;
    uniforms.uEcho.value = echoAmount;
    uniforms.uDamage.value = vhs.damageLevel;
    uniforms.uImpact.value = still ? vhs.impactLevel * 0.5 : vhs.impactLevel;
    this.quad.material = this.vhsMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);

    if (!still) {
      const swap = this.echoFront;
      this.echoFront = this.echoBack;
      this.echoBack = swap;
    }
  }

  dispose(): void {
    this.target.dispose();
    this.picture.dispose();
    this.echoFront.dispose();
    this.echoBack.dispose();
    this.material.dispose();
    this.echoMaterial.dispose();
    this.vhsMaterial.dispose();
    this.quad.geometry.dispose();
    this.renderer.dispose();
  }
}

/** Adds PS1 vertex wobble: each projected vertex snaps to a coarse screen grid. */
export function applyVertexSnap(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = snapUniform;
    shader.vertexShader = `uniform vec2 uSnap;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vec3 snappedNdc = gl_Position.xyz / gl_Position.w;
       snappedNdc.xy = floor(snappedNdc.xy * uSnap + 0.5) / uSnap;
       gl_Position.xyz = snappedNdc * gl_Position.w;`,
    );
  };
  material.customProgramCacheKey = () => 'psx-vertex-snap';
}

/** Hard pixel edges on a texture, with no smoothing. */
export function makeTextureCrunchy(texture: THREE.Texture): void {
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}
