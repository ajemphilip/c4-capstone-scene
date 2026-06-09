/* =========================================================
   C4 Capstone — three.js + cannon-es scene
   ---------------------------------------------------------
   A small home at dusk. A table and two chairs in front.
   Two ragdoll figures, alive with physics. Drag a limb to
   pull, click to nudge. The scene sits with you.
   ========================================================= */

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

console.log("[C4 scene] booting — three r" + THREE.REVISION + ", cannon-es loaded");

/* ---------- Capability ---------- */
const canvas = document.getElementById("bg-canvas");
const canvasContainer = canvas.parentElement; // .canvas-wrap
const isSmallViewport = window.matchMedia("(max-width: 768px)").matches;
const isLowGPU = isSmallViewport || (navigator.hardwareConcurrency || 8) <= 4;
const pixelRatio = Math.min(window.devicePixelRatio, isLowGPU ? 1.5 : 2);

function getContainerSize() {
  const r = canvasContainer.getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

/* ---------- Renderer ---------- */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(pixelRatio);
{
  const { w, h } = getContainerSize();
  renderer.setSize(w, h, false);
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !isLowGPU;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

/* ---------- Scene + camera ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2236);
scene.fog = new THREE.Fog(0x141a2a, 12, 36);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(3.8, 2.4, 6.0);
camera.lookAt(0, 1.1, 0);
{
  const { w, h } = getContainerSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ---------- Post-processing (bloom for warm window glow) ---------- */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(pixelRatio);
{
  const { w, h } = getContainerSize();
  composer.setSize(w, h);
}
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(...Object.values(getContainerSize())),
  0.6, 0.7, 0.7
);
composer.addPass(bloomPass);

/* ---------- Lights ---------- */
{
  const hemi = new THREE.HemisphereLight(0x6f88b8, 0x1a1207, 0.55);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0x9fb9e8, 0.6);
  moon.position.set(-8, 12, 6);
  moon.castShadow = !isLowGPU;
  if (moon.castShadow) {
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -10;
    moon.shadow.camera.right = 10;
    moon.shadow.camera.top = 10;
    moon.shadow.camera.bottom = -10;
    moon.shadow.camera.near = 0.5;
    moon.shadow.camera.far = 30;
    moon.shadow.bias = -0.0008;
  }
  scene.add(moon);

  // Warm porch light spilling from the door
  const porch = new THREE.SpotLight(0xffb066, 4.0, 12, Math.PI / 4, 0.45, 1.2);
  porch.position.set(0, 2.6, -1.8);
  porch.target.position.set(0, 0, 1.5);
  scene.add(porch);
  scene.add(porch.target);

  // Tiny warm lantern on the table
  const lantern = new THREE.PointLight(0xffc080, 1.6, 6, 1.6);
  lantern.position.set(0, 1.4, 0);
  scene.add(lantern);
}

/* =========================================================
   Physics world
   ========================================================= */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 14;
world.defaultContactMaterial.contactEquationStiffness = 1e8;
world.defaultContactMaterial.contactEquationRelaxation = 3;

const groundMat = new CANNON.Material("ground");
const bodyMat = new CANNON.Material("body");
const ragdollMat = new CANNON.Material("ragdoll");
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, bodyMat, {
  friction: 0.5, restitution: 0.05,
}));
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, ragdollMat, {
  friction: 0.45, restitution: 0.0,
}));
world.addContactMaterial(new CANNON.ContactMaterial(bodyMat, ragdollMat, {
  friction: 0.35, restitution: 0.0,
}));

/* ---------- Mesh ↔ body sync registry ---------- */
const syncPairs = []; // { body, mesh }
function link(body, mesh) {
  syncPairs.push({ body, mesh });
}

/* =========================================================
   Ground (visual + physics)
   ========================================================= */
{
  const geo = new THREE.PlaneGeometry(60, 60);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1c2334,
    roughness: 0.95,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 0, material: groundMat });
  body.addShape(new CANNON.Plane());
  body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(body);
}

/* =========================================================
   The home (static, behind the table)
   ========================================================= */
