"use client";
/* eslint-disable react-hooks/immutability */
// The money shot, flown by the player (flight.ts). Timeline in clock.ts:
//   0-12 s   pad at dawn, countdown, venting steam, ignition at 3 s
//   12 s     liftoff, camera shake, tower cleared, gravity turn: the player follows the pitch guide
//   24 s     cut to space: Earth curve + atmosphere
//   30 s     first stage burns out: stage (commander); second stage burns, stage again
//   then     translunar injection burn with the Moon ahead: start it and cut it off at the target speed
// The pilot's client simulates and sends the flight ten times a second; the other crew render the same flight.
import { Environment } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { sfx, stopSfx } from "../../core/audio";
import { clearComms, runCues, say } from "../../core/comms";
import { guidanceCall, launchCues, stagingDone, stagingVariants, tliCutoff, tliGo, tliIgnition } from "../../data/missionComms";
import { COST } from "../../core/hp";
import { flightDamage } from "../../flight/damage";
import { devDifficulty } from "../../flight/difficulty";
import { axis, installKeys, take } from "../../flight/input";
import { useFlightSync } from "../../flight/sync";
import { TLI, enginesOn, launchParams, needOf, needRole, newLaunch, stepLaunch, type LaunchSim } from "./flight";
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
import { preload, traceEvent } from "../../core/comms";

