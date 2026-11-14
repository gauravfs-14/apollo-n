"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity, react-hooks/preserve-manual-memoization, react-hooks/exhaustive-deps */
// Clean-room / hangar lit by a real HDRI, concrete floor, turntable platform and a key spot light.
import { Environment, OrbitControls, useTexture } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";

export const HANGAR_HDRI = "/hdri/empty_warehouse_01_1k.hdr";
export const HANGAR_TEX = ["/textures/ship/concrete_diff.jpg", "/textures/ship/concrete_nor_gl.jpg", "/textures/ship/concrete_arm.jpg"];

function ringTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const x = c.getContext("2d")!;
  x.fillStyle = "#2a2e33";
  x.fillRect(0, 0, 1024, 1024);
  // hazard stripe ring
  x.save();
  x.translate(512, 512);
  const r0 = 440, r1 = 480;
  for (let i = 0; i < 96; i++) {
    x.beginPath();
    x.arc(0, 0, r1, (i / 96) * Math.PI * 2, ((i + 1) / 96) * Math.PI * 2);
    x.arc(0, 0, r0, ((i + 1) / 96) * Math.PI * 2, (i / 96) * Math.PI * 2, true);
    x.fillStyle = i % 2 ? "#e6b422" : "#15171a";
    x.fill();
  }
  x.strokeStyle = "rgba(255,255,255,0.35)";
  x.lineWidth = 3;
  for (const r of [120, 250, 380]) {
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.stroke();
  }
  for (let a = 0; a < 8; a++) {
    x.rotate(Math.PI / 4);
    x.beginPath();
    x.moveTo(0, 60);
    x.lineTo(0, 430);
    x.stroke();
  }
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function Hangar({ orbit = true, distance = [11, 24] as [number, number] }: { orbit?: boolean; distance?: [number, number] }) {
  const q = useQuality();
  const camera = useThree((s) => s.camera);
  const [diff, nor, arm] = useTexture(HANGAR_TEX, (t) => {
    (Array.isArray(t) ? t : [t]).forEach((x) => {
      x.wrapS = x.wrapT = THREE.RepeatWrapping;
      x.repeat.set(5, 5);
      x.anisotropy = 8;
    });
  });
  useMemo(() => {
    diff.colorSpace = THREE.SRGBColorSpace;
  }, [diff]);
  useEffect(() => () => [diff, nor, arm].forEach((t) => t.dispose()), [diff, nor, arm]); // drei-cached: free the GPU copies
  const ring = useMemo(() => ringTexture(), []);
  useEffect(() => () => ring.dispose(), [ring]);

  useEffect(() => {
    camera.position.set(9.5, 4.6, 11.5);
    camera.lookAt(0, 2.3, 0);
  }, [camera]);

  return (
    <>
      <Environment files={HANGAR_HDRI} background backgroundBlurriness={0.06} environmentIntensity={0.85} />
      <ambientLight intensity={0.15} />
      <spotLight
        position={[7, 15, 8]} angle={0.55} penumbra={1} intensity={q.tier === "low" ? 900 : 1400} decay={2} color="#fff4e6"
        castShadow={q.shadows} shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-near={5} shadow-camera-far={40} target-position={[0, 3, 0]}
      />
      <pointLight position={[-9, 4, -6]} intensity={q.tier === "low" ? 80 : 160} color="#8fb4ff" />
      <pointLight position={[8, 3, -9]} intensity={90} color="#ffd9a8" />

      {/* concrete apron */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.012} receiveShadow>
        <circleGeometry args={[16, 64]} />
        <meshStandardMaterial map={diff} normalMap={nor} roughnessMap={arm} aoMap={arm} roughness={1} color="#9aa0a6" />
      </mesh>
      {/* assembly platform */}
      <mesh position-y={0.06} receiveShadow castShadow>
        <cylinderGeometry args={[5.3, 5.45, 0.12, 64]} />
        <meshStandardMaterial color="#2c3036" metalness={0.8} roughness={0.5} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.125}>
        <circleGeometry args={[5.3, 64]} />
        <meshStandardMaterial map={ring} roughness={0.6} metalness={0.4} />
      </mesh>
      {orbit && (
        <OrbitControls
          target={[0, 2.3, 0]} enablePan={false} enableDamping minDistance={distance[0]} maxDistance={distance[1]}
          maxPolarAngle={Math.PI / 2 - 0.04} minPolarAngle={0.5} autoRotate autoRotateSpeed={0.5}
        />
      )}
    </>
  );
}
