"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
// Footprints (instanced decals, ring buffer) and ballistic dust (one Points draw call).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";
import type { Ground } from "./ground";

interface Print {
  x: number;
  z: number;
  yaw: number;
}
interface Burst {
  x: number;
  y: number;
  z: number;
  n: number;
  speed: number;
}
const prints: Print[] = [];
const bursts: Burst[] = [];

export function addFootprint(x: number, z: number, yaw: number) {
  prints.push({ x, z, yaw });
}
export function addDust(x: number, y: number, z: number, n = 10, speed = 1) {
  bursts.push({ x, y, z, n, speed });
}
export function clearTrail() {
  prints.length = 0;
  bursts.length = 0;
}

function bootTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = "#fff";
  // sole + heel, with tread bars cut out
  g.beginPath();
  g.ellipse(32, 44, 22, 40, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(32, 104, 18, 18, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#555";
  for (let y = 20; y < 118; y += 12) g.fillRect(14, y, 36, 3);
  const t = new THREE.CanvasTexture(c);
  return t;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpN = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export function Footprints({ ground }: { ground: Ground }) {
  const q = useQuality();
  const cap = Math.round(320 * Math.max(0.5, q.instances));
  const ref = useRef<THREE.InstancedMesh>(null);
  const head = useRef(0);
  const total = useRef(0);
  const tex = useMemo(() => bootTexture(), []);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.17, 0.34);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#050504",
        alphaMap: tex,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    [tex],
  );
  useEffect(() => {
    head.current = 0;
    total.current = 0;
    clearTrail();
    return () => {
      tex.dispose();
      geo.dispose();
      mat.dispose();
    };
  }, [tex, geo, mat]);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    if (!prints.length) return;
    while (prints.length) {
      const p = prints.shift()!;
      const y = ground.heightAt(p.x, p.z) + 0.025;
      ground.normalAt(p.x, p.z, tmpN);
      tmpQ.setFromUnitVectors(UP, tmpN);
      tmpQ2.setFromAxisAngle(UP, p.yaw);
      tmpQ.multiply(tmpQ2);
      m.setMatrixAt(head.current, tmpM.compose(tmpP.set(p.x, y, p.z), tmpQ, tmpS));
      head.current = (head.current + 1) % cap;
      total.current = Math.min(cap, total.current + 1);
    }
    m.count = total.current;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh key={cap} ref={ref} args={[geo, mat, cap]} frustumCulled={false} renderOrder={2} />;
}

const MAXP = 360;

export function Dust() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
    g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(MAXP), 1));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { scale: { value: 600 } },
        vertexShader: `attribute float alpha; varying float vA; uniform float scale;
          void main(){ vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = clamp(scale*0.07/(-mv.z), 1., 14.); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5)*2.; float a = smoothstep(1.,0.2,d)*vA; if(a<0.01) discard; gl_FragColor = vec4(vec3(0.34,0.32,0.29), a*0.7); }`,
      }),
    [],
  );
  const st = useMemo(
    () => ({
      p: new Float32Array(MAXP * 3),
      v: new Float32Array(MAXP * 3),
      life: new Float32Array(MAXP),
      floor: new Float32Array(MAXP),
      next: 0,
    }),
    [],
  );
  useEffect(() => {
    return () => {
      geo.dispose();
      mat.dispose();
    };
  }, [geo, mat]);

  useFrame(({ size }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    mat.uniforms.scale.value = size.height;
    while (bursts.length) {
      const b = bursts.shift()!;
      for (let i = 0; i < b.n; i++) {
        const k = st.next;
        st.next = (st.next + 1) % MAXP;
        const a = Math.random() * 6.283;
        const s = (0.3 + Math.random() * 1.1) * b.speed;
        st.p[k * 3] = b.x + Math.cos(a) * 0.12;
        st.p[k * 3 + 1] = b.y + 0.05;
        st.p[k * 3 + 2] = b.z + Math.sin(a) * 0.12;
        st.v[k * 3] = Math.cos(a) * s;
        st.v[k * 3 + 1] = (0.2 + Math.random() * 0.9) * b.speed;
        st.v[k * 3 + 2] = Math.sin(a) * s;
        st.life[k] = 1;
        st.floor[k] = b.y;
      }
    }
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const al = geo.attributes.alpha as THREE.BufferAttribute;
    for (let k = 0; k < MAXP; k++) {
      if (st.life[k] <= 0) {
        al.array[k] = 0;
        continue;
      }
      st.v[k * 3 + 1] -= 1.62 * dt;
      st.p[k * 3] += st.v[k * 3] * dt;
      st.p[k * 3 + 1] += st.v[k * 3 + 1] * dt;
      st.p[k * 3 + 2] += st.v[k * 3 + 2] * dt;
      if (st.p[k * 3 + 1] < st.floor[k]) st.life[k] -= dt * 6; // landed: fade out fast
      else st.life[k] -= dt * 0.12;
      pos.array[k * 3] = st.p[k * 3];
      pos.array[k * 3 + 1] = st.p[k * 3 + 1];
      pos.array[k * 3 + 2] = st.p[k * 3 + 2];
      al.array[k] = Math.max(0, st.life[k]);
    }
    pos.needsUpdate = true;
    al.needsUpdate = true;
  });

  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}