function makeHouse() {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a5468, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a3142, roughness: 0.9 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.8 });
  const winMat  = new THREE.MeshStandardMaterial({
    color: 0xffd28a, roughness: 0.4, emissive: 0xff9c4a, emissiveIntensity: 1.3,
  });

  const houseZ = -3.4;
  const houseW = 5.2, houseH = 2.6, houseD = 3.0;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(houseW, houseH, houseD), wallMat);
  walls.position.set(0, houseH / 2, houseZ);
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  // Roof — triangular prism via extrude
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-houseW / 2 - 0.2, 0);
  roofShape.lineTo(houseW / 2 + 0.2, 0);
  roofShape.lineTo(0, 1.4);
  roofShape.lineTo(-houseW / 2 - 0.2, 0);
  const roof = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roofShape, { depth: houseD + 0.4, bevelEnabled: false }),
    trimMat
  );
  roof.position.set(0, houseH, houseZ + (houseD + 0.4) / 2);
  roof.rotation.y = 0;
  roof.castShadow = true;
  // The extrude pushes along +z, so move it back so it centres on the house
  roof.position.z = houseZ - (houseD + 0.4) / 2;
  group.add(roof);

  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.7, 0.08), doorMat);
  door.position.set(0, 0.85, houseZ + houseD / 2 + 0.02);
  group.add(door);

  // Door frame (slightly lighter)
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.85, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x3a4256, roughness: 0.9 })
  );
  frame.position.set(0, 0.92, houseZ + houseD / 2 + 0.01);
  group.add(frame);

  // Windows (left and right of door) — glowing
  for (const x of [-1.6, 1.6]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.05), winMat);
    win.position.set(x, 1.55, houseZ + houseD / 2 + 0.02);
    group.add(win);

    const sash = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.7, 0.06),
      trimMat
    );
    sash.position.copy(win.position);
    group.add(sash);

    const sashH = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.04, 0.06),
      trimMat
    );
    sashH.position.copy(win.position);
    group.add(sashH);
  }

  // Chimney
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 1.0, 0.45),
    trimMat
  );
  chimney.position.set(houseW / 2 - 0.6, houseH + 0.9, houseZ - 0.6);
  chimney.castShadow = true;
  group.add(chimney);

  // Step in front of door
  const step = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.12, 0.5),
    trimMat
  );
  step.position.set(0, 0.06, houseZ + houseD / 2 + 0.3);
  step.receiveShadow = true;
  group.add(step);

  scene.add(group);

  // Physics: just the wall slab (so balls/limbs can collide with it)
  const houseBody = new CANNON.Body({ mass: 0, material: bodyMat });
  houseBody.addShape(new CANNON.Box(new CANNON.Vec3(houseW / 2, houseH / 2, houseD / 2)));
  houseBody.position.set(0, houseH / 2, houseZ);
  world.addBody(houseBody);
}
makeHouse();

/* =========================================================
   Table + chairs (physics + visual)
   ========================================================= */
function makeBoxBody(size, position, mass, material) {
  const body = new CANNON.Body({
    mass,
    material,
    shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
    position: new CANNON.Vec3(position.x, position.y, position.z),
    linearDamping: 0.2,
    angularDamping: 0.3,
  });
  world.addBody(body);
  return body;
}

function makeBoxMesh(size, color, roughness = 0.7) {
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const wood = 0x6b4a2b;
const woodDark = 0x4a3220;

/* --- Table --- */
{
  const topSize = { x: 1.8, y: 0.08, z: 1.0 };
  const topY = 1.0;
  const top = makeBoxMesh(topSize, wood, 0.65);
  const topBody = makeBoxBody(topSize, { x: 0, y: topY, z: 0 }, 0, bodyMat);
  scene.add(top);
  link(topBody, top);

  // Legs
  const legSize = { x: 0.08, y: topY, z: 0.08 };
  for (const [x, z] of [[-0.78, -0.4], [0.78, -0.4], [-0.78, 0.4], [0.78, 0.4]]) {
    const leg = makeBoxMesh(legSize, woodDark, 0.8);
    const body = makeBoxBody(legSize, { x, y: legSize.y / 2, z }, 0, bodyMat);
    scene.add(leg);
    link(body, leg);
  }

  // Lantern on the table
  const lanternBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.05, 12),
    new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.6 })
  );
  lanternBase.position.set(0, topY + 0.08 / 2 + 0.025, 0);
  scene.add(lanternBase);

  const lanternGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffc080 })
  );
  lanternGlow.position.set(0, topY + 0.25, 0);
  scene.add(lanternGlow);
}

