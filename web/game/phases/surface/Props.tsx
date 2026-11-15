"use client";
/* eslint-disable react-hooks/immutability, react-hooks/purity */
// 3D props for the surface mission: beacons, instruments, carried items, flag. Pure view code.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EARTH_DIR, type Ground } from "./ground";
import { Label } from "./Label";
import { ROLE_COLOR, rt } from "./store";

export function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const REPAIR = { angle: 0, start: 0, held: 0, active: false };

export function Beacon({ x, z, ground, color, height, label, dim, thin }: { x: number; z: number; ground: Ground; color: string; height: number; label: string; dim?: boolean; thin?: boolean }) {
  const y = ground.heightAt(x, z);
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: dim ? 0.16 : 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [color, dim]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring.current) {
      ring.current.rotation.z = t * 0.5;
      ring.current.scale.setScalar(1 + Math.sin(t * 2.4) * 0.06);
    }
    if (beam.current) mat.opacity = (dim ? 0.12 : 0.3) + Math.sin(t * 2) * 0.05;
  });
  return (
    <group position={[x, y, z]}>
      <mesh ref={beam} material={mat} position={[0, height / 2, 0]}>
        <cylinderGeometry args={[thin ? 0.12 : 0.22, thin ? 0.12 : 0.22, height, 10, 1, true]} />
      </mesh>
      <mesh ref={ring} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[1.9, 2.2, 40]} />
      </mesh>
      <Label text={label} color={color} position={[0, Math.min(height, 6) + 1, 0]} dim={dim} scale={0.024} />
    </group>
  );
}

export function HintRing({ x, z, ground, role, show }: { x: number; z: number; ground: Ground; role: string; show: boolean }) {
  const y = ground.heightAt(x, z);
  if (!show) return null;
  return (
    <mesh position={[x, y + 0.12, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[2.4, 2.7, 40]} />
      <meshBasicMaterial color={ROLE_COLOR[role] ?? "#6fd3ff"} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

export function IceGlint({ x, z, ground, reveal }: { x: number; z: number; ground: Ground; reveal: number }) {
  const g = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#bfeaff").multiplyScalar(2.5), toneMapped: false, transparent: true }), []);
  const geo = useMemo(() => new THREE.OctahedronGeometry(0.12, 0), []);
  useEffect(
    () => () => {
      mat.dispose();
      geo.dispose();
    },
    [mat, geo],
  );
  const y = ground.heightAt(x, z);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const d = Math.hypot(rt.pos.x - x, rt.pos.z - z);
    const vis = reveal * (1 - THREE.MathUtils.smoothstep(d, 8, 16));
    g.current.visible = vis > 0.02;
    mat.opacity = vis * (0.6 + 0.4 * Math.sin(clock.elapsedTime * 6));
    g.current.rotation.y = clock.elapsedTime;
  });
  return (
    <group ref={g} position={[x, y + 0.2, z]} visible={false}>
      {[
        [0, 0, 0, 1.4],
        [0.3, -0.05, 0.1, 0.8],
        [-0.25, -0.08, 0.2, 0.9],
        [0.1, -0.08, -0.3, 0.7],
      ].map(([a, b, c, s], i) => (
        <mesh key={i} geometry={geo} material={mat} position={[a, b, c]} scale={s} />
      ))}
    </group>
  );
}

export function SampleRock({ x, z, ground }: { x: number; z: number; ground: Ground }) {
  const y = ground.heightAt(x, z);
  return (
    <mesh position={[x, y + 0.35, z]} castShadow receiveShadow scale={[1, 0.7, 0.9]}>
      <icosahedronGeometry args={[0.6, 2]} />
      <meshStandardMaterial color="#9b8f82" roughness={0.95} />
    </mesh>
  );
}

export function RepairPanel({ x, z, ground, fixed }: { x: number; z: number; ground: Ground; fixed?: boolean }) {
  const y = ground.heightAt(x, z);
  const panel = useRef<THREE.Group>(null);
  const matBad = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2a3b6b", roughness: 0.3, metalness: 0.5, emissive: "#000" }), []);
  const ghost = useMemo(() => new THREE.MeshBasicMaterial({ color: "#4ade80", transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }), []);
  useEffect(
    () => () => {
      matBad.dispose();
      ghost.dispose();
    },
    [matBad, ghost],
  );
  useFrame(() => {
    if (!panel.current) return;
    panel.current.rotation.y = fixed ? 0 : REPAIR.active ? REPAIR.angle : REPAIR.angle || 1.3;
    const aligned = fixed || (REPAIR.active && Math.abs(angDiff(0, REPAIR.angle)) < 0.07);
    matBad.emissive.set(aligned ? "#0b4a22" : "#401010");
  });
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 1.8, 10]} />
        <meshStandardMaterial color="#b7bbc2" roughness={0.5} metalness={0.5} />
      </mesh>
      <group ref={panel} position={[0, 2.0, 0]}>
        <mesh material={matBad} castShadow>
          <boxGeometry args={[2.4, 1.3, 0.06]} />
        </mesh>
        <mesh position={[0, 0, 0.04]}>
          <boxGeometry args={[0.1, 1.3, 0.04]} />
          <meshStandardMaterial color="#d6d6d6" />
        </mesh>
      </group>
      {!fixed && (
        <mesh material={ghost} position={[0, 2.0, 0.02]} visible>
          <planeGeometry args={[2.5, 1.4]} />
        </mesh>
      )}
    </group>
  );
}

