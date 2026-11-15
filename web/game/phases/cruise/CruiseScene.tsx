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

const SUN = new THREE.Vector3(0.95, 0.25, -0.2).normalize();
const SUN_ARR: [number, number, number] = [SUN.x, SUN.y, SUN.z];
const SHIP_SCALE = 0.45;

const CAM_R = 15;
const CHASE_POS = new THREE.Vector3(0, 2.4, 11);
const CHASE_LOOK = new THREE.Vector3(0, 0.3, -40);
const tmpLook = new THREE.Vector3();

// Real proportions: Earth and Moon sit on fixed bearings (Earth behind the ship, the Moon ahead, a little off
// the line of flight) at a constant render distance, and their radius is scaled so the angular size matches the
// real distance along the trip. Translunar coast from ~25,000 km out to ~40,000 km from the Moon:
// Earth goes from a 30 degree globe behind the ship to a 2 degree disc; the Moon grows from 0.5 to 5 degrees.
const EARTH_DIR = new THREE.Vector3(-0.22, -0.16, 1).normalize();
const MOON_DIR = new THREE.Vector3(-0.18, 0.1, -1).normalize();
const SKY_D = 1500; // render distance: far enough for no parallax, near enough that the cloud layer keeps depth precision
const EARTH_MOON_KM = 384400;
const R_EARTH_KM = 6371;
const R_MOON_KM = 1737;

function earthKm(p: number) {
  return THREE.MathUtils.lerp(25000, EARTH_MOON_KM - 40000, p);
}

function Planets() {
  const q = useQuality();
  const earth = useRef<THREE.Group>(null);
  const moon = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    rt.progress = THREE.MathUtils.damp(rt.progress, rt.progressTarget, 0.8, dt);
    const de = earthKm(rt.progress);
    const dm = EARTH_MOON_KM - de;
    // same angular radius as a body of radius R at distance d: r = D * R / d
    earth.current?.position.copy(EARTH_DIR).multiplyScalar(SKY_D);
    earth.current?.scale.setScalar((SKY_D * R_EARTH_KM) / de);
    moon.current?.position.copy(MOON_DIR).multiplyScalar(SKY_D);
    moon.current?.scale.setScalar((SKY_D * R_MOON_KM) / dm);
  });
  return (
    <>
      <group ref={earth}>
        <Earth radius={1} sun={SUN_ARR} spin={0.004} lite={q.tier === "low"} />
      </group>
      <group ref={moon}>
        <Moon radius={1} rotation={[0.15, 0, 0.1]} quality={q.tier === "low" ? "low" : "medium"} relief={0} />
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
    // coast camera: early on it sits ahead of the ship looking back at the big Earth, late it sits behind the
    // ship looking ahead at the Moon; the ship stays off-centre so the body it is framed against reads past it
    const P = rt.progress;
    const turn = THREE.MathUtils.smoothstep(P, 0.4, 0.85);
    const az = THREE.MathUtils.lerp(2.5, 0.62, turn) + Math.sin(t * 0.05) * 0.06;
    pos.set(Math.sin(az) * CAM_R, 2.2 + Math.sin(t * 0.07) * 0.4, Math.cos(az) * CAM_R);
    const coastLook = tmpLook.set(0, -1.6, 0).addScaledVector(turn < 0.5 ? EARTH_DIR : MOON_DIR, 5 * Math.abs(turn - 0.5) * 2);
    pos.lerp(CHASE_POS, w);
    if (rt.hits !== lastHits.current) {
      lastHits.current = rt.hits;
      shake.current = 0.6;
    }
    shake.current = Math.max(0, shake.current - dt * 1.6);
    if (shake.current > 0) pos.add(look.set((Math.random() - 0.5) * shake.current * 0.5, (Math.random() - 0.5) * shake.current * 0.5, 0));
    camera.position.copy(pos);
    camera.lookAt(coastLook.lerp(CHASE_LOOK, w));
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
      <Starfield brightness={0.24} rotation={[0.3, 2.6, 0]} /> {/* exposure set for the sunlit ship: stars stay faint */}
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
