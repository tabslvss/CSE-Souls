import * as THREE from 'three';
import { DEFAULT_APPEARANCE } from '../../../shared/classes';
import { createCharacter, type CharacterModel } from './characters';
import { CameraFx } from './fx/camera';
import { GameFx } from './fx/effects';
import { FootTrail, landHit, takeHit } from './fx/feel';
import type { ParticlePool } from './fx/particles';
import { sound } from '../sound';
import { PsxRenderer, applyVertexSnap } from './psxRenderer';
import { IMPACT_PRESETS, ImpactSequencer, type ImpactPresetName } from './impactFrames';
import { CRITICAL_SAMPLES, CriticalFx } from './fx/critical';

/*
 * Development page for trying each effect, at /fx-lab.html on the Vite dev server. Same PS1 and
 * tape pipeline as the game, on bare ground beside a character. Time runs through window.fxlab.step,
 * so the screenshot scripts get the same frames however slow the machine is.
 */

const canvas = document.getElementById('view') as HTMLCanvasElement;
const psx = new PsxRenderer(canvas);
psx.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0c0b);
scene.fog = new THREE.Fog(0x0d0c0b, 14, 60);
scene.add(new THREE.HemisphereLight(0xc9c0a8, 0x2a2118, 1.5));
const sun = new THREE.DirectionalLight(0xffe0b0, 1.3);
sun.position.set(-3, 6, 4);
scene.add(sun);

const groundTexture = new THREE.TextureLoader().load('/textures/ground-dirt.png');
groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
groundTexture.repeat.set(24, 24);
groundTexture.colorSpace = THREE.SRGBColorSpace;
groundTexture.magFilter = THREE.NearestFilter;
const groundMaterial = new THREE.MeshLambertMaterial({ map: groundTexture });
applyVertexSnap(groundMaterial);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90, 40, 40), groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
const fx = new GameFx(scene, camera);
const camFx = new CameraFx();
const parts = { fx, camera: camFx, vhs: psx.vhs };
const footTrail = new FootTrail(parts, true);
const critFx = new CriticalFx({ scene, camera, fx, cameraFx: camFx, psx });

let model: CharacterModel | null = null;
void createCharacter('duelist', { ...DEFAULT_APPEARANCE, variant: 0 }).then((created) => {
  model = created;
  created.play('idle');
  created.root.rotation.y = Math.PI / 2;
  scene.add(created.root);
});

const chestStandIn = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.55), new THREE.MeshLambertMaterial({ color: 0x3a2a18 }));
chestStandIn.position.set(1.6, 0.25, 0);
scene.add(chestStandIn);

// Bright things for the impact frames to burn through: an ember brazier and an arcane orb.
const glow = (color: number, x: number, y: number, z: number, size: number) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color }));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const light = new THREE.PointLight(color, 3, 4);
  light.position.copy(mesh.position);
  scene.add(light);
};
glow(0xff7020, -1.4, 0.5, -1.2, 0.22);
glow(0x60b0ff, 2.6, 1.6, -1.6, 0.18);

/*
 * Criticals: a character of the right class beside a block standing in for the stunned boss, its
 * front face 3.4 m out as in the animation strips. The view pulls back to the side while one plays.
 */
const BOSS_RADIUS = 1.6;
const BOSS_HEIGHT = 3.4;
const BOSS_FEET = { x: 3.4 + BOSS_RADIUS, y: 0, z: 0 };
const BOSS_HEAD = { x: BOSS_FEET.x - 0.6, y: BOSS_HEIGHT + 0.5, z: 0 };
const bossStandIn = new THREE.Mesh(
  new THREE.BoxGeometry(BOSS_RADIUS * 2, BOSS_HEIGHT, BOSS_RADIUS * 2),
  new THREE.MeshLambertMaterial({ color: 0x4a3c30 }),
);
bossStandIn.position.set(BOSS_FEET.x, BOSS_HEIGHT / 2, 0);
bossStandIn.visible = false;
scene.add(bossStandIn);
const critModels = new Map<string, Promise<CharacterModel>>();
let critModel: CharacterModel | null = null;
let critView = false;
const critOffset = new THREE.Vector3();
const ORIGIN = { x: 0, y: 0, z: 0 };

function critCharacter(name: string): Promise<CharacterModel> {
  const sample = CRITICAL_SAMPLES.find((item) => item.name === name)!;
  let made = critModels.get(name);
  if (!made) {
    made = createCharacter(sample.classId, { ...DEFAULT_APPEARANCE, variant: sample.variant }).then((created) => {
      created.root.rotation.y = Math.PI / 2;
      created.root.visible = false;
      scene.add(created.root);
      return created;
    });
    critModels.set(name, made);
  }
  return made;
}

