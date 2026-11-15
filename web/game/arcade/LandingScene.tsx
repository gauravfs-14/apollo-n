"use client";
/* eslint-disable react-hooks/immutability */
// The Landing Challenge scene: the player-flown powered descent (phases/landing/sim.ts) over the real LOLA terrain, solo and
// seeded. Same physics, controls, dust and plume as the mission; no radio, crew sync or damage. Records the last 10 s for the replay.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Effects } from "../core/Effects";
import { sfx } from "../core/audio";
import { GroundRing } from "../flight/GroundRing";
import { axis, clearEdges, held, installKeys, take } from "../flight/input";
import { Dust, type DustState } from "../phases/landing/Dust";
import { Plume } from "../phases/landing/Plume";
import {
  bodyBasis, footPlane, stepLand, upVec, type LandInput, type LandSim,
} from "../phases/landing/sim";
import { Lander, getDefaultParts } from "../three/ship/Lander";
import {
  Beacon, Boulders, GroundBounce, LunarSky, RenderInfo, SunLight, Terrain, skyAt, useTerrainData, type TerrainData,
} from "../three/terrain";
import { buildLanding, challengeParams, driftAt, makeGround, siteForSeed, skyTimeForSeed, startSim, type LandingConfig } from "./landing";
import { Recorder, buildReplay } from "./replay";
import { PAD_R, scoreLanding } from "./scoring";
import { useArcade, type LandTelem } from "./store";

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const PARTS = getDefaultParts();

function groundedY(data: TerrainData, x: number, z: number, q: THREE.Quaternion, local: THREE.Vector3[], tmp: THREE.Vector3) {
  let y = -1e9;
  for (const p of local) {
    tmp.copy(p).applyQuaternion(q);
    y = Math.max(y, data.heightAt(x + tmp.x, z + tmp.z) - tmp.y);
  }
  return y;
}

export function LandingScene({ seed, run, onRetry }: { seed: number; run: number; onRetry: () => void }) {
  const siteId = siteForSeed(seed);
  const data = useTerrainData(siteId);
  const sky = useMemo(() => (data ? skyAt(data.ephemeris, data.meta.center.lat, data.meta.center.lon, skyTimeForSeed(seed)) : null), [data, seed]);
  const config = useMemo(() => (data ? buildLanding(seed, data) : null), [data, seed]);
  const ground = useMemo(() => (data && config ? makeGround(data, config) : null), [data, config]);
  const [foc, setFoc] = useState<{ x: number; z: number } | null>(null);
  useEffect(() => {
    // a new seed: back to the loading veil until its terrain is in (the flight sets loaded again when it mounts)
    if (!config) useArcade.setState({ loaded: false, result: null, land: null, launch: null, info: { seed, site: siteId, siteName: "" } });
  }, [seed, siteId, config]);
  if (!data || !sky || !config || !ground) return null;
  const f = foc ?? config.target;
  return (
    <>
      <SunLight sky={sky} shadows focus={[f.x, data.heightAt(f.x, f.z), f.z]} radius={95} />
      <GroundBounce sky={sky} />
      <LunarSky sky={sky} stars={0.85} />
      <Terrain data={data} sky={sky} detail shadows focus={[f.x, f.z]} fill={0.13} maxSegments={300} edgeFade />
      <Boulders data={data} focus={[config.target.x, config.target.z]} shadows seed={config.seed} />
      <Flight key={`${seed}-${run}`} data={data} config={config} ground={ground} run={run} onRetry={onRetry} onFocus={(x, z) => setFoc({ x, z })} />
      <RenderInfo />
      <Effects bloom={0.8} ao={false} />
    </>
  );
}

