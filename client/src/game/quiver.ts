import * as THREE from 'three';

/*
 * What an archer draws from: a stiff leather quiver with a few arrows in it, worn at the right hip with
 * its mouth tipped back so that the arm swings past it. The character file has none, so it's built here.
 * Measured from the mouth of the quiver, where -Y runs down the tube. The character's adopt step swaps
 * these materials for its own, so these only say what each part is made of.
 */

const TUBE_LENGTH = 0.46;
const TOP_RADIUS = 0.05;
const BOTTOM_RADIUS = 0.038;
/** How far the arrows stand out of the mouth. */
const SHAFT_OUT = 0.14;

function part(geometry: THREE.BufferGeometry, material: THREE.Material, at: readonly [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...at);
  return mesh;
}

export function createQuiver(adopt: (mesh: THREE.Mesh) => void): THREE.Group {
  const leather = new THREE.MeshStandardMaterial({ color: 0x3f2815 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x6e4a26 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xa98a60 });
  const feather = new THREE.MeshStandardMaterial({ color: 0xc9c2ae });
  const group = new THREE.Group();

  group.add(part(new THREE.CylinderGeometry(TOP_RADIUS, BOTTOM_RADIUS, TUBE_LENGTH, 7), leather, [0, -TUBE_LENGTH / 2, 0]));
  group.add(part(new THREE.CylinderGeometry(TOP_RADIUS + 0.006, TOP_RADIUS + 0.006, 0.045, 7), trim, [0, -0.025, 0]));
  group.add(part(new THREE.CylinderGeometry(BOTTOM_RADIUS + 0.005, BOTTOM_RADIUS + 0.003, 0.04, 7), trim, [0, -TUBE_LENGTH + 0.02, 0]));

  // A strap from the tube up to the belt, because the tube hangs clear of the leg and would otherwise float.
  const strap = part(new THREE.BoxGeometry(0.17, 0.035, 0.008), leather, [0.07, -0.07, 0.07]);
  strap.rotation.y = -Math.PI / 4;
  group.add(strap);

  // Feathers are two crossed flat cards, the cheapest thing that still reads as fletching from any side.
  const places: readonly (readonly [number, number])[] = [[0.018, 0.016], [-0.02, 0.012], [0.002, -0.022]];
  places.forEach(([x, z], index) => {
    const out = SHAFT_OUT - index * 0.015;
    group.add(part(new THREE.CylinderGeometry(0.0065, 0.0065, out + 0.04, 5), wood, [x, (out - 0.04) / 2, z]));
    for (const turn of [0, Math.PI / 2]) {
      const card = part(new THREE.BoxGeometry(0.038, 0.075, 0.003), feather, [x, out - 0.045, z]);
      card.rotation.y = turn;
      group.add(card);
    }
  });

  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) adopt(child as THREE.Mesh);
  });
  return group;
}
