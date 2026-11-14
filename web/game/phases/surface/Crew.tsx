"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect */
// Other astronauts: remote players (interpolated 10 Hz `pos` stream) and, in solo, AI crewmates
// (one waits by the lander, others trail the player at a distance).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { onServerEvent } from "../../core/store";
import { useGame } from "../../core/useGame";
import type { Role } from "../../types";
import { Avatar, type AvatarPose } from "./Avatar";
import type { Ground } from "./ground";
import { Label } from "./Label";
import { ROLE_COLOR, rt } from "./store";

interface Remote {
  x: number;
  y: number;
  z: number;
  rotY: number;
  t: number;
}
const remotes = new Map<string, Remote>();

function NameTag({ name, role }: { name: string; role?: Role }) {
  return <Label text={name} color={ROLE_COLOR[role ?? "commander"]} position={[0, 2.3, 0]} scale={0.026} />;
}

function RemoteAstronaut({ id, name, role }: { id: string; name: string; role?: Role }) {
  const g = useRef<THREE.Group>(null);
  const cur = useRef({ x: 0, y: 0, z: 6, rotY: 0, init: false });
  const [pose, setPose] = useState<AvatarPose>("idle");
  const poseRef = useRef<AvatarPose>("idle");
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = remotes.get(id);
    const c = cur.current;
    if (t) {
      if (!c.init) {
        Object.assign(c, { x: t.x, y: t.y, z: t.z, rotY: t.rotY, init: true });
      }
      const k = 1 - Math.exp(-dt * 11);
      const ox = c.x;
      const oz = c.z;
      c.x += (t.x - c.x) * k;
      c.y += (t.y - c.y) * k;
      c.z += (t.z - c.z) * k;
      let d = t.rotY - c.rotY;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.rotY += d * k;
      const sp = Math.hypot(c.x - ox, c.z - oz) / Math.max(dt, 1e-3);
      const p: AvatarPose = sp > 0.4 ? "walk" : "idle";
      if (p !== poseRef.current) {
        poseRef.current = p;
        setPose(p);
      }
    }
    if (g.current) {
      g.current.position.set(c.x, c.y, c.z);
      g.current.rotation.y = c.rotY;
      g.current.visible = c.init;
    }
  });
  return (
    <group ref={g} visible={false}>
      <Avatar role={role ?? "commander"} pose={pose} />
      <NameTag name={name} role={role} />
    </group>
  );
}

const tmp = new THREE.Vector3();

function NpcAstronaut({ idx, role, ground }: { idx: number; role: Role; ground: Ground }) {
  const g = useRef<THREE.Group>(null);
  const [pose, setPose] = useState<AvatarPose>("idle");
  const poseRef = useRef<AvatarPose>("idle");
  const home = useMemo(() => (idx === 0 ? new THREE.Vector3(-5.5, 0, 6.5) : new THREE.Vector3(5.5, 0, 7.5)), [idx]);
  const cur = useRef({ x: home.x, z: home.z, rotY: 0.6, t: idx * 2 });
  const follower = idx >= 1;
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const c = cur.current;
    c.t += dt;
    let moving = false;
    if (!rt.exiting) {
      if (follower) {
        // trail the player at ~9 m, off to one side
        const side = idx === 1 ? 1 : -1;
        tmp.set(rt.pos.x - Math.sin(rt.rotY) * 9 + Math.cos(rt.rotY) * 3 * side, 0, rt.pos.z - Math.cos(rt.rotY) * 9 - Math.sin(rt.rotY) * 3 * side);
        const dx = tmp.x - c.x;
        const dz = tmp.z - c.z;
        const d = Math.hypot(dx, dz);
        const near = Math.hypot(rt.pos.x - c.x, rt.pos.z - c.z);
        if (d > 3 && near > 6) {
          const sp = Math.min(3.4, 1.2 + d * 0.25);
          c.x += (dx / d) * sp * dt;
          c.z += (dz / d) * sp * dt;
          c.rotY += (Math.atan2(dx, dz) - c.rotY) * Math.min(1, dt * 6);
          moving = true;
        } else {
          c.rotY += (Math.atan2(rt.pos.x - c.x, rt.pos.z - c.z) - c.rotY) * Math.min(1, dt * 2);
        }
      } else {
        c.rotY += (Math.atan2(rt.pos.x - c.x, rt.pos.z - c.z) - c.rotY) * Math.min(1, dt * 2);
      }
    }
    const wave = !follower && Math.sin(c.t * 0.35) > 0.93;
    const p: AvatarPose = moving ? "walk" : wave ? "wave" : "idle";
    if (p !== poseRef.current) {
      poseRef.current = p;
      setPose(p);
    }
    if (g.current) {
      g.current.position.set(c.x, ground.heightAt(c.x, c.z), c.z);
      g.current.rotation.y = c.rotY;
    }
  });
  return (
    <group ref={g}>
      <Avatar role={role} pose={pose} />
      <NameTag name={`AI ${role[0].toUpperCase()}${role.slice(1)}`} role={role} />
    </group>
  );
}

export function Crew({ ground }: { ground: Ground }) {
  const { state, me, plan } = useGame();
  useEffect(() => {
    remotes.clear();
    return onServerEvent((m) => {
      if (m.type === "pos") remotes.set(m.playerId, { x: m.x, y: m.y, z: m.z, rotY: m.rotY, t: performance.now() });
    });
  }, []);
  const others = (state?.players ?? []).filter((p) => p.id !== me?.id && p.connected);
  const npcRoles: Role[] =
    state?.mode === "solo"
      ? ((plan?.crew.roles ?? ["commander", "pilot", "engineer", "scientist"]) as Role[]).filter((r) => r !== (me?.role ?? plan?.crew.roles[0])).slice(0, 2)
      : [];
  return (
    <>
      {others.map((p) => (
        <RemoteAstronaut key={p.id} id={p.id} name={p.name} role={p.role} />
      ))}
      {npcRoles.map((r, i) => (
        <NpcAstronaut key={r} idx={i} role={r} ground={ground} />
      ))}
    </>
  );
}
