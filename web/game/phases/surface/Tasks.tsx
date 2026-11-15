"use client";
/* eslint-disable react-hooks/refs */
// The surface mission engine. Every role has its own track and all tracks are open from the first step, so nobody waits
// on anybody. Co-op actions (carry the station, hold the cable, team photo) are faster with a partner and always possible alone.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { say } from "../../core/comms";
import { COST, damage } from "../../core/hp";
import { useStore } from "../../core/store";
import { useGame } from "../../core/useGame";
import { fieldNoteFound, goalAchieved, surfaceSlip, surfaceTaskResult, egress, firstStep } from "../../data/missionComms";
import type { MissionPlan, Role } from "../../types";
import { hintsUsed, hintTier, watchHintPurchases } from "./hints";
import { clearHolds, coopPos, doneSet, holders, listenHolds, others, otherHolding, patchSurface, poiSet, posOf, sendHold, surf } from "./coop";
import { PLAY_RADIUS, SUN_AZ, SUN_ELEV, type Ground } from "./ground";
import { Beacon, CarriedRelay, Flag, IceGlint, RelayModel, RelayPackage, RepairPanel, REPAIR, angDiff } from "./Props";
import { CableRoute, CarriedItems, HintRegion, Lrrr, PadRings, Rack, Stake, Station } from "./Items";
import { POI_TOTAL, poiInfo, usePoi } from "./fieldnotes";
import { barsFromMargin, getLayout, HINT_TEXT, ORDER, ROLE_ORDER, surfaceScore, TASK_BY_ID, TASKS, type Layout, type Spot, type TaskDef } from "./tracks";
import { ROLE_COLOR, rt, useSurface, type Guide } from "./store";
import { beep, chirp, thud } from "./synth";
import { addDust } from "./Trail";

export { REPAIR };

export const FINAL = TASKS.find((t) => t.final)!;
export const hintLevel = (difficulty: MissionPlan["difficulty"], mistakes: number) =>
  difficulty === "easy" || (difficulty === "normal" && mistakes >= 1) || (difficulty === "hard" && mistakes >= 3);

/** Score from the shared state (what everyone sees). */
export function scoreNow(state: ReturnType<typeof useStore.getState>["state"], elapsed: number, mistakes: number) {
  const sd = surf(state);
  const done = doneSet(sd);
  return surfaceScore({
    done: TASKS.filter((t) => done.has(t.id)).length,
    total: TASKS.length,
    poi: poiSet(sd).size,
    poiTotal: POI_TOTAL,
    coop: ["crate", "cable", "flag", "stow"].filter((k) => sd[`co_${k}`]).length,
    coopTotal: 4,
    elapsed,
    mistakes,
    hintTiers: hintsUsed(sd),
    finished: done.has(FINAL.id),
  });
}

/** This player's objectives in order: their roles' tasks, then (once those are done) whatever is left for others, then the final. */
export function myQueue(done: Set<string>, acts: (r: Role) => boolean): TaskDef[] {
  const byOrder = ORDER.map((id) => TASK_BY_ID[id]).filter((t) => !t.final);
  const mine = byOrder.filter((t) => acts(t.role));
  const assist = mine.every((t) => done.has(t.id));
  const rest = assist ? byOrder.filter((t) => !acts(t.role) && !t.anyone) : [];
  const fin = acts(FINAL.role) || assist ? [FINAL] : [];
  return [...mine, ...rest, ...fin];
}

/** The one objective shown to this player now (null when nothing is left for them). */
export function currentTask(done: Set<string>, acts: (r: Role) => boolean): TaskDef | null {
  const othersDone = TASKS.filter((t) => !t.final).every((t) => done.has(t.id));
  for (const t of myQueue(done, acts)) {
    if (done.has(t.id)) continue;
    if (t.final) return othersDone ? t : null;
    if (t.kind === "stow" && !done.has("core")) continue;
    return t;
  }
  return null;
}
export function myOpenTasks(done: Set<string>, acts: (r: Role) => boolean): TaskDef[] {
  const c = currentTask(done, acts);
  return c ? [c] : [];
}

/** Surface radio: the commander's calls on the ladder, then Houston's word when the crew is down. */
function useEvaComms() {
  const exiting = useSurface((s) => s.exiting);
  const { plan } = useGame();
  const id = plan?.id;
  const atFoot = useSurface((s) => s.atFoot);
  useEffect(() => {
    if (atFoot) say(egress(), { once: `egress:${id}`, onDone: () => void (rt.egressDone = true) });
  }, [atFoot, id]);
  const stepped = useRef(false);
  useEffect(() => {
    if (exiting || stepped.current) return;
    stepped.current = true;
    say(firstStep(), { once: `first-step:${id}` });
  }, [exiting, id]);
}

interface Need {
  level?: number;
  minR?: number;
  maxR?: number;
  earth?: boolean;
  craterOut?: number;
  apart?: Spot[];
}
/** What the helmet sensors say about the ground here (slope, distance from the lander, view of Earth, crater, spacing). */
function readSite(ground: Ground, x: number, z: number, need: Need): { ok: boolean; note: string; slope: number } {
  const n = ground.normalAt(x, z).y;
  const slope = (Math.acos(Math.min(1, n)) * 180) / Math.PI;
  const r = Math.hypot(x, z);
  const c = ground.crater;
  let note = "";
  if (need.level && n < need.level) note = "Too steep here. Look for level ground.";
  else if (need.minR && r < need.minR) note = `Too close to the lander. Go at least ${need.minR} m out.`;
  else if (need.maxR && r > need.maxR) note = "Too far from the lander.";
  else if (need.craterOut && Math.hypot(x - c.x, z - c.z) < c.r * need.craterOut) note = "Too close to the crater.";
  else if (need.earth && ground.earthMargin(x, z, 60) < 1.2) note = "Terrain blocks Earth from here.";
  else if (need.apart?.some((a) => Math.hypot(a.x - x, a.z - z) < 18)) note = "Too close to another stake. Spread them out.";
  return { ok: !note, note: note || "Good site.", slope };
}

