"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity */
// Supply drop: crate descends on a parachute at dawn, lands, opens (lid, straps), light spills out, perk floats up.
import { Environment, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { sfx } from "../../core/audio";
import { useQuality } from "../../core/perf";
import { useGame, usePhaseData } from "../../core/useGame";
import { PERKS, crateTier, type PerkId } from "../../data/perks";
import { Particles, type ParticlesApi } from "../../three/ship/fx";
import { Perk3D } from "./Perk3D";
import { isRevealed } from "../../core/loading";

export const DROP_HDRI = "/hdri/kiara_1_dawn_1k.hdr";
const TEX = ["/textures/ship/concrete_diff.jpg", "/textures/ship/concrete_nor_gl.jpg", "/textures/ship/concrete_arm.jpg"];
export const DROP_ASSETS = [DROP_HDRI, ...TEX];
const LAND_T = 3.6;
const TIER_COLOR: Record<string, string> = { common: "#7fd0ff", rare: "#ffd56a", legendary: "#ff9bf0" };

const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function stencil() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#d9d6c8";
  x.font = "800 96px Arial, Helvetica, sans-serif";
  x.fillText("APOLLO N", 30, 110);
  x.font = "600 44px Arial, Helvetica, sans-serif";
  x.fillText("SUPPLY DROP  ·  HANDLE WITH CARE", 34, 175);
  x.fillStyle = "#e6b422";
  for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(700 + i * 26, 20); x.lineTo(726 + i * 26, 20); x.lineTo(700 + i * 26 + 14, 70); x.lineTo(674 + i * 26 + 14, 70); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function chuteTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 64;
  const x = c.getContext("2d")!;
  for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? "#f4f1ea" : "#e8581c"; x.fillRect((i * 512) / 16, 0, 512 / 16, 64); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function Crate({ opened, perk }: { opened: boolean; perk?: PerkId }) {
  const lid = useRef<THREE.Group>(null);
  const strapA = useRef<THREE.Group>(null);
  const strapB = useRef<THREE.Group>(null);
  const perkG = useRef<THREE.Group>(null);
  const spill = useRef<THREE.PointLight>(null);
  const cone = useRef<THREE.Mesh>(null);
  const chute = useRef<THREE.Group>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const root = useRef<THREE.Group>(null);
  const dust = useRef<ParticlesApi>(null);
  const t0 = useRef(0);
  const tOpen = useRef<number | null>(null);
  const landed = useRef(false);
  const q = useQuality();
  const tier = perk ? PERKS[perk].rarity : "common";
  const color = TIER_COLOR[crateTier(tier === "legendary" ? 100 : tier === "rare" ? 70 : 20)];

  const mats = useMemo(() => {
    const dec = stencil();
    return {
      body: new THREE.MeshStandardMaterial({ color: "#3a4a3b", metalness: 0.35, roughness: 0.55 }),
      trim: new THREE.MeshStandardMaterial({ color: "#1f2522", metalness: 0.6, roughness: 0.45 }),
      chrome: new THREE.MeshStandardMaterial({ color: "#c9ced3", metalness: 1, roughness: 0.25 }),
      strap: new THREE.MeshStandardMaterial({ color: "#e0a30f", metalness: 0, roughness: 0.85 }),
      foam: new THREE.MeshStandardMaterial({ color: "#16181b", roughness: 1 }),
      decal: new THREE.MeshStandardMaterial({ map: dec, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
      chute: new THREE.MeshStandardMaterial({ map: chuteTexture(), side: THREE.DoubleSide, roughness: 0.9, metalness: 0 }),
      line: new THREE.LineBasicMaterial({ color: "#d8d4c6", transparent: true }),
      coneMat: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
  }, [color]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const chuteGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(3, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.46);
    g.scale(1, 0.62, 1);
    return g;
  }, []);
  const lineGeo = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push(Math.cos(a) * 2.9, 5.2, Math.sin(a) * 2.9, i < 4 ? (i % 2 ? 0.8 : -0.8) : i % 2 ? 0.8 : -0.8, 1.0, i < 4 ? (i < 2 ? 0.45 : -0.45) : i < 6 ? 0.45 : -0.45);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useEffect(() => () => { chuteGeo.dispose(); lineGeo.dispose(); }, [chuteGeo, lineGeo]);

  useFrame((state, dt) => {
    if (isRevealed("drop")) t0.current += dt; // the crate falls once the scene is on screen
    const t = t0.current;
    const r = root.current!;
    // descent with swing, then settle
    const fall = 1 - sm(0, LAND_T, t);
    const y = fall * fall * 22 * (1 - 0.0) + 0.0;
    r.position.y = Math.max(0, y) + 0.001;
    r.rotation.z = Math.sin(t * 1.6) * 0.12 * fall;
    r.rotation.x = Math.cos(t * 1.2) * 0.07 * fall;
    if (chute.current) {
      const c = chute.current;
      if (t < LAND_T + 0.2) {
        c.position.set(0, 0, 0);
        c.scale.set(1, 1, 1);
      } else {
        const k = sm(LAND_T + 0.2, LAND_T + 2.2, t);
        const sy = 1 - k * 0.9;
        c.position.set(-3.4 * k, -5 * (1 - sy) + 0.02, -3.2 * k);
        c.scale.set(1 + k * 0.5, sy, 1 + k * 0.5);
      }
      c.visible = true;
      if (lines.current) lines.current.visible = t < LAND_T + 0.15;
    }
    if (!landed.current && t >= LAND_T) {
      landed.current = true;
      sfx("thunk", { volume: 0.7 });
      const n = Math.round(26 * q.instances);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        dust.current?.emit(1, { pos: [Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.5], posJitter: [0.3, 0.05, 0.3], vel: [Math.cos(a) * 1.4, 0.35, Math.sin(a) * 1.4], velJitter: [0.4, 0.2, 0.4], life: 2.2, size0: 0.4, size1: 1.7, color: [0.62, 0.58, 0.52] });
      }
    }
    // opening
    if (opened && tOpen.current === null) { tOpen.current = t; sfx("clank", { volume: 0.6 }); setTimeout(() => sfx("hiss", { volume: 0.4 }), 150); }
    const to = tOpen.current === null ? -1 : t - tOpen.current;
    const lidK = sm(0.35, 1.6, to);
    if (lid.current) lid.current.rotation.x = -lidK * 1.95;
    const strapK = sm(0.0, 0.7, to);
    for (const [ref, dir] of [[strapA, -1], [strapB, 1]] as const) {
      if (!ref.current) continue;
      ref.current.position.set(dir * strapK * 0.5, -strapK * strapK * 0.45, 0);
      ref.current.rotation.z = dir * strapK * 0.6;
      ref.current.visible = strapK < 0.999;
    }
    const rise = sm(0.9, 2.6, to);
    if (perkG.current) {
      perkG.current.visible = to > 0.6;
      perkG.current.position.set(0, 0.35 + rise * 1.0 + Math.sin(t * 1.8) * 0.04 * rise, 0);
      perkG.current.rotation.y = t * 0.8;
      perkG.current.scale.setScalar(0.4 + 0.6 * sm(0.6, 1.8, to));
    }
    const glow = sm(0.4, 1.4, to);
    if (spill.current) spill.current.intensity = glow * 6 * (0.92 + Math.sin(t * 5) * 0.08);
    mats.coneMat.opacity = glow * 0.09;
    if (cone.current) cone.current.visible = glow > 0.01;
    void state;
  });

  const W = 1.6, H = 0.62, D = 0.9, LH = 0.26;
  return (
    <>
      <group ref={root}>
        <group position={[0, 0, 0]}>
          {/* body */}
          <mesh material={mats.body} position={[0, H / 2, 0]} castShadow receiveShadow><boxGeometry args={[W, H, D]} /></mesh>
          {/* horizontal ribs */}
          {[-0.3, 0, 0.3].map((z) => (
            <mesh key={z} material={mats.trim} position={[0, H / 2, z * 1.6]}><boxGeometry args={[W + 0.02, 0.04, 0.03]} /></mesh>
          ))}
          {[-0.45, 0.45].map((x) => (
            <mesh key={x} material={mats.trim} position={[x * 1.7, H / 2, 0]}><boxGeometry args={[0.05, H + 0.01, D + 0.02]} /></mesh>
          ))}
          {/* corner guards */}
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
            <mesh key={i} material={mats.trim} position={[sx * (W / 2), H / 2, sz * (D / 2)]}><boxGeometry args={[0.1, H + 0.04, 0.1]} /></mesh>
          ))}
          {/* decal front */}
          <mesh material={mats.decal} position={[0, H / 2 + 0.02, D / 2 + 0.012]}><planeGeometry args={[1.2, 0.3]} /></mesh>
          {/* interior foam + glow floor */}
          <mesh material={mats.foam} position={[0, H + 0.001, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[W - 0.12, D - 0.12]} /></mesh>
          {/* handles */}
          {[-1, 1].map((s) => (
            <mesh key={s} material={mats.chrome} position={[s * (W / 2 + 0.035), H / 2, 0]} rotation-y={Math.PI / 2}><torusGeometry args={[0.1, 0.014, 8, 20, Math.PI]} /></mesh>
          ))}
          {/* perk + light */}
          <group ref={perkG} visible={false}>{perk && <Perk3D id={perk} />}</group>
          <pointLight ref={spill} position={[0, H + 0.4, 0]} color={color} intensity={0} distance={9} decay={1.6} />
          <mesh ref={cone} material={mats.coneMat} position={[0, H + 1.2, 0]} visible={false}>
            <cylinderGeometry args={[0.75, 0.4, 2.4, 28, 1, true]} />
          </mesh>
          {/* lid, hinged at back top edge */}
          <group ref={lid} position={[0, H, -D / 2]}>
            <mesh material={mats.body} position={[0, LH / 2, D / 2]} castShadow><boxGeometry args={[W + 0.02, LH, D + 0.02]} /></mesh>
            <mesh material={mats.trim} position={[0, LH + 0.01, D / 2]}><boxGeometry args={[W - 0.2, 0.02, D - 0.2]} /></mesh>
            {[-0.5, 0.5].map((x) => (
              <mesh key={x} material={mats.trim} position={[x, LH / 2, D / 2 + D / 2 + 0.012]}><boxGeometry args={[0.1, 0.12, 0.03]} /></mesh>
            ))}
            {/* straps over the lid */}
            <group ref={strapA} position={[0, 0, 0]}>
              <mesh material={mats.strap} position={[-0.38, LH + 0.03, D / 2]}><boxGeometry args={[0.07, 0.014, D + 0.08]} /></mesh>
              <mesh material={mats.strap} position={[-0.38, LH / 2, D + 0.04]}><boxGeometry args={[0.07, LH + 0.08, 0.014]} /></mesh>
              <mesh material={mats.chrome} position={[-0.38, LH + 0.04, D / 2]}><boxGeometry args={[0.1, 0.02, 0.06]} /></mesh>
            </group>
            <group ref={strapB}>
              <mesh material={mats.strap} position={[0.38, LH + 0.03, D / 2]}><boxGeometry args={[0.07, 0.014, D + 0.08]} /></mesh>
              <mesh material={mats.strap} position={[0.38, LH / 2, D + 0.04]}><boxGeometry args={[0.07, LH + 0.08, 0.014]} /></mesh>
              <mesh material={mats.chrome} position={[0.38, LH + 0.04, D / 2]}><boxGeometry args={[0.1, 0.02, 0.06]} /></mesh>
            </group>
            {/* latches */}
            {[-0.55, 0, 0.55].map((x) => (
              <mesh key={x} material={mats.chrome} position={[x, -0.01, D + 0.03]}><boxGeometry args={[0.12, 0.08, 0.03]} /></mesh>
            ))}
          </group>
        </group>
        {/* parachute */}
        <group ref={chute} position={[0, 0, 0]}>
          <mesh geometry={chuteGeo} material={mats.chute} position={[0, 5.0, 0]} castShadow />
          <lineSegments ref={lines} geometry={lineGeo} material={mats.line} />
        </group>
      </group>
      <Particles ref={dust} max={160} drag={1.6} gravity={[0, -0.05, 0]} opacity={0.75} ambient={0.6} lightDir={[0.4, 0.7, 0.5]} />
    </>
  );
}

