"use client";
/* eslint-disable react-hooks/refs */
// Simple world-space markers: a pulsing beacon (probe / landing target) and ground rings. 1 unit = 1 m.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/** Vertical beam + ground ring that scales with `size` (metres of the ring radius). */
export function Beacon({
  position,
  color = "#ffb020",
  height = 120,
  size = 14,
  pulse = true,
}: {
  position: [number, number, number];
  color?: string;
  height?: number;
  size?: number;
  pulse?: boolean;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const c = useMemo(() => new THREE.Color(color).multiplyScalar(2.5), [color]);
  useFrame(({ clock }) => {
    if (!pulse) return;
    const t = clock.elapsedTime;
    const k = (t * 0.7) % 1;
    ring.current?.scale.setScalar(0.6 + k * 1.6);
    (ring.current?.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    const k2 = (t * 0.7 + 0.5) % 1;
    ring2.current?.scale.setScalar(0.6 + k2 * 1.6);
    (ring2.current?.material as THREE.MeshBasicMaterial).opacity = (1 - k2) * 0.9;
  });
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[size * 0.025, size * 0.025, height, 6, 1, true]} />
        <meshBasicMaterial color={c} toneMapped={false} transparent opacity={0.8} depthWrite={false} />
      </mesh>
      {[ring, ring2].map((r, i) => (
        <mesh key={i} ref={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
          <ringGeometry args={[size * 0.92, size, 48]} />
          <meshBasicMaterial color={c} toneMapped={false} transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[size * 0.09, 12, 8]} />
        <meshBasicMaterial color={c} toneMapped={false} />
      </mesh>
    </group>
  );
}
