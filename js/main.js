/* =========================================================
   C4 Capstone — React Three Fiber app
   ---------------------------------------------------------
   Drag pattern lifted from pmndrs/examples/ragdoll-physics:
   a kinematic Cursor body follows the pointer on a plane
   through the scene focal point; every ragdoll part owns a
   disabled PointToPointConstraint to it, enabled on grab.
   ========================================================= */

import React, {
  useState, useRef, useEffect, useMemo, useCallback,
  useContext, createContext,
} from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Instances, Instance } from "@react-three/drei";
import {
  Physics, useBox, useSphere, usePlane,
  useConeTwistConstraint, usePointToPointConstraint,
} from "@react-three/cannon";
import { EffectComposer, Bloom, Vignette, LUT, DepthOfField } from "@react-three/postprocessing";
import * as THREE from "three";
import htm from "htm";

console.log("[C4] R3F app booting — pmndrs ragdoll pattern");
const html = htm.bind(React.createElement);

/* =========================================================
   Helpers
   ========================================================= */
function xform(localPos, localEuler, origin, facing) {
  const cos = Math.cos(facing), sin = Math.sin(facing);
  const position = [
    origin[0] + cos * localPos[0] + sin * localPos[2],
    localPos[1],
    origin[2] - sin * localPos[0] + cos * localPos[2],
  ];
  const localQ = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(localEuler[0], localEuler[1], localEuler[2], "XYZ")
  );
  const facingQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), facing
  );
  const worldQ = facingQ.multiply(localQ);
  return { position, quaternion: [worldQ.x, worldQ.y, worldQ.z, worldQ.w] };
}

/* =========================================================
   Cursor — kinematic body following the pointer (mouse joint target)
   ========================================================= */
const CursorContext = createContext(null);
const DragContext = createContext(() => {});
const AddTentContext = createContext(() => {});

function CursorProvider({ children }) {
  const ref = useRef();
  const [, api] = useSphere(
    () => ({
      type: "Kinematic",
      args: [0.05],
      collisionFilterMask: 0,
      position: [0, 1.2, 0],
    }),
    ref
  );

  const plane = useMemo(() => new THREE.Plane(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const focal = useMemo(() => new THREE.Vector3(0, 1.2, 0), []);

  useFrame(({ camera, raycaster, pointer }) => {
    camera.getWorldDirection(camDir);
    camDir.negate();
    plane.setFromNormalAndCoplanarPoint(camDir, focal);
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.intersectPlane(plane, target);
    api.position.set(target.x, target.y, target.z);
  });

  return html`
    <${CursorContext.Provider} value=${ref}>
      <mesh ref=${ref} visible=${false}>
        <sphereGeometry args=${[0.05, 8, 8]} />
      </mesh>
      ${children}
    </${CursorContext.Provider}>
  `;
}

/* =========================================================
   Ground
   ========================================================= */
/* Hilly terrain — flat plateau at the city, rolling hills + a few mountain
   peaks further out. Physics body stays a flat plane so the ragdolls don't
   fall through. */
const MOUNTAINS = [
  { x:  60, z:  45, h: 12, r: 22 },
  { x: -65, z:  55, h: 14, r: 28 },
  { x:  55, z: -65, h: 11, r: 24 },
  { x: -60, z: -50, h: 12, r: 26 },
  { x:  90, z:   0, h: 13, r: 28 },
  { x: -20, z:  85, h: 10, r: 20 },
  { x:  30, z:  95, h:  9, r: 18 },
];

function hillHeight(x, z) {
  const d = Math.sqrt(x * x + z * z);
  /* Flat valley floor inside r=42 — covers the building grid, the
     perimeter loop INCLUDING its corners (r≈31.6), the sidewalk ring,
     and the four gate monuments (r≤34) with a green apron before the
     hills start. Prevents terrain from rising against the road. */
  if (d <= 42) return 0;
  const wallT = Math.min(1, (d - 42) / 86);
  const wall = wallT * wallT * (3 - 2 * wallT) * 16;
  const fade = Math.min(1, (d - 42) / 12);
  let h =
    Math.sin(x * 0.04)              * 2.8 +
    Math.cos(z * 0.035)             * 2.2 +
    Math.sin((x + z * 0.7) * 0.025) * 1.6 +
    Math.cos((x * 0.6 - z) * 0.03)  * 1.2;
  h *= fade;
  for (const p of MOUNTAINS) {
    const dx = x - p.x, dz = z - p.z;
    const r2 = dx * dx + dz * dz;
    h += p.h * Math.exp(-r2 / (p.r * p.r));
  }
  // Horizon erosion: past ~170m the terrain rolls downward, so the far
  // edge sinks beneath the fog band instead of silhouetting the horizon.
  const roll = Math.max(0, d - 170);
  return wall + h - roll * roll * 0.0016;
}

function Ground() {
  const [ref] = usePlane(() => ({
    rotation: [-Math.PI / 2, 0, 0],
    type: "Static",
  }));
  const addTent = useContext(AddTentContext);
  const hillyGeo = useMemo(() => {
    // Plane is rotated -π/2 around X, so plane-local Y maps to world -Z.
    // We pass -localY to keep the hillHeight(world_x, world_z) convention
    // that trees / tents / turbines also use — otherwise mountain peaks
    // are mirrored on Z and decorations float above flat ground.
    // 820m wide so the terrain edge sits ≥290m from any allowed camera
    // position — past full-fog distance, so no visible horizon line.
    const g = new THREE.PlaneGeometry(820, 820, 130, 130);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, hillHeight(pos.getX(i), -pos.getY(i)));
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const onClick = (e) => {
    e.stopPropagation();
    if (!e.point) return;
    addTent(e.point.x, e.point.z);
  };
  return html`
    <mesh ref=${ref} receiveShadow onClick=${onClick}>
      <primitive attach="geometry" object=${hillyGeo} />
      <meshStandardMaterial color="#9ab85c" roughness=${0.95} />
    </mesh>
  `;
}

/* =========================================================
   Static box helper
   ========================================================= */
function StaticBox({ args, position, color = "#6b4a2b", roughness = 0.7 }) {
  const [ref] = useBox(() => ({ args, position, type: "Static" }));
  return html`
    <mesh ref=${ref} castShadow receiveShadow>
      <boxGeometry args=${args} />
      <meshStandardMaterial color=${color} roughness=${roughness} />
    </mesh>
  `;
}

/* =========================================================
   House
   ========================================================= */
function House() {
  const houseZ = -3.4;
  const houseH = 2.6;
  const [wallRef] = useBox(() => ({
    args: [5.2, houseH, 3.0],
    position: [0, houseH / 2, houseZ],
    type: "Static",
  }));

  const roofGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-2.8, 0);
    shape.lineTo(2.8, 0);
    shape.lineTo(0, 1.4);
    shape.lineTo(-2.8, 0);
    return new THREE.ExtrudeGeometry(shape, { depth: 3.4, bevelEnabled: false });
  }, []);

  return html`
    <group>
      <mesh ref=${wallRef} castShadow receiveShadow>
        <boxGeometry args=${[5.2, houseH, 3.0]} />
        <meshStandardMaterial color="#4a5468" roughness=${0.85} />
      </mesh>
      <mesh position=${[0, houseH, houseZ - 1.7]} castShadow>
        <primitive attach="geometry" object=${roofGeo} />
        <meshStandardMaterial color="#2a3142" roughness=${0.9} />
      </mesh>
      <mesh position=${[0, 0.85, houseZ + 1.51]} castShadow>
        <boxGeometry args=${[0.85, 1.7, 0.08]} />
        <meshStandardMaterial color="#5a3a26" roughness=${0.8} />
      </mesh>
      ${[-1.6, 1.6].map((x) => html`
        <mesh key=${x} position=${[x, 1.55, houseZ + 1.51]}>
          <boxGeometry args=${[0.9, 0.7, 0.05]} />
          <meshStandardMaterial
            color="#ffd28a" emissive="#ff9c4a"
            emissiveIntensity=${1.3} roughness=${0.4}
          />
        </mesh>
      `)}
      <mesh position=${[2.0, houseH + 0.5, houseZ - 0.6]} castShadow>
        <boxGeometry args=${[0.45, 1.0, 0.45]} />
        <meshStandardMaterial color="#2a3142" roughness=${0.9} />
      </mesh>
      <mesh position=${[0, 0.06, houseZ + 1.8]} receiveShadow>
        <boxGeometry args=${[1.4, 0.12, 0.5]} />
        <meshStandardMaterial color="#2a3142" roughness=${0.9} />
      </mesh>
    </group>
  `;
}

/* =========================================================
   Table (short, intimate — for the dialogue scene)
   ========================================================= */
function Table() {
  const topY = 1.0;
  return html`
    <group>
      <${StaticBox} args=${[1.8, 0.08, 1.0]} position=${[0, topY, 0]} color="#6b4a2b" />
      ${[[-0.78, -0.4], [0.78, -0.4], [-0.78, 0.4], [0.78, 0.4]].map(([x, z], i) => html`
        <${StaticBox} key=${i} args=${[0.08, topY, 0.08]}
          position=${[x, topY / 2, z]} color="#4a3220" roughness=${0.8} />
      `)}
      <mesh position=${[0, topY + 0.07, 0]}>
        <cylinderGeometry args=${[0.08, 0.10, 0.05, 12]} />
        <meshStandardMaterial color="#222428" roughness=${0.6} />
      </mesh>
      <mesh position=${[0, topY + 0.25, 0]} castShadow>
        <sphereGeometry args=${[0.16, 16, 16]} />
        <meshStandardMaterial color="#a8c098" roughness=${0.7} />
      </mesh>
    </group>
  `;
}

/* =========================================================
   City — large pastel skyline in three concentric rings
   ========================================================= */
/* Cheerful gelato palette — warm corals, sunny yellows, sky blues,
   mints, lavenders. A few warm whites mixed in so the saturation
   doesn't tip into chaos. */
const BUILDING_COLORS = [
  // Coral / peach / salmon
  "#ff9a8b", "#ff8b6f", "#ffaa80", "#e87b5a", "#ffc09f",
  // Sunny yellow / gold / amber
  "#f5c542", "#ffd968", "#ffb84d", "#ffdf80",
  // Sky / teal / aqua
  "#5ec5e8", "#3aa8c4", "#7ed4e0", "#6fc7d8",
  // Mint / sage / soft green
  "#88d4a0", "#a8e0a0", "#9ed896",
  // Lavender / pink / berry
  "#c89bd8", "#e8a2c4", "#d6a8e8",
  // Warm cream / off-white anchors
  "#fef3e1", "#f8e8d2",
];
function buildingColor() {
  return BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)];
}

/* Downtown grid — buildings on a roughly rectangular block layout,
   not a ring. The plaza at the origin stays clear so the table fits.
   One specific cell is reserved for the Food Bank. */
const BUILDINGS = [];
const GRID_COLS = 9, GRID_ROWS = 6;
const CELL_W = 5.8, CELL_D = 5.8;
const LIBRARY_CELL      = { col: 5, row: 1 };
const LIBRARY = {
  x: (LIBRARY_CELL.col - (GRID_COLS - 1) / 2) * CELL_W,
  z: (LIBRARY_CELL.row - (GRID_ROWS - 1) / 2) * CELL_D,
};

/* Shelter + Food Bank flank the south gate on the road's inner edge —
   the two community services and the Connection monument share the most
   visible side of the city. */
const FOODBANK_POS = { x: -11.6, z: 13.8 };
const SHELTER      = { x:  11.6, z: 13.8 };

/* The four monuments stand INSIDE the city at the midpoint of each side,
   pressed against the inner edge of the perimeter road — visible from the
   streets and framed by the city around them.
   Loop road inner edges: x=±24.8, z=±16.8. Plinth radius = 2.8 × 1.6 ≈ 4.5. */
const FOOD_BANK     = { x: 0,     z:  12.3 };  // South edge → ConnectionSculpture
const THRESHOLD     = { x: 0,     z: -12.3 };  // North edge → ThresholdSculpture
const AFFORDABILITY = { x: -20.3, z:  0    };  // West edge  → AffordabilitySculpture
const TRANSITION    = { x: 20.3,  z:  0    };  // East edge  → TransitionSculpture

const SCULPT_SCALE = 1.6;

/* Hard-collision data for the flock: monument centers + keep-out radius. */
const SCULPT_CENTERS = [FOOD_BANK, THRESHOLD, AFFORDABILITY, TRANSITION];
const SCULPT_RADIUS = 5.4;   // plinth (2.8 × 1.6) + walking margin

/* Clear every grid cell whose center falls inside a monument plaza or a
   civic-building footprint so towers never crowd them. */
const SCULPT_CLEAR = new Set();
{
  const keepOuts = [
    ...SCULPT_CENTERS.map((p) => ({ p, r: 6.4 })),
    { p: FOODBANK_POS, r: 6.0 },
    { p: SHELTER, r: 6.0 },
  ];
  for (let col = 0; col < GRID_COLS; col++) {
    for (let row = 0; row < GRID_ROWS; row++) {
      const cx = (col - (GRID_COLS - 1) / 2) * CELL_W;
      const cz = (row - (GRID_ROWS - 1) / 2) * CELL_D;
      for (const k of keepOuts) {
        if (Math.hypot(cx - k.p.x, cz - k.p.z) < k.r) {
          SCULPT_CLEAR.add(col * 100 + row);
          break;
        }
      }
    }
  }
}

/* Pick a handful of grid cells to become city parks instead of buildings. */
const PARK_CELLS = new Set();
{
  let tries = 0;
  while (PARK_CELLS.size < 7 && tries < 200) {
    tries++;
    const col = Math.floor(Math.random() * GRID_COLS);
    const row = Math.floor(Math.random() * GRID_ROWS);
    if (SCULPT_CLEAR.has(col * 100 + row)) continue;
    if (col === LIBRARY_CELL.col && row === LIBRARY_CELL.row) continue;
    const cx = (col - (GRID_COLS - 1) / 2) * CELL_W;
    const cz = (row - (GRID_ROWS - 1) / 2) * CELL_D;
    if (Math.abs(cx) < 5.5 && Math.abs(cz) < 5.5) continue;
    PARK_CELLS.add(col * 100 + row);
  }
}
const PARKS = [];
for (const key of PARK_CELLS) {
  const col = Math.floor(key / 100);
  const row = key % 100;
  PARKS.push({
    x: (col - (GRID_COLS - 1) / 2) * CELL_W,
    z: (row - (GRID_ROWS - 1) / 2) * CELL_D,
  });
}

for (let col = 0; col < GRID_COLS; col++) {
  for (let row = 0; row < GRID_ROWS; row++) {
    if (SCULPT_CLEAR.has(col * 100 + row)) continue;
    if (col === LIBRARY_CELL.col   && row === LIBRARY_CELL.row) continue;
    if (PARK_CELLS.has(col * 100 + row)) continue;
    const cx = (col - (GRID_COLS - 1) / 2) * CELL_W + (Math.random() - 0.5) * 0.9;
    const cz = (row - (GRID_ROWS - 1) / 2) * CELL_D + (Math.random() - 0.5) * 0.9;
    if (Math.abs(cx) < 5.5 && Math.abs(cz) < 5.5) continue;   // open plaza
    if (Math.random() < 0.16) continue;                    // empty lots
    const bColor = buildingColor();
    const w = 2.6 + Math.random() * 0.9;
    const h = 3.2 + Math.random() * 6.5;
    const d = 2.6 + Math.random() * 0.9;
    // Shape variety: ~12% cylindrical towers; tall boxes may get a
    // setback second tier (classic stepped urban silhouette).
    const shape = Math.random() < 0.12 ? "cyl" : "box";
    const t2 = shape === "box" && h > 5.6 && Math.random() < 0.45
      ? { w: w * 0.62, d: d * 0.62, h: 1.5 + Math.random() * 1.5 }
      : null;
    BUILDINGS.push({
      x: cx,
      z: cz,
      w, h, d,
      ry: 0,
      shape,
      t2,
      color: bColor,
      // Derived trim colors for the roof cap + ground-floor band
      roofColor: "#" + new THREE.Color(bColor).multiplyScalar(0.72).getHexString(),
      baseColor: "#" + new THREE.Color(bColor).multiplyScalar(0.86).getHexString(),
      groundY: hillHeight(cx, cz),
    });
  }
}

/* Shape-filtered views + rooftop detail layers. */
const BOX_BLDGS = BUILDINGS.filter((b) => b.shape === "box");
const CYL_BLDGS = BUILDINGS.filter((b) => b.shape === "cyl");
const TIERED_BLDGS = BOX_BLDGS.filter((b) => b.t2);

/* Rooftop clutter — AC units, water tanks (box buildings only; tiered
   buildings put their gear on the upper tier). */
const ROOF_UNITS = [];
const ROOF_TANKS = [];
for (const b of BOX_BLDGS) {
  const tw = b.t2 ? b.t2.w : b.w;
  const td = b.t2 ? b.t2.d : b.d;
  const topY = b.groundY + b.h + (b.t2 ? b.t2.h : 0);
  if (Math.random() < 0.55) {
    ROOF_UNITS.push({
      x: b.x + (Math.random() - 0.5) * tw * 0.45,
      z: b.z + (Math.random() - 0.5) * td * 0.45,
      y: topY + 0.16,
      s: 0.5 + Math.random() * 0.5,
      ry: Math.random() * Math.PI,
    });
  }
  if (Math.random() < 0.30) {
    ROOF_TANKS.push({
      x: b.x + (Math.random() - 0.5) * tw * 0.4,
      z: b.z + (Math.random() - 0.5) * td * 0.4,
      y: topY + 0.45,
      s: 0.7 + Math.random() * 0.5,
    });
  }
}

/* Rooftop parapet railings — thin frame around ~40% of box roofs. */
const ROOF_RAILS = [];
for (const b of BOX_BLDGS) {
  if (Math.random() > 0.4) continue;
  const tw = (b.t2 ? b.t2.w : b.w) + 0.06;
  const td = (b.t2 ? b.t2.d : b.d) + 0.06;
  const railY = b.groundY + b.h + (b.t2 ? b.t2.h : 0) + 0.18 + 0.10;
  ROOF_RAILS.push({ x: b.x, z: b.z + td / 2, y: railY, len: tw, ry: 0 });
  ROOF_RAILS.push({ x: b.x, z: b.z - td / 2, y: railY, len: tw, ry: 0 });
  ROOF_RAILS.push({ x: b.x + tw / 2, z: b.z, y: railY, len: td, ry: Math.PI / 2 });
  ROOF_RAILS.push({ x: b.x - tw / 2, z: b.z, y: railY, len: td, ry: Math.PI / 2 });
}

/* Cylindrical towers get horizontal floor bands instead of windows. */
const CYL_BANDS = [];
for (const b of CYL_BLDGS) {
  const floors = Math.floor(b.h / 1.2);
  for (let f = 1; f <= floors; f++) {
    CYL_BANDS.push({
      x: b.x, z: b.z,
      y: b.groundY + f * 1.2 - 0.25,
      w: b.w + 0.06,
      color: b.roofColor,
    });
  }
}

/* Pre-compute window positions on all 4 faces of every building.
   Two pools: dark glass and lit (emissive). */
const BUILDING_WINDOWS_DARK = [];
const BUILDING_WINDOWS_LIT  = [];
const BUILDING_WINDOWS_DUSK = [];   // dark glass by day, light up at dusk
const WIN_W = 0.34, WIN_H = 0.50;
for (const b of BUILDINGS) {
  if (b.shape === "cyl") continue;   // round towers use floor bands instead
  const floors  = Math.max(1, Math.floor(b.h / 0.95));
  const colsW   = Math.max(2, Math.floor(b.w / 0.62));
  const colsD   = Math.max(2, Math.floor(b.d / 0.62));
  const faces = [
    { axis: "z", sign:  1, ry: 0,            cols: colsW, range: b.w, offset: b.d / 2 + 0.025 },
    { axis: "z", sign: -1, ry: Math.PI,      cols: colsW, range: b.w, offset: b.d / 2 + 0.025 },
    { axis: "x", sign: -1, ry: -Math.PI / 2, cols: colsD, range: b.d, offset: b.w / 2 + 0.025 },
    { axis: "x", sign:  1, ry:  Math.PI / 2, cols: colsD, range: b.d, offset: b.w / 2 + 0.025 },
  ];
  // All four faces — higher-fidelity buildings read from every angle.
  const usedFaces = faces;
  for (const f of usedFaces) {
    for (let fl = 0; fl < floors; fl++) {
      const wy = 1.0 + fl * 0.95;   // dense grid, first row clears the base band
      if (wy + WIN_H / 2 > b.h - 0.2) break;
      for (let c = 0; c < f.cols; c++) {
        const t = (c + 0.5) / f.cols - 0.5;
        const wx = b.x + t * f.range;
        const wz = b.z + f.sign * f.offset;
        // 12% always lit, +22% come on only at dusk, rest stay dark
        const roll = Math.random();
        const pool = roll < 0.12 ? BUILDING_WINDOWS_LIT
                   : roll < 0.34 ? BUILDING_WINDOWS_DUSK
                   : BUILDING_WINDOWS_DARK;
        pool.push({
          pos: [wx, wy + b.groundY, wz],
          ry: f.ry,
        });
      }
    }
  }
}
if (BUILDING_WINDOWS_LIT.length === 0 && BUILDING_WINDOWS_DARK.length > 0) {
  BUILDING_WINDOWS_LIT.push(BUILDING_WINDOWS_DARK.pop());
}

function BuildingDetails() {
  // The lit materials register into CYCLE_REFS — the DayCycle controller
  // drives their emissive intensity/color continuously with time of day.
  return html`
    <group>
      <${Instances} limit=${Math.max(1, BUILDING_WINDOWS_DARK.length)}>
        <planeGeometry args=${[WIN_W, WIN_H]} />
        <meshStandardMaterial color="#1a2030" roughness=${0.35} metalness=${0.1} />
        ${BUILDING_WINDOWS_DARK.map((w, i) => html`
          <${Instance} key=${i} position=${w.pos} rotation=${[0, w.ry, 0]} />
        `)}
      </${Instances}>
      <!-- Always-lit windows — burn brighter once the sun drops -->
      <${Instances} limit=${Math.max(1, BUILDING_WINDOWS_LIT.length)}>
        <planeGeometry args=${[WIN_W, WIN_H]} />
        <meshStandardMaterial
          ref=${(m) => (CYCLE_REFS.litMat = m)}
          color="#ffd28a"
          emissive="#ff9c4a"
          emissiveIntensity=${0.55}
          roughness=${0.45}
          toneMapped=${false}
        />
        ${BUILDING_WINDOWS_LIT.map((w, i) => html`
          <${Instance} key=${i} position=${w.pos} rotation=${[0, w.ry, 0]} />
        `)}
      </${Instances}>
      <!-- Dusk/night windows — dark glass by day, light up after sunset -->
      <${Instances} limit=${Math.max(1, BUILDING_WINDOWS_DUSK.length)}>
        <planeGeometry args=${[WIN_W, WIN_H]} />
        <meshStandardMaterial
          ref=${(m) => (CYCLE_REFS.duskMat = m)}
          color="#161c2a"
          emissive="#000000"
          emissiveIntensity=${0}
          roughness=${0.4}
          toneMapped=${false}
        />
        ${BUILDING_WINDOWS_DUSK.map((w, i) => html`
          <${Instance} key=${i} position=${w.pos} rotation=${[0, w.ry, 0]} />
        `)}
      </${Instances}>
    </group>
  `;
}