/** Plays one weapon's critical against the block. Resolves once it has started. */
async function playCritical(name: string): Promise<void> {
  const sample = CRITICAL_SAMPLES.find((item) => item.name === name)!;
  const created = await critCharacter(name);
  if (critModel && critModel !== created) critModel.root.visible = false;
  critModel = created;
  created.root.visible = true;
  if (model) model.root.visible = false;
  chestStandIn.visible = false;
  bossStandIn.visible = true;
  critView = true;
  created.playCritical();
  critFx.start({
    classId: sample.classId,
    variant: sample.variant,
    attacker: { position: () => ORIGIN, yaw: Math.PI / 2, model: created },
    target: { position: () => BOSS_FEET, radius: BOSS_RADIUS, height: BOSS_HEIGHT },
    mine: true,
  });
}

/** Back to the plain view with the default character. */
function leaveCritical(): void {
  critView = false;
  if (critModel) critModel.root.visible = false;
  if (model) model.root.visible = true;
  chestStandIn.visible = true;
  bossStandIn.visible = false;
  critFx.weakPoint.hide();
}

const CHEST = { x: 0.1, y: 1.2, z: 0 };
const FEET = { x: 0, y: 0, z: 0 };
const tip = new THREE.Vector3();
const base = new THREE.Vector3();

/** A sweep in front of the character, standing in for a real blade until attacks are wired up. */
let trailLeft = 0;
let trailTotal = 0;
let trailId = 0;
const placeBlade = (progress: number) => {
  // A downward diagonal cut in a tilted plane, roughly what a real sword does.
  const angle = -1.25 + progress * 2.9;
  const reach = 1.55;
  const inner = 0.5;
  tip.set(0.25 + Math.cos(angle) * reach, 1.15 - Math.sin(angle) * reach * 0.62, Math.sin(angle) * reach * 0.78);
  base.set(0.25 + Math.cos(angle) * inner, 1.15 - Math.sin(angle) * inner * 0.62, Math.sin(angle) * inner * 0.78);
};
const swing = (style: string, seconds = 0.26) => {
  trailId += 1;
  trailLeft = trailTotal = seconds;
  fx.beginTrail(trailId, style as never);
  placeBlade(0);
  fx.pushTrail(trailId, tip, base);
};

/** Bolts fly out of the character and end on their own, as the server's message would end them. */
let boltId = 100;
const pendingEnds: { id: number; at: number; hit: boolean; style: string; endX: number }[] = [];
let clock = 0;
const shoot = (style: string, speed: number, range: number, hit = true) => {
  boltId += 1;
  const start = { x: -1.6, y: 1.25, z: 0 };
  fx.spawnProjectile(boltId, start, Math.PI / 2, speed, range, style as never);
  pendingEnds.push({ id: boltId, at: clock + range / speed, hit, style, endX: start.x + range });
};

const collector = () => FEET;

/** The character crosses the shot, for judging the dust trail and the tape's ghost behind it. */
let runLeft = 0;
let runRoll = false;

