import * as THREE from 'three';

/*
 * An open book, built in code because the one in weapons.glb is closed. Its spine runs along +Y with
 * the top of the book at +Y, the pages face +Z, and its width is along X. The origin is the middle of
 * the spine's back. The character's adopt step swaps these materials for Lambert ones with vertex snap,
 * and keeps the map, so these only say what the book is made of.
 */

const WIDTH = 0.32;
const HEIGHT = 0.22;
/** How far each half is folded up out of flat, in radians. */
const FOLD = 0.25;
const BOARD = 0.006;
const PAGES_INSET = 0.008;

/** Across a page from the gutter: where the page block's surface sits above the cover. */
const PAGE_SURFACE: readonly (readonly [number, number])[] = [
  [0, 0.007],
  [0.014, 0.021],
  [0.05, 0.028],
  [0.1, 0.026],
  [0.135, 0.021],
  [WIDTH / 2 - PAGES_INSET, 0.017],
];
// The loose leaf is a chain of strips that bend at each join, so that it curves as it lifts, as paper does,
// and never stands up from the spine as one flat shard. Each angle is relative to the strip before it.
const LEAF_WIDTH = (WIDTH / 2 - PAGES_INSET - 0.002) / 4;
const LEAF_REST = [0.42, -0.32, -0.2, -0.2];

// The atlas: pages across the top, stacked page edges in the band below.
const ATLAS = 128;
const PAGE_BAND = 0.86;
const EDGE_V = [0.89, 0.98] as const;

let paperTexture: THREE.CanvasTexture | null = null;