/* --- Chairs (each = seat + back + 4 legs) --- */
function makeChair(centerX, centerZ, rotationY) {
  const group = new THREE.Group();
  const seatY = 0.5;

  // Seat
  const seatSize = { x: 0.55, y: 0.06, z: 0.55 };
  const seat = makeBoxMesh(seatSize, wood, 0.7);
  const seatBody = makeBoxBody(seatSize, { x: 0, y: seatY, z: 0 }, 0, bodyMat);
  group.add(seat);
  link(seatBody, seat);

  // Back
  const backSize = { x: 0.55, y: 0.7, z: 0.06 };
  const back = makeBoxMesh(backSize, wood, 0.7);
  const backBody = makeBoxBody(backSize, { x: 0, y: seatY + backSize.y / 2 + 0.02, z: -0.25 }, 0, bodyMat);
  group.add(back);
  link(backBody, back);

  // Legs
  const legSize = { x: 0.06, y: seatY, z: 0.06 };
  for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
    const leg = makeBoxMesh(legSize, woodDark, 0.8);
    const body = makeBoxBody(legSize, { x, y: legSize.y / 2, z }, 0, bodyMat);
    group.add(leg);
    link(body, leg);
  }

  // Apply rotation + position to all bodies belonging to this chair
  group.position.set(centerX, 0, centerZ);
  group.rotation.y = rotationY;

  // Walk syncPairs we just added and transform their initial body positions.
  // Easier: rebuild bodies at correct world position.
  // For simplicity, throw away the previous static bodies and re-create at world space:
  const startIndex = syncPairs.length - 6; // 1 seat + 1 back + 4 legs
  const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
  for (let i = startIndex; i < syncPairs.length; i++) {
    const { body, mesh } = syncPairs[i];
    const lx = body.position.x, ly = body.position.y, lz = body.position.z;
    const wx = centerX + (cos * lx + sin * lz);
    const wz = centerZ + (-sin * lx + cos * lz);
    body.position.set(wx, ly, wz);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }

  return { x: centerX, z: centerZ, rotationY, seatY };
}

const chairA = makeChair(0, 1.05, Math.PI); // facing -z (toward table from +z side)... actually rotated to face table
const chairB = makeChair(0, -1.05, 0);      // opposite side

/* =========================================================
   Ragdoll factory
   ========================================================= */
