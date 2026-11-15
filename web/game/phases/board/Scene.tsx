"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity */
// Boarding cinematic (about 12 s): crew walk-out at dawn, elevator ride up the tower, last steps to
// the capsule, hatch closes. Skippable. Uses the real Astronaut rig and the shared launch pad.
import { Environment } from "@react-three/drei";
import { rolesOf } from "../../core/roles";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { sfx } from "../../core/audio";
import { useQuality } from "../../core/perf";
import { useGame } from "../../core/useGame";
import { ROLES, type Role } from "../../types";
import { Astronaut, type AstronautPose } from "../../three/Astronaut";
import { ACCESS_ARM_Y, LaunchPad, PAD_H, TOWER_X } from "../../three/ship/Pad";
import { Particles, type ParticlesApi } from "../../three/ship/fx";
import { Rocket } from "../../three/ship/Rocket";
import { BOARD_END, useBoardClock } from "./clock";
import { isRevealed } from "../../core/loading";

export const BOARD_HDRI = "/hdri/kiara_1_dawn_1k.hdr";
const RS = 0.9;
const WALK_Y = ACCESS_ARM_Y + 1.3;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sm = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const SUN = new THREE.Vector3(-0.75, 0.32, 0.5).normalize();
const T_ELEV0 = 4.5, T_ELEV1 = 9, T_HATCH = 10.2;
const PACE = 0.55;

