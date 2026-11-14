"use client";
// Real sky: NASA SVS Deep Star Maps 2020 (Hipparcos + Tycho-2 + Gaia), public domain, 4096x2048 equirect.
//
//   <Starfield />                                        radius 9000, brightness 1.4
//   <Starfield radius={5000} brightness={1} rotation={[0, 1.2, 0]} />
//
// Props
//   radius      distance of the sky sphere (keep below the camera far plane, default 9000)
//   brightness  multiplier on the star map colours (default 1.4)
//   rotation    Euler rotation of the sky, to choose which part of the sky is visible
// The sphere follows the camera position (no parallax, like the real sky). One draw call,
// no depth writes, rendered first.
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export const STAR_TEXTURE = "/textures/stars/starmap_4k.webp";

export function Starfield({
  radius = 9000,
  brightness = 1.4,
  rotation = [0, 0, 0],
}: {
  radius?: number;
  brightness?: number;
  rotation?: [number, number, number];
}) {
  const tex = useTexture(STAR_TEXTURE);
  const ref = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  }, [tex]);
  const color = useMemo(() => new THREE.Color(), []);
  color.setScalar(brightness);
  useFrame(({ camera }) => ref.current?.position.copy(camera.position));
  return (
    <mesh ref={ref} rotation={rotation} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 48, 24]} />
      <meshBasicMaterial map={tex} color={color} side={THREE.BackSide} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}