const flagAt = (sd: Record<string, unknown>, L: Layout): Spot => (sd.flag_at as Spot | undefined) ?? L.flag;

/** Where the hint tiers point for a task (suggested places, each with the radius of the area shown at tier 2). */
export function hintTarget(id: string, sd: Record<string, unknown>, L: Layout, carrying: typeof rt.carrying): { x: number; z: number; r: number }[] {
  const at = (s: Spot, r: number) => ({ x: s.x, z: s.z, r });
  switch (id) {
    case "gear":
      return L.pads.filter((_, k) => !sd[`g_${k}`]).map((s) => at(s, 2.6));
    case "panel":
      return [at(L.panel, 4)];
    case "cable":
      return [at(L.cableA, 4)];
    case "relay":
      return [carrying === "relay" ? at(L.relayBest, 12) : at(L.relayPick, 4)];
    case "lrrr":
      return [at(L.lrrr, 14)];
    case "crate":
      return [carrying === "crate" ? at(L.crateTarget, 14) : at({ x: (sd.ix_crate as number | undefined) ?? L.crateStart.x, z: (sd.iz_crate as number | undefined) ?? L.crateStart.z }, 4)];
    case "stakes":
      return L.stakes.filter((_, k) => !sd[`s_${k}`]).map((s) => at(s, 10));
    case "rim":
      return [at(L.rim, 10)];
    case "ice":
      return [at(L.scan.main, 22)];
    case "core":
      return [at(L.core, 14)];
    case "stow":
      return [carrying === "sample" ? at(L.rack, 4) : at({ x: (sd.ix_sample as number | undefined) ?? L.core.x, z: (sd.iz_sample as number | undefined) ?? L.core.z }, 4)];
    case "flag":
      return [at(flagAt(sd, L), 12)];
  }
  return [];
}

const sunBlocked = (ground: Ground, x: number, z: number) => {
  const sx = Math.sin(SUN_AZ);
  const sz = Math.cos(SUN_AZ);
  const t = Math.tan(SUN_ELEV);
  const y0 = ground.heightAt(x, z) + 1;
  for (let d = 4; d < 200; d += d < 40 ? 4 : 10) if (ground.heightAt(x + sx * d, z + sz * d) > y0 + d * t) return true;
  return false;
};

interface Frame {
  dt: number;
  prompt: string | null;
  progress: number | null;
  signal: number | null;
  scanDist: number | null;
  bars: number | null;
  coop: string | null;
  holding: boolean;
  usedE: boolean;
  guides: Guide[];
  site: null | { ok: boolean; note: string; slope: number };
}

