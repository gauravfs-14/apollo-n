"use client";
/* eslint-disable react-hooks/immutability */
// Engine plume: additive shader cone with flicker. Mount inside the lander group at the engine exit (local y).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const VERT = /* glsl */ `varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const FRAG = /* glsl */ `
varying vec2 vUv; varying vec3 vN;
uniform float uTime, uThr;
float h(float n){ return fract(sin(n)*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i.x+i.y*57.),h(i.x+1.+i.y*57.),f.x), mix(h(i.x+(i.y+1.)*57.),h(i.x+1.+(i.y+1.)*57.),f.x), f.y); }
void main(){
  float v = vUv.y;                       // 0 at nozzle, 1 at tip
  float ang = vUv.x * 6.2831;
  float n = noise(vec2(ang*3.0 + uTime*9.0, v*6.0 - uTime*28.0));
  float core = pow(1.0 - v, 1.8);
  float rim = pow(abs(vN.z), 1.5);       // fade near silhouette so it looks volumetric
  float a = core * (0.55 + 0.6*n) * (0.35 + 0.65*rim) * uThr;
  vec3 hot = vec3(0.75, 0.88, 1.0), warm = vec3(1.0, 0.55, 0.18);
  vec3 col = mix(hot, warm, smoothstep(0.0, 0.75, v)) * (2.6 - v*1.4);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

export function Plume({ throttle, length = 14, y = 0.5 }: { throttle: React.RefObject<number>; length?: number; y?: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 }, uThr: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.55, 3.4, 1, 24, 6, true);
    g.translate(0, -0.5, 0);
    // uv.y: 0 at top (nozzle) -> 1 at bottom; cylinder uv.y is 1 at top, flip
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    return g;
  }, []);
  useEffect(
    () => () => {
      mat.dispose();
      geo.dispose();
    },
    [mat, geo],
  );
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = throttle.current ?? 0;
    m.visible = t > 0.02;
    m.scale.set(1 + 0.25 * t, length * (0.25 + 0.75 * t) * (0.94 + 0.06 * Math.sin(clock.elapsedTime * 60)), 1 + 0.25 * t);
    mat.uniforms.uTime.value = clock.elapsedTime;
    mat.uniforms.uThr.value = Math.min(1, t * 1.3);
  });
  return <mesh ref={mesh} geometry={geo} material={mat} position={[0, y, 0]} frustumCulled={false} renderOrder={4} />;
}
