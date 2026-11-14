"use client";
// Shared Moon. NASA SVS CGI Moon Kit (LROC colour + LOLA elevation), public domain.
//
//   <Moon radius={100} rotationSpeed={0.004} />
//
// Props
//   radius          sphere radius in scene units (default 100)
//   rotationSpeed   radians per second around the polar axis (default 0, static). Pole axis is +Y; the
//                   south pole (-Y) is the bottom of the sphere. Longitude 0 faces +X, east longitude toward -Z.
//   quality         override the global quality tier ("low" | "medium" | "high")
//   relief          vertical exaggeration of the LOLA displacement (default 3, 0 disables displacement)
//   bump            strength of the shaded relief normal map (default 1)
//   ...group props  position, rotation, etc. go to the wrapper <group>; children rotate with the Moon
//                   and live in unit-sphere space (use moonPoint(lat, lon) to place markers).
//
// Needs a light in the scene (one hard directional "Sun"). Textures live in /textures/moon and are
// cached by drei, so every phase that reuses <Moon/> shares the same GPU textures.
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useQuality } from "../core/perf";

export const MOON_TEXTURES = {
  low: { color: "/textures/moon/color_2k.webp", normal: "/textures/moon/normal_2k.webp", segments: 64 },
  medium: { color: "/textures/moon/color_2k.webp", normal: "/textures/moon/normal_2k.webp", segments: 128 },
  high: { color: "/textures/moon/color_4k.webp", normal: "/textures/moon/normal_4k.webp", segments: 256 },
} as const;
const DISP = "/textures/moon/disp_1k.png";
const SPAN_KM = 20; // disp map spans -9..+11 km
const MOON_RADIUS_KM = 1737.4;

/** Point on the Moon's surface in the Moon's local frame, unit radius by default (lat/lon in degrees). */
export function moonPoint(lat: number, lon: number, radius = 1, out = new THREE.Vector3()) {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return out.set(Math.cos(lo) * Math.cos(la), Math.sin(la), -Math.sin(lo) * Math.cos(la)).multiplyScalar(radius);
}

export interface MoonProps extends Omit<React.ComponentProps<"group">, "ref"> {
  radius?: number;
  rotationSpeed?: number;
  quality?: "low" | "medium" | "high";
  relief?: number;
  bump?: number;
}

export function Moon({ radius = 100, rotationSpeed = 0, quality, relief = 3, bump = 1, children, ...group }: MoonProps) {
  const q = useQuality();
  const tier = quality ?? q.tier;
  const t = MOON_TEXTURES[tier];
  const spin = useRef<THREE.Group>(null);
  const [color, normal, disp] = useTexture([t.color, t.normal, DISP]);

  useLayoutEffect(() => {
    color.colorSpace = THREE.SRGBColorSpace;
    for (const tex of [color, normal, disp]) {
      tex.anisotropy = 8;
      tex.wrapS = THREE.RepeatWrapping;
      tex.needsUpdate = true;
    }
  }, [color, normal, disp]);

  const geo = useMemo(() => new THREE.SphereGeometry(1, t.segments, t.segments / 2), [t.segments]);
  useLayoutEffect(() => () => geo.dispose(), [geo]);

  const dispScale = relief > 0 ? (SPAN_KM / MOON_RADIUS_KM) * relief : 0;
  const bumpVec = useMemo(() => new THREE.Vector2(1, 1), []);
  bumpVec.set(bump, bump);

  useFrame((_, dt) => {
    if (rotationSpeed && spin.current) spin.current.rotation.y += rotationSpeed * Math.min(dt, 0.1);
  });

  return (
    <group {...group}>
      <group ref={spin} scale={radius}>
        <mesh geometry={geo} castShadow receiveShadow>
          <meshStandardMaterial
            map={color}
            normalMap={normal}
            normalScale={bumpVec}
            displacementMap={dispScale > 0 ? disp : null}
            displacementScale={dispScale}
            displacementBias={(-9 / SPAN_KM) * dispScale}
            roughness={0.96}
            metalness={0}
          />
        </mesh>
        {children}
      </group>
    </group>
  );
}

export const moonTexturePaths = (tier: keyof typeof MOON_TEXTURES = "high") => [
  MOON_TEXTURES[tier].color,
  MOON_TEXTURES[tier].normal,
  DISP,
];
