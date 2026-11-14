"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
// Astronaut for the surface: uses P3's skinned suit when its GLB has shipped, otherwise a
// primitive stand-in (same scale, same poses plus "climb"). Origin at the feet, faces +Z.
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Role } from "../../types";
import { Astronaut as SuitModel, ASTRONAUT_URL } from "../../three/Astronaut";
import { ROLE_COLOR } from "./store";

export type AvatarPose = "idle" | "walk" | "wave" | "climb";

let modelCheck: Promise<boolean> | null = null;
function modelAvailable() {
  modelCheck ??= fetch(ASTRONAUT_URL, { method: "HEAD" })
    .then((r) => r.ok && !(r.headers.get("content-type") ?? "").includes("text/html"))
    .catch(() => false);
  return modelCheck;
}

export function Avatar({ role = "commander", pose = "idle", speed = 1, ...rest }: { role?: Role; pose?: AvatarPose; speed?: number } & Omit<React.ComponentProps<"group">, "ref">) {
  const [real, setReal] = useState(false);
  useEffect(() => {
    let alive = true;
    modelAvailable().then((ok) => alive && setReal(ok));
    return () => {
      alive = false;
    };
  }, []);
  if (real)
    return (
      <Suspense fallback={<Simple role={role} pose={pose} speed={speed} {...rest} />}>
        <SuitModel role={role} pose={pose === "climb" ? "walk" : pose} speed={speed} {...rest} />
      </Suspense>
    );
  return <Simple role={role} pose={pose} speed={speed} {...rest} />;
}

function Simple({ role, pose, speed, ...rest }: { role: Role; pose: AvatarPose; speed: number } & Omit<React.ComponentProps<"group">, "ref">) {
  const parts = useMemo(() => {
    const white = new THREE.MeshStandardMaterial({ color: "#e4e2dc", roughness: 0.85 });
    const grey = new THREE.MeshStandardMaterial({ color: "#6b6d70", roughness: 0.9 });
    const gold = new THREE.MeshStandardMaterial({ color: "#d9b560", roughness: 0.18, metalness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: ROLE_COLOR[role] ?? "#ffb547", roughness: 0.6 });
    const torso = new THREE.CapsuleGeometry(0.23, 0.32, 4, 12);
    const limb = new THREE.CapsuleGeometry(0.095, 0.36, 4, 8);
    const leg = new THREE.CapsuleGeometry(0.105, 0.5, 4, 8);
    const head = new THREE.SphereGeometry(0.215, 20, 14);
    const visor = new THREE.SphereGeometry(0.2, 20, 14, -1.1, 2.2, 0.5, 1.7);
    const pack = new THREE.BoxGeometry(0.42, 0.58, 0.22);
    const stripe = new THREE.BoxGeometry(0.47, 0.07, 0.3);
    const boot = new THREE.BoxGeometry(0.17, 0.12, 0.3);
    return { white, grey, gold, accent, torso, limb, leg, head, visor, pack, stripe, boot };
  }, [role]);
  useEffect(() => () => Object.values(parts).forEach((p) => p.dispose()), [parts]);

  const hipL = useRef<THREE.Group>(null);
  const hipR = useRef<THREE.Group>(null);
  const shL = useRef<THREE.Group>(null);
  const shR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed;
    const s = Math.sin(t * 5.2);
    const walk = pose === "walk" ? 1 : 0;
    const climb = pose === "climb" ? 1 : 0;
    if (hipL.current && hipR.current && shL.current && shR.current && body.current) {
      const cl = Math.sin(t * 3.2);
      hipL.current.rotation.x = walk * 0.55 * s + climb * 0.7 * cl;
      hipR.current.rotation.x = -walk * 0.55 * s - climb * 0.7 * cl;
      shL.current.rotation.x = -walk * 0.45 * s - climb * 0.8 * cl - climb * 1.2;
      shR.current.rotation.x = walk * 0.45 * s + climb * 0.8 * cl - climb * 1.2;
      shL.current.rotation.z = 0.08;
      shR.current.rotation.z = pose === "wave" ? -2.4 - 0.3 * Math.sin(t * 7) : -0.08;
      body.current.rotation.x = walk * 0.06 + climb * 0.1;
    }
  });
  return (
    <group {...rest}>
      <group ref={body}>
        <mesh geometry={parts.torso} material={parts.white} position={[0, 1.12, 0]} castShadow receiveShadow />
        <mesh geometry={parts.stripe} material={parts.accent} position={[0, 1.2, 0.0]} castShadow />
        <mesh geometry={parts.pack} material={parts.white} position={[0, 1.2, -0.27]} castShadow receiveShadow />
        <mesh geometry={parts.head} material={parts.white} position={[0, 1.62, 0]} castShadow receiveShadow />
        <mesh geometry={parts.visor} material={parts.gold} position={[0, 1.62, 0.015]} rotation={[0, 0, 0]} castShadow />
        <group ref={shL} position={[0.3, 1.38, 0]}>
          <mesh geometry={parts.limb} material={parts.white} position={[0, -0.22, 0]} castShadow />
        </group>
        <group ref={shR} position={[-0.3, 1.38, 0]}>
          <mesh geometry={parts.limb} material={parts.white} position={[0, -0.22, 0]} castShadow />
        </group>
        <group ref={hipL} position={[0.11, 0.86, 0]}>
          <mesh geometry={parts.leg} material={parts.white} position={[0, -0.4, 0]} castShadow />
          <mesh geometry={parts.boot} material={parts.grey} position={[0, -0.8, 0.05]} castShadow />
        </group>
        <group ref={hipR} position={[-0.11, 0.86, 0]}>
          <mesh geometry={parts.leg} material={parts.white} position={[0, -0.4, 0]} castShadow />
          <mesh geometry={parts.boot} material={parts.grey} position={[0, -0.8, 0.05]} castShadow />
        </group>
      </group>
    </group>
  );
}
