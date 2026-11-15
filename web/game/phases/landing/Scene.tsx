"use client";
/* eslint-disable react-hooks/immutability */
// Powered descent, flown by the player (sim.ts) over the real LOLA terrain onto the spot the crew chose.
// The pilot's client simulates and broadcasts the lander ten times a second; the other crew render it smoothly.
// Dust, plume, contact lights and the chase camera are driven by the flight state.
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { sfx } from "../../core/audio";
import { clearComms, preload, say, traceEvent } from "../../core/comms";
import { isRevealed, useLoadingHold, useRevealed } from "../../core/loading";
import { useQuality } from "../../core/perf";
import { useStore } from "../../core/store";
import { useGame, usePhaseData } from "../../core/useGame";
import {
  altitudeCall, autopilotCall, contactLight, descentStart, driftCall, engineStop, fuelCall, fuelOut, goForLanding, touchdownReport,
} from "../../data/missionComms";
import { perkEffects, usePerk } from "../../data/perks";
import { useUpgrades } from "../../progress/effects";
import { COST } from "../../core/hp";
import { setEventGuard } from "../../core/events";
import { award, grade, miss, slowmo, stinger, timeScale, useCameraShake } from "../../core/juice";
import { flightDamage } from "../../flight/damage";
import { shipStats } from "../../data/parts";
import { devDifficulty } from "../../flight/difficulty";
import { GroundRing } from "../../flight/GroundRing";
import { axis, held, installKeys, take } from "../../flight/input";
import { useFlightSync } from "../../flight/sync";
import { Lander, getDefaultParts } from "../../three/ship/Lander";
import {
  Beacon, Boulders, GroundBounce, LunarSky, RenderInfo, SunLight, Terrain, missionTime, scatterBoulders, skyAt, useTerrainData,
  type TerrainData,
} from "../../three/terrain";
import { landerFromBuild, type SimOut } from "../site/api";
import { Dust, type DustState } from "./Dust";
import { Plume } from "./Plume";
import { flags, useLanding, type LandHud } from "./store";
import {
  FT, G, bodyBasis, footPlane, fuelSeconds, landParams, newLand, stepLand, upVec,
  type Ground, type LandInput, type LandParams, type LandSim,
} from "./sim";

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
const ss = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const CALL_FT = [400, 200, 100, 40];

interface SiteData {
  site_id: string;
  probe: { x: number; z: number };
  sim: SimOut;
}

/** y offset so the lowest contact point rests on the DEM, for a given pose. */
function groundedY(data: TerrainData, x: number, z: number, q: THREE.Quaternion, local: THREE.Vector3[], tmp: THREE.Vector3) {
  let y = -1e9;
  for (const p of local) {
    tmp.copy(p).applyQuaternion(q);
    y = Math.max(y, data.heightAt(x + tmp.x, z + tmp.z) - tmp.y);
  }
  return y;
}

