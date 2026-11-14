"use client";
import { Environment, Lightformer } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Astronaut } from "../../three/Astronaut";
import { Earth } from "../../three/Earth";
import { StubHud } from "../../ui/StubPhase";
import type { PhaseModule, Role } from "../../types";

const R: Role[] = ["commander", "pilot", "engineer", "scientist"];
function Scene() {
  const camera = useThree((s) => s.camera);
  useEffect(() => { const c = new URLSearchParams(location.search).get('cam'); if (c === 'wave') { camera.position.set(0.8, 1.5, 2.6); camera.lookAt(0.55, 1.3, 0); } else if (c === 'close') { camera.position.set(-1.6, 1.4, 2.4); camera.lookAt(-1.6, 1.1, 0); } else { camera.position.set(0, 1.4, 5.2); camera.lookAt(0, 0.95, 0); } }, [camera]);
  return (
    <>
      <color attach="background" args={["#05070a"]} />
      <directionalLight position={[3, 4, 5]} intensity={3} />
      <Environment resolution={256}><Lightformer intensity={2} position={[0, 5, 3]} scale={[8, 3, 1]} /></Environment>
      <Earth position={[0, 0, -30]} radius={8} />
      {R.map((r, i) => <Astronaut key={r} role={r} position={[(i - 1.5) * 1.1, 0, 0]} pose={(["idle", "walk", "wave", "idle"] as const)[i]} offset={i} />)}
    </>
  );
}
function Hud() {
  return <StubHud id="crew" title="Crew" />;
}
export const phase: PhaseModule = { id: "crew", Hud, Scene, preload: ["/models/crew/astronaut.glb"] };
