"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Deep-space cruise: the lander coasts toward the Moon. Earth sits behind and shrinks, the Moon ahead grows with
// journey progress. During the debris hurdle the camera swings behind the ship and rocks stream past.
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { useQuality } from "../../core/perf";
import { useStore } from "../../core/store";
import type { BuildParts } from "../../data/parts";
import { Earth } from "../../three/Earth";
import { Moon } from "../../three/Moon";
import { Lander, type LanderParts } from "../../three/ship/Lander";
import { Starfield } from "../../three/Starfield";
import { DebrisField } from "./hurdles/DebrisField";
import { rt, useDebrisOn } from "./rt";

const SUN = new THREE.Vector3(0.9, 0.3, 0.25).normalize();
const SUN_ARR: [number, number, number] = [SUN.x, SUN.y, SUN.z];
const SHIP_SCALE = 0.45;

const SIDE_POS = new THREE.Vector3(14, 1.2, 0);
const SIDE_LOOK = new THREE.Vector3(0, -2.4, -0.4);
const CHASE_POS = new THREE.Vector3(0, 2.4, 11);
const CHASE_LOOK = new THREE.Vector3(0, 0.3, -40);

function Planets() {
  const q = useQuality();
  const earth = useRef<THREE.Group>(null);
  const moon = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    rt.progress = THREE.MathUtils.damp(rt.progress, rt.progressTarget, 0.8, dt);
    const P = rt.progress;
    // Earth: starts close behind, drifts away (shrinks). Moon: starts a distant dot, grows toward the right edge.
    // keep both on fixed screen bearings (Earth left, Moon right); only their distance changes
    const de = 330 + 510 * P; // Earth: 330 -> 840 m away (shrinks)
    const dm = 1000 - 570 * P; // Moon: 1000 -> 430 m away (grows)
    earth.current?.position.set(-de, 1.2 - 0.155 * de, 0.3 * de);
    moon.current?.position.set(-dm, 1.2 - 0.155 * dm, -0.3 * dm);
  });
  return (
    <>
      <group ref={earth}>
        <Earth radius={36} sun={SUN_ARR} spin={0.01} lite={q.tier === "low"} />
      </group>
      <group ref={moon}>
        <Moon radius={60} rotation={[0.15, 0, 0.1]} quality={q.tier === "low" ? "low" : "medium"} relief={0} />
      </group>
    </>
  );
}

function Ship({ shipRef }: { shipRef: React.RefObject<THREE.Group | null> }) {
  const parts = useStore((s) => (s.state?.phaseData.build as { parts?: BuildParts } | undefined)?.parts);
  const idle = useRef<THREE.Group>(null);
  useFrame((st) => {
    const g = idle.current;
    if (!g) return;
    const t = st.clock.elapsedTime;
    // slow roll while coasting (nose points to -Z)
    g.rotation.z = rt.debris ? Math.sin(t * 0.6) * 0.05 : t * 0.12;
    g.rotation.x = rt.debris ? 0 : Math.sin(t * 0.3) * 0.03;
  });
  const p = useMemo(() => (parts ? ({ ...parts } as Partial<LanderParts>) : undefined), [parts]);
  return (
    <group ref={shipRef} scale={SHIP_SCALE}>
      <group ref={idle}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <group position={[0, -3.5, 0]}>
            <Lander parts={p} heat={rt.debris ? 1 : 0.55} />
          </group>
        </group>
      </group>
    </group>
  );
}

function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const cur = useRef({ w: 0 });
  const shake = useRef(0);
  const lastHits = useRef(0);
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime;
    cur.current.w = THREE.MathUtils.damp(cur.current.w, rt.debris ? 1 : 0, 2.2, dt);
    const w = cur.current.w;
    const side = pos.copy(SIDE_POS).add(look.set(Math.sin(t * 0.07) * 1.2, Math.sin(t * 0.05) * 0.4, Math.cos(t * 0.06) * 1.5));
    pos.copy(side).lerp(CHASE_POS, w);
    look.copy(SIDE_LOOK).lerp(CHASE_LOOK, w);
    if (rt.hits !== lastHits.current) {
      lastHits.current = rt.hits;
      shake.current = 0.6;
    }
    shake.current = Math.max(0, shake.current - dt * 1.6);
    if (shake.current > 0) pos.add(look.set((Math.random() - 0.5) * shake.current * 0.5, (Math.random() - 0.5) * shake.current * 0.5, 0));
    camera.position.copy(pos);
    camera.lookAt(CHASE_LOOK.x * w + SIDE_LOOK.x * (1 - w), CHASE_LOOK.y * w + SIDE_LOOK.y * (1 - w), CHASE_LOOK.z * w + SIDE_LOOK.z * (1 - w));
    camera.fov = 40;
    camera.updateProjectionMatrix();
  });
  return null;
}

export function CruiseScene() {
  const q = useQuality();
  const shipRef = useRef<THREE.Group>(null);
  const debris = useDebrisOn((s) => s.on);
  return (
    <>
      <color attach="background" args={["#000"]} />
      <CameraRig />
      <Starfield brightness={1.2} rotation={[0.3, 2.6, 0]} />
      <directionalLight position={[SUN.x * 400, SUN.y * 400, SUN.z * 400]} intensity={5.5} castShadow={q.shadows} shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-camera-far={900} shadow-bias={-0.0005} />
      <ambientLight intensity={0.03} />
      <Environment resolution={128} frames={1} environmentIntensity={0.9}>
        <Lightformer form="rect" intensity={4} position={[10, 3, 4]} rotation={[0, -1.2, 0]} scale={[6, 3, 1]} color="#fff3e0" />
        <Lightformer form="rect" intensity={1.2} position={[-8, 1, -3]} rotation={[0, 1.2, 0]} scale={[8, 4, 1]} color="#5a86d8" />
      </Environment>
      <Planets />
      <Ship shipRef={shipRef} />
      {debris && <DebrisField ship={shipRef} />}
      <Effects bloom={0.55} ao={false} />
    </>
  );
}
