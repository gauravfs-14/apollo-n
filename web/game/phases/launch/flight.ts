// The ascent the player flies, as plain numbers (no React, no three): the same object is simulated on the pilot's client
// and copied to the others ten times a second. All times are on the launch clock (clock.ts, seconds).
//
//   steering   pitch program: follow the guide with the arrow keys (flight director needle). Gusts push you off it.
//   staging    first stage burns out at T.s1Burnout, second at s1Sep + 6.8 s: press SPACE to stage (easy: automatic).
//   TLI burn   after the second separation the burn window opens: SPACE starts it and SPACE cuts it off
//              at the target speed (easy: automatic cutoff). The burn is time-compressed (about 11 s for 3 km/s).
import type { Difficulty } from "../../types";
import { T } from "./timeline";

export const TLI = { v0: 7800, target: 10900, rate: 280 } as const; // m/s, m/s, m/s per second

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sm = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;

/** Pitch program, radians from vertical: straight up, then over to nearly horizontal by about T+16 s. */
export const guideAt = (tp: number) => (tp < 4 ? 0 : Math.min(86, 0.55 * (tp - 4) * (tp - 4))) * D2R;

export interface LaunchParams {
  /** autopilot pull toward the guide (1/s) */
  assist: number;
  /** gust strength (rad/s) */
  gust: number;
  autoStage: boolean;
  autoCut: boolean;
  /** half-width of the green burn window (m/s) */
  tol: number;
  /** rms pitch error (deg) that costs most of the trajectory points */
  trajTol: number;
  /** pitch error (deg) at which Houston calls it */
  warn: number;
}
export const launchParams = (d: Difficulty | undefined): LaunchParams =>
  ({
    easy: { assist: 1.1, gust: 0.02, autoStage: true, autoCut: true, tol: 200, trajTol: 14, warn: 14 },
    normal: { assist: 0.3, gust: 0.045, autoStage: false, autoCut: false, tol: 100, trajTol: 8, warn: 9 },
    hard: { assist: 0, gust: 0.07, autoStage: false, autoCut: false, tol: 50, trajTol: 5, warn: 6 },
  })[d ?? "normal"];

export interface LaunchResult {
  total: number;
  traj: number;
  staging: number;
  burn: number;
  rmsDeg: number;
  stageDelays: [number, number];
  /** achieved minus target speed (m/s) */
  dv: number;
}

export interface LaunchSim {
  /** launch clock at the last step */
  t: number;
  p: number; // pitch flown (rad from vertical)
  g: number; // guide (rad)
  err: number; // p - g (rad)
  s1CutAt: number; // -1 = not yet
  s1SepAt: number;
  s2CutAt: number;
  s2SepAt: number;
  readyAt: number; // burn window opens
  burnAt: number; // ignition
  burnEndAt: number; // cutoff
  endAt: number; // phase ends (fade + complete)
  s1Delay: number;
  s2Delay: number;
  auto1: boolean; // staged automatically (assist or timeout)
  auto2: boolean;
  autoBurn: boolean;
  v: number; // m/s
  altKm: number;
  sumErr2: number;
  nErr: number;
  result: LaunchResult | null;
  /** the crew skipped the rest of the ascent */
  skip: boolean;
}

export const newLaunch = (): LaunchSim => ({
  t: 0, p: 0, g: 0, err: 0, s1CutAt: -1, s1SepAt: -1, s2CutAt: -1, s2SepAt: -1, readyAt: -1, burnAt: -1, burnEndAt: -1, endAt: -1,
  s1Delay: -1, s2Delay: -1, auto1: false, auto2: false, autoBurn: false, v: 0, altKm: 0, sumErr2: 0, nErr: 0, result: null, skip: false,
});

/** What the crew has to do right now: stage, start the burn, cut it off, or nothing. */
export type Need = "none" | "stage" | "ignite" | "cutoff";
export function needOf(s: LaunchSim): Need {
  if (s.burnEndAt >= 0) return "none";
  if (s.burnAt >= 0) return "cutoff";
  if (s.readyAt >= 0 && s.readyAt <= s.t) return "ignite";
  if ((s.s1CutAt >= 0 && s.s1SepAt < 0) || (s.s2CutAt >= 0 && s.s2SepAt < 0)) return "stage";
  return "none";
}
/** Role that does it (commander stages, pilot flies the burn). */
export const needRole = (n: Need) => (n === "stage" ? "commander" : "pilot");

