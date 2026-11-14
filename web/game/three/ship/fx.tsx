"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability */
// GPU particle system for smoke, dust and fire: one InstancedMesh, positions computed in the
// vertex shader from (birth, velocity, drag, gravity), so there is no per-particle CPU work per frame.
// Soft billboards from a procedural cloud texture, fake sphere lighting, hot-glow near a source.
import { useFrame } from "@react-three/fiber";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";

export interface EmitSpec {
  pos: [number, number, number];
  posJitter?: [number, number, number];
  vel?: [number, number, number];
  velJitter?: [number, number, number];
  life: number;
  lifeJitter?: number;
  size0: number;
  size1: number;
  color?: [number, number, number];
  /** 0..1 brightness boost that fades with age (hot gas near the engine). */
  glow?: number;
}

export interface ParticlesApi {
  emit(n: number, s: EmitSpec): void;
  clear(): void;
}

let cloudTex: THREE.CanvasTexture | null = null;
export function cloudTexture() {
  if (cloudTex) return cloudTex;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  const img = x.createImageData(S, S);
  // fbm-ish blob: radial falloff times multi-octave value noise
  const rnd = (n: number) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const g = (ix: number, iy: number, o: number) => rnd(ix * 57 + iy * 113 + o * 17);
  const vn = (px: number, py: number, o: number) => {
    const ix = Math.floor(px), iy = Math.floor(py);
    const fx = px - ix, fy = py - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return g(ix, iy, o) * (1 - sx) * (1 - sy) + g(ix + 1, iy, o) * sx * (1 - sy) + g(ix, iy + 1, o) * (1 - sx) * sy + g(ix + 1, iy + 1, o) * sx * sy;
  };
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const u = (i / S) * 2 - 1, v = (j / S) * 2 - 1;
      const r = Math.hypot(u, v);
      let n = 0, a = 0.5;
      for (let o = 0; o < 4; o++) {
        n += vn(((i / S) * 4) * 2 ** o + 3, ((j / S) * 4) * 2 ** o + 7, o) * a;
        a *= 0.5;
      }
      const edge = Math.max(0, 1 - r * r);
      const alpha = Math.min(1, Math.max(0, (n * 1.6 - 0.35) * edge * 1.6 + edge * 0.25));
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = alpha * 255;
    }
  x.putImageData(img, 0, 0);
  cloudTex = new THREE.CanvasTexture(c);
  cloudTex.colorSpace = THREE.NoColorSpace;
  return cloudTex;
}

const VERT = /* glsl */ `
  attribute vec3 aP0; attribute vec3 aV; attribute vec4 aT; attribute vec4 aC; attribute float aG;
  uniform float uTime; uniform float uDrag; uniform vec3 uGravity; uniform vec3 uGlowPos; uniform float uGlowR;
  varying vec2 vUv; varying float vK; varying vec4 vC; varying float vGlow; varying float vSpin; varying float vNear;
  void main(){
    float age = uTime - aT.x;
    float k = age / aT.y;
    vK = k; vUv = uv; vC = aC; vSpin = aC.a;
    if (aT.y <= 0.0 || k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float d = max(uDrag, 0.0001);
    vec3 p = aP0 + aV * ((1.0 - exp(-d * age)) / d) + 0.5 * uGravity * age * age;
    float size = mix(aT.z, aT.w, sqrt(k));
    float ang = aC.a * 6.2831 + age * (aC.a - 0.5) * 0.8;
    float cs = cos(ang), sn = sin(ang);
    vec2 q = position.xy; q = vec2(q.x*cs - q.y*sn, q.x*sn + q.y*cs);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    mv.xy += q * size;
    vGlow = aG * pow(1.0 - k, 2.0) + exp(-length(p - uGlowPos) / max(uGlowR, 0.001)) * step(0.0001, uGlowR);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uOpacity; uniform vec3 uLight; uniform vec3 uAmbient; uniform vec3 uGlowColor; uniform float uAdditive;
  varying vec2 vUv; varying float vK; varying vec4 vC; varying float vGlow; varying float vSpin;
  void main(){
    vec2 c = vUv * 2.0 - 1.0;
    float a = texture2D(uMap, vUv).a;
    float r2 = dot(c, c);
    vec3 n = normalize(vec3(c, sqrt(max(0.0, 1.0 - r2))));
    float diff = clamp(dot(n, normalize(uLight)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = vC.rgb * (uAmbient + diff * (1.0 - uAmbient)) + uGlowColor * vGlow;
    float fadeIn = smoothstep(0.0, 0.08, vK);
    float fadeOut = pow(1.0 - vK, 1.3);
    float alpha = a * fadeIn * fadeOut * uOpacity;
    if (uAdditive > 0.5) { gl_FragColor = vec4(col * alpha, alpha); } else { gl_FragColor = vec4(col, alpha); }
    if (alpha < 0.003) discard;
    #include <colorspace_fragment>
  }
`;

