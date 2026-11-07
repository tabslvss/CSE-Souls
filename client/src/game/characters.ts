import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Appearance, ClassId, Stats } from '../../../shared/classes';
import { weaponFor } from '../../../shared/combat';
import { DODGE_SECONDS, DRINK_SECONDS, JUMP_SECONDS, STAGGER_SECONDS, deriveStats, type AnimationId } from '../../../shared/sim';
import { ARMORY } from './armory';
import { applyVertexSnap, makeTextureCrunchy } from './psxRenderer';
import { createWeaponRig } from './weaponRig';

/*
 * Characters are normally proportioned human models by Quaternius (CC0). Each kit file holds
 * a body and every clothing part on one shared skeleton, so a character is just a choice of
 * which parts to show. The animation files use that same skeleton.
 */

const FADE_SECONDS = 0.16;
const ATLAS_SIZE = 256;
const WEAPON_GLOW = 0.45;
/** Attacks without a clip of their own stand still in the first frame of this one. */
const NEUTRAL_BODY = 'neutral';
const NEUTRAL_CLIP = 'Idle_Loop';
/** Steps during a drink are slower, to match the slower walk in shared/sim.ts. */
const DRINK_WALK_RATE = 0.55;
/** A jump is three clips: the push off, the time in the air, and the last moment before touching down. */
const JUMP_START_SECONDS = 0.14;
const JUMP_LAND_SECONDS = 0.18;
const JUMP_FADE_SECONDS = 0.07;

const SKIN_TINTS = ['#ffffff', '#f6dcc8', '#dcb494', '#a8805e', '#6f4f38', '#b4c0b0'];
const HAIR_TINTS = ['#3a2a1c', '#14110f', '#6b4524', '#a07a44', '#8c8c8c', '#6e2a1e'];
const CLOTH_TINTS = ['#ffffff', '#a8a297', '#5e5b60', '#b09a6e', '#a84444', '#6c5e94', '#567099', '#648a6c'];
const ARMOR_TINTS = ['#ffffff', '#b0aba3', '#66636a', '#e3c07a', '#a67c4e', '#a84444', '#648a6c', '#567099'];

type HairStyle = { label: string; male: string | null; female: string | null };

const HAIR_STYLES: HairStyle[] = [
  { label: 'Bald', male: null, female: null },
  { label: 'Short', male: 'Hair_SimpleParted', female: 'Hair_Buns' },
  { label: 'Buzzed', male: 'Hair_Buzzed', female: 'Hair_BuzzedFemale' },
  { label: 'Long', male: 'Hair_Long', female: 'Hair_Long' },
];

interface ClassVisual {
  headgearLabel: string;
  /** Part names, using {G} for Male or Female. */
  parts: string[];
  /** Part names to use for a female body instead, where they differ. */
  femaleParts?: string[];
  /** A bare muscular torso and arms instead of a separate head, on male bodies. */
  bareTorso?: boolean;
  headgearDefault: boolean;
}

const RANGER_FEET = { Male: 'Male_Ranger_Feet_Boots', Female: 'Female_Ranger_Feet' };
const PAULDRONS = { Male: 'Male_Ranger_Acc_Pauldron', Female: 'Female_Ranger_Acc_Pauldrons' };

const VISUALS: Record<ClassId, ClassVisual> = {
  juggernaut: {
    headgearLabel: 'Hood',
    headgearDefault: false,
    bareTorso: true,
    // The belt covers the gap between the bare torso's hem and the top of the trousers.
    parts: ['{G}_Peasant_Legs', 'BOOTS', '{G}_Ranger_Body_Belt_1', '{G}_Ranger_Arms_Bracer'],
    femaleParts: ['{G}_Peasant_Body', '{G}_Peasant_Arms', '{G}_Peasant_Legs', 'BOOTS', '{G}_Ranger_Body_Belt_1', '{G}_Ranger_Arms_Bracer'],
  },
  duelist: {
    headgearLabel: 'Hood',
    headgearDefault: false,
    parts: ['{G}_Peasant_Body', '{G}_Peasant_Arms', '{G}_Ranger_Legs', 'BOOTS', '{G}_Ranger_Body_Belt_1', '{G}_Ranger_Arms_Bracer'],
  },
  arcanist: {
    headgearLabel: 'Hood',
    headgearDefault: true,
    parts: ['{G}_Peasant_Body', '{G}_Peasant_Arms', '{G}_Peasant_Legs', '{G}_Peasant_Feet', '{G}_Ranger_Body_Belt_1'],
  },
  ranger: {
    headgearLabel: 'Hood',
    headgearDefault: true,
    parts: ['{G}_Ranger_Body', '{G}_Ranger_Arms', '{G}_Ranger_Legs', 'BOOTS', '{G}_Ranger_Body_Belt_1', '{G}_Ranger_Body_Belt_2', '{G}_Ranger_Arms_Bracer'],
  },
};

