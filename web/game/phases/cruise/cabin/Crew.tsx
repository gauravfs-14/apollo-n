"use client";
 
// The other crew in the cabin: remote players (10 Hz `pos` stream) and, in solo, AI crewmates who do the helper jobs.
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { rolesOf } from "../../../core/roles";
import { onServerEvent } from "../../../core/store";
import { useGame } from "../../../core/useGame";
import { Astronaut, ROLE_COLOR } from "../../../three/Astronaut";
import type { Role } from "../../../types";
import { SHELTER_Z, SPOTS, at, frameOf } from "./layout";
import { H } from "./model";
import { helpJob } from "./objectives";
import { localPoint } from "../../../three/interior/mount";

const remotes = new Map<string, { x: number; y: number; z: number; rotY: number }>();

function NameTag({ name, color }: { name: string; color: string }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.font = "600 28px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.fillStyle = "rgba(8,10,14,0.7)";
    g.beginPath();
    g.roundRect(8, 8, 240, 48, 14);
    g.fill();
    g.fillStyle = color;
    g.fillText(name.slice(0, 14), 128, 43);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [name, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={[0, 1.1, 0]} scale={[0.5, 0.125, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

function Floater({ id, name, role, target }: { id: string; name: string; role: Role; target?: () => THREE.Vector3 | null }) {
  const g = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const cur = useRef(new THREE.Vector3(NaN, 0, 0));
  const yaw = useRef(0);
  const speed = useRef(0);
  useFrame((st, dt) => {
    if (!g.current) return;
    const want = target ? target() : null;
    let tx: number, ty: number, tz: number, ry: number;
    if (want) {
      tx = want.x;
      ty = want.y;
      tz = want.z;
      ry = yaw.current;
    } else {
      const r = remotes.get(id);
      if (!r) {
        g.current.visible = false;
        return;
      }
      tx = r.x;
      ty = r.y - 0.1;
      tz = r.z;
      ry = r.rotY;
    }
    g.current.visible = true;
    if (Number.isNaN(cur.current.x)) cur.current.set(tx, ty, tz);
    const k = 1 - Math.exp(-dt * (want ? 1.6 : 9));
    const px = cur.current.x;
    const pz = cur.current.z;
    cur.current.x += (tx - cur.current.x) * k;
    cur.current.y += (ty - cur.current.y) * k;
    cur.current.z += (tz - cur.current.z) * k;
    const v = Math.hypot(cur.current.x - px, cur.current.z - pz) / Math.max(dt, 1e-3);
    speed.current += (v - speed.current) * Math.min(1, dt * 5);
    if (want) {
      // face where it is heading, or toward the cabin centre line when parked
      const dx = tx - cur.current.x;
      const dz = tz - cur.current.z;
      if (Math.hypot(dx, dz) > 0.2) ry = Math.atan2(-dx, -dz) + Math.PI;
      yaw.current += Math.atan2(Math.sin(ry - yaw.current), Math.cos(ry - yaw.current)) * Math.min(1, dt * 3);
    } else yaw.current = ry + Math.PI; // the suit faces +Z; the camera yaw 0 looks toward -Z
    const t = st.clock.elapsedTime;
    g.current.position.set(cur.current.x, cur.current.y - 0.85 + Math.sin(t * 0.8 + id.length) * 0.03, cur.current.z);
    g.current.rotation.y = yaw.current;
    if (tilt.current) tilt.current.rotation.x = Math.min(0.9, speed.current * 0.5) + Math.sin(t * 0.6 + id.length) * 0.04;
  });
  return (
    <group ref={g} visible={false}>
      <group ref={tilt} position={[0, 0.85, 0]}>
        <group position={[0, -0.85, 0]}>
          <Suspense fallback={null}>
            <Astronaut role={role} pose="idle" height={1.7} />
          </Suspense>
        </group>
      </group>
      <NameTag name={name} color={ROLE_COLOR[role]} />
    </group>
  );
}

const IDLE: [number, number, number][] = [
  [-0.5, -0.1, 1.5],
  [0.8, 0.3, 4.4],
  [-0.9, -0.2, 5.6],
];

export function CabinCrew() {
  const { state, me, plan } = useGame();
  useEffect(() => {
    remotes.clear();
    return onServerEvent((m) => {
      if (m.type === "pos") remotes.set(m.playerId, { x: m.x, y: m.y, z: m.z, rotY: m.rotY });
    });
  }, []);
  const others = (state?.players ?? []).filter((p) => p.id !== me?.id && p.connected);
  const solo = state?.mode === "solo";
  const npcRoles: Role[] = solo
    ? ((plan?.crew.roles ?? ["commander", "pilot", "engineer", "scientist"]) as Role[]).filter((r) => r !== (me?.role ?? rolesOf(me)[0] ?? plan?.crew.roles[0])).slice(0, 3)
    : [];
  useEffect(() => {
    H.npcs = npcRoles.length;
  }, [npcRoles.length]);
  const tgt = useMemo(() => [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], []);
  const npcTarget = (i: number) => () => {
    const d = H.d;
    const idle = tgt[i].set(...IDLE[i]);
    if (H.stage !== "play" || !H.type) return idle;
    // storm: everyone moves into the shelter once the alert sounds
    if (H.type === "solar_storm" && d.step >= 1) {
      const f = Math.min(1, Math.max(0, (d.t - d.alarmT - 1.5 - i * 1.3) / 5));
      if (d.step === 1 && i === 0) return tgt[i].copy(at(SPOTS.wheelB, 0, 0, 0.9)); // NPC 0 turns the second valve wheel
      return idle.lerp(tgt[i].set((i - 1) * 0.7, -0.3 + i * 0.25, SHELTER_Z + 0.9 + i * 0.25), f);
    }
    // everything else: the first AI crewmate takes the helper job, and only once the actor needs it
    if (i === 0 && d.step >= 1) {
      const job = helpJob(H.type);
      if (job?.pos) return tgt[i].copy(job.pos).add(offsetToCentre(job.pos));
    }
    return idle;
  };
  return (
    <>
      {others.map((p) => (
        <Floater key={p.id} id={p.id} name={p.name} role={(p.role ?? rolesOf(p)[0] ?? "commander") as Role} />
      ))}
      {npcRoles.map((r, i) => (
        <Floater key={r} id={`npc-${r}`} name={`AI ${r[0].toUpperCase()}${r.slice(1)}`} role={r} target={npcTarget(i)} />
      ))}
    </>
  );
}

const _o = new THREE.Vector3();
function offsetToCentre(p: THREE.Vector3) {
  // stand 0.9 m in front of the panel (toward the bay axis)
  _o.set(-p.x, -p.y, 0).setLength(0.9);
  return _o;
}
void frameOf;
void localPoint;
