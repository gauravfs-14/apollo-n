"use client";
/* eslint-disable react-hooks/immutability -- three.js camera is mutated by design */
// Suit-up room: four astronauts in a NASA crew-portrait line-up in front of a hangar window onto Earth.
// One soft key light, cool fill, coloured rim lights for separation, softbox reflections in the gold visors.
import { Environment, Html, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { rolesOf } from "../../core/roles";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { useQuality } from "../../core/perf";
import { useStore } from "../../core/store";
import { Astronaut } from "../../three/Astronaut";
import { Earth } from "../../three/Earth";
import { Starfield } from "../../three/Starfield";
import { ROLES, type Role } from "../../types";
import { ROLE_INFO, type CrewData } from "./data";
import { useCrewUi } from "./hover";

const X: Record<Role, number> = { commander: -1.7, pilot: -0.57, engineer: 0.57, scientist: 1.7 };
const SUN = new THREE.Vector3(0.7, 0.35, 0.8).normalize();

function Wall() {
  // wall with a wide window opening (x +-4.2, y 0.9..4.3) at z=-5
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#10151c", roughness: 0.85, metalness: 0.2 }), []);
  const trim = useMemo(() => new THREE.MeshStandardMaterial({ color: "#05070a", roughness: 0.5, metalness: 0.7 }), []);
  return (
    <group position={[0, 0, -6.5]}>
      <mesh material={mat} position={[-8.2, 3, 0]}><boxGeometry args={[8, 8, 0.4]} /></mesh>
      <mesh material={mat} position={[8.2, 3, 0]}><boxGeometry args={[8, 8, 0.4]} /></mesh>
      <mesh material={mat} position={[0, 6.2, 0]}><boxGeometry args={[8.4, 3.8, 0.4]} /></mesh>
      <mesh material={mat} position={[0, -0.1, 0]}><boxGeometry args={[8.4, 2, 0.4]} /></mesh>
      {/* window frame */}
      <mesh material={trim} position={[0, 4.35, 0.15]}><boxGeometry args={[8.6, 0.12, 0.2]} /></mesh>
      <mesh material={trim} position={[0, 0.88, 0.15]}><boxGeometry args={[8.6, 0.12, 0.2]} /></mesh>
      {[-4.3, 0, 4.3].map((x) => (
        <mesh key={x} material={trim} position={[x, 2.6, 0.15]}><boxGeometry args={[0.14, 3.6, 0.2]} /></mesh>
      ))}
      {/* amber floor-level light strip */}
      <mesh position={[0, 0.15, 0.25]}><boxGeometry args={[8.2, 0.04, 0.04]} /><meshBasicMaterial color="#ffb547" toneMapped={false} /></mesh>
    </group>
  );
}

function Floor() {
  const q = useQuality();
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1]} receiveShadow>
      <planeGeometry args={[30, 20]} />
      {q.post ? (
        <MeshReflectorMaterial color="#0a0e13" roughness={0.55} metalness={0.4} mirror={0.55} mixStrength={q.tier === "high" ? 1.4 : 0.9} blur={[300, 80]} resolution={q.tier === "high" ? 512 : 256} mixBlur={1} depthScale={0} />
      ) : (
        <meshStandardMaterial color="#0a0e13" roughness={0.45} metalness={0.5} />
      )}
    </mesh>
  );
}

function Lineup() {
  const players = useStore((s) => s.state?.players);
  const mode = useStore((s) => s.state?.mode);
  const crew = (useStore((s) => s.state?.phaseData.crew) ?? {}) as Partial<CrewData>;
  const hover = useCrewUi((s) => s.hover);
  const uiNames = useCrewUi((s) => s.names);
  const meId = useStore((s) => s.meId);
  return (
    <>
      {ROLES.map((role, i) => {
        const holder = players?.find((p) => rolesOf(p).includes(role));
        const mine = holder?.id === meId;
        const active = hover === role || mine;
        const label = holder?.name ?? uiNames[role] ?? crew.names?.[role];
        const ai = mode === "multi" && !holder;
        return (
          <group key={role} position={[X[role], 0, 0]}>
            <Astronaut role={role} pose={active ? "wave" : "idle"} offset={i * 1.7} rotation={[0, (i - 1.5) * -0.09, 0]} height={1.82} />
            {/* floor marker */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
              <ringGeometry args={[0.44, 0.49, 48]} />
              <meshBasicMaterial color={ROLE_INFO[role].color} transparent opacity={active ? 0.95 : holder ? 0.55 : 0.22} toneMapped={false} />
            </mesh>
            <Html position={[0, 2.12, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
              <div className="whitespace-nowrap rounded-md bg-black/50 px-2.5 py-1 text-center backdrop-blur-sm">
                <div className="text-[11px] font-medium" style={{ color: ROLE_INFO[role].color }}>{ROLE_INFO[role].label}</div>
                <div className="text-sm text-white drop-shadow">{label ?? (mode === "multi" ? "Open" : "")}</div>
                {ai && <div className="text-[10px] text-white/50">AI crew</div>}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

function Rig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    camera.fov = 30;
    camera.position.set(Math.sin(t * 0.12) * 0.35, 1.35 + Math.sin(t * 0.09) * 0.03, 8.8);
    target.set(Math.sin(t * 0.12) * 0.1, 0.95, 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  });
  return null;
}

export function CrewScene() {
  const q = useQuality();
  return (
    <>
      <color attach="background" args={["#020306"]} />
      <Rig />
      <Starfield brightness={1} rotation={[0.2, 1.4, 0]} />
      <Earth position={[4, 5.5, -95]} radius={15} sun={[SUN.x, SUN.y, SUN.z]} spin={0.006} lite={q.tier === "low"} />
      <Wall />
      <Floor />
      {/* key: big soft light from camera-left, warm; fill: cool from the right; rims from behind */}
      <directionalLight position={[-4, 6, 6]} intensity={2.6} color="#fff1e0" castShadow={q.shadows} shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-1} shadow-camera-near={1} shadow-camera-far={20} shadow-bias={-0.0004} shadow-normalBias={0.02} />
      <directionalLight position={[6, 3, 5]} intensity={0.55} color="#b9d4ff" />
      <pointLight position={[-4.5, 2.6, -2.2]} intensity={55} distance={12} color="#6fd3ff" />
      <pointLight position={[4.5, 2.6, -2.2]} intensity={55} distance={12} color="#ffb547" />
      <Environment resolution={256} frames={1} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={5} position={[-5, 4, 6]} rotation={[0, 0.6, 0]} scale={[5, 3, 1]} color="#fff4e6" />
        <Lightformer form="rect" intensity={2} position={[6, 2, 4]} rotation={[0, -0.8, 0]} scale={[3, 5, 1]} color="#cfe2ff" />
        <Lightformer form="ring" intensity={2} position={[0, 7, 2]} rotation={[Math.PI / 2, 0, 0]} scale={4} color="#ffffff" />
        <Lightformer form="rect" intensity={1} position={[0, 2, -8]} scale={[12, 4, 1]} color="#223355" />
      </Environment>
      <Lineup />
      <Effects bloom={0.45} ao={false} />
    </>
  );
}
