import * as THREE from 'three';
import { DEFAULT_APPEARANCE, type ClassId } from '../../../shared/classes';
import { WEAPONS, weaponFor } from '../../../shared/combat';
import { DODGE_SECONDS, STAGGER_SECONDS, type AnimationId } from '../../../shared/sim';
import { ARMORY, CRITICAL_IMPACT_AT, CRITICAL_SECONDS } from './armory';
import { createCharacter, type CharacterModel } from './characters';

/*
 * Development page for checking weapon grips and attacks, opened at /weapon-lab.html on the Vite
 * dev server. It draws a character plainly (no PS1 filter) so hands and handles are easy to inspect.
 * window.lab is what the screenshot and film-strip scripts call.
 */

const FRAME = 1 / 60;
/** What the page can play: the game's animations, and a weapon's critical on a stunned boss. */
type LabAnimation = AnimationId | 'critical';
/** Seconds shown of animations that have no fixed length of their own. */
const SHOWN_SECONDS: Partial<Record<AnimationId, number>> = {
  idle: 3.6,
  walk: 1,
  run: 0.7,
  dodge: DODGE_SECONDS,
  hit: STAGGER_SECONDS,
  death: 1.6,
  drink: 0.9,
};

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb4b8bc);
scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(2, 4, 3);
scene.add(sun);
// Quarter-meter squares, so that a foot sliding along the ground is easy to see.
const floor = new THREE.GridHelper(16, 64, 0x30343a, 0x70757c);
scene.add(floor);
// The stand-in for a stunned boss during a critical: 6 m tall, its middle 4 m in front.
const BOSS_HEIGHT = 6;
const BOSS_DISTANCE = 4;
const bossBlock = new THREE.Mesh(new THREE.BoxGeometry(2.4, BOSS_HEIGHT, 1.2), new THREE.MeshLambertMaterial({ color: 0x5c6066 }));
bossBlock.position.set(0, BOSS_HEIGHT / 2, BOSS_DISTANCE);
bossBlock.visible = false;
scene.add(bossBlock);
const rootShift = new THREE.Vector3();
const facing = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.002, 0), new THREE.Vector3(0, 0.002, 1)]),
  new THREE.LineBasicMaterial({ color: 0xc02020 }),
);
scene.add(facing);
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 50);

// The path of the weapon's tip through the attack.
const TRAIL_POINTS = 300;
const trail = new THREE.Line(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3)),
  new THREE.LineBasicMaterial({ color: 0xe0109a }),
);
trail.frustumCulled = false;
trail.visible = false;
scene.add(trail);
const impactMark = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
impactMark.visible = false;
scene.add(impactMark);

let model: CharacterModel | null = null;
let modelKey = '';

async function modelFor(classId: ClassId, variant: number, body: number): Promise<CharacterModel> {
  const key = `${classId}/${variant}/${body}`;
  if (model && key === modelKey) return model;
  if (model) {
    scene.remove(model.root);
    model.dispose();
  }
  model = await createCharacter(classId, { ...DEFAULT_APPEARANCE, variant, body, hair: 1 });
  modelKey = key;
  scene.add(model.root);
  return model;
}

/** Moves the whole character by the critical's dash or leap, as the game will. */
function placeRoot(character: CharacterModel): void {
  character.root.position.copy(character.criticalRootOffset(rootShift));
}

function step(character: CharacterModel, seconds: number): void {
  let left = seconds;
  while (left > 1e-6) {
    const dt = Math.min(FRAME, left);
    character.update(dt);
    placeRoot(character);
    left -= dt;
  }
}

function settle(character: CharacterModel): void {
  character.cancelCritical();
  character.play('idle', true);
  step(character, 0.8);
  placeRoot(character);
}

/** Starts attack number index. With combo, the attack before it plays first, all the way through. */
function startAttack(character: CharacterModel, index: number, combo: boolean, count: number): void {
  if (combo) {
    character.setNextAttack((index + count - 1) % count);
    character.play('attack', true);
    step(character, character.attackSeconds);
  }
  character.setNextAttack(index);
  character.play('attack', true);
}

function aim(angle: number, distance: number, height: number, ahead = 0.3): void {
  const radians = (angle * Math.PI) / 180;
  camera.position.set(Math.sin(radians) * distance, height + 0.15, Math.cos(radians) * distance + ahead);
  camera.lookAt(0, height, ahead);
}