const EFFECTS: Record<string, () => void> = {
  'hit-blade': () => { fx.hit(CHEST, Math.PI / 2, 'blade'); shake(0.25, false, false); },
  'hit-blade-kill': () => { fx.hit(CHEST, Math.PI / 2, 'blade', { kill: true }); shake(0.8, false, true); },
  'hit-heavy': () => { fx.hit(CHEST, Math.PI / 2, 'heavy', { heavy: true }); shake(0.5, true, false); },
  'hit-heavy-kill': () => { fx.hit(CHEST, Math.PI / 2, 'heavy', { heavy: true, kill: true }); shake(0.8, true, true); },
  'hit-thrust': () => { fx.hit(CHEST, Math.PI / 2, 'thrust'); shake(0.25, false, false); },
  'hit-magic': () => { fx.hit(CHEST, Math.PI / 2, 'magic'); shake(0.3, false, false); },
  'hit-arrow': () => { fx.hit(CHEST, Math.PI / 2, 'arrow'); shake(0.25, false, false); },
  'hit-metal': () => { fx.hit(CHEST, Math.PI / 2, 'blade', { material: 'metal' }); shake(0.25, false, false); },
  'trail-gold': () => swing('blade'),
  'trail-magic': () => swing('magic'),
  'trail-heavy': () => swing('heavy', 0.36),
  wind: () => { fx.wind({ x: 0.9, y: 0, z: 0 }, Math.PI / 2, 1.2); psx.vhs.glitch(0.3); },
  'bolt-staff': () => fx.arcane.meteorCast(++boltId, 3, 0, 1.1, 2.5, 0, 0),
  'bolt-wand': () => shoot('magic', 22, 4),
  arrow: () => shoot('arrow', 34, 4),
  cast: () => fx.castMagic({ x: 0.45, y: 1.15, z: 0 }, 'magic'),
  'dust-burst': () => fx.dustBurst({ x: 3, y: 0.9, z: 0 }, 40, collector, () => undefined),
  'foot-walk': () => fx.footDust(FEET, 'walk'),
  'foot-run': () => fx.footDust(FEET, 'run'),
  'foot-roll': () => { fx.footDust(FEET, 'roll'); psx.vhs.echo(0.6); },
  'foot-land': () => fx.footDust(FEET, 'land'),
  chest: () => fx.chestOpen({ x: 1.6, y: 0, z: 0 }),
  death: () => {
    fx.deathMist(FEET);
    if (model) fx.dissolve(model.root, 1.7, () => { if (model) model.root.visible = true; });
  },
  respawn: () => fx.respawn(FEET),
  run: () => { if (model) model.root.position.x = -3; runLeft = 1.1; runRoll = false; model?.play('run'); },
  roll: () => { if (model) model.root.position.x = -3; runLeft = 0.7; runRoll = true; model?.play('dodge', true); psx.vhs.echo(0.7); },
  potion: () => fx.potion(FEET),
  'feel-kill': () => landHit(parts, CHEST, Math.PI / 2, 'heavy', { kill: true, mine: true }),
  'feel-hurt': () => takeHit(parts, -Math.PI / 2, 0.4),
};

/** Impact frames on the chest, with a matching hit so there are bright particles to keep. */
const impactFocus = { x: 0.5, y: 0.5 };
const IMPACT_HIT: Record<ImpactPresetName, string> = { heavy: 'heavy', blade: 'blade', arrow: 'arrow', magic: 'magic', light: 'blade' };
function playImpact(name: ImpactPresetName): void {
  placeCamera();
  camera.updateMatrixWorld();
  ImpactSequencer.screenFocus(CHEST, camera, impactFocus);
  fx.hit(CHEST, Math.PI / 2, IMPACT_HIT[name] as never, { heavy: name === 'heavy' });
  psx.impact.play(name, { focus: impactFocus });
}
for (const name of Object.keys(IMPACT_PRESETS) as ImpactPresetName[]) EFFECTS[`impact-${name}`] = () => playImpact(name);
for (const sample of CRITICAL_SAMPLES) EFFECTS[`crit-${sample.name}`] = () => void playCritical(sample.name);
EFFECTS['crit-break'] = () => {
  bossStandIn.visible = true;
  critView = true;
  critFx.bossBreak(BOSS_FEET, BOSS_HEIGHT);
  critFx.weakPoint.show(() => BOSS_HEAD);
};
EFFECTS['crit-done'] = leaveCritical;

function shake(glitch: number, heavy: boolean, kill: boolean): void {
  psx.vhs.glitch(glitch);
  psx.vhs.echo(glitch);
  psx.vhs.impact(kill ? 1 : heavy ? 0.6 : 0.3);
  camFx.yourHit(Math.PI / 2, { heavy, kill });
}

let cameraAngle = 0;
function placeCamera(): void {
  if (critView) {
    camera.position.set(3.2 + Math.sin(cameraAngle) * 9.5, 2.3, Math.cos(cameraAngle) * 9.5);
    camera.lookAt(3.2, 1.5, 0);
    return;
  }
  camera.position.set(0.5 + Math.sin(cameraAngle) * 3.7, 1.75, Math.cos(cameraAngle) * 3.7);
  camera.lookAt(0.5, 0.95, 0);
}

