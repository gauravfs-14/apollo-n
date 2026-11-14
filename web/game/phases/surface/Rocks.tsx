"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";
import { mulberry32, type Ground } from "./ground";
import { makeRegolith } from "./materials";
import { rt } from "./store";
import { colliders, LANDER_RADIUS } from "./world";

function rockGeometry(detail: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry32(seed);
  const o = [rnd() * 10, rnd() * 10, rnd() * 10];
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 2.3 + o[0]) * Math.cos(v.y * 2.1 + o[1]) + Math.sin(v.z * 3.1 + o[2]) * 0.6 + Math.sin((v.x + v.y) * 5.0 + o[0]) * 0.18;
    v.multiplyScalar(0.82 + 0.16 * n);
    // flatten the base a little so rocks sit rather than balance
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.4;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

/** Boulders + rocks (static, instanced) and a pebble field that re-seeds around the player (cheap, constant cost). */
export function Rocks({ ground }: { ground: Ground }) {
  const q = useQuality();

  const mats = useMemo(
    () => ({
      rock: makeRegolith({ color: "#8a8680", roughness: 1, rock: true }),
      pebble: makeRegolith({ color: "#8d8983", roughness: 1, rock: true }),
    }),
    [],
  );
  const geos = useMemo(
    () => ({ boulder: rockGeometry(3, 1), rock: rockGeometry(2, 2), pebble: rockGeometry(0, 3) }),
    [],
  );

  const nBoulder = Math.round(90 * q.instances);
  const nRock = Math.round(800 * q.instances);
  const nPebble = Math.round(3400 * q.instances);

  const boulderRef = useRef<THREE.InstancedMesh>(null);
  const rockRef = useRef<THREE.InstancedMesh>(null);
  const pebbleRef = useRef<THREE.InstancedMesh>(null);

  // Static rocks
  useEffect(() => {
    const rnd = mulberry32(ground.seed ^ 0x51ed);
    colliders.length = 0;
    colliders.push({ x: 0, z: 0, r: LANDER_RADIUS });
    const place = (mesh: THREE.InstancedMesh, n: number, rMin: number, rMax: number, collide: number) => {
      let i = 0;
      let tries = 0;
      while (i < n && tries++ < n * 20) {
        const x = (rnd() - 0.5) * 340;
        const z = (rnd() - 0.5) * 340;
        if (Math.hypot(x, z) < 8) continue;
        const r = rMin + (rMax - rMin) * Math.pow(rnd(), 2.6);
        const sx = r * (0.8 + rnd() * 0.5);
        const sy = r * (0.5 + rnd() * 0.5);
        const sz = r * (0.8 + rnd() * 0.5);
        const y = ground.heightAt(x, z) + sy * 0.12;
        tmpE.set((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5);
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
        mesh.setMatrixAt(i, tmpM);
        const tone = 0.55 + rnd() * 0.6;
        mesh.setColorAt(i, tmpC.setScalar(tone));
        if (r >= collide) colliders.push({ x, z, r: Math.max(sx, sz) * 0.85 });
        i++;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    if (boulderRef.current) place(boulderRef.current, nBoulder, 1.0, 4.2, 1.1);
    if (rockRef.current) place(rockRef.current, nRock, 0.22, 1.1, 99);
    return () => {
      colliders.length = 0;
    };
  }, [ground, nBoulder, nRock]);

  // Pebble field around the player on a hashed grid (re-seeded when the player crosses a cell)
  const lastCell = useRef({ x: 1e9, z: 1e9 });
  const CELL = 6;
  const RAD = 8;
  const PER = Math.max(2, Math.floor(nPebble / ((2 * RAD + 1) * (2 * RAD + 1))));
  useFrame(() => {
    const m = pebbleRef.current;
    if (!m) return;
    const cx = Math.floor(rt.pos.x / CELL);
    const cz = Math.floor(rt.pos.z / CELL);
    if (cx === lastCell.current.x && cz === lastCell.current.z) return;
    lastCell.current = { x: cx, z: cz };
    let n = 0;
    const cap = m.instanceMatrix.count;
    for (let i = -RAD; i <= RAD; i++)
      for (let j = -RAD; j <= RAD; j++) {
        const gx = cx + i;
        const gz = cz + j;
        const rnd = mulberry32((gx * 73856093) ^ (gz * 19349663) ^ ground.seed);
        for (let k = 0; k < PER && n < cap; k++) {
          const x = (gx + rnd()) * CELL;
          const z = (gz + rnd()) * CELL;
          const dx = x - (cx + 0.5) * CELL;
          const dz = z - (cz + 0.5) * CELL;
          const edge = 1 - THREE.MathUtils.smoothstep(Math.hypot(dx, dz), RAD * CELL * 0.72, RAD * CELL * 0.98);
          const r = (0.035 + 0.17 * Math.pow(rnd(), 3)) * edge;
          const y = ground.heightAt(x, z);
          tmpE.set(rnd() * 3, rnd() * 6.28, rnd() * 3);
          tmpQ.setFromEuler(tmpE);
          m.setMatrixAt(n, tmpM.compose(tmpP.set(x, y + r * 0.1, z), tmpQ, tmpS.set(r * 1.2, r * 0.8, r)));
          m.setColorAt(n, tmpC.setScalar(0.5 + rnd() * 0.6));
          n++;
        }
      }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      Object.values(geos).forEach((g) => g.dispose());
    },
    [mats, geos],
  );

  return (
    <>
      <instancedMesh key={`b${nBoulder}`} ref={boulderRef} args={[geos.boulder, mats.rock, nBoulder]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh key={`r${nRock}`} ref={rockRef} args={[geos.rock, mats.rock, nRock]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh key={`p${nPebble}`} ref={pebbleRef} args={[geos.pebble, mats.pebble, PER * (2 * RAD + 1) * (2 * RAD + 1)]} receiveShadow frustumCulled={false} />
    </>
  );
}