function createRagdoll(rootX, rootY, rootZ, facingY, skinColor, clothColor) {
  // Sizes (in metres-ish units)
  const S = {
    headR: 0.13,
    torsoY: 0.42, torsoX: 0.32, torsoZ: 0.18,
    pelvisY: 0.14, pelvisX: 0.30, pelvisZ: 0.18,
    upperArm: 0.32, upperArmW: 0.08,
    lowerArm: 0.30, lowerArmW: 0.07,
    upperLeg: 0.40, upperLegW: 0.11,
    lowerLeg: 0.42, lowerLegW: 0.10,
  };

  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.85 });
  const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.95 });
  const pantMat = new THREE.MeshStandardMaterial({ color: 0x1a1e2a, roughness: 0.95 });

  const parts = {};

  function part(name, shapeArgs, position, material, visualMat = material) {
    let body, geometry;
    if (shapeArgs.type === "sphere") {
      body = new CANNON.Body({
        mass: shapeArgs.mass, material: ragdollMat,
        shape: new CANNON.Sphere(shapeArgs.r),
        position: new CANNON.Vec3(position.x, position.y, position.z),
      });
      geometry = new THREE.SphereGeometry(shapeArgs.r, 16, 16);
    } else {
      body = new CANNON.Body({
        mass: shapeArgs.mass, material: ragdollMat,
        shape: new CANNON.Box(new CANNON.Vec3(shapeArgs.sx, shapeArgs.sy, shapeArgs.sz)),
        position: new CANNON.Vec3(position.x, position.y, position.z),
      });
      geometry = new THREE.BoxGeometry(shapeArgs.sx * 2, shapeArgs.sy * 2, shapeArgs.sz * 2);
    }
    body.linearDamping = 0.5;
    body.angularDamping = 0.65;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.25;
    body.sleepTimeLimit = 1.2;
    world.addBody(body);

    const mesh = new THREE.Mesh(geometry, visualMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    parts[name] = { body, mesh };
    link(body, mesh);
    return parts[name];
  }

  // Start each body in local space (origin at rootX/Y/Z), then rotate by facingY at the end.
  // Approximate "seated" pose: legs forward and down, torso slightly leaned, head over table.
  const baseY = rootY;

  // Pelvis
  part("pelvis",
    { type: "box", mass: 6, sx: S.pelvisX / 2, sy: S.pelvisY / 2, sz: S.pelvisZ / 2 },
    { x: 0, y: baseY, z: 0 },
    ragdollMat, pantMat
  );

  // Upper body (slight forward tilt — physics will settle)
  part("torso",
    { type: "box", mass: 8, sx: S.torsoX / 2, sy: S.torsoY / 2, sz: S.torsoZ / 2 },
    { x: 0, y: baseY + S.torsoY / 2 + 0.06, z: -0.05 },
    ragdollMat, clothMat
  );

  // Head
  part("head",
    { type: "sphere", mass: 2, r: S.headR },
    { x: 0, y: baseY + S.torsoY + 0.06 + S.headR + 0.05, z: -0.05 },
    ragdollMat, skinMat
  );

  // Upper legs (extending forward toward the table)
  for (const side of [-1, 1]) {
    part("upperLeg" + (side < 0 ? "L" : "R"),
      { type: "box", mass: 4, sx: S.upperLegW / 2, sy: S.upperLeg / 2, sz: S.upperLegW / 2 },
      { x: side * 0.09, y: baseY - 0.02, z: S.upperLeg / 2 - 0.04 },
      ragdollMat, pantMat
    );
    // Rotate the upper leg horizontal for sitting
    parts["upperLeg" + (side < 0 ? "L" : "R")].body.quaternion.setFromAxisAngle(
      new CANNON.Vec3(1, 0, 0), Math.PI / 2
    );
  }

  // Lower legs (vertical, going down to ground)
  for (const side of [-1, 1]) {
    part("lowerLeg" + (side < 0 ? "L" : "R"),
      { type: "box", mass: 3, sx: S.lowerLegW / 2, sy: S.lowerLeg / 2, sz: S.lowerLegW / 2 },
      { x: side * 0.09, y: S.lowerLeg / 2, z: S.upperLeg - 0.05 },
      ragdollMat, pantMat
    );
  }

  // Upper arms (hanging at sides initially)
  for (const side of [-1, 1]) {
    part("upperArm" + (side < 0 ? "L" : "R"),
      { type: "box", mass: 2, sx: S.upperArmW / 2, sy: S.upperArm / 2, sz: S.upperArmW / 2 },
      { x: side * (S.torsoX / 2 + S.upperArmW / 2 + 0.01), y: baseY + S.torsoY / 2, z: -0.05 },
      ragdollMat, clothMat
    );
  }

  // Lower arms
  for (const side of [-1, 1]) {
    part("lowerArm" + (side < 0 ? "L" : "R"),
      { type: "box", mass: 1.5, sx: S.lowerArmW / 2, sy: S.lowerArm / 2, sz: S.lowerArmW / 2 },
      { x: side * (S.torsoX / 2 + S.upperArmW / 2 + 0.01), y: baseY + S.torsoY / 2 - S.upperArm, z: -0.05 },
      ragdollMat, skinMat
    );
  }

  /* ---------- Constraints ---------- */
  function cone(a, b, pivotA, pivotB, angle = Math.PI / 4, twistAngle = Math.PI / 8) {
    const c = new CANNON.ConeTwistConstraint(a.body, b.body, {
      pivotA: new CANNON.Vec3(pivotA.x, pivotA.y, pivotA.z),
      pivotB: new CANNON.Vec3(pivotB.x, pivotB.y, pivotB.z),
      axisA: new CANNON.Vec3(0, 1, 0),
      axisB: new CANNON.Vec3(0, 1, 0),
      angle,
      twistAngle,
    });
    c.collideConnected = false;
    world.addConstraint(c);
    return c;
  }

  // Spine (pelvis ↔ torso)
  cone(parts.pelvis, parts.torso,
    { x: 0, y: S.pelvisY / 2, z: 0 },
    { x: 0, y: -S.torsoY / 2, z: 0 },
    Math.PI / 5, Math.PI / 8
  );

  // Neck (torso ↔ head)
  cone(parts.torso, parts.head,
    { x: 0, y: S.torsoY / 2, z: 0 },
    { x: 0, y: -S.headR, z: 0 },
    Math.PI / 4, Math.PI / 6
  );

  // Shoulders
  for (const side of ["L", "R"]) {
    const sign = side === "L" ? -1 : 1;
    cone(parts.torso, parts["upperArm" + side],
      { x: sign * S.torsoX / 2, y: S.torsoY / 2 - 0.04, z: 0 },
      { x: 0, y: S.upperArm / 2, z: 0 },
      Math.PI / 2.5, Math.PI / 4
    );
    // Elbow
    cone(parts["upperArm" + side], parts["lowerArm" + side],
      { x: 0, y: -S.upperArm / 2, z: 0 },
      { x: 0, y: S.lowerArm / 2, z: 0 },
      Math.PI / 4, 0
    );
  }

  // Hips
  for (const side of ["L", "R"]) {
    const sign = side === "L" ? -1 : 1;
    cone(parts.pelvis, parts["upperLeg" + side],
      { x: sign * 0.09, y: -S.pelvisY / 2, z: 0 },
      { x: 0, y: S.upperLeg / 2, z: 0 },
      Math.PI / 3, Math.PI / 8
    );
    // Knee
    cone(parts["upperLeg" + side], parts["lowerLeg" + side],
      { x: 0, y: -S.upperLeg / 2, z: 0 },
      { x: 0, y: S.lowerLeg / 2, z: 0 },
      Math.PI / 6, 0
    );
  }

  // Rotate everything around the root by facingY
  const q = new CANNON.Quaternion();
  q.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), facingY);
  const cos = Math.cos(facingY), sin = Math.sin(facingY);
  for (const name in parts) {
    const b = parts[name].body;
    const px = b.position.x, pz = b.position.z;
    const wx = rootX + (cos * px + sin * pz);
    const wz = rootZ + (-sin * px + cos * pz);
    b.position.x = wx;
    b.position.z = wz;
    const newQ = new CANNON.Quaternion();
    q.mult(b.quaternion, newQ);
    b.quaternion.copy(newQ);
    // sync mesh once so first frame isn't at origin
    parts[name].mesh.position.copy(b.position);
    parts[name].mesh.quaternion.copy(b.quaternion);
  }

  return parts;
}