export function BoardScene() {
  const q = useQuality();
  const { state, isHost, complete } = useGame();
  const { camera, scene } = useThree();
  const persp = camera as THREE.PerspectiveCamera;
  const n = Math.min(4, Math.max(2, state?.players.length ?? 2));
  const roles = useMemo<Role[]>(() => {
    const claimed = (state?.players ?? []).map((p) => p.role ?? rolesOf(p)[0]).filter(Boolean) as Role[];
    const rest = ROLES.filter((r) => !claimed.includes(r));
    return [...claimed, ...rest].slice(0, n);
  }, [state?.players, n]);

  const crew = useRef<(THREE.Group | null)[]>([]);
  const cage = useRef<THREE.Group>(null);
  const hatch = useRef<THREE.Group>(null);
  const steam = useRef<ParticlesApi>(null);
  const [pose, setPose] = useState<AstronautPose>("walk");
  const st = useMemo(() => ({ t: 0, stage: 0, done: false, tmp: new THREE.Vector3(), look: new THREE.Vector3(), foot: 0, clank: false, acc: 0 }), []);

  useEffect(() => {
    useBoardClock.getState().reset();
    const fov = persp.fov;
    persp.fov = 38;
    persp.updateProjectionMatrix();
    scene.fog = new THREE.Fog("#b9a28e", 900, 12000);
    const lt = process.env.NODE_ENV !== "production" ? Number(new URLSearchParams(location.search).get("bt")) : 0;
    if (lt > 0) st.t = lt;
    return () => {
      persp.fov = fov;
      persp.updateProjectionMatrix();
      scene.fog = null;
    };
  }, [persp, scene, st]);

  useFrame((s, rawDt) => {
    const store = useBoardClock.getState();
    const dt = Math.min(rawDt, 0.05);
    if (store.skipped && st.t < BOARD_END - 0.3) st.t = BOARD_END - 0.3;
    // the whole sequence runs at PACE (≈22 s instead of 12) so the walkout, elevator ride and ingress can breathe;
    // every mark below and in the HUD is on this clock, so they stay in step
    if (isRevealed("board")) st.t += dt * PACE; // starts when the scene is on screen
    const t = st.t;
    if (((t * 10) | 0) !== (((t - dt) * 10) | 0)) store.set(t);

    // stage / pose changes
    const stage = t < T_ELEV0 ? 0 : t < T_ELEV1 ? 1 : 2;
    if (stage !== st.stage) {
      st.stage = stage;
      setPose(stage === 1 ? "idle" : "walk");
      if (stage === 1) { sfx("clank", { volume: 0.5 }); sfx("rumble", { volume: 0.25 }); }
      if (stage === 2) sfx("click", { volume: 0.4 });
    }
    if (t > T_HATCH && !st.clank) { st.clank = true; sfx("thunk", { volume: 0.7 }); setTimeout(() => sfx("clank", { volume: 0.6 }), 700); }

    // crew + elevator
    const cageY = 0.2 + sm(T_ELEV0, T_ELEV1, t) * (WALK_Y - 0.2);
    const cx = TOWER_X - 5;
    if (cage.current) cage.current.position.set(cx, cageY, 0);
    for (let i = 0; i < n; i++) {
      const g = crew.current[i];
      if (!g) continue;
      const lag = i * 0.35;
      if (stage === 0) {
        // walk to the tower base along a gentle curve
        const k = clamp01((t - lag * 0.6) / (T_ELEV0 - 0.2));
        const x0 = 27 + i * 1.2, z0 = 36 + i * 1.6;
        const x1 = cx + (i - (n - 1) / 2) * 0.8, z1 = (i - (n - 1) / 2) * 0.8;
        g.position.set(x0 + (x1 - x0) * k, 0.1, z0 + (z1 - z0) * k);
        g.rotation.y = Math.atan2(x1 - x0, z1 - z0);
        g.visible = true;
      } else if (stage === 1) {
        g.position.set(cx + (i - (n - 1) / 2) * 0.8, cageY + 0.1, (i % 2 ? 0.5 : -0.5));
        g.rotation.y = -Math.PI / 2;
      } else {
        // along the access arm toward the hatch, entering one after another
        const k = clamp01((t - T_ELEV1 - i * 0.28) / 1.7);
        const x = 9.5 - k * 7.2;
        g.position.set(x, WALK_Y, (i - (n - 1) / 2) * 0.12);
        g.rotation.y = -Math.PI / 2;
        g.visible = k < 0.97;
      }
    }
    if (hatch.current) hatch.current.rotation.y = -1.9 * (1 - sm(T_HATCH, T_HATCH + 0.9, t));

    // steam from the vehicle (stage 0/1)
    if (t < T_ELEV1) {
      st.acc += dt * 8;
      while (st.acc >= 1) {
        st.acc -= 1;
        steam.current?.emit(1, { pos: [6 + Math.random(), PAD_H + 30 + Math.random() * 20, (Math.random() - 0.5) * 6], vel: [1.5, 0, 0], velJitter: [1, 0.6, 1], life: 4, size0: 1.5, size1: 9, color: [1, 1, 1] });
      }
    }

    // cameras
    if (stage === 0) {
      const k = clamp01(t / T_ELEV0);
      s.camera.position.set(47 - k * 3, 1.4, 24 - k * 3);
      const m = sm(2.6, T_ELEV0, t);
      st.look.set((27 + 6 * k) * (1 - m), 1.6 + m * 45, 36 * (1 - k) * (1 - m) + 2 * m);
      persp.fov = 40;
    } else if (stage === 1) {
      const k = clamp01((t - T_ELEV0) / (T_ELEV1 - T_ELEV0));
      s.camera.position.set(cx - 7.5 + k * 1.5, cageY + 1.9, 10.5 - k * 2);
      st.look.set(0, cageY + 4 + k * 2, 0);
      persp.fov = 44 - k * 6;
    } else {
      s.camera.position.set(14.5, WALK_Y + 1.8, 7);
      st.look.set(4.2, WALK_Y + 1.1, 0);
      persp.fov = 36;
    }
    s.camera.lookAt(st.look);
    persp.updateProjectionMatrix();

    if (t >= BOARD_END && !st.done) {
      st.done = true;
      if (isHost) complete("board", 100);
      else setTimeout(() => complete("board", 100), 4000);
    }
  });

  return (
    <>
      <Suspense fallback={null}>
        <Environment files={BOARD_HDRI} background backgroundBlurriness={0.01} environmentIntensity={0.55} backgroundIntensity={0.8} backgroundRotation={[0, 5.04, 0]} environmentRotation={[0, 5.04, 0]} />
      </Suspense>
      <directionalLight
        position={[SUN.x * 400, SUN.y * 400, SUN.z * 400]} intensity={4} color="#ffb98a" castShadow={q.shadows}
        shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]} shadow-camera-left={-140} shadow-camera-right={140} shadow-camera-top={140} shadow-camera-bottom={-30}
        shadow-camera-near={10} shadow-camera-far={900} shadow-bias={-0.0003} shadow-normalBias={0.4}
      />
      <ambientLight intensity={0.12} color="#ffd4b0" />
      <LaunchPad shadows={q.shadows} />
      <Rocket shadows={q.shadows} position={[0, PAD_H, 0]} scale={RS} />

      {/* crew */}
      {roles.map((r, i) => (
        <group key={r} ref={(g) => void (crew.current[i] = g)}>
          <Astronaut role={r} pose={pose} height={1.85} offset={i * 0.7} speed={PACE} />
        </group>
      ))}

      {/* elevator cage */}
      <group ref={cage}>
        <mesh position-y={-0.05} receiveShadow castShadow><boxGeometry args={[3.4, 0.2, 3.4]} /><meshStandardMaterial color="#6d7379" metalness={0.8} roughness={0.5} /></mesh>
        {[[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]].map(([x, z], i) => (
          <mesh key={i} position={[x, 1.4, z]} castShadow><boxGeometry args={[0.12, 2.8, 0.12]} /><meshStandardMaterial color="#8b9096" metalness={0.8} roughness={0.45} /></mesh>
        ))}
        <mesh position-y={2.85}><boxGeometry args={[3.4, 0.1, 3.4]} /><meshStandardMaterial color="#8b9096" metalness={0.8} roughness={0.45} /></mesh>
        <mesh position={[0, 1.0, 1.62]}><boxGeometry args={[3.2, 0.06, 0.06]} /><meshStandardMaterial color="#d6a21a" /></mesh>
        <pointLight position={[0, 2.6, 0]} intensity={60} color="#ffd9a8" distance={14} decay={2} />
      </group>

      {/* white room + hatch at the capsule */}
      <group position={[0, WALK_Y, 0]}>
        <mesh position={[4.0, -0.1, 0]} receiveShadow castShadow><boxGeometry args={[4.4, 0.2, 3.0]} /><meshStandardMaterial color="#d9dbdc" roughness={0.6} /></mesh>
        <mesh position={[4.0, 1.2, -1.5]} castShadow><boxGeometry args={[4.4, 2.6, 0.1]} /><meshStandardMaterial color="#eceeee" roughness={0.55} /></mesh>
        <mesh position={[4.0, 2.5, 0]}><boxGeometry args={[4.4, 0.1, 3.0]} /><meshStandardMaterial color="#eceeee" roughness={0.55} /></mesh>
        <pointLight position={[3.5, 2.2, 0]} intensity={26} color="#fff1dc" distance={9} decay={2} />
        {/* capsule hatch ring and door */}
        <mesh position={[1.05, 1.2, 0]} rotation-y={Math.PI / 2}><torusGeometry args={[0.6, 0.06, 10, 32]} /><meshStandardMaterial color="#b9bec3" metalness={0.9} roughness={0.35} /></mesh>
        <mesh position={[1.0, 1.2, 0]} rotation-y={Math.PI / 2}><circleGeometry args={[0.56, 28]} /><meshBasicMaterial color="#10161c" /></mesh>
        <group ref={hatch} position={[1.1, 1.2, -0.62]}>
          <mesh position={[0, 0, 0.62]} rotation-y={Math.PI / 2} castShadow><cylinderGeometry args={[0.6, 0.6, 0.08, 32]} /><meshStandardMaterial color="#e6e8e9" metalness={0.5} roughness={0.4} /></mesh>
        </group>
      </group>

      <Particles ref={steam} max={q.tier === "low" ? 60 : 140} drag={0.6} opacity={0.8} ambient={0.65} lightDir={[SUN.x, SUN.y + 0.4, SUN.z]} />
      <Effects bloom={0.4} ao={false} />
    </>
  );
}