/** A small repeatable pattern, so that every book's page looks the same without a stored image. */
function noise(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Aged paper with lines of faint runes. It is shared by every book, and the character grades its own copy. */
function paper(): THREE.CanvasTexture {
  if (paperTexture) return paperTexture;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const ctx = canvas.getContext('2d')!;
  const pageRows = Math.round(ATLAS * PAGE_BAND);
  ctx.fillStyle = '#d9c9a0';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  // Blotches of age, and darkening toward the outside of each page and into the gutter.
  for (let i = 0; i < 420; i += 1) {
    const shade = noise(i + 0.5) > 0.5 ? '#c7b48a' : '#e3d6b2';
    ctx.fillStyle = shade;
    ctx.fillRect(Math.floor(noise(i + 0.1) * ATLAS), Math.floor(noise(i + 0.2) * pageRows), 1 + Math.floor(noise(i + 0.3) * 3), 1 + Math.floor(noise(i + 0.4) * 2));
  }
  ctx.fillStyle = 'rgba(92, 62, 28, 0.32)';
  ctx.fillRect(0, 0, 3, pageRows);
  ctx.fillRect(ATLAS - 3, 0, 3, pageRows);
  ctx.fillRect(ATLAS / 2 - 3, 0, 6, pageRows);

  ctx.fillStyle = '#3d2c1c';
  let seed = 3;
  for (let page = 0; page < 2; page += 1) {
    const left = page * (ATLAS / 2) + (page === 0 ? 8 : 9);
    const right = left + ATLAS / 2 - 17;
    for (let y = 8; y < pageRows - 8; y += 5) {
      // The right page has a drawn circle of runes partway down, which reads even at a distance.
      if (page === 1 && y > 28 && y < 62) continue;
      let x = left;
      // A large red letter to start the left page.
      if (page === 0 && y < 20) x = left + 13;
      while (x < right - 1) {
        seed += 1;
        const length = 2 + Math.floor(noise(seed) * 4);
        ctx.fillRect(x, y, Math.min(length, right - x), 2);
        // The strokes that make these look like writing rather than ruled lines.
        if (noise(seed + 0.7) > 0.55) ctx.fillRect(x + Math.floor(noise(seed + 0.2) * length), y - 1, 1, 1);
        x += length + 1 + Math.floor(noise(seed + 0.4) * 2);
      }
    }
  }
  ctx.fillStyle = '#8c2a1e';
  ctx.fillRect(8, 7, 10, 12);
  ctx.fillStyle = '#d9c9a0';
  ctx.fillRect(11, 10, 4, 6);

  ctx.strokeStyle = '#6b2a20';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ATLAS * 0.75, 45, 14, 0, Math.PI * 2);
  ctx.moveTo(ATLAS * 0.75 + 9, 45);
  ctx.arc(ATLAS * 0.75, 45, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#6b2a20';
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.fillRect(Math.round(ATLAS * 0.75 + Math.cos(angle) * 11.5), Math.round(45 + Math.sin(angle) * 11.5), 1, 2);
  }

  // Stacked page edges.
  for (let y = pageRows; y < ATLAS; y += 1) {
    ctx.fillStyle = y % 2 === 0 ? '#e6dcbc' : '#a8956c';
    ctx.fillRect(0, y, ATLAS, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  // Matches the graded copy, in which the canvas's top row is v = 0.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  paperTexture = texture;
  return texture;
}

function pushQuad(
  positions: number[],
  uvs: number[],
  corners: readonly (readonly [number, number, number])[],
  cornerUvs: readonly (readonly [number, number])[],
): void {
  for (const i of [0, 1, 2, 0, 2, 3]) {
    positions.push(...corners[i]);
    uvs.push(...cornerUvs[i]);
  }
}

function finish(positions: number[], uvs: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

const pageU = (side: number, x: number) => {
  const across = x / (WIDTH / 2 - PAGES_INSET);
  return side > 0 ? 0.5 + across * 0.5 : 0.5 - across * 0.5;
};
const pageV = (y: number) => (0.5 - y / (HEIGHT - 0.012)) * PAGE_BAND;

/** One side's block of pages, in the half's own frame, with its surface bowed like an open book's. */
function pageBlock(side: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const top = (HEIGHT - 0.012) / 2;
  const edge = (a: number, b: number): [number, number][] => [
    [a, EDGE_V[0]],
    [b, EDGE_V[0]],
    [b, EDGE_V[1]],
    [a, EDGE_V[1]],
  ];
  // Winding is chosen by whether the side flips the x axis, so that every face looks outward.
  const quad = (corners: [number, number, number][], cornerUvs: [number, number][]) => {
    if (side < 0) {
      pushQuad(positions, uvs, [corners[0], corners[3], corners[2], corners[1]], [cornerUvs[0], cornerUvs[3], cornerUvs[2], cornerUvs[1]]);
    } else pushQuad(positions, uvs, corners, cornerUvs);
  };
  for (let i = 0; i + 1 < PAGE_SURFACE.length; i += 1) {
    const [x0, h0] = PAGE_SURFACE[i];
    const [x1, h1] = PAGE_SURFACE[i + 1];
    const sx0 = side * x0;
    const sx1 = side * x1;
    quad(
      [
        [sx0, -top, h0],
        [sx1, -top, h1],
        [sx1, top, h1],
        [sx0, top, h0],
      ],
      [
        [pageU(side, x0), pageV(-top)],
        [pageU(side, x1), pageV(-top)],
        [pageU(side, x1), pageV(top)],
        [pageU(side, x0), pageV(top)],
      ],
    );
    // The stacked edges at the head and foot of the block.
    quad(
      [
        [sx0, top, h0],
        [sx1, top, h1],
        [sx1, top, 0],
        [sx0, top, 0],
      ],
      edge(0, 1),
    );
    quad(
      [
        [sx0, -top, 0],
        [sx1, -top, 0],
        [sx1, -top, h1],
        [sx0, -top, h0],
      ],
      edge(0, 1),
    );
  }
  const [xOut, hOut] = PAGE_SURFACE[PAGE_SURFACE.length - 1];
  quad(
    [
      [side * xOut, -top, 0],
      [side * xOut, top, 0],
      [side * xOut, top, hOut],
      [side * xOut, -top, hOut],
    ],
    edge(0, 1),
  );
  return finish(positions, uvs);
}

/** One strip of the loose leaf, facing both ways, from its hinge at x = 0. Index says which strip of the page it shows. */
function leafStrip(index: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const top = (HEIGHT - 0.014) / 2;
  const u0 = pageU(1, index * LEAF_WIDTH);
  const u1 = pageU(1, (index + 1) * LEAF_WIDTH);
  const v0 = pageV(-top);
  const v1 = pageV(top);
  const a: [number, number, number] = [0, -top, 0];
  const b: [number, number, number] = [LEAF_WIDTH, -top, 0];
  const c: [number, number, number] = [LEAF_WIDTH, top, 0];
  const d: [number, number, number] = [0, top, 0];
  pushQuad(positions, uvs, [a, b, c, d], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  pushQuad(positions, uvs, [a, d, c, b], [[1 - u0, v0], [1 - u0, v1], [1 - u1, v1], [1 - u1, v0]]);
  return finish(positions, uvs);
}

export function createOpenBook(): THREE.Object3D {
  const book = new THREE.Group();
  book.name = 'open-book';
  const leather = new THREE.MeshStandardMaterial({ color: 0x2e1712 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2c });
  const ribbon = new THREE.MeshStandardMaterial({ color: 0x7c1f1a });
  const pages = new THREE.MeshStandardMaterial({ map: paper() });

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.036, HEIGHT + 0.004, 0.012), leather);
  spine.position.z = 0.005;
  book.add(spine);

  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    half.rotation.y = -side * FOLD;
    half.position.z = 0.01;
    const board = new THREE.Mesh(new THREE.BoxGeometry(WIDTH / 2, HEIGHT, BOARD), leather);
    board.position.set((side * WIDTH) / 4, 0, 0);
    const block = new THREE.Mesh(pageBlock(side), pages);
    block.position.z = BOARD / 2;
    half.add(board, block);
    // Metal corners on the cover, which catch the light from the back and the sides.
    for (const end of [-1, 1]) {
      const corner = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, BOARD + 0.003), brass);
      corner.position.set(side * (WIDTH / 2 - 0.011), end * (HEIGHT / 2 - 0.011), 0);
      half.add(corner);
    }
    book.add(half);
  }

  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.06, 0.002), ribbon);
  mark.position.set(0.004, -HEIGHT / 2 - 0.018, 0.022);
  book.add(mark);

  const hinge = new THREE.Group();
  hinge.position.set(0, 0, 0.022);
  hinge.rotation.y = -FOLD;
  const joints: THREE.Group[] = [];
  let parent: THREE.Object3D = hinge;
  for (let i = 0; i < LEAF_REST.length; i += 1) {
    const joint = new THREE.Group();
    joint.name = 'loose-page';
    if (i > 0) joint.position.x = LEAF_WIDTH;
    joint.rotation.y = -LEAF_REST[i];
    joint.add(new THREE.Mesh(leafStrip(i), pages));
    parent.add(joint);
    parent = joint;
    joints.push(joint);
  }
  book.add(hinge);
  book.userData.loosePage = joints;
  return book;
}

