"use client";
/* eslint-disable react-hooks/immutability -- three.js renderer/camera are mutated by design */
// Main-menu backdrop: Earthrise over the lunar limb. Own <Canvas> because "/" is a different route from
// /play/[room] (it unmounts on navigation, so there is still only ever one WebGL context at a time).
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import { Effects } from "../core/Effects";
import { PerfProbe, QUALITY, useQuality } from "../core/perf";
import { useStore } from "../core/store";
import { Earth } from "../three/Earth";
import { Moon } from "../three/Moon";
import { Starfield } from "../three/Starfield";

const SUN = new THREE.Vector3(0.85, 0.3, 0.62).normalize();
const SUN_ARR: [number, number, number] = [SUN.x, SUN.y, SUN.z];

function Rig() {
  const q = useQuality();
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    gl.toneMapping = q.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl, q.post]);
  const target = new THREE.Vector3();
  useFrame((state) => {
    // slow cinematic drift
    const t = state.clock.elapsedTime;
    camera.position.set(Math.sin(t * 0.05) * 3.5, 6 + Math.sin(t * 0.037) * 0.8, 62);
    target.set(18 + Math.sin(t * 0.04) * 2, 17, -100);
    camera.lookAt(target);
  });
  return null;
}

function Content() {
  const q = useQuality();
  return (
    <>
      <Rig />
      <Starfield brightness={1.1} rotation={[0.4, 2.2, 0.1]} />
      <directionalLight position={[SUN.x * 600, SUN.y * 600, SUN.z * 600]} intensity={4.2} />
      <ambientLight intensity={0.015} />
      <Moon radius={100} position={[0, -96, -30]} rotation={[0.25, 0, 1.15]} rotationSpeed={0.004} quality={q.tier} relief={0} bump={0.3} />
      <Earth position={[85, 62, -400]} radius={52} sun={SUN_ARR} spin={0.012} lite={q.tier === "low"} />
      <Effects bloom={0.55} ao={false} />
      <PerfProbe phase="menu" />
    </>
  );
}

export default function MenuScene() {
  const tier = useStore((s) => s.quality);
  const q = QUALITY[tier];
  return (
    <Canvas
      className="!fixed inset-0"
      dpr={[1, Math.min(1.5, q.maxDpr)]}
      gl={{ antialias: !q.post, powerPreference: "high-performance", stencil: false, alpha: false }}
      camera={{ fov: 36, near: 0.5, far: 20000, position: [0, 4, 62] }}
    >
      <color attach="background" args={["#000"]} />
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </Canvas>
  );
}
