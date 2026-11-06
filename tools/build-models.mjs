/**
 * Rebuilds client/public/models from the original CC0 downloads.
 *
 * The raw packs are large, so they stay out of the repo. To add an outfit or animation, download
 * these from itch.io, unzip them, and adjust the paths and lists below:
 *   https://quaternius.itch.io/universal-base-characters
 *   https://quaternius.itch.io/modular-character-outfits-fantasy
 *   https://quaternius.itch.io/universal-animation-library
 *   https://quaternius.itch.io/universal-animation-library-2
 *   https://amos-makes.itch.io/psx-weapon-pack
 *   https://cardinalzebra.itch.io/low-poly-fantasy-weapon-pack (FBX, so convert to GLB first)
 *
 * Needs: npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
 * Run:   node tools/build-models.mjs <folder with the unzipped packs> <output folder>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, prune, quantize, resample, simplifyPrimitive, textureCompress, weld, unpartition } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , S, OUT] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

const BASE = `${S}/dl-itch/base/Universal Base Characters[Standard]`;
const FITS = `${S}/dl-itch/outfits/Modular Character Outfits - Fantasy[Standard]`;
const HAIR = `${BASE}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)`;
const OUTFITS = `${FITS}/Exports/glTF (Godot-Unreal)/Outfits`;
const BODY = `${BASE}/Base Characters/Godot - UE`;
const TEX = `${BASE}/Base Characters/Textures`;

const KITS = {
  male: {
    body: `${BODY}/Superhero_Male_FullBody.gltf`,
    light: `${TEX}/T_Superhero_Male_Ligh.png`,
    bodyMaterial: 'MI_Superhero_Male',
    bodyMesh: 'SuperHero_Male',
    parts: [`${OUTFITS}/Male_Ranger.gltf`, `${OUTFITS}/Male_Peasant.gltf`, ...['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Beard'].map((n) => `${HAIR}/${n}.gltf`)],
  },
  female: {
    body: `${BODY}/Superhero_Female_FullBody.gltf`,
    light: `${TEX}/T_Superhero_Female_Light_BaseColor.png`,
    bodyMaterial: 'MI_Superhero_Female',
    bodyMesh: 'Superhero_Female',
    parts: [`${OUTFITS}/Female_Ranger.gltf`, `${OUTFITS}/Female_Peasant.gltf`, ...['Hair_BuzzedFemale', 'Hair_Long', 'Hair_Buns'].map((n) => `${HAIR}/${n}.gltf`)],
  },
};

// How much detail each kind of part keeps. Faces keep the most.
function ratioFor(name) {
  if (name === 'HeadPart') return 0.6;
  if (name === 'TorsoPart') return 0.45;
  if (/Eyes|Eyebrows/.test(name)) return 1;
  if (/Hair/.test(name)) return 0.4;
  if (/Feet/.test(name)) return 0.18;
  if (/Bracer|Belt|Pauldron/.test(name)) return 0.3;
  return 0.35;
}

/** Copies a mesh, keeping only triangles driven mostly by the chosen bones. */
function cutByBones(doc, node, skin, name, wanted) {
  const keptJoints = new Set();
  skin.listJoints().forEach((joint, index) => {
    if (wanted(joint.getName())) keptJoints.add(index);
  });
  const source = node.getMesh().listPrimitives()[0];
  const prim = source.clone();
  const joints = source.getAttribute('JOINTS_0');
  const weights = source.getAttribute('WEIGHTS_0');
  const indices = source.getIndices();
  const isKept = (vertex) => {
    const j = joints.getElement(vertex, []);
    const w = weights.getElement(vertex, []);
    let total = 0;
    for (let i = 0; i < 4; i += 1) if (keptJoints.has(j[i])) total += w[i];
    return total > 0.5;
  };
  const kept = [];
  for (let i = 0; i < indices.getCount(); i += 3) {
    const a = indices.getScalar(i);
    const b = indices.getScalar(i + 1);
    const c = indices.getScalar(i + 2);
    if (isKept(a) && isKept(b) && isKept(c)) kept.push(a, b, c);
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept)).setBuffer(indices.getBuffer()));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  return doc.createNode(name).setMesh(mesh).setSkin(skin);
}