/* Canvas-textured signage — no font-loading dependency. */
function _signTexture(label, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "900 180px Poppins, Arial Black, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 10);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
const FOODBANK_SIGN_TEX = _signTexture("FOODBANK", "#e23030");
const SHELTER_SIGN_TEX  = _signTexture("SHELTER",  "#2a5878");


/* Tileable "wall of money" texture: dark green base with gold $ glyphs. */
const DOLLAR_WALL_TEX = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#36563a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Subtle horizontal banding so the wall reads as stacked bills
  for (let y = 0; y < canvas.height; y += 32) {
    ctx.fillStyle = (y / 32) % 2 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.03)";
    ctx.fillRect(0, y, canvas.width, 32);
  }
  ctx.fillStyle = "#ecc560";
  ctx.font = "900 130px Arial Black, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cols = 3, rows = 5;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col + 0.5) * (canvas.width / cols);
      const y = (row + 0.5) * (canvas.height / rows);
      ctx.fillText("$", x, y);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
})();

/* =========================================================
   Food Bank + Shelter — small distinctive community buildings
   with sign panels and warm light spilling out the door.
   ========================================================= */
function FoodBank() {
  const x = FOODBANK_POS.x, z = FOODBANK_POS.z;
  return html`
    <group position=${[x, 0, z]}>
      <!-- Main building — taller and chunkier -->
      <mesh position=${[0, 1.75, 0]} castShadow receiveShadow>
        <boxGeometry args=${[4.4, 3.5, 3.4]} />
        <meshStandardMaterial color="#f0a830" roughness=${0.85} />
      </mesh>
      <!-- Roof -->
      <mesh position=${[0, 3.65, 0]} castShadow>
        <boxGeometry args=${[4.7, 0.28, 3.7]} />
        <meshStandardMaterial color="#7a3820" roughness=${0.9} />
      </mesh>
      <!-- White panel backing -->
      <mesh position=${[0, 4.05, 1.71]} castShadow>
        <boxGeometry args=${[3.6, 0.9, 0.06]} />
        <meshStandardMaterial color="#ffffff" roughness=${0.6} />
      </mesh>
      <!-- FOODBANK text rendered from a canvas texture -->
      <mesh position=${[0, 4.05, 1.745]}>
        <planeGeometry args=${[3.4, 0.85]} />
        <meshStandardMaterial
          map=${FOODBANK_SIGN_TEX}
          emissive="#ffffff"
          emissiveMap=${FOODBANK_SIGN_TEX}
          emissiveIntensity=${0.25}
          toneMapped=${false}
          roughness=${0.5}
        />
      </mesh>
      <!-- Wide open door -->
      <mesh position=${[0, 1.3, 1.71]}>
        <planeGeometry args=${[1.4, 2.4]} />
        <meshStandardMaterial color="#5a3a26" />
      </mesh>
      <mesh position=${[0, 1.3, 1.713]}>
        <planeGeometry args=${[1.1, 2.1]} />
        <meshStandardMaterial
          color="#ffd28a"
          emissive="#ff9c4a"
          emissiveIntensity=${1.4}
          toneMapped=${false}
        />
      </mesh>
      <!-- Side windows — bigger and brighter -->
      ${[-1.55, 1.55].map((wx, i) => html`
        <mesh key=${i} position=${[wx, 2.0, 1.72]}>
          <planeGeometry args=${[0.85, 1.0]} />
          <meshStandardMaterial color="#ffd28a" emissive="#ff9c4a"
            emissiveIntensity=${0.8} toneMapped=${false} />
        </mesh>
      `)}
      <!-- Awning above the door -->
      <mesh position=${[0, 2.8, 1.85]} castShadow>
        <boxGeometry args=${[1.8, 0.10, 0.5]} />
        <meshStandardMaterial color="#c8302a" roughness=${0.6} />
      </mesh>
    </group>
  `;
}

function WarmingCenter() {
  const x = LIBRARY.x, z = LIBRARY.z;
  return html`
    <group position=${[x, 0, z]}>
      <mesh position=${[0, 1.15, 0]} castShadow receiveShadow>
        <boxGeometry args=${[3.0, 2.3, 2.4]} />
        <meshStandardMaterial color="#a85838" roughness=${0.85} />
      </mesh>
      <mesh position=${[0, 2.4, 0]} castShadow>
        <boxGeometry args=${[3.2, 0.18, 2.6]} />
        <meshStandardMaterial color="#6a3018" roughness=${0.9} />
      </mesh>
      <!-- White banner -->
      <mesh position=${[0, 2.7, 1.22]}>
        <boxGeometry args=${[1.8, 0.45, 0.04]} />
        <meshStandardMaterial color="#ffffff" roughness=${0.6} />
      </mesh>
      <!-- Book icon (brown cover + light spine) -->
      <mesh position=${[0, 2.7, 1.245]}>
        <boxGeometry args=${[0.36, 0.28, 0.02]} />
        <meshStandardMaterial color="#5a3a1c" toneMapped=${false} />
      </mesh>
      <mesh position=${[0, 2.7, 1.247]}>
        <boxGeometry args=${[0.04, 0.28, 0.022]} />
        <meshStandardMaterial color="#e8e0d0" toneMapped=${false} />
      </mesh>
      <!-- Row of warm windows for community space -->
      ${[-1.0, 0, 1.0].map((wx, i) => html`
        <mesh key=${i} position=${[wx, 1.5, 1.22]}>
          <planeGeometry args=${[0.55, 0.7]} />
          <meshStandardMaterial color="#ffd28a" emissive="#ff9c4a"
            emissiveIntensity=${0.75} toneMapped=${false} />
        </mesh>
      `)}
      <!-- Open door with warm light -->
      <mesh position=${[0, 0.8, 1.21]}>
        <planeGeometry args=${[0.85, 1.45]} />
        <meshStandardMaterial color="#5a3a26" />
      </mesh>
      <mesh position=${[0, 0.8, 1.213]}>
        <planeGeometry args=${[0.65, 1.25]} />
        <meshStandardMaterial color="#ffd28a" emissive="#ff9c4a"
          emissiveIntensity=${1.0} toneMapped=${false} />
      </mesh>
    </group>
  `;
}

/* =========================================================
   Connection Sculpture
   ---------------------------------------------------------
   A meditative piece about linking unhoused individuals to
   their neighbourhood community.

     - A low circular plinth grounds the piece on its lot.
     - A central pillar rises toward a glowing orb — the
       "common light" of community.
     - 8 abstract figures stand around the pillar, alternating
       between cool tones (neighbourhood community) and warm
       tones (unhoused individuals).
     - Each figure is connected to the central orb by a glowing
       thread — every person is tied to the same light.
     - The whole sculpture rotates slowly so all sides see it.
   ========================================================= */
function ConnectionSculpture() {
  const groupRef = useRef();
  useFrame((state, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += Math.min(dt, 0.05) * 0.12;
  });

  const FIG_COUNT = 8;
  const ORB_Y = 5.0;
  const FIG_RADIUS = 1.8;

  // Precompute figure + thread transforms once at mount
  const items = useMemo(() => {
    const arr = [];
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < FIG_COUNT; i++) {
      const angle = (i / FIG_COUNT) * Math.PI * 2;
      const isCommunity = i % 2 === 0;
      const bodyH = isCommunity ? 1.3 : 0.9;
      const fx = Math.cos(angle) * FIG_RADIUS;
      const fz = Math.sin(angle) * FIG_RADIUS;
      const headY = 0.55 + bodyH + 0.18;
      // Thread from orb (0, ORB_Y, 0) → figure head (fx, headY, fz)
      const dx = fx, dy = headY - ORB_Y, dz = fz;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
      const euler = new THREE.Euler().setFromQuaternion(quat);
      arr.push({
        angle,
        isCommunity,
        bodyH,
        x: fx,
        z: fz,
        bodyY: 0.55 + bodyH / 2,
        headPosY: headY,
        threadMid: [fx / 2, (headY + ORB_Y) / 2, fz / 2],
        threadRot: [euler.x, euler.y, euler.z],
        threadLen: length,
        color: isCommunity ? "#a8c8f0" : "#f5b078",
      });
    }
    return arr;
  }, []);

  return html`
    <group ref=${groupRef} position=${[FOOD_BANK.x, 0, FOOD_BANK.z]} scale=${SCULPT_SCALE}
      onClick=${(e) => openGoal(e, "connection")}>
      <!-- Plinth — wide outer ring -->
      <mesh position=${[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args=${[2.5, 2.7, 0.3, 32]} />
        <meshStandardMaterial color="#2a2a2a" roughness=${0.7} metalness=${0.4} />
      </mesh>
      <!-- Inner platform — slightly raised -->
      <mesh position=${[0, 0.42, 0]} castShadow receiveShadow>
        <cylinderGeometry args=${[2.0, 2.15, 0.24, 32]} />
        <meshStandardMaterial color="#3a3a3a" roughness=${0.6} metalness=${0.4} />
      </mesh>

      <!-- Central pillar — tapering up -->
      <mesh position=${[0, 2.6, 0]} castShadow>
        <cylinderGeometry args=${[0.16, 0.32, 4.5, 20]} />
        <meshStandardMaterial
          color="#fff5dc"
          emissive="#ff9c4a"
          emissiveIntensity=${1.0}
          toneMapped=${false}
          metalness=${0.2}
          roughness=${0.4}
        />
      </mesh>

      <!-- Glowing orb of "common light" -->
      <mesh position=${[0, ORB_Y, 0]}>
        <sphereGeometry args=${[0.55, 32, 32]} />
        <meshStandardMaterial
          color="#fff5dc"
          emissive="#ffb066"
          emissiveIntensity=${3.0}
          toneMapped=${false}
        />
      </mesh>
      <pointLight position=${[0, ORB_Y, 0]} color="#ffd28a" intensity=${5} distance=${20} />

      <!-- 8 figures around the pillar — alternating community / individual -->
      ${items.map((it, i) => html`
        <group key=${i}>
          <!-- Body -->
          <mesh position=${[it.x, it.bodyY, it.z]} castShadow>
            <cylinderGeometry args=${[0.20, 0.24, it.bodyH, 16]} />
            <meshStandardMaterial color=${it.color} roughness=${0.7} />
          </mesh>
          <!-- Head -->
          <mesh position=${[it.x, it.headPosY, it.z]} castShadow>
            <sphereGeometry args=${[0.18, 18, 18]} />
            <meshStandardMaterial color=${it.color} roughness=${0.7} />
          </mesh>
          <!-- Glowing thread to the central orb -->
          <mesh position=${it.threadMid} rotation=${it.threadRot}>
            <cylinderGeometry args=${[0.03, 0.03, it.threadLen, 8]} />
            <meshStandardMaterial
              color="#ffd28a"
              emissive="#ff9c4a"
              emissiveIntensity=${1.8}
              toneMapped=${false}
            />
          </mesh>
        </group>
      `)}
    </group>
  `;
}


/* =========================================================
   Affordability Sculpture — static tableau
   ---------------------------------------------------------
   A person on one side. A house on the other. Between them:
   a tall green wall of dollar signs. The composition is
   read left-to-right as the affordability gap made literal.

     Person → [ $ $ $ wall $ $ $ ] → House

   The person looks toward the house with an outstretched
   arm. The wall is opaque and far too tall to see over.
   The house behind it glows warmly through its door, but
   from the person's side it can only be imagined.

   No rotation. Stationary as a monument.
   ========================================================= */
/* =========================================================
   Transition to Independence Sculpture
   ---------------------------------------------------------
   Four steps rising upward. A figure on each step, posed
   progressively more upright — the visible journey from
   being supported to standing on one's own:

     Step 0: hunched, head down
     Step 1: starting to lift, head still slightly bowed
     Step 2: standing, head level
     Step 3: standing tall, arms raised, glowing — independence

   The figures' colors shift cool-gray → soft blue → mint →
   warm gold, mirroring the lift in mood. Top figure has
   emissive body + arms so it actually radiates against the
   bloom threshold. The sculpture rotates slowly.
   ========================================================= */
function TransitionSculpture() {
  const groupRef = useRef();
  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += Math.min(dt, 0.05) * 0.10;
  });

  const STEP_DEPTH = 0.78;
  const STEP_HEIGHT = 0.40;
  const STEP_WIDTH = 1.9;
  const STEP_BASE_Y = 0.55;

  const figures = [
    { bodyH: 0.55, color: "#988d96", glow: false, armsUp: false, tilt:  0.45 },
    { bodyH: 0.90, color: "#a8b0c0", glow: false, armsUp: false, tilt:  0.20 },
    { bodyH: 1.20, color: "#a0c0a8", glow: false, armsUp: false, tilt:  0.05 },
    { bodyH: 1.40, color: "#ffe89c", glow: true,  armsUp: true,  tilt: -0.10 },
  ];

  return html`
    <group ref=${groupRef} position=${[TRANSITION.x, 0, TRANSITION.z]} scale=${SCULPT_SCALE}
      onClick=${(e) => openGoal(e, "transition")}>
      <!-- Plinth -->
      <mesh position=${[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args=${[2.6, 2.8, 0.3, 36]} />
        <meshStandardMaterial color="#2a2a2a" roughness=${0.7} metalness=${0.4} />
      </mesh>
      <mesh position=${[0, 0.42, 0]} castShadow receiveShadow>
        <cylinderGeometry args=${[2.2, 2.35, 0.24, 32]} />
        <meshStandardMaterial color="#3a3a3a" roughness=${0.6} metalness=${0.4} />
      </mesh>

      <!-- Content normalized so all four monuments stand equally tall;
           pivot at the platform top (y=0.54) keeps feet planted -->
      <group position=${[0, 0.54 * (1 - 1.28), 0]} scale=${1.28}>

      <!-- Staircase: 4 steps rising in the +z direction -->
      ${figures.map((_, i) => {
        const stepY = STEP_BASE_Y + STEP_HEIGHT * (i + 0.5);
        const stepZ = -1.3 + i * STEP_DEPTH;
        const stepColor = i === figures.length - 1 ? "#9a8e60" : "#7a7a7a";
        return html`
          <mesh key=${'s' + i} position=${[0, stepY, stepZ]} castShadow receiveShadow>
            <boxGeometry args=${[STEP_WIDTH, STEP_HEIGHT, STEP_DEPTH + 0.1]} />
            <meshStandardMaterial color=${stepColor} roughness=${0.85}
              emissive=${i === figures.length - 1 ? "#ffd070" : "#000000"}
              emissiveIntensity=${i === figures.length - 1 ? 0.2 : 0}
              toneMapped=${i !== figures.length - 1} />
          </mesh>
        `;
      })}

      <!-- 4 figures, one per step, progressively standing -->
      ${figures.map((f, i) => {
        const stepTopY = STEP_BASE_Y + STEP_HEIGHT * (i + 1);
        const stepZ = -1.3 + i * STEP_DEPTH;
        const bodyCenterY = stepTopY + f.bodyH / 2;
        const headBaseY = stepTopY + f.bodyH + 0.18;
        return html`
          <group key=${'f' + i} position=${[0, 0, stepZ]}>
            <!-- Body — tilts forward for hunched poses -->
            <mesh
              position=${[0, bodyCenterY, Math.sin(f.tilt) * 0.15]}
              rotation=${[f.tilt * 0.4, 0, 0]}
              castShadow>
              <cylinderGeometry args=${[0.20, 0.24, f.bodyH, 14]} />
              <meshStandardMaterial
                color=${f.color}
                emissive=${f.glow ? f.color : "#000000"}
                emissiveIntensity=${f.glow ? 0.5 : 0}
                toneMapped=${!f.glow}
                roughness=${0.7}
              />
            </mesh>
            <!-- Head — tilts down for hunched, level for upright -->
            <mesh
              position=${[0, headBaseY - Math.sin(f.tilt) * 0.05, Math.sin(f.tilt) * 0.18]}
              rotation=${[f.tilt, 0, 0]}
              castShadow>
              <sphereGeometry args=${[0.18, 14, 14]} />
              <meshStandardMaterial color="#d4a373" roughness=${0.7} />
            </mesh>
            ${f.armsUp ? html`
              <!-- Left arm raised in V -->
              <mesh
                position=${[-0.30, bodyCenterY + f.bodyH / 2 + 0.36, 0]}
                rotation=${[0, 0, 0.55]}
                castShadow>
                <cylinderGeometry args=${[0.06, 0.06, 0.85, 10]} />
                <meshStandardMaterial color=${f.color}
                  emissive=${f.color} emissiveIntensity=${0.5}
                  toneMapped=${false} roughness=${0.7} />
              </mesh>
              <!-- Right arm raised in V -->
              <mesh
                position=${[0.30, bodyCenterY + f.bodyH / 2 + 0.36, 0]}
                rotation=${[0, 0, -0.55]}
                castShadow>
                <cylinderGeometry args=${[0.06, 0.06, 0.85, 10]} />
                <meshStandardMaterial color=${f.color}
                  emissive=${f.color} emissiveIntensity=${0.5}
                  toneMapped=${false} roughness=${0.7} />
              </mesh>
            ` : ''}
          </group>
        `;
      })}

      <!-- Warm point light at the top step — the goal -->
      <pointLight position=${[0, 4.2, 1.1]} color="#ffd28a" intensity=${4} distance=${14} />
      </group>
    </group>
  `;
}

/* =========================================================
   Threshold Sculpture
   ---------------------------------------------------------
   A piece about accessibility to resources — the act of
   crossing a threshold to receive support.

     - A stone doorway: two pillars + lintel, forming an arch.
     - Inside the doorway: a glowing portal of warm light —
       the resources themselves.
     - On one side, 4 smaller warm-toned figures *approaching*
       in a line — the queue, the waiting, the application.
     - On the other side: a mini SHELTER and a mini FOODBANK —
       what waits past the threshold.
     - Slow rotation so every angle reads.
   ========================================================= */
function ThresholdSculpture() {
  const groupRef = useRef();
  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += Math.min(dt, 0.05) * 0.08;
  });

  const approaching = [
    { z: -1.0, x: -0.3 },
    { z: -1.7, x:  0.3 },
    { z: -2.4, x: -0.3 },
    { z: -3.1, x:  0.3 },
  ];

  return html`
    <group ref=${groupRef} position=${[THRESHOLD.x, 0, THRESHOLD.z]} scale=${SCULPT_SCALE}
      onClick=${(e) => openGoal(e, "threshold")}>
      <!-- Plinth -->
      <mesh position=${[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args=${[2.6, 2.8, 0.3, 36]} />
        <meshStandardMaterial color="#2a2a2a" roughness=${0.7} metalness=${0.4} />
      </mesh>
      <mesh position=${[0, 0.42, 0]} castShadow receiveShadow>
        <cylinderGeometry args=${[2.2, 2.35, 0.24, 32]} />
        <meshStandardMaterial color="#3a3a3a" roughness=${0.6} metalness=${0.4} />
      </mesh>

      <!-- Content normalized so all four monuments stand equally tall -->
      <group position=${[0, 0.54 * (1 - 0.95), 0]} scale=${0.95}>

      <!-- Left pillar -->
      <mesh position=${[-1.5, 2.85, 0]} castShadow>
        <boxGeometry args=${[0.5, 5.0, 0.5]} />
        <meshStandardMaterial color="#90908a" roughness=${0.85} />
      </mesh>
      <!-- Right pillar -->
      <mesh position=${[1.5, 2.85, 0]} castShadow>
        <boxGeometry args=${[0.5, 5.0, 0.5]} />
        <meshStandardMaterial color="#90908a" roughness=${0.85} />
      </mesh>
      <!-- Top lintel -->
      <mesh position=${[0, 5.6, 0]} castShadow>
        <boxGeometry args=${[3.5, 0.5, 0.6]} />
        <meshStandardMaterial color="#7e7e78" roughness=${0.85} />
      </mesh>

      <!-- Glowing portal of light = the resources -->
      <mesh position=${[0, 2.85, 0]}>
        <planeGeometry args=${[2.5, 4.8]} />
        <meshStandardMaterial
          color="#fff5dc"
          emissive="#ff9c4a"
          emissiveIntensity=${2.0}
          toneMapped=${false}
          side=${THREE.DoubleSide}
        />
      </mesh>

      <!-- Warm light spilling through the portal -->
      <pointLight position=${[0, 2.5, 0]} color="#ffd28a" intensity=${4} distance=${18} />

      <!-- Approaching: queue of warm-toned figures, smaller / waiting -->
      ${approaching.map((f, i) => html`
        <group key=${'a' + i}>
          <mesh position=${[f.x, 0.93, f.z]} castShadow>
            <cylinderGeometry args=${[0.18, 0.22, 0.86, 14]} />
            <meshStandardMaterial color="#f5a070" roughness=${0.78} />
          </mesh>
          <mesh position=${[f.x, 1.50, f.z]} castShadow>
            <sphereGeometry args=${[0.15, 14, 14]} />
            <meshStandardMaterial color="#d4a070" roughness=${0.7} />
          </mesh>
        </group>
      `)}

      <!-- Other side: mini SHELTER + mini FOODBANK — the concrete resources -->
      <!-- Mini shelter (left, blue with SHELTER sign) -->
      <group position=${[-0.75, 0.55, 1.8]}>
        <mesh position=${[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args=${[1.1, 1.0, 0.9]} />
          <meshStandardMaterial color="#4880b0" roughness=${0.85} />
        </mesh>
        <mesh position=${[0, 1.2, 0]} castShadow rotation=${[0, Math.PI / 4, 0]}>
          <coneGeometry args=${[0.85, 0.5, 4]} />
          <meshStandardMaterial color="#2a5878" roughness=${0.9} />
        </mesh>
        <mesh position=${[0, 0.87, 0.46]} castShadow>
          <boxGeometry args=${[0.85, 0.22, 0.02]} />
          <meshStandardMaterial color="#ffffff" roughness=${0.6} />
        </mesh>
        <mesh position=${[0, 0.87, 0.475]}>
          <planeGeometry args=${[0.82, 0.205]} />
          <meshStandardMaterial
            map=${SHELTER_SIGN_TEX}
            emissive="#ffffff"
            emissiveMap=${SHELTER_SIGN_TEX}
            emissiveIntensity=${0.3}
            toneMapped=${false}
            roughness=${0.5}
          />
        </mesh>
        <mesh position=${[0, 0.3, 0.46]}>
          <planeGeometry args=${[0.32, 0.55]} />
          <meshStandardMaterial color="#ffd28a" emissive="#ff9c4a"
            emissiveIntensity=${1.2} toneMapped=${false} />
        </mesh>
      </group>

      <!-- Mini food bank (right, warm orange with FOODBANK sign) -->
      <group position=${[0.85, 0.55, 1.9]}>
        <mesh position=${[0, 0.55, 0]} castShadow receiveShadow>
          <boxGeometry args=${[1.1, 1.1, 0.9]} />
          <meshStandardMaterial color="#f0a830" roughness=${0.85} />
        </mesh>
        <mesh position=${[0, 1.18, 0]} castShadow>
          <boxGeometry args=${[1.2, 0.10, 1.0]} />
          <meshStandardMaterial color="#7a3820" roughness=${0.9} />
        </mesh>
        <mesh position=${[0, 0.92, 0.46]} castShadow>
          <boxGeometry args=${[0.85, 0.22, 0.02]} />
          <meshStandardMaterial color="#ffffff" roughness=${0.6} />
        </mesh>
        <mesh position=${[0, 0.92, 0.475]}>
          <planeGeometry args=${[0.82, 0.205]} />
          <meshStandardMaterial
            map=${FOODBANK_SIGN_TEX}
            emissive="#ffffff"
            emissiveMap=${FOODBANK_SIGN_TEX}
            emissiveIntensity=${0.3}
            toneMapped=${false}
            roughness=${0.5}
          />
        </mesh>
        <mesh position=${[0, 0.35, 0.46]}>
          <planeGeometry args=${[0.34, 0.55]} />
          <meshStandardMaterial color="#ffd28a" emissive="#ff9c4a"
            emissiveIntensity=${1.2} toneMapped=${false} />
        </mesh>
      </group>
      </group>
    </group>
  `;
}

