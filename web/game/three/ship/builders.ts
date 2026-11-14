// Procedural lander modelling. 1 unit = 1 m, ground at y=0, +Z faces the hatch.
// Each builder returns merged geometry grouped by shared material.
import * as THREE from "three";
import { Build, dishGeo, lathe } from "./geo";

const PI = Math.PI;
export const DECK_Y = 3.25; // top of the descent stage
export const APOTHEM = 1.94; // descent stage face distance
export const HINGE_Y = 2.6;
export const ENGINE_Y = 1.3; // engine mounting plate

/** Descent stage, truss + tanks, crew cabin, ladder, decals. Always present. */
export function buildBase() {
  const b = new Build();
  const R = 2.1;
  const oct = [0, PI / 8, 0] as [number, number, number];
  // gold MLI descent stage
  b.add(new THREE.CylinderGeometry(R, R, 0.95, 8), "gold", [0, 2.775, 0], oct);
  b.add(new THREE.CylinderGeometry(R * 1.015, R * 1.015, 0.07, 8), "silver", [0, 2.35, 0], oct);
  b.add(new THREE.CylinderGeometry(R * 1.015, R * 1.015, 0.07, 8), "silver", [0, 3.2, 0], oct);
  b.add(new THREE.CylinderGeometry(R * 0.97, R * 1.0, 0.06, 8), "dark", [0, DECK_Y + 0.02, 0], oct);
  for (let k = 0; k < 8; k++) {
    const phi = PI / 8 + (k * PI) / 4;
    b.box("silver", 0.12, 0.95, 0.12, [R * Math.sin(phi), 2.775, R * Math.cos(phi)], [0, phi, 0]);
  }
  // lower truss + four spherical aluminium propellant tanks
  b.add(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 8), "dark", [0, ENGINE_Y, 0], oct);
  for (let k = 0; k < 4; k++) {
    const a = PI / 4 + (k * PI) / 2;
    const x = 1.0 * Math.sin(a), z = 1.0 * Math.cos(a);
    b.sph("alu", 0.5, [x, 1.82, z], 1, 28);
    b.torus("steel", 0.5, 0.02, [x, 1.82, z], [PI / 2, 0, 0]);
    b.strut("steel", [x, 1.35, z], [x, 2.33, z], 0.035);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2;
    b.strut("silver", [1.45 * Math.sin(a), ENGINE_Y, 1.45 * Math.cos(a)], [1.7 * Math.sin(a), 2.35, 1.7 * Math.cos(a)], 0.06);
    // cross bracing
    const a2 = a + PI / 4;
    b.strut("steel", [1.45 * Math.sin(a), 1.4, 1.45 * Math.cos(a)], [1.45 * Math.sin(a2), 2.25, 1.45 * Math.cos(a2)], 0.02, 6);
  }
  // crew cabin
  b.cyl("white", 1.15, 1.2, 1.9, [0, DECK_Y + 0.95, 0], [0, 0, 0], 40);
  b.cyl("silver", 1.22, 1.22, 0.18, [0, DECK_Y + 0.12, 0], [0, 0, 0], 40);
  b.add(new THREE.SphereGeometry(1.15, 40, 12, 0, PI * 2, 0, PI / 2), "white", [0, DECK_Y + 1.9, 0], [0, 0, 0], [1, 0.5, 1]);
  b.cyl("steel", 0.46, 0.5, 0.2, [0, DECK_Y + 2.45, 0], [0, 0, 0], 24);
  b.torus("alu", 0.46, 0.04, [0, DECK_Y + 2.56, 0]);
  b.cyl("dark", 0.38, 0.38, 0.03, [0, DECK_Y + 2.57, 0], [0, 0, 0], 24);
  // hatch + windows (+Z)
  b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 28), "silver", [0, DECK_Y + 0.85, 1.19], [PI / 2, 0, 0]);
  b.torus("alu", 0.42, 0.03, [0, DECK_Y + 0.85, 1.2], [0, 0, 0]);
  b.box("dark", 0.1, 0.1, 0.05, [0.3, DECK_Y + 0.85, 1.2]);
  for (const s of [-1, 1]) {
    const a = s * 0.55;
    const x = 1.17 * Math.sin(a), z = 1.17 * Math.cos(a);
    b.box("dark", 0.5, 0.4, 0.05, [x, DECK_Y + 1.5, z], [0.1, a, 0]);
    b.box("glass", 0.42, 0.32, 0.06, [x * 1.003, DECK_Y + 1.5, z * 1.003], [0.1, a, 0]);
  }
  // RCS quads
  for (let k = 0; k < 4; k++) {
    const a = PI / 4 + (k * PI) / 2;
    const px = 1.2 * Math.sin(a), pz = 1.2 * Math.cos(a);
    b.box("dark", 0.28, 0.28, 0.2, [px, DECK_Y + 0.55, pz], [0, a, 0]);
    for (const [dy, dx] of [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]] as const) {
      const nx = (1.2 + 0.2) * Math.sin(a) + dx * Math.cos(a), nz = (1.2 + 0.2) * Math.cos(a) - dx * Math.sin(a);
      b.add(new THREE.ConeGeometry(0.05, 0.12, 10), "steel", [nx, DECK_Y + 0.55 + dy, nz], [PI / 2, a, 0]);
    }
  }
  // porch + ladder on +Z
  b.box("silver", 1.1, 0.07, 0.9, [0, DECK_Y + 0.04, 2.0]);
  for (const s of [-1, 1]) {
    b.strut("silver", [s * 0.5, DECK_Y + 0.04, 2.35], [s * 0.5, DECK_Y + 0.55, 2.35], 0.02, 6);
    b.strut("alu", [s * 0.3, DECK_Y, 2.4], [s * 0.3, 0.1, 2.95], 0.03, 8);
  }
  for (let i = 0; i < 10; i++) {
    const t = (i + 0.5) / 10;
    b.cyl("alu", 0.018, 0.018, 0.6, [0, DECK_Y - t * (DECK_Y - 0.1), 2.4 + t * 0.55], [0, 0, PI / 2], 6);
  }
  // decals
  b.add(new THREE.PlaneGeometry(1.3, 0.65), "decal", [-0.85, 2.78, APOTHEM + 0.06]);
  b.add(new THREE.PlaneGeometry(1.3, 0.65), "decal", [0.85, 2.78, -APOTHEM - 0.06], [0, PI, 0]);
  // service-tank plumbing near engine plate
  b.torus("steel", 0.3, 0.025, [0, ENGINE_Y + 0.08, 0]);
  return b;
}