for (const [gender, kit] of Object.entries(KITS)) {
  const doc = await io.read(kit.body);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const master = root.listSkins()[0];
  const masterNodes = new Set();
  scene.traverse((node) => masterNodes.add(node));

  for (const file of kit.parts) {
    const extra = await io.read(file);
    mergeDocuments(doc, extra);
  }
  // All files share one skeleton, so every part moves onto the first copy of it.
  const allNodes = root.listNodes();
  for (const node of allNodes) {
    if (!node.getMesh()) continue;
    if (node.getSkin()) node.setSkin(master);
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    scene.addChild(node);
  }
  for (const skin of root.listSkins()) if (skin !== master) skin.dispose();
  for (const other of root.listScenes()) if (other !== scene) other.dispose();
  const reachable = new Set();
  scene.traverse((node) => reachable.add(node));
  for (const node of root.listNodes()) if (!reachable.has(node)) node.dispose();

  const bodyNode = root.listNodes().find((node) => node.getName() === kit.bodyMesh);
  scene.addChild(cutByBones(doc, bodyNode, master, 'HeadPart', (bone) => bone === 'Head' || bone === 'neck_01'));
  // A bare torso and arms, for the muscular class. The hips and legs come from clothing.
  scene.addChild(cutByBones(doc, bodyNode, master, 'TorsoPart', (bone) => !/pelvis|thigh|calf|foot|ball|root/.test(bone)));
  bodyNode.dispose();

  // Only base color is kept: the game lights everything per vertex, like a PS1.
  for (const material of root.listMaterials()) {
    material.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    material.setMetallicFactor(0).setRoughnessFactor(1);
  }
  const bodyMaterial = root.listMaterials().find((m) => m.getName() === kit.bodyMaterial);
  const dark = bodyMaterial?.getBaseColorTexture();
  if (dark) {
    dark.setImage(new Uint8Array(readFileSync(kit.light))).setMimeType('image/png');
  }

  await doc.transform(prune({ keepLeaves: true, keepAttributes: false }), dedup(), weld());
  for (const mesh of root.listMeshes()) {
    const ratio = ratioFor(mesh.getName());
    if (ratio >= 1) continue;
    for (const prim of mesh.listPrimitives()) {
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: true });
    }
  }
  await doc.transform(
    prune({ keepLeaves: true, keepAttributes: false }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 80 }),
    quantize({ quantizationVolume: 'scene', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
    dedup(),
    unpartition(),
  );
  const parts = root.listNodes().filter((n) => n.getMesh()).map((n) => {
    const tris = n.getMesh().listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? 0) / 3, 0);
    return `${n.getName()}:${tris | 0}`;
  });
  console.log(gender, parts.join(' '));
  await io.write(path.join(OUT, `kit-${gender}.glb`), doc);
}

