"use client";
/* eslint-disable react-hooks/immutability */
// Instanced boulders (Poly Haven CC0 moon rocks) scattered around `focus` with the same density model the API uses:
//   density/m2 = 0.0008 + 0.004*ss(6,20,slope) + 0.003*ss(0.3,1.2,rough)   (rocks > ~0.4 m)
// plus 2x as many small ones for visual richness. Statistical, game-tuned: not mapped boulders.
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";
import type { TerrainData } from "./loadTerrain";
import { lunarUniformsFor, patchLunar } from "./lunarShader";

const FILES = ["/models/rock_moon_a.glb", "/models/rock_moon_b.glb", "/models/rock_moon_c.glb"];
FILES.forEach((f) => useGLTF.preload(f));

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Boulder {
  x: number;
  z: number;
  size: number;
}

/** Deterministic boulder list (also usable by gameplay: e.g. a lander touching down on a big one). */
export function scatterBoulders(data: TerrainData, cx: number, cz: number, radius: number, seed: number, max: number): Boulder[] {
  const rnd = mulberry32(seed);
  const out: Boulder[] = [];
  const area = Math.PI * radius * radius;
  const attempts = Math.min(max * 6, Math.ceil(area * 0.0078 * 3));
  const dMax = 0.0078;
  for (let i = 0; i < attempts && out.length < max; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!data.inside(x, z, 20)) continue;
    // 3 size classes: small (0.15-0.4 m, x3 as many), hazardous (>0.4 m)
    const dens = data.boulderDensityAt(x, z);
    if (rnd() > (dens * 3) / (dMax * 3)) continue;
    const big = rnd() < 0.33;
    const u = rnd();
    const size = big ? Math.min(4.5, 0.4 * Math.pow(1 - u, -1 / 1.6)) : 0.15 + u * 0.25;
    out.push({ x, z, size });
  }
  return out;
}

export function Boulders({
  data,
  focus = [0, 0],
  radius = 260,
  seed = 1,
  shadows = false,
}: {
  data: TerrainData;
  focus?: [number, number];
  radius?: number;
  seed?: number;
  shadows?: boolean;
}) {
  const q = useQuality();
  const gltfs = useGLTF(FILES);
  const u = useMemo(() => lunarUniformsFor(data), [data]);

  const rocks = useMemo(() => {
    return gltfs.map((g, k) => {
      let mesh: THREE.Mesh | null = null;
      g.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      const src = mesh as unknown as THREE.Mesh;
      const geo = src.geometry.clone();
      geo.applyMatrix4(src.matrixWorld);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
      geo.translate(-(bb.max.x + bb.min.x) / 2, -bb.min.y - (bb.max.y - bb.min.y) * 0.18, -(bb.max.z + bb.min.z) / 2);
      geo.scale(1 / ext, 1 / ext, 1 / ext);
      const mat = (src.material as THREE.MeshStandardMaterial).clone();
      mat.color = new THREE.Color(0.5, 0.49, 0.47);
      mat.roughness = 1;
      mat.metalness = 0;
      patchLunar(mat, u, false, `rock${k}`);
      return { geo, mat };
    });
  }, [gltfs, u]);
  useEffect(
    () => () =>
      rocks.forEach((r) => {
        r.geo.dispose();
        r.mat.dispose();
      }),
    [rocks],
  );

  const placed = useMemo(() => {
    const list = scatterBoulders(data, focus[0], focus[1], radius, seed + (data.siteId.charCodeAt(5) ?? 0) * 977, Math.round(3200 * q.instances));
    const buckets: THREE.Matrix4[][] = [[], [], []];
    const rnd = mulberry32(seed * 31 + 7);
    const n = new THREE.Vector3();
    const qt = new THREE.Quaternion();
    const qy = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of list) {
      const k = Math.floor(rnd() * 3);
      const y = data.heightAt(b.x, b.z);
      data.normalAt(b.x, b.z, n);
      qt.setFromUnitVectors(up, n.lerp(up, 0.5).normalize());
      qy.setFromAxisAngle(up, rnd() * Math.PI * 2);
      qt.multiply(qy);
      const sx = b.size * (0.8 + rnd() * 0.5);
      const sy = b.size * (0.55 + rnd() * 0.5);
      const sz = b.size * (0.8 + rnd() * 0.5);
      buckets[k].push(new THREE.Matrix4().compose(new THREE.Vector3(b.x, y, b.z), qt.clone(), new THREE.Vector3(sx, sy, sz)));
    }
    return buckets;
  }, [data, focus, radius, seed, q.instances]);

  return (
    <group>
      {rocks.map((r, k) => (
        <InstancedBucket key={`${k}-${placed[k].length}`} geo={r.geo} mat={r.mat} mats={placed[k]} shadows={shadows} />
      ))}
    </group>
  );
}

function InstancedBucket({ geo, mat, mats, shadows }: { geo: THREE.BufferGeometry; mat: THREE.Material; mats: THREE.Matrix4[]; shadows: boolean }) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
    mats.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.count = mats.length;
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    return m;
  }, [geo, mat, mats]);
  useEffect(() => {
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
  }, [mesh, shadows]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}
