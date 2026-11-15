"use client";
// Supply points (SP): the in-mission currency, shared by the crew. Earned on the journey (cruise
// activities, quizzes, puzzles; not guaranteed: wrong answers and timeouts pay nothing), spent on
// the Moon for hints and repairs. Server-owned (state.sp), so the crew can't double-spend.
// Leftover SP becomes persistent credits on the report.
//   earn(15, "Navigation quiz: 3 of 3")         // call from the client of the player who earned it
//   spend(PRICES.hint[0], "hint:t2:1")            // rejected (toast) if the crew can't afford it
//   buyRepair()                                    // spend SP to restore ship integrity
//   const sp = useSupply();
import { send } from "./net";
import { useStore } from "./store";

export const PRICES = {
  /** Hint tiers for one task: a nudge, a clear direction, the exact answer. */
  hint: [10, 25, 50],
  /** Field repair: cost and integrity restored. */
  repair: { cost: 30, amount: 20 },
} as const;

function act(kind: "earn" | "spend" | "heal", data: Record<string, unknown>) {
  const st = useStore.getState().state;
  if (!st || st.failed) return;
  send({ type: "action", phase: st.phase, kind, data });
}

export function earn(amount: number, reason: string) {
  if (amount > 0) act("earn", { amount: Math.round(amount), reason });
}

/** True if the crew can afford it right now (the server still has the final say). */
export function canAfford(cost: number) {
  return (useStore.getState().state?.sp ?? 0) >= cost;
}

export function spend(cost: number, item: string) {
  if (!canAfford(cost)) return useStore.getState().setError("Not enough supply points");
  act("spend", { amount: cost, item });
}

export function buyRepair() {
  const { cost, amount } = PRICES.repair;
  if (!canAfford(cost)) return useStore.getState().setError("Not enough supply points");
  act("heal", { cost, amount });
}

export function useSupply() {
  return useStore((s) => s.state?.sp ?? 0);
}