function Flight({ data, config, ground, run, onRetry, onFocus }: { data: TerrainData; config: LandingConfig; ground: ReturnType<typeof makeGround>; run: number; onRetry: () => void; onFocus: (x: number, z: number) => void }) {
  const { camera } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const P = useMemo(() => challengeParams(), []);
  const sim = useMemo<LandSim>(() => startSim(config, ground, P, run + 1), [config, ground, P, run]);
  const rec = useMemo(() => new Recorder(), []);
  const root = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Group>(null);
  const lights = useRef<THREE.Group>(null);
  const thr = useRef(0);
  const dust = useRef<DustState>({ x: 0, z: 0, strength: 0 });
  const st = useMemo(() => ({
    lastUi: 0, since: 0, settled: false, lastFocus: [1e9, 1e9] as [number, number], camInit: false, orbit: 0, finished: false,
    n: [0, 1, 0] as readonly [number, number, number],
    q0: new THREE.Quaternion(), qT: new THREE.Quaternion(), qOut: new THREE.Quaternion(), m4: new THREE.Matrix4(),
    ex: new THREE.Vector3(), ey: new THREE.Vector3(), ez: new THREE.Vector3(), a: new THREE.Vector3(),
    camP: new THREE.Vector3(), camL: new THREE.Vector3(), want: new THREE.Vector3(), look: new THREE.Vector3(), tmp: new THREE.Vector3(),
    up: [0, 1, 0] as [number, number, number], basis: new Array<number>(9).fill(0), w: { x: 0, z: 0 },
    inp: { thr: 0, cut: false, full: false, lf: 0, lr: 0 } as LandInput,
  }), []);
  const local = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      pts.push(new THREE.Vector3(Math.sin(a) * PAD_R, 0.05, Math.cos(a) * PAD_R));
      pts.push(new THREE.Vector3(Math.sin(a) * 2.7, 3.3, Math.cos(a) * 2.7));
    }
    pts.push(new THREE.Vector3(0, 6.8, 0));
    return pts;
  }, []);

  useEffect(() => installKeys(), []);
  useEffect(() => {
    clearEdges();
    useArcade.setState({ loaded: true, result: null, land: null, limit: P.limit, info: { seed: config.seed, site: config.siteId, siteName: config.siteName, startAlt: config.startAlt, startDist: config.startDist } });
    sfx("rumble", { volume: 0.3 });
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __landSim: sim, __landTarget: config.target, __landConfig: config });
  }, [sim, config, P]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    if (take("KeyR")) { onRetry(); return; }
    if (!sim.down) {
      const inp = st.inp;
      inp.thr = axis(["KeyS"], ["KeyW"]);
      inp.lf = axis(["ArrowDown"], ["ArrowUp"]);
      inp.lr = axis(["ArrowLeft"], ["ArrowRight"]);
      inp.cut = held("KeyX");
      inp.full = held("ShiftLeft", "ShiftRight");
      if (take("KeyH") && P.hoverAvail) {
        sim.hover = !sim.hover;
        if (sim.hover) sim.vt = clamp(sim.vy, -12, 3);
      }
      // the steady drift pushes the lander sideways (vacuum: it is an acceleration, there is no wind)
      driftAt(config, sim.t, st.w);
      sim.vx += st.w.x * dt; sim.vz += st.w.z * dt;
      stepLand(sim, dt, inp, ground, P, config.target);
      const u = upVec(sim, st.up);
      rec.push(sim.t, sim.x, sim.y, sim.z, u[0], u[2], sim.thr, sim.vy, Math.hypot(sim.vx, sim.vz), sim.alt, sim.down);
    }
    if (sim.down) st.since += dt;
    const alt = sim.alt;

    if (sim.down && sim.result && !st.finished) {
      st.finished = true;
      const r = sim.result;
      sfx("thunk", { volume: r.reason === "crashed" ? 1 : 0.7 });
      const scored = scoreLanding(r);
      const replay = buildReplay(rec, config.target, data.heightAt, data.meta.name);
      useArcade.setState({
        result: {
          challenge: "landing", seed: config.seed, scored, land: r, replay, timeS: sim.t,
          stats: { reason: r.reason, vV: r.vV, vH: r.vH, tilt: r.tilt, miss: r.miss, fuelPct: r.fuelPct, timeS: sim.t, site: config.siteId },
        },
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
    if (sim.down && !st.settled) { st.settled = true; st.n = footPlane(ground, sim.x, sim.z, PAD_R); }
    if (g) {
      if (!sim.down) {
        g.quaternion.copy(st.q0);
        g.position.set(sim.x, sim.y, sim.z);
      } else {
        const r = sim.result;
        const n = st.n;
        if (r && r.reason === "tipped") {
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

    thr.current = sim.down ? 0 : sim.thr * (1 + 0.05 * Math.sin(sim.t * 37));
    dust.current.x = sim.x;
    dust.current.z = sim.z;
    dust.current.strength = sim.down ? (sim.result?.reason === "crashed" ? 0.9 * Math.exp(-st.since * 1.6) : 0) : thr.current * ss(80, 14, alt);
    if (lights.current) lights.current.visible = (sim.down || sim.contact) && Math.sin(sim.t * 9) > -0.35;
    if (Math.hypot(sim.x - st.lastFocus[0], sim.z - st.lastFocus[1]) > 70) { st.lastFocus = [sim.x, sim.z]; onFocus(sim.x, sim.z); }

    // ---- chase camera
    cam.near = 0.3;
    const fxh = sim.fx, fzh = sim.fz;
    const gy = data.heightAt(sim.x, sim.z);
    if (!sim.down) {
      const d = clamp(40 + 0.2 * alt, 40, 95);
      const u = clamp(8 + 0.16 * alt, 8, 45);
      st.want.set(sim.x - fxh * d, sim.y + u, sim.z - fzh * d);
      st.want.y = Math.max(st.want.y, data.heightAt(st.want.x, st.want.z) + 4);
      const w = 0.35 * ss(8, 60, alt);
      st.look.set(sim.x + (config.target.x - sim.x) * w, sim.y + (data.heightAt(config.target.x, config.target.z) - sim.y) * w * 0.9 + 2, sim.z + (config.target.z - sim.z) * w);
    } else {
      st.orbit += dt * 0.12;
      const a = Math.atan2(fzh, fxh) + Math.PI + 0.9 + st.orbit;
      const rad = sim.result?.reason === "tipped" ? 46 : 36;
      st.want.set(sim.x + Math.cos(a) * rad, 0, sim.z + Math.sin(a) * rad);
      st.want.y = data.heightAt(st.want.x, st.want.z) + 4;
      st.look.set(sim.x, gy + 3, sim.z);
    }
    if (!st.camInit) { st.camInit = true; st.camP.copy(st.want); st.camL.copy(st.look); }
    st.camP.lerp(st.want, 1 - Math.exp(-dt * (sim.down ? 1.6 : 4.5)));
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

    // ---- telemetry (10 Hz)
    const now = performance.now();
    if (now - st.lastUi > 100) {
      st.lastUi = now;
      const n = footPlane(ground, sim.x, sim.z, PAD_R);
      const rx = -fzh, rz = fxh;
      const tx = config.target.x - sim.x, tz = config.target.z - sim.z;
      const hud: LandTelem = {
        t: sim.t, alt, vy: sim.vy, vf: sim.vx * fxh + sim.vz * fzh, vr: sim.vx * rx + sim.vz * rz, thr: sim.thr, fuelPct: (100 * sim.fuel) / P.fuel0,
        hover: sim.hover, vt: sim.vt, leanF: sim.lf * R2D, leanR: sim.lr * R2D,
        slopeF: Math.atan2(n[0] * fxh + n[2] * fzh, n[1]) * R2D, slopeR: Math.atan2(n[0] * rx + n[2] * rz, n[1]) * R2D,
        tgtF: tx * fxh + tz * fzh, tgtR: tx * rx + tz * rz, contact: sim.contact, down: sim.down, since: st.since,
      };
      useArcade.setState({ land: hud });
    }
    if (beacon.current) beacon.current.visible = !sim.down;
  });

  const tgtY = data.heightAt(config.target.x, config.target.z);
  return (
    <>
      <group ref={root}>
        <Lander parts={PARTS} legsDeployed assembled={1} heat={0.6} />
        <Plume throttle={thr} y={0.9} />
        <group ref={lights} visible={false}>
          {[0, 1, 2, 3].map((k) => {
            const a = Math.PI / 4 + (k * Math.PI) / 2;
            return (
              <mesh key={k} position={[Math.sin(a) * PAD_R, 0.5, Math.cos(a) * PAD_R]}>
                <sphereGeometry args={[0.28, 10, 8]} />
                <meshBasicMaterial color={[0.3, 1.2, 3.2]} toneMapped={false} />
              </mesh>
            );
          })}
        </group>
      </group>
      <Dust data={data} state={dust} />
      <group ref={beacon}><Beacon position={[config.target.x, tgtY, config.target.z]} color="#b87a14" height={140} size={5} /></group>
      <GroundRing data={data} x={config.target.x} z={config.target.z} radius={15} width={0.8} color="#ffb020" opacity={0.75} tone={1.3} />
      <GroundRing data={data} x={config.target.x} z={config.target.z} radius={6} width={0.5} color="#6fd3ff" opacity={0.5} tone={1.2} segments={64} />
    </>
  );
}
