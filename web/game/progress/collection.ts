// Collection log data: points of interest, achievements and the titles they award.
import type { Done } from "../journey/progress";
import { LEVEL_COUNT } from "../journey/levels";
import { totalStars } from "../journey/progress";
import { ownedTierCount, type Owned } from "./upgrades";

/**
 * Points of interest the surface phase records as `p_<id>: 1` keys in phaseData.surface (see surface/coop.ts).
 * Mirrors surface/fieldnotes.ts; any other `p_` id found in a game is still counted and shown.
 */
export const POIS: { id: string; title: string; kind: "heritage" | "environment" | "instrument" }[] = [
  { id: "mip", title: "Chandrayaan-1 Moon Impact Probe", kind: "heritage" },
  { id: "lcross", title: "LCROSS Centaur impact", kind: "heritage" },
  { id: "lcross_shep", title: "LCROSS shepherding craft", kind: "heritage" },
  { id: "athena", title: "Athena (IM-2) lander", kind: "heritage" },
  { id: "odysseus", title: "Odysseus (IM-1) lander", kind: "heritage" },
  { id: "vikram2", title: "Chandrayaan-2 Vikram crash site", kind: "heritage" },
  { id: "vikram3", title: "Chandrayaan-3 Vikram lander", kind: "heritage" },
  { id: "luna25", title: "Luna 25 crash site", kind: "heritage" },
  { id: "psr", title: "Permanently shadowed crater", kind: "environment" },
  { id: "ice", title: "Signs of water ice", kind: "environment" },
  { id: "regolith", title: "Lunar regolith", kind: "environment" },
  { id: "boulder", title: "Boulder with a track", kind: "environment" },
  { id: "crater", title: "Small impact crater", kind: "environment" },
  { id: "sun", title: "The low Sun", kind: "environment" },
  { id: "earth", title: "Earth on the horizon", kind: "environment" },
  { id: "lrrr", title: "Laser retroreflector", kind: "instrument" },
  { id: "station", title: "Seismometer station", kind: "instrument" },
];

export interface Stats {
  missions: number;
  passed: number;
  clean: number; // passed with the hull untouched
  perfectLandings: number; // landing score 90+
  coopMissions: number;
  earned: number; // lifetime credits
}
export const EMPTY_STATS: Stats = { missions: 0, passed: 0, clean: 0, perfectLandings: 0, coopMissions: 0, earned: 0 };

export interface Records {
  bestScore: number;
  bestBuild: number;
  bestLaunch: number;
  bestCruise: number;
  bestLanding: number;
  bestSurface: number;
  /** Softest touchdown in m/s, lower is better (null = none recorded). */
  softestLanding: number | null;
  /** Smallest TLI burn error in m/s (null = none recorded). */
  bestBurnError: number | null;
}
export const EMPTY_RECORDS: Records = { bestScore: 0, bestBuild: 0, bestLaunch: 0, bestCruise: 0, bestLanding: 0, bestSurface: 0, softestLanding: null, bestBurnError: null };

export interface Ctx {
  stats: Stats;
  records: Records;
  done: Record<number, Done>;
  discovered: string[];
  owned: Owned;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Title shown beside the player's name once earned. Later entries outrank earlier ones. */
  title?: string;
  goal: number;
  value: (c: Ctx) => number;
}

const heritage = POIS.filter((p) => p.kind === "heritage").map((p) => p.id);

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first", name: "First Flight", desc: "Pass a level.", title: "Rookie", goal: 1, value: (c) => c.stats.passed },
  { id: "builder", name: "Perfect Build", desc: "Score 95 or more in the build phase.", title: "Master Builder", goal: 95, value: (c) => c.records.bestBuild },
  { id: "scientist", name: "Field Scientist", desc: "Find 5 points of interest.", title: "Field Scientist", goal: 5, value: (c) => c.discovered.length },
  { id: "crew", name: "Crew in Sync", desc: "Finish 3 missions with surface tasks done together.", title: "Team Player", goal: 3, value: (c) => c.stats.coopMissions },
  { id: "iron", name: "Iron Hull", desc: "Pass a mission without taking any damage.", title: "Iron Hull", goal: 1, value: (c) => c.stats.clean },
  { id: "ace", name: "Ace Pilot", desc: "Make 3 perfect landings (landing score 90+).", title: "Ace Pilot", goal: 3, value: (c) => c.stats.perfectLandings },
  { id: "equipped", name: "Well Equipped", desc: "Buy 6 hangar upgrades.", title: "Chief Engineer", goal: 6, value: (c) => ownedTierCount(c.owned) },
  { id: "historian", name: "Heritage Hunter", desc: "Find every heritage site.", title: "Historian", goal: heritage.length, value: (c) => heritage.filter((h) => c.discovered.includes(h)).length },
  { id: "veteran", name: "Mission Patches", desc: "Complete 10 levels.", title: "Veteran", goal: 10, value: (c) => Object.keys(c.done).length },
  { id: "stars", name: "Star Collector", desc: "Earn 30 stars.", title: "Star Chaser", goal: 30, value: (c) => totalStars(c.done) },
  { id: "apollo", name: "Apollo N", desc: "Complete the last level.", title: "Moonwalker", goal: 1, value: (c) => (c.done[LEVEL_COUNT] ? 1 : 0) },
];

export const isEarned = (a: Achievement, c: Ctx) => a.value(c) >= a.goal;

/** The highest title earned (later list entries outrank earlier ones), or null. */
export function titleOf(c: Ctx): string | null {
  let t: string | null = null;
  for (const a of ACHIEVEMENTS) if (a.title && isEarned(a, c)) t = a.title;
  return t;
}
export const earnedTitles = (c: Ctx) => ACHIEVEMENTS.filter((a) => a.title && isEarned(a, c)).map((a) => a.title as string);

export function completion(c: Ctx) {
  const patches = Object.keys(c.done).length;
  const found = POIS.filter((p) => c.discovered.includes(p.id)).length;
  const ach = ACHIEVEMENTS.filter((a) => isEarned(a, c)).length;
  const total = LEVEL_COUNT + POIS.length + ACHIEVEMENTS.length;
  return { patches, found, ach, pct: Math.round(((patches + found + ach) / total) * 100) };
}