/**
 * How long a character can stand between attacks and still carry on with the same combo. Each attack
 * starts from where the last one ended, so this has to run out about when the feet are back home.
 */
const COMBO_PAUSE_SECONDS = 0.25;

export const CLASS_PICTURE_ICON: Record<ClassId, string> = {
  juggernaut: 'battle-axe',
  duelist: 'katana',
  arcanist: 'wizard-staff',
  ranger: 'bow-arrow',
};

export interface AppearanceOption {
  key: keyof Appearance;
  label: string;
  isColor: boolean;
  choices: string[];
}

/** The choices shown on the customization screen for this class. */
export function appearanceOptions(classId: ClassId, appearance: Appearance): AppearanceOption[] {
  const visual = VISUALS[classId];
  const options: AppearanceOption[] = [
    { key: 'variant', label: 'Starting weapon', isColor: false, choices: ARMORY[classId].map((weapon) => weapon.label) },
    { key: 'body', label: 'Body', isColor: false, choices: ['Male', 'Female'] },
    { key: 'skin', label: 'Skin tone', isColor: true, choices: SKIN_TINTS },
    { key: 'hair', label: 'Hair', isColor: false, choices: HAIR_STYLES.map((style) => style.label) },
    { key: 'hairColor', label: 'Hair color', isColor: true, choices: HAIR_TINTS },
  ];
  if (appearance.body === 0) options.push({ key: 'beard', label: 'Beard', isColor: false, choices: ['None', 'Beard'] });
  options.push(
    { key: 'cloth', label: 'Clothing color', isColor: true, choices: CLOTH_TINTS },
    { key: 'armor', label: 'Leather and armor color', isColor: true, choices: ARMOR_TINTS },
    { key: 'headgear', label: visual.headgearLabel, isColor: false, choices: ['Off', 'On'] },
    { key: 'shoulders', label: 'Shoulder armor', isColor: false, choices: ['Off', 'On'] },
  );
  return options;
}

/** A sensible look for a class when it's first picked. */
export function classDefaults(classId: ClassId): Partial<Appearance> {
  return { headgear: VISUALS[classId].headgearDefault ? 1 : 0, variant: 0 };
}

const loader = new GLTFLoader();
const files = new Map<string, Promise<GLTF>>();
const loadedFiles: GLTF[] = [];

function loadFile(name: string): Promise<GLTF> {
  let file = files.get(name);
  if (!file) {
    file = loader.loadAsync(`/models/${name}`).then(
      (gltf) => {
        loadedFiles.push(gltf);
        return gltf;
      },
      (err: unknown) => {
        // Forget failures, so that the next attempt downloads it again.
        files.delete(name);
        throw err;
      },
    );
    files.set(name, file);
  }
  return file;
}

let clipsPromise: Promise<Map<string, THREE.AnimationClip>> | null = null;

function loadClips(): Promise<Map<string, THREE.AnimationClip>> {
  clipsPromise ??= Promise.all([loadFile('anim-1.glb'), loadFile('anim-2.glb')]).then(
    ([first, second]) => new Map([...first.animations, ...second.animations].map((clip) => [clip.name, clip])),
    (err: unknown) => {
      clipsPromise = null;
      throw err;
    },
  );
  return clipsPromise;
}

const gradedTextures = new Map<string, THREE.Texture>();

/**
 * Shrinks a texture with hard pixel edges for the PS1 look, and pulls clothing toward grimy,
 * muted colors so the game reads as dark fantasy. Skin and hair stay closer to the original.
 */
function gradeTexture(source: THREE.Texture, grime: number): THREE.Texture {
  const key = `${source.uuid}:${grime}`;
  const existing = gradedTextures.get(key);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source.image as CanvasImageSource, 0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const image = ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const { data } = image;
  const keep = 1 - grime * 0.72;
  const brightness = 1 - grime * 0.08;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
    data[i] = (data[i] * keep + luminance * (1 - keep)) * brightness;
    data[i + 1] = (data[i + 1] * keep + luminance * (1 - keep)) * brightness * 0.98;
    data[i + 2] = (data[i + 2] * keep + luminance * (1 - keep)) * brightness * 0.92;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  // glTF textures are stored top-left first, unlike the Three.js default.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  makeTextureCrunchy(texture);
  gradedTextures.set(key, texture);
  return texture;
}

