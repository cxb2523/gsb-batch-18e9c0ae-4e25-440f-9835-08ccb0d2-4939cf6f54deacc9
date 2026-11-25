import * as THREE from 'three';

// Low-poly procedural characters. Local +Z is "forward".
// Scope-only markers live on layer 1 (the camera enables it while scoped).
export const SCOPE_LAYER = 1;

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    // slight self-illumination keeps backlit figures readable against dark facades at sunset
    matCache.set(key, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.85, metalness: 0.05, ...opts }));
  }
  return matCache.get(key);
}
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

const CIV_LOOKS = [
  { shirt: '#d9d3c5', pants: '#3f5878', skin: '#c89a78', hair: '#3a281c', prop: 'phone' },
  { shirt: '#8fb0c9', pants: '#5a5048', skin: '#9c6e4f', hair: '#1c1714', prop: 'bag' },
];

export function createHumanoid(kind, variant = 0) {
  const hostile = kind === 'hostile';
  const root = new THREE.Group();
  const body = new THREE.Group(); // rotates when falling
  root.add(body);
  const look = hostile
    ? { shirt: '#5c5d42', pants: '#3b3b35', skin: '#2a2724', hair: '#1d1d1c' }
    : CIV_LOOKS[variant % CIV_LOOKS.length];

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  body.add(hips);

  const legGeo = new THREE.BoxGeometry(0.16, 0.9, 0.18);
  legGeo.translate(0, -0.45, 0);
  const legL = mesh(legGeo, mat(look.pants), -0.1, 0, 0);
  const legR = mesh(legGeo, mat(look.pants), 0.1, 0, 0);
  hips.add(legL, legR);
  const bootGeo = new THREE.BoxGeometry(0.17, 0.1, 0.27);
  for (const leg of [legL, legR]) leg.add(mesh(bootGeo, mat(hostile ? '#161615' : '#4a3a2e'), 0, -0.86, 0.04));

  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(mesh(new THREE.BoxGeometry(0.42, 0.62, 0.24), mat(look.shirt), 0, 0.31, 0));
  const head = new THREE.Group();
  head.position.y = 0.74;
  torso.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.115, 12, 10), mat(look.skin), 0, 0, 0));
  head.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), mat(look.skin), 0, -0.13, 0));

  const armGeo = new THREE.BoxGeometry(0.1, 0.62, 0.11);
  armGeo.translate(0, -0.31, 0);
  const armL = mesh(armGeo, mat(look.shirt), -0.27, 0.58, 0);
  const armR = mesh(armGeo, mat(look.shirt), 0.27, 0.58, 0);
  torso.add(armL, armR);
  const handGeo = new THREE.BoxGeometry(0.08, 0.1, 0.09);
  armL.add(mesh(handGeo, mat(hostile ? '#1e1e1c' : look.skin), 0, -0.66, 0));
  armR.add(mesh(handGeo, mat(hostile ? '#1e1e1c' : look.skin), 0, -0.66, 0));

  let marker = null;
  let rifle = null;
  if (hostile) {
    // plate carrier + pouches
    const vest = mat('#4a4935');
    torso.add(mesh(new THREE.BoxGeometry(0.47, 0.44, 0.31), vest, 0, 0.33, 0));
    for (const px of [-0.13, 0, 0.13]) torso.add(mesh(new THREE.BoxGeometry(0.1, 0.12, 0.06), mat('#585640'), px, 0.22, 0.17));
    // helmet with brim + goggles strap
    head.add(mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#4d4c38'), 0, 0.02, 0));
    head.add(mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), mat('#111'), 0, 0.0, 0.11));
    // backpack radio with whip antenna — distinctive silhouette
    torso.add(mesh(new THREE.BoxGeometry(0.34, 0.4, 0.16), mat('#2a2c25'), 0, 0.36, -0.22));
    torso.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.75, 4), mat('#111'), 0.12, 0.9, -0.24));
    // rifle held across the chest
    rifle = new THREE.Group();
    const gun = mat('#141414', { roughness: 0.5, metalness: 0.5 });
    rifle.add(mesh(new THREE.BoxGeometry(0.06, 0.1, 0.62), gun, 0, 0, 0));
    rifle.add(mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), gun, 0, -0.1, 0.05));
    rifle.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), gun, 0, 0.01, 0.46).rotateX(Math.PI / 2));
    rifle.add(mesh(new THREE.BoxGeometry(0.05, 0.08, 0.2), gun, 0, -0.02, -0.38));
    rifle.position.set(0.05, 0.3, 0.26);
    torso.add(rifle);
    // IR strobe on shoulder: only visible through the scope
    marker = mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ff7a3a', toneMapped: false }),
      -0.22, 0.62, -0.02
    );
    marker.layers.set(SCOPE_LAYER);
    torso.add(marker);
  } else {
    head.add(mesh(new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), mat(look.hair), 0, 0.02, -0.01));
    // collar
    torso.add(mesh(new THREE.BoxGeometry(0.3, 0.05, 0.25), mat('#f1ede4'), 0, 0.6, 0));
    if (look.prop === 'bag') {
      armL.add(mesh(new THREE.BoxGeometry(0.1, 0.3, 0.34), mat('#a8814f'), 0, -0.8, 0));
    } else {
      armR.add(mesh(new THREE.BoxGeometry(0.05, 0.12, 0.02), mat('#1a1a1a'), 0, -0.68, 0.06));
    }
  }

  // hitboxes: generous body box + head sphere
  const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.32, 0.5), hitboxMat);
  bodyBox.position.y = 0.72;
  bodyBox.userData.part = 'body';
  body.add(bodyBox);
  const headBox = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), hitboxMat);
  headBox.position.y = 0.74;
  headBox.userData.part = 'head';
  torso.add(headBox);

  const chestPt = new THREE.Object3D();
  chestPt.position.y = 0.33;
  torso.add(chestPt);

  root.scale.setScalar(1.12);
  return {
    root, body, hips, torso, head, legL, legR, armL, armR, rifle, marker,
    hitboxes: [bodyBox, headBox],
    chest: chestPt,
    prop: look.prop,
  };
}

export function createDrone() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shell = mat('#1c1e22', { roughness: 0.4, metalness: 0.6 });
  body.add(mesh(new THREE.BoxGeometry(0.5, 0.16, 0.62), shell));
  body.add(mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), mat('#2a2d33'), 0, 0.12, -0.05));
  const rotors = [];
  const rotorGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.01, 18);
  const rotorMat = new THREE.MeshStandardMaterial({ color: '#777', transparent: true, opacity: 0.35, depthWrite: false });
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
    const arm = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.64), shell, x / 2, 0, z / 2);
    arm.lookAt(x, 0, z);
    body.add(arm);
    body.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), shell, x, 0.06, z));
    const r = mesh(rotorGeo, rotorMat, x, 0.11, z);
    rotors.push(r);
    body.add(r);
  }
  // gimbal camera + payload pod under the belly
  body.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), mat('#0d0d0f'), 0, -0.12, 0.26));
  body.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 0.24), mat('#3b3f33'), 0, -0.16, -0.02));
  // dim amber nav light (always) + scope-only IR strobe
  const nav = mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: '#ffb347', toneMapped: false }), 0, 0.02, 0.32);
  body.add(nav);
  const marker = mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff7a3a', toneMapped: false }), 0, 0.2, -0.05);
  marker.layers.set(SCOPE_LAYER);
  body.add(marker);

  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), hitboxMat);
  hit.userData.part = 'body';
  body.add(hit);
  root.scale.setScalar(2.1);
  return { root, body, rotors, nav, marker, hitboxes: [hit], chest: hit };
}
