"use client";
// Dev helper: /play/X?mode=solo&phase=site jumps straight to a phase with a plan loaded.
import fallback from "../data/fallback-plan.json";
import type { MissionPlan, PhaseId } from "../types";
import { PHASE_ORDER } from "../types";
import { api } from "./api";
import { send } from "./net";
import { useStore } from "./store";

export function devJump(target: string | null) {
  if (!target || !PHASE_ORDER.includes(target as PhaseId)) return () => {};
  let done = false;
  let until = 0;
  return useStore.subscribe(async (s) => {
    // Dev jumps race with the phase's own first messages (sent for the old phase): hide that toast.
    if (until && Date.now() < until && s.lastError?.startsWith("Not in phase")) {
      s.setError(null);
      return;
    }
    const me = s.state?.players.find((p) => p.id === s.meId);
    if (done || !s.state || !me?.isHost) return;
    done = true;
    until = Date.now() + 8000;
    if (!s.state.plan) {
      let plan = fallback as unknown as MissionPlan;
      try {
        plan = await api<MissionPlan>("/missions/fallback");
      } catch {}
      send({ type: "action", phase: s.state.phase, kind: "set_plan", data: { plan } });
    }
    send({ type: "action", phase: useStore.getState().state!.phase, kind: "goto", data: { phase: target } });
  });
}