export function Tasks({ ground }: { ground: Ground }) {
  useEvaComms();
  const game = useGame();
  const { plan, state } = game;
  const sd = surf(state);
  const done = useMemo(() => doneSet(sd), [sd]);
  const layout = useMemo(() => (plan ? getLayout(plan, ground) : null), [plan, ground]);
  const latest = useRef(game);
  const doneRef = useRef(done);
  useEffect(() => {
    latest.current = game;
    doneRef.current = done;
  });
  useEffect(() => {
    const w = window as unknown as { __surface?: Record<string, unknown> };
    if (w.__surface) Object.assign(w.__surface, { layout, done: [...done], ground, spots: layout });
  }, [layout, done, ground]);
  useEffect(() => {
    clearHolds();
    const un = [listenHolds(), watchHintPurchases()];
    return () => un.forEach((u) => u());
  }, []);

  // dev: ?finale=<seconds> previews the flag finale
  const devFinale = useRef(false);
  useEffect(() => {
    const v = new URLSearchParams(location.search).get("finale");
    if (v === null) return;
    const id = setTimeout(() => void (devFinale.current = true), (Number(v) || 5) * 1000);
    return () => clearTimeout(id);
  }, []);
  const fin = done.has(FINAL.id);

  const names = (state?.phaseData.crew as { names?: Record<string, string> } | undefined)?.names;
  const nameOfRole = (r: Role) => names?.[r];
  const nameOfPlayer = (id: unknown) => {
    const p = state?.players.find((x) => x.id === id);
    return p ? names?.[p.role ?? p.roles?.[0] ?? "commander"] ?? p.name : undefined;
  };

  // Houston confirms every result for the whole crew (state is shared), once per event
  const seenDone = useRef<Set<string> | null>(null);
  const seenPoi = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!plan) return;
    if (seenDone.current === null) {
      seenDone.current = new Set(done);
      return;
    }
    for (const id of done) {
      if (seenDone.current.has(id)) continue;
      seenDone.current.add(id);
      const t = TASK_BY_ID[id];
      if (!t) continue;
      const mineNow = myQueue(done, game.actsAs).some((q) => q.id === id);
      const nxt = mineNow ? currentTask(done, game.actsAs) : null;
      useSurface.getState().say(`${t.title}: done`, "good");
      useSurface.getState().set({ reveal: useSurface.getState().reveal + 1 });
      chirp(520, 980, 0.3, 0.12);
      if (id !== FINAL.id) say(surfaceTaskResult(id, nameOfRole(t.role), nxt?.title, (sd[`co_${id}`] as string) || undefined), { once: `sf:${plan.id}:${id}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- names/sd/actsAs are read when a task flips to done
  }, [done, plan]);
  const found = useMemo(() => poiSet(sd), [sd]);
  useEffect(() => {
    if (!plan) return;
    useSurface.getState().set({ poiFound: found.size, poiTotal: POI_TOTAL });
    if (seenPoi.current === null) {
      seenPoi.current = new Set(found);
      return;
    }
    for (const id of found) {
      if (seenPoi.current.has(id)) continue;
      seenPoi.current.add(id);
      const info = poiInfo(id);
      const km = typeof info.distance_m === "number" ? info.distance_m / 1000 : undefined;
      say(fieldNoteFound(info.title, found.size, POI_TOTAL, nameOfPlayer(sd[`p_${id}`]), info.kind === "heritage" ? km : undefined), { once: `poi:${plan.id}:${id}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- names/sd are read when a note is found
  }, [found, plan]);

  const prog = useRef({
    hold: 0,
    holdKey: "",
    beepT: 0,
    bars: 0,
    barsT: 0,
    hudT: 0,
    badHold: 0,
    badLatch: false,
    placedAt: 0,
    relayDoneAt: 0,
    wasE: false,
    hazT: 0,
    hazCool: 0,
    safe: new THREE.Vector3(0, 0, 6),
    shadeT: 0,
    steep: false,
    shaded: false,
    jumpsSeen: 0,
    carryT: 0,
    holdSendT: 0,
    photoT0: -1,
    photoGo: 0,
    photoBy: "",
    finaleT: -1,
    flagPos: new THREE.Vector3(),
    cooldowns: {} as Record<string, number>,
    prevCarry: null as typeof rt.carrying,
  });

  // finale
  useEffect(() => {
    if (!(fin || devFinale.current) || !plan || !layout) return;
    const p = prog.current;
    if (p.finaleT >= 0) return;
    p.finaleT = 0;
    rt.locked = true;
    rt.focus = null;
    rt.gather = null;
    const fa = flagAt(sd, layout);
    p.flagPos.set(fa.x, ground.heightAt(fa.x, fa.z), fa.z);
    useSurface.getState().set({ finale: true, prompt: null, progress: null, signal: null, bars: null, guides: [], coop: null });
    say(goalAchieved(plan.goal.text), { once: `goal:${plan.id}` });
    chirp(440, 1320, 0.8, 0.12);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the flag spot is read once when the finale starts
  }, [fin, plan, ground, layout]);

  useEffect(() => {
    if (!fin) return;
    const g = latest.current;
    const id = setTimeout(
      () => {
        const st = useSurface.getState();
        latest.current.complete("surface", scoreNow(useStore.getState().state, st.elapsed, st.mistakes));
      },
      g.isHost || g.state?.mode === "solo" ? 9000 : 16000,
    );
    return () => clearTimeout(id);
  }, [fin]);

  // a new team photo request from anyone starts the countdown here too
  const photoGo = (sd.photoGo as number | undefined) ?? 0;
  useEffect(() => {
    if (!photoGo) return;
    const p = prog.current;
    if (p.photoGo === photoGo) return;
    p.photoGo = photoGo;
    p.photoT0 = performance.now();
    p.photoBy = String(sd.photoBy ?? "");
    rt.locked = true;
    rt.vel.set(0, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- photoBy arrives with photoGo
  }, [photoGo]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = latest.current;
    const hud = useSurface.getState();
    const p = prog.current;
    const L = layout;
    if (!plan || !L || rt.exiting) return;

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

    const done = doneRef.current;
    const st = g.state;
    const meId = g.me?.id;
    const sdd = surf(st);
    const solo = st?.mode === "solo";
    const mates = others(st, meId);
    const eEdge = rt.interact && !p.wasE;
    p.wasE = rt.interact;
    const F: Frame = { site: null, dt, prompt: null, progress: null, signal: null, scanDist: null, bars: null, coop: null, holding: false, usedE: false, guides: [] };
    const px = rt.pos.x;
    const pz = rt.pos.z;
    const now = performance.now();
    const open = myOpenTasks(done, g.actsAs);
  
    let curTask = true;
    const d2 = (s: Spot) => Math.hypot(s.x - px, s.z - pz);
    const toast = (msg: string, tone: "info" | "bad" | "good" = "info") => hud.say(msg, tone);
    const patchDone = (id: string, partner?: string) => {
      patchSurface({ [`d_${id}`]: Date.now(), ...(partner ? { [`co_${id}`]: partner } : {}) });
    };
    /** Hold E near a spot to make progress; returns true while in range. */
    const work = (key: string, near: boolean, secs: number, prompt: string, onDone: () => void, rate = 1) => {
      if (!near) return false;
      if (!F.prompt) F.prompt = prompt;
      if (rt.interact && !F.usedE) {
        if (p.holdKey !== key) {
          p.holdKey = key;
          p.hold = 0;
        }
        p.hold += (dt * rate) / secs;
        F.progress = p.hold;
        F.holding = true;
        if (p.hold >= 1) {
          p.hold = 0;
          onDone();
        }
      }
      return true;
    };
    /** A mistake: costs ship integrity, with the reason on screen. */
    const slip = (key: string, msg: string, amount: number, radio?: "slope" | "sample" | "relay", cool = 6) => {
      if ((p.cooldowns[key] ?? 0) > now) return;
      p.cooldowns[key] = now + cool * 1000;
      hud.set({ mistakes: hud.mistakes + 1 });
      toast(`${msg} Ship integrity -${amount}`, "bad");
      damage(amount, msg);
      beep(180, 0.2, 0.1, "square");
      if (radio) say(surfaceSlip(radio, nameOfRole(g.me?.role ?? "commander")), { once: `slip:${plan.id}:${key}:${Math.floor(now / 20000)}` });
    };
    const setCarry = (c: typeof rt.carrying) => {
      rt.carrying = c;
      p.carryT = now;
    };

    // ---- carried items: speed, drops, hand-overs
    if (rt.jumps !== p.jumpsSeen) {
      if (rt.carrying === "sample") {
        setCarry(null);
        patchSurface({ [`h_sample_${meId}`]: 0, ix_sample: +px.toFixed(2), iz_sample: +pz.toFixed(2) });
        slip("sample", "You jumped and dropped the sample container.", COST.minor, "sample");
      }
      p.jumpsSeen = rt.jumps;
    }
    const crateHolders = holders(st, "crate", meId, rt.carrying === "crate");
    rt.speedMul = rt.carrying === "crate" ? (crateHolders.length >= 2 ? 0.85 : 0.5) : rt.carrying === "sample" ? 0.92 : 1;
    // a hand-over arrives as h_sample_<me> = 1 (or I was handed it while my hands are full)
    if (sdd[`h_sample_${meId}`] && rt.carrying !== "sample" && now - p.carryT > 1200) {
      if (rt.carrying === null && !done.has("stow")) {
        setCarry("sample");
        toast("A crewmate handed you the sample container. Take it to the rack.", "good");
      } else patchSurface({ [`h_sample_${meId}`]: 0, ix_sample: +px.toFixed(2), iz_sample: +pz.toFixed(2) });
    }
    if (rt.carrying === "sample" && done.has("stow")) setCarry(null);
    if (rt.carrying === "crate" && done.has("crate")) setCarry(null);
    if (rt.carrying === "relay" && done.has("relay")) {
      setCarry(null);
      hud.set({ inventory: [] });
    }
    const inv: string[] = [];
    if (rt.carrying === "sample") inv.push("Sample container");
    if (rt.carrying === "crate") inv.push("Seismometer station");
    if (rt.carrying === "relay") inv.push("Radio relay");
    if (hud.inventory.join() !== inv.join()) hud.set({ inventory: inv });

    // ---- hazard: steep, shadowed ground (checked 4x a second)
    p.shadeT -= dt;
    if (p.shadeT <= 0) {
      p.shadeT = 0.25;
      p.steep = ground.normalAt(px, pz).y < 0.9;
      p.shaded = p.steep && sunBlocked(ground, px, pz);
      if (!p.shaded && rt.grounded) p.safe.set(px, 0, pz);
      if (p.shaded) p.hazT += 0.25;
      else p.hazT = Math.max(0, p.hazT - 0.5);
      if (p.shaded && (rt.run > 0.5 || p.hazT > 4.5)) {
        const sprint = rt.run > 0.5;
        slip("slope", sprint ? "You slipped on a steep shadowed slope while sprinting." : "You stayed too long on a steep shadowed slope and slid.", COST.major, "slope", 10);
        p.hazT = 0;
        rt.pos.set(p.safe.x, rt.pos.y, p.safe.z);
        rt.vel.set(0, 0, 0);
      }
    }

    // ---- tasks
    const support = TASKS.filter((t) => !open.some((o) => o.id === t.id) && ((t.kind === "stow" && done.has("core") && !done.has("stow")) || (t.kind === "crate" && !done.has("crate"))));
    for (const t of [...open, ...support]) {
      curTask = open.some((o) => o.id === t.id);
      switch (t.kind) {
        case "scan": {
          const sp = L.scan.main;
          const d = d2(sp);
          F.scanDist = d;
          F.signal = Math.max(0, Math.min(1, 1 - d / 95));
          p.beepT -= dt;
          if (p.beepT <= 0) {
            p.beepT = Math.max(0.1, Math.min(1.6, 0.1 + d / 55));
            beep(380 + 1100 * F.signal, 0.06, 0.1, "sine");
          }
          const near = d < 3.8;
          if (rt.interact && !near) {
            p.badHold += dt;
            if (p.badHold > 1 && !p.badLatch) {
              p.badLatch = true;
              hud.set({ mistakes: hud.mistakes + 1 });
              toast("Nothing here. Follow the beeps: faster means closer.", "bad");
              beep(180, 0.18, 0.1, "square");
            }
          } else if (!rt.interact) {
            p.badHold = 0;
            p.badLatch = false;
          }
          if (!work("scan", near, 1.6, "Hold E to confirm the ice signal", () => {
            patchDone(t.id);
            discover("ice");
          }) && !F.prompt) F.prompt = "Walk toward the faster beeps";
          break;
        }
        case "drill": {
          const site = readSite(ground, px, pz, { level: 0.96, minR: 50, craterOut: 1.3 });
          if (curTask) F.site = site;
          const busy = rt.carrying !== null && rt.carrying !== "sample";
          if (rt.interact && !site.ok && !busy && (p.cooldowns.drillNote ?? 0) < now) {
            p.cooldowns.drillNote = now + 4000;
            toast(site.note);
          }
          if (work("drill", site.ok, 3.2, busy ? "Hands full: put the item down first" : "Hold E to drill a core sample", () => {
            patchDone(t.id);
            const at = { ix_sample: +px.toFixed(2), iz_sample: +pz.toFixed(2) };
            if (rt.carrying === null) {
              setCarry("sample");
              patchSurface({ [`h_sample_${meId}`]: 1, ...at });
              toast("Sample sealed in its container. Carry it to the rack.", "good");
            } else patchSurface(at);
          }, busy ? 0 : 1)) {
            if (rt.interact && !busy && Math.random() < dt * 14) {
              addDust(px, ground.heightAt(px, pz), pz, 3, 0.7);
              thud(0.05, 420, 0.07);
            }
          }
          break;
        }
        case "stow": {
          const hs = holders(st, "sample", meId, rt.carrying === "sample");
          const holdingMe = rt.carrying === "sample";
          const rackD = d2(L.rack);
          if (holdingMe) {
            // hand over to the nearest crewmate close by
            const mate = mates.map((m) => ({ m, pos: posOf(m.id) })).find((o) => o.pos && Math.hypot(o.pos.x - px, o.pos.z - pz) < 3 && rackD > 3.5);
            if (mate && !F.prompt) F.prompt = `Press E to hand the sample to ${mate.m.name}`;
            if (mate && eEdge && !F.usedE) {
              F.usedE = true;
              setCarry(null);
              patchSurface({ [`h_sample_${meId}`]: 0, [`h_sample_${mate.m.id}`]: 1, handed: mate.m.name });
              toast(`Handed the sample to ${mate.m.name}.`, "good");
            }
            work("stow", rackD < 3.2, 1.6, "Hold E to seal the sample in the rack", () => {
              setCarry(null);
              patchSurface({ [`h_sample_${meId}`]: 0 });
              patchDone(t.id, (sdd.handed as string) || undefined);
            });
          } else if (hs.length === 0) {
            const x = (sdd.ix_sample as number | undefined) ?? L.core.x;
            const z = (sdd.iz_sample as number | undefined) ?? L.core.z;
            const near = Math.hypot(x - px, z - pz) < 2.6;
            if (near && !F.prompt) F.prompt = rt.carrying ? "Hands full" : "Press E to pick up the sample container";
            if (near && eEdge && !F.usedE && rt.carrying === null) {
              F.usedE = true;
              setCarry("sample");
              patchSurface({ [`h_sample_${meId}`]: 1 });
            }
          } else {
            F.coop ??= "A crewmate is carrying the sample to the rack";
          }
          break;
        }
        case "relay": {
          const relayAt = sdd.relay as { x: number; z: number } | undefined;
          if (relayAt) {
            if (!p.relayDoneAt) p.relayDoneAt = now + 3200;
            if (now > p.relayDoneAt) patchDone(t.id);
            break;
          }
          if (rt.carrying !== "relay") {
            const pick = L.relayPick;
            if (d2(pick) < 3) {
              F.prompt = rt.carrying ? "Hands full" : "Press E to pick up the relay";
              if (eEdge && !F.usedE && rt.carrying === null) {
                F.usedE = true;
                setCarry("relay");
                hud.say("Relay in hand. Find open ground with a clear view of Earth.");
                chirp(300, 500, 0.15, 0.1);
              }
            }
          } else {
            p.barsT -= dt;
            if (p.barsT <= 0) {
              p.barsT = 0.25;
              p.bars = barsFromMargin(ground.earthMargin(px, pz, 60));
            }
            F.bars = p.bars;
            const far = Math.hypot(px, pz) > 14;
            F.prompt = p.bars >= 3 && far ? "Press E to set down and unfold the relay" : "Walk until the signal bars fill. Earth is low on the horizon.";
            if (eEdge && !F.usedE) {
              F.usedE = true;
              if (p.bars >= 3 && far) {
                setCarry(null);
                p.placedAt = now;
                p.relayDoneAt = now + 3200;
                patchSurface({ relay: { x: +px.toFixed(2), z: +pz.toFixed(2) } });
                chirp(260, 700, 0.5, 0.1);
              } else if (!far) toast("Too close to the lander. Walk further out.", "bad");
              else slip("relay", "You set the relay down where terrain blocks Earth: no link.", COST.minor + 2, "relay", 3);
            }
          }
          break;
        }
        case "panel": {
          const sp = L.panel;
          const d = d2(sp);
          const matesAt = false;
          void matesAt;
          if (!REPAIR.active) {
            if (d < 4.2) {
              F.prompt = "Press E to open the panel";
              if (eEdge && !F.usedE) {
                F.usedE = true;
                REPAIR.active = true;
                REPAIR.held = 0;
                REPAIR.start = (Math.sign(Math.sin(plan.seed)) || 1) * (1.2 + (plan.seed % 7) * 0.12);
                REPAIR.angle = REPAIR.start;
                rt.locked = true;
                rt.vel.set(0, 0, 0);
                rt.focus = {
                  pos: new THREE.Vector3(sp.x + 3.5, ground.heightAt(sp.x, sp.z) + 2.6, sp.z + 6),
                  look: new THREE.Vector3(sp.x, ground.heightAt(sp.x, sp.z) + 1.6, sp.z),
                };
              }
            }
          }
          if (REPAIR.active) {
            const k = rt.keys;
            REPAIR.angle += ((k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0)) * dt * 1.1;
            const off = Math.abs(angDiff(0, REPAIR.angle));
            if (off < 0.07) {
              REPAIR.held += dt / 1.5;
              if (REPAIR.held >= 1) {
                REPAIR.active = false;
                rt.locked = false;
                rt.focus = null;
                REPAIR.held = 0;
                patchDone(t.id);
              }
            } else REPAIR.held = Math.max(0, REPAIR.held - dt * 2);
            F.prompt = "A / D to rotate the panel until it matches the green outline. Esc to step back.";
            F.progress = REPAIR.held > 0.01 ? REPAIR.held : null;
            hud.set({ repair: { angle: off, aligned: REPAIR.held } });
            if (rt.keys.Escape) {
              REPAIR.active = false;
              rt.locked = false;
              rt.focus = null;
              hud.set({ mistakes: hud.mistakes + 1 });
              toast("Panel left misaligned. Try again when ready.", "bad");
            }
          } else if (hud.repair) hud.set({ repair: null });
          break;
        }
        case "cable": {
          const a = L.cableA;
          const partnerId = otherHolding("cable", meId);
          const partner = partnerId ? state_name(st, partnerId) : solo ? "your AI crewmate" : null;
          const rate = partnerId ? 1 : solo ? 0.85 : 0.4;
          const near = d2(a) < 2.6;
          if (near) F.coop = partnerId ? `${partner} is holding the cable steady` : solo ? "Your AI crewmate holds the cable steady" : mates.length ? "Nobody on the cable post: using the clamp (slow). Ask a crewmate to hold E at the post." : "Using the cable clamp (slow)";
          work("cable", near, 5.5, partnerId || solo ? "Hold E to connect the cable" : "Hold E to connect the cable (slow: clamp only)", () => patchDone(t.id, partnerId ? partner ?? undefined : solo ? "AI crew" : undefined), rate);
          break;
        }
        case "gear": {
          L.pads.forEach((pad, k) => {
            if (sdd[`g_${k}`]) return;
            work(`gear${k}`, d2(pad) < 2.2, 0.9, `Hold E to check pad ${k + 1} of 4`, () => {
              patchSurface({ [`g_${k}`]: 1 });
              chirp(600, 800, 0.12, 0.08);
              if (L.pads.every((_, j) => j === k || sdd[`g_${j}`])) patchDone(t.id);
            });
          });
          break;
        }
        case "stakes": {
          const planted = L.stakes.map((_, k) => sdd[`s_${k}`] as Spot | undefined);
          const k = planted.findIndex((x) => !x);
          if (k < 0) break;
          const site = readSite(ground, px, pz, { level: 0.95, minR: 25, craterOut: 1.15, apart: planted.filter(Boolean) as Spot[] });
          if (curTask) F.site = site;
          if (rt.interact && !site.ok && (p.cooldowns.stakeNote ?? 0) < now) {
            p.cooldowns.stakeNote = now + 4000;
            toast(site.note);
          }
          work(`stake${k}`, site.ok, 1.4, `Hold E to plant stake ${k + 1} of 3 here`, () => {
            patchSurface({ [`s_${k}`]: { x: +px.toFixed(2), z: +pz.toFixed(2) } });
            addDust(px, ground.heightAt(px, pz), pz, 4, 0.6);
            thud(0.06, 300, 0.1);
            if (k === L.stakes.length - 1) patchDone(t.id);
          });
          break;
        }
        case "rim": {
          const c = ground.crater;
          const dc = Math.hypot(px - c.x, pz - c.z);
          const facing = Math.abs(angDiff(rt.camYaw, Math.atan2(c.x - px, c.z - pz))) < 0.7;
          const okRim = dc > c.r * 1.08 && dc < c.r * 1.6 && facing;
          const note = dc <= c.r * 1.08 ? "Too close to the edge. Step back to the outer rim." : dc >= c.r * 1.6 ? "Too far to frame the whole bowl." : "Turn to face the crater.";
          if (curTask) F.site = { ok: okRim, note: okRim ? "Good viewpoint." : note, slope: 0 };
          work("rim", okRim, 1.4, "Hold E to photograph the crater", () => {
            hud.set({ flash: hud.flash + 1 });
            beep(900, 0.05, 0.1, "square");
            patchDone(t.id);
            discover("psr");
          });
          break;
        }
        case "lrrr": {
          const site = readSite(ground, px, pz, { level: 0.975, minR: 20, maxR: 110, earth: true, craterOut: 1.3 });
          if (curTask) F.site = site;
          if (rt.interact && !site.ok && (p.cooldowns.lrrrNote ?? 0) < now) {
            p.cooldowns.lrrrNote = now + 4000;
            toast(site.note);
          }
          work("lrrr", site.ok, 3, "Hold E to level the reflector and aim it at Earth", () => {
            patchSurface({ lrrr_at: { x: +px.toFixed(2), z: +pz.toFixed(2) } });
            patchDone(t.id);
            chirp(500, 900, 0.3, 0.1);
            discover("lrrr");
          });
          break;
        }
        case "crate": {
          const h = crateHolders;
          const mine = rt.carrying === "crate";
          if (!mine) {
            const rest = { x: (sdd.ix_crate as number | undefined) ?? L.crateStart.x, z: (sdd.iz_crate as number | undefined) ?? L.crateStart.z };
            const carrier = h.length === 1 ? coopPos(h[0], meId) : null;
            const at = carrier ?? rest;
            const near = Math.hypot(at.x - px, at.z - pz) < 3.2;
            if (near && h.length < 2) {
              F.prompt = rt.carrying ? "Hands full" : h.length ? "Press E to lift the other end together" : "Press E to lift the station (heavy: slow alone, faster with a partner)";
              if (eEdge && !F.usedE && rt.carrying === null) {
                F.usedE = true;
                setCarry("crate");
                patchSurface({ [`h_crate_${meId}`]: 1 });
              }
            } else if (near && h.length >= 2) F.prompt = "Two crewmates are already carrying it";
          } else {
            const partner = h.find((i) => i !== meId);
            const pName = partner ? state_name(st, partner) : null;
            F.coop = partner ? `Carrying with ${pName}` : "Carrying alone: slow. A crewmate can lift the other end.";
            const site = readSite(ground, px, pz, { level: 0.96, minR: 40, craterOut: 1.3 });
            if (curTask) F.site = site;
            const nearT = site.ok && curTask;
            F.prompt = nearT ? "Press E to set the station down here" : curTask ? site.note + " Press E to put it down anywhere." : "Press E to put the station down.";
            if (eEdge && !F.usedE) {
              F.usedE = true;
              setCarry(null);
              if (nearT) {
                patchSurface({ [`h_crate_${meId}`]: 0, ix_crate: +px.toFixed(2), iz_crate: +pz.toFixed(2) });
                patchDone(t.id, pName ?? (solo ? "AI crew" : undefined));
                discover("station");
                thud(0.1, 140, 0.2);
              } else patchSurface({ [`h_crate_${meId}`]: 0, ...(partner ? {} : { ix_crate: +px.toFixed(2), iz_crate: +pz.toFixed(2) }) });
            }
          }
          break;
        }
        case "flag": {
          const f = flagAt(sdd, L);
          if (!sdd.flagUp) {
            const site = readSite(ground, px, pz, { level: 0.97, minR: 8, maxR: 45 });
            F.site = site;
            if (rt.interact && !site.ok && (p.cooldowns.flagNote ?? 0) < now) {
              p.cooldowns.flagNote = now + 4000;
              toast(site.note);
            }
            work("flag", site.ok, 2.4, "Hold E to plant the flag here", () => {
              patchSurface({ flagUp: Date.now(), flag_at: { x: +px.toFixed(2), z: +pz.toFixed(2) } });
              thud(0.1, 160, 0.2);
            });
            break;
          }
          const nearF = d2(f) < 9;
          if (p.photoT0 >= 0) break;
          const present = mates.filter((m) => {
            const r = posOf(m.id);
            return r && Math.hypot(r.x - f.x, r.z - f.z) < 9;
          });
          const all = present.length === mates.length;
          if (nearF) {
            F.coop = solo ? "Your AI crew gathers at the flag" : all ? "The whole crew is at the flag" : `Crew at the flag: ${present.length + 1} of ${mates.length + 1}`;
            F.prompt = all ? "Press E to take the team photo" : "Waiting for the crew. Hold E for 2 s to take the photo anyway.";
            const go = () => patchSurface({ photoGo: Date.now(), photoBy: meId ?? "", co_flag: solo ? "AI crew" : mates.length ? present.map((m) => m.name).join(", ") || "crew" : "" });
            if (all && eEdge && !F.usedE) {
              F.usedE = true;
              go();
            } else if (!all) work("photoforce", true, 2, F.prompt, go);
          }
          break;
        }
      }
    }

    // cable post: anyone may hold it steady for the engineer (a transient `sf_hold` every 0.25 s)
    if (!done.has("cable") && d2(L.cableB) < 2.6) {
      if (!F.prompt) F.prompt = "Hold E to keep the cable steady for the engineer";
      if (rt.interact && !F.usedE) {
        F.holding = true;
        p.holdSendT -= dt;
        if (p.holdSendT <= 0) {
          p.holdSendT = 0.25;
          sendHold("cable");
        }
        F.coop = "You are holding the cable post";
      }
    }

    // bought hints: tier 1 a direction (distance rounded), tier 2 the area on the radar and ground, tier 3 the exact spot
    const curT = open[0];
    const tier = curT ? hintTier(sdd, curT.id) : 0;
    let regions: { x: number; z: number; r: number }[] = [];
    if (curT && tier >= 1) {
      regions = hintTarget(curT.id, sdd, L, rt.carrying);
      const near = regions.slice().sort((u, v) => Math.hypot(u.x - px, u.z - pz) - Math.hypot(v.x - px, v.z - pz))[0];
      if (near) {
        const dd = Math.hypot(near.x - px, near.z - pz);
        F.guides.push({ angle: angDiff(rt.camYaw, Math.atan2(near.x - px, near.z - pz)), dist: tier >= 2 ? dd : Math.round(dd / 25) * 25, label: tier >= 3 ? "Exact spot" : tier === 2 ? "Search area" : "Hint: roughly this way", rough: tier < 2 });
      }
    }
    if (tier < 2) regions = [];

    // photo countdown and shutter
    if (p.photoT0 >= 0 && !done.has(FINAL.id)) {
      const t = (now - p.photoT0) / 1000;
      F.coop = t < 3 ? `Team photo in ${Math.ceil(3 - t)}` : "Hold still";
      F.prompt = null;
      if (t > 3 && !p.cooldowns.shutter) {
        p.cooldowns.shutter = 1;
        hud.set({ flash: hud.flash + 1 });
        beep(1100, 0.06, 0.12, "square");
      }
      if ((t > 3.4 && p.photoBy === meId) || t > 5.5) {
        if (!p.cooldowns.photoDone) {
          p.cooldowns.photoDone = 1;
          patchDone(FINAL.id, (sdd.co_flag as string) || undefined);
        }
      }
    }
    // AI crew join the flag in solo
    const wantGather = !!sdd.flagUp && solo && !done.has(FINAL.id) && layout;
    if (wantGather && !rt.gather) rt.gather = { ...flagAt(sdd, L) };
    else if (!wantGather && rt.gather) rt.gather = null;

    // field-note discovery near the player
    if (!F.holding) p.hold = Math.max(0, p.hold - dt * 1.5);

    p.hudT -= dt;
    if (p.hudT <= 0) {
      p.hudT = 0.1;
      const sorted = F.guides.sort((u, v) => u.dist - v.dist);
      hud.set({
        prompt: F.prompt,
        progress: F.progress,
        signal: F.signal,
        scanDist: F.scanDist,
        bars: F.bars,
        guides: sorted,
        site: F.site,
        regions,
        coop: F.coop,
        hazard: p.shaded || (p.steep && p.hazT > 0),
      });
    }
    void PLAY_RADIUS;
  });

  // dev + e2e hook: complete / inspect without the real inputs
  useEffect(() => {
    const w = window as unknown as { __surface?: Record<string, unknown> };
    if (w.__surface) Object.assign(w.__surface, { patch: patchSurface, repair: REPAIR, poi: usePoi });
  }, []);

  if (!plan || !layout) return null;
  const L = layout;
  const open = myOpenTasks(done, game.actsAs);
  const cur = open[0];
  const tier = cur ? hintTier(sd, cur.id) : 0;
  const targets = cur && tier >= 1 ? hintTarget(cur.id, sd, L, rt.carrying) : [];
  const relay = sd.relay as { x: number; z: number } | undefined;
  const flagSpot = flagAt(sd, L);
  const stakes = L.stakes.map((_, k) => sd[`s_${k}`] as Spot | undefined);
  const lrrrAt = sd.lrrr_at as Spot | undefined;
  return (
    <>
      <CarriedItems ground={ground} layout={L} />
      <Rack ground={ground} at={L.rack} stowed={done.has("stow")} />
      <CableRoute ground={ground} a={L.cableA} b={L.cableB} done={done.has("cable")} />
      {cur?.id === "gear" && tier >= 2 && <PadRings ground={ground} pads={L.pads} got={L.pads.map((_, k) => !!sd[`g_${k}`])} color={ROLE_COLOR.pilot} />}
      {stakes.map((s, k) => s && <Stake key={k} ground={ground} at={s} planted />)}
      {lrrrAt && <Lrrr ground={ground} at={lrrrAt} />}
      {done.has("crate") && sd.ix_crate !== undefined && <Station ground={ground} at={{ x: sd.ix_crate as number, z: sd.iz_crate as number }} />}
      {relay ? <RelayModel x={relay.x} z={relay.z} ground={ground} placedAt={prog.current.placedAt} /> : rt.carrying !== "relay" && <RelayPackage x={L.relayPick.x} z={L.relayPick.z} ground={ground} />}
      <CarriedRelay />
      {sd.flagUp ? <Flag pos={[flagSpot.x, ground.heightAt(flagSpot.x, flagSpot.z), flagSpot.z]} face={1.7} /> : null}
      <RepairPanel x={L.panel.x} z={L.panel.z} ground={ground} fixed={done.has("panel")} />
      {cur?.id === "ice" && <IceGlint x={L.scan.main.x} z={L.scan.main.z} ground={ground} reveal={1} />}
      {!done.has("cable") && state?.mode !== "solo" && cur?.id !== "cable" && <Beacon x={L.cableB.x} z={L.cableB.z} ground={ground} color="#ffb547" height={7} label="Cable post: hold E to help" dim />}
      {cur &&
        tier >= 2 &&
        targets.map((t, k) => (
          <group key={`${cur.id}${k}`}>
            <HintRegion id={`${cur.id}${k}`} ground={ground} spot={tier >= 3 ? { ...t, r: Math.min(t.r, 3) } : t} tier={tier} text={HINT_TEXT[cur.id]?.[tier - 1] ?? ""} />
            {tier >= 3 && <Beacon x={t.x} z={t.z} ground={ground} color={ROLE_COLOR[cur.role]} height={18} label="" />}
          </group>
        ))}
    </>
  );
}

function state_name(st: { players: { id: string; name: string }[] } | null | undefined, id: string) {
  return st?.players.find((p) => p.id === id)?.name ?? "A crewmate";
}

/** Open a field-note card for a point of interest (and credit the crew). Defined here to avoid a cycle with Pois. */
export function discover(id: string) {
  const st = useStore.getState();
  const meId = st.meId;
  const sd = surf(st.state);
  useSurface.getState().set({ card: id });
  if (!sd[`p_${id}`]) patchSurface({ [`p_${id}`]: meId });
}

export { ROLE_ORDER };