// ---------------- engines (hang below ENGINE_Y) ----------------
function bellGeo(rThroat: number, rExit: number, len: number, chamber: number, exp = 0.55) {
  const pts: [number, number][] = [[chamber * 0.6, 0], [chamber, -0.06 * len], [chamber * 0.8, -0.16 * len], [rThroat, -0.22 * len]];
  const n = 14;
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    pts.push([rThroat + (rExit - rThroat) * Math.pow(s, exp), -0.22 * len - 0.78 * len * s]);
  }
  const g = lathe(pts, 36);
  // vertex colours: anodised heat-tint gradient (steel -> bronze -> blue/violet -> dark)
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const stops = [
    [0.0, "#7d848c"], [0.2, "#b78b4a"], [0.35, "#7a5a9c"], [0.55, "#3b5c9a"], [0.8, "#2c3036"], [1.0, "#5c5f66"],
  ] as const;
  const c = new THREE.Color(), c2 = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, -pos.getY(i) / len));
    let j = 0;
    while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const k = (t - stops[j][0]) / (stops[j + 1][0] - stops[j][0]);
    c.set(stops[j][1]).lerp(c2.set(stops[j + 1][1]), Math.min(1, Math.max(0, k)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export function buildEngine(v: number) {
  const b = new Build();
  const y = ENGINE_Y - 0.06;
  if (v === 0) {
    // hydrolox single high-expansion bell with turbopumps
    b.add(bellGeo(0.12, 0.52, 0.95, 0.24), "bell", [0, y, 0]);
    b.torus("steel", 0.52, 0.02, [0, y - 0.95, 0]);
    b.cyl("steel", 0.26, 0.3, 0.2, [0, y + 0.0, 0]);
    b.cyl("alu", 0.09, 0.09, 0.45, [0.3, y - 0.12, 0.1], [0, 0, 0.2]);
    b.cyl("alu", 0.09, 0.09, 0.45, [-0.3, y - 0.12, -0.1], [0, 0, -0.2]);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      b.strut("steel", [0.14 * Math.cos(a), y - 0.2, 0.14 * Math.sin(a)], [0.34 * Math.cos(a), y - 0.8, 0.34 * Math.sin(a)], 0.008, 4);
    }
  } else if (v === 1) {
    // hypergolic cluster: four storable-propellant thrusters + gimbal ring
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + (i * PI) / 2;
      const x = 0.38 * Math.cos(a), z = 0.38 * Math.sin(a);
      b.add(bellGeo(0.06, 0.24, 0.62, 0.12, 0.5), "bell", [x, y - 0.05, z]);
      b.cyl("alu", 0.07, 0.07, 0.3, [x, y + 0.05, z]);
    }
    b.add(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 24), "dark", [0, y - 0.04, 0]);
    b.torus("silver", 0.55, 0.025, [0, y - 0.1, 0]);
    b.sph("alu", 0.2, [0, y - 0.2, 0]);
  } else {
    // methalox wide bell with insulated skirt and regenerative lines
    b.add(bellGeo(0.2, 0.82, 1.0, 0.36, 0.45), "bell", [0, y, 0]);
    b.torus("silver", 0.84, 0.03, [0, y - 1.0, 0]);
    b.cyl("silver", 0.5, 0.64, 0.4, [0, y - 0.15, 0], [0, 0, 0], 28);
    b.cyl("steel", 0.35, 0.4, 0.22, [0, y + 0.0, 0]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      b.cyl("orange", 0.035, 0.035, 0.8, [0.45 * Math.cos(a), y - 0.2, 0.45 * Math.sin(a)], [0.18 * Math.cos(a), 0, -0.18 * Math.sin(a)], 8);
    }
  }
  return b;
}

