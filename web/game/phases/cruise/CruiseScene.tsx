"use client";
 
// Cruise: the crew floats inside the Command Module and its equipment bay. Earth recedes behind, the Moon grows
// ahead; hurdles are hands-on jobs at stations in the cabin (see cabin/).
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { useQuality } from "../../core/perf";
import { Earth } from "../../three/Earth";
import { Moon } from "../../three/Moon";
import { EquipmentBay } from "../../three/interior/Bay";
import { CommandModule } from "../../three/interior/Cabin";
import { Starfield } from "../../three/Starfield";
import { useStore } from "../../core/store";
import type { BuildParts } from "../../data/parts";
import { Lander, type LanderParts } from "../../three/ship/Lander";
import { JobStations } from "./cabin/JobStations";
import { CabinCrew } from "./cabin/Crew";
import { Driver, ARENA_Y } from "./cabin/Driver";
import { EARTH_DIR, MOON_DIR, SUN_DIR } from "./cabin/layout";
import { PlayerRig } from "./cabin/Player";
import { CautionPanel, EngineStation, StormStation } from "./cabin/Stations";
import { CheckStations, CommsStation, DebrisStation, NavStation, Waypoints } from "./cabin/Stations2";
import { DebrisField } from "./hurdles/DebrisField";
import { rt, useDebrisOn } from "./rt";

const SUN_ARR: [number, number, number] = [SUN_DIR.x, SUN_DIR.y, SUN_DIR.z];

function Planets() {
  const q = useQuality();
  const earth = useRef<THREE.Group>(null);
  const moon = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    rt.progress = THREE.MathUtils.damp(rt.progress, rt.progressTarget, 0.8, dt);
    const P = rt.progress;
    const de = 320 + 620 * P; // Earth recedes
    const dm = 1100 - 700 * P; // Moon approaches
    earth.current?.position.copy(EARTH_DIR).multiplyScalar(de);
    moon.current?.position.copy(MOON_DIR).multiplyScalar(dm);
  });
  return (
    <>
      <group ref={earth}>
        <Earth radius={110} sun={SUN_ARR} spin={0.01} lite={q.tier === "low"} />
      </group>
      <group ref={moon}>
        <Moon radius={90} rotation={[0.15, 0, 0.1]} quality={q.tier === "low" ? "low" : "medium"} relief={0} />
      </group>
    </>
  );
}

/** Exterior view used while the pilot flies the debris field: the lander with rocks streaming past (far above the cabin). */
function Arena() {
  const shipRef = useRef<THREE.Group>(null);
  const parts = useStore((s) => (s.state?.phaseData.build as { parts?: BuildParts } | undefined)?.parts);
  const p = useMemo(() => (parts ? ({ ...parts } as Partial<LanderParts>) : undefined), [parts]);
  const idle = useRef<THREE.Group>(null);
  useFrame(() => {
    if (idle.current) idle.current.rotation.z = Math.sin(performance.now() / 1000 * 0.6) * 0.05;
  });
  return (
    <group position={[0, ARENA_Y, 0]}>
      <group ref={shipRef} scale={0.45}>
        <group ref={idle}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <group position={[0, -3.5, 0]}>
              <Lander parts={p} heat={1} />
            </group>
          </group>
        </group>
      </group>
      <DebrisField ship={shipRef} />
    </group>
  );
}

const sunTarget = new THREE.Object3D();
sunTarget.position.set(0, 0, 4.5);

export function CruiseScene() {
  const q = useQuality();
  const debris = useDebrisOn((s) => s.on);
  return (
    <>
      <color attach="background" args={["#000"]} />
      <Starfield brightness={1.3} rotation={[0.3, 2.6, 0]} />
      <Planets />
      <primitive object={sunTarget} />
      <directionalLight
        target={sunTarget}
        position={[SUN_DIR.x * 30, SUN_DIR.y * 30, SUN_DIR.z * 30 + 4.5]}
        intensity={6}
        color="#fff4e6"
        castShadow={q.shadows}
        shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <hemisphereLight args={["#bcd0ff", "#403830", 0.18]} />
      {[1.2, 3.6, 5.7, 7.7].map((z) => (
        <pointLight key={z} position={[0, 0.9, z]} intensity={z < 3 ? 3 : 5} distance={6.5} decay={2} color="#fff0dc" />
      ))}
      <Environment resolution={64} frames={1} environmentIntensity={0.5}>
        <Lightformer form="rect" intensity={2} position={[0, 4, 3]} scale={[8, 3, 1]} rotation={[Math.PI / 2, 0, 0]} color="#fff3e0" />
        <Lightformer form="rect" intensity={0.6} position={[-4, 0, 0]} scale={[6, 3, 1]} rotation={[0, Math.PI / 2, 0]} color="#8fb0ff" />
      </Environment>
      <CommandModule />
      <EquipmentBay />
      <PlayerRig />
      <Driver />
      <CabinCrew />
      <CautionPanel />
      <EngineStation />
      <StormStation />
      <NavStation />
      <CommsStation />
      <DebrisStation />
      <CheckStations />
      <JobStations />
      <Waypoints />
      {debris && <Arena />}
      <Effects bloom={0.5} ao={false} />
    </>
  );
}
