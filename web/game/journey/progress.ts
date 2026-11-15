"use client";
// Solo journey progress, kept in localStorage. Multiplayer: the host's journey decides the level.
import { useEffect } from "react";
import { create } from "zustand";
import { LEVEL_COUNT } from "./levels";

const KEY = "apollo.journey.v1";

export interface Done {
  stars: number; // 1..3
  score: number;
}
interface Saved {
  done: Record<number, Done>;
  plans: Record<number, string>;
}
interface Journey extends Saved {
  hydrated: boolean;
  /** Start this level as soon as the map opens (Next level / Retry level). Memory only. */
  autoPlay: number | null;
  hydrate: () => void;
  recordWin: (level: number, score: number, stars: number) => void;
  setPlan: (level: number, id: string) => void;
  setAutoPlay: (level: number | null) => void;
  reset: () => void;
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ done: s.done, plans: s.plans }));
  } catch {}
}

export const useJourneyStore = create<Journey>((set, get) => ({
  done: {},
  plans: {},
  hydrated: false,
  autoPlay: null,
  hydrate: () => {
    if (get().hydrated) return;
    let saved: Partial<Saved> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {}
    set({ done: saved.done ?? {}, plans: saved.plans ?? {}, hydrated: true });
  },
  recordWin: (level, score, stars) => {
    const prev = get().done[level];
    const done = { ...get().done, [level]: { stars: Math.max(prev?.stars ?? 0, stars), score: Math.max(prev?.score ?? 0, score) } };
    set({ done });
    save({ done, plans: get().plans });
  },
  setPlan: (level, id) => {
    const plans = { ...get().plans, [level]: id };
    set({ plans });
    save({ done: get().done, plans });
  },
  setAutoPlay: (autoPlay) => set({ autoPlay }),
  reset: () => {
    set({ done: {}, plans: {}, autoPlay: null });
    save({ done: {}, plans: {} });
  },
}));

/** The level the player should play next: first level not yet completed. */
export function currentLevel(done: Record<number, Done>): number {
  let n = 1;
  while (n < LEVEL_COUNT && done[n]) n++;
  return n;
}
export const totalStars = (done: Record<number, Done>) => Object.values(done).reduce((a, d) => a + d.stars, 0);

/** Hook: hydrates from localStorage on mount (client only) and returns derived progress. */
export function useJourney() {
  const s = useJourneyStore();
  const hydrate = s.hydrate;
  useEffect(() => hydrate(), [hydrate]);
  const current = currentLevel(s.done);
  return { ...s, current, stars: totalStars(s.done), finished: !!s.done[LEVEL_COUNT] };
}

if (typeof window !== "undefined") (window as unknown as { __apolloJourney?: unknown }).__apolloJourney = useJourneyStore;
