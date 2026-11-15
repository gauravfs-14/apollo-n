"use client";
// Hint shop. Tiers are bought with supply points (spend() is server-checked); the unlock is written to phaseData.surface as
// h_<task> = tier only by the client that spent, once state.sp has actually dropped. Everyone then sees the hint.
import { canAfford, PRICES, spend } from "../../core/economy";
import { useStore } from "../../core/store";
import { patchSurface, surf } from "./coop";

export const hintTier = (sd: Record<string, unknown>, id: string) => Number(sd[`h_${id}`] ?? 0) || 0;
export const hintsUsed = (sd: Record<string, unknown>) => Object.keys(sd).reduce((n, k) => (k.startsWith("h_") ? n + (Number(sd[k]) || 0) : n), 0);
export const hintPrice = (tier: 1 | 2 | 3) => PRICES.hint[tier - 1];

let pending: { id: string; tier: number; sp0: number; t: number } | null = null;

/** Buy the next tier for a task (only the next one: each unlocks the one after). */
export function buyHint(id: string, tier: 1 | 2 | 3) {
  const st = useStore.getState();
  const have = hintTier(surf(st.state), id);
  if (tier !== have + 1 || pending) return;
  if (!canAfford(hintPrice(tier))) return st.setError("Not enough supply points");
  pending = { id, tier, sp0: st.state?.sp ?? 0, t: performance.now() };
  spend(hintPrice(tier), `hint:${id}:${tier}`);
}

/** Call once from the surface scene: completes a purchase when the server has taken the points. */
export function watchHintPurchases() {
  return useStore.subscribe((s) => {
    if (!pending) return;
    if ((s.state?.sp ?? 0) < pending.sp0) {
      const { id, tier } = pending;
      pending = null;
      patchSurface({ [`h_${id}`]: tier });
    } else if (performance.now() - pending.t > 5000) pending = null;
  });
}
export const hintPending = () => pending !== null;
