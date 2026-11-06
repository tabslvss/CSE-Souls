import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CORPSE_SECONDS, CREATURES, CreatureState, type CreatureKind } from '../../../shared/creatures';
import type { CreatureSnapshot } from '../../../shared/protocol';
import { sound, type GameSfxName } from '../sound';
import type { GameFx } from './fx/effects';
import type { LockSource, LockTarget } from './lockOn';
import { applyVertexSnap, makeTextureCrunchy } from './psxRenderer';

/*
 * Draws the animals the server tells us about. Nothing here decides anything: positions, states and
 * health all come from snapshots, and the browser only blends between them and dresses them up.
 */

const INTERPOLATION_DELAY_MS = 110;
const MAX_FRAMES_KEPT = 8;
/** A jump this long is a respawn, not movement, so it isn't blended. */
const TELEPORT_METERS = 8;
/** Missing from snapshots this long means out of view or removed. */
const MISSING_MS = 500;
const FADE_SECONDS = 0.16;
const DISSOLVE_SECONDS = 1.7;
/** Lying still for this long, then burning away, all before the server removes the corpse. */
const CORPSE_REST_SECONDS = CORPSE_SECONDS - DISSOLVE_SECONDS - 0.5;
const BAR_SHOW_MS = 5000;
const NUMBER_ADD_UP_MS = 1400;
const FAR_METERS = 34;
const BAR_MAX_METERS = 32;
const FLASH_DECAY = 11;
const DUST_RUN_SECONDS = 0.2;
const DUST_MAX_METERS = 30;
const CALL_MIN_SECONDS = 14;
const CALL_MAX_METERS = 26;
const STRIKE_SECONDS = 0.3;

interface BodySpec {
  scale: number;
  /** Where blood and sparks come out. */
  chest: number;
  /** Where the health bar sits. */
  barHeight: number;
  attack: string;
  /** Brightens the fur. A wolf this dark would vanish into the forest, and you need to see what's biting you. */
  lift?: number;
  /** Plays now and then in place of standing still. */
  rest?: string;
  windupSound?: GameSfxName;
  strikeSound?: GameSfxName;
  hurtSound?: GameSfxName;
  deathSound: GameSfxName;
  callSound?: GameSfxName;
}

// Scales and clip names were measured from the model files, with tools/build-animals.mjs.
const BODIES: Record<string, BodySpec> = {
  wolf: {
    scale: 0.3753, chest: 0.62, barHeight: 1.25, attack: 'Attack', rest: 'Idle_2_HeadLow', lift: 1.9,
    windupSound: 'wolf-growl', strikeSound: 'wolf-attack', hurtSound: 'wolf-yelp', deathSound: 'wolf-death',
  },
  deer: { scale: 0.3174, chest: 0.78, barHeight: 1.55, attack: 'Attack_Headbutt', rest: 'Eating', deathSound: 'deer-death', callSound: 'deer-call' },
  stag: { scale: 0.3951, chest: 1.0, barHeight: 2.2, attack: 'Attack_Headbutt', rest: 'Eating', deathSound: 'deer-death', callSound: 'deer-call' },
  fox: { scale: 0.1745, chest: 0.3, barHeight: 0.72, attack: 'Attack', deathSound: 'deer-death' },
  bull: {
    scale: 0.331, chest: 1.05, barHeight: 1.9, attack: 'Attack_Headbutt', lift: 1.5,
    windupSound: 'wolf-growl', strikeSound: 'swing-heavy', hurtSound: 'hit-heavy', deathSound: 'kill-thud',
  },
};

const FALLBACK_BODY = BODIES.deer;

const loader = new GLTFLoader();
const files = new Map<string, Promise<{ scene: THREE.Group; clips: Map<string, THREE.AnimationClip> }>>();

function loadBody(id: string) {
  let file = files.get(id);
  if (!file) {
    file = loader.loadAsync(`/models/animals/${id}.glb`).then((gltf) => {
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of list) {
          const map = (material as THREE.MeshStandardMaterial).map;
          if (map) makeTextureCrunchy(map);
        }
      });
      return { scene: gltf.scene, clips: new Map(gltf.animations.map((clip) => [clip.name, clip])) };
    });
    // A failed download can be tried again by the next animal of that kind.
    file.catch(() => files.delete(id));
    files.set(id, file);
  }
  return file;
}

interface Frame {
  time: number;
  x: number;
  z: number;
  yaw: number;
  state: number;
  health: number;
}

