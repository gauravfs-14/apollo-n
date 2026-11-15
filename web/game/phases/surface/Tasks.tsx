"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity */
// Task chain, world markers, role gating and the interactions for every task type.
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { say } from "../../core/comms";
import { egress, firstStep, goalAchieved, taskDone } from "../../data/missionComms";
import { useGame } from "../../core/useGame";
import type { MissionPlan, SurfaceTask } from "../../types";
import { EARTH_DIR, PLAY_RADIUS, SUN_DIR, type Ground } from "./ground";
import { barsFromMargin, layoutTasks, type TaskSpots } from "./layout";
import { ROLE_COLOR, rt, useSurface, type Guide } from "./store";
import { beep, chirp, thud } from "./synth";
import { useAr } from "./explore/arStore";
import { Label } from "./Label";
import { addDust } from "./Trail";


function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function activeTasks(plan: MissionPlan, done: Set<string>): SurfaceTask[] {
  const tasks = plan.surface.tasks;
  const referenced = new Set(tasks.map((t) => t.unlocks).filter(Boolean) as string[]);
  return tasks.filter((t) => !done.has(t.id) && (!referenced.has(t.id) || tasks.some((p) => done.has(p.id) && p.unlocks === t.id)));
}

export function finished(plan: MissionPlan, done: Set<string>) {
  return done.has(plan.surface.final) || plan.surface.tasks.every((t) => done.has(t.id));
}

export function surfaceScore(plan: MissionPlan, done: Set<string>, elapsed: number, mistakes: number) {
  const total = Math.max(1, plan.surface.tasks.length);
  const n = plan.surface.tasks.filter((t) => done.has(t.id)).length;
  const timeBonus = 20 * Math.max(0, 1 - elapsed / 480);
  return Math.max(0, Math.min(100, Math.round((n / total) * 78 + timeBonus - mistakes * 2 + (finished(plan, done) ? 2 : 0))));
}

export function hintLevel(difficulty: MissionPlan["difficulty"], mistakes: number) {
  return difficulty === "easy" || (difficulty === "normal" && mistakes >= 1) || (difficulty === "hard" && mistakes >= 3);
}

export const REPAIR = { angle: 0, start: 0, held: 0, active: false };

/** Surface radio: the commander's calls on the ladder, then Houston's word when the crew is down. */
function useEvaComms() {
  const exiting = useSurface((s) => s.exiting);
  const { plan } = useGame();
  const id = plan?.id;
  // on the way down the ladder: the commander describes the surface
  const atFoot = useSurface((s) => s.atFoot);
  useEffect(() => {
    if (atFoot) say(egress(), { once: `egress:${id}` });
  }, [atFoot, id]);
  const stepped = useRef(false);
  useEffect(() => {
    if (exiting || stepped.current) return;
    stepped.current = true;
    say(firstStep(), { once: `first-step:${id}` });
  }, [exiting, id]);
}