/**
 * Frees the GPU copies of everything shared between characters. Call this before disposing a
 * renderer: each one holds a listener on these assets, which would keep it alive otherwise.
 * The next renderer simply uploads them again.
 */
export function releaseSharedAssets(): void {
  gradedTextures.forEach((texture) => texture.dispose());
  for (const gltf of loadedFiles) {
    gltf.scene.traverse((object) => {
      (object as THREE.Mesh).geometry?.dispose();
    });
  }
}

export interface CharacterModel {
  root: THREE.Group;
  /** Crossfades to an animation. restart replays a one-shot, like a second swing. */
  play: (animation: AnimationId, restart?: boolean) => void;
  update: (seconds: number) => void;
  /** During a drink only: whether the legs walk or stand. */
  setDrinkWalking: (walking: boolean) => void;
  /** Above 1 means a hand can't reach where the weapon wants it. Used to check new poses. */
  armStretch: () => number;
  /** The same for the legs, when a pose asks for a foot further away than the leg is long. */
  legStretch: () => number;
  /** The largest wrist roll being asked for, in radians. Well past 1.8, a forearm looks wrung out. */
  wristRoll: () => number;
  /** Writes the world position of the main weapon's far end, and optionally its near end. For slash trails. */
  weaponTip: (target: THREE.Vector3, base?: THREE.Vector3) => void;
  /** From 0 to 1 during an attack, and -1 otherwise. */
  attackPhase: () => number;
  /** The share of the attack at which attack number index lands its hit. */
  impactKeyAt: (index: number) => number;
  /** Makes the next attack this one in the weapon's list. They otherwise take turns. */
  setNextAttack: (index: number) => void;
  /** Seconds for the whole attack, after the character's Speed. */
  attackSeconds: number;
  dispose: () => void;
}

/**
 * The kit binds the shoulder plate to the upper arm alone, so when the arm hangs the plate swings off the
 * shoulder like a bowl beside the arm. Sharing it with the collarbone keeps it on the shoulder, and it only
 * tips part of the way with the arm. Clones share one geometry, so this only has to happen once per body.
 */
const SHOULDER_PLATE_ON_COLLARBONE = 0.6;
const seatedPlates = new WeakSet<THREE.BufferGeometry>();

function seatShoulderPlate(mesh: THREE.SkinnedMesh) {
  const { geometry, skeleton } = mesh;
  if (!skeleton || seatedPlates.has(geometry)) return;
  const collarbone = skeleton.bones.findIndex((bone) => bone.name === 'clavicle_l');
  const upperArm = skeleton.bones.findIndex((bone) => bone.name === 'upperarm_l');
  if (collarbone < 0 || upperArm < 0) return;
  const { skinIndex, skinWeight } = geometry.attributes;
  for (let i = 0; i < skinIndex.count; i += 1) {
    skinIndex.setXYZW(i, collarbone, upperArm, 0, 0);
    skinWeight.setXYZW(i, SHOULDER_PLATE_ON_COLLARBONE, 1 - SHOULDER_PLATE_ON_COLLARBONE, 0, 0);
  }
  skinIndex.needsUpdate = true;
  skinWeight.needsUpdate = true;
  seatedPlates.add(geometry);
}