/* Stacked-bills pile geometry: layered boxes that get smaller as they
   rise, forming a mound that almost buries the house — only the roof
   peaks through. Slight jitter on each layer for organic stacking. */
/* Tall money tower — vertical like the other monuments instead of a
   squat mound, so it reads at the same visual weight. */
const PILE_LAYERS = [
  { y: 0.50, w: 2.70, h: 0.62, d: 2.10, xj:  0.00, zj:  0.00, ry:  0.00 },
  { y: 1.10, w: 2.45, h: 0.58, d: 1.90, xj: -0.09, zj:  0.08, ry:  0.05 },
  { y: 1.66, w: 2.20, h: 0.55, d: 1.70, xj:  0.10, zj: -0.07, ry: -0.07 },
  { y: 2.20, w: 1.95, h: 0.52, d: 1.52, xj: -0.05, zj:  0.05, ry:  0.10 },
  { y: 2.71, w: 1.70, h: 0.50, d: 1.34, xj:  0.07, zj: -0.08, ry: -0.06 },
  { y: 3.20, w: 1.45, h: 0.48, d: 1.16, xj: -0.04, zj:  0.06, ry:  0.12 },
  { y: 3.67, w: 1.20, h: 0.45, d: 0.98, xj:  0.04, zj: -0.04, ry: -0.09 },
  { y: 4.12, w: 0.95, h: 0.42, d: 0.80, xj: -0.03, zj:  0.03, ry:  0.07 },
];

function AffordabilitySculpture() {
  const groupRef = useRef();
  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += Math.min(dt, 0.05) * 0.10;
  });
  return html`
    <group ref=${groupRef} position=${[AFFORDABILITY.x, 0, AFFORDABILITY.z]} scale=${SCULPT_SCALE}
      onClick=${(e) => openGoal(e, "affordability")}>
      <!-- Plinth — same two-tier dimensions as the other monuments -->
      <mesh position=${[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args=${[2.6, 2.8, 0.3, 36]} />
        <meshStandardMaterial color="#2a2a2a" roughness=${0.7} metalness=${0.4} />
      </mesh>
      <mesh position=${[0, 0.42, 0]} castShadow receiveShadow>
        <cylinderGeometry args=${[2.2, 2.35, 0.24, 32]} />
        <meshStandardMaterial color="#3a3a3a" roughness=${0.6} metalness=${0.4} />
      </mesh>

      <!-- Content normalized so all four monuments stand equally tall -->
      <group position=${[0, 0.54 * (1 - 0.90), 0]} scale=${0.90}>

      <!-- PERSON on the left, reaching out toward the pile -->
      <group position=${[-1.95, 0, 0]}>
        <mesh position=${[0, 1.25, 0]} castShadow>
          <cylinderGeometry args=${[0.22, 0.26, 1.5, 16]} />
          <meshStandardMaterial color="#a8b8c8" roughness=${0.75} />
        </mesh>
        <mesh position=${[0, 2.18, 0]} castShadow>
          <sphereGeometry args=${[0.22, 18, 18]} />
          <meshStandardMaterial color="#d4a373" roughness=${0.7} />
        </mesh>
        <mesh position=${[0.55, 1.60, 0]} castShadow rotation=${[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args=${[0.07, 0.07, 1.0, 10]} />
          <meshStandardMaterial color="#a8b8c8" roughness=${0.75} />
        </mesh>
        <mesh position=${[1.05, 1.60, 0]} castShadow>
          <sphereGeometry args=${[0.10, 12, 12]} />
          <meshStandardMaterial color="#d4a373" roughness=${0.7} />
        </mesh>
      </group>

      <!-- HOUSE in the center — tall, mostly buried in the pile,
           only the pyramidal roof and chimney peeking above. -->
      <group position=${[0.2, 0, 0]}>
        <!-- Body (tall, mostly hidden by the pile) -->
        <mesh position=${[0, 2.1, 0]} castShadow receiveShadow>
          <boxGeometry args=${[1.25, 4.2, 1.05]} />
          <meshStandardMaterial color="#e8a060" roughness=${0.85} />
        </mesh>
        <!-- Pyramidal roof — sticks out above the pile -->
        <mesh position=${[0, 4.55, 0]} castShadow rotation=${[0, Math.PI / 4, 0]}>
          <coneGeometry args=${[0.95, 0.95, 4]} />
          <meshStandardMaterial color="#a05030" roughness=${0.9} />
        </mesh>
        <!-- Chimney peeking above the pile -->
        <mesh position=${[0.40, 5.0, 0.28]} castShadow>
          <boxGeometry args=${[0.22, 0.6, 0.22]} />
          <meshStandardMaterial color="#a05030" roughness=${0.9} />
        </mesh>
      </group>

      <!-- THE PILE OF DOLLARS — layered boxes nearly burying the house -->
      ${PILE_LAYERS.map((b, i) => html`
        <group key=${'p' + i} position=${[0.2 + b.xj, b.y, b.zj]} rotation=${[0, b.ry, 0]}>
          <!-- Base box, painted money-green -->
          <mesh castShadow receiveShadow>
            <boxGeometry args=${[b.w, b.h, b.d]} />
            <meshStandardMaterial color="#36563a" roughness=${0.85} />
          </mesh>
          <!-- $ texture facing +Z -->
          <mesh position=${[0, 0, b.d / 2 + 0.005]}>
            <planeGeometry args=${[b.w * 0.95, b.h * 0.85]} />
            <meshStandardMaterial
              map=${DOLLAR_WALL_TEX}
              emissive="#ecc560"
              emissiveMap=${DOLLAR_WALL_TEX}
              emissiveIntensity=${0.55}
              toneMapped=${false}
              roughness=${0.55}
            />
          </mesh>
          <!-- $ texture facing -Z -->
          <mesh position=${[0, 0, -b.d / 2 - 0.005]} rotation=${[0, Math.PI, 0]}>
            <planeGeometry args=${[b.w * 0.95, b.h * 0.85]} />
            <meshStandardMaterial
              map=${DOLLAR_WALL_TEX}
              emissive="#ecc560"
              emissiveMap=${DOLLAR_WALL_TEX}
              emissiveIntensity=${0.55}
              toneMapped=${false}
              roughness=${0.55}
            />
          </mesh>
          <!-- $ texture facing +X -->
          <mesh position=${[b.w / 2 + 0.005, 0, 0]} rotation=${[0, Math.PI / 2, 0]}>
            <planeGeometry args=${[b.d * 0.95, b.h * 0.85]} />
            <meshStandardMaterial
              map=${DOLLAR_WALL_TEX}
              emissive="#ecc560"
              emissiveMap=${DOLLAR_WALL_TEX}
              emissiveIntensity=${0.55}
              toneMapped=${false}
              roughness=${0.55}
            />
          </mesh>
          <!-- $ texture facing -X -->
          <mesh position=${[-b.w / 2 - 0.005, 0, 0]} rotation=${[0, -Math.PI / 2, 0]}>
            <planeGeometry args=${[b.d * 0.95, b.h * 0.85]} />
            <meshStandardMaterial
              map=${DOLLAR_WALL_TEX}
              emissive="#ecc560"
              emissiveMap=${DOLLAR_WALL_TEX}
              emissiveIntensity=${0.55}
              toneMapped=${false}
              roughness=${0.55}
            />
          </mesh>
        </group>
      `)}

      <!-- Shiny golden coin crowning the tower — the monument's beacon -->
      <mesh position=${[0.2, 5.45, 0]} rotation=${[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args=${[0.72, 0.72, 0.12, 28]} />
        <meshStandardMaterial
          color="#d4a017"
          emissive="#ffcf4d"
          emissiveIntensity=${2.0}
          metalness=${0.9}
          roughness=${0.18}
          toneMapped=${false}
        />
      </mesh>

      <!-- Warm light at the coin — the only sign of life -->
      <pointLight position=${[0.2, 5.2, 0]} color="#ffd28a" intensity=${3} distance=${12} />
      </group>
    </group>
  `;
}


function Shelter() {
  const x = SHELTER.x, z = SHELTER.z;
  return html`
    <group position=${[x, 0, z]}>
      <!-- Main building — bumped to match Food Bank scale -->
      <mesh position=${[0, 1.75, 0]} castShadow receiveShadow>
        <boxGeometry args=${[4.4, 3.5, 3.4]} />
        <meshStandardMaterial color="#4880b0" roughness=${0.85} />
      </mesh>
      <!-- Roof eave -->
      <mesh position=${[0, 3.65, 0]} castShadow>
        <boxGeometry args=${[4.7, 0.28, 3.7]} />
        <meshStandardMaterial color="#2a5878" roughness=${0.9} />
      </mesh>
      <!-- White sign panel -->
      <mesh position=${[0, 4.05, 1.71]} castShadow>
        <boxGeometry args=${[3.6, 0.9, 0.06]} />
        <meshStandardMaterial color="#ffffff" roughness=${0.6} />
      </mesh>
      <!-- SHELTER text -->
      <mesh position=${[0, 4.05, 1.745]}>
        <planeGeometry args=${[3.4, 0.85]} />
        <meshStandardMaterial
          map=${SHELTER_SIGN_TEX}
          emissive="#ffffff"
          emissiveMap=${SHELTER_SIGN_TEX}
          emissiveIntensity=${0.25}
          toneMapped=${false}
          roughness=${0.5}
        />
      </mesh>
      <!-- Wide open door -->
      <mesh position=${[0, 1.3, 1.71]}>
        <planeGeometry args=${[1.4, 2.4]} />
        <meshStandardMaterial color="#5a3a26" />
      </mesh>
      <mesh position=${[0, 1.3, 1.713]}>
        <planeGeometry args=${[1.1, 2.1]} />
        <meshStandardMaterial color="#ffd28a" emissive="#ff9c4a"
          emissiveIntensity=${1.4} toneMapped=${false} />
      </mesh>
      <!-- Bunk-row windows above the door -->
      <mesh position=${[0, 2.95, 1.72]}>
        <planeGeometry args=${[2.4, 0.65]} />
        <meshStandardMaterial color="#ffd28a" emissive="#ff9c4a"
          emissiveIntensity=${0.6} toneMapped=${false} />
      </mesh>
      <!-- Side windows -->
      ${[-1.55, 1.55].map((wx, i) => html`
        <mesh key=${i} position=${[wx, 2.0, 1.72]}>
          <planeGeometry args=${[0.85, 1.0]} />
          <meshStandardMaterial color="#ffd28a" emissive="#ff9c4a"
            emissiveIntensity=${0.7} toneMapped=${false} />
        </mesh>
      `)}
      <!-- Awning above the door -->
      <mesh position=${[0, 2.8, 1.85]} castShadow>
        <boxGeometry args=${[1.8, 0.10, 0.5]} />
        <meshStandardMaterial color="#2a5878" roughness=${0.6} />
      </mesh>
    </group>
  `;
}

/* =========================================================
   Shelter queue — same dynamic pattern as the Food Bank queue.
   ========================================================= */
const SHELTER_QUEUE_CAPACITY = 6;
const SHELTER_QUEUE_SPACING  = 0.7;
const SHELTER_QUEUE_X0       = 0.5;
const SHELTER_QUEUE_Z        = 2.0;
const SHELTER_DOOR_TARGET_DZ = 1.0;

function ShelterQueue() {
  const bodyRef = useRef();
  const headRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const advanceTimer = useRef(3.5);
  const t0 = useRef(0);

  const slots = useMemo(() => {
    const arr = [];
    for (let i = 0; i < SHELTER_QUEUE_CAPACITY; i++) {
      arr.push({
        x: SHELTER.x + SHELTER_QUEUE_X0 + i * SHELTER_QUEUE_SPACING,
        z: SHELTER.z + SHELTER_QUEUE_Z,
        queuePos: i,
        state: "queued",
        heading: -Math.PI / 2,
        bodyColor: FLOCK_BODY_COLORS[(i + 4) % FLOCK_BODY_COLORS.length],
        skinColor: FLOCK_SKIN_COLORS[(i * 5) % FLOCK_SKIN_COLORS.length],
      });
    }
    return arr;
  }, []);

  useEffect(() => {
    if (!bodyRef.current || !headRef.current) return;
    const c = new THREE.Color();
    for (let i = 0; i < SHELTER_QUEUE_CAPACITY; i++) {
      c.set(slots[i].bodyColor);
      bodyRef.current.setColorAt(i, c);
      c.set(slots[i].skinColor);
      headRef.current.setColorAt(i, c);
    }
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
    if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true;
  }, []);

  useFrame((state, dt) => {
    if (!bodyRef.current || !headRef.current) return;
    const cdt = Math.min(dt, 0.05);
    t0.current = state.clock.elapsedTime;

    advanceTimer.current -= cdt;
    if (advanceTimer.current <= 0) {
      advanceTimer.current = 6 + Math.random() * 5;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.state !== "queued") continue;
        if (s.queuePos === 0) s.state = "entering";
        else s.queuePos -= 1;
      }
    }

    let colorsDirty = false;
    const colorTmp = new THREE.Color();

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      let tx, tz;
      if (s.state === "entering") {
        tx = SHELTER.x;
        tz = SHELTER.z + SHELTER_DOOR_TARGET_DZ;
      } else {
        tx = SHELTER.x + SHELTER_QUEUE_X0 + s.queuePos * SHELTER_QUEUE_SPACING;
        tz = SHELTER.z + SHELTER_QUEUE_Z;
      }
      const dx = tx - s.x;
      const dz = tz - s.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.02) {
        const speed = 0.85;
        const move = Math.min(dist, speed * cdt);
        s.x += (dx / dist) * move;
        s.z += (dz / dist) * move;
        s.heading = Math.atan2(dx, dz);
      }

      if (s.state === "entering" && dist < 0.4) {
        s.queuePos = SHELTER_QUEUE_CAPACITY - 1;
        s.state = "replenishing";
        s.x = SHELTER.x + SHELTER_QUEUE_X0 + (SHELTER_QUEUE_CAPACITY + 1) * SHELTER_QUEUE_SPACING;
        s.z = SHELTER.z + SHELTER_QUEUE_Z + 1.5 + Math.random() * 1.0;
        s.bodyColor = FLOCK_BODY_COLORS[Math.floor(Math.random() * FLOCK_BODY_COLORS.length)];
        s.skinColor = FLOCK_SKIN_COLORS[Math.floor(Math.random() * FLOCK_SKIN_COLORS.length)];
        colorTmp.set(s.bodyColor); bodyRef.current.setColorAt(i, colorTmp);
        colorTmp.set(s.skinColor); headRef.current.setColorAt(i, colorTmp);
        colorsDirty = true;
      } else if (s.state === "replenishing" && dist < 0.4) {
        s.state = "queued";
      }

      const bob = Math.sin(t0.current * 6 + i * 1.7) * 0.025;
      dummy.position.set(s.x, 0.62 + bob, s.z);
      dummy.rotation.set(0, s.heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bodyRef.current.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, 1.46 + bob, s.z);
      dummy.updateMatrix();
      headRef.current.setMatrixAt(i, dummy.matrix);
    }
    bodyRef.current.instanceMatrix.needsUpdate = true;
    headRef.current.instanceMatrix.needsUpdate = true;
    if (colorsDirty) {
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
      if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true;
    }
  });

  return html`
    <group>
      <instancedMesh ref=${bodyRef} args=${[undefined, undefined, SHELTER_QUEUE_CAPACITY]} castShadow receiveShadow>
        <boxGeometry args=${[0.46, 1.20, 0.32]} />
        <meshStandardMaterial roughness=${0.9} />
      </instancedMesh>
      <instancedMesh ref=${headRef} args=${[undefined, undefined, SHELTER_QUEUE_CAPACITY]} castShadow>
        <boxGeometry args=${[0.36, 0.36, 0.36]} />
        <meshStandardMaterial roughness=${0.85} />
      </instancedMesh>
    </group>
  `;
}

/* =========================================================
   Tents — small encampments at the city outskirts
   ========================================================= */
const TENT_CLUSTERS = [
  // Outskirts (just past the road)
  { cx: -34, cz:  18, count: 6, ry:  0.3 },
  { cx:  34, cz: -18, count: 5, ry: -0.2 },
  { cx: -22, cz: -30, count: 5, ry:  0.5 },
  { cx:  22, cz:  30, count: 5, ry: -0.4 },
  { cx: -36, cz:  -8, count: 4, ry:  0.6 },
  { cx:  36, cz:   8, count: 5, ry: -0.6 },
  { cx:   0, cz:  38, count: 4, ry:  0.2 },
  { cx:   0, cz: -38, count: 4, ry: -0.2 },
  { cx: -28, cz:  28, count: 4, ry:  0.4 },
  { cx:  28, cz: -28, count: 4, ry: -0.4 },
  { cx: -40, cz:   2, count: 3, ry:  0.0 },
  { cx:  40, cz:  -2, count: 3, ry:  0.0 },
  // Inside the city — tucked between buildings
  { cx: -17.4, cz:   8.7, count: 5, ry:  0.1 },
  { cx:  14.5, cz:  -8.7, count: 5, ry: -0.3 },
  { cx:  -8.7, cz: -11.6, count: 4, ry:  0.4 },
  { cx:  17.4, cz:  11.6, count: 5, ry: -0.1 },
  { cx:  -5.8, cz:  11.6, count: 4, ry:  0.5 },
  { cx:   8.7, cz:  -2.9, count: 4, ry:  0.2 },
  { cx: -14.5, cz:  -5.8, count: 4, ry:  0.0 },
  { cx:  11.6, cz:   5.8, count: 4, ry: -0.5 },
  { cx: -11.6, cz:  -2.9, count: 3, ry:  0.3 },
  { cx:   5.8, cz:  -5.8, count: 3, ry: -0.2 },
];
const TENT_COLORS = ["#3868a0", "#c84030", "#487868", "#e08020", "#7060e0", "#a05c40"];
const TENTS = [];
for (const c of TENT_CLUSTERS) {
  for (let i = 0; i < c.count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.3 + Math.random() * 1.8;
    const x = c.cx + Math.cos(a) * r;
    const z = c.cz + Math.sin(a) * r;
    TENTS.push({
      x, z,
      hy: hillHeight(x, z) - 0.05,
      ry: c.ry + (Math.random() - 0.5) * 0.6,
      color: TENT_COLORS[Math.floor(Math.random() * TENT_COLORS.length)],
    });
  }
}

function Tents({ dynTents = [] }) {
  const all = [...TENTS, ...dynTents];
  return html`
    <${Instances} limit=${200} castShadow receiveShadow>
      <coneGeometry args=${[0.9, 1.1, 4]} />
      <meshStandardMaterial roughness=${0.88} />
      ${all.map((t, i) => html`
        <${Instance} key=${i}
          position=${[t.x, t.hy + 0.55, t.z]}
          rotation=${[0, t.ry, 0]}
          color=${t.color} />
      `)}
    </${Instances}>
  `;
}

/* =========================================================
   City parks — small grass patches with a couple of trees,
   replacing the grid cell where a building would have been.
   ========================================================= */
function Parks() {
  return html`
    <group>
      ${PARKS.map((p, i) => html`
        <group key=${i} position=${[p.x, 0, p.z]}>
          <!-- Grass patch -->
          <mesh position=${[0, 0.024, 0]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
            <planeGeometry args=${[CELL_W - 0.6, CELL_D - 0.6]} />
            <meshStandardMaterial color="#7ec85a" roughness=${0.95} />
          </mesh>
          <!-- Centerpiece tree (pine) -->
          <group position=${[(((i * 17) % 13) / 13 - 0.5) * 1.5, 0, (((i * 7) % 11) / 11 - 0.5) * 1.5]}>
            <mesh position=${[0, 0.55, 0]} castShadow receiveShadow>
              <cylinderGeometry args=${[0.14, 0.18, 1.1, 8]} />
              <meshStandardMaterial color="#7a4a2a" roughness=${0.95} />
            </mesh>
            <mesh position=${[0, 2.25, 0]} castShadow>
              <coneGeometry args=${[1.0, 2.3, 8]} />
              <meshStandardMaterial color="#5a9438" roughness=${0.85} />
            </mesh>
          </group>
          <!-- Side tree (round) -->
          <group position=${[(((i * 5) % 7) / 7 - 0.5) * 2.0 + 1.5, 0, (((i * 11) % 5) / 5 - 0.5) * 2.0 - 1.0]}>
            <mesh position=${[0, 0.4, 0]} castShadow receiveShadow>
              <cylinderGeometry args=${[0.10, 0.13, 0.8, 8]} />
              <meshStandardMaterial color="#7a4a2a" roughness=${0.95} />
            </mesh>
            <mesh position=${[0, 1.45, 0]} castShadow>
              <sphereGeometry args=${[0.75, 10, 10]} />
              <meshStandardMaterial color="#88c462" roughness=${0.85} />
            </mesh>
          </group>
          <!-- Two bushes -->
          ${[[-1.5, -1.2], [1.4, 1.6]].map((b, bi) => html`
            <mesh key=${bi} position=${[b[0], 0.25, b[1]]} castShadow>
              <sphereGeometry args=${[0.32, 8, 8]} />
              <meshStandardMaterial color="#7ab85a" roughness=${0.9} />
            </mesh>
          `)}
        </group>
      `)}
    </group>
  `;
}

/* =========================================================
   Sleeping bags — small bundles tucked along building walls
   ========================================================= */
const SLEEPING_BAG_COLORS = ["#406890", "#7a5440", "#a04848", "#506880", "#604848", "#a86040"];
const SLEEPING_BAGS = [];
for (let i = 0; i < 10 && BUILDINGS.length > 0; i++) {
  const b = BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)];
  const side = Math.floor(Math.random() * 4);
  const off = 0.18;
  let x, z, ry;
  if (side === 0) {
    x = b.x + (Math.random() - 0.5) * (b.w * 0.55);
    z = b.z + b.d / 2 + off;
    ry = 0;
  } else if (side === 1) {
    x = b.x + (Math.random() - 0.5) * (b.w * 0.55);
    z = b.z - b.d / 2 - off;
    ry = Math.PI;
  } else if (side === 2) {
    x = b.x - b.w / 2 - off;
    z = b.z + (Math.random() - 0.5) * (b.d * 0.55);
    ry = -Math.PI / 2;
  } else {
    x = b.x + b.w / 2 + off;
    z = b.z + (Math.random() - 0.5) * (b.d * 0.55);
    ry = Math.PI / 2;
  }
  SLEEPING_BAGS.push({
    x, z, ry,
    color: SLEEPING_BAG_COLORS[Math.floor(Math.random() * SLEEPING_BAG_COLORS.length)],
  });
}