export function Tasks({ ground }: { ground: Ground }) {
  useEvaComms();
  const game = useGame();
  const { plan, state } = game;
  const done = useMemo(() => new Set(((state?.phaseData.surface?.done as string[] | undefined) ?? [])), [state?.phaseData.surface?.done]);
  const relay = state?.phaseData.surface?.relay as { x: number; z: number } | undefined;
  const latest = useRef(game);
  useEffect(() => {
    latest.current = game;
  });
  const spots = useMemo(() => (plan ? layoutTasks(plan, ground) : {}), [plan, ground]);
  const active = useMemo(() => (plan ? activeTasks(plan, done) : []), [plan, done]);
  // dev: ?finale=<seconds> previews the flag finale after a delay (so the player can walk away from the lander first)
  const [devFinale, setDevFinale] = useState(false);
  useEffect(() => {
    const v = new URLSearchParams(location.search).get("finale");
    if (v === null) return;
    const id = setTimeout(() => setDevFinale(true), (Number(v) || 5) * 1000);
    return () => clearTimeout(id);
  }, []);
  const fin = !!plan && (devFinale || finished(plan, done));
  useEffect(() => {
    const w = window as unknown as { __surface?: Record<string, unknown> };
    if (w.__surface) Object.assign(w.__surface, { spots, done: [...done] });
  }, [spots, done]);
  const mistakes = useSurface((s) => s.mistakes);
  const [flag, setFlag] = useState<[number, number, number] | null>(null);

  const prog = useRef({
    hold: 0,
    wasE: false,
    beepT: 0,
    bars: 0,
    barsT: 0,
    hudT: 0,
    badHold: 0,
    badLatch: false,
    completing: new Set<string>(),
    placedAt: 0,
    repairAligned: 0,
    finaleT: -1,
    finaleDone: false,
    flagPos: new THREE.Vector3(),
    barsMargin: 0,
  });

  const complete = useCallback((t: SurfaceTask) => {
    const p = prog.current;
    if (p.completing.has(t.id)) return;
    p.completing.add(t.id);
    const g = latest.current;
    const cur = new Set((g.state?.phaseData.surface?.done as string[] | undefined) ?? []);
    cur.add(t.id);
    g.patch("surface", { done: [...cur] });
    useSurface.getState().say(t.title + " complete");
    chirp(520, 980, 0.3, 0.12);
    // Houston confirms what was just done, and what comes next
    const tasks = g.plan?.surface.tasks ?? [];
    const next = tasks.find((x) => !cur.has(x.id));
    say(taskDone(t, next), { once: `task:${g.plan?.id}:${t.id}` });
  }, []);

  const mistake = useCallback((msg: string) => {
    const s = useSurface.getState();
    s.set({ mistakes: s.mistakes + 1 });
    s.say(msg);
    beep(180, 0.18, 0.1, "square");
  }, []);

  // reset the carry state when the relay task is not active
  useEffect(() => {
    if (!active.some((t) => t.type === "deploy_relay") && rt.carrying) {
      rt.carrying = null;
      useSurface.getState().set({ inventory: useSurface.getState().inventory.filter((i) => i !== "Radio relay"), bars: null });
    }
  }, [active]);

  // finale
  useEffect(() => {
    if (!fin || !plan) return;
    const p = prog.current;
    if (p.finaleT >= 0 || p.finaleDone) return;
    p.finaleT = 0;
    rt.locked = true;
    rt.focus = null;
    p.flagPos.set(rt.pos.x + Math.sin(rt.rotY) * 3.2, 0, rt.pos.z + Math.cos(rt.rotY) * 3.2);
    p.flagPos.y = ground.heightAt(p.flagPos.x, p.flagPos.z);
    setFlag([p.flagPos.x, p.flagPos.y, p.flagPos.z]);
    useAr.setState({ flag: [p.flagPos.x, p.flagPos.y, p.flagPos.z] });
    useSurface.getState().set({ finale: true, prompt: null, progress: null, signal: null, bars: null, guides: [] });
    say(goalAchieved(plan.goal.text), { once: `goal:${plan.id}` });
    chirp(440, 1320, 0.8, 0.12);
  }, [fin, plan, ground]);

  // the finale ends in the HUD's choice: explore freely or file the report (see Hud). Nothing auto-completes.

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = latest.current;
    const hud = useSurface.getState();
    const p = prog.current;
    if (!plan || rt.exiting) return;

    // the player chose to keep exploring: hand control back
    if (p.finaleT >= 0 && hud.explore) {
      p.finaleT = -1;
      p.finaleDone = true;
      rt.locked = false;
      rt.focus = null;
      hud.set({ finale: false });
    }
    // finale orbit
    if (p.finaleT >= 0) {
      p.finaleT += dt;
      const a = p.finaleT * 0.11 + 1.2;
      const f = p.flagPos;
      if (!rt.focus) rt.focus = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
      rt.focus.pos.set(f.x + Math.sin(a) * 7, ground.heightAt(f.x + Math.sin(a) * 7, f.z + Math.cos(a) * 7) + 2.0, f.z + Math.cos(a) * 7);
      rt.focus.look.set(f.x, f.y + 1.4, f.z);
      return;
    }

    const eEdge = rt.interact && !p.wasE;
    p.wasE = rt.interact;
    const guides: Guide[] = [];
    let prompt: string | null = null;
    let progress: number | null = null;
    let signal: number | null = null;
    let scanDist: number | null = null;
    let bars: number | null = null;
    const hint = hintLevel(plan.difficulty, hud.mistakes);
    const px = rt.pos.x;
    const pz = rt.pos.z;
    let holding = false;
    let repairView: null | { angle: number; aligned: number } = null;

    for (const t of active) {
      if (!g.actsAs(t.role)) continue;
      const sp = spots[t.id] as TaskSpots | undefined;
      if (!sp) continue;
      const guideTo = (x: number, z: number, label: string) =>
        guides.push({ angle: angDiff(rt.camYaw, Math.atan2(x - px, z - pz)), dist: Math.hypot(x - px, z - pz), label });

      if (t.type === "navigate_to") {
        const d = Math.hypot(sp.main.x - px, sp.main.z - pz);
        guideTo(sp.main.x, sp.main.z, t.title);
        if (d < 5) complete(t);
      } else if (t.type === "scan") {
        const d = Math.hypot(sp.main.x - px, sp.main.z - pz);
        scanDist = d;
        signal = Math.max(0, Math.min(1, 1 - d / 95));
        if (sp.area) guideTo(sp.area.x, sp.area.z, "Search the shadowed crater");
        p.beepT -= dt;
        if (p.beepT <= 0) {
          p.beepT = Math.max(0.1, Math.min(1.6, 0.1 + d / 55));
          beep(380 + 1100 * signal, 0.06, 0.1, "sine");
        }
        const near = d < 3.8;
        if (rt.interact) {
          if (near) {
            holding = true;
            p.hold += dt / 1.6;
            progress = p.hold;
            if (p.hold >= 1) {
              p.hold = 0;
              complete(t);
            }
          } else {
            p.badHold += dt;
            if (p.badHold > 1 && !p.badLatch) {
              p.badLatch = true;
              mistake("Nothing here. Follow the beeps: faster means closer.");
            }
          }
        } else {
          p.badHold = 0;
          p.badLatch = false;
        }
        prompt = near ? "Hold E to confirm the ice signal" : "Walk toward the faster beeps";
      } else if (t.type === "collect_sample") {
        const d = Math.hypot(sp.main.x - px, sp.main.z - pz);
        guideTo(sp.main.x, sp.main.z, t.title);
        if (d < 3.2) {
          prompt = "Hold E to drill a sample";
          if (rt.interact) {
            holding = true;
            p.hold += dt / 2.6;
            progress = p.hold;
            if (Math.random() < dt * 14) {
              addDust(sp.main.x, ground.heightAt(sp.main.x, sp.main.z), sp.main.z, 3, 0.7);
              thud(0.05, 420, 0.07);
            }
            if (p.hold >= 1) {
              p.hold = 0;
              complete(t);
              useSurface.getState().set({ inventory: [...useSurface.getState().inventory, "Sample tube"] });
            }
          }
        }
      } else if (t.type === "deploy_relay") {
        const pick = sp.aux!;
        if (!rt.carrying) {
          const d = Math.hypot(pick.x - px, pick.z - pz);
          guideTo(pick.x, pick.z, "Pick up the radio relay");
          if (d < 3) {
            prompt = "Press E to pick up the relay";
            if (eEdge) {
              rt.carrying = "relay";
              hud.set({ inventory: [...hud.inventory.filter((i) => i !== "Radio relay"), "Radio relay"] });
              hud.say("Relay in hand. Find open ground with a clear view of Earth.");
              chirp(300, 500, 0.15, 0.1);
            }
          }
        } else {
          p.barsT -= dt;
          if (p.barsT <= 0) {
            p.barsT = 0.25;
            p.barsMargin = ground.earthMargin(px, pz, 60);
            p.bars = barsFromMargin(p.barsMargin);
          }
          bars = p.bars;
          const far = Math.hypot(px, pz) > 14;
          // where no ground in reach gets full signal, the suggested spot (the clearest view there is) will do
          const good = p.bars >= 3 || (!!sp.weak && Math.hypot(sp.main.x - px, sp.main.z - pz) < 4);
          if (hint || sp.weak) guideTo(sp.main.x, sp.main.z, "Open ground toward Earth");
          prompt = good && far ? "Press E to set down and unfold the relay" : sp.weak ? "Earth is barely above the horizon here. Walk to the marked spot, it has the clearest view." : "Walk until the signal bars fill. Earth is low on the horizon.";
          if (eEdge) {
            if (good && far) {
              rt.carrying = null;
              p.placedAt = performance.now();
              hud.set({ inventory: hud.inventory.filter((i) => i !== "Radio relay") });
              g.patch("surface", { relay: { x: +px.toFixed(2), z: +pz.toFixed(2) } });
              chirp(260, 700, 0.5, 0.1);
              setTimeout(() => complete(t), 3200);
            } else mistake(far ? "Weak signal here. Look for open ground toward Earth." : "Too close to the lander. Walk further out.");
          }
        }
      } else if (t.type === "repair") {
        const lx = sp.main.x;
        const lz = sp.main.z;
        const d = Math.hypot(lx - px, lz - pz);
        if (!REPAIR.active) {
          guideTo(lx, lz, t.title);
          if (d < 4.2) {
            prompt = "Press E to open the panel";
            if (eEdge) {
              REPAIR.active = true;
              REPAIR.held = 0;
              REPAIR.start = (Math.sign(Math.sin(plan.seed)) || 1) * (1.2 + (plan.seed % 7) * 0.12);
              REPAIR.angle = REPAIR.start;
              rt.locked = true;
              rt.vel.set(0, 0, 0);
              rt.focus = {
                pos: new THREE.Vector3(lx + 3.5, ground.heightAt(lx, lz) + 2.6, lz + 6),
                look: new THREE.Vector3(lx, ground.heightAt(lx, lz) + 1.6, lz),
              };
            }
          }
        }
        if (REPAIR.active) {
          const k = rt.keys;
          const turn = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
          REPAIR.angle += turn * dt * 1.1;
          const off = Math.abs(angDiff(0, REPAIR.angle));
          if (off < 0.07) {
            REPAIR.held += dt / 1.5;
            if (REPAIR.held >= 1) {
              REPAIR.active = false;
              rt.locked = false;
              rt.focus = null;
              REPAIR.held = 0;
              complete(t);
            }
          } else REPAIR.held = Math.max(0, REPAIR.held - dt * 2);
          prompt = "A / D to rotate the panel until it matches the green outline. Esc to step back.";
          progress = REPAIR.held > 0.01 ? REPAIR.held : null;
          repairView = { angle: off, aligned: REPAIR.held };
          if (rt.keys.Escape) {
            REPAIR.active = false;
            rt.locked = false;
            rt.focus = null;
            mistake("Panel left misaligned. Try again when ready.");
          }
        }
      }
    }
    if (!holding && !REPAIR.active) p.hold = Math.max(0, p.hold - dt * 1.5);

    p.hudT -= dt;
    if (p.hudT <= 0) {
      p.hudT = 0.1;
      hud.set({
        prompt,
        progress,
        signal,
        scanDist,
        bars,
        guides: hint ? guides : [],
        repair: repairView,
      });
    }
  });

  if (!plan) return null;
  const relayPlaced = !!relay;
  return (
    <>
      {active.map((t) => {
        const sp = spots[t.id];
        if (!sp) return null;
        const mine = game.actsAs(t.role);
        const color = ROLE_COLOR[t.role] ?? "#ffb547";
        if (t.type === "deploy_relay") {
          return (
            <group key={t.id}>
              {!relayPlaced && !rt.carrying && <Beacon x={sp.aux!.x} z={sp.aux!.z} ground={ground} color={color} height={14} label={mine ? "Radio relay" : `${t.role}: relay`} dim={!mine} />}
              {mine && !relayPlaced && <HintRing x={sp.main.x} z={sp.main.z} ground={ground} role={t.role} show={hintLevel(plan.difficulty, mistakes)} />}
            </group>
          );
        }
        if (t.type === "repair") return <Beacon key={t.id} x={sp.main.x} z={sp.main.z} ground={ground} color={color} height={10} label={mine ? t.title : `Waiting for ${t.role}`} dim={!mine} />;
        if (t.type === "scan")
          return (
            <group key={t.id}>
              {sp.area && <Beacon x={sp.area.x} z={sp.area.z} ground={ground} color={color} height={45} label={mine ? "Shadowed crater" : `Waiting for ${t.role}`} dim={!mine} thin />}
              <IceGlint x={sp.main.x} z={sp.main.z} ground={ground} reveal={mine ? 1 : 0} />
            </group>
          );
        if (t.type === "collect_sample")
          return (
            <group key={t.id}>
              <Beacon x={sp.main.x} z={sp.main.z} ground={ground} color={color} height={22} label={mine ? t.title : `Waiting for ${t.role}`} dim={!mine} />
              <SampleRock x={sp.main.x} z={sp.main.z} ground={ground} />
            </group>
          );
        return <Beacon key={t.id} x={sp.main.x} z={sp.main.z} ground={ground} color={color} height={40} label={mine ? t.title : `Waiting for ${t.role}`} dim={!mine} />;
      })}
      {relay && <RelayModel x={relay.x} z={relay.z} ground={ground} placedAt={prog.current.placedAt} />}
      <CarriedRelay />
      {flag && <Flag pos={flag} face={1.7} />}
      {plan.surface.tasks
        .filter((t) => t.type === "repair" && !done.has(t.id))
        .map((t) => spots[t.id] && <RepairPanel key={t.id} x={spots[t.id].main.x} z={spots[t.id].main.z} ground={ground} />)}
      {plan.surface.tasks
        .filter((t) => t.type === "repair" && done.has(t.id))
        .map((t) => spots[t.id] && <RepairPanel key={t.id} x={spots[t.id].main.x} z={spots[t.id].main.z} ground={ground} fixed />)}
    </>
  );
}

