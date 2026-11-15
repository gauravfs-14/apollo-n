"use client";
// Player progression: credits, hangar upgrades, personal records, discoveries. Kept in localStorage (per player, per browser).
// Journey levels/stars/patches live in journey/progress.ts; this store holds everything that is spent or earned on top.
import { useEffect } from "react";
import { create } from "zustand";
import type { PerkId } from "../data/perks";
import { useJourneyStore } from "../journey/progress";
import { EMPTY_RECORDS, EMPTY_STATS, earnedTitles, titleOf, type Ctx, type Records, type Stats } from "./collection";
import { computeRewards, type RewardLine } from "./economy";
import { upgradeById, type Owned, type UpgradeId } from "./upgrades";

const KEY = "apollo.progress.v1";

export interface Summary {
  key: string;
  lines: RewardLine[];
  total: number;
  /** Records broken by this mission. */
  records: { label: string; value: string }[];
  /** Titles earned for the first time by this mission. */
  titles: string[];
  creditsAfter: number;
}

interface Saved {
  credits: number;
  owned: Owned;
  perk: PerkId | null;
  stats: Stats;
  records: Records;
  discovered: string[];
  lastClaim: Summary | null;
  claims: string[];
}
interface Progress extends Saved {
  hydrated: boolean;
  hydrate: () => void;
  buy: (id: UpgradeId) => boolean;
  setPerk: (p: PerkId | null) => void;
  claim: (m: MissionFacts) => Summary;
  reset: () => void;
}

/** What the report knows about the finished mission. */
export interface MissionFacts {
  key: string;
  level?: number;
  passed: boolean;
  total: number;
  stars: number;
  hp: number;
  hpMax: number;
  scores: Partial<Record<string, number>>;
  /** POI ids discovered in this game (phaseData.surface `p_<id>` keys). */
  discovered: string[];
  /** Shared surface tasks done with a human partner (phaseData.surface `co_<task>` keys). */
  coopTasks: number;
  /** Supply points left at the end (state.sp). */
  supplyLeft?: number;
  /** Optional numbers other phases may patch: phaseData.landing.sink (m/s), phaseData.launch.burnErr (m/s). */
  sink?: number;
  burnErr?: number;
}

const FRESH: Saved = { credits: 0, owned: {}, perk: null, stats: EMPTY_STATS, records: EMPTY_RECORDS, discovered: [], lastClaim: null, claims: [] };

function persist(s: Saved) {
  try {
    const { credits, owned, perk, stats, records, discovered, lastClaim, claims } = s;
    localStorage.setItem(KEY, JSON.stringify({ credits, owned, perk, stats, records, discovered, lastClaim, claims }));
  } catch {}
}
const pick = (s: Saved): Saved => ({ credits: s.credits, owned: s.owned, perk: s.perk, stats: s.stats, records: s.records, discovered: s.discovered, lastClaim: s.lastClaim, claims: s.claims });

