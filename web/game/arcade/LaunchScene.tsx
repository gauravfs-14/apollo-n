"use client";
/* eslint-disable react-hooks/immutability */
// The Launch & Burn challenge scene: the player-flown ascent (phases/launch/flight.ts) from max-Q to the translunar burn,
// solo and seeded (the seed sets the gust pattern). The rocket stays centred; the Earth turns underneath.
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Effects } from "../core/Effects";
import { sfx } from "../core/audio";
import { useQuality } from "../core/perf";
import { axis, clearEdges, installKeys, take } from "../flight/input";
import { T } from "../phases/launch/clock";
import { enginesOn, launchParams, needOf, newLaunch, stepLaunch, type LaunchSim } from "../phases/launch/flight";
import { Earth } from "../three/Earth";
import { Starfield } from "../three/Starfield";
import { Plume } from "../three/ship/Plume";
import { Rocket, S1_ENGINES, type RocketRefs } from "../three/ship/Rocket";
import { mulberry32 } from "./seed";
import { scoreLaunch } from "./scoring";
import { useArcade } from "./store";

const RS = 0.9;
const COUNT = 3; // seconds of countdown before the program starts
const SUN: [number, number, number] = [-0.5, 0.5, 0.7];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function launchParamsFor() {
  return launchParams("normal");
}

export function LaunchScene({ seed, run, onRetry }: { seed: number; run: number; onRetry: () => void }) {
  return (
    <Suspense fallback={null}>
      <Ascent key={`${seed}-${run}`} seed={seed} onRetry={onRetry} />
    </Suspense>
  );
}

