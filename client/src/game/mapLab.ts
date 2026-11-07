import * as THREE from 'three';
import { MAP } from '../../../shared/mapData';
import { PsxRenderer, snapUniform } from './psxRenderer';
import { createWorld } from './world';

/*
 * Development page for looking around the map, at /map-lab.html on the Vite dev server.
 * URL options: view=<name>, phase=<0..1>, overlay=1 (colliders), stage=1 (the character screen's stage).
 * Keys: WASD move, Q and E down and up, shift to go fast, drag to look. window.lab is what the
 * screenshot scripts call.
 */

/** Named camera spots: eye x, y, z, then the point it looks at. */
const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  spawn: [0, 2.2, 183, 0, 8, 60],
  shrine: [12, 2.4, 165, -2, 3, 190],
  meadow: [-48, 2.2, 150, 18, 5, 100],
  road: [-1, 2.2, 25, 2, 8, -100],
  village: [2, 2.2, 104, -18, 3, 60],
  chapel: [-12, 2.4, 46, -35, 2, 45],
  forestEdge: [46, 2.2, 66, 90, 6, 55],
  deepForest: [112, 2.0, 38, 140, 6, 16],
  clearing: [131, 2.2, 21, 152, 3, 8],
  hutChest: [189, 2.0, -30, 190, 0.8, -41],
  hutOutside: [178, 3, -20, 190, 3, -40],
  gateOutside: [0, 2.2, -70, 0, 9, -100],
  gateThrough: [0, 2.0, -96.5, 0, 3, -150],
  yard: [-7, 2.4, -117, 2, 10, -168],
  yardEast: [20, 2.4, -130, 74, 7, -168],
  citadelChest: [72, 2.0, -162, 72, 0.6, -170],
  hamletChest: [-30, 1.8, 47, -35, 0.6, 45],
  flats: [24, 2.2, -8, -5, 6, -100],
  closedWest: [-40, 2.2, 8, -110, 5, 8],
  closedEast: [40, 2.2, -92, 110, 8, -125],
  overview: [0, 340, 60, 0, 0, -30],
};

const canvas = document.getElementById('view') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const psx = new PsxRenderer(canvas);
psx.renderer.info.autoReset = false;
const phaseParam = params.get('phase');
const world = createWorld({ withRocks: params.get('stage') !== '1', fixedPhase: phaseParam === null ? 0.5 : Number(phaseParam) });
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000);

function resize(): void {
  psx.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let yaw = 0;
let pitch = 0;
let overlay: THREE.Group | null = null;
let fogOff = params.get('nofog') === '1';
/** A 1.75 m stand-in for a person, for judging scale. */
const figure = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.15, 3, 8), new THREE.MeshLambertMaterial({ color: 0x8a2a20 }));
figure.position.set(0, 0.875, 0);
figure.visible = false;
world.scene.add(figure);

function go(name: string): boolean {
  const view = VIEWS[name];
  if (!view) return false;
  camera.position.set(view[0], view[1], view[2]);
  camera.lookAt(view[3], view[4], view[5]);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  yaw = Math.atan2(-direction.x, -direction.z);
  pitch = Math.asin(direction.y);
  // Half a dozen meters ahead on the ground, where a third-person camera would put the player.
  figure.position.set(view[0] + direction.x * 6, 0.875, view[2] + direction.z * 6);
  return true;
}

function buildOverlay(): THREE.Group {
  const group = new THREE.Group();
  const points: number[] = [];
  const segment = (ax: number, az: number, bx: number, bz: number, y: number) => points.push(ax, y, az, bx, y, bz);
  for (const collider of MAP.colliders) {
    for (const y of [0.15, 2.2]) {
      if (collider.t === 'c') {
        for (let i = 0; i < 12; i += 1) {
          const a = (i / 12) * Math.PI * 2;
          const b = ((i + 1) / 12) * Math.PI * 2;
          segment(collider.x + Math.cos(a) * collider.r, collider.z + Math.sin(a) * collider.r, collider.x + Math.cos(b) * collider.r, collider.z + Math.sin(b) * collider.r, y);
        }
      } else {
        const corners = [[-collider.hw, -collider.hd], [collider.hw, -collider.hd], [collider.hw, collider.hd], [-collider.hw, collider.hd]].map(([lx, lz]) => [
          collider.x + lx * collider.cos + lz * collider.sin,
          collider.z - lx * collider.sin + lz * collider.cos,
        ]);
        for (let i = 0; i < 4; i += 1) segment(corners[i][0], corners[i][1], corners[(i + 1) % 4][0], corners[(i + 1) % 4][1], y);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xff2040, fog: false, depthTest: false }));
  lines.frustumCulled = false;
  lines.renderOrder = 50;
  group.add(lines);
  const marker = (x: number, z: number, color: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7, 1.6), new THREE.MeshBasicMaterial({ color, fog: false, depthTest: false }));
    mesh.position.set(x, 3.5, z);
    mesh.renderOrder = 51;
    group.add(mesh);
  };
  MAP.chests.forEach((chest) => marker(chest.x, chest.z, 0xffdd33));
  MAP.graces.forEach((grace) => marker(grace.x, grace.z, 0xffc84a));
  MAP.camps.forEach((camp) => marker(camp.x, camp.z, 0x33aaff));
  return group;
}