interface HealthBar {
  root: HTMLDivElement;
  fill: HTMLElement;
  chip: HTMLElement;
  number: HTMLElement;
  /** Last share written to the page, so it isn't touched every frame. */
  shown: number;
}

interface Body {
  id: number;
  kind: CreatureKind;
  spec: BodySpec;
  root: THREE.Group;
  frames: Frame[];
  lastSeen: number;
  x: number;
  z: number;
  yaw: number;
  state: number;
  health: number;
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  clips: Map<string, THREE.AnimationClip> | null;
  materials: THREE.MeshLambertMaterial[];
  action: THREE.AnimationAction | null;
  clipName: string;
  far: number;
  flash: number;
  /** Knocked back by the last blow: world meters, settling to nothing. */
  recoilX: number;
  recoilZ: number;
  /** Forward lean and lunge for bites, which the clips alone undersell. */
  lunge: number;
  dead: boolean;
  deadFor: number;
  burning: boolean;
  burned: boolean;
  dustWait: number;
  restLeft: number;
  callWait: number;
  bar: HealthBar | null;
  barUntil: number;
  added: number;
  addedAt: number;
}

const projected = new THREE.Vector3();

/** Goes by the newest snapshot, as the drawn body runs a moment behind it. */
function isAlive(body: Body): boolean {
  return !body.dead && body.frames[body.frames.length - 1]?.state !== CreatureState.Dead;
}