function Beacon({ x, z, ground, color, height, label, dim, thin }: { x: number; z: number; ground: Ground; color: string; height: number; label: string; dim?: boolean; thin?: boolean }) {
  const y = ground.heightAt(x, z);
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: dim ? 0.16 : 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [color, dim]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring.current) {
      ring.current.rotation.z = t * 0.5;
      ring.current.scale.setScalar(1 + Math.sin(t * 2.4) * 0.06);
    }
    if (beam.current) mat.opacity = (dim ? 0.12 : 0.3) + Math.sin(t * 2) * 0.05;
  });
  return (
    <group position={[x, y, z]}>
      <mesh ref={beam} material={mat} position={[0, height / 2, 0]}>
        <cylinderGeometry args={[thin ? 0.12 : 0.22, thin ? 0.12 : 0.22, height, 10, 1, true]} />
      </mesh>
      <mesh ref={ring} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[1.9, 2.2, 40]} />
      </mesh>
      <Label text={label} color={color} position={[0, Math.min(height, 6) + 1, 0]} dim={dim} scale={0.024} />
    </group>
  );
}

function HintRing({ x, z, ground, role, show }: { x: number; z: number; ground: Ground; role: string; show: boolean }) {
  const y = ground.heightAt(x, z);
  if (!show) return null;
  return (
    <mesh position={[x, y + 0.12, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[2.4, 2.7, 40]} />
      <meshBasicMaterial color={ROLE_COLOR[role] ?? "#6fd3ff"} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function IceGlint({ x, z, ground, reveal }: { x: number; z: number; ground: Ground; reveal: number }) {
  const g = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#bfeaff").multiplyScalar(2.5), toneMapped: false, transparent: true }), []);
  const geo = useMemo(() => new THREE.OctahedronGeometry(0.12, 0), []);
  useEffect(
    () => () => {
      mat.dispose();
      geo.dispose();
    },
    [mat, geo],
  );
  const y = ground.heightAt(x, z);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const d = Math.hypot(rt.pos.x - x, rt.pos.z - z);
    const vis = reveal * (1 - THREE.MathUtils.smoothstep(d, 8, 16));
    g.current.visible = vis > 0.02;
    mat.opacity = vis * (0.6 + 0.4 * Math.sin(clock.elapsedTime * 6));
    g.current.rotation.y = clock.elapsedTime;
  });
  return (
    <group ref={g} position={[x, y + 0.2, z]} visible={false}>
      {[
        [0, 0, 0, 1.4],
        [0.3, -0.05, 0.1, 0.8],
        [-0.25, -0.08, 0.2, 0.9],
        [0.1, -0.08, -0.3, 0.7],
      ].map(([a, b, c, s], i) => (
        <mesh key={i} geometry={geo} material={mat} position={[a, b, c]} scale={s} />
      ))}
    </group>
  );
}

function SampleRock({ x, z, ground }: { x: number; z: number; ground: Ground }) {
  const y = ground.heightAt(x, z);
  return (
    <mesh position={[x, y + 0.35, z]} castShadow receiveShadow scale={[1, 0.7, 0.9]}>
      <icosahedronGeometry args={[0.6, 2]} />
      <meshStandardMaterial color="#9b8f82" roughness={0.95} />
    </mesh>
  );
}

function RepairPanel({ x, z, ground, fixed }: { x: number; z: number; ground: Ground; fixed?: boolean }) {
  const y = ground.heightAt(x, z);
  const panel = useRef<THREE.Group>(null);
  const matBad = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2a3b6b", roughness: 0.3, metalness: 0.5, emissive: "#000" }), []);
  const ghost = useMemo(() => new THREE.MeshBasicMaterial({ color: "#4ade80", transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }), []);
  useEffect(
    () => () => {
      matBad.dispose();
      ghost.dispose();
    },
    [matBad, ghost],
  );
  useFrame(() => {
    if (!panel.current) return;
    panel.current.rotation.y = fixed ? 0 : REPAIR.active ? REPAIR.angle : REPAIR.angle || 1.3;
    const aligned = fixed || (REPAIR.active && Math.abs(angDiff(0, REPAIR.angle)) < 0.07);
    matBad.emissive.set(aligned ? "#0b4a22" : "#401010");
  });
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 1.8, 10]} />
        <meshStandardMaterial color="#b7bbc2" roughness={0.5} metalness={0.5} />
      </mesh>
      <group ref={panel} position={[0, 2.0, 0]}>
        <mesh material={matBad} castShadow>
          <boxGeometry args={[2.4, 1.3, 0.06]} />
        </mesh>
        <mesh position={[0, 0, 0.04]}>
          <boxGeometry args={[0.1, 1.3, 0.04]} />
          <meshStandardMaterial color="#d6d6d6" />
        </mesh>
      </group>
      {!fixed && (
        <mesh material={ghost} position={[0, 2.0, 0.02]} visible>
          <planeGeometry args={[2.5, 1.4]} />
        </mesh>
      )}
    </group>
  );
}