interface Props {
  max?: number;
  additive?: boolean;
  opacity?: number;
  drag?: number;
  gravity?: [number, number, number];
  /** View-space light dir is derived from this world direction. */
  lightDir?: [number, number, number];
  ambient?: number;
  glowColor?: string;
  glowPos?: [number, number, number];
  /** Live glow position (world); overrides glowPos without re-rendering. */
  glowRef?: React.MutableRefObject<THREE.Vector3>;
  glowRadius?: number;
  renderOrder?: number;
}

export const Particles = forwardRef<ParticlesApi, Props>(function Particles(
  { max = 400, additive = false, opacity = 1, drag = 0.4, gravity = [0, 0, 0], lightDir = [0.5, 0.8, 0.3], ambient = 0.45, glowColor = "#ff8a3a", glowPos = [0, 0, 0], glowRef, glowRadius = 0, renderOrder = 10 },
  ref,
) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const cursor = useRef(0);
  const clock = useRef(0);
  const attrs = useMemo(() => {
    const mk = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    return { p0: mk(3), v: mk(3), t: mk(4), c: mk(4), g: mk(1) };
  }, [max]);
  const geo = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    g.setAttribute("aP0", attrs.p0);
    g.setAttribute("aV", attrs.v);
    g.setAttribute("aT", attrs.t);
    g.setAttribute("aC", attrs.c);
    g.setAttribute("aG", attrs.g);
    g.instanceCount = max;
    return g;
  }, [attrs, max]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 }, uDrag: { value: drag }, uGravity: { value: new THREE.Vector3(...gravity) },
          uGlowPos: { value: new THREE.Vector3(...glowPos) }, uGlowR: { value: glowRadius },
          uMap: { value: cloudTexture() }, uOpacity: { value: opacity }, uLight: { value: new THREE.Vector3() },
          uAmbient: { value: new THREE.Vector3(ambient, ambient, ambient) }, uGlowColor: { value: new THREE.Color(glowColor) },
          uAdditive: { value: additive ? 1 : 0 },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [additive],
  );
  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);

  const lightV = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    clock.current += dt;
    const u = mat.uniforms;
    u.uTime.value = clock.current;
    u.uOpacity.value = opacity;
    u.uDrag.value = drag;
    u.uGravity.value.set(...gravity);
    if (glowRef) u.uGlowPos.value.copy(glowRef.current); else u.uGlowPos.value.set(...glowPos);
    u.uGlowR.value = glowRadius;
    u.uAmbient.value.setScalar(ambient);
    lightV.set(...lightDir).transformDirection(state.camera.matrixWorldInverse);
    u.uLight.value.copy(lightV);
  });

  useImperativeHandle(ref, () => ({
    emit(n, s) {
      const j = (a: number, r = 0) => a + (Math.random() * 2 - 1) * r;
      for (let i = 0; i < n; i++) {
        const k = cursor.current;
        cursor.current = (k + 1) % max;
        const pj = s.posJitter ?? [0, 0, 0], v = s.vel ?? [0, 0, 0], vj = s.velJitter ?? [0, 0, 0], col = s.color ?? [0.8, 0.8, 0.8];
        attrs.p0.setXYZ(k, j(s.pos[0], pj[0]), j(s.pos[1], pj[1]), j(s.pos[2], pj[2]));
        attrs.v.setXYZ(k, j(v[0], vj[0]), j(v[1], vj[1]), j(v[2], vj[2]));
        const shade = 0.85 + Math.random() * 0.3;
        attrs.t.setXYZW(k, clock.current, s.life * (1 + (Math.random() * 2 - 1) * (s.lifeJitter ?? 0.2)), s.size0, s.size1);
        attrs.c.setXYZW(k, col[0] * shade, col[1] * shade, col[2] * shade, Math.random());
        attrs.g.setX(k, s.glow ?? 0);
      }
      attrs.p0.needsUpdate = attrs.v.needsUpdate = attrs.t.needsUpdate = attrs.c.needsUpdate = attrs.g.needsUpdate = true;
    },
    clear() {
      attrs.t.array.fill(0);
      attrs.t.needsUpdate = true;
    },
  }), [attrs, max]);

  return <mesh ref={mesh as unknown as React.Ref<THREE.Mesh>} geometry={geo} material={mat} frustumCulled={false} renderOrder={renderOrder} />;
});
