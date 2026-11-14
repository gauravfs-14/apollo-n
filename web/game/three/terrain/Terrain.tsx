"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/exhaustive-deps */
// Real lunar terrain from a prepared LOLA tile (see loadTerrain.ts). One displaced PlaneGeometry (segments by
// quality) + an optional fine patch around `focus` for close-up views. Physically motivated regolith shading,
// baked soft terrain shadows for the real Sun direction, and "scanner" overlay modes (cool = safe, hot = risky).
//
//   const data = useTerrainData("site_a");           // null while loading
//   <Terrain data={data} sky={sky} overlay="risk" focus={[x,z]} detail shadows />
//
// Gameplay helpers live on `data` (heightAt, normalAt, slopeDegAt, overlayAt, boulderDensityAt).
import { useTexture } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";
import { loadTerrain, type TerrainData } from "./loadTerrain";
import { OVERLAY_INDEX, lunarUniformsFor, patchLunar, type LunarUniforms, type OverlayMode } from "./lunarShader";
import { bakeShadow } from "./shadowBake";
import type { SkyState } from "./sun";

export const REGOLITH_DIFF = "/textures/regolith/moon_dusted_03_diff_1k.jpg";
export const REGOLITH_NOR = "/textures/regolith/moon_dusted_03_nor_gl_1k.jpg";

export function useTerrainData(siteId: string | undefined) {
  const [s, set] = useState<{ id: string; data: TerrainData } | null>(null);
  useEffect(() => {
    if (!siteId) return;
    let alive = true;
    loadTerrain(siteId).then((data) => alive && set({ id: siteId, data }));
    return () => {
      alive = false;
    };
  }, [siteId]);
  return s && s.id === siteId ? s.data : null;
}

export interface TerrainProps {
  data: TerrainData;
  sky: SkyState;
  overlay?: OverlayMode;
  /** centre of the fine-detail patch (metres), if `detail` */
  focus?: [number, number];
  detail?: boolean;
  /** receive Three.js dynamic shadow maps (lander, boulders); the baked terrain shadows are always on */
  shadows?: boolean;
  /** darken the last few percent of the tile edge (scout view) */
  edgeFade?: boolean;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  /** brightness of the faint Earthshine/bounce fill (default 0.03) */
  fill?: number;
  /** cap the base mesh segments (the fine patch covers the near field in the landing view) */
  maxSegments?: number;
}

const DETAIL_HALF = 150;

function planeGeo(data: TerrainData, cx: number, cz: number, half: number, seg: number, lift = 0) {
  const g = new THREE.PlaneGeometry(half * 2, half * 2, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx;
    const z = p.getZ(i) + cz;
    p.setXYZ(i, x, data.heightAt(x, z) + lift, z);
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function Terrain({ data, sky, overlay = "none", focus, detail = false, shadows = false, edgeFade = false, fill = 0.03, maxSegments, ...events }: TerrainProps) {
  const q = useQuality();
  const gl = useThree((s) => s.gl);
  const [diff, nor] = useTexture([REGOLITH_DIFF, REGOLITH_NOR]);
  const uniforms = useMemo<LunarUniforms>(() => lunarUniformsFor(data), [data]);
  const shadowRT = useRef<THREE.WebGLRenderTarget | null>(null);

  useEffect(() => {
    for (const t of [diff, nor]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    diff.colorSpace = THREE.SRGBColorSpace;
    nor.colorSpace = THREE.NoColorSpace;
  }, [diff, nor]);

  // static uniforms
  useEffect(() => {
    uniforms.uDiff.value = diff;
    uniforms.uNor.value = nor;
    uniforms.uGrad.value = data.tex.grad;
    uniforms.uOvA.value = data.tex.ovA;
    uniforms.uOvB.value = data.tex.ovB;
    uniforms.uSize.value = data.size;
    uniforms.uN.value = data.n;
    uniforms.uOvN.value = data.meta.overlays.size;
  }, [uniforms, data, diff, nor]);

  // baked shadows for this Sun direction (one GPU pass, ~tens of ms)
  const sunKey = sky.sunDir.map((v) => v.toFixed(4)).join(",");
  useEffect(() => {
    shadowRT.current = bakeShadow(gl, data, sky.sunDir, shadowRT.current ?? undefined);
    uniforms.uShadow.value = shadowRT.current.texture;
    uniforms.uHasShadow.value = 1;
    uniforms.uSunDir.value.set(...sky.sunDir);
     
  }, [gl, data, sunKey, uniforms]);
  useEffect(
    () => () => {
      shadowRT.current?.dispose();
      shadowRT.current = null;
    },
    [],
  );

  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.46, 0.45, 0.43), roughness: 1, metalness: 0 });
    patchLunar(m, uniforms, true, "terrain");
    return m;
  }, [uniforms]);
  useEffect(() => () => mat.dispose(), [mat]);
  // the fine patch shares every uniform except the "hole" that the base mesh discards inside the patch
  const patchMat = useMemo(() => {
    const u = { ...uniforms, uHole: { value: new THREE.Vector4() } } as LunarUniforms;
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.46, 0.45, 0.43), roughness: 1, metalness: 0 });
    patchLunar(m, u, true, "terrain");
    return m;
  }, [uniforms]);
  useEffect(() => () => patchMat.dispose(), [patchMat]);

  const seg = Math.min(q.terrainSegments, maxSegments ?? 9999);
  const base = useMemo(() => planeGeo(data, 0, 0, data.size / 2, seg), [data, seg]);
  useEffect(() => () => base.dispose(), [base]);

  const detailSeg = q.tier === "high" ? 150 : q.tier === "medium" ? 100 : 0;
  const showDetail = detail && detailSeg > 0 && !!focus;
  const fx = focus ? Math.round(focus[0] / 4) * 4 : 0;
  const fz = focus ? Math.round(focus[1] / 4) * 4 : 0;
  const patch = useMemo(
    () => (showDetail ? planeGeo(data, fx, fz, DETAIL_HALF + 4, detailSeg) : null),
    [showDetail, data, fx, fz, detailSeg],
  );
  useEffect(() => () => patch?.dispose(), [patch]);
  useEffect(() => {
    uniforms.uHole.value.set(fx, fz, showDetail ? DETAIL_HALF : 0, showDetail ? DETAIL_HALF : 0);
  }, [uniforms, showDetail, fx, fz]);

  // overlay fade
  const target = useRef(0);
  target.current = overlay === "none" ? 0 : 1;
  useEffect(() => {
    if (overlay !== "none") uniforms.uMode.value = OVERLAY_INDEX[overlay];
  }, [overlay, uniforms]);
  useEffect(() => {
    uniforms.uEdge.value = edgeFade ? 1 : 0;
    uniforms.uFill.value = fill;
  }, [edgeFade, fill, uniforms]);
  useFrame((_, dt) => {
    const a = uniforms.uAmt.value;
    if (a !== target.current) uniforms.uAmt.value = Math.abs(a - target.current) < 0.01 ? target.current : a + (target.current - a) * Math.min(1, dt * 8);
  });

  return (
    <group>
      <mesh geometry={base} material={mat} receiveShadow={shadows} frustumCulled={false} {...events} />
      {patch && <mesh geometry={patch} material={patchMat} receiveShadow={shadows} frustumCulled={false} {...events} />}
    </group>
  );
}