function setOverlay(on: boolean): void {
  if (overlay) world.scene.remove(overlay);
  overlay = on ? buildOverlay() : null;
  if (overlay) world.scene.add(overlay);
}

const keys = new Set<string>();
window.addEventListener('keydown', (event) => keys.add(event.code));
window.addEventListener('keyup', (event) => keys.delete(event.code));
canvas.addEventListener('pointerdown', () => canvas.setPointerCapture(0));
canvas.addEventListener('pointermove', (event) => {
  if (!event.buttons) return;
  yaw -= event.movementX * 0.004;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - event.movementY * 0.004));
});

const stats = document.getElementById('stats')!;
let last = performance.now();
let frames = 0;
let frameStart = last;
let fps = 0;
const lastInfo = { calls: 0, triangles: 0 };

function renderOnce(dt: number): void {
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  const move = new THREE.Vector3((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0), (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0));
  camera.position.addScaledVector(move.applyEuler(camera.rotation), dt * (keys.has('ShiftLeft') ? 40 : 8));
  // The fog and fires follow the camera here, because there's no player.
  world.update(camera.position.x, camera.position.z);
  if (fogOff) {
    const fog = world.scene.fog as THREE.Fog;
    fog.near = 5000;
    fog.far = 9000;
  }
  camera.updateMatrixWorld();
  psx.renderer.info.reset();
  psx.render(world.scene, camera);
  lastInfo.calls = psx.renderer.info.render.calls;
  lastInfo.triangles = psx.renderer.info.render.triangles;
}

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  renderOnce(dt);
  frames += 1;
  if (now - frameStart > 500) {
    fps = (frames * 1000) / (now - frameStart);
    frames = 0;
    frameStart = now;
    stats.textContent = `${fps.toFixed(0)} fps  ${lastInfo.calls} calls  ${(lastInfo.triangles / 1000).toFixed(0)}k tris  ${camera.position.x.toFixed(0)},${camera.position.z.toFixed(0)}`;
  }
  requestAnimationFrame(loop);
}

const bar = document.getElementById('bar')!;
for (const name of Object.keys(VIEWS)) {
  const button = document.createElement('button');
  button.textContent = name;
  button.addEventListener('click', () => go(name));
  bar.appendChild(button);
}

go(params.get('view') ?? 'spawn');
if (params.get('overlay') === '1') setOverlay(true);
// Screenshot scripts draw frames on demand, so a software renderer isn't kept busy between shots.
if (params.get('manual') !== '1') requestAnimationFrame(loop);

let bakeRenderer: THREE.WebGLRenderer | null = null;

interface BakeOptions {
  width: number;
  height: number;
  /** Where the sun is, as a direction from the ground. */
  sun: [number, number, number];
  /** Leaves the ground out and the background clear, so the alpha channel says where things stand. */
  propsOnly?: boolean;
  shadows?: boolean;
  /** With propsOnly: draws only the models whose names match this regular expression. */
  match?: string;
}

/**
 * Draws the whole world straight down with no PS1 pass, for tools/build-world-map.mjs. The picture
 * matches MAP.bounds edge to edge, with north (minZ) at the top. Answers a PNG as base64.
 */