function SleepingBags() {
  return html`
    <${Instances} limit=${Math.max(1, SLEEPING_BAGS.length)} castShadow receiveShadow>
      <boxGeometry args=${[0.4, 0.18, 1.4]} />
      <meshStandardMaterial roughness=${0.92} />
      ${SLEEPING_BAGS.map((s, i) => html`
        <${Instance} key=${i}
          position=${[s.x, 0.09, s.z]}
          rotation=${[0, s.ry, 0]}
          color=${s.color} />
      `)}
    </${Instances}>
  `;
}

/* =========================================================
   Shopping carts — frames + colored bundles, scattered near
   tent encampments and along streets.
   ========================================================= */
const CART_BUNDLE_COLORS = ["#a04848", "#3868a0", "#487868", "#7060e0", "#a85c40", "#806040", "#b8704c", "#406880"];

/* =========================================================
   Food Bank queue — 7 standing figures lined up at the door.
   ========================================================= */
/* Dynamic Food Bank queue.

   Each slot holds one person. Every few seconds the front person
   walks into the door (state → 'entering'), then once they reach
   the door they teleport to behind the queue with new colors and
   walk back in (state → 'replenishing'). Everyone else shifts
   forward to fill the gap.

   Queue line extends along +x from the door so it sits parallel to
   the building's front face (between building + perimeter loop). */
const QUEUE_CAPACITY  = 6;
const QUEUE_SPACING   = 0.7;
const QUEUE_X0        = 0.5;            // slot 0 offset from FOODBANK_POS.x
const QUEUE_Z         = 2.0;            // queue z relative to FOODBANK_POS.z
const DOOR_TARGET_DZ  = 1.0;            // door entry target z relative to FOODBANK_POS.z

function FoodBankQueue() {
  const bodyRef = useRef();
  const headRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const advanceTimer = useRef(2.5);
  const t0 = useRef(0);

  const slots = useMemo(() => {
    const arr = [];
    for (let i = 0; i < QUEUE_CAPACITY; i++) {
      arr.push({
        x: FOODBANK_POS.x + QUEUE_X0 + i * QUEUE_SPACING,
        z: FOODBANK_POS.z + QUEUE_Z,
        queuePos: i,
        state: "queued",                // 'queued' | 'entering' | 'replenishing'
        heading: -Math.PI / 2,          // faces -x by default (toward door side)
        bodyColor: FLOCK_BODY_COLORS[i % FLOCK_BODY_COLORS.length],
        skinColor: FLOCK_SKIN_COLORS[(i * 3) % FLOCK_SKIN_COLORS.length],
      });
    }
    return arr;
  }, []);

  // Set initial per-instance colors.
  useEffect(() => {
    if (!bodyRef.current || !headRef.current) return;
    const c = new THREE.Color();
    for (let i = 0; i < QUEUE_CAPACITY; i++) {
      c.set(slots[i].bodyColor);
      bodyRef.current.setColorAt(i, c);
      c.set(slots[i].skinColor);
      headRef.current.setColorAt(i, c);
    }
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
    if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true;
  }, []);

  useFrame((state, dt) => {
    if (!bodyRef.current || !headRef.current) return;
    const cdt = Math.min(dt, 0.05);
    t0.current = state.clock.elapsedTime;

    // Tick the advance timer — when it fires, front leaves and queue shifts forward.
    advanceTimer.current -= cdt;
    if (advanceTimer.current <= 0) {
      advanceTimer.current = 5 + Math.random() * 5;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.state !== "queued") continue;
        if (s.queuePos === 0) {
          s.state = "entering";
        } else {
          s.queuePos -= 1;
        }
      }
    }

    let colorsDirty = false;
    const colorTmp = new THREE.Color();

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      // Pick a target based on state
      let tx, tz;
      if (s.state === "entering") {
        tx = FOODBANK_POS.x;
        tz = FOODBANK_POS.z + DOOR_TARGET_DZ;
      } else {
        tx = FOODBANK_POS.x + QUEUE_X0 + s.queuePos * QUEUE_SPACING;
        tz = FOODBANK_POS.z + QUEUE_Z;
      }
      const dx = tx - s.x;
      const dz = tz - s.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.02) {
        const speed = 0.9;
        const move = Math.min(dist, speed * cdt);
        s.x += (dx / dist) * move;
        s.z += (dz / dist) * move;
        s.heading = Math.atan2(dx, dz);
      }

      // State transitions
      if (s.state === "entering" && dist < 0.4) {
        // Front person reached door — respawn at back of queue
        s.queuePos = QUEUE_CAPACITY - 1;
        s.state = "replenishing";
        s.x = FOODBANK_POS.x + QUEUE_X0 + (QUEUE_CAPACITY + 1) * QUEUE_SPACING;
        s.z = FOODBANK_POS.z + QUEUE_Z + 1.5 + Math.random() * 1.0;
        s.bodyColor = FLOCK_BODY_COLORS[Math.floor(Math.random() * FLOCK_BODY_COLORS.length)];
        s.skinColor = FLOCK_SKIN_COLORS[Math.floor(Math.random() * FLOCK_SKIN_COLORS.length)];
        colorTmp.set(s.bodyColor);
        bodyRef.current.setColorAt(i, colorTmp);
        colorTmp.set(s.skinColor);
        headRef.current.setColorAt(i, colorTmp);
        colorsDirty = true;
      } else if (s.state === "replenishing" && dist < 0.4) {
        s.state = "queued";
      }

      // Render matrices — subtle bob synced per slot
      const bob = Math.sin(t0.current * 6 + i * 1.3) * 0.025;
      dummy.position.set(s.x, 0.62 + bob, s.z);
      dummy.rotation.set(0, s.heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bodyRef.current.setMatrixAt(i, dummy.matrix);

      dummy.position.set(s.x, 1.46 + bob, s.z);
      dummy.updateMatrix();
      headRef.current.setMatrixAt(i, dummy.matrix);
    }
    bodyRef.current.instanceMatrix.needsUpdate = true;
    headRef.current.instanceMatrix.needsUpdate = true;
    if (colorsDirty) {
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
      if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true;
    }
  });

  return html`
    <group>
      <instancedMesh ref=${bodyRef} args=${[undefined, undefined, QUEUE_CAPACITY]} castShadow receiveShadow>
        <boxGeometry args=${[0.46, 1.20, 0.32]} />
        <meshStandardMaterial roughness=${0.9} />
      </instancedMesh>
      <instancedMesh ref=${headRef} args=${[undefined, undefined, QUEUE_CAPACITY]} castShadow>
        <boxGeometry args=${[0.36, 0.36, 0.36]} />
        <meshStandardMaterial roughness=${0.85} />
      </instancedMesh>
    </group>
  `;
}

/* =========================================================
   Outreach worker — single figure in a high-vis vest that
   walks a continuous loop visiting every tent cluster.
   ========================================================= */
function OutreachWorker() {
  const bodyRef = useRef();
  const headRef = useRef();
  const targetIdx = useRef(0);
  const pos = useRef([TENT_CLUSTERS[0].cx, 0, TENT_CLUSTERS[0].cz]);

  useFrame((state, dt) => {
    if (!bodyRef.current || !headRef.current) return;
    const cdt = Math.min(dt, 0.05);
    const speed = 1.6;
    const target = TENT_CLUSTERS[targetIdx.current];
    const dx = target.cx - pos.current[0];
    const dz = target.cz - pos.current[2];
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 1.5) {
      targetIdx.current = (targetIdx.current + 1) % TENT_CLUSTERS.length;
    } else {
      pos.current[0] += (dx / dist) * speed * cdt;
      pos.current[2] += (dz / dist) * speed * cdt;
    }

    const heading = Math.atan2(dx, dz);
    const t = state.clock.elapsedTime;
    const bob = Math.sin(t * 6) * 0.04;
    bodyRef.current.position.set(pos.current[0], 0.46 + bob, pos.current[2]);
    bodyRef.current.rotation.y = heading;
    headRef.current.position.set(pos.current[0], 1.09 + bob, pos.current[2]);
    headRef.current.rotation.y = heading;
  });

  return html`
    <group>
      <mesh ref=${bodyRef}>
        <boxGeometry args=${[0.36, 0.92, 0.26]} />
        <meshStandardMaterial color="#ffd024" roughness=${0.55} />
      </mesh>
      <mesh ref=${headRef}>
        <boxGeometry args=${[0.27, 0.27, 0.27]} />
        <meshStandardMaterial color="#d4a373" roughness=${0.85} />
      </mesh>
    </group>
  `;
}

/* =========================================================
   Dogs — 10 instanced companions scattered near tents.
   Box body + box head; faces with the body's rotation.
   ========================================================= */
const DOG_COAT_COLORS_LIST = ["#7a4a2a", "#a08068", "#3a3a3a", "#d4b890", "#5a4030", "#c89860", "#7c5a3a"];
const TENT_PACK_COLORS_LIST = ["#3868a0", "#c84030", "#487868", "#e08020", "#7060e0", "#a05c40"];

function City() {
  return html`
    <group>
      <!-- Box walls -->
      <${Instances} limit=${Math.max(1, BOX_BLDGS.length)} castShadow receiveShadow>
        <boxGeometry args=${[1, 1, 1]} />
        <meshStandardMaterial roughness=${0.85} />
        ${BOX_BLDGS.map((b, i) => html`
          <${Instance} key=${i}
            position=${[b.x, b.groundY + b.h / 2, b.z]}
            scale=${[b.w, b.h, b.d]}
            rotation=${[0, b.ry, 0]}
            color=${b.color} />
        `)}
      </${Instances}>

      <!-- Cylindrical towers -->
      <${Instances} limit=${Math.max(1, CYL_BLDGS.length)} castShadow receiveShadow>
        <cylinderGeometry args=${[0.5, 0.5, 1, 20]} />
        <meshStandardMaterial roughness=${0.85} />
        ${CYL_BLDGS.map((b, i) => html`
          <${Instance} key=${i}
            position=${[b.x, b.groundY + b.h / 2, b.z]}
            scale=${[b.w, b.h, b.w]}
            color=${b.color} />
        `)}
      </${Instances}>

      <!-- Cylinder floor bands -->
      <${Instances} limit=${Math.max(1, CYL_BANDS.length)}>
        <cylinderGeometry args=${[0.5, 0.5, 1, 20]} />
        <meshStandardMaterial roughness=${0.9} />
        ${CYL_BANDS.map((r, i) => html`
          <${Instance} key=${i}
            position=${[r.x, r.y, r.z]}
            scale=${[r.w, 0.22, r.w]}
            color=${r.color} />
        `)}
      </${Instances}>

      <!-- Setback second tiers on tall box buildings -->
      <${Instances} limit=${Math.max(1, TIERED_BLDGS.length)} castShadow>
        <boxGeometry args=${[1, 1, 1]} />
        <meshStandardMaterial roughness=${0.85} />
        ${TIERED_BLDGS.map((b, i) => html`
          <${Instance} key=${i}
            position=${[b.x, b.groundY + b.h + b.t2.h / 2, b.z]}
            scale=${[b.t2.w, b.t2.h, b.t2.d]}
            color=${b.color} />
        `)}
      </${Instances}>

      <!-- Roof caps — sit on the top tier when present -->
      <${Instances} limit=${Math.max(1, BOX_BLDGS.length)} castShadow>
        <boxGeometry args=${[1, 1, 1]} />
        <meshStandardMaterial roughness=${0.9} />
        ${BOX_BLDGS.map((b, i) => html`
          <${Instance} key=${i}
            position=${[b.x, b.groundY + b.h + (b.t2 ? b.t2.h : 0) + 0.09, b.z]}
            scale=${[(b.t2 ? b.t2.w : b.w) + 0.14, 0.18, (b.t2 ? b.t2.d : b.d) + 0.14]}
            color=${b.roofColor} />
        `)}
      </${Instances}>

      <!-- Cylinder roof caps -->
      <${Instances} limit=${Math.max(1, CYL_BLDGS.length)} castShadow>
        <cylinderGeometry args=${[0.5, 0.5, 1, 20]} />
        <meshStandardMaterial roughness=${0.9} />
        ${CYL_BLDGS.map((b, i) => html`
          <${Instance} key=${i}
            position=${[b.x, b.groundY + b.h + 0.08, b.z]}
            scale=${[b.w + 0.14, 0.16, b.w + 0.14]}
            color=${b.roofColor} />
        `)}
      </${Instances}>

      <!-- Parapet railings -->
      <${Instances} limit=${Math.max(1, ROOF_RAILS.length)}>
        <boxGeometry args=${[1, 0.2, 0.05]} />
        <meshStandardMaterial color="#3c4148" roughness=${0.6} metalness=${0.4} />
        ${ROOF_RAILS.map((r, i) => html`
          <${Instance} key=${i}
            position=${[r.x, r.y, r.z]}
            rotation=${[0, r.ry, 0]}
            scale=${[r.len, 1, 1]} />
        `)}
      </${Instances}>

      <!-- Ground-floor band — storefront plinth in a deeper shade -->
      <${Instances} limit=${Math.max(1, BOX_BLDGS.length)} receiveShadow>
        <boxGeometry args=${[1, 1, 1]} />
        <meshStandardMaterial roughness=${0.9} />
        ${BOX_BLDGS.map((b, i) => html`
          <${Instance} key=${i}
            position=${[b.x, b.groundY + 0.35, b.z]}
            scale=${[b.w + 0.08, 0.7, b.d + 0.08]}
            color=${b.baseColor} />
        `)}
      </${Instances}>

      <!-- Rooftop AC units -->
      <${Instances} limit=${Math.max(1, ROOF_UNITS.length)} castShadow>
        <boxGeometry args=${[0.55, 0.32, 0.45]} />
        <meshStandardMaterial color="#b8bcc2" roughness=${0.6} metalness=${0.35} />
        ${ROOF_UNITS.map((u, i) => html`
          <${Instance} key=${i}
            position=${[u.x, u.y, u.z]}
            rotation=${[0, u.ry, 0]}
            scale=${[u.s, u.s, u.s]} />
        `)}
      </${Instances}>

      <!-- Rooftop water tanks -->
      <${Instances} limit=${Math.max(1, ROOF_TANKS.length)} castShadow>
        <cylinderGeometry args=${[0.28, 0.32, 0.7, 10]} />
        <meshStandardMaterial color="#8a7a64" roughness=${0.8} />
        ${ROOF_TANKS.map((t, i) => html`
          <${Instance} key=${i} position=${[t.x, t.y, t.z]} scale=${[t.s, t.s, t.s]} />
        `)}
      </${Instances}>
    </group>
  `;
}

/* =========================================================
   Wind turbines — pole + nacelle + 3 rotating blades
   ========================================================= */
const TURBINES = [];
{
  let attempts = 0;
  while (TURBINES.length < 5 && attempts < 400) {
    attempts++;
    const x = (Math.random() - 0.5) * 180;
    const z = (Math.random() - 0.5) * 180;
    const d2 = x * x + z * z;
    if (d2 < 38 * 38) continue;     // outside the wider city footprint
    if (d2 > 95 * 95) continue;     // not past the fog
    let clear = true;
    for (const t of TURBINES) {
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz < 18 * 18) { clear = false; break; }
    }
    if (!clear) continue;
    TURBINES.push({ x, z, hy: hillHeight(x, z) });
  }
}

function WindTurbines() {
  const rotorsRef = useRef([]);
  useFrame((_, dt) => {
    const cdt = Math.min(dt, 0.05);
    for (const r of rotorsRef.current) if (r) r.rotation.z += 1.4 * cdt;
  });
  return html`
    <group>
      ${TURBINES.map((t, i) => html`
        <group key=${i} position=${[t.x, t.hy, t.z]}>
          <mesh position=${[0, 8, 0]} castShadow>
            <cylinderGeometry args=${[0.18, 0.32, 16, 12]} />
            <meshStandardMaterial color="#f0eadc" roughness=${0.55} />
          </mesh>
          <mesh position=${[0, 16, 0]} castShadow>
            <boxGeometry args=${[0.55, 0.5, 1.2]} />
            <meshStandardMaterial color="#e0d8c8" roughness=${0.55} />
          </mesh>
          <group ref=${(el) => (rotorsRef.current[i] = el)} position=${[0, 16, 0.65]}>
            ${[0, 1, 2].map((k) => {
              const a = (k * Math.PI * 2) / 3;
              return html`
                <mesh key=${k}
                  position=${[Math.cos(a) * 2.8, Math.sin(a) * 2.8, 0]}
                  rotation=${[0, 0, a + Math.PI / 2]}>
                  <boxGeometry args=${[0.45, 5.6, 0.05]} />
                  <meshStandardMaterial color="#fafaf2" roughness=${0.35} />
                </mesh>
              `;
            })}
            <mesh>
              <sphereGeometry args=${[0.22, 12, 12]} />
              <meshStandardMaterial color="#e8e0d0" roughness=${0.5} />
            </mesh>
          </group>
        </group>
      `)}
    </group>
  `;
}

/* =========================================================
   Helicopter — random walk over the city. Picks a target,
   flies to it, picks a new one. Heading smoothly tracks the
   velocity direction.
   ========================================================= */
function Helicopter({ spawn, speed = 4, bodyColor = "#5c80b8", trimColor = "#3a4a64" }) {
  const heliRef = useRef();
  const mainRef = useRef();
  const tailRef = useRef();
  const pos = useRef([...spawn]);
  const target = useRef([0, spawn[1], 0]);
  const heading = useRef(0);

  function pickTarget() {
    target.current = [
      (Math.random() - 0.5) * 90,
      18 + Math.random() * 14,
      (Math.random() - 0.5) * 90,
    ];
  }

  useEffect(() => {
    pickTarget();
  }, []);

  useFrame((_, dt) => {
    const cdt = Math.min(dt, 0.05);
    const [px, py, pz] = pos.current;
    const [tx, ty, tz] = target.current;
    const dx = tx - px, dy = ty - py, dz = tz - pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < 2.5) {
      pickTarget();
    } else {
      const step = speed * cdt;
      pos.current[0] += (dx / dist) * step;
      pos.current[1] += (dy / dist) * step;
      pos.current[2] += (dz / dist) * step;

      // Heading: face the horizontal velocity direction (cockpit at +X local)
      const desiredH = Math.atan2(-dz, dx);
      let dh = desiredH - heading.current;
      while (dh >  Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      heading.current += dh * Math.min(1, 2.2 * cdt);
    }

    if (heliRef.current) {
      heliRef.current.position.set(pos.current[0], pos.current[1], pos.current[2]);
      heliRef.current.rotation.y = heading.current;
    }
    if (mainRef.current) mainRef.current.rotation.y += 24 * cdt;
    if (tailRef.current) tailRef.current.rotation.x += 30 * cdt;
  });

  return html`
    <group ref=${heliRef}>
      <mesh>
        <boxGeometry args=${[1.7, 0.9, 0.9]} />
        <meshStandardMaterial color=${bodyColor} roughness=${0.35} metalness=${0.4} />
      </mesh>
      <mesh position=${[0.7, 0.15, 0]}>
        <boxGeometry args=${[0.55, 0.55, 0.72]} />
        <meshStandardMaterial color="#1f2a3a" roughness=${0.2} metalness=${0.65} />
      </mesh>
      <mesh position=${[-1.55, 0.12, 0]}>
        <boxGeometry args=${[1.8, 0.26, 0.26]} />
        <meshStandardMaterial color=${bodyColor} roughness=${0.35} metalness=${0.4} />
      </mesh>
      <mesh position=${[-2.55, 0.32, 0]}>
        <boxGeometry args=${[0.25, 0.35, 0.05]} />
        <meshStandardMaterial color=${trimColor} roughness=${0.5} />
      </mesh>
      <group ref=${tailRef} position=${[-2.55, 0.22, 0.08]}>
        <mesh>
          <boxGeometry args=${[0.05, 0.6, 0.04]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>
        <mesh rotation=${[0, 0, Math.PI / 2]}>
          <boxGeometry args=${[0.05, 0.6, 0.04]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>
      </group>
      <group ref=${mainRef} position=${[0.1, 0.7, 0]}>
        <mesh>
          <boxGeometry args=${[3.0, 0.05, 0.20]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>
        <mesh rotation=${[0, Math.PI / 2, 0]}>
          <boxGeometry args=${[3.0, 0.05, 0.20]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>
        <mesh>
          <cylinderGeometry args=${[0.10, 0.10, 0.18, 12]} />
          <meshStandardMaterial color="#3a3a3a" />
        </mesh>
      </group>
      <mesh position=${[0, -0.55, 0.50]}>
        <boxGeometry args=${[1.5, 0.05, 0.06]} />
        <meshStandardMaterial color="#3a3a3a" />
      </mesh>
      <mesh position=${[0, -0.55, -0.50]}>
        <boxGeometry args=${[1.5, 0.05, 0.06]} />
        <meshStandardMaterial color="#3a3a3a" />
      </mesh>
    </group>
  `;
}

/* =========================================================
   Trees — instanced trunk + foliage (pine cones / round)
   ========================================================= */