export async function createCharacter(classId: ClassId, appearance: Appearance, stats?: Stats): Promise<CharacterModel> {
  const visual = VISUALS[classId];
  const setup = ARMORY[classId][appearance.variant] ?? ARMORY[classId][0];
  const weapon = weaponFor(classId, appearance.variant);
  const attackSeconds = stats ? deriveStats(stats, weapon).attackSeconds : weapon.attackSeconds;
  const gender = appearance.body === 1 ? 'Female' : 'Male';
  const [kit, clips, weapons] = await Promise.all([
    loadFile(gender === 'Male' ? 'kit-male.glb' : 'kit-female.glb'),
    loadClips(),
    loadFile('weapons.glb'),
  ]);

  const root = new THREE.Group();
  const model = cloneSkinned(kit.scene);
  root.add(model);

  const wearsHeadgear = appearance.headgear === 1;
  const partNames = gender === 'Female' && visual.femaleParts ? visual.femaleParts : visual.parts;
  const shown = new Set(
    partNames.map((part) => (part === 'BOOTS' ? RANGER_FEET[gender] : part.replace('{G}', gender))),
  );
  shown.add('Eyes');
  shown.add('Eyebrows');
  shown.add(visual.bareTorso && gender === 'Male' ? 'TorsoPart' : 'HeadPart');
  if (wearsHeadgear) shown.add(`${gender}_Ranger_Head_Hood`);
  if (appearance.shoulders === 1) shown.add(PAULDRONS[gender]);
  if (!wearsHeadgear) {
    const style = HAIR_STYLES[appearance.hair] ?? HAIR_STYLES[0];
    const hair = gender === 'Male' ? style.male : style.female;
    if (hair) shown.add(hair);
  }
  if (gender === 'Male' && appearance.beard === 1) shown.add('Hair_Beard');

  const materials: THREE.Material[] = [];
  const clothTint = CLOTH_TINTS[appearance.cloth] ?? CLOTH_TINTS[0];
  const armorTint = ARMOR_TINTS[appearance.armor] ?? ARMOR_TINTS[0];
  const skinTint = SKIN_TINTS[appearance.skin] ?? SKIN_TINTS[0];
  const hairTint = HAIR_TINTS[appearance.hairColor] ?? HAIR_TINTS[0];

  const dress = (mesh: THREE.Mesh, partName: string) => {
    const source = mesh.material as THREE.MeshStandardMaterial;
    const materialName = source.name;
    let tint = '#ffffff';
    let grime = 1;
    if (/Superhero/i.test(materialName)) {
      tint = skinTint;
      grime = 0.1;
    } else if (/Hair/.test(materialName)) {
      tint = hairTint;
      grime = 1;
    } else if (/Eyes/.test(materialName)) {
      grime = 0;
    } else if (/Regular/.test(materialName)) {
      // The free kit's hands only come in a dark tone, so they read as worn gloves.
      tint = armorTint;
      grime = 0.6;
    } else if (/Bracer|Belt|Pauldron|Feet|Boots/.test(partName)) {
      tint = armorTint;
    } else {
      tint = clothTint;
    }
    const material = new THREE.MeshLambertMaterial({
      map: source.map ? gradeTexture(source.map, grime) : null,
      color: new THREE.Color(tint),
    });
    applyVertexSnap(material);
    materials.push(material);
    mesh.material = material;
    mesh.frustumCulled = false;
  };

  for (const child of model.children) {
    // Parts are meshes, or groups of meshes when a part has two materials. The skeleton is neither.
    const isPart = (child as THREE.Mesh).isMesh || child.children.some((inner) => (inner as THREE.Mesh).isMesh);
    if (!isPart) continue;
    child.visible = shown.has(child.name);
    if (!child.visible) continue;
    child.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      dress(object as THREE.Mesh, child.name);
      if (/Pauldron/.test(child.name)) seatShoulderPlate(object as THREE.SkinnedMesh);
    });
  }

  const rig = createWeaponRig(
    model,
    setup,
    weapons,
    (mesh) => {
      const original = mesh.material as THREE.MeshStandardMaterial;
      const map = original.map ? gradeTexture(original.map, 0.1) : null;
      const material = new THREE.MeshLambertMaterial({
        map,
        color: original.map ? 0xffffff : original.color,
        // Lit a little from within, so a weapon still reads at low resolution in a dark world.
        emissive: original.map ? 0xffffff : original.color,
        emissiveMap: map,
        emissiveIntensity: WEAPON_GLOW,
      });
      applyVertexSnap(material);
      materials.push(material);
      mesh.material = material;
      mesh.frustumCulled = false;
    },
    (material) => materials.push(material),
    attackSeconds,
    DRINK_SECONDS,
  );

  const mixer = new THREE.AnimationMixer(model);
  const clipNames: Record<Exclude<AnimationId, 'attack'>, string> = {
    idle: setup.idleClip,
    walk: 'Walk_Loop',
    run: setup.runClip,
    dodge: 'Roll',
    hit: 'Hit_Chest',
    death: 'Death01',
    // The arms and head are posed by the rig, so the legs can go on standing or walking.
    drink: setup.idleClip,
    jump: 'Jump_Start',
    // Only the head and a little sway come from this: the rig places the body and limbs on the ground.
    rest: NEUTRAL_CLIP,
  };
  const oneShotSeconds: Partial<Record<AnimationId, number>> = {
    attack: attackSeconds,
    dodge: DODGE_SECONDS,
    hit: STAGGER_SECONDS,
    jump: JUMP_START_SECONDS,
  };

  /** Every clip gets two actions on the same tracks, so a one-shot can crossfade into itself. */
  const actions = new Map<string, THREE.AnimationAction[]>();
  const actionsFor = (name: string, seconds?: number): THREE.AnimationAction[] | null => {
    const existing = actions.get(name);
    if (existing) return existing;
    const clip = clips.get(name === NEUTRAL_BODY ? NEUTRAL_CLIP : name);
    if (!clip) return null;
    const made = [clip, new THREE.AnimationClip(`${name}#2`, clip.duration, clip.tracks)].map((source) => {
      const action = mixer.clipAction(source);
      if (seconds) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        // Keeps the animation exactly as long as the action lasts in the game rules.
        action.timeScale = clip.duration / seconds;
      } else if (name === setup.runClip && setup.runRate) {
        action.timeScale = setup.runRate;
      }
      return action;
    });
    actions.set(name, made);
    return made;
  };

  let current: THREE.AnimationAction | null = null;
  let currentId: AnimationId | null = null;
  let attackIndex = 0;
  let sinceAttack = 0;
  let drinkWalking = false;
  let jumpClock = 0;
  let jumpStage = 0;

  const crossTo = (name: string, seconds?: number, fade = FADE_SECONDS, rate?: number): boolean => {
    const pair = actionsFor(name, name === NEUTRAL_BODY ? undefined : seconds);
    if (!pair) return false;
    const next = pair[0] === current ? pair[1] : pair[0];
    if (current) current.fadeOut(fade);
    next.reset().fadeIn(current ? fade : 0).play();
    if (rate !== undefined) next.timeScale = rate;
    if (name === NEUTRAL_BODY) next.paused = true;
    current = next;
    return true;
  };

  const play = (id: AnimationId, restart = false) => {
    if (id === currentId && !restart) return;
    let name: string;
    if (id === 'attack') {
      // After a pause the combo starts over, because later attacks begin from where earlier ones end.
      if (sinceAttack > COMBO_PAUSE_SECONDS) attackIndex = 0;
      sinceAttack = 0;
      name = setup.attacks[attackIndex % setup.attacks.length].clip ?? NEUTRAL_BODY;
      rig.startAttack(attackIndex);
      attackIndex += 1;
    } else {
      name = clipNames[id];
    }
    // A drink may have left the walk clip running slowly.
    if (!crossTo(name, oneShotSeconds[id], FADE_SECONDS, id === 'walk' ? 1 : undefined)) return;
    if (id === 'death' && current) {
      current.setLoop(THREE.LoopOnce, 1);
      current.clampWhenFinished = true;
    }
    currentId = id;
    drinkWalking = false;
    jumpClock = 0;
    jumpStage = 0;
  };
  play('idle');

  return {
    root,
    play,
    update: (seconds) => {
      if (currentId !== 'attack') sinceAttack += seconds;
      if (currentId === 'jump') {
        jumpClock += seconds;
        const stage = jumpClock < JUMP_START_SECONDS ? 0 : jumpClock < JUMP_SECONDS - JUMP_LAND_SECONDS ? 1 : 2;
        if (stage !== jumpStage) {
          jumpStage = stage;
          if (stage === 1) crossTo('Jump_Loop', undefined, JUMP_FADE_SECONDS);
          else crossTo('Jump_Land', JUMP_LAND_SECONDS, JUMP_FADE_SECONDS);
        }
      }
      rig.beforeClips();
      mixer.update(seconds);
      rig.afterClips();
      rig.apply(seconds, currentId ?? 'idle');
    },
    setDrinkWalking: (walking) => {
      if (currentId !== 'drink' || walking === drinkWalking) return;
      drinkWalking = walking;
      crossTo(walking ? 'Walk_Loop' : setup.idleClip, undefined, FADE_SECONDS, walking ? DRINK_WALK_RATE : undefined);
    },
    armStretch: rig.stretch,
    legStretch: rig.legStretch,
    wristRoll: rig.wristRoll,
    weaponTip: rig.weaponTip,
    attackPhase: rig.attackPhase,
    impactKeyAt: rig.impactKeyAt,
    setNextAttack: (index) => {
      attackIndex = index;
      sinceAttack = 0;
    },
    attackSeconds,
    dispose: () => {
      rig.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      materials.forEach((material) => material.dispose());
      // Each clone has its own skeleton, and with it a texture on the GPU.
      model.traverse((object) => {
        const skinned = object as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      });
    },
  };
}
