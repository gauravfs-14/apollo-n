"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity */
// The money shot. Timeline in clock.ts:
//   0-8 s    pad at dawn, countdown, venting steam
//   8 s      ignition: plume + billowing exhaust smoke
//   11 s     liftoff, camera shake, tower cleared, gravity turn
//   24 s     cut to space: Earth curve + atmosphere, staging at 30 s and 36 s
//   36-44 s  translunar injection burn with the Moon ahead
import { Environment } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { sfx, stopSfx } from "../../core/audio";
import { clearComms, runCues } from "../../core/comms";
import { launchCues } from "../../data/missionComms";
import { useQuality } from "../../core/perf";
import { useGame } from "../../core/useGame";
import { Earth } from "../../three/Earth";
import { Moon } from "../../three/Moon";
import { Starfield } from "../../three/Starfield";
import { LaunchPad, PAD_H } from "../../three/ship/Pad";
import { Particles, type EmitSpec, type ParticlesApi } from "../../three/ship/fx";
import { Plume } from "../../three/ship/Plume";
import { Rocket, S1_ENGINES, type RocketRefs } from "../../three/ship/Rocket";
import { T, useLaunchClock } from "./clock";
import { isRevealed } from "../../core/loading";
import { traceEvent } from "../../core/comms";

export const LAUNCH_HDRI = "/hdri/kiara_1_dawn_1k.hdr";
const RS = 0.9; // rocket scale
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sm = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const SUN = new THREE.Vector3(-0.75, 0.32, 0.5).normalize();
const SPACE_SUN: [number, number, number] = [-0.5, 0.5, 0.7]; // behind-left of the camera so the Moon ahead shows a lit gibbous face and the Earth below its day side

/** Altitude above the pad (m) t seconds after liftoff. */
const altitude = (tp: number) => (tp <= 0 ? 0 : 0.5 * 3.2 * tp * tp + 0.045 * tp * tp * tp);

function useRng() {
  return useMemo(() => ({ v: 1234567 }), []);
}

