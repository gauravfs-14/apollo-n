"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
// Lunar south-pole lighting: one hard Sun 2.4 degrees above the horizon, black sky, no sky light.
// Shadow camera is a tight box that follows the player (texel-snapped, so shadows never shimmer).
import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";
import { STAR_TEXTURE } from "../../three/Starfield";
import { EARTH_DIR, SUN_DIR } from "./ground";
import { rt } from "./store";

const SKY_R = 12000;
const SHADOW_R = 62;

export function SunLight() {
  const q = useQuality();
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const r = useMemo(() => new THREE.Vector3(), []);
  const u = useMemo(() => new THREE.Vector3(), []);
  const t = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const dir = useMemo(() => SUN_DIR.clone().negate(), []);
  useEffect(() => {
    r.crossVectors(dir, up).normalize();
    u.crossVectors(r, dir).normalize();
  }, [dir, up, r, u]);

  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target = target;
    const c = l.shadow.camera;
    c.left = -SHADOW_R;
    c.right = SHADOW_R;
    c.top = SHADOW_R;
    c.bottom = -SHADOW_R;
    c.near = 1;
    c.far = 1100;
    c.updateProjectionMatrix();
    l.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    l.shadow.map?.dispose();
    l.shadow.map = null;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.06;
    l.shadow.radius = 2;
  }, [q.shadowMapSize, target]);

  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const texel = (2 * SHADOW_R) / q.shadowMapSize;
    const px = rt.pos.dot(r);
    const pu = rt.pos.dot(u);
    const sx = Math.round(px / texel) * texel - px;
    const su = Math.round(pu / texel) * texel - pu;
    t.copy(rt.pos).addScaledVector(r, sx).addScaledVector(u, su);
    l.target.position.copy(t);
    l.position.copy(t).addScaledVector(SUN_DIR, 520);
    l.target.updateMatrixWorld();
  });

  return (
    <>
      <directionalLight ref={light} color="#fff4e6" intensity={24} castShadow={q.shadows} />
      <primitive object={target} />
      {/* regolith bounce: a low, grazing fill from the anti-Sun side lights vertical suit/lander faces but barely touches flat ground, so ground shadows stay black */}
      <directionalLight color="#c9c2b6" intensity={2.6} position={[-SUN_DIR.x * 100, 9, -SUN_DIR.z * 100]} />
      {/* faint earthshine so shadowed suits are not pure black; the sky itself gives no light */}
      <directionalLight color="#9db8ff" intensity={0.05} position={EARTH_DIR.toArray().map((v) => v * 100) as [number, number, number]} />
      <ambientLight intensity={0.006} color="#b0b4c0" />
    </>
  );
}

function makeEarthTexture() {
  const W = 512;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const cc = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (cc - a) * uy + (a - b - cc + d) * ux * uy;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const lat = Math.abs(y / H - 0.5) * 2;
      const land = noise((x / W) * 7, (y / H) * 3.5) * 0.6 + noise((x / W) * 16, (y / H) * 8) * 0.3 + noise((x / W) * 40, (y / H) * 20) * 0.1;
      const cloud = noise((x / W) * 12 + 5, (y / H) * 6) * 0.65 + noise((x / W) * 34, (y / H) * 17) * 0.35;
      let r = 14;
      let g = 52;
      let b = 110;
      if (land > 0.56) {
        const t = Math.min(1, (land - 0.56) * 5);
        r = 70 + 60 * t;
        g = 100 + 20 * t - 30 * lat;
        b = 50 + 20 * t;
      }
      if (lat > 0.82) {
        r = g = b = 235;
      }
      const cl = Math.max(0, cloud - 0.5) * 2.4;
      r += (240 - r) * Math.min(1, cl);
      g += (240 - g) * Math.min(1, cl);
      b += (244 - b) * Math.min(1, cl);
      const i = (y * W + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Stars (dimmed when looking toward the Sun), the Sun disc and Earth low on the horizon. */
export function Sky() {
  const tex = useTexture(STAR_TEXTURE);
  const sky = useRef<THREE.Mesh>(null);
  const sun = useRef<THREE.Mesh>(null);
  const earth = useRef<THREE.Mesh>(null);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const starMat = useMemo(() => new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false }), []);
  const sunMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.88).multiplyScalar(40), toneMapped: false, fog: false }),
    [],
  );
  const earthTex = useMemo(() => makeEarthTexture(), []);
  const earthMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { map: { value: earthTex }, sunDir: { value: SUN_DIR.clone() } },
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix*vec4(position,1.); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ vec3 c = texture2D(map, vUv).rgb; float l = smoothstep(-0.08, 0.35, dot(normalize(vN), sunDir));
            float rim = pow(1.0 - max(dot(normalize(vN), vV), 0.0), 3.0);
            vec3 col = c * (0.012 + 2.4*l) + vec3(0.25,0.5,1.0) * rim * (0.05 + 1.2*l);
            gl_FragColor = vec4(col, 1.0); }`,
        toneMapped: false,
      }),
    [earthTex],
  );
  useLayoutEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    starMat.map = tex;
    starMat.needsUpdate = true;
  }, [tex, starMat]);
  const gl = useThree((s) => s.gl);
  useEffect(
    () => () => {
      starMat.dispose();
      sunMat.dispose();
      earthMat.dispose();
      earthTex.dispose();
    },
    [starMat, sunMat, earthMat, earthTex, gl],
  );

  useFrame(({ camera }) => {
    camera.getWorldDirection(camDir);
    const facing = Math.max(0, camDir.dot(SUN_DIR));
    // exposure: staring into the Sun washes the stars out; looking away shows them
    const vis = 1 - THREE.MathUtils.smoothstep(facing, 0.35, 0.9);
    starMat.color.setScalar(0.42 * vis);
    sky.current?.position.copy(camera.position);
    sun.current?.position.copy(camera.position).addScaledVector(SUN_DIR, SKY_R * 0.97);
    sun.current?.lookAt(camera.position);
    earth.current?.position.copy(camera.position).addScaledVector(EARTH_DIR, SKY_R * 0.95);
  });

  return (
    <>
      <mesh ref={sky} material={starMat} renderOrder={-1000} frustumCulled={false} rotation={[0.4, 2.0, 0.2]}>
        <sphereGeometry args={[SKY_R, 48, 24]} />
      </mesh>
      <mesh ref={sun} material={sunMat} renderOrder={-900} frustumCulled={false}>
        <circleGeometry args={[SKY_R * 0.97 * 0.0075, 24]} />
      </mesh>
      <mesh ref={earth} material={earthMat} renderOrder={-900} frustumCulled={false} rotation={[0.3, 2.4, 0.2]}>
        <sphereGeometry args={[SKY_R * 0.95 * 0.0166, 40, 20]} />
      </mesh>
    </>
  );
}
