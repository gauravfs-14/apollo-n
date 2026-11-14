"use client";
 
// Black lunar sky with the real star map, the Sun (hard, ~2 deg above the horizon at the pole) and the real Earth
// (phase from the true Sun direction) when it is above the horizon. Plus the Sun's key light.
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useQuality } from "../../core/perf";
import { Earth } from "../Earth";
import { Starfield } from "../Starfield";
import type { SkyState } from "./sun";

const SKY_R = 9000;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,244,225,1)");
  gr.addColorStop(0.08, "rgba(255,236,205,0.55)");
  gr.addColorStop(0.35, "rgba(255,225,190,0.12)");
  gr.addColorStop(1, "rgba(255,220,180,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function LunarSky({ sky, stars = 1.2, earth = true }: { sky: SkyState; stars?: number; earth?: boolean }) {
  const q = useQuality();
  const sunRef = useRef<THREE.Group>(null);
  const glow = useMemo(() => glowTexture(), []);
  useEffect(() => () => glow.dispose(), [glow]);
  const sunPos = useMemo(() => new THREE.Vector3(...sky.sunDir).multiplyScalar(SKY_R * 0.9), [sky]);
  const earthPos = useMemo(() => new THREE.Vector3(...sky.earthDir).multiplyScalar(SKY_R * 0.85), [sky]);
  const earthR = SKY_R * 0.85 * Math.tan((0.95 * Math.PI) / 180);
  useFrame(({ camera }) => sunRef.current?.position.copy(camera.position));
  return (
    <>
      <Starfield brightness={stars} />
      <group ref={sunRef} renderOrder={-900}>
        <mesh position={sunPos} frustumCulled={false}>
          <circleGeometry args={[SKY_R * 0.9 * Math.tan((0.266 * Math.PI) / 180), 32]} />
          <meshBasicMaterial color={[9, 8.4, 7]} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <sprite position={sunPos} scale={[SKY_R * 0.9 * 0.2, SKY_R * 0.9 * 0.2, 1]} frustumCulled={false}>
          <spriteMaterial map={glow} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={q.post ? 0.7 : 0.4} toneMapped={false} />
        </sprite>
        {earth && sky.earthElDeg > -1.2 && (
          <group position={earthPos}>
            <Earth radius={earthR} sun={sky.sunDir} lite spin={0} atmosphere clouds={false} />
          </group>
        )}
      </group>
    </>
  );
}

/** The Sun's key light + a whisper of Earthshine. `focus` centres the dynamic shadow box (metres). */
export function SunLight({
  sky,
  focus = [0, 0, 0],
  shadows = false,
  radius = 120,
  intensity = 14,
}: {
  sky: SkyState;
  focus?: [number, number, number];
  shadows?: boolean;
  radius?: number;
  intensity?: number;
}) {
  const q = useQuality();
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const dir = useMemo(() => new THREE.Vector3(...sky.sunDir), [sky]);
  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target = target;
    target.position.set(...focus);
    target.updateMatrixWorld();
    l.position.set(focus[0], focus[1], focus[2]).addScaledVector(dir, 600);
    if (shadows) {
      const c = l.shadow.camera;
      c.left = -radius;
      c.right = radius;
      c.top = radius;
      c.bottom = -radius;
      c.near = 1;
      c.far = 1300;
      c.updateProjectionMatrix();
      l.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      l.shadow.map?.dispose();
      l.shadow.map = null;
      l.shadow.bias = -0.0003;
      l.shadow.normalBias = 0.12;
      l.shadow.radius = 3;
    }
  }, [dir, focus, shadows, radius, q.shadowMapSize, target]);
  const earthUp = sky.earthElDeg > 0;
  return (
    <>
      <primitive object={target} />
      <directionalLight ref={light} color="#fff4e6" intensity={intensity} castShadow={shadows && q.shadows} />
      {earthUp && <directionalLight position={sky.earthDir.map((v) => v * 100) as [number, number, number]} color="#9db8ff" intensity={0.05} />}
    </>
  );
}

/**
 * Sunlight bounced off the bright regolith, for lit hardware that would otherwise be a black silhouette (the Sun sits
 * ~1.5 deg above the horizon, so most of a lander faces away from it). Two parts: a hemisphere light whose "sky" half is
 * pure black (the lunar sky gives nothing) and whose "ground" half is regolith grey, and a tiny generated environment map
 * (dark sky, bright floor, a hard Sun spot) so foil and metal reflect the ground and Sun. The upper hemisphere of both is
 * black, so flat ground and ground shadows are not lifted.
 */
export function GroundBounce({ sky, strength = 1, envIntensity = 1 }: { sky: SkyState; strength?: number; envIntensity?: number }) {
  const sun = useMemo(() => new THREE.Vector3(...sky.sunDir).multiplyScalar(30), [sky]);
  return (
    <>
      <hemisphereLight args={["#000000", "#a39b8e", 1.6 * strength]} />
      <Environment resolution={64} frames={1} environmentIntensity={envIntensity}>
        <color attach="background" args={["#000000"]} />
        <Lightformer form="rect" intensity={0.9} color="#b4aa9a" position={[0, -6, 0]} rotation-x={-Math.PI / 2} scale={[60, 60, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#a89f90" position={[0, -2, -14]} scale={[40, 3, 1]} />
        <Lightformer form="circle" intensity={40} color="#fff4e6" position={[sun.x, sun.y, sun.z]} scale={3} target={[0, 0, 0]} />
      </Environment>
    </>
  );
}
