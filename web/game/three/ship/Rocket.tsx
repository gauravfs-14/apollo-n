"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity */
// Saturn V-class heavy launch vehicle (procedural, ~111 m tall at real scale, ~12k triangles).
// Four separable groups so the launch cinematic can stage it:
//   s1  first stage (5 engine bells, fins, skirt)      base of bells at y=0
//   s2  interstage + second stage + conical adapter
//   s3  third stage + instrument unit + adapter + service/command module
//   les launch escape tower
// Plumes/lights for each stage can be injected with the `extras` prop (rendered inside the stage group).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Build, lathe } from "./geo";
import { shipMaterials } from "./materials";

type K = "white" | "black" | "steel" | "gold" | "bell" | "orange" | "decal" | "dark" | "glass";
export interface RocketRefs {
  root: THREE.Group;
  s1: THREE.Group;
  s2: THREE.Group;
  s3: THREE.Group;
  les: THREE.Group;
}
/** Engine layout in rocket space (for plumes). */
export const S1_ENGINES: [number, number][] = [[0, 0], [2.1, 2.1], [-2.1, 2.1], [2.1, -2.1], [-2.1, -2.1]];
export const S1_BELL_EXIT = 1.9;
export const S2_BASE_Y = 52;
export const S3_BASE_Y = 78;
export const ROCKET_HEIGHT = 124;

function whiteTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 512;
  const x = c.getContext("2d")!;
  x.fillStyle = "#f2f2ee";
  x.fillRect(0, 0, 256, 512);
  // vertical weathering streaks
  for (let i = 0; i < 70; i++) {
    const px = Math.random() * 256, w = 1 + Math.random() * 5;
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "rgba(90,80,70,0)");
    g.addColorStop(0.2 + Math.random() * 0.4, `rgba(90,80,70,${0.04 + Math.random() * 0.08})`);
    g.addColorStop(1, "rgba(90,80,70,0)");
    x.fillStyle = g;
    x.fillRect(px, 0, w, 512);
  }
  x.strokeStyle = "rgba(60,60,60,0.35)";
  x.lineWidth = 1;
  for (let y = 0; y < 512; y += 64) { x.beginPath(); x.moveTo(0, y + 0.5); x.lineTo(256, y + 0.5); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function decalTex(text: string, sub?: string) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 1024;
  const x = c.getContext("2d")!;
  x.translate(64, 512);
  x.rotate(Math.PI / 2);
  x.fillStyle = "#111";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = "800 82px Arial, Helvetica, sans-serif";
  x.fillText(text, 0, sub ? -12 : 0);
  if (sub) { x.font = "600 34px Arial"; x.fillText(sub, 0, 50); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rocketBell(r0: number, r1: number, len: number) {
  const pts: [number, number][] = [[r0 * 1.6, 0], [r0 * 1.9, -0.1 * len], [r0, -0.25 * len]];
  for (let i = 1; i <= 12; i++) { const s = i / 12; pts.push([r0 + (r1 - r0) * Math.pow(s, 0.55), -0.25 * len - 0.75 * len * s]); }
  const g = lathe(pts, 32);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Color("#4a3f36"), b = new THREE.Color("#1d1f22"), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, -pos.getY(i) / len);
    tmp.copy(a).lerp(b, t * 1.2);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

function ring(b: Build<K>, k: K, r: number, y: number, h: number) {
  b.cyl(k, r + 0.015, r + 0.015, h, [0, y + h / 2, 0], [0, 0, 0], 48);
}

function buildS1() {
  const b = new Build<K>();
  const R = 5.05;
  // engines
  S1_ENGINES.forEach(([x, z], i) => {
    const big = i === 0 ? 1 : 1;
    b.add(rocketBell(0.75 * big, S1_BELL_EXIT, 5.5), "bell", [x, 6.8, z]);
    b.cyl("steel", 0.9, 1.1, 1.2, [x, 6.9, z], [0, 0, 0], 20);
    b.torus("steel", S1_BELL_EXIT, 0.07, [x, 1.3, z]);
  });
  // engine shroud / aft skirt
  b.cyl("black", R * 0.98, R, 1.6, [0, 7.8, 0], [0, 0, 0], 56);
  b.cyl("black", R, R, 3.2, [0, 9.6, 0], [0, 0, 0], 56);
  // main tank
  b.cyl("white", R, R, 37.5, [0, 29.0, 0], [0, 0, 0], 64);
  for (const [y, h] of [[12.3, 1.6], [20, 0.4], [34, 0.4], [44.5, 2.2]] as const) ring(b, "black", R, y, h);
  for (const y of [22, 28, 38]) b.torus("steel", R + 0.02, 0.05, [0, y, 0], [Math.PI / 2, 0, 0], 64);
  // interstage
  b.cyl("black", R, R, 5.1, [0, 49.45, 0], [0, 0, 0], 64);
  b.cyl("white", R + 0.01, R + 0.01, 1.6, [0, 48, 0], [0, 0, 0], 64);
  // fins (4, at 45 degrees)
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const fin = new THREE.Shape();
    fin.moveTo(0, 0); fin.lineTo(5.6, 0.4); fin.lineTo(5.6, 6.8); fin.lineTo(0, 14); fin.closePath();
    const g = new THREE.ExtrudeGeometry(fin, { depth: 0.35, bevelEnabled: false });
    g.translate(0, 0, -0.17);
    // shape x -> radial, y -> up
    b.add(g, "white", [Math.cos(a) * (R - 0.4), 8.0, -Math.sin(a) * (R - 0.4)], [0, a, 0]);
  }
  // decals: vertical text on the white stage
  b.add(new THREE.PlaneGeometry(1.7, 13.5), "decal", [0, 30, R + 0.06]);
  b.add(new THREE.PlaneGeometry(1.7, 13.5), "decal", [0, 30, -R - 0.06], [0, Math.PI, 0]);
  return b;
}

function buildS2() {
  const b = new Build<K>();
  const R = 5.05;
  b.cyl("white", R, R, 22.5, [0, 63.5, 0], [0, 0, 0], 64);
  for (const [y, h] of [[52.2, 0.8], [74.2, 0.8]] as const) ring(b, "black", R, y, h);
  b.torus("steel", R + 0.02, 0.05, [0, 63, 0], [Math.PI / 2, 0, 0], 64);
  // J-2 engine bells recessed under the stage
  b.cyl("black", R * 0.97, R * 0.97, 0.5, [0, 52, 0], [0, 0, 0], 48);
  S1_ENGINES.slice(0, 5).forEach(([x, z]) => b.add(rocketBell(0.35, 1.0, 3.0), "bell", [x * 0.6, 52, z * 0.6]));
  // conical adapter to the third stage
  b.add(new THREE.CylinderGeometry(3.3, R, 3.0, 64), "white", [0, 76.5, 0]);
  b.add(new THREE.PlaneGeometry(1.5, 10), "decal", [0, 63, R + 0.06], [0, 0, 0]);
  b.add(new THREE.PlaneGeometry(1.5, 10), "decal", [0, 63, -R - 0.06], [0, Math.PI, 0]);
  return b;
}

function buildS3() {
  const b = new Build<K>();
  const R = 3.3;
  b.cyl("white", R, R, 16, [0, 86, 0], [0, 0, 0], 56);
  b.add(rocketBell(0.25, 0.95, 3), "bell", [0, 78.4, 0]);
  ring(b, "black", R, 78.2, 0.7);
  ring(b, "black", R, 93.3, 0.7);
  b.cyl("black", R, R, 1.0, [0, 94.5, 0], [0, 0, 0], 56);
  // service module adapter (cone) and service module
  b.add(new THREE.CylinderGeometry(1.95, R, 6.5, 48), "white", [0, 98.25, 0]);
  b.cyl("white", 1.95, 1.95, 7.2, [0, 105.1, 0], [0, 0, 0], 48);
  b.cyl("gold", 1.97, 1.97, 0.9, [0, 108.3, 0], [0, 0, 0], 48);
  b.add(new THREE.PlaneGeometry(1.2, 6), "decal", [0, 105.5, 1.99], [0, 0, 0]);
  b.add(new THREE.CylinderGeometry(0.35, 1.95, 3.5, 48), "white", [0, 110.9, 0]);
  b.cyl("steel", 0.36, 0.36, 0.3, [0, 112.8, 0], [0, 0, 0], 16);
  return b;
}

function buildLES() {
  const b = new Build<K>();
  // truss tower + solid motor + nose
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    b.strut("steel", [Math.cos(a) * 1.2, 113, Math.sin(a) * 1.2], [Math.cos(a) * 0.35, 121, Math.sin(a) * 0.35], 0.08, 6);
  }
  b.cyl("white", 0.5, 0.5, 8, [0, 121.5, 0], [0, 0, 0], 24);
  b.add(new THREE.ConeGeometry(0.5, 2.6, 24), "white", [0, 126.8, 0]);
  b.cyl("orange", 0.52, 0.52, 0.6, [0, 118, 0], [0, 0, 0], 24);
  return b;
}

