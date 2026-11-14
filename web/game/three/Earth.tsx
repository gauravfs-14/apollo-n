"use client";
/* eslint-disable react-hooks/immutability -- three.js objects/uniforms are mutated by design */
// Earth: NASA Blue Marble (topography + bathymetry) day side, NASA Black Marble city lights on the night side,
// specular ocean glint, procedural animated cloud layer and a Rayleigh-style atmosphere rim.
// Props:
//   radius       sphere radius in scene units (default 1). Everything scales with it.
//   sun          direction TOWARD the sun in world space (default [1, 0.25, 0.6]); does not need to be normalised.
//   spin         rotation speed in rad/s about Y (default 0.02)
//   tilt         axial tilt in radians (default 0.41)
//   clouds       draw the cloud layer (default true; forced off on the lowest tier only when `lite`)
//   atmosphere   draw the atmosphere rim (default true)
//   lite         force the cheapest settings (1K textures, 3-octave clouds), e.g. for a distant Earth
//   ...group     position / rotation / scale are forwarded to the outer group
// Texture sizes follow useQuality(): low 1K, medium 2K, high 4K day + 2K night/ocean (all webp in /textures/earth).
// Rendering is a single ShaderMaterial per layer (3 draw calls, ~10k tris at high). Output is linear: it works both
// with <Effects/> (tone mapping) and without.
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useQuality } from "../core/perf";

type GroupProps = Omit<React.ComponentProps<"group">, "ref">;
export interface EarthProps extends GroupProps {
  radius?: number;
  sun?: [number, number, number];
  spin?: number;
  tilt?: number;
  clouds?: boolean;
  atmosphere?: boolean;
  lite?: boolean;
}

const BASE = "/textures/earth/";
export const EARTH_TEXTURES = {
  low: [`${BASE}day_1k.webp`, `${BASE}night_1k.webp`, `${BASE}ocean_1k.webp`],
  medium: [`${BASE}day_2k.webp`, `${BASE}night_2k.webp`, `${BASE}ocean_2k.webp`],
  high: [`${BASE}day_4k.webp`, `${BASE}night_2k.webp`, `${BASE}ocean_2k.webp`],
} as const;

const VERT = /* glsl */ `
varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vObj;
void main(){
  vUv = uv; vObj = position;
  vec4 w = modelMatrix * vec4(position,1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SURFACE_FRAG = /* glsl */ `
uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D oceanMap;
uniform vec3 sunDir;
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(N, sunDir);
  float day = smoothstep(-0.12, 0.22, ndl);
  vec3 albedo = texture2D(dayMap, vUv).rgb;
  float ocean = texture2D(oceanMap, vUv).r;
  vec3 lights = texture2D(nightMap, vUv).rgb;

  float lit = max(ndl, 0.0);
  // soft wrap so the terminator is not razor sharp; slightly warm near it (long atmospheric path)
  vec3 sunCol = mix(vec3(1.0,0.62,0.38), vec3(1.0,0.97,0.92), smoothstep(0.0, 0.35, ndl));
  vec3 col = albedo * sunCol * (pow(lit, 0.9) * 1.25 + 0.02);
  // ocean: darker, glossy
  col *= mix(1.0, 0.82, ocean);
  vec3 H = normalize(sunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0) * ocean * 0.9 + pow(max(dot(N, H), 0.0), 24.0) * ocean * 0.06;
  col += sunCol * spec * smoothstep(0.0, 0.2, ndl);
  // night lights (warm), faded in as the sun sets
  float nightMask = 1.0 - day;
  vec3 nl = pow(lights, vec3(1.6)) * vec3(1.0, 0.78, 0.5) * 2.2;
  col += nl * nightMask * (1.0 - ocean * 0.6);
  // faint earthshine / ambient on the night side so continents stay readable
  col += albedo * vec3(0.012, 0.018, 0.03) * nightMask;
  // atmosphere limb tint on the surface
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.22, 0.45, 1.0) * fres * (0.15 + 0.9 * day) * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const NOISE = /* glsl */ `
float hash(vec3 p){ p = fract(p*0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(7.1, 3.7, 1.3); a *= 0.5; }
  return s;
}`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 sunDir; uniform float time;
varying vec3 vN; varying vec3 vW; varying vec3 vObj;
${NOISE}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 p = normalize(vObj);
  float lat = abs(p.y);
  // weather bands: wet at the equator and ~55 deg, dry at ~25 deg
  float band = 0.55 + 0.35 * cos(lat * 6.2) - 0.25 * smoothstep(0.88, 1.0, lat);
  vec3 q = p * 2.6 + vec3(time * 0.004, 0.0, time * 0.003);
  vec3 warp = vec3(fbm(q + 3.1), fbm(q + 8.7), fbm(q + 1.9)) - 0.5;
  float n = fbm(q * 1.7 + warp * 1.6);
  float cover = smoothstep(0.50 - 0.12 * band, 0.78, n * (0.75 + 0.5 * band));
  float ndl = dot(N, sunDir);
  float lit = smoothstep(-0.18, 0.35, ndl);
  vec3 sunCol = mix(vec3(1.0,0.6,0.4), vec3(1.0), smoothstep(-0.05, 0.4, ndl));
  vec3 col = vec3(0.98) * sunCol * (max(ndl, 0.0) * 1.15 + 0.03);
  // thicker cloud is brighter, thin edges slightly translucent
  float alpha = cover * (0.25 + 0.75 * lit) * 0.92 + cover * 0.06;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 sunDir;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  // backside sphere: normals face away from the camera
  float rim = pow(clamp(0.55 - dot(N, V), 0.0, 1.0), 3.5);
  float ndl = dot(N, sunDir);
  float day = smoothstep(-0.25, 0.35, ndl);
  float twilight = exp(-pow((ndl - 0.02) * 4.0, 2.0));
  vec3 blue = vec3(0.26, 0.52, 1.0);
  vec3 orange = vec3(1.0, 0.45, 0.16);
  vec3 col = mix(blue, orange, twilight * 0.7);
  float a = rim * (0.12 + 0.95 * day);
  gl_FragColor = vec4(col * a * 1.7, a);
  #include <colorspace_fragment>
}`;

export function Earth({ radius = 1, sun = [1, 0.25, 0.6], spin = 0.02, tilt = 0.41, clouds = true, atmosphere = true, lite = false, ...group }: EarthProps) {
  const q = useQuality();
  const tier = lite ? "low" : q.tier;
  const urls = EARTH_TEXTURES[tier];
  const [day, night, ocean] = useTexture([...urls]) as THREE.Texture[];

  useEffect(() => {
    for (const t of [day, night, ocean]) {
      t.colorSpace = t === ocean ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.anisotropy = tier === "high" ? 8 : 2;
      t.wrapS = THREE.RepeatWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.needsUpdate = true;
    }
  }, [day, night, ocean, tier]);

  const sunVec = useMemo(() => new THREE.Vector3(...sun).normalize(), [sun]);
  const octaves = tier === "low" ? 3 : tier === "medium" ? 4 : 5;

  const surfaceMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SURFACE_FRAG, uniforms: { dayMap: { value: null }, nightMap: { value: null }, oceanMap: { value: null }, sunDir: { value: sunVec } } }),
    [sunVec],
  );
  const cloudMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: CLOUD_FRAG,
        defines: { OCTAVES: octaves },
        uniforms: { sunDir: { value: sunVec }, time: { value: 0 } },
        transparent: true,
        depthWrite: false,
      }),
    [sunVec, octaves],
  );
  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: ATMO_FRAG,
        uniforms: { sunDir: { value: sunVec } },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    [sunVec],
  );
  surfaceMat.uniforms.dayMap.value = day;
  surfaceMat.uniforms.nightMap.value = night;
  surfaceMat.uniforms.oceanMap.value = ocean;

  useEffect(() => () => { surfaceMat.dispose(); cloudMat.dispose(); atmoMat.dispose(); }, [surfaceMat, cloudMat, atmoMat]);

  const spinRef = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    if (spinRef.current) spinRef.current.rotation.y += dt * spin;
    cloudMat.uniforms.time.value = state.clock.elapsedTime;
  });

  const seg = tier === "low" ? 48 : tier === "medium" ? 64 : 96;
  return (
    <group {...group}>
      <group rotation={[0, 0, tilt]}>
        <group ref={spinRef}>
          <mesh material={surfaceMat} scale={radius}>
            <sphereGeometry args={[1, seg, seg / 2]} />
          </mesh>
          {clouds && (
            <mesh material={cloudMat} scale={radius * 1.006}>
              <sphereGeometry args={[1, seg, seg / 2]} />
            </mesh>
          )}
        </group>
        {atmosphere && (
          <mesh material={atmoMat} scale={radius * 1.05}>
            <sphereGeometry args={[1, 48, 24]} />
          </mesh>
        )}
      </group>
    </group>
  );
}