function RelayModel({ x, z, ground, placedAt }: { x: number; z: number; ground: Ground; placedAt: number }) {
  const y = ground.heightAt(x, z);
  const legs = useRef<THREE.Group[]>([]);
  const mast = useRef<THREE.Group>(null);
  const dish = useRef<THREE.Group>(null);
  const light = useRef<THREE.MeshBasicMaterial>(null);
  const t0 = useRef(placedAt || performance.now());
  const az = Math.atan2(EARTH_DIR.x, EARTH_DIR.z);
  useFrame(({ clock }) => {
    const k = Math.min(1, (performance.now() - t0.current) / 3000);
    const e = 1 - Math.pow(1 - k, 3);
    legs.current.forEach((l) => l && (l.rotation.x = 0.08 + e * 0.62));
    if (mast.current) mast.current.scale.y = 0.25 + 0.75 * Math.min(1, e * 1.3);
    if (dish.current) dish.current.rotation.x = -Math.PI / 2 + e * (Math.PI / 2 - 0.23);
    if (light.current) light.current.color.set(k >= 1 ? (Math.sin(clock.elapsedTime * 5) > 0 ? "#4ade80" : "#0f3a1d") : "#ffb547");
  });
  return (
    <group position={[x, y, z]}>
      {[0, 1, 2].map((i) => (
        <group key={i} rotation-y={(i * Math.PI * 2) / 3} position={[0, 0.9, 0]}>
          <group ref={(g) => void (g && (legs.current[i] = g))}>
            <mesh position={[0, -0.5, 0.0]} castShadow>
              <cylinderGeometry args={[0.025, 0.03, 1.1, 6]} />
              <meshStandardMaterial color="#9aa0a8" roughness={0.5} metalness={0.6} />
            </mesh>
          </group>
        </group>
      ))}
      <group ref={mast} position={[0, 0.9, 0]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 1.1, 8]} />
          <meshStandardMaterial color="#d6d8dc" roughness={0.4} metalness={0.5} />
        </mesh>
      </group>
      <group position={[0, 2.05, 0]} rotation-y={az}>
        <group ref={dish}>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.05]}>
            <sphereGeometry args={[0.55, 24, 8, 0, Math.PI * 2, 0, 0.55]} />
            <meshStandardMaterial color="#e8e8e8" roughness={0.45} metalness={0.3} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
      <mesh position={[0, 2.25, 0]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshBasicMaterial ref={light} color="#ffb547" toneMapped={false} />
      </mesh>
    </group>
  );
}

