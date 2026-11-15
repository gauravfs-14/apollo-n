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

// per hand: 4 fingers (index..pinky) of [mcp, pip, dip] bones, and the thumb [cmc, ip]
interface Fingers {
  f: THREE.Object3D[][];
  thumb: THREE.Object3D[];
}

interface Rig {
  hips: THREE.Object3D;
  spine: THREE.Object3D;
  head: THREE.Object3D;
  shL: THREE.Object3D;
  shR: THREE.Object3D;
  elL: THREE.Object3D;
  elR: THREE.Object3D;
  wrL: THREE.Object3D;
  wrR: THREE.Object3D;
  fingL: Fingers;
  fingR: Fingers;
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  hipsY: number;
}

const live = { n: 0 }; // mounted astronauts

// ---- arm posing ----
// The scan's arms reach forward-down (~45 deg) in the bind pose, and every bone has an identity rest rotation, so each limb
// segment's bind direction is a constant (left arm; the right arm mirrors x). An arm is posed by giving the world-ish
// direction (character space: x left, y up, z forward) of the upper arm, forearm and hand: shoulder, elbow and wrist
// rotations are the minimal rotations that take the bind direction to the target, plus a twist of the hand about its axis.
const BIND_U = new THREE.Vector3(0, -0.12, 0.15).normalize(); // shoulder -> elbow
const BIND_F = new THREE.Vector3(-0.015, -0.13, 0.17).normalize(); // elbow -> wrist
const BIND_H = new THREE.Vector3(-0.005, -0.12, 0.11).normalize(); // wrist -> fingertips
const bindR = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
const BIND = { L: { u: BIND_U, f: BIND_F, h: BIND_H }, R: { u: bindR(BIND_U), f: bindR(BIND_F), h: bindR(BIND_H) } };
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qT = new THREE.Quaternion();
const vA = new THREE.Vector3(), vB = new THREE.Vector3();
const hang = (out: THREE.Vector3, side: 1 | -1, fwd: number, abd: number) =>
  out.set(side * Math.sin(abd), -Math.cos(fwd) * Math.cos(abd), Math.sin(fwd) * Math.cos(abd)).normalize();
