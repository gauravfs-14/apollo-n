"use client";
// Calm closing shot: the Moon's sunlit limb in the foreground, Earth hanging far behind it.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { Earth } from "../../three/Earth";
import { Moon } from "../../three/Moon";
import { Starfield } from "../../three/Starfield";

const SUN: [number, number, number] = [-0.75, 0.25, 0.65]; // direction toward the Sun
const EARTH_POS: [number, number, number] = [1500, 620, -7200];

export function ReportScene() {
  const look = useMemo(() => new THREE.Vector3(60, 40, 0), []);
  // Earth is ~7 km away: with near 0.1 the 24-bit depth buffer resolves ~30 m there and the 2 m cloud shell z-fights
  // (flickers). The nearest surface (the Moon limb) is >= 80 m from the camera, so a larger near plane is free.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    const near = camera.near;
    camera.near = 20;
    camera.updateProjectionMatrix();
    return () => { camera.near = near; camera.updateProjectionMatrix(); };
  }, [camera]);
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime;
    camera.position.set(Math.sin(t * 0.03) * 14, 4 + Math.sin(t * 0.021) * 3, 250);
    camera.lookAt(look);
  });
  return (
    <>
      <Starfield rotation={[0.9, 0.3, 0.2]} brightness={1.0} />
      <directionalLight position={[SUN[0] * 1000, SUN[1] * 1000, SUN[2] * 1000]} intensity={4.2} color="#fff4e6" />
      <ambientLight intensity={0.015} color="#8fa6c8" />
      <Moon position={[-20, -168, 0]} radius={170} rotationSpeed={0.0015} relief={2} />
      <Earth position={EARTH_POS} radius={330} sun={SUN} lite spin={0.01} />
      <Effects bloom={0.3} ao={false} />
    </>
  );
}