/** One frame of game time. Returns nothing: the picture is on the canvas until the next one. */
function step(seconds: number): void {
  // The lab has no hitstop, so its frame time is the real time impact frames want.
  psx.impact.update(seconds);
  placeCamera();
  critFx.steerCamera(camera);
  const scale = camFx.apply(camera, seconds);
  // A critical slows the world, but the attacker keeps real time: its own slow parts are in its animation.
  const world = critFx.wantedTimeScale();
  const scaled = seconds * camFx.fxTimeScale * world;
  clock += scaled;
  model?.update(seconds * scale * world);
  if (critModel) {
    critModel.update(seconds);
    critModel.root.position.copy(critModel.criticalRootOffset(critOffset));
  }
  critFx.update(seconds, scaled);
  fx.update(scaled);
  if (runLeft > 0 && model) {
    runLeft -= scaled;
    const speed = runRoll ? 6.5 : 5;
    model.root.position.x += speed * scaled;
    footTrail.update(scaled, model.root.position, runRoll ? 'roll' : 'run');
    if (runLeft <= 0) {
      footTrail.update(scaled, model.root.position, 'still');
      model.play('idle');
      model.root.position.x = 0;
    }
  }
  if (trailLeft > 0) {
    trailLeft = Math.max(0, trailLeft - scaled);
    placeBlade(1 - trailLeft / trailTotal);
    fx.pushTrail(trailId, tip, base);
    if (trailLeft === 0) fx.endTrail(trailId);
  }
  for (let i = pendingEnds.length - 1; i >= 0; i -= 1) {
    const end = pendingEnds[i];
    if (end.at <= clock) {
      fx.endProjectile(end.id, { x: end.endX, y: 1.25, z: 0 }, end.hit, end.style as never);
      pendingEnds.splice(i, 1);
    }
  }
  psx.render(scene, camera, seconds);
}

/** Times a frame with a steady load of living particles, for the cost report. */
function stress(targetAlive: number, frames: number): Record<string, number> {
  const pool = (fx as unknown as { pool: ParticlePool }).pool;
  const lifeSeconds = 1;
  const dt = 1 / 60;
  const perFrame = Math.round((targetAlive / lifeSeconds) * dt);
  const gl = psx.renderer.getContext();
  const pixel = new Uint8Array(4);
  let elapsedFx = 0;
  let elapsedRender = 0;
  let measured = 0;
  for (let i = 0; i < frames; i += 1) {
    const fxStart = performance.now();
    const s = pool.reset();
    for (let n = 0; n < perFrame; n += 1) {
      s.x = Math.random() * 6 - 3; s.y = Math.random() * 2; s.z = Math.random() * 3 - 1.5;
      s.vy = 0.3;
      s.size = s.endSize = 0.25;
      s.life = lifeSeconds;
      pool.emit();
    }
    fx.update(dt);
    const fxEnd = performance.now();
    placeCamera();
    psx.render(scene, camera, dt);
    // Reading one pixel makes the frame finish, so this measures drawing and not just queuing it.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const renderEnd = performance.now();
    // Only once the pool has filled up to the target.
    if (i >= 60) {
      measured += 1;
      elapsedFx += fxEnd - fxStart;
      elapsedRender += renderEnd - fxEnd;
    }
  }
  return { alive: fx.stats().alive, fxMsPerFrame: elapsedFx / Math.max(1, measured), renderMsPerFrame: elapsedRender / Math.max(1, measured) };
}

declare global {
  interface Window {
    fxlab: unknown;
  }
}

window.fxlab = {
  EFFECTS,
  fx,
  camFx,
  psx,
  sound,
  camera,
  ready: () => model !== null,
  fire: (name: string) => EFFECTS[name](),
  step,
  /** Takes the canvas picture now, while the frame just drawn is still in the buffer. */
  grab: () => canvas.toDataURL('image/png'),
  setCameraAngle: (angle: number) => { cameraAngle = angle; },
  stress,
  playImpact,
  /** Loads a critical's character ahead of time, so a script's first frame is the first frame. */
  prepareCritical: (name: string) => critCharacter(name).then(() => true),
  playCritical,
  leaveCritical,
  critFx,
  criticalPhase: () => critModel?.criticalPhase() ?? -1,
  /** Compiles the critical effects' shaders now, as the game does while the arena loads. */
  prewarm: () => {
    const start = performance.now();
    critFx.prewarm(psx.renderer);
    return performance.now() - start;
  },
  /** How many shader programs the renderer has built so far, to check that prewarm left nothing for later. */
  programs: () => psx.renderer.info.programs?.length ?? 0,
  /** Debug: where the impact sequencer is, for the contact-sheet script. */
  impactActive: () => psx.impact.active,
};

const bar = document.getElementById('bar')!;
for (const name of Object.keys(EFFECTS)) {
  const button = document.createElement('button');
  button.textContent = name;
  button.addEventListener('click', () => EFFECTS[name]());
  bar.append(button);
}

// Live preview when a person is looking, off when the screenshot scripts drive step() themselves.
if (!new URLSearchParams(location.search).has('manual')) {
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const seconds = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(seconds);
  };
  requestAnimationFrame(frame);
}