function poseArm(
  side: "L" | "R", sh: THREE.Object3D, el: THREE.Object3D, wr: THREE.Object3D,
  u: THREE.Vector3, f: THREE.Vector3, h: THREE.Vector3, twist: number,
) {
  const b = BIND[side];
  sh.quaternion.setFromUnitVectors(b.u, u);
  qA.copy(sh.quaternion).invert();
  el.quaternion.setFromUnitVectors(b.f, vA.copy(f).applyQuaternion(qA));
  qA.copy(sh.quaternion).multiply(el.quaternion).invert();
  qB.setFromUnitVectors(b.h, vB.copy(h).applyQuaternion(qA));
  wr.quaternion.copy(qB).multiply(qT.setFromAxisAngle(b.h, twist));
}
const dU = new THREE.Vector3(), dF = new THREE.Vector3(), dH = new THREE.Vector3();
const wU = new THREE.Vector3(), wF = new THREE.Vector3(), wH = new THREE.Vector3();
// ---- finger posing ----
// Finger bones have identity bind rotations (children of the wrist), so their axes are the hand-frame axes of the bind pose:
// B across the palm toward the little finger, C = F x B (the palm faces -C). Positive rotation about B curls a finger toward the palm,
// positive rotation about C swings it toward the little finger. The right hand uses the same angles about the mirrored axes (-M v).
const HF_F = new THREE.Vector3(-0.0699, -0.606, 0.7924).normalize();
const HF_B = new THREE.Vector3(1, 0, 0).addScaledVector(HF_F, -HF_F.x).normalize();
const HF_C = new THREE.Vector3().crossVectors(HF_F, HF_B);
const mirrorAxis = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.y, -v.z);
const AX = { L: { b: HF_B, c: HF_C }, R: { b: mirrorAxis(HF_B), c: mirrorAxis(HF_C) } };
// relaxed glove: a loose half-fist, the outer fingers curl a little more than the index
const REST_CURL = [[0.3, 0.6, 0.4], [0.42, 0.7, 0.45], [0.52, 0.8, 0.5], [0.62, 0.85, 0.5]];
// waving: fingers together and only softly curved
const WAVE_CURL = [[0.02, 0.05, 0.04], [0.02, 0.06, 0.05], [0.03, 0.07, 0.05], [0.04, 0.08, 0.06]]; // open hand, fingers almost straight
// swing each finger about C so the four sit side by side (the little finger flares ~30 deg in the scan)
const FINGER_SWING = [0.02, 0, -0.04, -0.5];
const qG = new THREE.Quaternion();
function poseHand(side: "L" | "R", h: Fingers, wave: number, t: number, grip: number) {
  const ax = AX[side];
  for (let i = 0; i < 4; i++) {
    const rest = REST_CURL[i], wv = WAVE_CURL[i];
    const live = 0.03 * Math.sin(t * 1.3 + i * 0.9 + (side === "L" ? 0 : 2)) * (1 - wave); // a little life in the idle hand
    for (let j = 0; j < 3; j++) {
      const a = (rest[j] * (1 - wave) + wv[j] * wave) * (1 + 0.25 * grip) + live;
      h.f[i][j].quaternion.setFromAxisAngle(ax.b, a);
      if (j === 0) h.f[i][0].quaternion.premultiply(qG.setFromAxisAngle(ax.c, FINGER_SWING[i] * (1 - 0.3 * wave)));
    }
  }
  // thumb: tucked in alongside the index finger (swung toward the fingers, bent toward the palm), a little looser when waving
  const tk = 1 - 0.5 * wave;
  h.thumb[0].quaternion.setFromAxisAngle(ax.b, 0.5 * tk);
  h.thumb[0].quaternion.premultiply(qG.setFromAxisAngle(ax.c, 0.75 * tk));
  h.thumb[1].quaternion.setFromAxisAngle(ax.b, 0.45 * tk + 0.1 * grip);
}
const MODEL_HEIGHT = 1.93;
const WAVE_TWIST = 1.57; // palm out, toward whoever is being waved at
const HANG_TWIST = 1.5; // palms toward the thighs (left arm -, right arm +)
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
    const hand = (sd: string): Fingers => ({
      f: ["index", "middle", "ring", "pinky"].map((n) => [0, 1, 2].map((j) => get(`${n}${sd}${j}`))),
      thumb: [0, 1].map((j) => get(`thumb${sd}${j}`)),
    });
    const rig: Rig = {
      hips: get("hips"), spine: get("spine"), head: get("head"),
      shL: get("shoulderL"), shR: get("shoulderR"), elL: get("elbowL"), elR: get("elbowR"), wrL: get("wristL"), wrR: get("wristR"),
      fingL: hand("L"), fingR: hand("R"),
      hipL: get("hipL"), hipR: get("hipR"), kneeL: get("kneeL"), kneeR: get("kneeR"),
      hipsY: get("hips").position.y,
    };
    return { root, rig, owned, accentColor };
  }, [gltf.scene, mask]);

  useEffect(() => {
    accentColor.value.set(color);
  }, [accentColor, color]);
  useEffect(() => () => owned.forEach((o) => o.dispose()), [owned]);
  // the GLB and its textures are shared by every astronaut and cached by drei: when the last one unmounts, free the GPU copies
  useEffect(() => {
    live.n++;
    return () => {
      if (--live.n > 0) return;
      gltf.scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat) for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      });
      mask.dispose();
    };
  }, [gltf, mask]);

  // pose blend weights (smoothed so switching poses never pops)
  const w = useRef({ idle: 1, walk: 0, wave: 0 });
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime * speed + offset;
    const k = 1 - Math.exp(-dt * 6);
    const cur = w.current;
    // "wave" stands relaxed with both arms down: the bulky glove never read as a real wave
    const p = pose === "wave" ? "idle" : pose;
    cur.idle += ((p === "idle" ? 1 : 0) - cur.idle) * k;
    cur.walk += ((p === "walk" ? 1 : 0) - cur.walk) * k;
    cur.wave += (0 - cur.wave) * k;

    const breathe = Math.sin(t * 1.6);
    const s = Math.sin(t * 4.6); // walk cycle
    const c = Math.cos(t * 4.6);
    const { hips, spine, head, shL, shR, elL, elR, wrL, wrR, hipL, hipR, kneeL, kneeR } = rig;

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
    // arms: relaxed down at rest (slightly forward, elbow soft, palm toward the thigh), counter-swing on walk;
    // the right arm blends to a wave: upper arm out to about shoulder height, forearm upright, palm forward,
    // a gentle sway from the elbow with the wrist following
    const sw = Math.sin(t * 6.5), swW = Math.sin(t * 6.5 - 0.6);
    const sL = cur.walk * 0.4 * s, sR = -sL, br = cur.idle * 0.01 * breathe;
    hang(dU, 1, 0.1 + sL, 0.1 + br); hang(dF, 1, 0.3 + sL * 1.3 + cur.walk * 0.25, 0.1); hang(dH, 1, 0.34 + sL * 1.3 + cur.walk * 0.25, 0.04);
    poseArm("L", shL, elL, wrL, dU, dF, dH, -HANG_TWIST);
    hang(dU, -1, 0.1 + sR, 0.1 - br); hang(dF, -1, 0.3 + sR * 1.3 + cur.walk * 0.25, 0.1); hang(dH, -1, 0.34 + sR * 1.3 + cur.walk * 0.25, 0.04);
    const k2 = cur.wave;
    if (k2 > 0.001) {
      wU.set(-1, -0.85, 0.3).normalize();
      wF.set(-0.2 - 0.38 * sw, 1, 0.12).normalize();
      wH.set(-0.2 - 0.38 * sw - 0.3 * swW, 1, -0.12).normalize(); // wrist tipped back a little so the open palm faces out
      dU.lerp(wU, k2).normalize(); dF.lerp(wF, k2).normalize(); dH.lerp(wH, k2).normalize();
    }
    poseArm("R", shR, elR, wrR, dU, dF, dH, HANG_TWIST * (1 - k2) + WAVE_TWIST * k2);
    poseHand("L", rig.fingL, 0, t, cur.walk);
    poseHand("R", rig.fingR, k2, t, cur.walk);
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