/** Further out and between the character and the boss, so a critical's whole sequence fits. */
const CRITICAL_VIEW = { distance: 12.5, height: 2.3, ahead: 2 };

function view(animation: LabAnimation, angle: number, distance: number | undefined, height: number | undefined, near: number): void {
  if (animation === 'critical') aim(angle, distance ?? CRITICAL_VIEW.distance, height ?? CRITICAL_VIEW.height, CRITICAL_VIEW.ahead);
  else aim(angle, distance ?? near, height ?? 1.05);
}

interface ShowOptions {
  classId: ClassId;
  variant: number;
  body?: number;
  animation: LabAnimation;
  /** How many seconds into the animation to freeze. */
  at?: number;
  /** Instead of at: what share of the animation to freeze at, from 0 to 1. */
  phase?: number;
  /** Which attack in the weapon's list to play. */
  attackIndex?: number;
  /** Plays the attack before it first, so this one starts from where that one ended. */
  combo?: boolean;
  /** Camera angle around the character, in degrees. 0 is in front of them. */
  angle: number;
  distance?: number;
  height?: number;
}

function secondsFor(character: CharacterModel, animation: LabAnimation): number {
  if (animation === 'critical') return CRITICAL_SECONDS;
  return animation === 'attack' ? character.attackSeconds : SHOWN_SECONDS[animation] ?? 1;
}

function begin(character: CharacterModel, animation: LabAnimation): void {
  bossBlock.visible = animation === 'critical';
  if (animation === 'critical') character.playCritical(CRITICAL_SECONDS);
  else character.play(animation, true);
}

/** Freezes a moment of an animation and draws it. Returns the arms' stretch: above 1, a hand can't get there. */
async function show(options: ShowOptions): Promise<number> {
  const character = await modelFor(options.classId, options.variant, options.body ?? 0);
  trail.visible = false;
  impactMark.visible = false;
  settle(character);
  const count = ARMORY[options.classId][options.variant].attacks.length;
  if (options.animation === 'attack') {
    bossBlock.visible = false;
    startAttack(character, options.attackIndex ?? 0, !!options.combo, count);
  } else begin(character, options.animation);
  const seconds =
    options.phase !== undefined ? options.phase * secondsFor(character, options.animation) : options.at ?? 0;
  step(character, seconds);
  // A zero-length freeze still needs one update, to pose the bones.
  character.update(0);

  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  view(options.animation, options.angle, options.distance, options.height, 4.2);
  renderer.render(scene, camera);
  return character.armStretch();
}

interface StripOptions {
  classId: ClassId;
  variant: number;
  body?: number;
  /** An attack's number in the weapon's list, or the name of another animation, or 'critical'. */
  what: number | LabAnimation;
  combo?: boolean;
  angles: number[];
  frames: number;
  cellWidth?: number;
  cellHeight?: number;
  distance?: number;
  height?: number;
}

interface StripFrame {
  phase: number;
  /** During a critical: where the keys are, which differs from phase under a time warp. */
  keyPhase?: number;
  /** During a critical: playback speed of the body against real time. */
  timeScale?: number;
  armStretch: number;
  legStretch: number;
  wristRoll: number;
}

interface StripResult {
  png: string;
  seconds: number;
  hitAt: number | null;
  frames: StripFrame[];
  highestArmStretch: number;
  highestLegStretch: number;
  /** How far the weapon's tip travels through the whole animation, in meters. */
  tipPathLength: number;
  /** For a critical: its marks, in real time. */
  marks?: Record<string, number>;
  /** For a critical: the character's furthest offset forward and up, in meters. */
  furthestForward?: number;
  highestUp?: number;
}

const LABEL_HEIGHT = 18;
/** A second line under each frame of a critical: the phase, and any mark that falls on it. */
const FOOTER_HEIGHT = 18;

