"use client";
// Mission cards for the select screen: instant from the API pool, offline fallback if the API is down.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import fallbackPlan from "../../data/fallback-plan.json";
import type { Difficulty, MissionPlan } from "../../types";

export interface MissionCard {
  plan: MissionPlan;
  image?: { url: string; title: string; credit: string; page: string } | null;
  kind: "live" | "fallback";
}

interface Options {
  cards: MissionCard[];
  generating: boolean;
}

function offline(difficulty: Difficulty): MissionCard[] {
  const plan = { ...(fallbackPlan as unknown as MissionPlan), difficulty };
  return [{ plan, image: null, kind: "fallback" }];
}

export function useMissions(difficulty: Difficulty, enabled: boolean, onLoaded?: (cards: MissionCard[]) => void) {
  const [loaded, setLoaded] = useState<{ d: Difficulty; cards: MissionCard[] | null } | null>(null);
  const cards = loaded?.d === difficulty ? loaded.cards : null;
  const setCards = useCallback((c: MissionCard[] | null) => setLoaded({ d: difficulty, cards: c }), [difficulty]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [offlineMode, setOffline] = useState(false);
  const hover = useRef(false);
  const live = useRef(0);
  const cb = useRef(onLoaded);
  useEffect(() => {
    cb.current = onLoaded;
  });

  const load = useCallback(
    async (refresh = false) => {
      try {
        const res = await api<Options>(`/missions/options?difficulty=${difficulty}${refresh ? "&refresh=true" : ""}`);
        live.current = res.cards.filter((c) => c.kind === "live").length;
        setCards(res.cards);
        setGenerating(res.generating);
        setOffline(false);
        cb.current?.(res.cards);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reach mission control");
        const o = offline(difficulty);
        setCards(o);
        setOffline(true);
        cb.current?.(o);
      }
    },
    [difficulty, setCards],
  );

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/difficulty change; state is set after the await
    void load();
  }, [load, enabled]);

  // While fresh news-based missions are still being written, quietly upgrade archive cards.
  useEffect(() => {
    if (!enabled || !generating || offlineMode) return;
    const t = setInterval(async () => {
      if (hover.current) return;
      try {
        const res = await api<Options>(`/missions/options?difficulty=${difficulty}`);
        const n = res.cards.filter((c) => c.kind === "live").length;
        setGenerating(res.generating);
        if (n > live.current) {
          live.current = n;
          setCards(res.cards);
          cb.current?.(res.cards);
        }
      } catch {}
    }, 15000);
    return () => clearInterval(t);
  }, [enabled, generating, offlineMode, difficulty, setCards]);

  const setHover = useCallback((v: boolean) => {
    hover.current = v;
  }, []);
  const reload = useCallback(
    (refresh = false) => {
      setError(null);
      setCards(null);
      return load(refresh);
    },
    [load, setCards],
  );
  return { cards, error, generating, offlineMode, reload, setHover };
}

/** Non-hosts: fetch the cards the commander is looking at, by id. */
export function useSharedCards(ids: string[] | undefined, enabled: boolean) {
  const [cards, setCards] = useState<MissionCard[] | null>(null);
  const key = ids?.join(",") ?? "";
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    Promise.all(key.split(",").map((id) => api<MissionCard>(`/missions/${id}/card`).catch(() => null))).then((r) => {
      if (alive) setCards(r.filter(Boolean) as MissionCard[]);
    });
    return () => {
      alive = false;
    };
  }, [key, enabled]);
  return cards;
}
