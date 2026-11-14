"use client";
/* eslint-disable react-hooks/immutability -- three.js objects/uniforms are mutated by design */
// Realistic NASA Z-2 spacesuit astronaut (public-domain NASA 3D Resources model, 30k tris, skinned, 2K PBR textures).
// Props:
//   role      "commander" | "pilot" | "engineer" | "scientist"  -> accent colour (amber / cyan / green / white)
//   accent    optional CSS colour overriding the role accent
//   pose      "idle" | "walk" | "wave"   procedural motion on the skeleton (hips, spine, head, shoulders, elbows, hips, knees)
//   speed     animation speed multiplier (default 1)
//   height    standing height in metres (default 1.8; model is ~1.93 m with helmet)
//   offset    time offset in seconds so a line of astronauts does not move in sync
//   position / rotation / scale / name / onClick / onPointerOver ... forwarded to the outer <group>
// The mesh geometry and textures are shared between all instances; only the material (one per instance, for the accent tint) is cloned.
// Units: 1 unit = 1 m, origin at the feet, the suit faces +Z.
import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Role } from "../types";

export type AstronautPose = "idle" | "walk" | "wave";

export const ROLE_COLOR: Record<Role, string> = {
  commander: "#ffb547",
  pilot: "#6fd3ff",
  engineer: "#4ade80",
  scientist: "#f1f5f9",
};

export const ASTRONAUT_URL = "/models/crew/astronaut.glb";

type GroupProps = Omit<React.ComponentProps<"group">, "ref">;
export interface AstronautProps extends GroupProps {
  role?: Role;
  accent?: string;
  pose?: AstronautPose;
  speed?: number;
  height?: number;
  offset?: number;
}

interface Rig {
  hips: THREE.Object3D;
  spine: THREE.Object3D;
  head: THREE.Object3D;
  shL: THREE.Object3D;
  shR: THREE.Object3D;
  elL: THREE.Object3D;
  elR: THREE.Object3D;
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  hipsY: number;
}

const MODEL_HEIGHT = 1.93;
const MASK_URL = "/models/crew/accent_mask.webp";

export function Astronaut({ role = "commander", accent, pose = "idle", speed = 1, height = 1.8, offset = 0, ...group }: AstronautProps) {
  const gltf = useGLTF(ASTRONAUT_URL);
  const mask = useTexture(MASK_URL);
  const color = accent ?? ROLE_COLOR[role];

  const { root, rig, owned, accentColor } = useMemo(() => {
    const root = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
    const get = (n: string) => root.getObjectByName(n)!;
    mask.flipY = false; // glTF UV convention
    mask.colorSpace = THREE.NoColorSpace;
    const accentColor = { value: new THREE.Color() };
    const owned: { dispose: () => void }[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds are bind-pose only
      // one material per astronaut (textures stay shared) so each can tint its own trim
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.envMapIntensity = 1;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.accentMask = { value: mask };
        sh.uniforms.accentColor = accentColor;
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform sampler2D accentMask;\nuniform vec3 accentColor;")
          .replace(
            "#include <map_fragment>",
            "#include <map_fragment>\n float am = texture2D(accentMask, vMapUv).r;\n diffuseColor.rgb = mix(diffuseColor.rgb, accentColor * (0.55 + 0.45 * dot(diffuseColor.rgb, vec3(0.3333))), am);",
          );
      };
      mat.customProgramCacheKey = () => "suit-accent";
      m.material = mat;
      owned.push(mat);
    });
    const rig: Rig = {
      hips: get("hips"), spine: get("spine"), head: get("head"),
      shL: get("shoulderL"), shR: get("shoulderR"), elL: get("elbowL"), elR: get("elbowR"),
      hipL: get("hipL"), hipR: get("hipR"), kneeL: get("kneeL"), kneeR: get("kneeR"),
      hipsY: get("hips").position.y,
    };
    return { root, rig, owned, accentColor };
  }, [gltf.scene, mask]);

  useEffect(() => {
    accentColor.value.set(color);
  }, [accentColor, color]);
  useEffect(() => () => owned.forEach((o) => o.dispose()), [owned]);

  // pose blend weights (smoothed so switching poses never pops)
  const w = useRef({ idle: 1, walk: 0, wave: 0 });
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime * speed + offset;
    const k = 1 - Math.exp(-dt * 6);
    const cur = w.current;
    cur.idle += ((pose === "idle" ? 1 : 0) - cur.idle) * k;
    cur.walk += ((pose === "walk" ? 1 : 0) - cur.walk) * k;
    cur.wave += ((pose === "wave" ? 1 : 0) - cur.wave) * k;

    const breathe = Math.sin(t * 1.6);
    const s = Math.sin(t * 4.6); // walk cycle
    const c = Math.cos(t * 4.6);
    const wv = Math.sin(t * 7.5);
    const { hips, spine, head, shL, shR, elL, elR, hipL, hipR, kneeL, kneeR } = rig;

    hips.position.y = rig.hipsY + cur.walk * 0.03 * Math.abs(c) + cur.idle * 0.003 * breathe;
    hips.rotation.y = cur.walk * 0.07 * s;
    hips.rotation.z = cur.walk * 0.03 * s + cur.idle * 0.01 * Math.sin(t * 0.8);
    spine.rotation.x = cur.walk * 0.05 + cur.idle * 0.01 * breathe;
    spine.rotation.y = -cur.walk * 0.1 * s + cur.wave * 0.12;
    head.rotation.y = cur.idle * 0.22 * Math.sin(t * 0.45) + cur.wave * 0.2 * Math.sin(t * 0.9);
    head.rotation.x = cur.idle * 0.03 * Math.sin(t * 0.7 + 1);

    hipL.rotation.x = cur.walk * 0.45 * s;
    hipR.rotation.x = -cur.walk * 0.45 * s;
    kneeL.rotation.x = cur.walk * 0.6 * Math.max(0, -c);
    kneeR.rotation.x = cur.walk * 0.6 * Math.max(0, c);
    // arms: down at rest, counter-swing on walk, right arm raised + waving on wave
    shL.rotation.x = -cur.walk * 0.4 * s;
    shL.rotation.z = cur.idle * 0.015 * breathe;
    elL.rotation.x = -cur.walk * 0.25 - cur.idle * 0.06;
    shR.rotation.x = cur.walk * 0.4 * s;
    shR.rotation.z = -cur.idle * 0.015 * breathe - cur.wave * 2.35;
    elR.rotation.x = cur.walk * 0.25 * 0 - cur.idle * 0.06;
    elR.rotation.z = -cur.wave * (0.35 + 0.45 * wv);
  });

  return (
    <group {...group}>
      <group scale={height / MODEL_HEIGHT}>
        <primitive object={root} />
      </group>
    </group>
  );
}

useGLTF.preload(ASTRONAUT_URL);
useTexture.preload(MASK_URL);