export const LAUNCH_HDRI = "/hdri/kiara_1_dawn_1k.hdr";
const RS = 0.9; // rocket scale
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
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
  const { plan, isHost, complete, actsAs } = useGame();
  const pilot = actsAs("pilot");
  const commander = actsAs("commander");
  const diff = devDifficulty(plan?.difficulty);
  const P = useMemo(() => launchParams(diff), [diff]);
  const sim = useMemo<LaunchSim>(() => newLaunch(), []);
  const flightRef = useRef({ pilot, commander, host: isHost, P });
  useEffect(() => { flightRef.current = { pilot, commander, host: isHost, P }; });
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
    lastBeep: -1, errV: 0, remoteAt: 0, remoteT: -1, ev: new Set<string>(), warnSince: -1, warnLast: -99, warned: 0, acc: 0, acc2: 0, steam: 0, lastPush: 0, completed: false, s1v: new THREE.Vector3(), s1p: new THREE.Vector3(),
    act: false, skipSent: false, s2p: new THREE.Vector3(), s2v: new THREE.Vector3(), s1spin: 0, s2spin: 0, camLook: new THREE.Vector3(0, 60, 0), tmp: new THREE.Vector3(), tmp2: new THREE.Vector3(),
  }), []);
  const { sendCmd } = useFlightSync<LaunchSim, { k: string; n?: string }>(
    "launch",
    pilot,
    () => sim,
    (snap, at) => { Object.assign(sim, snap); st.remoteAt = at; st.remoteT = snap.t; },
    (c) => { if (c.k === "act" && needOf(sim) === c.n) st.act = true; else if (c.k === "skip") store0().skip(); },
  );
  const sendRef = useRef(sendCmd);
  useEffect(() => { sendRef.current = sendCmd; });
  useEffect(() => installKeys(), []);
  const spec = useMemo<EmitSpec>(() => ({ pos: [0, 0, 0], posJitter: [0, 0, 0], vel: [0, 0, 0], velJitter: [0, 0, 0], life: 1, size0: 1, size1: 1 }), []);

  // the pad haze must not wash out the Moon and Earth (thousands of metres away) once we are in space
  useEffect(() => {
    if (space) scene.fog = null;
  }, [space, scene]);

  // camera setup / restore (the Canvas camera is shared by all phases)
  useEffect(() => {
    const fov = persp.fov, near = persp.near;
    // 24-bit depth with near 0.1 / far 20000 resolves ~10-30 m at the Earth's distance, so the cloud shell (21 m above the
    // surface) z-fights and streaks. Nothing is closer than ~100 m to the camera here, so a larger near plane costs nothing.
    persp.near = 4;
    useLaunchClock.getState().reset();
    // dev only: ?lt=<seconds> starts the cinematic at that time (for screenshots)
    const lt = process.env.NODE_ENV !== "production" ? Number(new URLSearchParams(location.search).get("lt")) : 0;
    if (lt > 0) {
      // run the ascent up to that time with a perfect pilot (screenshots)
      for (let tt = T.liftoff; tt < lt; tt += 0.05) {
        const n = needOf(sim);
        stepLaunch(sim, tt, 0.05, 0, n === "stage" || n === "ignite" || (n === "cutoff" && sim.v >= TLI.target), { ...P, assist: 2 });
      }
      st.t = lt;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (lt >= T.spaceCut) setSpace(true); st.cut = lt >= T.spaceCut; st.spoke = st.ign = st.roar = st.rumble = true;
      st.sep1 = sim.s1SepAt >= 0 && lt >= sim.s1SepAt; st.sep2 = sim.s2SepAt >= 0 && lt >= sim.s2SepAt;
    }
    persp.fov = 32;
    persp.updateProjectionMatrix();
    scene.fog = new THREE.Fog("#b9a28e", 1400, 14000);
    return () => {
      persp.fov = fov;
      persp.near = near;
      persp.updateProjectionMatrix();
      scene.fog = null;
      stopSfx();
    };
  }, [persp, scene, st, sim, P]);

  const maxP = q.tier === "high" ? 900 : q.tier === "medium" ? 560 : 260;
  const rate = q.tier === "high" ? 1 : q.tier === "medium" ? 0.7 : 0.4;

  const E = (n: number, s: EmitSpec) => smoke.current?.emit(n, s);
  const R = () => { rng.v = (Math.imul(rng.v, 1664525) + 1013904223) >>> 0; return rng.v / 4294967296; };

  useFrame((state, rawDt) => {
    const store = useLaunchClock.getState();
    const dt = Math.min(rawDt, 0.05);
    const fl = flightRef.current;
    if (isRevealed("launch")) {
      st.t += dt; // the clock starts when the scene is on screen
      if (!fl.pilot && st.remoteT >= 0) {
        // the other crew follow the pilot's clock (gently: the countdown must not jump)
        const d = st.remoteT + (performance.now() - st.remoteAt) / 1000 - st.t;
        if (Math.abs(d) > 3) st.t += d; else st.t += clamp(d, -0.25 * dt, 0.25 * dt);
      }
    }
    const t = st.t;
    const tp = t - T.liftoff;

    // ---- the flight: the pilot simulates, everyone else renders the pilot's state
    if (store.skipped && !st.skipSent) {
      st.skipSent = true;
      if (fl.pilot) { sim.skip = true; sim.endAt = Math.max(t, sim.t) + 0.7; } // the others get it in the pilot's next snapshot
    }
    const need = needOf(sim);
    let act = st.act;
    st.act = false;
    if (take("Space", "Enter", "KeyB") && need !== "none") {
      const mine = needRole(need) === "commander" ? fl.commander : fl.pilot;
      if (mine) { if (fl.pilot) act = true; else sendRef.current({ k: "act", n: need }); }
    }
    if (fl.pilot) {
      const steer = axis(["ArrowLeft", "ArrowUp", "KeyA", "KeyW"], ["ArrowRight", "ArrowDown", "KeyD", "KeyS"]);
      stepLaunch(sim, t, dt, steer, act, fl.P);
    }
    st.errV += (sim.err - st.errV) * (fl.pilot ? 1 : Math.min(1, dt * 12));
    const errRad = clamp(st.errV, -0.6, 0.6);
    const en = enginesOn(sim, t);
    const s1At = sim.s1SepAt, s2At = sim.s2SepAt;
    const quiet = store.skipped || sim.skip;
    if (((t * 10) | 0) !== ((t - dt) * 10 | 0)) store.set(t, sim);

    // ---- flight radio: every line says what has just happened (on every client, from the same state)
    if (!quiet) {
      const once = (k: string, fn: () => void) => { if (!st.ev.has(k)) { st.ev.add(k); fn(); } };
      if (sim.s1CutAt >= 0) once("s1cut", () => { traceEvent("first stage burnout: stage now"); stagingVariants(1).forEach(preload); });
      if (sim.s2CutAt >= 0) once("s2cut", () => { traceEvent("second stage burnout: stage now"); stagingVariants(2).forEach(preload); });
      if (sim.readyAt >= 0 && t >= sim.readyAt) once("ready", () => { traceEvent("TLI window open (GO for translunar injection)"); preload(tliIgnition()); say(tliGo(TLI.target)); });
      if (sim.burnAt >= 0) once("burn", () => { traceEvent(`TLI ignition (${sim.autoBurn ? "automatic" : "player"})`); sfx("ignition", { volume: 0.5 }); say(tliIgnition()); });
      if (sim.burnEndAt >= 0) once("cut", () => {
        const dv = sim.v - TLI.target;
        traceEvent(`TLI cutoff at ${(sim.v / 1000).toFixed(2)} km/s (${dv >= 0 ? "+" : ""}${Math.round(dv)} m/s from target)`);
        say(tliCutoff(sim.v, dv, fl.P.tol), { interrupt: true });
        const e = Math.abs(dv);
        if (e > fl.P.tol * 6) flightDamage(COST.severe, `TLI burn ${Math.round(e)} m/s off target`, fl.pilot);
        else if (e > fl.P.tol * 3) flightDamage(COST.major, `TLI burn ${Math.round(e)} m/s off target`, fl.pilot);
      });
      // Houston only speaks up about a pitch error that has really persisted
      const errDeg = (sim.err * 180) / Math.PI;
      if (tp > 2 && sim.burnEndAt < 0 && (en.s1 || en.s2 || en.s3) && Math.abs(errDeg) > fl.P.warn) {
        if (st.warnSince < 0) st.warnSince = t;
        else if (t - st.warnSince > 1.6 && t - st.warnLast > 12 && st.warned < 2) {
          st.warned++; st.warnLast = t; flightDamage(COST.minor, `Pitch ${Math.abs(errDeg).toFixed(0)} degrees off the guide`, fl.pilot); traceEvent(`pitch error ${errDeg.toFixed(0)} deg for 1.6 s: Houston calls it`); say(guidanceCall(errDeg));
        }
      } else st.warnSince = -1;
    }

    const alt = altitude(tp);
    const rk = rocket.current;
    if (!rk) return;

    // ---- audio / voice cues: the real countdown and ascent calls ----
    if (quiet) {
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
      const pitch = (tp > 6 ? Math.min(0.5, 0.0045 * (tp - 6) * (tp - 6)) : 0) + (tp > 0 ? errRad : 0);
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
      const s1 = s1At >= 0 && t >= s1At, s2 = s2At >= 0 && t >= s2At;
      if (!st.sep1 && s1) {
        st.sep1 = true; sfx("staging", { volume: 0.6 });
        traceEvent(`first stage separates (${sim.s1Delay.toFixed(1)} s after burnout${sim.auto1 ? ", automatic" : ""})`);
        if (!quiet) say(stagingDone(1, sim.s1Delay));
        if (!quiet && sim.s1Delay > 4) flightDamage(COST.major, "Staging missed: forced separation", fl.pilot);
        else if (!quiet && sim.s1Delay > 2) flightDamage(COST.minor, "Staging late", fl.pilot);
        st.s1p.set(0, 0, 0); st.s1v.set(-9, 0.6, 1.8);
        for (let i = 0; i < 40 * rate; i++) {
          fire.current?.emit(1, { pos: [0, 52 * RS, 0], posJitter: [4, 3, 4], vel: [(R() - 0.5) * 30, (R() - 0.5) * 30, (R() - 0.5) * 30], life: 0.9, size0: 4, size1: 22, color: [1, 0.85, 0.6], glow: 1 });
        }
      }
      if (!st.sep2 && s2) {
        st.sep2 = true; sfx("staging", { volume: 0.5 });
        traceEvent(`second stage separates (${sim.s2Delay.toFixed(1)} s after burnout${sim.auto2 ? ", automatic" : ""})`);
        if (!quiet) say(stagingDone(2, sim.s2Delay));
        if (!quiet && sim.s2Delay > 4) flightDamage(COST.major, "Staging missed: forced separation", fl.pilot);
        else if (!quiet && sim.s2Delay > 2) flightDamage(COST.minor, "Staging late", fl.pilot);
        st.s2p.set(0, 0, 0); st.s2v.set(-6, -0.5, -1.4);
        for (let i = 0; i < 24 * rate; i++) {
          fire.current?.emit(1, { pos: [0, 78 * RS, 0], posJitter: [3, 2, 3], vel: [(R() - 0.5) * 20, (R() - 0.5) * 20, (R() - 0.5) * 20], life: 0.8, size0: 3, size1: 14, color: [1, 0.9, 0.7], glow: 1 });
        }
      }
      // rocket: heading +X, slight nose-down pitch with Earth curve
      const head = -(1.39 + errRad);
      rk.root.position.set(ts * 30, 0, 0);
      rk.root.rotation.set(0, 0, head);
      rk.root.scale.setScalar(RS);
      rk.les.visible = ts < 1.2;
      if (rk.les.visible) rk.les.position.set(0, ts * 6, 0); else rk.les.position.set(0, 0, 0);
      // separated stages drift away (local frame): -Y is 'back' along the flight axis
      rk.s1.visible = !s1 || t < s1At + 6;
      rk.s2.visible = !s2 || t < s2At + 6;
      if (s1) {
        const k = t - s1At;
        rk.s1.position.set(st.s1v.x * k * 0.5 + Math.sin(k * 0.5) * 2, -k * k * 4.5 - k * 6, st.s1v.z * k);
        rk.s1.rotation.set(k * 0.12, 0, k * 0.07);
      }
      if (s2) {
        const k = t - s2At;
        rk.s2.position.set(st.s2v.x * k * 0.5, -k * k * 3.5 - k * 5, st.s2v.z * k);
        rk.s2.rotation.set(k * 0.09, 0, -k * 0.05);
      }
      // engines: S-II burns between separations, S-IVB burns after
      flame.current = en.s1 ? (0.9 + Math.random() * 0.1) : 0;
      flame2.current = en.s2 && !s2 ? clamp01((t - s1At - 0.8) / 1.0) * (0.9 + Math.random() * 0.1) : 0;
      flame3.current = en.s3 ? clamp01((t - sim.burnAt) / 0.6) * (0.92 + Math.random() * 0.08) : 0;
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
      const orbit = s2 ? sm(0, 12, t - s2At) : 0;
      const ang = -0.9 + Math.sin(ts * 0.18) * 0.12 + orbit * 1.55;
      const dist = 150 - (s1 ? sm(0, 4, t - s1At) : 0) * 10 - orbit * 25;
      state.camera.position.set(p.x - 30 + Math.sin(ang) * dist, 25 + orbit * 30, Math.cos(ang) * dist);
      state.camera.lookAt(st.tmp2);
      persp.fov = 42;
      persp.updateProjectionMatrix();
      glowAt.current.set(1e5, 1e5, 1e5);
      if (flash.current) {
        const f = s1 && t < s1At + 0.5 ? 1 - (t - s1At) / 0.5 : 0;
        flash.current.visible = f > 0;
        flash.current.material.opacity = f;
        flash.current.position.copy(st.tmp2);
      }
    }

    // ---- completion ----
    if (sim.endAt >= 0 && t >= sim.endAt && !st.completed) {
      st.completed = true;
      store.set(t, sim);
      const score = sim.result?.total ?? 60; // skipped: a fair middling score
      if (fl.pilot || !plan) complete("launch", score);
      else if (fl.host) setTimeout(() => complete("launch", score), 6000); // the pilot's client has gone quiet: host closes it
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
const store0 = () => useLaunchClock.getState();