function Descent({
  data, ground, P, target, heading, parts, siteName, ringR, onFocus, penalty,
}: {
  data: TerrainData; ground: Ground; P: LandParams; target: { x: number; z: number }; heading: number;
  parts: Record<string, string>; siteName: string; ringR: number; onFocus: (x: number, z: number) => void; penalty: number;
}) {
  const { actsAs, patch } = useGame();
  const pilot = actsAs("pilot");
  const { camera } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const revealed = useRevealed("landing");
  const root = useRef<THREE.Group>(null);
  const lights = useRef<THREE.Group>(null);
  const thr = useRef(0);
  const dust = useRef<DustState>({ x: 0, z: 0, strength: 0, burst: 0 });
  const [sim] = useState(() => newLand(1, target, ground, P, heading)); // one flight per mount: a quality change must not restart it
  const st = useMemo(() => ({
    ev: new Set<string>(), tgt: null as LandSim | null, tgtAt: 0, lastUi: 0, since: 0, att: 1, prevAlt: 1e9, lastAuto: false,
    n: [0, 1, 0] as readonly [number, number, number], settled: false, lastFocus: [1e9, 1e9] as [number, number], camInit: false, orbit: 0,
    q0: new THREE.Quaternion(), qT: new THREE.Quaternion(), qOut: new THREE.Quaternion(), m4: new THREE.Matrix4(), tmpQ: new THREE.Quaternion(),
    ex: new THREE.Vector3(), ey: new THREE.Vector3(), ez: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(),
    camP: new THREE.Vector3(), camL: new THREE.Vector3(), want: new THREE.Vector3(), look: new THREE.Vector3(), tmp: new THREE.Vector3(),
    up: [0, 1, 0] as [number, number, number], basis: new Array<number>(9).fill(0),
    inp: { thr: 0, cut: false, full: false, lf: 0, lr: 0 } as LandInput,
  }), []);
  const landed = useLanding((x) => !!x.s?.down);
  const retryAllowed = P.hoverAvail; // easy and normal
  const info = useMemo(() => ({ limit: P.limit, hoverAvail: P.hoverAvail, autoAvail: P.autoAvail, vSafe: P.vSafe, vCrash: P.vCrash, fuel0: P.fuel0, retryAllowed, penalty }), [P, retryAllowed, penalty]);

  // contact points in lander-local space: four footpads, four deck corners, the top of the mast
  const local = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      pts.push(new THREE.Vector3(Math.sin(a) * P.padR, 0.05, Math.cos(a) * P.padR));
      pts.push(new THREE.Vector3(Math.sin(a) * 2.7, 3.3, Math.cos(a) * 2.7));
    }
    pts.push(new THREE.Vector3(0, 6.8, 0));
    return pts;
  }, [P.padR]);

  const sync = useFlightSync<LandSim, { k: string }>(
    "land",
    pilot,
    () => sim,
    (snap, at) => {
      const first = !st.tgt || snap.att !== sim.att;
      st.tgt = snap; st.tgtAt = at;
      const { x, y, z, vx, vy, vz, lf, lr, thr: th, ...rest } = snap;
      Object.assign(sim, rest);
      if (first) Object.assign(sim, { x, y, z, vx, vy, vz, lf, lr, thr: th });
    },
    (c) => {
      if (c.k === "auto" && !sim.down) { sim.auto = true; sim.hover = true; sim.assisted ||= !P.autoAvail; }
    },
  );
  const reqRef = useRef(sync.sendCmd);
  useEffect(() => { reqRef.current = sync.sendCmd; });

  useEffect(() => installKeys(), []);
  useEffect(() => {
    useLanding.setState({ ready: true, s: null, info, request: (k) => reqRef.current({ k }) });
    // the descent engine is felt through the structure, not a launch roar: a low rumble under the radio
    sfx("rumble", { volume: 0.35 });
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __landSim: sim, __landTarget: target });
    return () => useLanding.setState({ ready: false, s: null });
  }, [info, sim, target]);
  useEffect(() => {
    if (!revealed) return;
    const state = useStore.getState().state;
    say(descentStart(siteName), { once: `descent:${state?.plan?.id}` });
  }, [revealed, siteName]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05) * (sim.down ? timeScale() : 1); // slow motion on a perfect touchdown
    const live = isRevealed("landing");
    setEventGuard("landing", sim.down || sim.alt < 170); // never interrupt the last part of the descent

    // ---- the flight
    if (pilot && live) {
      if (sim.down) {
        if (take("KeyR") && retryAllowed && sim.result && sim.result.reason !== "ok") {
          Object.assign(sim, newLand(sim.att + 1, target, ground, P, heading, sim.retries + 1));
          clearComms();
        }
      } else {
        const inp = st.inp;
        inp.thr = axis(["KeyS"], ["KeyW"]);
        inp.lf = axis(["ArrowDown"], ["ArrowUp"]);
        inp.lr = axis(["ArrowLeft"], ["ArrowRight"]);
        inp.cut = held("KeyX");
        inp.full = held("ShiftLeft", "ShiftRight");
        if (take("KeyH") && P.hoverAvail && !sim.auto) {
          sim.hover = !sim.hover;
          if (sim.hover) sim.vt = clamp(sim.vy, -12, 3);
        }
        if (take("KeyP") && P.autoAvail) {
          sim.auto = !sim.auto;
          sim.hover = sim.auto || P.hoverAvail;
        }
        const touched = inp.thr !== 0 || inp.lf !== 0 || inp.lr !== 0 || inp.cut;
        if (sim.auto && touched) { sim.auto = false; sim.hover = P.hoverAvail; sim.vt = clamp(sim.vy, -12, 3); }
        stepLand(sim, dt, inp, ground, P, target);
      }
    } else if (!pilot && st.tgt && !sim.down) {
      // follow the pilot: dead-reckon from the last snapshot and ease onto it
      const g = st.tgt, age = (performance.now() - st.tgtAt) / 1000;
      const k = Math.min(1, dt * 8);
      sim.vx = g.vx; sim.vy = g.vy - G * 0.0; sim.vz = g.vz;
      sim.x += sim.vx * dt; sim.y += sim.vy * dt; sim.z += sim.vz * dt;
      sim.x += (g.x + g.vx * age - sim.x) * k;
      sim.y += (g.y + g.vy * age - sim.y) * k;
      sim.z += (g.z + g.vz * age - sim.z) * k;
      sim.lf += (g.lf - sim.lf) * k; sim.lr += (g.lr - sim.lr) * k; sim.thr += (g.thr - sim.thr) * k;
    } else if (!pilot && st.tgt && sim.down) {
      Object.assign(sim, { x: st.tgt.x, y: st.tgt.y, z: st.tgt.z, lf: st.tgt.lf, lr: st.tgt.lr, thr: 0 });
    }
    if (sim.att !== st.att) { // a retry: start the new attempt's radio and settle state afresh
      st.att = sim.att; st.ev.clear(); st.since = 0; st.settled = false; st.prevAlt = 1e9; st.camInit = false; st.orbit = 0;
    }
    if (sim.down) st.since += dt;

    const hvx = sim.vx, hvz = sim.vz;
    const vh = Math.hypot(hvx, hvz);
    const alt = sim.alt;

    // ---- radio: every line is what the lander is doing now, on every client, from the same state
    const once = (k: string, fn: () => void) => { if (!st.ev.has(k)) { st.ev.add(k); fn(); } };
    if (live && !sim.down) {
      if (alt < 250 && sim.vy < 0) once("go", () => say(goForLanding()));
      CALL_FT.forEach((ft, i) => {
        const m = ft / FT;
        const sink = -sim.vy * FT;
        // the call is built from the real sink rate when the height is reached: get the likely numbers ready twice on the way down
        const pre = (k: string) => once(k, () => [-2, 0, 2].forEach((d) => preload(altitudeCall(ft, Math.max(0, Math.round(sink) + d), false))));
        if (alt < m + 90 && alt > m + 40) pre(`pre${ft}`);
        if (alt < m + 35 && alt > m) pre(`prex${ft}`);
        if (st.prevAlt > m && alt <= m && sim.vy < -0.3) once(`alt${ft}`, () => {
          traceEvent(`${ft} feet, sink ${Math.round(sink)} ft/s`);
          if (-sim.vy <= P.vSafe * 1.15) award(25 + Math.round(15 * Math.max(0, 1 - ft / 150)), `${ft} ft: sink rate good`, { tone: "cyan" });
          else miss("Sinking too fast");
          say(altitudeCall(ft, sink, i === CALL_FT.length - 1 && sim.thr > 0.1));
        });
      });
      if (sim.fuel > 0) {
        // too late to matter below 15 m (and the contact call comes first)
        const sec = alt >= 15 ? fuelSeconds(sim) : 1e9;
        if (sec <= 60) once("f60", () => { traceEvent("fuel: 60 seconds"); say(fuelCall(60)); });
        if (sec <= 30) once("f30", () => { traceEvent("fuel: 30 seconds"); say(fuelCall(30)); });
      } else once("f0", () => { traceEvent("fuel out"); say(fuelOut(), { interrupt: true }); flightDamage(COST.major, "Out of fuel", pilot); });
      if (alt < 150 / FT * 3 && alt > 6 && vh > 2.5) {
        const fwd = hvx * heading0(sim).x + hvz * heading0(sim).z, rt = -hvx * heading0(sim).z + hvz * heading0(sim).x;
        const dir = Math.abs(fwd) > Math.abs(rt) ? (fwd > 0 ? "forward" : "back") : rt > 0 ? "right" : "left";
        once("drift", () => { traceEvent(`drifting ${dir} ${(vh * FT).toFixed(0)} ft/s`); say(driftCall(dir, vh * FT)); });
      }
      if (sim.auto !== st.lastAuto) { st.lastAuto = sim.auto; traceEvent(sim.auto ? "autopilot engaged" : "autopilot off"); say(autopilotCall(sim.auto)); }
      if (sim.contact) once("contact", () => { traceEvent("contact light"); sfx("hiss", { volume: 0.1 }); say(contactLight()); });
    }
    st.prevAlt = alt;
    if (sim.down && sim.result) {
      once("down", () => {
        const r = sim.result!;
        const hit = r.reason === "crashed" ? [COST.fatal, "The lander crashed"] : r.reason === "tipped" ? [COST.severe, `Tipped over (${r.tilt.toFixed(0)} deg, legs allow ${r.limit.toFixed(0)})`]
          : r.reason === "hard" ? [r.vV > P.vSafe * 1.6 ? COST.severe : COST.major, `Hard landing (${(r.vV * FT).toFixed(0)} ft/s)`] : r.reason === "boulder" ? [COST.major, "A foot landed on a boulder"] : null;
        if (hit) flightDamage(hit[0] as number, hit[1] as string, pilot);
        if (pilot && r.reason === "ok") patch("landing", { sink: Math.round(r.vV * 100) / 100 }); // personal record: softest landing
        sfx("thunk", { volume: r.reason === "crashed" ? 1 : 0.7 });
        // juice: a PERFECT landing is soft, level and on the ring; anything clean pays by the score
        const perfect = r.reason === "ok" && r.vV <= P.vSafe * 0.6 && r.vH <= 0.8 && r.tilt <= r.limit * 0.4 && r.miss <= 15 && !sim.assisted;
        if (perfect) {
          flags.perfect = sim.att;
          slowmo(0.22, 2.6);
          dust.current.burst = 1;
          grade("landing", r.score.total, { title: "Touchdown", perfect: true, once: `landing-perfect:${useStore.getState().state?.plan?.id}:${sim.att}` });
          award(250, "Perfect landing", { tone: "amber", at: { x: 0.5, y: 0.52 } });
        } else if (r.reason === "ok") { award(60 + Math.round(r.score.total / 2), "Safe touchdown", { at: { x: 0.5, y: 0.5 } }); stinger("great", 0.5); }
        else if (r.reason === "boulder") miss();
        traceEvent(`touchdown: ${r.reason}, ${(r.vV * FT).toFixed(1)} ft/s down, ${(r.vH * FT).toFixed(1)} ft/s sideways, tilt ${r.tilt.toFixed(1)}, ${Math.round(r.miss)} m off`);
        if (live) {
          if (r.reason === "crashed") say(touchdownReport({ reason: r.reason, downFps: r.vV * FT, fwdFps: r.vH * FT, tiltDeg: r.tilt, missM: r.miss }), { interrupt: true });
          else say([engineStop(), ...touchdownReport({ reason: r.reason, downFps: r.vV * FT, fwdFps: r.vH * FT, tiltDeg: r.tilt, missM: r.miss })]);
        }
      });
    }

    // ---- pose
    const g = root.current;
    const up = upVec(sim, st.up);
    bodyBasis(sim, up, st.basis);
    const b = st.basis;
    st.ex.set(b[0], b[1], b[2]); st.ey.set(b[3], b[4], b[5]); st.ez.set(b[6], b[7], b[8]);
    st.m4.makeBasis(st.ex, st.ey, st.ez);
    st.q0.setFromRotationMatrix(st.m4);
    if (sim.down && !st.settled) {
      st.settled = true;
      const n = footPlane(ground, sim.x, sim.z, P.padR);
      st.n = n;
    }
    if (g) {
      if (!sim.down) {
        g.quaternion.copy(st.q0);
        g.position.set(sim.x, sim.y, sim.z);
      } else {
        const r = sim.result;
        const n = st.n;
        if (r && r.reason === "tipped") {
          // topples toward the downhill side (or the way it was leaning)
          const hm = Math.hypot(n[0], n[2]);
          const dx = hm > 0.02 ? n[0] / hm : r.tx, dz = hm > 0.02 ? n[2] / hm : r.tz;
          const th = 82 * D2R;
          st.a.set(dx * Math.sin(th), Math.cos(th), dz * Math.sin(th));
          st.qT.setFromUnitVectors(st.ey, st.a).multiply(st.q0);
          st.qOut.copy(st.q0).slerp(st.qT, ss(0.3, 3.4, st.since));
        } else if (r && r.reason === "crashed") {
          const th = 38 * D2R;
          st.a.set(r.tx * Math.sin(th), Math.cos(th), r.tz * Math.sin(th));
          st.qT.setFromUnitVectors(st.ey, st.a).multiply(st.q0);
          st.qOut.copy(st.q0).slerp(st.qT, ss(0, 0.7, st.since));
        } else {
          st.a.set(n[0], n[1], n[2]);
          st.qT.setFromUnitVectors(st.ey, st.a).multiply(st.q0);
          st.qOut.copy(st.q0).slerp(st.qT, ss(0, 0.9, st.since));
        }
        g.quaternion.copy(st.qOut);
        const yy = groundedY(data, sim.x, sim.z, st.qOut, local, st.tmp);
        g.position.set(sim.x, st.since < 0.25 ? sim.y + (yy - sim.y) * ss(0, 0.25, st.since) : yy, sim.z);
      }
    }

    // ---- engine, dust, lights
    if (!sim.down) dust.current.burst = 0;
    thr.current = sim.down ? 0 : sim.thr * (1 + 0.05 * Math.sin(sim.t * 37));
    dust.current.x = sim.x;
    dust.current.z = sim.z;
    dust.current.strength = sim.down
      ? (sim.result?.reason === "crashed" ? 0.9 * Math.exp(-st.since * 1.6) : (dust.current.burst ?? 0) > 0 ? 0.8 * Math.exp(-st.since * 1.1) * (dust.current.burst ?? 0) : 0)
      : thr.current * ss(80, 14, alt);
    if (lights.current) lights.current.visible = (sim.down || sim.contact) && Math.sin(sim.t * 9) > -0.35;

    // ---- terrain detail and shadows follow the lander
    if (Math.hypot(sim.x - st.lastFocus[0], sim.z - st.lastFocus[1]) > 70) {
      st.lastFocus = [sim.x, sim.z];
      onFocus(sim.x, sim.z);
    }

    // ---- camera: chase behind and above, looking toward the zone; low and to the side once down
    cam.near = 0.3;
    const fxh = sim.fx, fzh = sim.fz;
    const gy = data.heightAt(sim.x, sim.z);
    if (!sim.down) {
      const d = clamp(40 + 0.2 * alt, 40, 95);
      const u = clamp(8 + 0.16 * alt, 8, 45);
      st.want.set(sim.x - fxh * d, sim.y + u, sim.z - fzh * d);
      st.want.y = Math.max(st.want.y, data.heightAt(st.want.x, st.want.z) + 4);
      // aim between the lander and the landing zone, so the zone is in frame during the approach
      const w = 0.35 * ss(8, 60, alt);
      st.look.set(sim.x + (target.x - sim.x) * w, sim.y + (data.heightAt(target.x, target.z) - sim.y) * w * 0.9 + 2, sim.z + (target.z - sim.z) * w);
    } else {
      st.orbit += dt * 0.12;
      const a = Math.atan2(fzh, fxh) + Math.PI + 0.9 + st.orbit;
      const rad = sim.result?.reason === "tipped" ? 46 : 36;
      st.want.set(sim.x + Math.cos(a) * rad, 0, sim.z + Math.sin(a) * rad);
      st.want.y = data.heightAt(st.want.x, st.want.z) + 4;
      st.look.set(sim.x, gy + 3, sim.z);
    }
    if (!st.camInit) { st.camInit = true; st.camP.copy(st.want); st.camL.copy(st.look); }
    const kp = 1 - Math.exp(-dt * (sim.down ? 1.6 : 4.5));
    st.camP.lerp(st.want, kp);
    st.camL.lerp(st.look, 1 - Math.exp(-dt * 6));
    cam.position.copy(st.camP);
    if (thr.current > 0.05 && alt < 90) {
      const a = 0.05 * thr.current * ss(90, 5, alt);
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
    }
    cam.lookAt(st.camL);
    const fov = sim.down ? 50 : 46;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    // ---- telemetry for the HUD (10 Hz)
    const now = performance.now();
    if (now - st.lastUi > 100) {
      st.lastUi = now;
      const n = footPlane(ground, sim.x, sim.z, P.padR);
      const rx = -fzh, rz = fxh;
      const tx = target.x - sim.x, tz = target.z - sim.z;
      const hud: LandHud = {
        t: sim.t, att: sim.att, alt, vy: sim.vy, hs: vh, vf: hvx * fxh + hvz * fzh, vr: hvx * rx + hvz * rz, thr: sim.thr,
        fuelPct: (100 * sim.fuel) / P.fuel0, fuelSec: fuelSeconds(sim),
        leanF: sim.lf * R2D, leanR: sim.lr * R2D,
        slopeF: Math.atan2(n[0] * fxh + n[2] * fzh, n[1]) * R2D, slopeR: Math.atan2(n[0] * rx + n[2] * rz, n[1]) * R2D,
        tgtF: tx * fxh + tz * fzh, tgtR: tx * rx + tz * rz, hover: sim.hover, auto: sim.auto, vt: sim.vt,
        contact: sim.contact, down: sim.down, since: st.since, result: sim.result, retries: sim.retries, assisted: sim.assisted,
      };
      useLanding.setState({ s: hud });
    }
  });

  useCameraShake(0.2);

  const pad = P.padR;
  const tgtY = data.heightAt(target.x, target.z);
  return (
    <>
      <group ref={root}>
        <Lander parts={parts} legsDeployed assembled={1} heat={0.6} />
        <Plume throttle={thr} y={0.9} />
        <group ref={lights} visible={false}>
          {[0, 1, 2, 3].map((k) => {
            const a = Math.PI / 4 + (k * Math.PI) / 2;
            return (
              <mesh key={k} position={[Math.sin(a) * pad, 0.5, Math.cos(a) * pad]}>
                <sphereGeometry args={[0.28, 10, 8]} />
                <meshBasicMaterial color={[0.3, 1.2, 3.2]} toneMapped={false} />
              </mesh>
            );
          })}
        </group>
      </group>
      <Dust data={data} state={dust} />
      {/* the landing zone: a beam to find it from far away, a ring on the ground at the scale of the lander, and the wider scatter ring */}
      {!landed && <Beacon position={[target.x, tgtY, target.z]} color="#b87a14" height={140} size={5} />}
      <GroundRing data={data} x={target.x} z={target.z} radius={15} width={0.8} color="#ffb020" opacity={0.75} tone={1.3} />
      <GroundRing data={data} x={target.x} z={target.z} radius={ringR} width={0.7} color="#6fd3ff" opacity={0.4} tone={1.2} segments={160} />
    </>
  );
}

