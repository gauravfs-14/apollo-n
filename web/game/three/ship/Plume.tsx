"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity */
// Rocket exhaust: additive shader cone (hot white-blue core -> yellow -> orange -> transparent),
// animated flicker + shock diamonds, plus a glow sprite at the nozzle. Points down (-Y) from its origin.
// Drive it with a mutable ref (`level.current` 0..1) to avoid React re-renders every frame.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type MutableRefObject } from "react";
import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vT;
  uniform float uLen;
  void main(){
    vUv = uv; vT = clamp(-position.y / uLen, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform float uTime; uniform float uLevel; uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uCool; uniform float uSeed;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vT;
  float n(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(n(i), n(i+vec2(1,0)), f.x), mix(n(i+vec2(0,1)), n(i+vec2(1,1)), f.x), f.y); }
  void main(){
    float t = vT;
    float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
    float flick = 0.75 + 0.25 * vn(vec2(vUv.x * 14.0 + uSeed, t * 7.0 - uTime * 26.0));
    float flick2 = 0.8 + 0.2 * sin(uTime * 41.0 + uSeed);
    float diamonds = 0.82 + 0.18 * sin(t * 44.0 - uTime * 2.0) * (1.0 - t);
    float body = pow(1.0 - t, 1.25) * smoothstep(0.0, 0.02, t + 0.02);
    float a = body * rim * flick * flick2 * diamonds * uLevel;
    vec3 col = mix(uHot, uMid, smoothstep(0.0, 0.35, t));
    col = mix(col, uCool, smoothstep(0.3, 0.9, t));
    col = mix(col, uHot, pow(rim, 3.0) * (1.0 - t) * 0.6);
    gl_FragColor = vec4(col * a * 1.6, a);
  }
`;

let glowTex: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,250,235,1)");
  g.addColorStop(0.2, "rgba(255,200,120,0.8)");
  g.addColorStop(0.5, "rgba(255,120,40,0.25)");
  g.addColorStop(1, "rgba(255,80,20,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export interface PlumeProps {
  /** Exit radius of the nozzle (m). */
  radius: number;
  /** Length at full level (m). */
  length: number;
  /** 0..1 live throttle/visibility. */
  level: MutableRefObject<number>;
  /** >1 widens the plume (vacuum). */
  spread?: number;
  position?: [number, number, number];
  hot?: string;
  mid?: string;
  cool?: string;
  glow?: boolean;
  seed?: number;
}

export function Plume({ radius, length, level, spread = 1, position = [0, 0, 0], hot = "#fff4e0", mid = "#ffb04a", cool = "#ff5a1a", glow = true, seed = 0 }: PlumeProps) {
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(radius * 0.98, radius * (1.3 + 0.9 * spread), length, 28, 14, true);
    g.translate(0, -length / 2, 0);
    return g;
  }, [radius, length, spread]);
  const inner = useMemo(() => {
    const g = new THREE.CylinderGeometry(radius * 0.55, radius * 0.7 * spread, length * 0.55, 20, 8, true);
    g.translate(0, -length * 0.275, 0);
    return g;
  }, [radius, length, spread]);
  const mk = (len: number) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uLevel: { value: 0 }, uLen: { value: len }, uSeed: { value: seed * 17.3 },
        uHot: { value: new THREE.Color(hot) }, uMid: { value: new THREE.Color(mid) }, uCool: { value: new THREE.Color(cool) },
      },
    });
  const mats = useMemo(() => [mk(length), mk(length * 0.55)], // eslint-disable-next-line react-hooks/exhaustive-deps
    [length, hot, mid, cool]);
  const sprite = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: "#ffffff" }), []);
  useEffect(() => () => { geo.dispose(); inner.dispose(); mats.forEach((m) => m.dispose()); sprite.dispose(); }, [geo, inner, mats, sprite]);

  useFrame((s) => {
    const l = level.current;
    mats[0].uniforms.uTime.value = mats[1].uniforms.uTime.value = s.clock.elapsedTime;
    mats[0].uniforms.uLevel.value = l;
    mats[1].uniforms.uLevel.value = l * 1.2;
    sprite.opacity = Math.min(1, l * 1.2);
  });

  return (
    <group position={position} scale={[1, 1, 1]}>
      <mesh geometry={geo} material={mats[0]} frustumCulled={false} renderOrder={20} />
      <mesh geometry={inner} material={mats[1]} frustumCulled={false} renderOrder={21} />
      {glow && <sprite material={sprite} scale={[radius * 7, radius * 7, 1]} position={[0, -radius * 0.6, 0]} renderOrder={22} />}
    </group>
  );
}