export function RelayModel({ x, z, ground, placedAt }: { x: number; z: number; ground: Ground; placedAt: number }) {
  const y = ground.heightAt(x, z);
  const legs = useRef<THREE.Group[]>([]);
  const mast = useRef<THREE.Group>(null);
  const dish = useRef<THREE.Group>(null);
  const light = useRef<THREE.MeshBasicMaterial>(null);
  const t0 = useRef(placedAt || performance.now());
  const az = Math.atan2(EARTH_DIR.x, EARTH_DIR.z);
  useFrame(({ clock }) => {
    const k = Math.min(1, (performance.now() - t0.current) / 3000);
    const e = 1 - Math.pow(1 - k, 3);
    legs.current.forEach((l) => l && (l.rotation.x = 0.08 + e * 0.62));
    if (mast.current) mast.current.scale.y = 0.25 + 0.75 * Math.min(1, e * 1.3);
    if (dish.current) dish.current.rotation.x = -Math.PI / 2 + e * (Math.PI / 2 - 0.23);
    if (light.current) light.current.color.set(k >= 1 ? (Math.sin(clock.elapsedTime * 5) > 0 ? "#4ade80" : "#0f3a1d") : "#ffb547");
  });
  return (
    <group position={[x, y, z]}>
      {[0, 1, 2].map((i) => (
        <group key={i} rotation-y={(i * Math.PI * 2) / 3} position={[0, 0.9, 0]}>
          <group ref={(g) => void (g && (legs.current[i] = g))}>
            <mesh position={[0, -0.5, 0.0]} castShadow>
              <cylinderGeometry args={[0.025, 0.03, 1.1, 6]} />
              <meshStandardMaterial color="#9aa0a8" roughness={0.5} metalness={0.6} />
            </mesh>
          </group>
        </group>
      ))}
      <group ref={mast} position={[0, 0.9, 0]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 1.1, 8]} />
          <meshStandardMaterial color="#d6d8dc" roughness={0.4} metalness={0.5} />
        </mesh>
      </group>
      <group position={[0, 2.05, 0]} rotation-y={az}>
        <group ref={dish}>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.05]}>
            <sphereGeometry args={[0.55, 24, 8, 0, Math.PI * 2, 0, 0.55]} />
            <meshStandardMaterial color="#e8e8e8" roughness={0.45} metalness={0.3} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
      <mesh position={[0, 2.25, 0]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshBasicMaterial ref={light} color="#ffb547" toneMapped={false} />
      </mesh>
    </group>
  );
}

export function CarriedRelay() {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    g.current.visible = rt.carrying === "relay" && !rt.exiting;
    g.current.position.set(rt.pos.x - Math.sin(rt.rotY) * 0.33, rt.pos.y + 1.05, rt.pos.z - Math.cos(rt.rotY) * 0.33);
    g.current.rotation.y = rt.rotY;
  });
  return (
    <group ref={g} visible={false}>
      <mesh castShadow>
        <boxGeometry args={[0.28, 0.5, 0.2]} />
        <meshStandardMaterial color="#c9ccd1" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 6]} />
        <meshStandardMaterial color="#888" />
      </mesh>
    </group>
  );
}

/** US flag drawn to a canvas (13 stripes, canton with 50 stars). */
function flagTexture() {
  const W = 1024;
  const H = 540;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const sh = H / 13;
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 === 0 ? "#b31942" : "#f4f4f4";
    g.fillRect(0, i * sh, W, sh + 1);
  }
  const cw = W * 0.4;
  const ch = sh * 7;
  g.fillStyle = "#0a3161";
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = "#f4f4f4";
  const star = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? r : r * 0.4;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };
  for (let row = 0; row < 9; row++) {
    const n = row % 2 === 0 ? 6 : 5;
    for (let k = 0; k < n; k++) {
      const x = (cw / 12) * (row % 2 === 0 ? 1 + 2 * k : 2 + 2 * k);
      const y = (ch / 10) * (row + 1);
      star(x, y, 15);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Apollo-style flag: vertical pole, horizontal rod along the top edge holds the cloth out (no wind on the Moon). */
export function Flag({ pos, face }: { pos: [number, number, number]; face: number }) {
  const tex = useMemo(() => flagTexture(), []);
  const geo = useMemo(() => {
    const gm = new THREE.PlaneGeometry(1.2, 0.63, 24, 4);
    const p = gm.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      // hand-set creases: the cloth sags a little away from the rod
      p.setZ(i, Math.sin(x * 9) * 0.012 * (0.35 - y) + (0.315 - y) * 0.02);
    }
    gm.computeVertexNormals();
    return gm;
  }, []);
  useEffect(
    () => () => {
      tex.dispose();
      geo.dispose();
    },
    [tex, geo],
  );
  return (
    <group position={pos} rotation={[0, face, 0]}>
      <pointLight position={[0.3, 3.2, 1.6]} intensity={22} distance={26} decay={2} color="#ffe2b8" />
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.02, 2.4, 8]} />
        <meshStandardMaterial color="#d0d0d0" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.6, 2.32, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 1.24, 8]} />
        <meshStandardMaterial color="#d0d0d0" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh geometry={geo} position={[0.62, 2.0, 0]} castShadow>
        <meshStandardMaterial map={tex} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}


/** The relay package waiting by the lander (no marker: you find it). */
export function RelayPackage({ x, z, ground }: { x: number; z: number; ground: Ground }) {
  const y = ground.heightAt(x, z);
  return (
    <group position={[x, y + 0.27, z]} rotation-y={0.5}>
      <mesh castShadow>
        <boxGeometry args={[0.6, 0.5, 0.4]} />
        <meshStandardMaterial color="#c9ccd1" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.3, 6]} />
        <meshStandardMaterial color="#888" />
      </mesh>
      <mesh position={[0.2, 0.26, 0.21]}>
        <boxGeometry args={[0.12, 0.05, 0.01]} />
        <meshBasicMaterial color="#ff7a45" toneMapped={false} />
      </mesh>
    </group>
  );
}
