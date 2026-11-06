/**
 * Rebuilds client/public/models/animals from Quaternius "Ultimate Animated Animal Pack" (CC0 1.0).
 *
 * Source page, license shown as CC0: https://quaternius.com/packs/ultimateanimatedanimals.html
 * Author's download, a public Drive folder linked from that page, with its own License.txt:
 *   https://drive.google.com/drive/folders/1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk
 * Take Wolf, Stag, Deer, Fox and Bull .gltf from its glTF subfolder. The raw files are about 3 MB each,
 * so they stay out of the repo.
 *
 * What this does to each animal: keeps only the clips in CLIPS, drops animation tracks that cannot
 * affect the mesh or never leave the rest pose, resamples the rest, stores rotations as 16-bit, quantizes
 * the geometry with KHR_mesh_quantization (GLTFLoader reads it without a decoder; no meshopt, no Draco),
 * and regrades the flat material colors in GRADE from the pack's bright storybook palette to a grim one.
 * The pack has no textures, so there is nothing to resize.
 *
 * Needs: npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
 * Run:   node tools/build-animals.mjs <folder with the pack's .gltf files> <output folder>
 */
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample } from '@gltf-transform/functions';

const [, , SRC, OUT] = process.argv;
if (!SRC || !OUT) throw new Error('usage: build-animals.mjs <pack glTF folder> <output folder>');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const DOG = ['Idle', 'Walk', 'Gallop', 'Attack', 'Idle_HitReact1', 'Death'];
const HOOVED = ['Idle', 'Walk', 'Gallop', 'Attack_Headbutt', 'Idle_HitReact1', 'Death'];
const CLIPS = {
  wolf: { file: 'Wolf', keep: [...DOG, 'Idle_2_HeadLow'] },
  fox: { file: 'Fox', keep: DOG },
  stag: { file: 'Stag', keep: [...HOOVED, 'Eating'] },
  deer: { file: 'Deer', keep: [...HOOVED, 'Eating'] },
  bull: { file: 'Bull', keep: HOOVED },
};

/** Linear base colors, keyed by the pack's material name. The new name is what the client should look for. */
const GRADE = {
  wolf: {
    Main: ['fur', 0.05, 0.052, 0.05],
    Main_Light: ['fur_light', 0.13, 0.135, 0.125],
    Nose: ['nose', 0.008, 0.008, 0.008],
    Eyes_Black: ['eyes', 0.005, 0.005, 0.005],
  },
  fox: {
    Main: ['fur', 0.16, 0.055, 0.022],
    Main_Light: ['fur_light', 0.14, 0.135, 0.11],
    Black: ['fur_black', 0.012, 0.012, 0.012],
    Grey: ['fur_grey', 0.035, 0.035, 0.035],
    Eyes: ['eyes', 0.005, 0.005, 0.005],
  },
  stag: {
    Material: ['fur', 0.07, 0.04, 0.02],
    'Material.001': ['horn', 0.022, 0.016, 0.011],
    'Material.003': ['fur_light', 0.16, 0.13, 0.095],
    'Material.010': ['fur_dark', 0.025, 0.014, 0.008],
    'Material.011': ['eyes', 0.005, 0.005, 0.005],
  },
  deer: {
    Main: ['fur', 0.085, 0.04, 0.02],
    Main_Light: ['fur_light', 0.17, 0.14, 0.1],
    Main_Dark: ['fur_dark', 0.04, 0.02, 0.012],
    Hooves: ['hoof', 0.02, 0.015, 0.015],
    Eye_Lighter: ['eye_rim', 0.05, 0.022, 0.012],
    Eye_Black: ['eyes', 0.005, 0.005, 0.005],
    Eye_White: ['eye_white', 0.06, 0.055, 0.05],
  },
  bull: {
    Main: ['fur', 0.016, 0.015, 0.014],
    Main_Light: ['fur_light', 0.04, 0.04, 0.034],
    Hooves: ['hoof', 0.04, 0.025, 0.012],
    Muzzle: ['muzzle', 0.012, 0.009, 0.007],
    Eye_Black: ['eyes', 0.005, 0.005, 0.005],
    Eye_White: ['eye_white', 0.05, 0.045, 0.04],
    Horns: ['horn', 0.2, 0.17, 0.11],
  },
};