let rocketsLive = 0;
const cacheB = new Map<string, [K, THREE.BufferGeometry][]>();
const get = (k: string, f: () => Build<K>) => {
  let v = cacheB.get(k);
  if (!v) cacheB.set(k, (v = f().merged()));
  return v;
};

export interface RocketProps extends Omit<React.ComponentProps<"group">, "ref"> {
  extras?: { s1?: ReactNode; s2?: ReactNode; s3?: ReactNode };
  shadows?: boolean;
}

export const Rocket = forwardRef<RocketRefs, RocketProps>(function Rocket({ extras, shadows = true, ...group }, ref) {
  const root = useRef<THREE.Group>(null!);
  const s1 = useRef<THREE.Group>(null!);
  const s2 = useRef<THREE.Group>(null!);
  const s3 = useRef<THREE.Group>(null!);
  const les = useRef<THREE.Group>(null!);
  useImperativeHandle(ref, () => ({ get root() { return root.current; }, get s1() { return s1.current; }, get s2() { return s2.current; }, get s3() { return s3.current; }, get les() { return les.current; } }));

  const mats = useMemo(() => {
    const ship = shipMaterials();
    const white = new THREE.MeshStandardMaterial({ map: whiteTexture(), color: "#ffffff", roughness: 0.42, metalness: 0.04 });
    const black = new THREE.MeshStandardMaterial({ color: "#111214", roughness: 0.5, metalness: 0.1 });
    const mk = (t: THREE.Texture) => new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const decal = mk(decalTex("UNITED STATES"));
    return { white, black, decal, steel: ship.steel, gold: ship.gold, bell: ship.bell, orange: ship.orange, dark: ship.dark, glass: ship.glass } as Record<K, THREE.Material>;
  }, []);
  useEffect(() => () => {
    (mats.white as THREE.MeshStandardMaterial).map?.dispose();
    (mats.decal as THREE.MeshStandardMaterial).map?.dispose();
    mats.white.dispose(); mats.black.dispose(); mats.decal.dispose();
  }, [mats]);

  // merged geometries are cached module-wide; free their GPU buffers when the last rocket unmounts (re-uploaded on demand)
  useEffect(() => {
    rocketsLive++;
    return () => {
      if (--rocketsLive === 0) for (const list of cacheB.values()) for (const [, g] of list) g.dispose();
    };
  }, []);
  const parts = useMemo(() => ({ s1: get("s1", buildS1), s2: get("s2", buildS2), s3: get("s3", buildS3), les: get("les", buildLES) }), []);
  const render = (d: [K, THREE.BufferGeometry][]) => d.map(([k, g], i) => <mesh key={i} geometry={g} material={mats[k]} castShadow={shadows} receiveShadow={shadows} />);

  return (
    <group ref={root} {...group}>
      <group ref={s1}>{render(parts.s1)}{extras?.s1}</group>
      <group ref={s2}>{render(parts.s2)}{extras?.s2}</group>
      <group ref={s3}>{render(parts.s3)}{extras?.s3}</group>
      <group ref={les}>{render(parts.les)}</group>
    </group>
  );
});