async function makeStrip(options: StripOptions): Promise<StripResult> {
  const character = await modelFor(options.classId, options.variant, options.body ?? 0);
  const setup = ARMORY[options.classId][options.variant];
  const isAttack = typeof options.what === 'number';
  const animation: LabAnimation = typeof options.what === 'number' ? 'attack' : options.what;
  const isCritical = animation === 'critical';
  const attackIndex = typeof options.what === 'number' ? options.what : 0;
  const seconds = secondsFor(character, animation);
  const hitAt = isAttack ? character.impactKeyAt(attackIndex) : isCritical ? CRITICAL_IMPACT_AT : null;
  const footer = isCritical ? FOOTER_HEIGHT : 0;
  let furthestForward = 0;
  let highestUp = 0;

  const start = () => {
    settle(character);
    if (isAttack) {
      bossBlock.visible = false;
      startAttack(character, attackIndex, !!options.combo, setup.attacks.length);
    } else begin(character, animation);
  };

  // First pass: where the weapon's tip goes.
  const positions = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  const last = new THREE.Vector3();
  let tipPathLength = 0;
  impactMark.visible = false;
  start();
  character.update(0);
  character.weaponTip(last);
  positions.setXYZ(0, last.x, last.y, last.z);
  const steps = Math.min(TRAIL_POINTS - 1, Math.max(1, Math.round(seconds / FRAME)));
  for (let i = 1; i <= steps; i += 1) {
    character.update(seconds / steps);
    placeRoot(character);
    furthestForward = Math.max(furthestForward, character.root.position.z);
    highestUp = Math.max(highestUp, character.root.position.y);
    character.weaponTip(point);
    positions.setXYZ(i, point.x, point.y, point.z);
    tipPathLength += point.distanceTo(last);
    last.copy(point);
    if (hitAt !== null && i === Math.round(hitAt * steps)) {
      impactMark.position.copy(point);
      impactMark.visible = true;
    }
  }
  positions.needsUpdate = true;
  trail.geometry.setDrawRange(0, steps + 1);
  trail.visible = isAttack || isCritical;

  // Second pass: the film strip itself.
  const cellWidth = options.cellWidth ?? 300;
  const cellHeight = options.cellHeight ?? 340;
  const sheet = document.createElement('canvas');
  sheet.width = cellWidth * options.frames;
  sheet.height = (cellHeight + LABEL_HEIGHT + footer) * options.angles.length;
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#20242a';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = '13px sans-serif';
  renderer.setSize(cellWidth, cellHeight, false);
  camera.aspect = cellWidth / cellHeight;
  camera.updateProjectionMatrix();

  const frames: StripFrame[] = [];
  const marks = isCritical ? { ...character.criticalMarks() } : undefined;
  const markNames = marks ? Object.keys(marks) : [];
  start();
  let clock = 0;
  for (let f = 0; f < options.frames; f += 1) {
    const phase = options.frames > 1 ? f / (options.frames - 1) : 0;
    // The very end of a critical hands over to idle, so the last frame stops just short of it.
    const target = isCritical ? Math.min(phase, 1 - 1e-4) * seconds : phase * seconds;
    step(character, target - clock);
    clock = target;
    character.update(0);
    placeRoot(character);
    frames.push({
      phase,
      ...(isCritical ? { keyPhase: character.criticalKeyPhase(), timeScale: character.criticalTimeScale() } : {}),
      armStretch: character.armStretch(),
      legStretch: character.legStretch(),
      wristRoll: character.wristRoll(),
    });
    options.angles.forEach((angle, row) => {
      view(animation, angle, options.distance, options.height, 5);
      renderer.render(scene, camera);
      const y = row * (cellHeight + LABEL_HEIGHT + footer);
      ctx.drawImage(renderer.domElement, f * cellWidth, y + LABEL_HEIGHT, cellWidth, cellHeight);
      const nearImpact = hitAt !== null && Math.abs(phase - hitAt) <= 0.5 / Math.max(1, options.frames - 1);
      ctx.fillStyle = nearImpact ? '#ff7070' : '#e8e8e8';
      const armWarning = frames[f].armStretch > 1 ? ' ARM!' : '';
      const legWarning = frames[f].legStretch > 1 ? ' LEG!' : '';
      ctx.fillText(
        `${phase.toFixed(2)}  ${Math.round(clock * 1000)}ms  a${frames[f].armStretch.toFixed(2)}${armWarning}${legWarning}  ${angle}°${nearImpact ? '  ~hit' : ''}`,
        f * cellWidth + 4,
        y + 13,
      );
      if (isCritical) {
        const half = 0.5 / Math.max(1, options.frames - 1);
        const here = markNames.filter((name) => Math.abs(marks![name] - phase) <= half);
        const { keyPhase, timeScale } = frames[f];
        ctx.fillStyle = nearImpact ? '#ff7070' : here.length ? '#ffd060' : '#c8d0d8';
        ctx.fillText(
          `phase ${phase.toFixed(3)}  keys ${keyPhase!.toFixed(3)}  x${timeScale!.toFixed(2)}${here.length ? '  ' + here.join(' ') : ''}`,
          f * cellWidth + 4,
          y + LABEL_HEIGHT + cellHeight + 13,
        );
      }
    });
  }
  trail.visible = false;
  impactMark.visible = false;
  bossBlock.visible = false;
  settle(character);
  renderer.setSize(window.innerWidth, window.innerHeight);
  return {
    png: sheet.toDataURL('image/png'),
    seconds,
    hitAt,
    frames,
    highestArmStretch: Math.max(...frames.map((frame) => frame.armStretch)),
    highestLegStretch: Math.max(...frames.map((frame) => frame.legStretch)),
    tipPathLength,
    ...(isCritical ? { marks, furthestForward, highestUp } : {}),
  };
}