// ---------------- legs ----------------
export const LEG_HINGE_R = APOTHEM + 0.08;
const LEG_FOOT: [number, number][] = [[1.45, -2.52], [2.1, -2.52], [1.05, -2.52]];
export function legFootX(v: number) { return LEG_FOOT[v][0]; }

export function buildLeg(v: number) {
  const b = new Build();
  const [fx, fy] = LEG_FOOT[v];
  const sp = v === 1 ? 0.2 : 0.3;
  for (const z of [-sp, sp]) {
    const a: [number, number, number] = [0, 0, z];
    const f: [number, number, number] = [fx, fy + 0.18, 0];
    const mid: [number, number, number] = [fx * 0.52, (fy + 0.18) * 0.52, z * 0.48];
    b.strut("alu", a, mid, v === 2 ? 0.12 : 0.085, 12);
    b.strut("steel", mid, f, v === 2 ? 0.085 : 0.06, 10);
    b.sph("silver", 0.06, a, 1, 12);
  }
  // secondary brace from body to mid strut
  b.strut("steel", [-0.9, -0.25, 0], [fx * 0.55, (fy + 0.18) * 0.55, 0], 0.045, 8);
  // crushable honeycomb/accordion element
  if (v === 2) {
    for (let i = 0; i < 6; i++) b.torus("silver", 0.1, 0.02, [fx * (0.62 + i * 0.05), (fy + 0.18) * (0.62 + i * 0.05), 0], [PI / 2, 0, 0.9]);
  } else {
    b.cyl("orange", 0.06, 0.06, 0.28, [fx * 0.78, (fy + 0.18) * 0.78, 0], [0, 0, Math.atan2(fx, -(fy + 0.18))], 10);
  }
  // footpad: shallow dish with rim
  const pr = v === 2 ? 0.75 : v === 1 ? 0.62 : 0.5;
  b.add(new THREE.SphereGeometry(pr, 24, 8, 0, PI * 2, 0, PI / 2), "silver", [fx, fy + 0.2, 0], [PI, 0, 0], [1, 0.16, 1]);
  b.cyl("alu", pr, pr, 0.04, [fx, fy + 0.03, 0], [0, 0, 0], 28);
  b.sph("steel", 0.09, [fx, fy + 0.2, 0], 1, 12);
  return b;
}

// ---------------- power ----------------
export function buildSolarWing() {
  // along +X from the body face; stowed by rotating about Z
  const b = new Build();
  b.strut("steel", [0, 0, 0], [0.6, 0, 0], 0.05);
  b.box("dark", 0.14, 0.14, 0.24, [0.05, 0, 0]);
  for (let i = 0; i < 2; i++) {
    const x0 = 0.65 + i * 1.65;
    b.box("dark", 1.55, 0.03, 2.5, [x0 + 0.78, -0.03, 0]);
    b.add(new THREE.PlaneGeometry(1.5, 2.45), "solar", [x0 + 0.78, 0.0, 0], [-PI / 2, 0, 0]);
    b.strut("steel", [x0 - 0.05, 0, 0], [x0 + 0.1, 0, 0], 0.03, 6);
  }
  return b;
}