export class CreatureField implements LockSource {
  private readonly bodies = new Map<number, Body>();
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly fx: GameFx,
    private readonly camera: THREE.Camera,
    private readonly canvas: HTMLCanvasElement,
    private readonly layer: HTMLElement,
  ) {}

  /** A new snapshot. Bodies that stop being mentioned are cleaned up in update. */
  applySnapshot(list: CreatureSnapshot[]): void {
    const now = performance.now();
    for (const [id, kindIndex, x, z, yaw, state, health] of list) {
      const kind = CREATURES[kindIndex];
      if (!kind) continue;
      let body = this.bodies.get(id);
      if (!body) {
        body = this.createBody(id, kind, x, z, yaw, state, health);
        this.bodies.set(id, body);
      }
      const previous = body.frames[body.frames.length - 1];
      // It has come back to life at its camp: same id, new animal.
      if (body.dead && state !== CreatureState.Dead) this.revive(body);
      if (previous && Math.hypot(previous.x - x, previous.z - z) > TELEPORT_METERS) body.frames.length = 0;
      body.frames.push({ time: now, x, z, yaw, state, health });
      if (body.frames.length > MAX_FRAMES_KEPT) body.frames.shift();
      body.lastSeen = now;
    }
  }

  /** Where to aim effects on this creature, right now. */
  chestOf(id: number): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(id);
    return body ? { x: body.x, y: body.spec.chest, z: body.z } : null;
  }

  livingTargets(): LockTarget[] {
    const list: LockTarget[] = [];
    for (const body of this.bodies.values()) {
      if (isAlive(body)) list.push({ id: body.id, x: body.x, y: body.spec.chest, z: body.z });
    }
    return list;
  }

  copyLivingChest(id: number, out: THREE.Vector3): boolean {
    const body = this.bodies.get(id);
    if (!body || !isAlive(body)) return false;
    out.set(body.x, body.spec.chest, body.z);
    return true;
  }

  kindOf(id: number): CreatureKind | null {
    return this.bodies.get(id)?.kind ?? null;
  }

  yawOf(id: number): number | null {
    return this.bodies.get(id)?.yaw ?? null;
  }

  chestHeight(id: number): number {
    return this.bodies.get(id)?.spec.chest ?? 0.8;
  }

  /** A blow landed. The body flinches, flashes and, for your own hits, adds to its damage number. */
  onHit(id: number, damage: number, dirYaw: number, mine: boolean, kill: boolean): void {
    const body = this.bodies.get(id);
    if (!body) return;
    const push = kill ? 0.5 : 0.22;
    body.recoilX += Math.sin(dirYaw) * push;
    body.recoilZ += Math.cos(dirYaw) * push;
    body.flash = 1;
    if (body.spec.hurtSound && !kill) sound.playGame(body.spec.hurtSound, { x: body.x, z: body.z, volume: 0.7 });
    const now = performance.now();
    this.showBar(body);
    body.barUntil = now + BAR_SHOW_MS;
    if (mine) {
      if (now - body.addedAt > NUMBER_ADD_UP_MS) body.added = 0;
      body.added += damage;
      body.addedAt = now;
      // Only ever a number from the server, and textContent keeps it from being read as HTML anyway.
      if (body.bar) {
        body.bar.number.textContent = String(body.added);
        body.bar.number.style.opacity = '1';
      }
    }
    if (kill) this.die(body);
  }

  /** Call once a frame. animSeconds stops during hitstop, realSeconds doesn't. */
  update(realSeconds: number, animSeconds: number): void {
    const now = performance.now();
    const renderTime = now - INTERPOLATION_DELAY_MS;
    const cameraX = this.camera.position.x;
    const cameraZ = this.camera.position.z;
    for (const body of this.bodies.values()) {
      if (now - body.lastSeen > MISSING_MS) {
        // A corpse that started burning gets to finish. Anything else is just out of view.
        if (!body.burning || body.burned) {
          this.remove(body);
          continue;
        }
      }
      this.interpolate(body, renderTime, realSeconds);
      const distance = Math.hypot(body.x - cameraX, body.z - cameraZ);
      this.animate(body, realSeconds, animSeconds, distance);
      this.drawBar(body, now, distance);
    }
  }

  private createBody(id: number, kind: CreatureKind, x: number, z: number, yaw: number, state: number, health: number): Body {
    const spec = BODIES[kind.id] ?? FALLBACK_BODY;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    this.scene.add(root);
    const body: Body = {
      id, kind, spec, root,
      frames: [],
      lastSeen: performance.now(),
      x, z, yaw, state, health,
      model: null, mixer: null, clips: null, materials: [], action: null, clipName: '',
      far: 0, flash: 0, recoilX: 0, recoilZ: 0, lunge: 0,
      dead: state === CreatureState.Dead, deadFor: state === CreatureState.Dead ? CORPSE_REST_SECONDS : 0,
      burning: false, burned: false,
      dustWait: 0, restLeft: 0,
      callWait: CALL_MIN_SECONDS * (1 + Math.random() * 3),
      bar: null, barUntil: 0, added: 0, addedAt: 0,
    };
    void this.loadModel(body);
    return body;
  }

  private async loadModel(body: Body, attempt = 0): Promise<void> {
    let file;
    try {
      file = await loadBody(body.kind.id);
    } catch {
      if (attempt < 2 && !this.disposed && this.bodies.get(body.id) === body) await this.loadModel(body, attempt + 1);
      return;
    }
    if (this.disposed || this.bodies.get(body.id) !== body) return;
    const model = cloneSkinned(file.scene);
    model.scale.setScalar(body.spec.scale);
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const convert = (source: THREE.Material) => {
        const standard = source as THREE.MeshStandardMaterial;
        // Lambert like the characters, so they catch the same flat PS1 light. A copy per animal, for its own hit flash.
        const material = new THREE.MeshLambertMaterial({ map: standard.map, color: standard.color.clone().multiplyScalar(body.spec.lift ?? 1) });
        applyVertexSnap(material);
        body.materials.push(material);
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    });
    body.root.add(model);
    body.model = model;
    body.mixer = new THREE.AnimationMixer(model);
    body.clips = file.clips;
    // A random start, so a herd doesn't breathe in step.
    body.mixer.update(Math.random() * 3);
    if (body.dead) this.playClip(body, 'Death', { once: true, jumpToEnd: true });
  }

  private interpolate(body: Body, renderTime: number, seconds: number): void {
    const { frames } = body;
    if (frames.length === 0) return;
    let x = frames[frames.length - 1].x;
    let z = frames[frames.length - 1].z;
    let yaw = frames[frames.length - 1].yaw;
    let current = frames[frames.length - 1];
    for (let i = frames.length - 1; i > 0; i -= 1) {
      const a = frames[i - 1];
      const b = frames[i];
      if (a.time <= renderTime && renderTime <= b.time) {
        const t = (renderTime - a.time) / Math.max(1, b.time - a.time);
        x = a.x + (b.x - a.x) * t;
        z = a.z + (b.z - a.z) * t;
        yaw = b.yaw;
        current = b;
        break;
      }
    }
    if (renderTime < frames[0].time) {
      x = frames[0].x;
      z = frames[0].z;
      yaw = frames[0].yaw;
      current = frames[0];
    }
    body.x = x;
    body.z = z;
    const delta = Math.atan2(Math.sin(yaw - body.yaw), Math.cos(yaw - body.yaw));
    body.yaw += delta * Math.min(1, seconds * 10);
    body.health = current.health;
    if (current.state !== body.state) this.changeState(body, current.state);
  }

  private changeState(body: Body, state: number): void {
    const { spec, x, z } = body;
    body.state = state;
    if (state === CreatureState.Windup && spec.windupSound) sound.playGame(spec.windupSound, { x, z });
    else if (state === CreatureState.Strike && spec.strikeSound) sound.playGame(spec.strikeSound, { x, z });
    else if (state === CreatureState.Dead) this.die(body);
    // The windup left the clip drawn back, so the bite carries on from there, fast.
    if (state === CreatureState.Strike && body.action && body.clipName === spec.attack) {
      body.action.timeScale = body.action.getClip().duration / STRIKE_SECONDS;
    }
  }

  private die(body: Body): void {
    if (body.dead) return;
    body.dead = true;
    body.deadFor = 0;
    sound.playGame(body.spec.deathSound, { x: body.x, z: body.z });
    this.playClip(body, 'Death', { once: true });
  }

  private revive(body: Body): void {
    body.dead = false;
    body.deadFor = 0;
    body.burning = false;
    body.burned = false;
    body.flash = 0;
    body.frames.length = 0;
    this.fx.undissolve(body.root);
    body.root.visible = true;
    body.clipName = '';
    body.added = 0;
    body.barUntil = 0;
    if (body.bar) body.bar.root.style.display = 'none';
  }

  private wantedClip(body: Body): { name: string; once?: boolean; seconds?: number } {
    const { kind, spec } = body;
    switch (body.state) {
      case CreatureState.Walk:
        return { name: 'Walk' };
      case CreatureState.Run:
        return { name: 'Gallop' };
      case CreatureState.Windup:
        // Held in the first part of the clip, drawn back, until the bite comes.
        return { name: spec.attack, once: true, seconds: kind.windup * 2.2 };
      case CreatureState.Strike:
        return { name: spec.attack, once: true, seconds: STRIKE_SECONDS };
      case CreatureState.Stagger:
        return { name: 'Idle_HitReact1', once: true, seconds: 0.45 };
      case CreatureState.Dead:
        return { name: 'Death', once: true };
      default:
        return { name: body.restLeft > 0 && spec.rest ? spec.rest : 'Idle' };
    }
  }

  private playClip(body: Body, name: string, options: { once?: boolean; seconds?: number; jumpToEnd?: boolean } = {}): void {
    if (!body.mixer || !body.clips) return;
    const clip = body.clips.get(name);
    if (!clip) return;
    const next = body.mixer.clipAction(clip);
    if (next !== body.action) {
      body.action?.fadeOut(FADE_SECONDS);
      next.reset().fadeIn(body.action ? FADE_SECONDS : 0).play();
    } else {
      next.reset().play();
    }
    next.setLoop(options.once ? THREE.LoopOnce : THREE.LoopRepeat, options.once ? 1 : Infinity);
    next.clampWhenFinished = !!options.once;
    next.timeScale = options.seconds ? clip.duration / options.seconds : 1;
    if (options.jumpToEnd) next.time = clip.duration;
    body.action = next;
    body.clipName = name;
  }

  private animate(body: Body, realSeconds: number, animSeconds: number, distance: number): void {
    const { spec, state } = body;
    if (body.dead) {
      body.deadFor += realSeconds;
      if (!body.burning && body.deadFor >= CORPSE_REST_SECONDS) {
        body.burning = true;
        this.fx.deathMist({ x: body.x, y: 0, z: body.z });
        this.fx.dissolve(body.root, DISSOLVE_SECONDS, () => {
          body.burned = true;
        });
      }
    } else {
      // Now and then a deer drops its head to graze, instead of all of them standing like statues.
      if (state === CreatureState.Idle) {
        body.restLeft -= realSeconds;
        if (spec.rest && body.restLeft < -6 && Math.random() < realSeconds * 0.12) body.restLeft = 4 + Math.random() * 5;
      } else {
        body.restLeft = 0;
      }
      const wanted = this.wantedClip(body);
      if (wanted.name !== body.clipName) this.playClip(body, wanted.name, wanted);
      this.feet(body, realSeconds, distance);
      this.call(body, realSeconds, distance);
    }

    if (body.mixer) {
      // Far away the animation runs at a third of the rate, which nobody can see through the fog.
      body.far += animSeconds;
      if (distance < FAR_METERS || body.far > 0.05) {
        body.mixer.update(body.far);
        body.far = 0;
      }
    }

    const lungeTarget = state === CreatureState.Windup ? -1 : state === CreatureState.Strike ? 1 : 0;
    body.lunge += (lungeTarget - body.lunge) * Math.min(1, animSeconds * (state === CreatureState.Strike ? 22 : 7));
    const settle = Math.exp(-realSeconds * 9);
    body.recoilX *= settle;
    body.recoilZ *= settle;
    const reach = body.lunge * (body.lunge > 0 ? 0.55 : 0.16) * Math.max(0.6, spec.chest);
    body.root.position.set(
      body.x + body.recoilX + Math.sin(body.yaw) * reach,
      0,
      body.z + body.recoilZ + Math.cos(body.yaw) * reach,
    );
    body.root.rotation.y = body.yaw;
    if (body.model) body.model.rotation.x = body.lunge * 0.12;

    if (body.flash > 0.004) {
      body.flash *= Math.exp(-realSeconds * FLASH_DECAY);
      this.writeFlash(body, body.flash);
    } else if (body.flash > 0) {
      body.flash = 0;
      this.writeFlash(body, 0);
    }
  }

  private writeFlash(body: Body, amount: number): void {
    for (const material of body.materials) {
      material.emissive.setRGB(1, 0.86, 0.72);
      material.emissiveIntensity = amount * 0.85;
    }
  }

  /** Kicked-up dust when they bolt. No footsteps, because a fleeing herd would drown out everything. */
  private feet(body: Body, seconds: number, distance: number): void {
    if (body.state !== CreatureState.Run || distance > DUST_MAX_METERS) return;
    body.dustWait -= seconds;
    if (body.dustWait > 0) return;
    body.dustWait = DUST_RUN_SECONDS;
    this.fx.footDust({ x: body.x, y: 0, z: body.z }, 'run');
  }

  private call(body: Body, seconds: number, distance: number): void {
    if (!body.spec.callSound) return;
    body.callWait -= seconds;
    if (body.callWait > 0) return;
    body.callWait = CALL_MIN_SECONDS * (1 + Math.random() * 3);
    if (distance < CALL_MAX_METERS) sound.playGame(body.spec.callSound, { x: body.x, z: body.z, volume: 0.6 });
  }

  private showBar(body: Body): void {
    if (body.bar) {
      body.bar.root.style.display = '';
      return;
    }
    const root = document.createElement('div');
    root.className = 'foe-bar';
    const number = document.createElement('span');
    number.className = 'foe-bar__number';
    const track = document.createElement('div');
    track.className = 'foe-bar__track';
    const chip = document.createElement('i');
    chip.className = 'foe-bar__chip';
    const fill = document.createElement('i');
    fill.className = 'foe-bar__fill';
    track.append(chip, fill);
    root.append(number, track);
    this.layer.append(root);
    body.bar = { root, fill, chip, number, shown: -1 };
  }

  private drawBar(body: Body, now: number, distance: number): void {
    const { bar } = body;
    if (!bar) return;
    const visible = now < body.barUntil && distance < BAR_MAX_METERS && !body.burning;
    projected.set(body.x, body.spec.barHeight, body.z).project(this.camera);
    if (!visible || projected.z >= 1) {
      bar.root.style.display = 'none';
      return;
    }
    bar.root.style.display = '';
    const left = (projected.x * 0.5 + 0.5) * this.canvas.clientWidth;
    const top = (-projected.y * 0.5 + 0.5) * this.canvas.clientHeight;
    bar.root.style.transform = `translate(-50%, -100%) translate(${left | 0}px, ${top | 0}px)`;
    const share = body.dead ? 0 : body.health;
    if (share !== bar.shown) {
      bar.shown = share;
      bar.fill.style.width = `${share}%`;
      bar.chip.style.width = `${share}%`;
    }
    if (now - body.addedAt > NUMBER_ADD_UP_MS + 800) bar.number.style.opacity = '0';
  }

  private remove(body: Body): void {
    this.bodies.delete(body.id);
    this.fx.undissolve(body.root);
    this.scene.remove(body.root);
    body.bar?.root.remove();
    this.release(body);
  }

  private release(body: Body): void {
    body.mixer?.stopAllAction();
    if (body.model) {
      body.mixer?.uncacheRoot(body.model);
      body.model.traverse((object) => {
        const skinned = object as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      });
    }
    for (const material of body.materials) material.dispose();
    body.materials.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    for (const body of [...this.bodies.values()]) this.remove(body);
    // The shared files hold textures on the GPU, and the next game loads them again.
    for (const file of files.values()) {
      void file.then(({ scene }) => {
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of list) {
            (material as THREE.MeshStandardMaterial).map?.dispose();
            material.dispose();
          }
        });
      }, () => undefined);
    }
    files.clear();
  }
}
