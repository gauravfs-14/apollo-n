"use client";
// Mission select backdrop: slow orbit over the lunar south pole, hard sunlight from the side.
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { Moon } from "../../three/Moon";
import { Starfield } from "../../three/Starfield";

const MOON_R = 100;
const MOON_POS: [number, number, number] = [30, 52, 0];

export function SelectScene() {
  const target = useMemo(() => new THREE.Vector3(...MOON_POS).add(new THREE.Vector3(-22, -4, 0)), []);
  // Camera drifts around the Moon at a fixed, shallow latitude below the equator so the south pole stays in view.
  useFrame(({ camera, clock }) => {
    const a = -0.55 + clock.elapsedTime * 0.012;
    const lat = -0.95;
    const d = 340;
    camera.position.set(
      MOON_POS[0] + Math.sin(a) * Math.cos(lat) * d,
      MOON_POS[1] + Math.sin(lat) * d,
      MOON_POS[2] + Math.cos(a) * Math.cos(lat) * d,
    );
    camera.lookAt(target);
  });
  return (
    <>
      <Starfield brightness={1.05} rotation={[0.4, 2.2, 0.1]} />
      <directionalLight position={[280, -70, 200]} intensity={4.2} color="#fff4e6" />
      <ambientLight intensity={0.012} color="#8fa6c8" />
      <Moon position={MOON_POS} radius={MOON_R} rotationSpeed={0.0035} />
      <Effects bloom={0.25} ao={false} />
    </>
  );
}
