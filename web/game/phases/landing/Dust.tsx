"use client";
/* eslint-disable react-hooks/immutability */
// Regolith blown out by the engine: a fast, low radial sheet. Vacuum physics: no drag, ballistic under 1.62 m/s^2,
// particles hop and slide outward along the ground (that is why Apollo dust streamed so far).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";
import type { TerrainData } from "../../three/terrain";

const VERT = /* glsl */ `
attribute float aSize; attribute float aAlpha;
uniform float uScale; varying float vA;
void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vA = aAlpha;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix*mv; }`;
const FRAG = /* glsl */ `
varying float vA; uniform vec3 uColor;
void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); if(d>0.5) discard;
  float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor, a*a*vA); }`;

export interface DustState {
  /** ground point under the engine, null when no emission */
  x: number;
  z: number;
  /** 0..1 emission strength (engine throttle x proximity) */
  strength: number;
}

export function Dust({ data, state }: { data: TerrainData; state: React.RefObject<DustState> }) {
  const q = useQuality();
  const N = Math.max(500, Math.round(2600 * q.instances));
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const sim = useMemo(
    () => ({
      p: new Float32Array(N * 3),
      v: new Float32Array(N * 3),
      age: new Float32Array(N).fill(99),
      life: new Float32Array(N),
      sz: new Float32Array(N),
      al: new Float32Array(N),
      next: 0,
      acc: 0,
    }),
    [N],
  );
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sim.p, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sim.sz, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(sim.al, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [sim]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uScale: { value: 800 }, uColor: { value: new THREE.Color(0.62, 0.59, 0.55) } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    mat.uniforms.uScale.value = size.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const st = state.current;
    if (st && st.strength > 0.02) {
      sim.acc += dt * 900 * st.strength * q.instances + 0;
      while (sim.acc >= 1) {
        sim.acc -= 1;
        const i = sim.next;
        sim.next = (sim.next + 1) % N;
        const a = Math.random() * Math.PI * 2;
        const sp = 18 + Math.random() * 62 * (0.4 + st.strength);
        const r0 = 1.5 + Math.random() * 3;
        sim.p[i * 3] = st.x + Math.sin(a) * r0;
        sim.p[i * 3 + 2] = st.z + Math.cos(a) * r0;
        sim.p[i * 3 + 1] = data.heightAt(st.x, st.z) + 0.4 + Math.random() * 0.5;
        sim.v[i * 3] = Math.sin(a) * sp;
        sim.v[i * 3 + 2] = Math.cos(a) * sp;
        sim.v[i * 3 + 1] = sp * (0.01 + Math.random() * 0.07) + Math.random() * 1.5;
        sim.age[i] = 0;
        sim.life[i] = 5 + Math.random() * 4;
        sim.sz[i] = 1.6 + Math.random() * 3.2;
      }
    }
    for (let i = 0; i < N; i++) {
      const a = sim.age[i] + dt;
      sim.age[i] = a;
      if (a > sim.life[i]) {
        sim.al[i] = 0;
        continue;
      }
      const k = i * 3;
      sim.v[k + 1] -= 1.62 * dt;
      sim.p[k] += sim.v[k] * dt;
      sim.p[k + 1] += sim.v[k + 1] * dt;
      sim.p[k + 2] += sim.v[k + 2] * dt;
      const g = data.heightAt(sim.p[k], sim.p[k + 2]) + 0.15;
      if (sim.p[k + 1] < g) {
        sim.p[k + 1] = g;
        sim.v[k + 1] = Math.abs(sim.v[k + 1]) * 0.18;
        sim.v[k] *= 0.97;
        sim.v[k + 2] *= 0.97;
      }
      const t = a / sim.life[i];
      sim.al[i] = Math.min(1, a * 4) * Math.pow(1 - t, 1.4) * 0.34;
      sim.sz[i] += dt * 1.1;
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  });

  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}