function Ascent({ seed, onRetry }: { seed: number; onRetry: () => void }) {
  const q = useQuality();
  const { camera } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const P = useMemo(() => launchParamsFor(), []);
  const sim = useMemo<LaunchSim>(() => newLaunch(), []);
  const g = useMemo(() => {
    const r = mulberry32(seed);
    return { a1: 0.012 + r() * 0.03, p1: r() * 6.28, p2: r() * 6.28, f1: 1.1 + r() * 0.6 };
  }, [seed]);
  const rocket = useRef<RocketRefs>(null);
  const earth = useRef<THREE.Group>(null);
  const flame = useRef(0), flame2 = useRef(0), flame3 = useRef(0);
  const st = useMemo(() => ({
    t: T.liftoff - COUNT, started: false, s1v: new THREE.Vector3(2.4, 0, 0.8), s2v: new THREE.Vector3(-3, 0, -1), lastUi: 0, finished: false, ang: 0,
  }), []);

  useEffect(() => installKeys(), []);
  useEffect(() => {
    clearEdges();
    useArcade.setState({ loaded: true, result: null, launch: null, land: null, info: { seed, site: "launch", siteName: "Launch and burn" } });
    sfx("rumble", { volume: 0.35 });
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __launchSim: sim, __launchT: st });
  }, [seed, sim, st]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    if (take("KeyR")) { onRetry(); return; }
    const rk = rocket.current;
    if (!rk) return;
    const over = sim.result != null;
    if (!over) {
      st.t += dt;
      const need = needOf(sim);
      const act = take("Space", "Enter", "KeyB") && need !== "none";
      const steer = axis(["ArrowLeft", "ArrowUp", "KeyA", "KeyW"], ["ArrowRight", "ArrowDown", "KeyD", "KeyS"]);
      stepLaunch(sim, st.t, dt, steer, act, P);
      // the seed's own gust pattern, on top of the program's
      if (st.t > T.liftoff && sim.burnEndAt < 0) sim.p += g.a1 * (Math.sin(st.t * g.f1 + g.p1) + 0.7 * Math.sin(st.t * 3.1 + g.p2)) * dt;
    }
    const t = st.t;
    const tp = t - T.liftoff;
    if (sim.result && !st.finished) {
      st.finished = true;
      const scored = scoreLaunch(sim.result);
      useArcade.setState({
        result: {
          challenge: "launch", seed, scored, launch: sim.result, timeS: t - (T.liftoff - COUNT),
          stats: { rmsDeg: sim.result.rmsDeg, delay1: sim.result.stageDelays[0], delay2: sim.result.stageDelays[1], dv: sim.result.dv, timeS: t - (T.liftoff - COUNT) },
        },
      });
    }

    // ---- visuals
    const en = enginesOn(sim, t);
    const s1 = sim.s1SepAt >= 0 && t >= sim.s1SepAt, s2 = sim.s2SepAt >= 0 && t >= sim.s2SepAt;
    rk.root.rotation.set(0, 0, -sim.p);
    { const c = 60 * RS; rk.root.position.set(-c * Math.sin(sim.p), c - c * Math.cos(sim.p), 0); }
    rk.root.scale.setScalar(RS);
    rk.les.visible = tp < 1.2;
    rk.s1.visible = !s1 || t < sim.s1SepAt + 6;
    rk.s2.visible = !s2 || t < sim.s2SepAt + 6;
    if (s1) { const k = t - sim.s1SepAt; rk.s1.position.set(st.s1v.x * k * 0.5, -k * k * 4.5 - k * 6, st.s1v.z * k); rk.s1.rotation.set(k * 0.12, 0, k * 0.07); }
    if (s2) { const k = t - sim.s2SepAt; rk.s2.position.set(st.s2v.x * k * 0.5, -k * k * 3.5 - k * 5, st.s2v.z * k); rk.s2.rotation.set(k * 0.09, 0, -k * 0.05); }
    const pre = t < T.liftoff;
    flame.current = pre ? 0.6 + Math.random() * 0.1 : en.s1 ? 0.9 + Math.random() * 0.1 : 0;
    flame2.current = en.s2 && !s2 ? clamp01((t - sim.s1SepAt - 0.8) / 1.0) * (0.9 + Math.random() * 0.1) : 0;
    flame3.current = en.s3 ? clamp01((t - sim.burnAt) / 0.6) * (0.92 + Math.random() * 0.08) : 0;
    // the Earth turns underneath and falls away as the speed climbs
    st.ang += (sim.v / 7800) * dt * 0.16;
    if (earth.current) {
      earth.current.position.set(300, -(3500 + 380 + sim.altKm * 5), -500);
      earth.current.rotation.set(0, 0, st.ang);
    }
    const centre = sim.s2SepAt >= 0 ? 90 * RS : 60 * RS;
    cam.position.set(0, centre + 8, 330);
    cam.lookAt(0, centre, 0);
    cam.near = 1; cam.far = 20000; cam.fov = 38;
    cam.updateProjectionMatrix();

    // ---- HUD (10 Hz)
    const now = performance.now();
    if (now - st.lastUi > 100) {
      st.lastUi = now;
      const stage = pre ? "Countdown" : sim.burnEndAt >= 0 ? "Burn complete" : sim.burnAt >= 0 ? "Translunar burn" : sim.s2SepAt >= 0 ? "Burn window" : sim.s1SepAt >= 0 ? "Second stage" : "First stage";
      useArcade.setState({
        launch: {
          t: tp, p: sim.p, g: sim.g, err: sim.err, v: sim.v, altKm: sim.altKm, need: needOf(sim), stage, countdown: Math.max(0, T.liftoff - t), over,
        },
      });
    }
  });

  return (
    <>
      <Starfield brightness={1.6} />
      <directionalLight position={SUN.map((v) => v * 1000) as [number, number, number]} intensity={4.6} color="#fffaf0" />
      <ambientLight intensity={0.16} color="#9db6ff" />
      <group ref={earth}>
        <Earth radius={3500} sun={SUN} lite={q.tier === "low"} spin={0.003} />
      </group>
      <Rocket
        ref={rocket}
        shadows={false}
        extras={{
          s1: (
            <group>
              {S1_ENGINES.map(([x, z], i) => (
                <Plume key={i} radius={2.4} length={110} level={flame} position={[x, 1.2, z]} seed={i} spread={1.6} hot="#ffe6b0" mid="#ff9f3c" cool="#ff5a14" />
              ))}
            </group>
          ),
          s2: <group>{S1_ENGINES.map(([x, z], i) => <Plume key={i} radius={1.0} length={55} level={flame2} position={[x * 0.6, 52, z * 0.6]} spread={2.4} seed={i + 9} hot="#cfe6ff" mid="#8fc2ff" cool="#7a8cff" />)}</group>,
          s3: <Plume radius={0.95} length={45} level={flame3} position={[0, 78.4, 0]} spread={2.6} seed={21} hot="#d8ecff" mid="#9ac9ff" cool="#8294ff" />,
        }}
      />
      <Effects bloom={0.55} ao={false} />
    </>
  );
}