const ragdollA = createRagdoll(0,    1.08, 1.05, Math.PI,     0xd4a373, 0x4a3a5a);
const ragdollB = createRagdoll(0,    1.08, -1.05, 0,           0xc89c7a, 0x3a4a5c);

/* =========================================================
   Pointer drag — apply impulses to ragdoll bodies
   ========================================================= */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const dragTarget = new THREE.Vector3();

let dragBody = null;
let dragOffset = new CANNON.Vec3();
let dragPoint = new THREE.Vector3();

function updateNDC(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
}

function pickRagdollBody() {
  raycaster.setFromCamera(ndc, camera);
  const meshes = syncPairs.map(p => p.mesh).filter(m => m.material && m.userData);
  // Build a fresh list of ragdoll meshes
  const ragdollMeshes = [];
  for (const pair of syncPairs) {
    if (pair.body.material === ragdollMat) ragdollMeshes.push(pair.mesh);
  }
  const hits = raycaster.intersectObjects(ragdollMeshes, false);
  if (!hits.length) return null;
  const mesh = hits[0].object;
  const found = syncPairs.find(p => p.mesh === mesh);
  return { body: found.body, point: hits[0].point.clone() };
}

window.addEventListener("pointerdown", (e) => {
  const t = e.target;
  if (t && t.closest && t.closest("a, button, nav, header, .project-card")) return;
  updateNDC(e);
  const pick = pickRagdollBody();
  if (!pick) return;
  dragBody = pick.body;
  dragBody.wakeUp();
  // Apply a strong upward impulse on the picked body — playful poke.
  const impulse = new CANNON.Vec3(
    (Math.random() - 0.5) * 4,
    3.5,
    (Math.random() - 0.5) * 4
  );
  const point = new CANNON.Vec3(pick.point.x, pick.point.y, pick.point.z);
  dragBody.applyImpulse(impulse, point);
});

window.addEventListener("pointermove", (e) => {
  if (!dragBody) return;
  updateNDC(e);
  raycaster.setFromCamera(ndc, camera);
  raycaster.ray.intersectPlane(dragPlane, dragTarget);
  // Apply a soft force toward the cursor target — feels like dragging.
  const dx = dragTarget.x - dragBody.position.x;
  const dy = dragTarget.y - dragBody.position.y;
  const force = new CANNON.Vec3(dx * 60, dy * 60, 0);
  dragBody.applyForce(force, dragBody.position);
});

window.addEventListener("pointerup", () => { dragBody = null; });
window.addEventListener("pointercancel", () => { dragBody = null; });

/* =========================================================
   Resize — watch the canvas container, not the window
   ========================================================= */
function onResize() {
  const { w, h } = getContainerSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
}
window.addEventListener("resize", onResize);
if ("ResizeObserver" in window) {
  new ResizeObserver(onResize).observe(canvasContainer);
}

/* =========================================================
   Animation loop
   ========================================================= */
const clock = new THREE.Clock();
const fixedStep = 1 / 60;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  world.step(fixedStep, dt, 4);

  for (const { body, mesh } of syncPairs) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }

  composer.render();
  requestAnimationFrame(animate);
}
animate();