function bakeTopDown({ width, height, sun, propsOnly = false, shadows = true, match }: BakeOptions): string {
  const { minX, maxX, minZ, maxZ } = MAP.bounds;
  figure.visible = false;
  setOverlay(false);
  // A grid this fine turns the PS1 vertex wobble off.
  snapUniform.value.set(1e6, 1e6);
  const { ground, sun: light } = world.prepareTopDown(new THREE.Vector3(...sun));
  const meshes: THREE.Mesh[] = [];
  world.scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });

  if (!bakeRenderer) {
    bakeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    bakeRenderer.shadowMap.enabled = true;
    bakeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    bakeRenderer.setPixelRatio(1);
    bakeRenderer.setClearColor(0x000000, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(8192, 8192);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.06;
    Object.assign(light.shadow.camera, { left: -440, right: 440, top: 440, bottom: -440, near: 50, far: 2000 });
    light.shadow.camera.updateProjectionMatrix();
    // The ground's mountains would throw shadows across the whole map, and thin trunks streak it.
    for (const mesh of meshes) mesh.castShadow = mesh !== ground && !/^tree_/.test(mesh.name);
  }
  for (const mesh of meshes) mesh.receiveShadow = shadows;
  bakeRenderer.setSize(width, height, false);

  const top = new THREE.OrthographicCamera(minX, maxX, -minZ, -maxZ, 10, 2000);
  top.position.set(0, 1000, 0);
  // Looking down with north up: the view's right is +x, and its up is -z.
  top.up.set(0, 0, -1);
  top.lookAt(0, 0, 0);
  top.updateMatrixWorld();

  // Culling decides which meshes are visible while rendering, so it has to have settled before filtering.
  bakeRenderer.render(world.scene, top);
  const wasVisible = new Map(meshes.map((mesh) => [mesh, mesh.visible]));
  const matches = match ? new RegExp(match) : null;
  if (propsOnly) {
    for (const mesh of meshes) mesh.visible = mesh !== ground && mesh.visible && (!matches || matches.test(mesh.name));
    bakeRenderer.render(world.scene, top);
  }
  bakeRenderer.getContext().finish();
  const png = bakeRenderer.domElement.toDataURL('image/png').split(',')[1];
  for (const mesh of meshes) mesh.visible = wasVisible.get(mesh) ?? mesh.visible;
  return png;
}

declare global {
  interface Window {
    lab: {
      go: typeof go;
      setOverlay: typeof setOverlay;
      setCamera: (x: number, y: number, z: number, lookX: number, lookY: number, lookZ: number) => void;
      setFigure: (visible: boolean) => void;
      setChestOpen: (id: number, open: boolean, animate: boolean) => void;
      /** Draws one frame right now and reports its cost, with a screenshot-safe drawing buffer. */
      measure: () => { calls: number; triangles: number; fps: number; ms: number };
      setFogOff: (off: boolean) => void;
      /** The most expensive models in the last frame: triangle counts by node. */
      breakdown: () => Array<[string, number, number]>;
      /** The world itself, so that a test can call its chest functions directly. */
      world: typeof world;
      bakeTopDown: typeof bakeTopDown;
      mapData: () => Pick<typeof MAP, 'bounds' | 'road' | 'trails' | 'zones' | 'graces' | 'spawn' | 'props'>;
      views: string[];
      ready: Promise<void>;
    };
  }
}

window.lab = {
  go,
  setOverlay,
  setCamera: (x, y, z, lookX, lookY, lookZ) => {
    camera.position.set(x, y, z);
    camera.lookAt(lookX, lookY, lookZ);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    yaw = Math.atan2(-direction.x, -direction.z);
    pitch = Math.asin(direction.y);
  },
  setFigure: (visible) => {
    figure.visible = visible;
  },
  setChestOpen: (id, open, animate) => world.setChestOpen(id, open, animate),
  measure: () => {
    const start = performance.now();
    renderOnce(0);
    psx.renderer.getContext().finish();
    return { calls: lastInfo.calls, triangles: lastInfo.triangles, fps, ms: performance.now() - start };
  },
  setFogOff: (off) => {
    fogOff = off;
  },
  breakdown: () => {
    const totals = new Map<string, [number, number]>();
    world.scene.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || !mesh.visible) return;
      const index = mesh.geometry.getIndex();
      const triangles = ((index ? index.count : mesh.geometry.getAttribute('position').count) / 3) * mesh.count;
      const entry = totals.get(mesh.name) ?? [0, 0];
      entry[0] += triangles;
      entry[1] = Math.max(entry[1], mesh.count);
      totals.set(mesh.name, entry);
    });
    return [...totals.entries()].map(([name, [triangles, count]]) => [name, triangles, count] as [string, number, number]).sort((a, b) => b[1] - a[1]).slice(0, 14);
  },
  world,
  bakeTopDown,
  mapData: () => ({ bounds: MAP.bounds, road: MAP.road, trails: MAP.trails, zones: MAP.zones, graces: MAP.graces, spawn: MAP.spawn, props: MAP.props }),
  views: Object.keys(VIEWS),
  ready: world.ready,
};
export {};