export function buildPowerPods(v: number) {
  // v=1 RTG, v=2 fuel cell + battery packs (both on +/-X faces; mirrored by the component)
  const b = new Build();
  if (v === 1) {
    b.strut("steel", [0, 0, 0], [0.8, -0.2, 0], 0.05);
    b.cyl("dark", 0.2, 0.2, 1.3, [1.55, -0.35, 0], [0, 0, PI / 2], 20);
    for (let i = 0; i < 14; i++) b.cyl("fin", 0.34, 0.34, 0.025, [1.0 + i * 0.085, -0.35, 0], [0, 0, PI / 2], 24);
    b.cyl("white", 0.22, 0.22, 0.1, [2.25, -0.35, 0], [0, 0, PI / 2]);
    b.box("alu", 0.5, 0.5, 0.7, [0.45, -0.1, 0]);
    b.box("orange", 0.02, 0.5, 0.5, [0.7, -0.1, 0]);
  } else {
    b.box("white", 0.55, 1.0, 1.3, [0.28, 0, 0]);
    b.box("orange", 0.02, 0.7, 1.0, [0.56, 0, 0]);
    b.box("silver", 0.5, 0.08, 1.3, [0.28, 0.54, 0]);
    // radiator panel with fins
    b.box("white", 0.05, 0.9, 1.0, [0.75, 0.2, 0]);
    for (let i = 0; i < 9; i++) b.box("steel", 0.06, 0.9, 0.02, [0.78, 0.2, -0.45 + i * 0.1]);
    b.cyl("alu", 0.12, 0.12, 0.6, [0.28, -0.3, 0.8], [PI / 2, 0, 0]);
    b.cyl("alu", 0.12, 0.12, 0.6, [0.28, -0.3, -0.8], [PI / 2, 0, 0]);
  }
  return b;
}

// ---------------- payload (mounted on deck, -Z side) ----------------
export function buildPayload(v: number) {
  const b = new Build();
  const y0 = DECK_Y + 0.04;
  const z = 0;
  if (v === 0) {
    // drill rig: lattice mast, motor head, drill string
    const h = 2.7;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
      b.cyl("orange", 0.025, 0.025, h, [sx * 0.2, y0 + h / 2, z + sz * 0.2], [0, 0, 0], 6);
    for (let i = 0; i < 6; i++) {
      const y = y0 + 0.2 + i * 0.45;
      b.strut("orange", [-0.2, y, z - 0.2], [0.2, y + 0.45, z - 0.2], 0.012, 4);
      b.strut("orange", [0.2, y, z + 0.2], [-0.2, y + 0.45, z + 0.2], 0.012, 4);
      b.box("orange", 0.46, 0.02, 0.46, [0, y, z]);
    }
    b.box("dark", 0.5, 0.45, 0.5, [0, y0 + 1.7, z]);
    b.cyl("steel", 0.045, 0.045, 1.9, [0, y0 + 0.8, z], [0, 0, 0], 8);
    b.add(new THREE.ConeGeometry(0.08, 0.2, 10), "steel", [0, y0 - 0.25, z], [PI, 0, 0]);
    b.box("alu", 0.9, 0.06, 0.9, [0, y0 + 0.03, z]);
    b.sph("silver", 0.14, [0, y0 + h + 0.05, z], 1, 12);
  } else if (v === 1) {
    // spectrometer mast with camera head
    b.cyl("alu", 0.2, 0.25, 0.3, [0, y0 + 0.15, z], [0, 0, 0], 16);
    b.cyl("steel", 0.05, 0.05, 1.5, [0, y0 + 0.95, z]);
    b.cyl("alu", 0.035, 0.035, 1.2, [0, y0 + 1.7, z]);
    b.box("white", 0.5, 0.3, 0.3, [0, y0 + 2.45, z]);
    b.box("glass", 0.15, 0.15, 0.04, [-0.12, y0 + 2.45, z + 0.17]);
    b.box("glass", 0.15, 0.15, 0.04, [0.12, y0 + 2.45, z + 0.17]);
    b.cyl("dark", 0.07, 0.09, 0.25, [0, y0 + 2.45, z + 0.28], [PI / 2, 0, 0], 14);
    b.cyl("dark", 0.06, 0.06, 0.35, [0, y0 + 2.7, z], [0, 0, PI / 2], 12);
    b.box("silver", 0.5, 0.03, 0.3, [0, y0 + 2.62, z]);
    b.box("dark", 0.55, 0.3, 0.45, [0.55, y0 + 0.17, z + 0.1]);
    b.cyl("orange", 0.03, 0.03, 0.8, [0.55, y0 + 0.65, z + 0.1]);
  } else {
    // relay satellite pallet: gold drum, patch panel, small dish
    b.cyl("gold", 0.42, 0.42, 0.9, [0, y0 + 0.45, z], [0, 0, 0], 28);
    b.cyl("alu", 0.52, 0.52, 0.06, [0, y0 + 0.92, z], [0, 0, 0], 28);
    b.cyl("alu", 0.55, 0.55, 0.06, [0, y0 + 0.05, z], [0, 0, 0], 28);
    b.box("white", 0.45, 0.45, 0.04, [0, y0 + 0.7, z - 0.52], [0, PI, 0]);
    b.strut("steel", [0, y0 + 0.92, z], [0, y0 + 1.3, z], 0.03);
    b.add(dishGeo(0.35, 0.1, 24), "white", [0, y0 + 1.4, z], [-0.5, 0, 0]);
    b.strut("steel", [0, y0 + 1.4, z], [0, y0 + 1.62, z - 0.15], 0.01, 4);
    b.box("solar", 0.01, 0.01, 0.01, [0, -50, 0]);
    for (const s of [-1, 1]) b.add(new THREE.PlaneGeometry(0.9, 0.45), "solar", [s * 0.62, y0 + 0.5, z], [0, s * PI / 2, 0]);
  }
  return b.translate(1.3, 0, 1.2); // front-right of the deck so it is visible from the hatch side
}