// Animations: strip the mannequin and keep only the clips the game uses, now and in the plan.
const KEEP = {
  UAL1_Standard: ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Roll', 'Death01', 'Hit_Chest', 'Hit_Head', 'Sword_Idle', 'Sword_Attack', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Spell_Simple_Enter', 'Spell_Simple_Exit', 'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload', 'Punch_Jab', 'Interact', 'PickUp_Table', 'Jump_Start', 'Jump_Loop', 'Jump_Land'],
  UAL2_Standard: ['Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C', 'Sword_Heavy_Combo', 'Sword_Block', 'Sword_Dash', 'Idle_Shield_Loop', 'Shield_OneShot', 'Shield_Dash', 'TreeChopping_Loop', 'Melee_Hook', 'Consume', 'Chest_Open', 'Hit_Knockback', 'OverhandThrow', 'Zombie_Idle_Loop', 'Zombie_Scratch', 'Zombie_Walk_Fwd_Loop'],
};
const UAL = { UAL1_Standard: `${S}/dl-itch2/x-Universal Animation Library[Standard]/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb`, UAL2_Standard: `${S}/dl-itch2/x-Universal Animation Library 2[Standard]/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb` };
for (const [name, file] of Object.entries(UAL)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) if (!KEEP[name].includes(anim.getName())) anim.dispose();
  root.listNodes().forEach((n) => { n.setMesh(null); n.setSkin(null); });
  root.listSkins().forEach((x) => x.dispose());
  root.listMeshes().forEach((x) => x.dispose());
  root.listMaterials().forEach((x) => x.dispose());
  root.listTextures().forEach((x) => x.dispose());
  // Only the hips move through space, and nothing scales. The rest is rotation.
  for (const anim of root.listAnimations()) {
    for (const channel of anim.listChannels()) {
      const path = channel.getTargetPath();
      const target = channel.getTargetNode()?.getName();
      if (path === 'scale' || (path === 'translation' && target !== 'pelvis')) {
        channel.getSampler()?.dispose();
        channel.dispose();
      }
    }
  }
  await doc.transform(resample({ tolerance: 0.002 }), prune({ keepLeaves: true }), dedup());
  // 16-bit rotations are in the glTF spec, and halve the size with no visible change.
  for (const anim of root.listAnimations()) {
    for (const sampler of anim.listSamplers()) {
      const output = sampler.getOutput();
      if (!output || output.getType() !== 'VEC4' || output.getNormalized()) continue;
      const source = output.getArray();
      const packed = new Int16Array(source.length);
      for (let i = 0; i < source.length; i += 1) packed[i] = Math.round(Math.max(-1, Math.min(1, source[i])) * 32767);
      const accessor = doc.createAccessor().setType('VEC4').setArray(packed).setNormalized(true).setBuffer(output.getBuffer());
      sampler.setOutput(accessor);
    }
  }
  await doc.transform(prune({ keepLeaves: true }), dedup(), unpartition());
  console.log(name, root.listAnimations().map((a) => a.getName()).length, 'clips');
  await io.write(path.join(OUT, `anim-${name.startsWith('UAL1') ? 1 : 2}.glb`), doc);
}


// Weapons: one file, each weapon under a node with its id.
const psx = `${S}/dl-itch2/x-psx/PSX_Weapons_GLTF`;
const low = `${S}/dl-itch2/x-lowpoly-glb`;
const weaponDoc = new Document();
const weaponScene = weaponDoc.createScene('weapons');
weaponDoc.createBuffer();
const weaponFiles = [
  ...['katana', 'longsword', 'zweinhander', 'war_hammer', 'double_axe', 'mace', 'dagger', 'spear', 'halberd', 'Shield'].map((id) => [id.toLowerCase(), `${psx}/${id}.glb`]),
  ...['longbow', 'shortbow', 'arrow', 'magic_staff', 'magic_wand', 'spell_tome', 'bo_staff'].map((id) => [id, `${low}/${id}.glb`]),
];
for (const [id, file] of weaponFiles) {
  const extra = await io.read(file);
  const before = new Set(weaponDoc.getRoot().listScenes());
  mergeDocuments(weaponDoc, extra);
  const added = weaponDoc.getRoot().listScenes().filter((s) => !before.has(s));
  const holder = weaponDoc.createNode(id);
  for (const sc of added) {
    for (const child of sc.listChildren()) holder.addChild(child);
    sc.dispose();
  }
  weaponScene.addChild(holder);
}
for (const material of weaponDoc.getRoot().listMaterials()) {
  material.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
  material.setMetallicFactor(0).setRoughnessFactor(1);
}
await weaponDoc.transform(
  prune({ keepLeaves: false, keepAttributes: false }),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [128, 128], quality: 85 }),
  unpartition(),
);
console.log('weapons', weaponDoc.getRoot().listNodes().filter((n) => n.getParentNode() === null).map((n) => n.getName()).join(' '));
await io.write(path.join(OUT, 'weapons.glb'), weaponDoc);