const TREES = [];
{
  /* Pick forest cluster centers around the hills outside the city,
     keeping a min spacing between centers so the patches read as
     distinct forests rather than one continuous mat. */
  /* Area-uniform polar sampling so the woods read evenly across the
     whole landscape instead of bunching near the city. r drawn from
     sqrt(r_min² + u·(r_max²-r_min²)) → constant tree-density per area. */
  const clusters = [];
  let attempts = 0;
  const R_MIN = 33, R_MAX = 135;     // extended far edge — valley walls are taller
  const R_MIN2 = R_MIN * R_MIN, R_MAX2 = R_MAX * R_MAX;
  while (clusters.length < 90 && attempts < 4000) {
    attempts++;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(R_MIN2 + Math.random() * (R_MAX2 - R_MIN2));
    const cx = Math.cos(angle) * r;
    const cz = Math.sin(angle) * r;
    let ok = true;
    for (const c of clusters) {
      const dx = cx - c.x, dz = cz - c.z;
      if (dx * dx + dz * dz < 10 * 10) { ok = false; break; }
    }
    if (!ok) continue;
    clusters.push({
      x: cx, z: cz,
      radius: 6 + Math.random() * 8,
    });
  }

  /* For each cluster, place 28-52 trees. Radius uses sqrt of a uniform
     so density is biased toward the cluster center → forest core + thin
     edges, not a uniform disk. */
  for (const cluster of clusters) {
    const target = 24 + Math.floor(Math.random() * 22);  // 24-46 trees per cluster
    let placed = 0, tries = 0;
    while (placed < target && tries < target * 6) {
      tries++;
      const r = Math.sqrt(Math.random()) * cluster.radius;
      const a = Math.random() * Math.PI * 2;
      const x = cluster.x + Math.cos(a) * r;
      const z = cluster.z + Math.sin(a) * r;
      const r2 = x * x + z * z;
      if (r2 > 140 * 140) continue;
      if (Math.abs(x) < 27 && Math.abs(z) < 20) continue;
      let clear = true;
      for (const t of TURBINES) {
        const dx = x - t.x, dz = z - t.z;
        if (dx * dx + dz * dz < 12) { clear = false; break; }
      }
      if (clear) for (const sc of SCULPT_CENTERS) {
        const dx = x - sc.x, dz = z - sc.z;
        if (dx * dx + dz * dz < 49) { clear = false; break; }   // gate plazas
      }
      if (!clear) continue;
      TREES.push({
        x, z,
        hy: hillHeight(x, z) - 0.25,
        type: Math.random() < 0.66 ? "pine" : "round",
        s: 0.85 + Math.random() * 0.55,
      });
      placed++;
    }
  }
}
const PINE_TREES  = TREES.filter((t) => t.type === "pine");
const ROUND_TREES = TREES.filter((t) => t.type === "round");
const PINE_COLORS  = ["#3e8a30", "#4a9438", "#2e8048", "#4c9028", "#388830", "#5a9c34"];
const ROUND_COLORS = ["#74c050", "#88d058", "#9cc858", "#80b848", "#a8d068", "#7cb850"];

/* Raw InstancedMesh trees — skips drei's per-Instance React reconciliation.
   One setMatrixAt + setColorAt pass on mount, then the GPU buffers stay
   static for the rest of the session (trees never move). */
const TREE_COUNT  = Math.max(1, TREES.length);
const PINE_COUNT  = Math.max(1, PINE_TREES.length);
const ROUND_COUNT = Math.max(1, ROUND_TREES.length);

function Trees() {
  const trunkRef = useRef();
  const pineRef  = useRef();
  const roundRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!trunkRef.current || !pineRef.current || !roundRef.current) return;
    const c = new THREE.Color();

    // Trunks
    for (let i = 0; i < TREES.length; i++) {
      const t = TREES[i];
      dummy.position.set(t.x, t.hy + 0.5 * t.s, t.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.updateMatrix();
      trunkRef.current.setMatrixAt(i, dummy.matrix);
    }
    trunkRef.current.instanceMatrix.needsUpdate = true;

    // Pine cones
    for (let i = 0; i < PINE_TREES.length; i++) {
      const t = PINE_TREES[i];
      dummy.position.set(t.x, t.hy + (1 + 1.3) * t.s, t.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.updateMatrix();
      pineRef.current.setMatrixAt(i, dummy.matrix);
      c.set(PINE_COLORS[i % PINE_COLORS.length]);
      pineRef.current.setColorAt(i, c);
    }
    pineRef.current.instanceMatrix.needsUpdate = true;
    if (pineRef.current.instanceColor) pineRef.current.instanceColor.needsUpdate = true;

    // Round foliage
    for (let i = 0; i < ROUND_TREES.length; i++) {
      const t = ROUND_TREES[i];
      dummy.position.set(t.x, t.hy + (1 + 0.85) * t.s, t.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.updateMatrix();
      roundRef.current.setMatrixAt(i, dummy.matrix);
      c.set(ROUND_COLORS[i % ROUND_COLORS.length]);
      roundRef.current.setColorAt(i, c);
    }
    roundRef.current.instanceMatrix.needsUpdate = true;
    if (roundRef.current.instanceColor) roundRef.current.instanceColor.needsUpdate = true;
  }, []);

  return html`
    <group>
      <instancedMesh ref=${trunkRef} args=${[undefined, undefined, TREE_COUNT]} castShadow receiveShadow>
        <cylinderGeometry args=${[0.14, 0.18, 1, 8]} />
        <meshStandardMaterial color="#7a4a2a" roughness=${0.95} />
      </instancedMesh>
      <instancedMesh ref=${pineRef} args=${[undefined, undefined, PINE_COUNT]} castShadow>
        <coneGeometry args=${[1.1, 2.6, 8]} />
        <meshStandardMaterial roughness=${0.85} />
      </instancedMesh>
      <instancedMesh ref=${roundRef} args=${[undefined, undefined, ROUND_COUNT]} castShadow>
        <sphereGeometry args=${[0.95, 10, 10]} />
        <meshStandardMaterial roughness=${0.85} />
      </instancedMesh>
    </group>
  `;
}

/* =========================================================
   Cars — instanced bodies / cabins / 4 wheels per car on
   circular tracks. Two opposing rings forms a two-lane road.
   ========================================================= */
const CAR_COLORS = [
  "#e83030", "#2050d8", "#f0c020", "#30a850",
  "#f0f0f0", "#181818", "#8030c0", "#f07028",
  "#20a8c8", "#e04080", "#60d040", "#d0d0d0",
];

/* Cars on a STREET GRID, not a circle.
   Streets run along the gaps between building rows/cols.
   Each car has a fixed perpendicular position and slides
   along its axis, wrapping at the city edge. */
/* =========================================================
   Closed perimeter loop road — cars drive forever around it,
   no teleport at edges. Inner grid streets are gone.
   ========================================================= */
const CAR_LOOP = { xMin: -26, xMax: 26, zMin: -18, zMax: 18 };
const LOOP_W = CAR_LOOP.xMax - CAR_LOOP.xMin;    // 52
const LOOP_H = CAR_LOOP.zMax - CAR_LOOP.zMin;    // 36
const LOOP_PERIM = 2 * (LOOP_W + LOOP_H);        // 176
const ROAD_LANE = 2.4;

/* Position + heading at distance t along the loop (clockwise from top-left).
   Sequence: top (going +x) → right (going -z) → bottom (going -x) → left (going +z) */
function perimeterPos(t) {
  let tt = ((t % LOOP_PERIM) + LOOP_PERIM) % LOOP_PERIM;
  if (tt < LOOP_W) {
    return { x: CAR_LOOP.xMin + tt, z: CAR_LOOP.zMax, heading: 0 };
  }
  tt -= LOOP_W;
  if (tt < LOOP_H) {
    return { x: CAR_LOOP.xMax, z: CAR_LOOP.zMax - tt, heading: Math.PI / 2 };
  }
  tt -= LOOP_H;
  if (tt < LOOP_W) {
    return { x: CAR_LOOP.xMax - tt, z: CAR_LOOP.zMin, heading: Math.PI };
  }
  tt -= LOOP_W;
  return { x: CAR_LOOP.xMin, z: CAR_LOOP.zMin + tt, heading: -Math.PI / 2 };
}

const INNER_STREETS_H = [-11.6, -5.8, 5.8, 11.6];
const INNER_STREETS_V = [-20.3, -14.5, -8.7, 8.7, 14.5, 20.3];
const INNER_LANE = 1.8;
const INNER_LEN_H = LOOP_W - ROAD_LANE;  // butt-joins the loop's inner edge
const INNER_LEN_V = LOOP_H - ROAD_LANE;