// ---------------- comms (cabin top, +X side) ----------------
export function buildComms(v: number) {
  const b = new Build();
  const x = 0.6, y = DECK_Y + 2.1, z = -0.5;
  if (v === 0) {
    b.cyl("steel", 0.06, 0.08, 0.7, [x, y, z]);
    b.sph("alu", 0.12, [x, y + 0.4, z], 1, 12);
    b.add(dishGeo(0.68, 0.22, 36), "white", [x, y + 0.55, z], [0.45, 0, -0.35]);
    b.strut("steel", [x, y + 0.55, z], [x + 0.2, y + 1.0, z + 0.12], 0.012, 4);
    b.sph("dark", 0.04, [x + 0.2, y + 1.0, z + 0.12], 1, 8);
  } else if (v === 1) {
    b.cyl("steel", 0.05, 0.05, 1.0, [x, y + 0.2, z]);
    b.box("dark", 1.0, 1.0, 0.06, [x, y + 0.95, z], [0.3, 0.3, 0]);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++)
        b.box("silver", 0.08, 0.08, 0.01, [x + (i - 3.5) * 0.115 * Math.cos(0.3), y + 0.95 + (j - 3.5) * 0.115 * Math.cos(0.3), z + 0.04 - (i - 3.5) * 0.115 * Math.sin(0.3) * 0.0], [0.3, 0.3, 0]);
    b.strut("steel", [x, y + 0.2, z], [x - 0.35, y + 0.4, z - 0.2], 0.015, 4);
    b.strut("steel", [x, y + 0.2, z], [x - 0.2, y + 1.7, z - 0.5], 0.01, 4);
  } else {
    for (const [dx, dz, h] of [[0, 0, 1.6], [0.35, 0.25, 1.2], [-0.3, 0.3, 1.0]] as const) {
      b.cyl("steel", 0.012, 0.015, h, [x + dx, y + h / 2, z + dz], [0, 0, 0], 6);
      b.sph("alu", 0.03, [x + dx, y + h, z + dz], 1, 8);
    }
    b.cyl("alu", 0.1, 0.12, 0.2, [x, y + 0.1, z]);
    b.add(dishGeo(0.28, 0.08, 20), "white", [x + 0.5, y + 0.45, z - 0.3], [0.5, 0, -0.5]);
    b.strut("steel", [x + 0.2, y + 0.15, z - 0.1], [x + 0.5, y + 0.45, z - 0.3], 0.02, 6);
  }
  return b;
}