function CarriedRelay() {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    g.current.visible = rt.carrying === "relay" && !rt.exiting;
    g.current.position.set(rt.pos.x - Math.sin(rt.rotY) * 0.33, rt.pos.y + 1.05, rt.pos.z - Math.cos(rt.rotY) * 0.33);
    g.current.rotation.y = rt.rotY;
  });
  return (
    <group ref={g} visible={false}>
      <mesh castShadow>
        <boxGeometry args={[0.28, 0.5, 0.2]} />
        <meshStandardMaterial color="#c9ccd1" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 6]} />
        <meshStandardMaterial color="#888" />
      </mesh>
    </group>
  );
}

/** US flag drawn to a canvas (13 stripes, canton with 50 stars). */
function flagTexture() {
  const W = 1024;
  const H = 540;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const sh = H / 13;
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 === 0 ? "#b31942" : "#f4f4f4";
    g.fillRect(0, i * sh, W, sh + 1);
  }
  const cw = W * 0.4;
  const ch = sh * 7;
  g.fillStyle = "#0a3161";
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = "#f4f4f4";
  const star = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? r : r * 0.4;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };
  for (let row = 0; row < 9; row++) {
    const n = row % 2 === 0 ? 6 : 5;
    for (let k = 0; k < n; k++) {
      const x = (cw / 12) * (row % 2 === 0 ? 1 + 2 * k : 2 + 2 * k);
      const y = (ch / 10) * (row + 1);
      star(x, y, 15);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Apollo-style flag: vertical pole, horizontal rod along the top edge holds the cloth out (no wind on the Moon). */
function Flag({ pos, face }: { pos: [number, number, number]; face: number }) {
  const tex = useMemo(() => flagTexture(), []);
  const geo = useMemo(() => {
    const gm = new THREE.PlaneGeometry(1.2, 0.63, 24, 4);
    const p = gm.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      // hand-set creases: the cloth sags a little away from the rod
      p.setZ(i, Math.sin(x * 9) * 0.012 * (0.35 - y) + (0.315 - y) * 0.02);
    }
    gm.computeVertexNormals();
    return gm;
  }, []);
  useEffect(
    () => () => {
      tex.dispose();
      geo.dispose();
    },
    [tex, geo],
  );
  return (
    <group position={pos} rotation={[0, face, 0]}>
      <pointLight position={[0.3, 3.2, 1.6]} intensity={22} distance={26} decay={2} color="#ffe2b8" />
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.02, 2.4, 8]} />
        <meshStandardMaterial color="#d0d0d0" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.6, 2.32, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 1.24, 8]} />
        <meshStandardMaterial color="#d0d0d0" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh geometry={geo} position={[0.62, 2.0, 0]} castShadow>
        <meshStandardMaterial map={tex} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export { PLAY_RADIUS, SUN_DIR };