export const useProgressStore = create<Progress>((set, get) => ({
  ...FRESH,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    let saved: Partial<Saved> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {}
    set({
      ...FRESH, ...saved,
      stats: { ...EMPTY_STATS, ...saved.stats },
      records: { ...EMPTY_RECORDS, ...saved.records },
      hydrated: true,
    });
  },
  buy: (id) => {
    const s = get();
    const up = upgradeById(id);
    const have = s.owned[id] ?? 0;
    const tier = up.tiers[have];
    if (!tier || s.credits < tier.cost) return false;
    const done = useJourneyStore.getState().done;
    if (tier.req && !done[tier.req]) return false;
    const next = { ...pick(s), credits: s.credits - tier.cost, owned: { ...s.owned, [id]: have + 1 } };
    set(next);
    persist(next);
    return true;
  },
  setPerk: (perk) => {
    set({ perk });
    persist({ ...pick(get()), perk });
  },
  claim: (m) => {
    const s = get();
    if (s.claims.includes(m.key) && s.lastClaim?.key === m.key) return s.lastClaim;
    const done = useJourneyStore.getState().done;
    const firstClear = !!m.level && !done[m.level];
    const known = new Set(s.discovered);
    const fresh = m.discovered.filter((d) => !known.has(d));
    const { lines, total } = computeRewards({
      level: m.level, passed: m.passed, total: m.total, stars: m.stars, hp: m.hp, hpMax: m.hpMax,
      newDiscoveries: fresh.length, coopTasks: m.coopTasks, firstClear, supplyLeft: m.supplyLeft,
    });

    const sc = (k: string) => Number(m.scores[k] ?? 0);
    const r = { ...s.records };
    const broke: Summary["records"] = [];
    const higher = (field: keyof Pick<Records, "bestScore" | "bestBuild" | "bestLaunch" | "bestCruise" | "bestLanding" | "bestSurface">, label: string, v: number) => {
      if (v > r[field]) {
        if (r[field] > 0) broke.push({ label, value: String(Math.round(v)) });
        r[field] = Math.round(v);
      }
    };
    if (m.passed) higher("bestScore", "Best mission score", m.total);
    higher("bestBuild", "Best build", sc("build"));
    higher("bestLaunch", "Best launch", sc("launch"));
    higher("bestCruise", "Best cruise", sc("cruise"));
    higher("bestLanding", "Best landing", sc("landing"));
    higher("bestSurface", "Best surface work", sc("surface"));
    if (m.sink !== undefined && Number.isFinite(m.sink) && (r.softestLanding === null || m.sink < r.softestLanding)) {
      if (r.softestLanding !== null) broke.push({ label: "Softest landing", value: `${m.sink.toFixed(2)} m/s` });
      r.softestLanding = m.sink;
    }
    if (m.burnErr !== undefined && Number.isFinite(m.burnErr) && (r.bestBurnError === null || m.burnErr < r.bestBurnError)) {
      if (r.bestBurnError !== null) broke.push({ label: "Closest burn", value: `${m.burnErr.toFixed(1)} m/s off` });
      r.bestBurnError = m.burnErr;
    }

    const stats: Stats = {
      missions: s.stats.missions + 1,
      passed: s.stats.passed + (m.passed ? 1 : 0),
      clean: s.stats.clean + (m.passed && m.hp >= m.hpMax ? 1 : 0),
      perfectLandings: s.stats.perfectLandings + (sc("landing") >= 90 ? 1 : 0),
      coopMissions: s.stats.coopMissions + (m.passed && m.coopTasks > 0 ? 1 : 0),
      earned: s.stats.earned + total,
    };
    const discovered = [...s.discovered, ...fresh];
    // the journey store has not recorded this win yet when the report claims first, so count it in for the titles
    const doneAfter = m.passed && m.level && !done[m.level] ? { ...done, [m.level]: { stars: m.stars, score: m.total } } : done;
    const before: Ctx = { stats: s.stats, records: s.records, done, discovered: s.discovered, owned: s.owned };
    const after: Ctx = { stats, records: r, done: doneAfter, discovered, owned: s.owned };
    const had = new Set(earnedTitles(before));
    const titles = earnedTitles(after).filter((t) => !had.has(t));

    const summary: Summary = { key: m.key, lines, total, records: broke, titles, creditsAfter: s.credits + total };
    const next: Saved = { credits: s.credits + total, owned: s.owned, perk: s.perk, stats, records: r, discovered, lastClaim: summary, claims: [...s.claims, m.key].slice(-20) };
    set(next);
    persist(next);
    return summary;
  },
  reset: () => {
    set({ ...FRESH });
    persist(FRESH);
  },
}));

/** Hydrates from localStorage on mount (client only). */
export function useProgress() {
  const s = useProgressStore();
  const hydrate = s.hydrate;
  useEffect(() => {
    hydrate();
    useJourneyStore.getState().hydrate(); // levels cleared gate the upgrades
  }, [hydrate]);
  return s;
}

/** Snapshot for titles and the collection log. */
export function useCtx(): Ctx {
  const p = useProgress();
  const done = useJourneyStore((s) => s.done);
  return { stats: p.stats, records: p.records, done, discovered: p.discovered, owned: p.owned };
}
export const currentTitle = (): string | null => {
  const p = useProgressStore.getState();
  return titleOf({ stats: p.stats, records: p.records, done: useJourneyStore.getState().done, discovered: p.discovered, owned: p.owned });
};

if (typeof window !== "undefined") (window as unknown as { __apolloProgress?: unknown }).__apolloProgress = useProgressStore;
