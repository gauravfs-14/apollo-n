"use client";
// Titles beside player names. Each client writes its own title as a `t_<playerId>` key into the current phase's data
// (one tiny patch per phase), and everyone reads them from any phase. No server change.
import { useEffect } from "react";
import { useGame } from "../core/useGame";
import { useStore } from "../core/store";
import { useCtx } from "./store";
import { titleOf } from "./collection";

export function useMyTitle(): string | null {
  return titleOf(useCtx());
}

/** Publishes my title once per phase. Mount once (top bar). */
export function useTitleSync() {
  const { patch } = useGame();
  const title = useMyTitle();
  const meId = useStore((s) => s.meId);
  const phase = useStore((s) => s.state?.phase);
  const joined = useStore((s) => !!s.state?.players.some((p) => p.id === s.meId));
  useEffect(() => {
    if (!title || !meId || !phase || !joined) return;
    patch(phase, { [`t_${meId}`]: title });
  }, [title, meId, phase, joined, patch]);
}

/** A player's title: mine from my own hangar, others' from the shared data. */
export function useTitleOf(playerId: string): string | null {
  const mine = useMyTitle();
  const meId = useStore((s) => s.meId);
  const shared = useStore((s) => {
    const pd = s.state?.phaseData ?? {};
    for (const d of Object.values(pd)) {
      const v = (d as Record<string, unknown> | undefined)?.[`t_${playerId}`];
      if (typeof v === "string") return v;
    }
    return null;
  });
  return playerId === meId ? mine : shared;
}