const near = (a, b, eps) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

/** Joints with a vertex weight, plus every ancestor of one. The IK and pole bones are baked and move nothing. */
function bonesThatMatter(doc) {
  const live = new Set();
  const root = doc.getRoot();
  for (const mesh of root.listMeshes()) {
    for (const node of root.listNodes().filter((n) => n.getMesh() === mesh)) {
      const skin = node.getSkin();
      if (!skin) { for (let n = node; n; n = n.getParentNode()) live.add(n); continue; }
      const joints = skin.listJoints();
      for (const prim of mesh.listPrimitives()) {
        const j = prim.getAttribute('JOINTS_0');
        const w = prim.getAttribute('WEIGHTS_0');
        const a = []; const b = [];
        for (let i = 0; i < j.getCount(); i += 1) {
          j.getElement(i, a); w.getElement(i, b);
          a.forEach((id, k) => { if (b[k] > 0) for (let n = joints[id]; n; n = n.getParentNode()) live.add(n); });
        }
      }
    }
  }
  return live;
}

function restValue(node, pathName) {
  if (pathName === 'translation') return node.getTranslation();
  if (pathName === 'rotation') return node.getRotation();
  return node.getScale();
}

function trimTracks(doc) {
  const root = doc.getRoot();
  const live = bonesThatMatter(doc);
  for (const clip of root.listAnimations()) {
    for (const channel of clip.listChannels()) {
      const node = channel.getTargetNode();
      const sampler = channel.getSampler();
      const output = sampler.getOutput();
      const type = channel.getTargetPath();
      const rest = restValue(node, type);
      let moves = false;
      const v = [];
      for (let i = 0; i < output.getCount() && !moves; i += 1) {
        output.getElement(i, v);
        // q and -q are the same rotation.
        moves = !(near(v, rest, 1e-4) || (type === 'rotation' && near(v.map((x) => -x), rest, 1e-4)));
      }
      if (!live.has(node) || !moves) { channel.dispose(); sampler.dispose(); }
    }
  }
}

/** glTF allows normalized int16 rotation output, and GLTFLoader denormalizes it. */
function packRotations(doc) {
  const seen = new Set();
  for (const clip of doc.getRoot().listAnimations()) {
    for (const channel of clip.listChannels()) {
      if (channel.getTargetPath() !== 'rotation') continue;
      const output = channel.getSampler().getOutput();
      if (seen.has(output)) continue;
      seen.add(output);
      const src = output.getArray();
      const dst = new Int16Array(src.length);
      for (let i = 0; i < src.length; i += 1) dst[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 32767);
      output.setArray(dst).setNormalized(true);
    }
  }
}

mkdirSync(OUT, { recursive: true });
for (const [id, { file, keep }] of Object.entries(CLIPS)) {
  const doc = await io.read(path.join(SRC, `${file}.gltf`));
  const root = doc.getRoot();
  const have = root.listAnimations().map((a) => a.getName());
  for (const name of keep) if (!have.includes(name)) throw new Error(`${file}: no clip ${name}, has ${have}`);
  for (const clip of root.listAnimations()) {
    if (keep.includes(clip.getName())) continue;
    // Disposing only the clip leaves its samplers alive, and they hold on to about 800 KB of keys.
    clip.listChannels().forEach((c) => c.dispose());
    clip.listSamplers().forEach((s) => s.dispose());
    clip.dispose();
  }
  for (const m of root.listMaterials()) {
    const grade = GRADE[id][m.getName()];
    if (!grade) throw new Error(`${file}: no grade for material ${m.getName()}`);
    const [name, r, g, b] = grade;
    m.setName(name).setBaseColorFactor([r, g, b, 1]).setRoughnessFactor(1).setMetallicFactor(0);
  }
  trimTracks(doc);
  await doc.transform(
    resample({ tolerance: 0.0002 }),
    prune({ keepLeaves: true, keepAttributes: true }),
    dedup(),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeWeight: 8 }),
  );
  packRotations(doc);
  const target = path.join(OUT, `${id}.glb`);
  await io.write(target, doc);
  console.log(id, `${Math.round(statSync(target).size / 1024)} KB`, root.listAnimations().map((a) => a.getName()).join(', '));
}