// One at a time, because several scripts can share this page.
let queue: Promise<unknown> = Promise.resolve();
function strip(options: StripOptions): Promise<StripResult> {
  const result = queue.then(() => makeStrip(options));
  queue = result.catch(() => undefined);
  return result;
}

/** The character on the page, for scripts that measure things. */
const character = () => model;

/** Checks that every attack has one impact key, at the moment that the game's rules land the hit. */
function validate(): string[] {
  const issues: string[] = [];
  for (const classId of Object.keys(ARMORY) as ClassId[]) {
    ARMORY[classId].forEach((setup, variant) => {
      const { hitAt, label } = WEAPONS[classId][variant] ?? weaponFor(classId, variant);
      if (label !== setup.label) issues.push(`${classId}/${variant}: ${setup.label} is ${label} in shared/combat.ts`);
      setup.attacks.forEach((attack, index) => {
        const name = `${setup.label} attack ${index}`;
        if (!attack.keys) {
          issues.push(`${name}: has no keys`);
          return;
        }
        const impacts = attack.keys.filter((key) => key.impact);
        if (impacts.length !== 1) issues.push(`${name}: has ${impacts.length} impact keys`);
        else if (impacts[0].at !== hitAt) issues.push(`${name}: impact at ${impacts[0].at}, hitAt is ${hitAt}`);
        attack.keys.forEach((key, k) => {
          if (k > 0 && key.at <= attack.keys![k - 1].at) issues.push(`${name}: key ${k} is out of order`);
        });
      });
      const critical = setup.critical;
      if (critical) {
        const name = `${setup.label} critical`;
        const impacts = critical.keys.filter((key) => key.impact);
        if (impacts.length !== 1) issues.push(`${name}: has ${impacts.length} impact keys`);
        else if (impacts[0].at !== CRITICAL_IMPACT_AT) issues.push(`${name}: impact at ${impacts[0].at}, should be ${CRITICAL_IMPACT_AT}`);
        critical.keys.forEach((key, k) => {
          if (k > 0 && key.at <= critical.keys[k - 1].at) issues.push(`${name}: key ${k} is out of order`);
        });
        const path = critical.rootPath;
        const end = path?.[path.length - 1];
        if (end && (Math.abs(end.forward - critical.travel) > 1e-6 || Math.abs(end.up ?? 0) > 1e-6)) {
          issues.push(`${name}: rootPath ends at ${end.forward} forward and ${end.up ?? 0} up, not ${critical.travel} and 0`);
        }
        for (const [mark, at] of Object.entries(critical.marks ?? {})) {
          if (!(at >= 0 && at <= 1)) issues.push(`${name}: mark ${mark} at ${at} is outside 0 to 1`);
        }
        if (critical.timeWarp?.some((key) => !(key.speed > 0))) issues.push(`${name}: a timeWarp speed is not above 0`);
      }
    });
  }
  return issues;
}

// Cast rather than declared on Window, because the world's development page has its own window.lab.
const page = window as unknown as { lab: unknown; LAB_READY?: boolean };
page.lab = { show, strip, validate, character, prepare: modelFor };
page.LAB_READY = true;
