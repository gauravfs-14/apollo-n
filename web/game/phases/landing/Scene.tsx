"use client";
/* eslint-disable react-hooks/immutability */
// Powered descent of the crew's own lander onto the spot they chose. The touchdown is one seeded sample of the
// Monte Carlo landings (position, tilt, outcome); final attitude follows the real DEM under the feet.
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Effects } from "../../core/Effects";
import { sfx } from "../../core/audio";
import { clearComms, say } from "../../core/comms";
import { altitudeCall, contact, descentStart, goForLanding, landed as landedReport } from "../../data/missionComms";
import { preload } from "../../core/comms";
import { useStore } from "../../core/store";
import { useGame, usePhaseData } from "../../core/useGame";
import { Boulders, GroundBounce, LunarSky, RenderInfo, SunLight, Terrain, missionTime, skyAt, useTerrainData, type TerrainData } from "../../three/terrain";
import { Lander, getDefaultParts } from "../../three/ship/Lander";
import { legFootX } from "../../three/ship/builders";
import { landerFromBuild, type SimOut } from "../site/api";
import { Dust, type DustState } from "./Dust";
import { pickOutcome, type Outcome } from "./outcome";
import { Plume } from "./Plume";
import { DESCENT, TOTAL, useLanding } from "./store";
import { useLoadingHold } from "../../core/loading";
import { isRevealed, useRevealed } from "../../core/loading";
import { traceEvent } from "../../core/comms";

const A0 = 450; // start altitude above the touchdown point (m)
const H0 = 300; // start horizontal distance (m)
const D2R = Math.PI / 180;
const ss = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const compass = (deg: number, out: THREE.Vector3) => out.set(Math.sin(deg * D2R), 0, -Math.cos(deg * D2R));
const T_CONTACT = DESCENT * (1 - Math.pow(0.15 / A0, 1 / 2.6));
const FT = 3.281;
/** Sink rate (ft/s) at height h (m) on the descent profile alt = A0·(1 − t/DESCENT)^2.6. */
const sinkAt = (h: number) => (2.6 * A0 / DESCENT) * Math.pow(h / A0, 1.6 / 2.6) * FT;
// the calls, made at the heights they name, with the lander's real sink rate there
const CALLS = [
  { alt: 250, line: goForLanding() },
  ...[400, 200, 100, 40].map((ft, i, a) => ({ alt: ft / FT, line: altitudeCall(ft, sinkAt(ft / FT), i === a.length - 1) })),
];

interface SiteData {
  site_id: string;
  probe: { x: number; z: number };
  sim: SimOut;
}

useGLTF.preload("/models/rock_moon_a.glb");

/** y offset so the lowest contact point rests on the DEM, for a given pose. */
function groundedY(
  data: TerrainData, x: number, z: number, q: THREE.Quaternion, local: THREE.Vector3[], tmp: THREE.Vector3,
) {
  let y = -1e9;
  for (const p of local) {
    tmp.copy(p).applyQuaternion(q);
    y = Math.max(y, data.heightAt(x + tmp.x, z + tmp.z) - tmp.y);
  }
  return y;
}

function leanQuat(dx: number, dz: number, tiltDeg: number, yawRad: number, out: THREE.Quaternion, tq: THREE.Quaternion) {
  const T = tiltDeg * D2R;
  const up = new THREE.Vector3(Math.sin(T) * dx, Math.cos(T), Math.sin(T) * dz);
  out.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  tq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
  out.multiply(tq);
}

