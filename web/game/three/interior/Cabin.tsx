"use client";
 
// The Apollo 11 Command Module "Columbia" crew compartment, scanned by the Smithsonian (CC0), scaled up so several
// suited astronauts can float in it. See assets-src/credits/interior.md.
import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

export const CM_URL = "/models/interior/cm_interior.glb";
/** Scale applied to the scan (real size is very tight for a game with 4 astronauts). */
export const CM_SCALE = 1.7;
/** Scan point that sits at the world origin (the middle of the crew compartment). */
export const CM_PIVOT = new THREE.Vector3(0, 1.8, 0.3);

export function cmToWorld(x: number, y: number, z: number, out = new THREE.Vector3()) {
  return out.set((x - CM_PIVOT.x) * CM_SCALE, (y - CM_PIVOT.y) * CM_SCALE, (z - CM_PIVOT.z) * CM_SCALE);
}

export function CommandModule({ onScene }: { onScene?: (s: THREE.Object3D) => void }) {
  const gltf = useGLTF(CM_URL);
  const root = useMemo(() => {
    const r = gltf.scene.clone(true);
    r.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const old = m.material as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        map: old.map,
        roughness: 0.78,
        metalness: 0.12,
        side: THREE.DoubleSide,
        shadowSide: THREE.DoubleSide,
        color: new THREE.Color(1.15, 1.12, 1.08),
      });
      m.material = mat;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    onScene?.(r);
    return r;
  }, [gltf, onScene]);
  return (
    <group scale={CM_SCALE} position={[-CM_PIVOT.x * CM_SCALE, -CM_PIVOT.y * CM_SCALE, -CM_PIVOT.z * CM_SCALE]}>
      <primitive object={root} />
    </group>
  );
}
