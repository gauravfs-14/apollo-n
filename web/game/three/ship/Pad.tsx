"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity */
// Launch complex: elevated launch mount over a flame trench, umbilical tower with swing arms,
// lightning masts, concrete apron and scrubland. Rocket stands at (0, PAD_H, 0).
import { useTexture } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Build } from "./geo";

export const PAD_H = 14;
export const TOWER_X = 38;
export const TOWER_H = 125;
export const ACCESS_ARM_Y = 109.5; // arm centre; walkway is at ACCESS_ARM_Y + 1.3
export const PAD_TEXTURES = [
  "/textures/ship/concrete_diff.jpg", "/textures/ship/concrete_nor_gl.jpg", "/textures/ship/concrete_arm.jpg",
  "/textures/ship/ground_diff.jpg", "/textures/ship/ground_nor_gl.jpg", "/textures/ship/ground_arm.jpg",
];

type K = "tower" | "rust" | "dark" | "concrete" | "white";

function lattice(b: Build<K>, cx: number, cz: number, w: number, h: number, bays: number, r: number) {
  const hw = w / 2;
  const bh = h / bays;
  const corners: [number, number][] = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (const [x, z] of corners) b.strut("tower", [cx + x, 0, cz + z], [cx + x, h, cz + z], r * 1.6, 6);
  for (let i = 0; i <= bays; i++) {
    const y = i * bh;
    for (let c = 0; c < 4; c++) {
      const [x0, z0] = corners[c], [x1, z1] = corners[(c + 1) % 4];
      b.strut("tower", [cx + x0, y, cz + z0], [cx + x1, y, cz + z1], r, 4);
      if (i < bays) {
        b.strut("tower", [cx + x0, y, cz + z0], [cx + x1, y + bh, cz + z1], r * 0.8, 4);
        b.strut("tower", [cx + x1, y, cz + z1], [cx + x0, y + bh, cz + z0], r * 0.8, 4);
      }
    }
  }
}

function buildPad() {
  const b = new Build<K>();
  // launch mount: four slabs around the exhaust hole, on pedestals
  const top = PAD_H, th = 6;
  b.box("concrete", 46, th, 15, [0, top - th / 2, -15.5]);
  b.box("concrete", 46, th, 15, [0, top - th / 2, 15.5]);
  b.box("concrete", 15, th, 16, [-15.5, top - th / 2, 0]);
  b.box("concrete", 15, th, 16, [15.5, top - th / 2, 0]);
  b.box("dark", 46.4, 1.0, 40.4, [0, top - th - 0.5, 0]);
  for (const [x, z] of [[-18, -14], [18, -14], [-18, 14], [18, 14]] as const) b.box("concrete", 5, top - th, 5, [x, (top - th) / 2, z]);
  // deflector in the trench
  b.box("dark", 14, 12, 14, [0, 6, 0], [0, 0, 0]);
  b.add(new THREE.ConeGeometry(9, 12, 4), "dark", [0, 10, 0], [0, Math.PI / 4, 0]);
  // hold-down arms and service frames on the deck
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    b.box("tower", 3, 2.2, 3, [Math.cos(a) * 7.2, top + 1.1, Math.sin(a) * 7.2]);
  }
  // umbilical tower
  lattice(b, TOWER_X, 0, 17, TOWER_H, 20, 0.28);
  b.box("rust", 18, 3, 18, [TOWER_X, 1.5, 0]);
  b.box("rust", 19, 3, 19, [TOWER_X, TOWER_H + 1.5, 0]);
  b.box("white", 6, 5, 6, [TOWER_X, TOWER_H + 5.5, 0]);
  b.strut("tower", [TOWER_X, TOWER_H + 5, 0], [TOWER_X, TOWER_H + 22, 0], 0.4, 6);
  // swing arms toward the rocket (x = 5 is the rocket skin)
  const arms = [26, 36, 48, 60, 74, 88, 100, ACCESS_ARM_Y];
  for (const y of arms) {
    const len = TOWER_X - 8.5 - 5.5;
    const x0 = TOWER_X - 8.5;
    b.box(y === ACCESS_ARM_Y ? "white" : "rust", len, 2.2, 3.2, [x0 - len / 2, y, 0]);
    b.box("tower", len, 0.2, 3.4, [x0 - len / 2, y + 1.2, 0]);
    b.strut("tower", [x0, y - 1, 1.5], [x0 - len * 0.7, y + 4, 1.5], 0.12, 4);
  }
  // lightning masts + floodlights
  for (const [x, z] of [[-75, -75], [75, -75], [-75, 75], [75, 75]] as const) {
    lattice(b, x, z, 3, 150, 12, 0.1);
    b.strut("tower", [x, 150, z], [x, 160, z], 0.2, 5);
  }
  return b;
}

export function LaunchPad({ shadows = true }: { shadows?: boolean }) {
  const [cD, cN, cA, gD, gN, gA] = useTexture(PAD_TEXTURES, (t) => {
    (Array.isArray(t) ? t : [t]).forEach((x) => { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 8; });
  });
  useMemo(() => {
    cD.colorSpace = THREE.SRGBColorSpace;
    gD.colorSpace = THREE.SRGBColorSpace;
    for (const t of [cD, cN, cA]) t.repeat.set(12, 12);
    for (const t of [gD, gN, gA]) t.repeat.set(220, 220);
  }, [cD, cN, cA, gD, gN, gA]);

  // cached by drei; free the GPU copies when the pad goes away (re-uploaded on the next mount)
  useEffect(() => () => [cD, cN, cA, gD, gN, gA].forEach((t) => t.dispose()), [cD, cN, cA, gD, gN, gA]);
  const parts = useMemo(() => buildPad().merged(), []);
  const mats = useMemo(
    () => ({
      tower: new THREE.MeshStandardMaterial({ color: "#868b91", metalness: 0.7, roughness: 0.55 }),
      rust: new THREE.MeshStandardMaterial({ color: "#8c3d2b", metalness: 0.4, roughness: 0.65 }),
      dark: new THREE.MeshStandardMaterial({ color: "#1c1e21", metalness: 0.3, roughness: 0.8 }),
      concrete: new THREE.MeshStandardMaterial({ map: cD, normalMap: cN, roughnessMap: cA, color: "#b9bbbd", roughness: 1 }),
      white: new THREE.MeshStandardMaterial({ color: "#e4e4e0", metalness: 0.1, roughness: 0.5 }),
    }) as Record<K, THREE.Material>,
    [cD, cN, cA],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  return (
    <group>
      {parts.map(([k, g], i) => <mesh key={i} geometry={g} material={mats[k]} castShadow={shadows} receiveShadow={shadows} />)}
      {/* apron */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} receiveShadow>
        <circleGeometry args={[160, 64]} />
        <meshStandardMaterial map={cD} normalMap={cN} roughnessMap={cA} aoMap={cA} color="#a9aaac" />
      </mesh>
      {/* scrubland */}
      <mesh rotation-x={-Math.PI / 2} position-y={0} receiveShadow>
        <circleGeometry args={[6000, 48]} />
        <meshStandardMaterial map={gD} normalMap={gN} roughnessMap={gA} aoMap={gA} color="#8a7e6c" />
      </mesh>
    </group>
  );
}
