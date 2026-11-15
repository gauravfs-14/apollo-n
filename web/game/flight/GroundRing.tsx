"use client";
// A ring painted on the terrain: every vertex sits on the real DEM (plus a small lift), so it follows the slope.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { TerrainData } from "../three/terrain";

export function GroundRing({
  data, x, z, radius, width = 1.2, color = "#6fd3ff", opacity = 0.9, segments = 96, tone = 2.2,
}: {
  data: TerrainData; x: number; z: number; radius: number; width?: number; color?: string; opacity?: number; segments?: number; tone?: number;
}) {
  const geo = useMemo(() => {
    const pos = new Float32Array((segments + 1) * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      for (let k = 0; k < 2; k++) {
        const r = radius + (k ? width / 2 : -width / 2);
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const o = (i * 2 + k) * 3;
        pos[o] = px; pos[o + 1] = data.heightAt(px, pz) + 0.35; pos[o + 2] = pz;
      }
      if (i < segments) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }, [data, x, z, radius, width, segments]);
  useEffect(() => () => geo.dispose(), [geo]);
  const c = useMemo(() => new THREE.Color(color).multiplyScalar(tone), [color, tone]);
  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={3}>
      <meshBasicMaterial color={c} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}