function Roads() {
  return html`
    <group>
      <!-- Pale city pad — the whole downtown sits on one light slab, so
           roads read as paved urban block instead of blending into the
           meadow (reference: Windland's platform) -->
      <mesh position=${[0, 0.012, 0]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[(CAR_LOOP.xMax + ROAD_LANE / 2 + 1.6) * 2, (CAR_LOOP.zMax + ROAD_LANE / 2 + 1.6) * 2]} />
        <meshStandardMaterial color="#dce1d6" roughness=${0.95} />
      </mesh>

      <!-- Light curb base under each inner street so the dark asphalt
           pops against the grass instead of blending into the terrain -->
      ${INNER_STREETS_H.map((z, i) => html`
        <mesh key=${`ihb${i}`} position=${[0, 0.026, z]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
          <planeGeometry args=${[INNER_LEN_H, INNER_LANE + 1.1]} />
          <meshStandardMaterial color="#cdc7b6" roughness=${0.95} />
        </mesh>
      `)}
      ${INNER_STREETS_V.map((x, i) => html`
        <mesh key=${`ivb${i}`} position=${[x, 0.027, 0]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
          <planeGeometry args=${[INNER_LANE + 1.1, INNER_LEN_V]} />
          <meshStandardMaterial color="#cdc7b6" roughness=${0.95} />
        </mesh>
      `)}

      <!-- Inner grid streets (no cars, just pavement). Y values bumped
           apart (5mm gaps) to kill z-fighting at intersections. -->
      ${INNER_STREETS_H.map((z, i) => html`
        <mesh key=${`ih${i}`} position=${[0, 0.030, z]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
          <planeGeometry args=${[INNER_LEN_H, INNER_LANE]} />
          <meshStandardMaterial color="#3a3634" roughness=${0.95} />
        </mesh>
      `)}
      ${INNER_STREETS_V.map((x, i) => html`
        <mesh key=${`iv${i}`} position=${[x, 0.035, 0]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
          <planeGeometry args=${[INNER_LANE, INNER_LEN_V]} />
          <meshStandardMaterial color="#3a3634" roughness=${0.95} />
        </mesh>
      `)}
      <!-- Perimeter loop -->
      <mesh position=${[0, 0.040, CAR_LOOP.zMax]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[LOOP_W + ROAD_LANE, ROAD_LANE]} />
        <meshStandardMaterial color="#3a3634" roughness=${0.95} />
      </mesh>
      <mesh position=${[0, 0.040, CAR_LOOP.zMin]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[LOOP_W + ROAD_LANE, ROAD_LANE]} />
        <meshStandardMaterial color="#3a3634" roughness=${0.95} />
      </mesh>
      <mesh position=${[CAR_LOOP.xMax, 0.040, 0]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[ROAD_LANE, LOOP_H]} />
        <meshStandardMaterial color="#3a3634" roughness=${0.95} />
      </mesh>
      <mesh position=${[CAR_LOOP.xMin, 0.040, 0]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[ROAD_LANE, LOOP_H]} />
        <meshStandardMaterial color="#3a3634" roughness=${0.95} />
      </mesh>
      <!-- Sidewalk ring just outside the perimeter loop -->
      <mesh position=${[0, 0.030, CAR_LOOP.zMax + ROAD_LANE / 2 + 0.55]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[LOOP_W + ROAD_LANE + 2.4, 1.1]} />
        <meshStandardMaterial color="#cdc7b6" roughness=${0.95} />
      </mesh>
      <mesh position=${[0, 0.030, CAR_LOOP.zMin - ROAD_LANE / 2 - 0.55]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[LOOP_W + ROAD_LANE + 2.4, 1.1]} />
        <meshStandardMaterial color="#cdc7b6" roughness=${0.95} />
      </mesh>
      <mesh position=${[CAR_LOOP.xMax + ROAD_LANE / 2 + 0.55, 0.030, 0]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[1.1, LOOP_H + ROAD_LANE]} />
        <meshStandardMaterial color="#cdc7b6" roughness=${0.95} />
      </mesh>
      <mesh position=${[CAR_LOOP.xMin - ROAD_LANE / 2 - 0.55, 0.030, 0]} rotation=${[-Math.PI/2, 0, 0]} receiveShadow>
        <planeGeometry args=${[1.1, LOOP_H + ROAD_LANE]} />
        <meshStandardMaterial color="#cdc7b6" roughness=${0.95} />
      </mesh>

      <!-- Dashed centerlines (one instanced group per side) -->
      ${[
        ...Array.from({ length: 14 }, (_, i) => ({ kind: "h", x: CAR_LOOP.xMin + 1.8 + i * 3.6, z: CAR_LOOP.zMax })),
        ...Array.from({ length: 14 }, (_, i) => ({ kind: "h", x: CAR_LOOP.xMin + 1.8 + i * 3.6, z: CAR_LOOP.zMin })),
        ...Array.from({ length: 9 },  (_, i) => ({ kind: "v", x: CAR_LOOP.xMin,                  z: CAR_LOOP.zMin + 1.8 + i * 3.6 })),
        ...Array.from({ length: 9 },  (_, i) => ({ kind: "v", x: CAR_LOOP.xMax,                  z: CAR_LOOP.zMin + 1.8 + i * 3.6 })),
      ].map((d, i) => html`
        <mesh key=${i} position=${[d.x, 0.050, d.z]} rotation=${[-Math.PI/2, 0, 0]}>
          <planeGeometry args=${d.kind === "h" ? [1.2, 0.12] : [0.12, 1.2]} />
          <meshStandardMaterial color="#e8e0c8" roughness=${0.7} />
        </mesh>
      `)}
    </group>
  `;
}

/* =========================================================
   Clouds — sprite-based. One soft-white texture rendered as
   GL_POINTS, so every cloud is a single billboard quad that
   auto-faces the camera. 300+ instances draw in one call.
   ========================================================= */
function makeCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0.0,  "rgba(255,255,255,1.0)");
  g.addColorStop(0.30, "rgba(255,255,255,0.85)");
  g.addColorStop(0.65, "rgba(255,255,255,0.35)");
  g.addColorStop(1.0,  "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
const CLOUD_TEX = makeCloudTexture();

const CLOUD_PUFFS = [];
{
  // Each cluster spawns 12-22 tightly grouped sprite puffs so the
  // billboards merge visually into a single cumulus shape rather than
  // reading as isolated dots.
  // Fewer, LARGER clusters — each cloud is a big sprawling cumulus
  const SKY_CLUSTERS = 24;
  for (let i = 0; i < SKY_CLUSTERS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 160;
    const cx = Math.cos(angle) * r;
    const cy = 28 + Math.random() * 18;
    const cz = Math.sin(angle) * r;
    const puffs = 32 + Math.floor(Math.random() * 18);   // 32-49 puffs per cloud
    const clusterSize = 5.5 + Math.random() * 4.5;       // 5.5-10m sprawl
    for (let j = 0; j < puffs; j++) {
      const pa = Math.random() * Math.PI * 2;
      const pd = Math.sqrt(Math.random()) * clusterSize;
      CLOUD_PUFFS.push({
        ox: cx + Math.cos(pa) * pd,
        oy: cy + (Math.random() - 0.5) * 2.2,
        oz: cz + Math.sin(pa) * pd,
        size: 20 + Math.random() * 14,
      });
    }
  }
  const CITY_CLUSTERS = 7;
  for (let i = 0; i < CITY_CLUSTERS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 22;
    const cx = Math.cos(angle) * r;
    const cy = 24 + Math.random() * 12;
    const cz = Math.sin(angle) * r;
    const puffs = 34 + Math.floor(Math.random() * 16);
    const clusterSize = 5.0 + Math.random() * 4.0;
    for (let j = 0; j < puffs; j++) {
      const pa = Math.random() * Math.PI * 2;
      const pd = Math.sqrt(Math.random()) * clusterSize;
      CLOUD_PUFFS.push({
        ox: cx + Math.cos(pa) * pd,
        oy: cy + (Math.random() - 0.5) * 2.0,
        oz: cz + Math.sin(pa) * pd,
        size: 22 + Math.random() * 13,
      });
    }
  }
}
const CLOUD_WRAP = 170;

function CloudLayer() {
  const pointsRef = useRef();
  const frameRef = useRef(0);

  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(CLOUD_PUFFS.length * 3);
    const sizes = new Float32Array(CLOUD_PUFFS.length);
    for (let i = 0; i < CLOUD_PUFFS.length; i++) {
      const p = CLOUD_PUFFS[i];
      positions[i * 3 + 0] = p.ox;
      positions[i * 3 + 1] = p.oy;
      positions[i * 3 + 2] = p.oz;
      sizes[i] = p.size;
    }
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const m = new THREE.ShaderMaterial({
      uniforms: { cloudTex: { value: CLOUD_TEX } },
      vertexShader: /* glsl */ `
        attribute float size;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D cloudTex;
        void main() {
          vec4 tex = texture2D(cloudTex, gl_PointCoord);
          if (tex.a < 0.02) discard;
          gl_FragColor = vec4(1.0, 0.99, 0.96, tex.a * 0.38);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    return { geometry: g, material: m };
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;
    frameRef.current++;
    if (frameRef.current % 2 !== 0) return;  // drift every other frame
    const t = state.clock.elapsedTime;
    const drift = 1.2;                              // faster cloud drift
    const positions = geometry.attributes.position.array;
    for (let i = 0; i < CLOUD_PUFFS.length; i++) {
      const p = CLOUD_PUFFS[i];
      let x = p.ox + t * drift;
      x = ((x + CLOUD_WRAP) % (CLOUD_WRAP * 2)) - CLOUD_WRAP;
      positions[i * 3 + 0] = x;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return html`<points ref=${pointsRef} args=${[geometry, material]} />`;
}

/* =========================================================
   Sky dome — stylized LDR gradient instead of drei's physical
   <Sky>. The physical sky is HDR (the sun region outputs values
   far above 1.0), which permanently trips the bloom pass and
   gets washed milky by ACES tone mapping. A gradient dome stays
   ≤ 1.0 everywhere: never blooms, keeps its saturated blue, and
   matches the low-poly aesthetic. toneMapped=false so ACES
   doesn't desaturate it; fog=false so the distance fog doesn't
   gray it out.
   ========================================================= */
/* Shared registry of refs the DayCycle controller mutates per frame —
   avoids re-rendering React for continuous time-of-day changes. */
const CYCLE_REFS = {
  dir: null, hemi: null, amb: null, rim: null,
  skyMat: null, sunMesh: null, moonMesh: null,
  litMat: null, duskMat: null, lampMat: null, controls: null, dof: null,
};

function SkyDome({ onSun }) {
  // Gradient dome as a shader: three color uniforms blended by altitude.
  // The DayCycle controller writes the uniforms every frame, so the sky
  // can sweep through dawn → noon → dusk → night continuously.
  const skyMat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith:  { value: new THREE.Color("#2f8fe0") },
      uMid:     { value: new THREE.Color("#6db9f0") },
      uHorizon: { value: new THREE.Color("#c4e2f8") },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uZenith;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      void main() {
        float h = normalize(vDir).y;
        vec3 c = mix(uHorizon, uMid, smoothstep(-0.08, 0.30, h));
        c = mix(c, uZenith, smoothstep(0.30, 0.85, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  }), []);
  useEffect(() => { CYCLE_REFS.skyMat = skyMat; }, [skyMat]);

  return html`
    <group>
      <mesh material=${skyMat}>
        <sphereGeometry args=${[400, 32, 24]} />
      </mesh>
      <!-- Sun disc — position + tint driven by DayCycle; also feeds GodRays -->
      <mesh
        ref=${(m) => { CYCLE_REFS.sunMesh = m; if (m && onSun) onSun(m); }}
        position=${[112, 288, 96]}>
        <sphereGeometry args=${[15, 16, 16]} />
        <meshStandardMaterial
          color="#000000"
          emissive="#fff2c8"
          emissiveIntensity=${2.3}
          toneMapped=${false}
          fog=${false}
        />
      </mesh>
      <!-- Moon disc — opposite the sun, visible at night -->
      <mesh ref=${(m) => (CYCLE_REFS.moonMesh = m)} position=${[0, -370, 0]} visible=${false}>
        <sphereGeometry args=${[11, 16, 16]} />
        <meshStandardMaterial
          color="#0a0c14"
          emissive="#dce6ff"
          emissiveIntensity=${1.5}
          toneMapped=${false}
          fog=${false}
        />
      </mesh>
    </group>
  `;
}

/* =========================================================
   Day cycle — keyframed time-of-day. u ∈ [0,1): 0 = sunrise,
   0.25 = noon, 0.5 = sunset, 0.75 = midnight. Modes:
     'day'   → ease u to noon and hold
     'dusk'  → ease u to sunset and hold
     'cycle' → u advances continuously (full day in 90s)
   All values are lerped between keyframes and written straight
   into refs — zero React re-renders per frame.
   ========================================================= */
const DAY_LENGTH_S = 150;   // slower sun → smoother shadow sweep
const _DC = (hex) => new THREE.Color(hex);
const CYCLE_KEYS = [
  { u: 0.00, zen: _DC("#46559e"), mid: _DC("#d98f9b"), hor: _DC("#ffc890"), sun: _DC("#ffb070"), sunI: 1.15, hSky: _DC("#d8a4a4"), hGnd: _DC("#6a5a48"), hI: 0.50, amb: 0.18, fog: _DC("#f4c8a6"), bg: _DC("#d98f9b"), win: 0.65, rim: 0.45 },
  { u: 0.10, zen: _DC("#2f8fe0"), mid: _DC("#6db9f0"), hor: _DC("#d8ecf8"), sun: _DC("#ffe8b8"), sunI: 2.10, hSky: _DC("#bdd6ea"), hGnd: _DC("#88a850"), hI: 0.65, amb: 0.23, fog: _DC("#e2f0fa"), bg: _DC("#6db9f0"), win: 0.15, rim: 0.40 },
  { u: 0.25, zen: _DC("#2f8fe0"), mid: _DC("#6db9f0"), hor: _DC("#c4e2f8"), sun: _DC("#fff4cc"), sunI: 2.50, hSky: _DC("#bdd6ea"), hGnd: _DC("#88a850"), hI: 0.70, amb: 0.25, fog: _DC("#dceefb"), bg: _DC("#6db9f0"), win: 0.00, rim: 0.40 },
  { u: 0.40, zen: _DC("#3585d2"), mid: _DC("#7fb6e8"), hor: _DC("#e8e2c8"), sun: _DC("#ffeab8"), sunI: 2.20, hSky: _DC("#c2d2e2"), hGnd: _DC("#8aa050"), hI: 0.62, amb: 0.22, fog: _DC("#e8ecd8"), bg: _DC("#7fb6e8"), win: 0.10, rim: 0.42 },
  { u: 0.50, zen: _DC("#3d4a8c"), mid: _DC("#8a64a4"), hor: _DC("#f0966a"), sun: _DC("#ff9a55"), sunI: 1.70, hSky: _DC("#c8909e"), hGnd: _DC("#6a5a48"), hI: 0.45, amb: 0.18, fog: _DC("#f6c391"), bg: _DC("#c98a92"), win: 1.00, rim: 0.55 },
  { u: 0.62, zen: _DC("#1c2350"), mid: _DC("#343c70"), hor: _DC("#6a4a72"), sun: _DC("#9ab0d8"), sunI: 0.32, hSky: _DC("#41507a"), hGnd: _DC("#2c3022"), hI: 0.30, amb: 0.14, fog: _DC("#5a5c84"), bg: _DC("#343c70"), win: 1.00, rim: 0.30 },
  { u: 0.75, zen: _DC("#0d1226"), mid: _DC("#162038"), hor: _DC("#27334e"), sun: _DC("#aac4e8"), sunI: 0.40, hSky: _DC("#2e3c58"), hGnd: _DC("#1c2418"), hI: 0.26, amb: 0.12, fog: _DC("#222b42"), bg: _DC("#162038"), win: 1.00, rim: 0.28 },
  { u: 0.90, zen: _DC("#222b5e"), mid: _DC("#3c4078"), hor: _DC("#7a5878"), sun: _DC("#b8c0dc"), sunI: 0.36, hSky: _DC("#4a4a6a"), hGnd: _DC("#33301f"), hI: 0.32, amb: 0.15, fog: _DC("#6a6488"), bg: _DC("#3c4078"), win: 0.90, rim: 0.32 },
];

// Scratch sample — colors + scalars lerped into here every frame (no GC)
const _CY = {
  zen: new THREE.Color(), mid: new THREE.Color(), hor: new THREE.Color(),
  sun: new THREE.Color(), hSky: new THREE.Color(), hGnd: new THREE.Color(),
  fog: new THREE.Color(), bg: new THREE.Color(),
  sunI: 0, hI: 0, amb: 0, win: 0, rim: 0,
};

function sampleCycle(u) {
  const keys = CYCLE_KEYS;
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i];
    const b = keys[(i + 1) % keys.length];
    const end = b.u > a.u ? b.u : b.u + 1;
    const uu = u >= a.u ? u : u + 1;
    if (uu >= a.u && uu < end) {
      const t = (uu - a.u) / (end - a.u);
      _CY.zen.lerpColors(a.zen, b.zen, t);
      _CY.mid.lerpColors(a.mid, b.mid, t);
      _CY.hor.lerpColors(a.hor, b.hor, t);
      _CY.sun.lerpColors(a.sun, b.sun, t);
      _CY.hSky.lerpColors(a.hSky, b.hSky, t);
      _CY.hGnd.lerpColors(a.hGnd, b.hGnd, t);
      _CY.fog.lerpColors(a.fog, b.fog, t);
      _CY.bg.lerpColors(a.bg, b.bg, t);
      _CY.sunI = a.sunI + (b.sunI - a.sunI) * t;
      _CY.hI   = a.hI   + (b.hI   - a.hI)   * t;
      _CY.amb  = a.amb  + (b.amb  - a.amb)  * t;
      _CY.win  = a.win  + (b.win  - a.win)  * t;
      _CY.rim  = a.rim  + (b.rim  - a.rim)  * t;
      return;
    }
  }
}

const _WIN_DARK = new THREE.Color("#161c2a");
const _WIN_WARM = new THREE.Color("#ffd28a");
const _WIN_EMIT = new THREE.Color("#ff9c4a");
const _WIN_OFF  = new THREE.Color("#000000");

function DayCycle({ mode }) {
  const { scene } = useThree();
  const uRef = useRef(0.25);          // start at noon
  const lastBake = useRef(0.25);

  useFrame((_, dt) => {
    const cdt = Math.min(dt, 0.1);
    let u = uRef.current;
    if (mode === "cycle") {
      // Continuous day/night: daylight at full pace, night gently
      // compressed (~2.5×) so the dark stretch stays a mood beat,
      // not a wait. Always smooth, no pops at the wrap.
      const nightSpeed = u > 0.5 ? 2.5 : 1;
      u = (u + (cdt * nightSpeed) / DAY_LENGTH_S) % 1;
    } else {
      // Ease toward the mode's fixed time (shortest way around the clock)
      const target = mode === "dusk" ? 0.5 : 0.25;
      let d = target - u;
      if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
      if (Math.abs(d) > 0.0004) u = ((u + d * Math.min(1, cdt * 1.6)) % 1 + 1) % 1;
    }
    uRef.current = u;
    sampleCycle(u);

    // Sun path: u=0 east horizon → 0.25 overhead → 0.5 west horizon → night
    const ang = u * Math.PI * 2;
    const elev = Math.sin(ang) * (Math.PI / 3.1);
    const az = ang + 0.35;
    const ce = Math.cos(elev);
    const dx = Math.cos(az) * ce;
    const dy = Math.sin(elev);
    const dz = Math.sin(az) * ce * 0.55;

    const R = CYCLE_REFS;
    if (R.dir) {
      // Below the horizon the key light flips to the moon's direction
      const day = dy > 0.04;
      const sx = day ? dx : -dx;
      const sy = Math.max(0.06, Math.abs(dy));
      const sz = day ? dz : -dz;
      R.dir.position.set(sx * 45, sy * 45, sz * 45);
      R.dir.color.copy(_CY.sun);
      // Fade the key light to zero through the horizon flip: the sun→moon
      // direction swap is instantaneous, and for a frame the shadow map
      // still holds the old direction — with the light dark during the
      // swap, that stale-shadow frame can't flash the screen black.
      // Ambient + hemisphere carry the scene through the dim twilight.
      const flipFade = THREE.MathUtils.smoothstep(Math.abs(dy), 0.02, 0.12);
      R.dir.intensity = _CY.sunI * flipFade;
      // Shadow cadence: while cycling the map re-renders every frame —
      // alternating-frame bakes read as flicker; constant cadence doesn't.
      if (mode === "cycle") {
        R.dir.shadow.needsUpdate = true;
      } else {
        let bd = Math.abs(u - lastBake.current);
        if (bd > 0.5) bd = 1 - bd;
        if (bd > 0.0025) {
          R.dir.shadow.needsUpdate = true;
          lastBake.current = u;
        }
      }
    }
    if (R.hemi) {
      R.hemi.intensity = _CY.hI;
      R.hemi.color.copy(_CY.hSky);
      R.hemi.groundColor.copy(_CY.hGnd);
    }
    if (R.amb) R.amb.intensity = _CY.amb;
    if (R.rim) R.rim.intensity = _CY.rim;
    if (R.skyMat) {
      R.skyMat.uniforms.uZenith.value.copy(_CY.zen);
      R.skyMat.uniforms.uMid.value.copy(_CY.mid);
      R.skyMat.uniforms.uHorizon.value.copy(_CY.hor);
    }
    if (R.sunMesh) {
      R.sunMesh.position.set(dx * 370, dy * 370, dz * 370);
      R.sunMesh.visible = dy > -0.05;
      R.sunMesh.material.emissive.copy(_CY.sun);
    }
    if (R.moonMesh) {
      R.moonMesh.position.set(-dx * 370, -dy * 370, -dz * 370);
      R.moonMesh.visible = -dy > -0.05;
    }
    if (scene.fog) scene.fog.color.copy(_CY.fog);
    if (scene.background && scene.background.isColor) scene.background.copy(_CY.bg);

    // Windows: always-lit set brightens at night; dusk pool fades on
    if (R.litMat) R.litMat.emissiveIntensity = 0.55 + 0.8 * _CY.win;
    if (R.duskMat) {
      R.duskMat.color.copy(_WIN_DARK).lerp(_WIN_WARM, _CY.win);
      R.duskMat.emissive.copy(_WIN_OFF).lerp(_WIN_EMIT, _CY.win);
      R.duskMat.emissiveIntensity = 1.05 * _CY.win;
    }
    if (R.lampMat) R.lampMat.emissiveIntensity = 0.15 + 1.8 * _CY.win;
  });

  return null;
}

/* =========================================================
   Sculpture focus — fly the camera to a monument when the
   SCULPTURES menu fires a c4-focus event. The camera and
   OrbitControls target ease toward a framed view; any user
   pointer input cancels the flight and hands control back.
   ========================================================= */
const FOCUS = {
  active: false,
  target: new THREE.Vector3(),
  camPos: new THREE.Vector3(),
};

function focusOnSculpture(name) {
  if (name === "overview") {
    FOCUS.target.set(0, 1.2, 0);
    FOCUS.camPos.set(36, 24, 46);
    FOCUS.active = true;
    return;
  }
  const views = {
    connection:    { p: FOOD_BANK,     y: 5.8, dist: 24 },
    affordability: { p: AFFORDABILITY, y: 5.8, dist: 24 },
    threshold:     { p: THRESHOLD,     y: 5.8, dist: 24 },
    transition:    { p: TRANSITION,    y: 5.8, dist: 24 },
  };
  const v = views[name];
  if (!v) return;
  const { x, z } = v.p;
  FOCUS.target.set(x, v.y, z);
  // Approach from outside the sculpture looking back toward the city
  const hl = Math.max(0.001, Math.hypot(x, z));
  const dx = x / hl, dz = z / hl;
  FOCUS.camPos.set(
    x + dx * v.dist * 0.78,
    v.y + v.dist * 0.58,
    z + dz * v.dist * 0.78
  );
  FOCUS.active = true;
}

/* Click handler shared by the four monuments: fly the camera there and
   tell the page chrome to open the matching goal card. stopPropagation
   keeps the click from also dropping a tent on the ground behind. */
function openGoal(e, name) {
  e.stopPropagation();
  focusOnSculpture(name);
  window.dispatchEvent(new CustomEvent("c4-goal", { detail: { name } }));
}

function FocusController() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const onFocus = (e) => focusOnSculpture(e.detail && e.detail.name);
    const onGrab = () => { FOCUS.active = false; };
    window.addEventListener("c4-focus", onFocus);
    gl.domElement.addEventListener("pointerdown", onGrab);
    return () => {
      window.removeEventListener("c4-focus", onFocus);
      gl.domElement.removeEventListener("pointerdown", onGrab);
    };
  }, [gl]);
  useFrame((_, dt) => {
    // Depth of field tracks whatever the orbit is looking at
    const dofEffect = CYCLE_REFS.dof;
    if (dofEffect && CYCLE_REFS.controls) {
      const d = camera.position.distanceTo(CYCLE_REFS.controls.target);
      dofEffect.cocMaterial.worldFocusDistance = d;
      dofEffect.cocMaterial.worldFocusRange = Math.max(20, d * 0.9);
    }
    if (!FOCUS.active) return;
    const controls = CYCLE_REFS.controls;
    if (!controls) return;
    const k = 1 - Math.exp(-3.5 * Math.min(dt, 0.1));
    camera.position.lerp(FOCUS.camPos, k);
    controls.target.lerp(FOCUS.target, k);
    controls.update();
    if (camera.position.distanceTo(FOCUS.camPos) < 0.25) FOCUS.active = false;
  });
  return null;
}

/* =========================================================
   Color-grade LUT — gentle teal-orange grade generated
   procedurally as a 32³ Data3DTexture (no .cube file needed):
   shadows nudge toward teal, highlights toward warm orange,
   mild S-curve contrast + ~8% saturation. Replaces the old
   HueSaturation + BrightnessContrast passes with one lookup.
   ========================================================= */
const GRADE_LUT_TEX = (() => {
  const size = 32;
  const data = new Uint8Array(size * size * size * 4);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    for (let gy = 0; gy < size; gy++) {
      for (let rx = 0; rx < size; rx++) {
        let r = rx / (size - 1), g = gy / (size - 1), b = bz / (size - 1);
        // Mild S-curve: 35% smoothstep blended with identity
        const sc = (v) => v * v * (3 - 2 * v) * 0.35 + v * 0.65;
        r = sc(r); g = sc(g); b = sc(b);
        // Teal-orange split toning by luma
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const shadow = Math.max(0, 1 - luma * 1.8);
        const high = Math.max(0, luma * 1.5 - 0.5);
        r += high * 0.045 - shadow * 0.025;
        g += high * 0.015 + shadow * 0.005;
        b += -high * 0.035 + shadow * 0.045;
        // ~8% saturation lift
        const l2 = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l2 + (r - l2) * 1.08;
        g = l2 + (g - l2) * 1.08;
        b = l2 + (b - l2) * 1.08;
        data[i++] = Math.round(clamp01(r) * 255);
        data[i++] = Math.round(clamp01(g) * 255);
        data[i++] = Math.round(clamp01(b) * 255);
        data[i++] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
})();

/* =========================================================
   Pollen — drifting yellow particles. Wind nudges them in
   +X with wrap; per-particle sine bob in Y; subtle Z weave.
   Single GL_POINTS draw via the same sprite-shader pattern.
   ========================================================= */
function makePollenTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
  g.addColorStop(0.0, "rgba(255, 240, 140, 1.0)");
  g.addColorStop(0.5, "rgba(255, 220, 100, 0.65)");
  g.addColorStop(1.0, "rgba(255, 200, 60, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}
const POLLEN_TEX = makePollenTexture();

const POLLEN_COUNT = 350;
const POLLEN_WRAP = 90;
const POLLEN = [];
for (let i = 0; i < POLLEN_COUNT; i++) {
  POLLEN.push({
    ox: (Math.random() - 0.5) * POLLEN_WRAP * 2,
    oy: 0.4 + Math.random() * 12,
    oz: (Math.random() - 0.5) * POLLEN_WRAP * 2,
    windX: 0.4 + Math.random() * 0.9,    // m/s, +X drift
    bobPhase: Math.random() * Math.PI * 2,
    bobSpeed: 0.6 + Math.random() * 1.4,
    bobAmpY:  0.20 + Math.random() * 0.45,
    bobAmpZ:  0.25 + Math.random() * 0.50,
    size: 0.7 + Math.random() * 1.2,
  });
}

function PollenLayer() {
  const ref = useRef();
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(POLLEN_COUNT * 3);
    const sizes = new Float32Array(POLLEN_COUNT);
    for (let i = 0; i < POLLEN_COUNT; i++) {
      const p = POLLEN[i];
      positions[i * 3 + 0] = p.ox;
      positions[i * 3 + 1] = p.oy;
      positions[i * 3 + 2] = p.oz;
      sizes[i] = p.size;
    }
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { pollenTex: { value: POLLEN_TEX } },
      vertexShader: /* glsl */ `
        attribute float size;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (180.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D pollenTex;
        void main() {
          vec4 t = texture2D(pollenTex, gl_PointCoord);
          if (t.a < 0.02) discard;
          gl_FragColor = vec4(1.0, 0.94, 0.50, t.a * 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: g, material: m };
  }, []);

  // Drift state stored per-particle (separate from initial ox so wind keeps
  // accumulating across frames even when bob displacement is reset each frame).
  const cur = useMemo(() => {
    const c = new Float32Array(POLLEN_COUNT);
    for (let i = 0; i < POLLEN_COUNT; i++) c[i] = POLLEN[i].ox;
    return c;
  }, []);

  useFrame((state, dt) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const cdt = Math.min(dt, 0.05);
    const positions = geometry.attributes.position.array;
    for (let i = 0; i < POLLEN_COUNT; i++) {
      const p = POLLEN[i];
      cur[i] += p.windX * cdt;
      if (cur[i] >  POLLEN_WRAP) cur[i] -= POLLEN_WRAP * 2;
      positions[i * 3 + 0] = cur[i];
      positions[i * 3 + 1] = p.oy + Math.sin(t * p.bobSpeed + p.bobPhase) * p.bobAmpY;
      positions[i * 3 + 2] = p.oz + Math.sin(t * p.bobSpeed * 0.45 + p.bobPhase * 1.3) * p.bobAmpZ;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return html`<points ref=${ref} args=${[geometry, material]} />`;
}

/* =========================================================
   Urban furniture — streetlights, benches, crosswalk stripes.
   All baked instancing; lamp heads glow with the night cycle
   via CYCLE_REFS.lampMat.
   ========================================================= */
const STREETLIGHTS = [];
{
  let flip = 1;
  for (const sz of INNER_STREETS_H) {
    for (let x = -21; x <= 21; x += 7) {
      STREETLIGHTS.push({ x, z: sz + flip * (INNER_LANE / 2 + 0.85) });
      flip = -flip;
    }
  }
  for (const sx of INNER_STREETS_V) {
    for (let z = -14; z <= 14; z += 7) {
      STREETLIGHTS.push({ x: sx + flip * (INNER_LANE / 2 + 0.85), z });
      flip = -flip;
    }
  }
}

const BENCHES = [];
{
  for (const p of PARKS) {
    BENCHES.push({ x: p.x - 1.6, z: p.z + 0.6, ry: Math.PI / 2 });
    BENCHES.push({ x: p.x + 1.2, z: p.z - 1.4, ry: -Math.PI / 6 });
  }
  // Plaza benches facing the center
  BENCHES.push({ x:  3.4, z:  3.4, ry: -Math.PI * 0.75 });
  BENCHES.push({ x: -3.4, z:  3.4, ry:  Math.PI * 0.75 });
  BENCHES.push({ x:  3.4, z: -3.4, ry: -Math.PI * 0.25 });
  BENCHES.push({ x: -3.4, z: -3.4, ry:  Math.PI * 0.25 });
}

const CROSSWALKS = [];
for (const sz of INNER_STREETS_H) {
  for (const sx of INNER_STREETS_V) {
    for (let k = -1.5; k <= 1.5; k += 1) {
      CROSSWALKS.push({ x: sx + k * 0.34, z: sz });
    }
  }
}

function UrbanFurniture() {
  return html`
    <group>
      <!-- Lamp poles -->
      <${Instances} limit=${Math.max(1, STREETLIGHTS.length)} castShadow>
        <cylinderGeometry args=${[0.035, 0.05, 2.6, 8]} />
        <meshStandardMaterial color="#3c4148" roughness=${0.6} metalness=${0.45} />
        ${STREETLIGHTS.map((l, i) => html`
          <${Instance} key=${i} position=${[l.x, 1.3, l.z]} />
        `)}
      </${Instances}>
      <!-- Lamp heads — emissive driven by the night cycle -->
      <${Instances} limit=${Math.max(1, STREETLIGHTS.length)}>
        <sphereGeometry args=${[0.12, 10, 10]} />
        <meshStandardMaterial
          ref=${(m) => (CYCLE_REFS.lampMat = m)}
          color="#fff5dc"
          emissive="#ffb066"
          emissiveIntensity=${0.15}
          toneMapped=${false}
        />
        ${STREETLIGHTS.map((l, i) => html`
          <${Instance} key=${i} position=${[l.x, 2.62, l.z]} />
        `)}
      </${Instances}>
      <!-- Bench seats -->
      <${Instances} limit=${Math.max(1, BENCHES.length)} castShadow>
        <boxGeometry args=${[0.95, 0.07, 0.32]} />
        <meshStandardMaterial color="#7a5a38" roughness=${0.85} />
        ${BENCHES.map((b, i) => html`
          <${Instance} key=${i} position=${[b.x, 0.45, b.z]} rotation=${[0, b.ry, 0]} />
        `)}
      </${Instances}>
      <!-- Bench backs -->
      <${Instances} limit=${Math.max(1, BENCHES.length)} castShadow>
        <boxGeometry args=${[0.95, 0.30, 0.06]} />
        <meshStandardMaterial color="#7a5a38" roughness=${0.85} />
        ${BENCHES.map((b, i) => html`
          <${Instance} key=${i}
            position=${[b.x - Math.sin(b.ry) * 0.14, 0.66, b.z - Math.cos(b.ry) * 0.14]}
            rotation=${[0, b.ry, 0]} />
        `)}
      </${Instances}>
      <!-- Crosswalk stripes at every inner intersection -->
      <${Instances} limit=${Math.max(1, CROSSWALKS.length)}>
        <planeGeometry args=${[0.18, 1.45]} />
        <meshStandardMaterial color="#e8e4da" roughness=${0.8} />
        ${CROSSWALKS.map((c, i) => html`
          <${Instance} key=${i} position=${[c.x, 0.052, c.z]} rotation=${[-Math.PI / 2, 0, 0]} />
        `)}
      </${Instances}>
    </group>
  `;
}

/* =========================================================
   Residential houses — small pitched-roof homes ringing the
   city outside the loop. Two instanced layers (bodies, roofs).
   ========================================================= */
const HOUSES = [];
{
  const HOUSE_COLORS = ["#e8d8b8", "#d8b8a0", "#c8d8e8", "#e8c8c8", "#d8e0c0", "#e0d0e8"];
  const HOUSE_ROOFS  = ["#a05030", "#7a5a40", "#506880", "#806060"];
  let attempts = 0;
  while (HOUSES.length < 34 && attempts < 4000) {
    attempts++;
    const x = (Math.random() - 0.5) * 100;
    const z = (Math.random() - 0.5) * 80;
    if (Math.abs(x) < 30 && Math.abs(z) < 22) continue;   // not inside loop+sidewalk
    if (Math.hypot(x, z) > 52) continue;                   // suburbs, not wilderness
    let ok = true;
    for (const t of TENT_CLUSTERS) {
      if (Math.hypot(x - t.cx, z - t.cz) < 5) { ok = false; break; }
    }
    if (ok) for (const t of TURBINES) {
      if (Math.hypot(x - t.x, z - t.z) < 6) { ok = false; break; }
    }
    if (ok) for (const sc of SCULPT_CENTERS) {
      if (Math.hypot(x - sc.x, z - sc.z) < 8) { ok = false; break; }
    }
    if (ok) for (const h of HOUSES) {
      if (Math.hypot(x - h.x, z - h.z) < 4.4) { ok = false; break; }
    }
    if (!ok) continue;
    HOUSES.push({
      x, z,
      hy: hillHeight(x, z),
      ry: Math.floor(Math.random() * 4) * (Math.PI / 2) + (Math.random() - 0.5) * 0.3,
      s: 0.9 + Math.random() * 0.4,
      color: HOUSE_COLORS[Math.floor(Math.random() * HOUSE_COLORS.length)],
      roof: HOUSE_ROOFS[Math.floor(Math.random() * HOUSE_ROOFS.length)],
    });
  }
}

function Houses() {
  return html`
    <group>
      <${Instances} limit=${Math.max(1, HOUSES.length)} castShadow receiveShadow>
        <boxGeometry args=${[2.0, 1.5, 1.7]} />
        <meshStandardMaterial roughness=${0.85} />
        ${HOUSES.map((h, i) => html`
          <${Instance} key=${i}
            position=${[h.x, h.hy + 0.75 * h.s, h.z]}
            rotation=${[0, h.ry, 0]}
            scale=${[h.s, h.s, h.s]}
            color=${h.color} />
        `)}
      </${Instances}>
      <${Instances} limit=${Math.max(1, HOUSES.length)} castShadow>
        <coneGeometry args=${[1.55, 0.95, 4]} />
        <meshStandardMaterial roughness=${0.9} />
        ${HOUSES.map((h, i) => html`
          <${Instance} key=${i}
            position=${[h.x, h.hy + (1.5 + 0.47) * h.s, h.z]}
            rotation=${[0, h.ry + Math.PI / 4, 0]}
            scale=${[h.s, h.s, h.s]}
            color=${h.roof} />
        `)}
      </${Instances}>
    </group>
  `;
}

/* Cars distributed across the perimeter loop AND the inner street grid.
   Loop cars use `kind:'loop'` + `t` along the perimeter; inner-street cars
   use `kind:'grid'` + axis/perpPos/dir, wrapping at the street ends. */
const CARS = [];
{
  // Perimeter loop
  const N_LOOP = 14;
  for (let i = 0; i < N_LOOP; i++) {
    CARS.push({
      kind: "loop",
      t: (i / N_LOOP) * LOOP_PERIM + (Math.random() - 0.5) * 2,
      cruise: 4.0 + Math.random() * 2.0,
      color: CAR_COLORS[i % CAR_COLORS.length],
    });
  }
  // Inner horizontal streets (drive along x)
  let ci = N_LOOP;
  for (const z of INNER_STREETS_H) {
    CARS.push({
      kind: "grid",
      axis: "x",
      perpPos: z,
      pos: (-INNER_LEN_H / 2) + Math.random() * INNER_LEN_H,
      dir: Math.random() < 0.5 ? 1 : -1,
      cruise: 2.6 + Math.random() * 1.4,
      color: CAR_COLORS[ci++ % CAR_COLORS.length],
    });
  }
  // Inner vertical streets (drive along z)
  for (const x of INNER_STREETS_V) {
    CARS.push({
      kind: "grid",
      axis: "z",
      perpPos: x,
      pos: (-INNER_LEN_V / 2) + Math.random() * INNER_LEN_V,
      dir: Math.random() < 0.5 ? 1 : -1,
      cruise: 2.6 + Math.random() * 1.4,
      color: CAR_COLORS[ci++ % CAR_COLORS.length],
    });
  }
  // Seed world position + heading so the collision sensor works on frame 1
  for (const car of CARS) {
    if (car.kind === "loop") {
      const p = perimeterPos(car.t);
      car.x = p.x; car.z = p.z; car.heading = p.heading;
    } else if (car.axis === "x") {
      car.x = car.pos; car.z = car.perpPos;
      car.heading = car.dir > 0 ? 0 : Math.PI;
    } else {
      car.x = car.perpPos; car.z = car.pos;
      car.heading = car.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    car.curSpeed = car.cruise;
  }
}
const CAR_COUNT = CARS.length;

function Cars() {
  const bodyRef = useRef();
  const cabinRef = useRef();
  const wheelRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!bodyRef.current || !cabinRef.current) return;
    const c = new THREE.Color();
    for (let i = 0; i < CAR_COUNT; i++) {
      c.set(CARS[i].color);
      bodyRef.current.setColorAt(i, c);
      // Cabin slightly darker — multiply with default dark gray
      c.set(CARS[i].color).multiplyScalar(0.55);
      cabinRef.current.setColorAt(i, c);
    }
    bodyRef.current.instanceColor.needsUpdate = true;
    cabinRef.current.instanceColor.needsUpdate = true;
  }, []);

  useFrame((state, dt) => {
    if (!bodyRef.current || !cabinRef.current || !wheelRef.current) return;
    const cdt = Math.min(dt, 0.05);

    // --- Pass 1: collision avoidance (car-following + intersection yield).
    // Each car brakes when another sits in a short cone directly ahead of
    // it, then eases back to cruise speed. Lower-index cars win ties so two
    // cars meeting at an intersection can never mutually deadlock.
    for (let i = 0; i < CAR_COUNT; i++) {
      const car = CARS[i];
      const fwdX = Math.cos(car.heading), fwdZ = -Math.sin(car.heading);
      let desired = car.cruise;
      for (let j = 0; j < CAR_COUNT; j++) {
        if (j === i) continue;
        const o = CARS[j];
        const rx = o.x - car.x, rz = o.z - car.z;
        const ahead = rx * fwdX + rz * fwdZ;
        if (ahead < 0.3 || ahead > 4.2) continue;
        const lat = Math.abs(rx * fwdZ - rz * fwdX);
        if (lat > 1.4) continue;
        if (o.curSpeed < 0.6 && j > i) continue;   // stopped + younger → I go
        desired = 0;
        break;
      }
      car.curSpeed += (desired - car.curSpeed) * Math.min(1, cdt * 5);
    }

    // --- Pass 2: advance + write matrices --------------------------------
    for (let i = 0; i < CAR_COUNT; i++) {
      const car = CARS[i];
      let x, z, heading;
      if (car.kind === "loop") {
        car.t += car.curSpeed * cdt;
        const curr = perimeterPos(car.t);
        const look = perimeterPos(car.t + 1.0);
        const dxL = look.x - curr.x, dzL = look.z - curr.z;
        heading = (Math.abs(dxL) + Math.abs(dzL) > 0.01)
          ? Math.atan2(-dzL, dxL)
          : curr.heading;
        x = curr.x; z = curr.z;
      } else {
        car.pos += car.curSpeed * car.dir * cdt;
        if (car.axis === "x") {
          if (car.pos >  INNER_LEN_H / 2) car.pos -= INNER_LEN_H;
          if (car.pos < -INNER_LEN_H / 2) car.pos += INNER_LEN_H;
          x = car.pos; z = car.perpPos;
          heading = car.dir > 0 ? 0 : Math.PI;
        } else {
          if (car.pos >  INNER_LEN_V / 2) car.pos -= INNER_LEN_V;
          if (car.pos < -INNER_LEN_V / 2) car.pos += INNER_LEN_V;
          x = car.perpPos; z = car.pos;
          heading = car.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
        }
      }
      car.x = x; car.z = z; car.heading = heading;
      const cos = Math.cos(heading), sin = Math.sin(heading);

      // Body
      dummy.position.set(x, 0.28, z);
      dummy.rotation.set(0, heading, 0);
      dummy.updateMatrix();
      bodyRef.current.setMatrixAt(i, dummy.matrix);

      // Cabin — slightly back and up in car-local frame
      const cabinLx = 0, cabinLz = -0.12;
      const cabinWx = x + cos * cabinLx + sin * cabinLz;
      const cabinWz = z - sin * cabinLx + cos * cabinLz;
      dummy.position.set(cabinWx, 0.62, cabinWz);
      dummy.rotation.set(0, heading, 0);
      dummy.updateMatrix();
      cabinRef.current.setMatrixAt(i, dummy.matrix);

      // 4 wheels at corners
      const wheelOffsets = [[-0.58, -0.42], [0.58, -0.42], [-0.58, 0.42], [0.58, 0.42]];
      for (let w = 0; w < 4; w++) {
        const [lx, lz] = wheelOffsets[w];
        const wx = x + cos * lx + sin * lz;
        const wz = z - sin * lx + cos * lz;
        dummy.position.set(wx, 0.12, wz);
        dummy.rotation.set(0, heading, 0);
        dummy.updateMatrix();
        wheelRef.current.setMatrixAt(i * 4 + w, dummy.matrix);
      }
    }
    bodyRef.current.instanceMatrix.needsUpdate = true;
    cabinRef.current.instanceMatrix.needsUpdate = true;
    wheelRef.current.instanceMatrix.needsUpdate = true;
  });

  return html`
    <group>
      <instancedMesh ref=${bodyRef} args=${[undefined, undefined, CAR_COUNT]} receiveShadow>
        <boxGeometry args=${[1.7, 0.42, 0.9]} />
        <meshStandardMaterial roughness=${0.35} metalness=${0.4} />
      </instancedMesh>
      <instancedMesh ref=${cabinRef} args=${[undefined, undefined, CAR_COUNT]}>
        <boxGeometry args=${[1.05, 0.36, 0.82]} />
        <meshStandardMaterial roughness=${0.4} metalness=${0.3} />
      </instancedMesh>
      <instancedMesh ref=${wheelRef} args=${[undefined, undefined, CAR_COUNT * 4]}>
        <boxGeometry args=${[0.16, 0.20, 0.12]} />
        <meshStandardMaterial color="#1a1a1a" roughness=${0.7} />
      </instancedMesh>
    </group>
  `;
}

/* =========================================================
   Flock — N walking figures with boids steering, drawn with
   raw InstancedMesh so we can setMatrixAt per frame without
   reconciling React on every move.
   ========================================================= */
const FLOCK_COUNT = 145;

/* Pickup-drop pools — every cart / dog / loose tent is an item that
   sits in the world until a passing flock agent walks within range,
   then is carried for a random duration, then dropped at the agent's
   current position. Items reuse their color across pickups. */
const CART_POOL_SIZE = 28;
const DOG_POOL_SIZE = 22;
const LOOSE_TENT_POOL_SIZE = 10;

function _seedItemSpots() {
  const out = [];
  // Bias item starting positions strongly toward INSIDE the city —
  // inside-city encampments get ~5x the weight of outskirts ones so most
  // carts/dogs/tents end up where the flock actually walks.
  for (const c of TENT_CLUSTERS) {
    const isInside = Math.abs(c.cx) < 22 && Math.abs(c.cz) < 16;
    const repeats = isInside ? 5 : 1;
    for (let i = 0; i < repeats * 3; i++) {
      out.push({
        x: c.cx + (Math.random() - 0.5) * 3,
        z: c.cz + (Math.random() - 0.5) * 3,
      });
    }
  }
  return out;
}
const _itemSpots = _seedItemSpots();
function _spawnSpot(i) {
  const s = _itemSpots[i % _itemSpots.length];
  return {
    x: s.x + (Math.random() - 0.5) * 1.5,
    z: s.z + (Math.random() - 0.5) * 1.5,
  };
}

const CART_POOL = [];
for (let i = 0; i < CART_POOL_SIZE; i++) {
  const s = _spawnSpot(i);
  CART_POOL.push({
    x: s.x, z: s.z,
    heading: Math.random() * Math.PI * 2,
    carrier: null,
    timer: 0,
    cooldown: Math.random() * 5,
    color: CART_BUNDLE_COLORS[i % CART_BUNDLE_COLORS.length],
  });
}

const DOG_POOL = [];
for (let i = 0; i < DOG_POOL_SIZE; i++) {
  const s = _spawnSpot(i + 100);
  DOG_POOL.push({
    x: s.x, z: s.z,
    heading: Math.random() * Math.PI * 2,
    carrier: null,
    timer: 0,
    cooldown: Math.random() * 5,
    color: DOG_COAT_COLORS_LIST[i % DOG_COAT_COLORS_LIST.length],
  });
}

const LOOSE_TENT_POOL = [];
for (let i = 0; i < LOOSE_TENT_POOL_SIZE; i++) {
  const s = _spawnSpot(i + 200);
  LOOSE_TENT_POOL.push({
    x: s.x, z: s.z,
    heading: Math.random() * Math.PI * 2,
    carrier: null,
    timer: 0,
    cooldown: Math.random() * 5,
    color: TENT_PACK_COLORS_LIST[i % TENT_PACK_COLORS_LIST.length],
  });
}

/* Spatial hash of buildings for fast avoidance lookup in Flock useFrame.
   Each building is registered in its own bucket + 8 neighbors so a lookup
   at any agent position finds every building within ~one cell. */
const BHASH_CELL = 6;
const BHASH = new Map();
function bhKey(bx, bz) { return bx * 100000 + bz; }
for (let bi = 0; bi < BUILDINGS.length; bi++) {
  const b = BUILDINGS[bi];
  const bxi = Math.round(b.x / BHASH_CELL);
  const bzi = Math.round(b.z / BHASH_CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const key = bhKey(bxi + dx, bzi + dz);
      let arr = BHASH.get(key);
      if (!arr) { arr = []; BHASH.set(key, arr); }
      arr.push(bi);
    }
  }
}

const FLOCK_BODY_COLORS = [
  "#e84050", "#2860c8", "#e8c020", "#40a040",
  "#c860c8", "#e08018", "#10a8a0", "#d02898",
  "#a040e0", "#508058", "#c84020", "#308880",
  "#e0e040", "#90c440", "#7060e0", "#e07058",
];
const FLOCK_SKIN_COLORS = [
  "#e8c8a8", "#d8b890", "#c0a078", "#b09068",
  "#a08058", "#e8d4b0", "#d0a880", "#c09870",
];

function Flock() {
  const bodyRef = useRef();
  const headRef = useRef();
  const cartFrameRef = useRef();
  const cartBundleRef = useRef();
  const dogBodyRef = useRef();
  const dogHeadRef = useRef();
  const looseTentRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  // Set of agent indices currently carrying an item — preserved across
  // frames so an agent can finish one carry before being grabbed for another.
  const assignedAgents = useMemo(() => new Set(), []);

  const agents = useMemo(() => {
    const arr = [];
    for (let i = 0; i < FLOCK_COUNT; i++) {
      // Spawn across the broader walking area, not just the plaza
      let x = 0, z = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = (Math.random() - 0.5) * 44;
        z = (Math.random() - 0.5) * 44;
        const r2 = x * x + z * z;
        if (r2 < 6.25) continue;       // not on the table
        if (r2 > 22 * 22) continue;    // not on the road
        // not inside a building
        let ok = true;
        for (const b of BUILDINGS) {
          const dx = x - b.x, dz = z - b.z;
          const minD = Math.max(b.w, b.d) * 0.7 + 0.4;
          if (dx * dx + dz * dz < minD * minD) { ok = false; break; }
        }
        if (ok) break;
      }
      const dir = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 0.5;
      arr.push({
        pos: [x, 0, z],
        vel: [Math.cos(dir) * speed, 0, Math.sin(dir) * speed],
        phase: Math.random() * Math.PI * 2,
        state: 0,                                 // 0 = walking, 1 = lying
        stateTime: Math.random() * 10,            // time spent in current state
        lyingHeading: 0,                          // heading captured at lie-down
      });
    }
    return arr;
  }, []);

  // Set per-instance colors once on mount.
  useEffect(() => {
    if (!bodyRef.current || !headRef.current) return;
    const c = new THREE.Color();
    for (let i = 0; i < FLOCK_COUNT; i++) {
      c.set(FLOCK_BODY_COLORS[i % FLOCK_BODY_COLORS.length]);
      bodyRef.current.setColorAt(i, c);
      c.set(FLOCK_SKIN_COLORS[i % FLOCK_SKIN_COLORS.length]);
      headRef.current.setColorAt(i, c);
    }
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
    if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true;

    // Cart bundles + dog coats + tent packs use their item's color.
    if (cartBundleRef.current) {
      for (let i = 0; i < CART_POOL.length; i++) {
        c.set(CART_POOL[i].color);
        cartBundleRef.current.setColorAt(i, c);
      }
      if (cartBundleRef.current.instanceColor) cartBundleRef.current.instanceColor.needsUpdate = true;
    }
    if (dogBodyRef.current && dogHeadRef.current) {
      for (let i = 0; i < DOG_POOL.length; i++) {
        c.set(DOG_POOL[i].color);
        dogBodyRef.current.setColorAt(i, c);
        dogHeadRef.current.setColorAt(i, c);
      }
      if (dogBodyRef.current.instanceColor) dogBodyRef.current.instanceColor.needsUpdate = true;
      if (dogHeadRef.current.instanceColor) dogHeadRef.current.instanceColor.needsUpdate = true;
    }
    if (looseTentRef.current) {
      for (let i = 0; i < LOOSE_TENT_POOL.length; i++) {
        c.set(LOOSE_TENT_POOL[i].color);
        looseTentRef.current.setColorAt(i, c);
      }
      if (looseTentRef.current.instanceColor) looseTentRef.current.instanceColor.needsUpdate = true;
    }
  }, []);

  useFrame((state, dt) => {
    if (!bodyRef.current || !headRef.current) return;
    const t = state.clock.elapsedTime;
    const cdt = Math.min(dt, 0.05);

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      a.stateTime += cdt;

      // === Lying state: stationary, watching for a passing walker ===
      if (a.state === 1) {
        if (a.stateTime > 4) {
          for (let j = 0; j < agents.length; j++) {
            if (i === j) continue;
            const o = agents[j];
            if (o.state !== 0) continue;
            const dx = a.pos[0] - o.pos[0];
            const dz = a.pos[2] - o.pos[2];
            if (dx * dx + dz * dz < 4) {
              a.state = 0;
              a.stateTime = 0;
              a.vel[0] = (o.vel[0] || 0) * 0.6 + 0.2;
              a.vel[2] = (o.vel[2] || 0) * 0.6 + 0.2;
              break;
            }
          }
        }
        if (a.state === 1) {
          a.heading = a.lyingHeading;
          a.bob = 0;
          // Body laid flat: rotate around X by π/2, then around Y by lying heading
          dummy.position.set(a.pos[0], 0.13, a.pos[2]);
          dummy.rotation.set(Math.PI / 2, a.lyingHeading, 0);
          dummy.updateMatrix();
          bodyRef.current.setMatrixAt(i, dummy.matrix);
          // Head sits at the "head end" of the lying body
          const hx = a.pos[0] + Math.sin(a.lyingHeading) * 0.55;
          const hz = a.pos[2] + Math.cos(a.lyingHeading) * 0.55;
          dummy.position.set(hx, 0.14, hz);
          dummy.rotation.set(0, a.lyingHeading, 0);
          dummy.updateMatrix();
          headRef.current.setMatrixAt(i, dummy.matrix);
          continue;
        }
      }

      let sepX = 0, sepZ = 0, sepN = 0;
      let alignX = 0, alignZ = 0, alignN = 0;
      let cohX = 0, cohZ = 0, cohN = 0;

      for (let j = 0; j < agents.length; j++) {
        if (i === j) continue;
        const o = agents[j];
        if (o.state !== 0) continue;            // ignore lying agents in boids math
        const dx = a.pos[0] - o.pos[0];
        const dz = a.pos[2] - o.pos[2];
        const d2 = dx * dx + dz * dz;
        if (d2 < 3.24) {                        // larger separation radius (1.8m)
          const d = Math.sqrt(d2) || 0.001;
          sepX += dx / d; sepZ += dz / d; sepN++;
        }
        if (d2 < 6.25) {                        // tighter alignment radius (2.5m)
          alignX += o.vel[0]; alignZ += o.vel[2]; alignN++;
        }
        if (d2 < 16) {                          // tighter cohesion radius (4m)
          cohX += o.pos[0]; cohZ += o.pos[2]; cohN++;
        }
      }

      let ax = 0, az = 0;
      // Fragmentation: more separation, weaker alignment, much weaker cohesion
      if (sepN > 0)   { ax += (sepX / sepN) * 4;                              az += (sepZ / sepN) * 4; }
      if (alignN > 0) { ax += (alignX / alignN - a.vel[0]) * 0.4;             az += (alignZ / alignN - a.vel[2]) * 0.4; }
      if (cohN > 0) {
        const dx = cohX / cohN - a.pos[0];
        const dz = cohZ / cohN - a.pos[2];
        const dl = Math.sqrt(dx * dx + dz * dz) || 0.001;
        ax += (dx / dl) * 0.15; az += (dz / dl) * 0.15;
      }

      // Keep clear of the table
      const dC = Math.sqrt(a.pos[0] * a.pos[0] + a.pos[2] * a.pos[2]);
      if (dC < 2.4) {
        const f = (2.4 - dC) * 3;
        ax += (a.pos[0] / Math.max(dC, 0.001)) * f;
        az += (a.pos[2] / Math.max(dC, 0.001)) * f;
      }
      // Stay inside the walking area (just inside the beltway)
      if (dC > 25) {
        const f = (dC - 25) * 2;
        ax -= (a.pos[0] / dC) * f;
        az -= (a.pos[2] / dC) * f;
      }
      // Avoid building footprints — only check buildings in nearby buckets
      const bxi = Math.round(a.pos[0] / BHASH_CELL);
      const bzi = Math.round(a.pos[2] / BHASH_CELL);
      const nearby = BHASH.get(bhKey(bxi, bzi));
      if (nearby) {
        for (let k = 0; k < nearby.length; k++) {
          const b = BUILDINGS[nearby[k]];
          const dx = a.pos[0] - b.x, dz = a.pos[2] - b.z;
          const bd = Math.sqrt(dx * dx + dz * dz);
          const minD = Math.max(b.w, b.d) * 0.6 + 0.5;
          if (bd < minD && bd > 0.001) {
            const f = (minD - bd) * 6;
            ax += (dx / bd) * f;
            az += (dz / bd) * f;
          }
        }
      }

      a.vel[0] += ax * cdt;
      a.vel[2] += az * cdt;

      const speed = Math.sqrt(a.vel[0] * a.vel[0] + a.vel[2] * a.vel[2]);
      if (speed > 1.4) {
        a.vel[0] = a.vel[0] / speed * 1.4;
        a.vel[2] = a.vel[2] / speed * 1.4;
      } else if (speed < 0.5 && speed > 0.001) {
        a.vel[0] = a.vel[0] / speed * 0.5;
        a.vel[2] = a.vel[2] / speed * 0.5;
      }

      a.pos[0] += a.vel[0] * cdt;
      a.pos[2] += a.vel[2] * cdt;

      // Hard collision resolution — steering keeps them out most of the
      // time, but this guarantees nobody ever steps inside a building
      // or onto a monument plinth.
      const cxi = Math.round(a.pos[0] / BHASH_CELL);
      const czi = Math.round(a.pos[2] / BHASH_CELL);
      const nearB = BHASH.get(bhKey(cxi, czi));
      if (nearB) {
        for (let k = 0; k < nearB.length; k++) {
          const b = BUILDINGS[nearB[k]];
          const hw = b.w / 2 + 0.30, hd = b.d / 2 + 0.30;
          const dx = a.pos[0] - b.x, dz = a.pos[2] - b.z;
          if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
            const px = hw - Math.abs(dx), pz = hd - Math.abs(dz);
            if (px < pz) { a.pos[0] = b.x + Math.sign(dx || 1) * hw; a.vel[0] *= -0.3; }
            else         { a.pos[2] = b.z + Math.sign(dz || 1) * hd; a.vel[2] *= -0.3; }
          }
        }
      }
      for (let s = 0; s < SCULPT_CENTERS.length; s++) {
        const sc = SCULPT_CENTERS[s];
        const dx = a.pos[0] - sc.x, dz = a.pos[2] - sc.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < SCULPT_RADIUS * SCULPT_RADIUS) {
          const d = Math.sqrt(d2) || 0.001;
          a.pos[0] = sc.x + (dx / d) * SCULPT_RADIUS;
          a.pos[2] = sc.z + (dz / d) * SCULPT_RADIUS;
          // Slide along the plinth: remove the inward velocity component
          const vn = (a.vel[0] * dx + a.vel[2] * dz) / d;
          if (vn < 0) {
            a.vel[0] -= (vn * dx) / d;
            a.vel[2] -= (vn * dz) / d;
          }
        }
      }

      const heading = Math.atan2(a.vel[0], a.vel[2]);
      a.heading = heading;          // stash for cart/dog/tent pass below
      a.bob = Math.sin(t * 6 + a.phase) * 0.04;

      dummy.position.set(a.pos[0], 0.5 + a.bob, a.pos[2]);
      dummy.rotation.set(0, heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bodyRef.current.setMatrixAt(i, dummy.matrix);

      dummy.position.set(a.pos[0], 1.13 + a.bob, a.pos[2]);
      dummy.updateMatrix();
      headRef.current.setMatrixAt(i, dummy.matrix);

      // Random transition: after walking ≥ 35s, ~3% chance per second to lie down
      if (a.stateTime > 35 && Math.random() < cdt * 0.03) {
        a.state = 1;
        a.stateTime = 0;
        a.lyingHeading = heading;
        a.vel[0] = 0;
        a.vel[2] = 0;
        // Free any item this agent was carrying
        if (assignedAgents.has(i)) {
          for (const pool of [CART_POOL, DOG_POOL, LOOSE_TENT_POOL]) {
            for (const item of pool) {
              if (item.carrier === i) {
                item.carrier = null;
                item.cooldown = 4 + Math.random() * 8;
              }
            }
          }
          assignedAgents.delete(i);
        }
      }
    }
    bodyRef.current.instanceMatrix.needsUpdate = true;
    headRef.current.instanceMatrix.needsUpdate = true;

    // === Pickup-drop pools ===
    // Generic state-machine update: advances each item, optionally finds
    // an agent that can pick it up, then writes its matrix to the instanced
    // mesh. The agent-set `assignedAgents` is shared so a single agent can
    // only carry one item type at a time.
    function updatePool(pool, pickupRadius, writeMatrices) {
      for (let ii = 0; ii < pool.length; ii++) {
        const item = pool[ii];
        if (item.carrier !== null) {
          const a = agents[item.carrier];
          item.heading = a.heading || 0;
          item.x = a.pos[0];
          item.z = a.pos[2];
          item.timer -= cdt;
          if (item.timer <= 0) {
            // Drop here — record the final position so the item stays put
            assignedAgents.delete(item.carrier);
            item.carrier = null;
            item.cooldown = 4 + Math.random() * 8;
          }
        } else {
          item.cooldown -= cdt;
          if (item.cooldown <= 0) {
            // Scan agents for a free one within pickupRadius
            const pr2 = pickupRadius * pickupRadius;
            for (let i = 0; i < agents.length; i++) {
              if (assignedAgents.has(i)) continue;
              const a = agents[i];
              if (a.state !== 0) continue;              // skip lying agents
              const dx = a.pos[0] - item.x;
              const dz = a.pos[2] - item.z;
              if (dx * dx + dz * dz < pr2) {
                item.carrier = i;
                item.timer = 6 + Math.random() * 12;
                assignedAgents.add(i);
                break;
              }
            }
          }
        }
        writeMatrices(item, ii);
      }
    }

    // Carts: when carried, sit ahead of the walker
    if (cartFrameRef.current && cartBundleRef.current) {
      updatePool(CART_POOL, 1.6, (item, idx) => {
        let x = item.x, z = item.z, h = item.heading;
        if (item.carrier !== null) {
          x += Math.sin(h) * 0.55;
          z += Math.cos(h) * 0.55;
        }
        dummy.position.set(x, 0.31, z);
        dummy.rotation.set(0, h, 0);
        dummy.updateMatrix();
        cartFrameRef.current.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(x, 0.64, z);
        dummy.updateMatrix();
        cartBundleRef.current.setMatrixAt(idx, dummy.matrix);
      });
      cartFrameRef.current.instanceMatrix.needsUpdate = true;
      cartBundleRef.current.instanceMatrix.needsUpdate = true;
    }

    // Dogs: when walked, sit beside the walker
    if (dogBodyRef.current && dogHeadRef.current) {
      updatePool(DOG_POOL, 1.6, (item, idx) => {
        let x = item.x, z = item.z, h = item.heading;
        if (item.carrier !== null) {
          const cosH = Math.cos(h), sinH = Math.sin(h);
          x += cosH * 0.42 + sinH * 0.18;
          z += -sinH * 0.42 + cosH * 0.18;
        }
        const dogBob = item.carrier !== null ? Math.sin(t * 8 + idx * 1.7) * 0.025 : 0;
        dummy.position.set(x, 0.15 + dogBob, z);
        dummy.rotation.set(0, h, 0);
        dummy.updateMatrix();
        dogBodyRef.current.setMatrixAt(idx, dummy.matrix);

        // Head offset forward along dog's heading
        const hx = x + Math.sin(h) * 0.22;
        const hz = z + Math.cos(h) * 0.22;
        dummy.position.set(hx, 0.27 + dogBob, hz);
        dummy.updateMatrix();
        dogHeadRef.current.setMatrixAt(idx, dummy.matrix);
      });
      dogBodyRef.current.instanceMatrix.needsUpdate = true;
      dogHeadRef.current.instanceMatrix.needsUpdate = true;
    }

    // Loose tents: when carried, sit small (backpack-sized) on the shoulder;
    // when idle, full-size tent on the ground.
    if (looseTentRef.current) {
      updatePool(LOOSE_TENT_POOL, 1.6, (item, idx) => {
        if (item.carrier !== null) {
          const a = agents[item.carrier];
          const px = a.pos[0] - Math.sin(item.heading) * 0.16;
          const pz = a.pos[2] - Math.cos(item.heading) * 0.16;
          dummy.position.set(px, 0.96 + a.bob, pz);
          dummy.scale.set(0.4, 0.45, 0.4);
        } else {
          dummy.position.set(item.x, 0.55, item.z);
          dummy.scale.set(1, 1, 1);
        }
        dummy.rotation.set(0, item.heading, 0);
        dummy.updateMatrix();
        looseTentRef.current.setMatrixAt(idx, dummy.matrix);
      });
      looseTentRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return html`
    <group>
      <instancedMesh ref=${bodyRef} args=${[undefined, undefined, FLOCK_COUNT]}>
        <boxGeometry args=${[0.34, 0.88, 0.24]} />
        <meshStandardMaterial roughness=${0.9} />
      </instancedMesh>
      <instancedMesh ref=${headRef} args=${[undefined, undefined, FLOCK_COUNT]}>
        <boxGeometry args=${[0.26, 0.26, 0.26]} />
        <meshStandardMaterial roughness=${0.85} />
      </instancedMesh>
      <!-- Carts (idle in world OR carried ahead of walker) -->
      <instancedMesh ref=${cartFrameRef} args=${[undefined, undefined, CART_POOL.length]}>
        <boxGeometry args=${[0.5, 0.42, 0.36]} />
        <meshStandardMaterial color="#3a3a3a" roughness=${0.55} metalness=${0.4} />
      </instancedMesh>
      <instancedMesh ref=${cartBundleRef} args=${[undefined, undefined, CART_POOL.length]}>
        <boxGeometry args=${[0.46, 0.22, 0.32]} />
        <meshStandardMaterial roughness=${0.9} />
      </instancedMesh>
      <!-- Dogs (idle in world OR walking beside their human) -->
      <instancedMesh ref=${dogBodyRef} args=${[undefined, undefined, DOG_POOL.length]}>
        <boxGeometry args=${[0.16, 0.18, 0.42]} />
        <meshStandardMaterial roughness=${0.95} />
      </instancedMesh>
      <instancedMesh ref=${dogHeadRef} args=${[undefined, undefined, DOG_POOL.length]}>
        <boxGeometry args=${[0.15, 0.15, 0.15]} />
        <meshStandardMaterial roughness=${0.95} />
      </instancedMesh>
      <!-- Loose tents (sitting on the ground OR carried on a shoulder) -->
      <instancedMesh ref=${looseTentRef} args=${[undefined, undefined, LOOSE_TENT_POOL.length]}>
        <coneGeometry args=${[0.9, 1.1, 4]} />
        <meshStandardMaterial roughness=${0.88} />
      </instancedMesh>
    </group>
  `;
}

/* =========================================================
   Chair
   ========================================================= */
function Chair({ position, rotation }) {
  const [px, , pz] = position;
  const [, ry] = rotation;
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const w = (x, y, z) => [px + cos * x + sin * z, y, pz - sin * x + cos * z];
  const seatY = 0.5;
  return html`
    <group>
      <${StaticBox} args=${[0.55, 0.06, 0.55]} position=${w(0, seatY, 0)} color="#6b4a2b" />
      <${StaticBox} args=${[0.55, 0.7, 0.06]} position=${w(0, seatY + 0.37, -0.25)} color="#6b4a2b" />
      ${[[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].map(([x, z], i) => html`
        <${StaticBox} key=${i} args=${[0.06, seatY, 0.06]}
          position=${w(x, seatY / 2, z)} color="#4a3220" roughness=${0.8} />
      `)}
    </group>
  `;
}

/* =========================================================
   Blocky ragdoll — pmndrs-inspired proportions
   ========================================================= */
const S = {
  head:   { x: 0.32, y: 0.32, z: 0.32 },
  torso:  { x: 0.40, y: 0.55, z: 0.25 },
  pelvis: { x: 0.36, y: 0.20, z: 0.22 },
  uArm:   { x: 0.16, y: 0.42, z: 0.16 },
  lArm:   { x: 0.14, y: 0.40, z: 0.14 },
  uLeg:   { x: 0.20, y: 0.50, z: 0.20 },
  lLeg:   { x: 0.18, y: 0.48, z: 0.18 },
};

/* Custom hook: a dynamic blocky body part connected to the cursor by a
   disabled-by-default PointToPointConstraint. Pointer events toggle it. */
function useBlocky(args, xf, mass, color) {
  const cursor = useContext(CursorContext);
  const setDragging = useContext(DragContext);

  const [ref, api] = useBox(() => ({
    args,
    mass,
    position: xf.position,
    quaternion: xf.quaternion,
    linearDamping: 0.5,
    angularDamping: 0.65,
    allowSleep: true,
    sleepSpeedLimit: 0.3,
    sleepTimeLimit: 1.0,
  }));

  const [, , dragApi] = usePointToPointConstraint(cursor, ref, {
    pivotA: [0, 0, 0],
    pivotB: [0, 0, 0],
  });

  useEffect(() => {
    dragApi.disable();
  }, [dragApi]);

  const onPointerDown = (e) => {
    e.stopPropagation();
    api.wakeUp();
    dragApi.enable();
    setDragging(true);
    const release = () => {
      dragApi.disable();
      setDragging(false);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };

  const jsx = html`
    <mesh
      ref=${ref}
      castShadow
      receiveShadow
      onPointerDown=${onPointerDown}
    >
      <boxGeometry args=${args} />
      <meshStandardMaterial color=${color} roughness=${0.85} />
    </mesh>
  `;

  return [ref, api, jsx];
}

function Ragdoll({ origin, facing, skin, cloth }) {
  const pelvisY = 0.62;
  const torsoY  = pelvisY + S.pelvis.y / 2 + S.torso.y / 2 - 0.02;
  const headY   = torsoY  + S.torso.y / 2 + S.head.y / 2 + 0.02;
  const uLegY   = pelvisY - 0.06;
  const lLegY   = S.lLeg.y / 2;
  const uArmY   = torsoY + 0.05;
  const lArmY   = uArmY - S.uArm.y;

  const pelvisXf = xform([0,     pelvisY, 0],     [0, 0, 0],            origin, facing);
  const torsoXf  = xform([0,     torsoY, -0.02], [0, 0, 0],            origin, facing);
  const headXf   = xform([0,     headY,  -0.04], [0, 0, 0],            origin, facing);
  const uLegLXf  = xform([-0.10, uLegY,  0.22],  [Math.PI / 2, 0, 0],  origin, facing);
  const uLegRXf  = xform([ 0.10, uLegY,  0.22],  [Math.PI / 2, 0, 0],  origin, facing);
  const lLegLXf  = xform([-0.10, lLegY,  0.46],  [0, 0, 0],            origin, facing);
  const lLegRXf  = xform([ 0.10, lLegY,  0.46],  [0, 0, 0],            origin, facing);
  const uArmLXf  = xform([-0.30, uArmY, -0.02],  [0, 0, 0],            origin, facing);
  const uArmRXf  = xform([ 0.30, uArmY, -0.02],  [0, 0, 0],            origin, facing);
  const lArmLXf  = xform([-0.30, lArmY, -0.02],  [0, 0, 0],            origin, facing);
  const lArmRXf  = xform([ 0.30, lArmY, -0.02],  [0, 0, 0],            origin, facing);

  const pant = "#1a1e2a";
  const [pelvisRef, , pelvisJsx] = useBlocky([S.pelvis.x, S.pelvis.y, S.pelvis.z], pelvisXf, 6,   pant);
  const [torsoRef , , torsoJsx ] = useBlocky([S.torso.x , S.torso.y , S.torso.z ], torsoXf , 8,   cloth);
  const [headRef  , , headJsx  ] = useBlocky([S.head.x  , S.head.y  , S.head.z  ], headXf  , 2,   skin);
  const [uLegLRef , , uLegLJsx ] = useBlocky([S.uLeg.x  , S.uLeg.y  , S.uLeg.z  ], uLegLXf , 4,   pant);
  const [uLegRRef , , uLegRJsx ] = useBlocky([S.uLeg.x  , S.uLeg.y  , S.uLeg.z  ], uLegRXf , 4,   pant);
  const [lLegLRef , , lLegLJsx ] = useBlocky([S.lLeg.x  , S.lLeg.y  , S.lLeg.z  ], lLegLXf , 3,   pant);
  const [lLegRRef , , lLegRJsx ] = useBlocky([S.lLeg.x  , S.lLeg.y  , S.lLeg.z  ], lLegRXf , 3,   pant);
  const [uArmLRef , , uArmLJsx ] = useBlocky([S.uArm.x  , S.uArm.y  , S.uArm.z  ], uArmLXf , 2,   cloth);
  const [uArmRRef , , uArmRJsx ] = useBlocky([S.uArm.x  , S.uArm.y  , S.uArm.z  ], uArmRXf , 2,   cloth);
  const [lArmLRef , , lArmLJsx ] = useBlocky([S.lArm.x  , S.lArm.y  , S.lArm.z  ], lArmLXf , 1.5, skin);
  const [lArmRRef , , lArmRJsx ] = useBlocky([S.lArm.x  , S.lArm.y  , S.lArm.z  ], lArmRXf , 1.5, skin);

  // ConeTwist joint chain
  useConeTwistConstraint(pelvisRef, torsoRef, {
    pivotA: [0,  S.pelvis.y / 2, 0], pivotB: [0, -S.torso.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 5, twistAngle: Math.PI / 8, collideConnected: false,
  });
  useConeTwistConstraint(torsoRef, headRef, {
    pivotA: [0,  S.torso.y / 2, 0], pivotB: [0, -S.head.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 4, twistAngle: Math.PI / 6, collideConnected: false,
  });
  useConeTwistConstraint(torsoRef, uArmLRef, {
    pivotA: [-S.torso.x / 2, S.torso.y / 2 - 0.04, 0], pivotB: [0, S.uArm.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 2.5, twistAngle: Math.PI / 4, collideConnected: false,
  });
  useConeTwistConstraint(torsoRef, uArmRRef, {
    pivotA: [ S.torso.x / 2, S.torso.y / 2 - 0.04, 0], pivotB: [0, S.uArm.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 2.5, twistAngle: Math.PI / 4, collideConnected: false,
  });
  useConeTwistConstraint(uArmLRef, lArmLRef, {
    pivotA: [0, -S.uArm.y / 2, 0], pivotB: [0, S.lArm.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 4, twistAngle: 0, collideConnected: false,
  });
  useConeTwistConstraint(uArmRRef, lArmRRef, {
    pivotA: [0, -S.uArm.y / 2, 0], pivotB: [0, S.lArm.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 4, twistAngle: 0, collideConnected: false,
  });
  useConeTwistConstraint(pelvisRef, uLegLRef, {
    pivotA: [-0.10, -S.pelvis.y / 2, 0], pivotB: [0, S.uLeg.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 3, twistAngle: Math.PI / 8, collideConnected: false,
  });
  useConeTwistConstraint(pelvisRef, uLegRRef, {
    pivotA: [ 0.10, -S.pelvis.y / 2, 0], pivotB: [0, S.uLeg.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 3, twistAngle: Math.PI / 8, collideConnected: false,
  });
  useConeTwistConstraint(uLegLRef, lLegLRef, {
    pivotA: [0, -S.uLeg.y / 2, 0], pivotB: [0, S.lLeg.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 6, twistAngle: 0, collideConnected: false,
  });
  useConeTwistConstraint(uLegRRef, lLegRRef, {
    pivotA: [0, -S.uLeg.y / 2, 0], pivotB: [0, S.lLeg.y / 2, 0],
    axisA: [0, 1, 0], axisB: [0, 1, 0],
    angle: Math.PI / 6, twistAngle: 0, collideConnected: false,
  });

  return html`
    <group>
      ${pelvisJsx}${torsoJsx}${headJsx}
      ${uLegLJsx}${uLegRJsx}${lLegLJsx}${lLegRJsx}
      ${uArmLJsx}${uArmRJsx}${lArmLJsx}${lArmRJsx}
    </group>
  `;
}

/* =========================================================
   Lights
   ========================================================= */
function Lights() {
  const dirRef = useRef();
  /* Static shadow map: two bakes after mount, then autoUpdate frozen.
     The DayCycle controller takes over from there — it re-bakes the
     frozen map whenever the sun has moved far enough. */
  useEffect(() => {
    const t1 = setTimeout(() => {
      if (dirRef.current) dirRef.current.shadow.needsUpdate = true;
    }, 150);
    const t2 = setTimeout(() => {
      if (dirRef.current) {
        dirRef.current.shadow.needsUpdate = true;
        dirRef.current.shadow.autoUpdate = false;
      }
    }, 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return html`
    <group>
      <hemisphereLight
        ref=${(l) => (CYCLE_REFS.hemi = l)}
        intensity=${0.7} groundColor="#88a850" color="#bdd6ea" />
      <ambientLight ref=${(l) => (CYCLE_REFS.amb = l)} intensity=${0.25} />
      <directionalLight
        ref=${(l) => { dirRef.current = l; CYCLE_REFS.dir = l; }}
        position=${[14, 36, 12]}
        intensity=${2.5}
        color="#fff4cc"
        castShadow
        shadow-mapSize-width=${1024}
        shadow-mapSize-height=${1024}
        shadow-camera-left=${-75}
        shadow-camera-right=${75}
        shadow-camera-top=${75}
        shadow-camera-bottom=${-75}
        shadow-camera-near=${0.5}
        shadow-camera-far=${150}
        shadow-bias=${-0.0008}
        shadow-normalBias=${0.06}
      />
      <!-- Rim light: cool counter-light from behind the city, no shadows.
           Edges buildings/trees against the ground so they pop. -->
      <directionalLight
        ref=${(l) => (CYCLE_REFS.rim = l)}
        position=${[-26, 18, -30]}
        intensity=${0.4}
        color="#bcd8f5" />
    </group>
  `;
}

/* =========================================================
   Scene contents (inside Physics, inside CursorProvider)
   ========================================================= */
function SceneContents({ dynTents }) {
  return html`
    <${CursorProvider}>
      <${Ground} />
      <${Roads} />
      <${UrbanFurniture} />
      <${Houses} />
      <${City} />
      <${BuildingDetails} />
      <${Parks} />
      <${ConnectionSculpture} />
      <${AffordabilitySculpture} />
      <${ThresholdSculpture} />
      <${TransitionSculpture} />
      <${FoodBank} />
      <${Shelter} />
      <${WarmingCenter} />
      <${Tents} dynTents=${dynTents} />
      <${SleepingBags} />
      <${ShelterQueue} />
      <${FoodBankQueue} />
      <${OutreachWorker} />
      <${Trees} />
      <${WindTurbines} />
      <${Helicopter} spawn=${[ 30, 24,  0]} speed=${4.0} bodyColor="#5c80b8" trimColor="#3a4a64" />
      <${Helicopter} spawn=${[-28, 28, 18]} speed=${3.2} bodyColor="#c84038" trimColor="#7a2820" />
      <${Cars} />
      <${Flock} />
      <${PollenLayer} />
    </${CursorProvider}>
  `;
}

/* =========================================================
   App
   ========================================================= */
function App() {
  const [dragging, setDragging] = useState(false);
  const [dynTents, setDynTents] = useState([]);
  const [mode, setMode] = useState("cycle");   // 'day' | 'dusk' | 'cycle' — cycling by default

  // Time-of-day mode driven by the #time-toggle pill in the HTML chrome
  useEffect(() => {
    const onTime = (e) => setMode((e.detail && e.detail.mode) || "day");
    window.addEventListener("c4-time", onTime);
    return () => window.removeEventListener("c4-time", onTime);
  }, []);

  const addTent = useCallback((x, z) => {
    const d = Math.sqrt(x * x + z * z);
    if (d > 90) return;
    setDynTents((prev) => [
      ...prev,
      {
        x, z,
        hy: hillHeight(x, z) - 0.05,
        ry: Math.random() * Math.PI * 2,
        color: TENT_COLORS[Math.floor(Math.random() * TENT_COLORS.length)],
      },
    ]);
  }, []);

  return html`
    <${Canvas}
      shadows
      dpr=${[1, 1.3]}
      camera=${{ position: [36, 24, 46], fov: 55 }}
      gl=${{ antialias: true }}
    >
      <color attach="background" args=${["#6db9f0"]} />
      <fog attach="fog" args=${["#dceefb", 55, 225]} />
      <${SkyDome} />

      <${Lights} />
      <${DayCycle} mode=${mode} />

      <${DragContext.Provider} value=${setDragging}>
        <${AddTentContext.Provider} value=${addTent}>
          <${Physics} gravity=${[0, -9.82, 0]} iterations=${14} allowSleep>
            <${SceneContents} dynTents=${dynTents} />
          </${Physics}>
        </${AddTentContext.Provider}>
      </${DragContext.Provider}>

      <${ContactShadows}
        position=${[0, 0.01, 0]}
        opacity=${0.4}
        scale=${20}
        blur=${2.5}
        far=${4}
      />

      <${CloudLayer} />

      <${OrbitControls}
        ref=${(c) => (CYCLE_REFS.controls = c)}
        enabled=${!dragging}
        enableZoom=${true}
        enablePan=${false}
        target=${[0, 1.2, 0]}
        minDistance=${12}
        maxDistance=${110}
        minPolarAngle=${Math.PI / 10}
        maxPolarAngle=${Math.PI / 2.5}
      />
      <${FocusController} />

      <!-- Lean post stack: DoF (kept — it carries the look) + cheap
           color passes. SSAO and GodRays dropped: each re-rendered the
           scene geometry every frame and caused the stutter. -->
      <${EffectComposer} disableNormalPass multisampling=${0}>
        <${DepthOfField}
          ref=${(e) => (CYCLE_REFS.dof = e)}
          focalLength=${0.02}
          bokehScale=${2.4}
          height=${480} />
        <${Bloom}
          luminanceThreshold=${1.1}
          luminanceSmoothing=${0.1}
          intensity=${0.5}
          radius=${0.6}
          mipmapBlur />
        <${LUT} lut=${GRADE_LUT_TEX} />
        <${Vignette}
          eskil=${false}
          offset=${0.25}
          darkness=${0.18} />
      </${EffectComposer}>
    </${Canvas}>
  `;
}

/* =========================================================
   Mount
   ========================================================= */
const root = createRoot(document.getElementById("root"));
root.render(html`<${App} />`);