/** Engines on: first stage, second stage (from 0.8 s after the first separation) or the S-IVB during the burn. */
export const enginesOn = (s: LaunchSim, t: number) => ({
  s1: t < T.liftoff ? false : s.s1CutAt < 0 || t < s.s1CutAt,
  s2: s.s1SepAt >= 0 && t >= s.s1SepAt + 0.8 && (s.s2CutAt < 0 || t < s.s2CutAt),
  s3: s.burnAt >= 0 && s.burnEndAt < 0,
});

export function stageScore(delay: number) {
  return 100 * clamp01(1 - (delay - 0.5) / 3.5);
}

/** Advance the ascent by dt. `steer`: -1..1 (negative = back toward vertical), `act`: SPACE pressed this frame (already role-checked). */
export function stepLaunch(s: LaunchSim, t: number, dt: number, steer: number, act: boolean, P: LaunchParams) {
  s.t = t;
  const tp = t - T.liftoff;
  if (tp < 0 || s.endAt >= 0 && t >= s.endAt) return;

  // ---- pitch program
  s.g = guideAt(tp);
  const gust = P.gust * (Math.sin(t * 0.9) + 0.6 * Math.sin(t * 2.3 + 1.1));
  s.p = Math.min(1.7, Math.max(-0.3, s.p + (steer * 0.42 + P.assist * (s.g - s.p) + gust) * dt));
  s.err = s.p - s.g;
  const on = enginesOn(s, t);
  if ((on.s1 || on.s2 || on.s3) && tp > 1) {
    s.sumErr2 += s.err * s.err * dt;
    s.nErr += dt;
  }

  // ---- first stage cutoff and separation
  if (s.s1CutAt < 0 && t >= T.s1Burnout) s.s1CutAt = t;
  if (s.s1CutAt >= 0 && s.s1SepAt < 0) {
    const w = t - s.s1CutAt;
    if (act || (P.autoStage && w >= 0.9) || w >= 5) {
      s.s1SepAt = t;
      s.s1Delay = w;
      s.auto1 = !act;
      act = false;
    }
  }
  // ---- second stage
  if (s.s1SepAt >= 0 && s.s2CutAt < 0 && t >= s.s1SepAt + 6.8) s.s2CutAt = t;
  if (s.s2CutAt >= 0 && s.s2SepAt < 0) {
    const w = t - s.s2CutAt;
    if (act || (P.autoStage && w >= 0.9) || w >= 5) {
      s.s2SepAt = t;
      s.s2Delay = w;
      s.auto2 = !act;
      s.readyAt = t + 1.6;
      act = false;
    }
  }
  // ---- TLI burn
  if (s.readyAt >= 0 && s.burnAt < 0 && t >= s.readyAt && (act || t >= s.readyAt + 8)) {
    s.burnAt = t;
    s.autoBurn = !act;
    act = false;
  }
  const f = clamp01(tp / 26);
  if (s.burnAt < 0) {
    s.v = TLI.v0 * Math.pow(sm(f), 1.4);
    s.altKm = 190 * Math.pow(s.v / TLI.v0, 1.3);
  } else if (s.burnEndAt < 0) {
    s.v += TLI.rate * clamp01((t - s.burnAt) / 0.8) * dt;
    const settled = t - s.burnAt > 0.8; // a double press on ignition must not cut the burn straight off
    if ((act && settled) || (P.autoCut && s.v >= TLI.target) || s.v >= TLI.target + 500) {
      s.burnEndAt = t;
      s.endAt = t + 4.6;
      const rmsDeg = Math.sqrt(s.sumErr2 / Math.max(0.1, s.nErr)) / D2R;
      const dv = s.v - TLI.target;
      const traj = Math.round(100 * clamp01(1 - (rmsDeg - P.trajTol * 0.15) / (P.trajTol * 1.1)));
      const staging = Math.round((stageScore(s.s1Delay) + stageScore(s.s2Delay)) / 2);
      const burn = Math.round(100 * clamp01(1 - (Math.abs(dv) - P.tol / 3) / (P.tol * 3)));
      s.result = {
        total: Math.round(0.4 * traj + 0.25 * staging + 0.35 * burn), traj, staging, burn, rmsDeg,
        stageDelays: [s.s1Delay, s.s2Delay], dv,
      };
    }
  }
}
