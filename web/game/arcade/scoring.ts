// Challenge scoring. Plain numbers; api/app/routers/leaderboard.py recomputes the same formulas to validate submissions.
import type { LandResult } from "../phases/landing/sim";
import type { LaunchResult } from "../phases/launch/flight";

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lin = (v: number, good: number, bad: number) => clamp((bad - v) / (bad - good), 0, 1);
const rnd = (x: number) => Math.floor(x + 0.5);

export const LIMIT_DEG = 12; // leg tilt tolerance of the challenge lander (default tripod legs)
export const PAD_R = 3.45;
export const V_SAFE = 2.2;
export const V_CRASH = 5;
export type Grade = "S" | "A" | "B" | "C" | "D" | "F";

export interface ScorePart { label: string; points: number; max: number; text: string }
export interface Scored { score: number; grade: Grade; parts: ScorePart[]; status: string }

const CAPS = { ok: 1000, hard: 700, boulder: 700, tipped: 350, crashed: 100 } as const;
const FT = 3.281;

export function gradeFor(score: number, reason: string): Grade {
  if (reason === "crashed") return "F";
  return (([["S", 900], ["A", 780], ["B", 620], ["C", 450], ["D", 250]] as const).find(([, lo]) => score >= lo)?.[0] ?? "F") as Grade;
}

const STATUS = {
  ok: "Upright and stable. Clean landing.",
  hard: "Down, but the legs took a hard hit.",
  boulder: "Down, but a foot landed on a boulder.",
  tipped: "The lander tipped over on the slope.",
  crashed: "The lander hit the surface too hard.",
} as const;

/** Sink 300, sideways drift 200, tilt 150, on target 200, fuel left 150; capped by the outcome. */
export function scoreLanding(r: Pick<LandResult, "reason" | "vV" | "vH" | "tilt" | "miss" | "fuelPct">): Scored {
  const sink = rnd(300 * lin(r.vV, 0.8, V_CRASH));
  const drift = rnd(200 * lin(r.vH, 0.4, 4));
  const tilt = rnd(150 * lin(r.tilt / LIMIT_DEG, 0.3, 1.1));
  const tgt = rnd(200 * lin(r.miss, 6, 120));
  const fuel = rnd(150 * clamp(r.fuelPct / 30, 0, 1));
  const raw = 300 * lin(r.vV, 0.8, V_CRASH) + 200 * lin(r.vH, 0.4, 4) + 150 * lin(r.tilt / LIMIT_DEG, 0.3, 1.1) + 200 * lin(r.miss, 6, 120) + 150 * clamp(r.fuelPct / 30, 0, 1);
  const score = Math.min(CAPS[r.reason], rnd(raw));
  return {
    score, grade: gradeFor(score, r.reason), status: STATUS[r.reason],
    parts: [
      { label: "Sink rate", points: sink, max: 300, text: `${(r.vV * FT).toFixed(1)} ft/s (${r.vV.toFixed(2)} m/s). Safe is under ${(V_SAFE * FT).toFixed(0)}.` },
      { label: "Drift", points: drift, max: 200, text: `${(r.vH * FT).toFixed(1)} ft/s sideways.` },
      { label: "Tilt", points: tilt, max: 150, text: `${r.tilt.toFixed(1)} deg. The legs allow ${LIMIT_DEG}.` },
      { label: "On target", points: tgt, max: 200, text: `${Math.round(r.miss)} m from the ring.` },
      { label: "Fuel left", points: fuel, max: 150, text: `${Math.round(r.fuelPct)}% of the tank.` },
    ],
  };
}

export const TOL = 100; // half-width of the green burn window (m/s)
export const TRAJ_TOL = 8;
const stageScore = (d: number) => 100 * clamp(1 - (d - 0.5) / 3.5, 0, 1);

export function launchParts(rmsDeg: number, d1: number, d2: number, dv: number) {
  const traj = rnd(100 * clamp(1 - (rmsDeg - TRAJ_TOL * 0.15) / (TRAJ_TOL * 1.1), 0, 1));
  const staging = rnd((stageScore(d1) + stageScore(d2)) / 2);
  const burn = rnd(100 * clamp(1 - (Math.abs(dv) - TOL / 3) / (TOL * 3), 0, 1));
  return { traj, staging, burn };
}

/** Trajectory 400, staging 250, burn accuracy 350. */
export function scoreLaunch(r: Pick<LaunchResult, "rmsDeg" | "stageDelays" | "dv">): Scored {
  const p = launchParts(r.rmsDeg, r.stageDelays[0], r.stageDelays[1], r.dv);
  const score = rnd(4 * p.traj + 2.5 * p.staging + 3.5 * p.burn);
  return {
    score, grade: gradeFor(score, "ok"),
    status: p.burn > 80 ? "Right on the translunar speed." : p.burn > 40 ? "Close. The Moon is still reachable." : "Far from the target speed.",
    parts: [
      { label: "Trajectory", points: rnd(4 * p.traj), max: 400, text: `${r.rmsDeg.toFixed(1)} deg average error from the guide.` },
      { label: "Staging", points: rnd(2.5 * p.staging), max: 250, text: `${r.stageDelays.map((d) => d.toFixed(1)).join(" s and ")} s after burnout.` },
      { label: "Burn accuracy", points: rnd(3.5 * p.burn), max: 350, text: `${r.dv >= 0 ? "+" : ""}${Math.round(r.dv)} m/s from the target speed.` },
    ],
  };
}