const hv = { x: 0, z: 0 };
function heading0(s: LandSim) {
  hv.x = s.fx; hv.z = s.fz;
  return hv;
}

export function Scene() {
  const { plan } = useGame();
  const q = useQuality();
  const sd = usePhaseData<SiteData>("site");
  const build = usePhaseData<{ parts: Record<string, string> }>("build");
  const siteId = sd.site_id ?? plan?.destination.candidate_sites[0]?.id ?? "site_a";
  const data = useTerrainData(siteId);
  const parts = useMemo(() => ({ ...getDefaultParts(), ...(build.parts ?? {}) }), [build.parts]);
  const lander = useMemo(() => landerFromBuild(parts), [parts]);
  const sky = useMemo(
    () => (data ? skyAt(data.ephemeris, data.meta.center.lat, data.meta.center.lon, missionTime(plan)) : null),
    [data, plan],
  );
  const diff = devDifficulty(plan?.difficulty);
  const target = useMemo(() => {
    if (sd.probe) return { x: sd.probe.x, z: sd.probe.z };
    // no probe (a dev jump straight into this phase): the flattest spot near the middle of the map
    if (!data) return { x: 0, z: 0 };
    let best = { x: 0, z: 0 }, bestS = 1e9;
    for (let x = -300; x <= 300; x += 20) for (let z = -300; z <= 300; z += 20) {
      const v = data.slopeDegAt(x, z, 4) + 0.01 * Math.hypot(x, z);
      if (data.inside(x, z, 120) && v < bestS) { bestS = v; best = { x, z }; }
    }
    return best;
  }, [sd.probe, data]);
  const fx = perkEffects(usePerk());
  const up = useUpgrades(); // hangar fuel tank; the arcade lander never reads this
  const P = useMemo(
    () => landParams(diff, {
      limitDeg: sd.sim?.tilt_limit_deg ?? lander.max_tilt_deg,
      deltaV: shipStats(parts as never).deltaV || 2500,
      fuelMult: fx.hoverTime * up.fuelMult,
      padR: lander.leg_span_m / 2,
    }),
    [diff, sd.sim?.tilt_limit_deg, lander.max_tilt_deg, lander.leg_span_m, parts, fx.hoverTime, up.fuelMult],
  );
  // the boulders drawn around the zone are the ones that can damage a foot (same deterministic list as <Boulders/>)
  const seed = plan?.seed ?? 1;
  const ground = useMemo<Ground | null>(() => {
    if (!data) return null;
    const list = scatterBoulders(data, target.x, target.z, 220, seed + (data.siteId.charCodeAt(5) ?? 0) * 977, Math.round(1000 * q.instances));
    return { h: data.heightAt, boulders: list.filter((b) => b.size >= 0.5), half: data.size / 2 };
  }, [data, target, seed, q.instances]);
  const heading = useMemo(() => {
    if (!sky) return 0;
    // look across the Sun (long shadows show the relief); the seed picks which side
    const az = (sky.sunAzDeg + (seed % 2 ? 90 : -90)) * D2R;
    return Math.atan2(-Math.cos(az), Math.sin(az));
  }, [sky, seed]);
  const [foc, setFoc] = useState<{ x: number; z: number } | null>(null);
  const onFocus = useCallback((x: number, z: number) => setFoc({ x, z }), []);
  const f = foc ?? target;
  const focus2 = useMemo<[number, number]>(() => [f.x, f.z], [f.x, f.z]);
  const focus3 = useMemo<[number, number, number]>(() => [f.x, data ? data.heightAt(f.x, f.z) : 0, f.z], [f.x, f.z, data]);
  const ringR = Math.min(180, Math.max(40, sd.sim?.ellipse?.radius95_m ?? 120));
  const siteName = plan?.destination.candidate_sites.find((c) => c.id === siteId)?.name ?? "the landing site";
  useLoadingHold(!data || !sky || !ground, "Loading the landing site terrain · NASA LOLA");
  if (!data || !sky || !ground) return null;
  return (
    <>
      <SunLight sky={sky} shadows focus={focus3} radius={95} />
      <GroundBounce sky={sky} />
      <LunarSky sky={sky} stars={0.85} />
      <Terrain data={data} sky={sky} detail shadows focus={focus2} fill={0.13} maxSegments={300} edgeFade />
      <Boulders data={data} focus={[target.x, target.z]} shadows seed={seed} />
      <Descent data={data} ground={ground} P={P} target={target} heading={heading} parts={parts} siteName={siteName} ringR={ringR} onFocus={onFocus} penalty={diff === "normal" ? 8 : 0} />
      <RenderInfo />
      <Effects bloom={0.8} ao={false} />
    </>
  );
}

