"use client";
import { create } from "zustand";
import type { Replay } from "./replay";
import type { Scored } from "./scoring";
import type { LaunchResult } from "../phases/launch/flight";
import type { LandResult } from "../phases/landing/sim";

export interface LandTelem {
  t: number; alt: number; vy: number; vf: number; vr: number; thr: number; fuelPct: number; hover: boolean; vt: number;
  leanF: number; leanR: number; slopeF: number; slopeR: number; tgtF: number; tgtR: number; contact: boolean; down: boolean; since: number;
}
export interface LaunchTelem { t: number; p: number; g: number; err: number; v: number; altKm: number; need: string; stage: string; countdown: number; over: boolean }

export interface Info { seed: number; site: string; siteName: string; startAlt?: number; startDist?: number; date?: string }

export interface RunResult {
  challenge: "landing" | "launch";
  seed: number;
  scored: Scored;
  /** the numbers the API validates (see api/app/routers/leaderboard.py) */
  stats: Record<string, number | string>;
  replay?: Replay;
  land?: LandResult;
  launch?: LaunchResult;
  timeS: number;
}

interface Arcade {
  loaded: boolean;
  info: Info | null;
  land: LandTelem | null;
  launch: LaunchTelem | null;
  result: RunResult | null;
  limit: number;
}
export const useArcade = create<Arcade>(() => ({ loaded: false, info: null, land: null, launch: null, result: null, limit: 12 }));

// QA hook: scripts/challenge-run.mjs
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __arcade: typeof useArcade }).__arcade = useArcade;