// When the loose page lifts during an attack, as shares of the attack, and how far in radians.
const CAST_START = 0.48;
const CAST_PEAK = 0.6;
const CAST_LIFT = 0.75;
// How much each outer strip trails behind the lift, so that the edge of the leaf arrives last.
const CAST_TRAIL = 0.24;
// The leaf starts to stir as power gathers, well before the release, by this share of the full lift.
const GATHER_FROM = 0.05;
const GATHER_LIFT = 0.45;
const GLOW_GONE_FROM = 0.7;
const GLOW_PAGES = 1.1;

// One additive plane per book, sharing all of this, since the look only changes by how big it is.
let glowGeometry: THREE.PlaneGeometry | null = null;
let glowMaterial: THREE.MeshBasicMaterial | null = null;

function makeGlow(): THREE.Mesh {
  if (!glowGeometry || !glowMaterial) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const fall = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    fall.addColorStop(0, 'rgba(255,240,200,1)');
    fall.addColorStop(0.3, 'rgba(255,190,90,0.65)');
    fall.addColorStop(0.65, 'rgba(70,130,255,0.32)');
    fall.addColorStop(1, 'rgba(40,80,255,0)');
    ctx.fillStyle = fall;
    ctx.fillRect(0, 0, 64, 64);
    glowGeometry = new THREE.PlaneGeometry(WIDTH * 1.9, WIDTH * 1.9);
    glowMaterial = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }
  const mesh = new THREE.Mesh(glowGeometry, glowMaterial);
  mesh.position.z = 0.05;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

interface BookGlow {
  mesh: THREE.Mesh;
  /** The book's own materials and how brightly each normally glows. Read late, as the character replaces them when it picks the book up. */
  pages: { material: THREE.MeshLambertMaterial; base: number }[];
}

function bookGlow(book: THREE.Object3D): BookGlow {
  const existing = book.userData.glow as BookGlow | undefined;
  if (existing) return existing;
  const pages: BookGlow['pages'] = [];
  book.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (material?.emissive && !pages.some((page) => page.material === material)) {
      pages.push({ material, base: material.emissiveIntensity });
    }
  });
  const glow: BookGlow = { mesh: makeGlow(), pages };
  book.add(glow.mesh);
  book.userData.glow = glow;
  return glow;
}

/** The loose page stirs a little all the time, and lifts and falls back during a cast. */
export function animateOpenBook(book: THREE.Object3D, clock: number, attackPhase: number): void {
  const joints = book.userData.loosePage as THREE.Object3D[] | undefined;
  if (!joints) return;
  const stir = 0.035 + Math.sin(clock * 1.3) * 0.02 + Math.sin(clock * 3.1) * 0.01;
  // Blown up fast by the release, not before it, and falling back slowly.
  let cast = 0;
  if (attackPhase >= CAST_START) {
    cast = attackPhase < CAST_PEAK ? THREE.MathUtils.smoothstep(attackPhase, CAST_START, CAST_PEAK) : 1 - THREE.MathUtils.smoothstep(attackPhase, CAST_PEAK, 1);
  }
  const casting = attackPhase >= 0;
  const gather = casting ? THREE.MathUtils.smoothstep(attackPhase, GATHER_FROM, CAST_START) : 0;
  const lift = Math.max(cast, casting ? gather * GATHER_LIFT * (1 - THREE.MathUtils.smoothstep(attackPhase, CAST_PEAK, 1)) : 0);
  joints[0].rotation.y = -(LEAF_REST[0] + stir + lift * CAST_LIFT);
  for (let i = 1; i < joints.length; i += 1) joints[i].rotation.y = -(LEAF_REST[i] - lift * CAST_TRAIL);

  // Costs nothing until the first cast, and stays out of the way between them.
  const glowing = casting ? gather * (1 - THREE.MathUtils.smoothstep(attackPhase, GLOW_GONE_FROM, 1)) : 0;
  const existing = book.userData.glow as BookGlow | undefined;
  if (!existing && glowing <= 0) return;
  const glow = existing ?? bookGlow(book);
  glow.mesh.visible = glowing > 0.01;
  glow.mesh.scale.setScalar(0.55 + glowing * (0.75 + Math.sin(clock * 19) * 0.08));
  for (const page of glow.pages) page.material.emissiveIntensity = page.base + glowing * GLOW_PAGES;
}