export function LaunchScene() {
  const q = useQuality();
  const { plan, isHost, complete } = useGame();
  const { camera, scene } = useThree();
  const persp = camera as THREE.PerspectiveCamera;
  const [space, setSpace] = useState(false);
  const rocket = useRef<RocketRefs>(null);
  const smoke = useRef<ParticlesApi>(null);
  const fire = useRef<ParticlesApi>(null);
  const flame = useRef(0);
  const flame2 = useRef(0);
  const flame3 = useRef(0);
  const light = useRef<THREE.PointLight>(null);
  const flash = useRef<THREE.Sprite>(null);
  const glowAt = useRef(new THREE.Vector3(0, PAD_H, 0));
  const cues = useMemo(() => launchCues(T.liftoff), []);
  const fired = useRef(new Set<number>());
  const rng = useRng();

  const st = useMemo(() => ({
    t: 0, done: false, spoke: false, ign: false, roar: false, rumble: false, sep1: false, sep2: false, cut: false,
    lastBeep: -1, acc: 0, acc2: 0, steam: 0, lastPush: 0, completed: false, s1v: new THREE.Vector3(), s1p: new THREE.Vector3(),
    s2p: new THREE.Vector3(), s2v: new THREE.Vector3(), s1spin: 0, s2spin: 0, camLook: new THREE.Vector3(0, 60, 0), tmp: new THREE.Vector3(), tmp2: new THREE.Vector3(),
  }), []);
  const spec = useMemo<EmitSpec>(() => ({ pos: [0, 0, 0], posJitter: [0, 0, 0], vel: [0, 0, 0], velJitter: [0, 0, 0], life: 1, size0: 1, size1: 1 }), []);

  // the pad haze must not wash out the Moon and Earth (thousands of metres away) once we are in space
  useEffect(() => {
    if (space) scene.fog = null;
  }, [space, scene]);

  // camera setup / restore (the Canvas camera is shared by all phases)
  useEffect(() => {
    const fov = persp.fov;
    useLaunchClock.getState().reset();
    // dev only: ?lt=<seconds> starts the cinematic at that time (for screenshots)
    const lt = process.env.NODE_ENV !== "production" ? Number(new URLSearchParams(location.search).get("lt")) : 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lt > 0) { st.t = lt; if (lt >= T.spaceCut) setSpace(true); st.cut = lt >= T.spaceCut; st.spoke = st.ign = st.roar = st.rumble = true; st.sep1 = lt >= T.sep1; st.sep2 = lt >= T.sep2; }
    persp.fov = 32;
    persp.updateProjectionMatrix();
    scene.fog = new THREE.Fog("#b9a28e", 1400, 14000);
    return () => {
      persp.fov = fov;
      persp.updateProjectionMatrix();
      scene.fog = null;
      stopSfx();
    };
  }, [persp, scene, st]);

  const maxP = q.tier === "high" ? 900 : q.tier === "medium" ? 560 : 260;
  const rate = q.tier === "high" ? 1 : q.tier === "medium" ? 0.7 : 0.4;

  const E = (n: number, s: EmitSpec) => smoke.current?.emit(n, s);
  const R = () => { rng.v = (Math.imul(rng.v, 1664525) + 1013904223) >>> 0; return rng.v / 4294967296; };

  useFrame((state, rawDt) => {
    const store = useLaunchClock.getState();
    const dt = Math.min(rawDt, 0.05);
    if (store.skipped && st.t < T.end - 0.2) st.t = T.end - 0.2;
    if (isRevealed("launch") || store.skipped) st.t += dt; // the clock starts when the scene is on screen
    const t = st.t;
    if (((t * 10) | 0) !== ((t - dt) * 10 | 0)) store.set(t);
    const tp = t - T.liftoff;
    const alt = altitude(tp);
    const rk = rocket.current;
    if (!rk) return;

    // ---- audio / voice cues: the real countdown and ascent calls ----
    if (store.skipped) {
      if (!st.spoke) { st.spoke = true; clearComms(); }
    } else runCues(cues, t, fired.current);
    if (!st.ign && t > T.ignition) { st.ign = true; sfx("ignition", { volume: 0.7 }); traceEvent("engines ignite"); }
    if (!st.roar && t > T.liftoff - 0.5) { st.roar = true; sfx("rocket_roar", { volume: 0.75 }); }
    if (!st.rumble && t > T.liftoff) { st.rumble = true; traceEvent("liftoff (rocket leaves the pad)"); } // one recorded roar, no stacked layers

    // ---- mode cut ----
    if (!st.cut && t >= T.spaceCut) { st.cut = true; setSpace(true); }

    // ---- flames ----
    const ign = clamp01((t - T.ignition) / 2.5);
    flame.current = t < T.spaceCut ? ign * (0.92 + Math.random() * 0.08) : 0;
    flame2.current = 0;
    flame3.current = 0;

    if (!space && t < T.spaceCut + 0.05) {
      // ---------------- PAD MODE ----------------
      const y = PAD_H + alt;
      const pitch = tp > 6 ? Math.min(0.5, 0.0045 * (tp - 6) * (tp - 6)) : 0;
      const sway = t > T.ignition && tp < 0 ? Math.sin(t * 38) * 0.0009 * (t - T.ignition) : 0;
      rk.root.position.set(Math.sin(pitch) * alt * 0.25, y, 0);
      rk.root.rotation.set(0, 0, -pitch + sway);
      rk.root.scale.setScalar(RS);
      rk.s1.visible = rk.s2.visible = rk.s3.visible = rk.les.visible = true;
      rk.s1.position.set(0, 0, 0);
      glowAt.current.set(rk.root.position.x, Math.max(2, y - 2), 0);
      if (light.current) {
        light.current.position.set(rk.root.position.x, Math.max(6, y + 4), 6);
        light.current.intensity = ign * (140000 + Math.random() * 20000) * (tp > 0 ? Math.max(0.35, 1 - tp * 0.04) : 1);
      }

      // smoke: exhaust through the trench, rolling outwards
      const onPad = tp < 7;
      if (t > T.ignition + 0.5) {
        st.acc += dt * (onPad ? 90 : 25) * rate * ign;
        while (st.acc >= 1) {
          st.acc -= 1;
          const side = R() < 0.5 ? -1 : 1;
          const axis = R() < 0.5;
          spec.pos[0] = side * (axis ? 10 + R() * 14 : 0) + (axis ? 0 : (R() - 0.5) * 20);
          spec.pos[1] = onPad ? 2.5 + R() * 6 : y - 8;
          spec.pos[2] = side * (axis ? 0 : 10 + R() * 14) + (axis ? (R() - 0.5) * 20 : 0);
          const spd = onPad ? 28 + R() * 30 : 6 + R() * 8;
          spec.vel![0] = axis ? side * spd : (R() - 0.5) * 20;
          spec.vel![1] = onPad ? 3 + R() * 9 : -4 + R() * 6;
          spec.vel![2] = axis ? (R() - 0.5) * 20 : side * spd;
          spec.velJitter![0] = spec.velJitter![1] = spec.velJitter![2] = 3;
          spec.posJitter![0] = spec.posJitter![1] = spec.posJitter![2] = 2;
          spec.life = onPad ? 9 : 7;
          spec.size0 = onPad ? 14 : 8;
          spec.size1 = onPad ? 75 : 46;
          spec.glow = 0.55;
          spec.color = [0.9, 0.86, 0.8];
          E(1, spec);
        }
        // vertical billow under the rocket
        if (onPad) {
          st.acc2 += dt * 40 * rate * ign;
          while (st.acc2 >= 1) {
            st.acc2 -= 1;
            spec.pos[0] = (R() - 0.5) * 18; spec.pos[1] = 6 + R() * 6; spec.pos[2] = (R() - 0.5) * 18;
            spec.vel![0] = (R() - 0.5) * 26; spec.vel![1] = 8 + R() * 22; spec.vel![2] = (R() - 0.5) * 26;
            spec.velJitter![0] = spec.velJitter![1] = spec.velJitter![2] = 2;
            spec.posJitter![0] = spec.posJitter![1] = spec.posJitter![2] = 1;
            spec.life = 8; spec.size0 = 12; spec.size1 = 60; spec.glow = 0.9; spec.color = [0.95, 0.9, 0.85];
            E(1, spec);
          }
        }
      }
      // pre-ignition steam venting from the tank
      if (t < T.ignition + 1) {
        st.steam += dt * 14 * rate;
        while (st.steam >= 1) {
          st.steam -= 1;
          spec.pos[0] = 6 + R() * 1; spec.pos[1] = PAD_H + 38 + R() * 20; spec.pos[2] = (R() - 0.5) * 6;
          spec.vel![0] = 1 + R() * 2.5; spec.vel![1] = -0.5 + R() * 1.4; spec.vel![2] = (R() - 0.5) * 2;
          spec.velJitter![0] = spec.velJitter![1] = spec.velJitter![2] = 0.4;
          spec.posJitter![0] = spec.posJitter![1] = spec.posJitter![2] = 0.4;
          spec.life = 4; spec.size0 = 1.5; spec.size1 = 9; spec.glow = 0; spec.color = [1, 1, 1];
          E(1, spec);
        }
      }

      // ---- camera ----
      const driftK = clamp01(t / T.liftoff);
      const camX = -260 + driftK * 45, camZ = 340 - driftK * 40;
      const camY = 5 + sm(T.liftoff, T.spaceCut, t) * 40;
      state.camera.position.set(camX, camY, camZ);
      st.tmp.set(Math.sin(pitch) * alt * 0.25 * 0.5, Math.max(58, y + 25 + tp * 2), 0);
      st.camLook.lerp(st.tmp, 1 - Math.exp(-dt * (tp > 0 ? 1.8 : 4)));
      state.camera.lookAt(st.camLook);
      // shake: ramps with ignition, peaks at liftoff
      const amp = (sm(T.ignition, T.liftoff, t) * 0.12 + (tp > 0 ? Math.max(0, 0.5 - tp * 0.04) : 0)) * (t < T.spaceCut ? 1 : 0);
      if (amp > 0) {
        const n1 = Math.sin(t * 61.7) + Math.sin(t * 37.1 + 1.3) * 0.7, n2 = Math.sin(t * 53.3 + 2.1) + Math.sin(t * 29.9) * 0.6;
        state.camera.position.x += n1 * amp; state.camera.position.y += n2 * amp * 0.8;
        state.camera.rotation.z += n1 * amp * 0.004;
        state.camera.rotation.x += n2 * amp * 0.002;
      }
      persp.fov = 32 + sm(T.liftoff + 2, T.spaceCut, t) * 8;
      persp.updateProjectionMatrix();
    } else {
      // ---------------- SPACE MODE ----------------
      const ts = t - T.spaceCut;
      const s1 = t >= T.sep1, s2 = t >= T.sep2;
      if (!st.sep1 && s1) {
        st.sep1 = true; sfx("staging", { volume: 0.6 }); traceEvent("first stage separates");
        st.s1p.set(0, 0, 0); st.s1v.set(-9, 0.6, 1.8);
        for (let i = 0; i < 40 * rate; i++) {
          fire.current?.emit(1, { pos: [0, 52 * RS, 0], posJitter: [4, 3, 4], vel: [(R() - 0.5) * 30, (R() - 0.5) * 30, (R() - 0.5) * 30], life: 0.9, size0: 4, size1: 22, color: [1, 0.85, 0.6], glow: 1 });
        }
      }
      if (!st.sep2 && s2) {
        st.sep2 = true; sfx("staging", { volume: 0.5 }); traceEvent("second stage separates");
        st.s2p.set(0, 0, 0); st.s2v.set(-6, -0.5, -1.4);
        for (let i = 0; i < 24 * rate; i++) {
          fire.current?.emit(1, { pos: [0, 78 * RS, 0], posJitter: [3, 2, 3], vel: [(R() - 0.5) * 20, (R() - 0.5) * 20, (R() - 0.5) * 20], life: 0.8, size0: 3, size1: 14, color: [1, 0.9, 0.7], glow: 1 });
        }
      }
      // rocket: heading +X, slight nose-down pitch with Earth curve
      const head = -Math.PI / 2 + 0.18;
      rk.root.position.set(ts * 30, 0, 0);
      rk.root.rotation.set(0, 0, head);
      rk.root.scale.setScalar(RS);
      rk.les.visible = ts < 1.2;
      if (rk.les.visible) rk.les.position.set(0, ts * 6, 0); else rk.les.position.set(0, 0, 0);
      // separated stages drift away (local frame): -Y is 'back' along the flight axis
      rk.s1.visible = t < T.sep1 + 6;
      rk.s2.visible = t < T.sep2 + 6;
      if (s1) {
        const k = t - T.sep1;
        rk.s1.position.set(st.s1v.x * k * 0.5 + Math.sin(k * 0.5) * 2, -k * k * 4.5 - k * 6, st.s1v.z * k);
        rk.s1.rotation.set(k * 0.12, 0, k * 0.07);
      }
      if (s2) {
        const k = t - T.sep2;
        rk.s2.position.set(st.s2v.x * k * 0.5, -k * k * 3.5 - k * 5, st.s2v.z * k);
        rk.s2.rotation.set(k * 0.09, 0, -k * 0.05);
      }
      // engines: S-II burns between separations, S-IVB burns after
      flame.current = t < T.sep1 ? (0.9 + Math.random() * 0.1) : 0;
      flame2.current = t >= T.sep1 + 0.8 && !s2 ? clamp01((t - T.sep1 - 0.8) / 1.0) * (0.9 + Math.random() * 0.1) : 0;
      flame3.current = s2 ? clamp01((t - T.sep2 - 0.6) / 1.2) * (0.92 + Math.random() * 0.08) : 0;
      if (light.current) {
        light.current.intensity = 0;
      }
      // fire sparks off the burning engine (thin, additive)
      if ((flame2.current > 0.2 || flame3.current > 0.2) && t - st.lastPush > 0.05) {
        st.lastPush = t;
        const by = (flame3.current > 0.2 ? 78.4 : 52) * RS;
        fire.current?.emit(2, { pos: [Math.sin(head) * -by * 0 + 0, by, 0], posJitter: [0.8, 0, 0.8], vel: [0, -22, 0], velJitter: [4, 6, 4], life: 0.7, size0: 1.2, size1: 3.5, color: [1, 0.75, 0.45], glow: 1 });
      }
      // flight-path camera: orbit around the stack, then swing to look at the Moon
      const p = rk.root.position;
      const centreY = flame3.current > 0 || s2 ? 90 * RS : 60 * RS;
      st.tmp2.set(0, centreY, 0).applyAxisAngle(AXIS_Z, head).add(p);
      const orbit = sm(T.sep2, T.end, t);
      const ang = -0.9 + Math.sin(ts * 0.18) * 0.12 + orbit * 1.55;
      const dist = 150 - sm(T.sep1 - 2, T.sep1 + 2, t) * 10 - orbit * 25;
      state.camera.position.set(p.x - 30 + Math.sin(ang) * dist, 25 + orbit * 30, Math.cos(ang) * dist);
      state.camera.lookAt(st.tmp2);
      persp.fov = 42;
      persp.updateProjectionMatrix();
      glowAt.current.set(1e5, 1e5, 1e5);
      if (flash.current) {
        const f = t > T.sep1 && t < T.sep1 + 0.5 ? 1 - (t - T.sep1) / 0.5 : 0;
        flash.current.visible = f > 0;
        flash.current.material.opacity = f;
        flash.current.position.copy(st.tmp2);
      }
    }

    // ---- completion ----
    if (t >= T.end && !st.completed) {
      st.completed = true;
      store.set(t);
      if (isHost || !plan) complete("launch", 100);
      else setTimeout(() => complete("launch", 100), 5000);
    }
  });

  return (
    <>
      <Suspense fallback={null}>
        {!space && <Environment files={LAUNCH_HDRI} background backgroundBlurriness={0.01} environmentIntensity={0.5} backgroundIntensity={0.75} backgroundRotation={[0, 5.04, 0]} environmentRotation={[0, 5.04, 0]} />}
        {/* The space-cut objects are mounted from the start at ~zero scale: their shaders compile and textures upload behind the
            loading veil instead of freezing the page at the 24 s cut. */}
        <group scale={space ? 1 : 1e-6}>
          <Starfield brightness={1.6} />
        </group>
      </Suspense>
      <directionalLight
        position={space ? SPACE_SUN.map((v) => v * 1000) as [number, number, number] : [SUN.x * 500, SUN.y * 500, SUN.z * 500]}
        intensity={space ? 4.6 : 4.2}
        color={space ? "#fffaf0" : "#ffb98a"}
        castShadow={q.shadows} /* constant: toggling it recompiles every lit material at the cut */
        shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]}
        shadow-camera-left={-170} shadow-camera-right={170} shadow-camera-top={170} shadow-camera-bottom={-80} shadow-camera-near={10} shadow-camera-far={1200}
        shadow-bias={-0.0003} shadow-normalBias={0.4}
      />
      <ambientLight intensity={space ? 0.16 : 0.1} color={space ? "#9db6ff" : "#ffd4b0"} />
      <pointLight ref={light} color="#ff9a45" intensity={0} distance={500} decay={2} />

      {!space && <LaunchPad shadows={q.shadows} />}

      <group scale={space ? 1 : 1e-6}>
        <Earth radius={3500} position={[500, -3750, -300]} sun={SPACE_SUN} lite={q.tier === "low"} spin={0.003} />
        <Moon radius={320} position={[7500, 900, -2600]} quality={q.tier === "high" ? "medium" : "low"} />
      </group>

      <Rocket
        ref={rocket}
        shadows={q.shadows}
        position={[0, PAD_H, 0]}
        scale={RS}
        extras={{
          s1: (
            <group>
              {S1_ENGINES.map(([x, z], i) => (
                <Plume key={i} radius={2.4} length={space ? 70 : 170} level={flame} position={[x, 1.2, z]} seed={i} spread={space ? 2.2 : 1.1} hot="#ffe6b0" mid="#ff9f3c" cool="#ff5a14" />
              ))}
            </group>
          ),
          s2: <group>{S1_ENGINES.map(([x, z], i) => <Plume key={i} radius={1.0} length={55} level={flame2} position={[x * 0.6, 52, z * 0.6]} spread={2.4} seed={i + 9} hot="#cfe6ff" mid="#8fc2ff" cool="#7a8cff" />)}</group>,
          s3: <Plume radius={0.95} length={45} level={flame3} position={[0, 78.4, 0]} spread={2.6} seed={21} hot="#d8ecff" mid="#9ac9ff" cool="#8294ff" />,
        }}
      />
      <sprite ref={flash} scale={[260, 260, 1]} visible={false}>
        <spriteMaterial color="#fff2d8" blending={THREE.AdditiveBlending} transparent depthWrite={false} />
      </sprite>

      <Particles ref={smoke} max={maxP} drag={0.55} gravity={[0, 0.9, 0]} opacity={0.82} ambient={0.62} lightDir={[SUN.x, SUN.y + 0.4, SUN.z]} glowRef={glowAt} glowRadius={90} glowColor="#ff8d3a" />
      <Particles ref={fire} max={160} additive drag={1.2} opacity={0.9} glowColor="#ffcf90" renderOrder={12} />
      <Effects bloom={space ? 0.55 : 0.45} ao={false} />
    </>
  );
}

const AXIS_Z = new THREE.Vector3(0, 0, 1);