function Rig({ opened }: { opened: boolean }) {
  const camera = useThree((s) => s.camera);
  const look = useMemo(() => new THREE.Vector3(1.1, 0.8, 0), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const t = useRef(0);
  const to = useRef<number | null>(null);
  useFrame((_, dt) => {
    t.current += dt;
    if (opened && to.current === null) to.current = t.current;
    const k = to.current === null ? 0 : sm(0, 3.2, t.current - to.current);
    const approach = 1 - sm(0, LAND_T + 0.4, t.current) * 0.0;
    const ang = 0.55 + Math.sin(t.current * 0.25) * 0.12 - k * 0.2;
    const dist = 5.6 - k * 1.6;
    const h = 2.2 - k * 0.5 + (1 - sm(0, LAND_T, t.current)) * 3.2 * approach;
    pos.set(Math.sin(ang) * dist + 0.9, h, Math.cos(ang) * dist);
    camera.position.lerp(pos, Math.min(1, dt * 3));
    look.set(1.1 - k * 0.15, 0.8 + k * 0.35 + (1 - sm(0, LAND_T, t.current)) * 3.0, 0);
    camera.lookAt(look);
  });
  return null;
}

export function DropScene() {
  const q = useQuality();
  const { state } = useGame();
  const d = usePhaseData<{ opened: boolean; perk: PerkId }>("drop");
  void state;
  const [diff, nor, arm] = useTexture(TEX, (t) => {
    (Array.isArray(t) ? t : [t]).forEach((x) => { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(10, 10); x.anisotropy = 8; });
  });
  useMemo(() => { diff.colorSpace = THREE.SRGBColorSpace; }, [diff]);
  useEffect(() => () => [diff, nor, arm].forEach((t) => t.dispose()), [diff, nor, arm]); // drei-cached: free the GPU copies
  return (
    <>
      <Suspense fallback={null}>
        <Environment files={DROP_HDRI} background backgroundBlurriness={0.0} environmentIntensity={0.7} backgroundIntensity={0.9} />
      </Suspense>
      <directionalLight position={[-6, 5, -3]} intensity={3.4} color="#ffc99a" castShadow={q.shadows} shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-camera-near={1} shadow-camera-far={30} shadow-bias={-0.0003} shadow-normalBias={0.02} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[60, 48]} />
        <meshStandardMaterial map={diff} normalMap={nor} roughnessMap={arm} aoMap={arm} color="#8d8f92" />
      </mesh>
      <Crate opened={!!d.opened} perk={d.perk} />
      <Rig opened={!!d.opened} />
      <Effects bloom={0.45} ao={false} />
    </>
  );
}