function Descent({ data, outcome, parts, sky, footR, siteRock }: { data: TerrainData; outcome: Outcome; parts: Record<string, string>; sky: ReturnType<typeof skyAt>; footR: number; siteRock: boolean }) {
  const root = useRef<THREE.Group>(null);
  const thr = useRef(0);
  const dust = useRef<DustState>({ x: 0, z: 0, strength: 0 });
  const lights = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const t = useRef(typeof location !== "undefined" ? Number(new URLSearchParams(location.search).get("t")) || 0 : 0); // ?t= jumps the timeline (dev)
  const flags = useRef({ started: false, contact: false, ended: false, reported: false, lastUi: 0 });
  const calls = useRef(new Set<number>());
  // the descent loop opens when the scene is on screen
  const revealed = useRevealed("landing");
  useEffect(() => {
    if (!revealed) return;
    const st = useStore.getState().state;
    const siteId = (st?.phaseData.site as { site_id?: string } | undefined)?.site_id;
    const siteName = st?.plan?.destination.candidate_sites.find((c) => c.id === siteId)?.name ?? "the landing site";
    say(descentStart(siteName), { once: `descent:${st?.plan?.id}` });
    CALLS.forEach((c) => preload(c.line)); // ready before each height is reached
  }, [revealed]);
  const q0 = useMemo(() => new THREE.Quaternion(), []);
  const q1 = useMemo(() => new THREE.Quaternion(), []);
  const tq = useMemo(() => new THREE.Quaternion(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const v1 = useMemo(() => new THREE.Vector3(), []);
  const v2 = useMemo(() => new THREE.Vector3(), []);
  const prev = useRef({ alt: A0, hx: 0, hz: 0 });
  const camAz = sky.sunAzDeg + 80;
  const approachAz = camAz + 110;

  // contact points in lander-local space: four footpads, four deck corners, the top of the mast
  const local = useMemo(() => {
    const v = ((parts.legs ?? "legs_a").slice(-1).charCodeAt(0) - 97 + 3) % 3;
    const r = 2.02 + legFootX(v);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      pts.push(new THREE.Vector3(Math.sin(a) * r, 0.05, Math.cos(a) * r));
      pts.push(new THREE.Vector3(Math.sin(a) * 2.7, 3.3, Math.cos(a) * 2.7));
    }
    pts.push(new THREE.Vector3(0, 6.8, 0));
    return pts;
  }, [parts.legs]);
  void footR;

  const gx = outcome.x;
  const gz = outcome.z;
  const gy = data.heightAt(gx, gz);
  const finalTilt = (s: number) => {
    if (outcome.reason === "tipped") return outcome.tilt + (82 - outcome.tilt) * ss(T_CONTACT + 0.5, T_CONTACT + 3.6, s);
    if (outcome.reason === "boulder") return outcome.tilt + 2.2 * ss(T_CONTACT + 0.2, T_CONTACT + 1.2, s);
    return outcome.tilt;
  };

  useEffect(() => {
    useLanding.setState({ t: 0, skipRequested: false, contact: false, ready: true, tele: { alt: A0, vs: 0, hs: 0, thr: 0 } });
    // the descent engine is felt through the structure, not a launch roar: a low rumble under the radio
    sfx("rumble", { volume: 0.35 });
    return () => {
      useLanding.setState({ ready: false });
    };
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const ui = useLanding.getState();
    if (ui.skipRequested && t.current < TOTAL) {
      t.current = TOTAL;
      flags.current.contact = true;
      clearComms();
      useLanding.setState({ contact: true });
    } else if (isRevealed("landing")) t.current = Math.min(TOTAL, t.current + dt); // starts when visible
    const tt = t.current;
    const s = Math.min(1, tt / DESCENT);
    const lift = tt >= T_CONTACT ? 0 : A0 * Math.pow(1 - s, 2.6);
    const horiz = tt >= T_CONTACT ? 0 : H0 * Math.pow(1 - s, 2);
    compass(approachAz, v1);
    const px = gx + v1.x * horiz;
    const pz = gz + v1.z * horiz;

    // attitude: retro-pitched while braking, then settles onto the real ground normal
    const pitch = 26 * Math.pow(1 - s, 1.6);
    const landed = ss(0.9, 1.0, s);
    if (landed < 1) {
      // braking: the thrust axis leans back toward where the lander came from
      leanQuat(v1.x, v1.z, pitch, outcome.yaw, q0, tq);
      leanQuat(outcome.dx, outcome.dz, finalTilt(tt), outcome.yaw, q1, tq);
      q0.slerp(q1, landed);
    } else {
      leanQuat(outcome.dx, outcome.dz, finalTilt(tt), outcome.yaw, q0, tq);
    }
    const g = root.current;
    if (g) {
      g.quaternion.copy(q0);
      const yy = groundedY(data, px, pz, q0, local, tmp) + lift + (tt > T_CONTACT && tt < T_CONTACT + 0.6 ? -0.1 * Math.exp(-(tt - T_CONTACT) * 7) : 0);
      g.position.set(px, yy, pz);
    }

    // engine + dust
    const burning = tt < T_CONTACT + 0.35;
    const t1 = burning ? (0.5 + 0.4 * (1 - s) + 0.06 * Math.sin(tt * 37)) * (1 - ss(T_CONTACT, T_CONTACT + 0.35, tt)) : 0;
    thr.current = ui.skipRequested ? 0 : t1;
    dust.current.x = px;
    dust.current.z = pz;
    dust.current.strength = thr.current * ss(80, 14, lift);

    // the crew's altitude calls, as the lander passes each height
    if (!ui.skipRequested) {
      CALLS.forEach((c, i) => {
        if (lift <= c.alt && tt < T_CONTACT && !calls.current.has(i)) {
          calls.current.add(i);
          say(c.line);
        }
      });
    }

    // contact lights + voice
    if (!flags.current.contact && tt >= T_CONTACT) {
      flags.current.contact = true;
      useLanding.setState({ contact: true });
      sfx("thunk", { volume: 0.7 });
      traceEvent("touchdown (contact)");
      sfx("hiss", { volume: 0.15 });
      if (!ui.skipRequested) say(contact(), { interrupt: true });
    }
    if (!flags.current.reported && tt >= T_CONTACT + 2.2 && !ui.skipRequested) {
      flags.current.reported = true;
      say(landedReport(outcome.reason as "ok" | "boulder" | "tipped", outcome.tilt));
    }
    if (lights.current) lights.current.visible = tt >= T_CONTACT && Math.sin(tt * 9) > -0.35;

    // cameras
    cam.near = 0.3;
    let fov = 45;
    if (s < 0.45) {
      // chase cam above and beside the lander, tilted down so the real ground and horizon stay in frame
      const gp = g!.position;
      const u = Math.min(70, Math.max(14, lift * 0.3));
      const d = Math.min(62, Math.max(42, 40 + lift * 0.1));
      fov = 46;
      compass(camAz, v2).multiplyScalar(d);
      const cx = gp.x + v2.x;
      const cz = gp.z + v2.z;
      cam.position.set(cx, Math.max(gp.y + u, data.heightAt(cx, cz) + 6), cz);
      // aim a little below the lander so it sits in the upper part of the frame with terrain beneath
      const dep = Math.min(Math.atan2(cam.position.y - gp.y, d) + 13 * D2R, 82 * D2R);
      v1.set(-v2.x, 0, -v2.z).normalize().multiplyScalar(Math.cos(dep)).setY(-Math.sin(dep));
      cam.lookAt(tmp.copy(cam.position).addScaledVector(v1, 100));
    } else if (s < 0.75) {
      // low ground-level shot as it settles: horizon behind, lander large
      fov = 50;
      compass(camAz, v2).multiplyScalar(72);
      cam.position.set(gx + v2.x, data.heightAt(gx + v2.x, gz + v2.z) + 3.5, gz + v2.z);
      v1.set(gx, gy + (g!.position.y - gy) * 0.8 + 2, gz);
      cam.lookAt(v1);
    } else if (s < 0.93) {
      fov = 42;
      compass(camAz + 25, v2).multiplyScalar(68);
      cam.position.set(gx + v2.x, data.heightAt(gx + v2.x, gz + v2.z) + 2.4, gz + v2.z);
      v1.copy(g!.position);
      v1.y += 3;
      cam.lookAt(v1);
    } else {
      fov = 50;
      const o = (tt - DESCENT * 0.93) / (TOTAL - DESCENT * 0.93);
      const rad = outcome.reason === "tipped" ? 42 : 30;
      compass(camAz + 25 + 55 * o, v2).multiplyScalar(rad);
      cam.position.set(gx + v2.x, data.heightAt(gx + v2.x, gz + v2.z) + 3.6 + 2.5 * o, gz + v2.z);
      v1.copy(g!.position);
      v1.y += 3;
      cam.lookAt(v1);
    }
    // rumble in the last stretch of the burn
    if (thr.current > 0.05 && s > 0.3) {
      const a = 0.04 * thr.current * ss(90, 5, lift);
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // telemetry for the HUD (10 Hz)
    const now = performance.now();
    if (now - flags.current.lastUi > 100) {
      flags.current.lastUi = now;
      const p = prev.current;
      const d = Math.max(1e-3, (now - (flags.current.lastUi - 100)) / 1000);
      void d;
      useLanding.setState({
        t: tt,
        tele: {
          alt: Math.max(0, lift),
          vs: (lift - p.alt) / 0.1,
          hs: Math.hypot(px - p.hx, pz - p.hz) / 0.1,
          thr: thr.current,
        },
      });
      prev.current = { alt: lift, hx: px, hz: pz };
    }
    if (tt >= TOTAL && !flags.current.ended) {
      flags.current.ended = true;
      useLanding.setState({ t: TOTAL });

    }
  });

  const pad = useMemo(() => {
    const v = ((parts.legs ?? "legs_a").slice(-1).charCodeAt(0) - 97 + 3) % 3;
    return 2.02 + legFootX(v);
  }, [parts.legs]);

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
      {siteRock && <FootRock data={data} outcome={outcome} pad={pad} />}
    </>
  );
}

/** A real boulder under one footpad when the outcome was "boulder". */
function FootRock({ data, outcome, pad }: { data: TerrainData; outcome: Outcome; pad: number }) {
  const g = useGLTF("/models/rock_moon_a.glb");
  const obj = useMemo(() => {
    let mesh: THREE.Mesh | null = null;
    g.scene.traverse((o) => {
      if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
    });
    const src = mesh as unknown as THREE.Mesh;
    const geo = src.geometry.clone();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    geo.translate(-(bb.max.x + bb.min.x) / 2, -bb.min.y - 0.15 * (bb.max.y - bb.min.y), -(bb.max.z + bb.min.z) / 2);
    geo.scale(1 / ext, 1 / ext, 1 / ext);
    const m = new THREE.Mesh(geo, (src.material as THREE.Material).clone());
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }, [g]);
  const a = outcome.yaw + Math.PI / 4;
  const x = outcome.x + Math.sin(a) * pad;
  const z = outcome.z + Math.cos(a) * pad;
  obj.position.set(x, data.heightAt(x, z), z);
  obj.scale.set(1.7, 1.2, 1.5);
  return <primitive object={obj} />;
}

export function Scene() {
  const { plan } = useGame();
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
  const outcome = useMemo(
    () => (data ? pickOutcome(sd.sim, sd.probe, plan?.seed ?? 1, data, lander.leg_span_m / 2) : null),
    [data, sd.sim, sd.probe, plan?.seed, lander.leg_span_m],
  );
  useLoadingHold(!data || !sky || !outcome, "Loading the landing site terrain · NASA LOLA");
  if (!data || !sky || !outcome) return null;
  const focusY = data.heightAt(outcome.x, outcome.z);
  return (
    <>
      <SunLight sky={sky} shadows focus={[outcome.x, focusY, outcome.z]} radius={95} />
      <GroundBounce sky={sky} />
      <LunarSky sky={sky} stars={0.85} />
      <Terrain data={data} sky={sky} detail shadows focus={[outcome.x, outcome.z]} fill={0.13} maxSegments={300} edgeFade />
      <Boulders data={data} focus={[outcome.x, outcome.z]} shadows seed={plan?.seed ?? 1} />
      <Descent data={data} outcome={outcome} parts={parts} sky={sky} footR={lander.leg_span_m / 2} siteRock={outcome.reason === "boulder"} />
      <RenderInfo />
      <Effects bloom={0.8} ao={false} />
    </>
  );
}
