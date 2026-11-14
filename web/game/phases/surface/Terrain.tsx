"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";
import { AREA, type Ground } from "./ground";
import { makeRegolith, surfaceUniforms } from "./materials";

export function Terrain({ ground }: { ground: Ground }) {
  const q = useQuality();
  const seg = q.tier === "high" ? 480 : q.tier === "medium" ? 320 : 200;
  const size = AREA + 20;

  const material = useMemo(() => makeRegolith({ color: "#a39f98", roughness: 1 }), []);

  const ringMat = useMemo(() => {
    const m = material.clone();
    m.onBeforeCompile = material.onBeforeCompile;
    m.customProgramCacheKey = material.customProgramCacheKey;
    m.polygonOffset = true;
    m.polygonOffsetFactor = 6;
    m.polygonOffsetUnits = 6;
    return m;
  }, [material]);

  const inner = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, ground.heightAt(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [ground, seg, size]);

  const ring = useMemo(() => {
    const NR = 56;
    const NA = 160;
    const r0 = size * 0.5 - 6;
    const r1 = 3800;
    const pos = new Float32Array(NR * NA * 3);
    for (let i = 0; i < NR; i++) {
      const r = r0 * Math.pow(r1 / r0, i / (NR - 1));
      for (let j = 0; j < NA; j++) {
        const a = (j / NA) * Math.PI * 2;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const k = (i * NA + j) * 3;
        pos[k] = x;
        pos[k + 1] = ground.heightAt(x, z) - 0.05;
        pos[k + 2] = z;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < NR - 1; i++)
      for (let j = 0; j < NA; j++) {
        const a = i * NA + j;
        const b = i * NA + ((j + 1) % NA);
        const c = (i + 1) * NA + j;
        const d = (i + 1) * NA + ((j + 1) % NA);
        idx.push(a, b, c, b, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // winding: make sure normals point up
    const n = g.attributes.normal as THREE.BufferAttribute;
    if (n.getY(NA * 3) < 0) {
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = t;
      }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    g.computeBoundingSphere();
    return g;
  }, [ground, size]);

  surfaceUniforms.uSunVis.value = useMemo(() => ground.buildSunVis(), [ground]);
  useEffect(() => {
    return () => {
      surfaceUniforms.uSunVis.value?.dispose();
      surfaceUniforms.uSunVis.value = null;
    };
  }, [ground]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => ringMat.dispose(), [ringMat]);
  useEffect(() => () => inner.dispose(), [inner]);
  useEffect(() => () => ring.dispose(), [ring]);

  return (
    <group>
      <mesh geometry={inner} material={material} castShadow receiveShadow />
      <mesh geometry={ring} material={ringMat} castShadow receiveShadow />
    </group>
  );
}
