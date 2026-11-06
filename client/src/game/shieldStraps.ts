import * as THREE from 'three';

/*
 * What a hand holds on the back of a shield: an iron grip for the fist and a leather strap for the
 * forearm. The shield model has neither, so they're built here. Measured from the palm, where +X runs
 * toward the board, +Y along the thumb, and +Z along the fingers. The character's adopt step swaps these
 * materials for its own, so these only say what each part is made of.
 */

/** Where the back of the board is, a little inside it so that no gap shows. */
const BOARD_X = 0.11;
const GRIP_HALF_LENGTH = 0.072;
/** Where the loop sits along the forearm from the palm, and its middle, which is where the arm passes. */
const STRAP_Z = -0.16;
const STRAP_X = -0.015;
const STRAP_RADIUS = 0.07;
const STRAP_BAND = 0.018;

function part(
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...at);
  return mesh;
}

export function createShieldStraps(adopt: (mesh: THREE.Mesh) => void): THREE.Group {
  const iron = new THREE.MeshStandardMaterial({ color: 0x4b4d52 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2415 });
  const group = new THREE.Group();

  // The fist closes on the bar, and the two arms carry it past the thumb and little finger to the board.
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, GRIP_HALF_LENGTH * 2 + 0.012, 8), iron);
  group.add(bar);
  for (const side of [-1, 1]) {
    group.add(part([BOARD_X + 0.012, 0.012, 0.022], [BOARD_X / 2, side * GRIP_HALF_LENGTH, 0], iron));
  }

  // A loop of leather around the forearm, with wide enough a gap for the arm to shift, riveted to the board.
  const loop = new THREE.Mesh(new THREE.TorusGeometry(STRAP_RADIUS, 0.009, 4, 12), leather);
  loop.scale.z = STRAP_BAND / 0.009;
  loop.position.set(STRAP_X, 0, STRAP_Z);
  group.add(loop);
  const near = STRAP_X + STRAP_RADIUS;
  group.add(part([BOARD_X - near, 0.06, 0.036], [(BOARD_X + near) / 2, 0, STRAP_Z], leather));
  group.add(part([0.012, 0.1, 0.05], [BOARD_X - 0.03, 0, STRAP_Z], iron));

  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) adopt(child as THREE.Mesh);
  });
  return group;
}
