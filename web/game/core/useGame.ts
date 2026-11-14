"use client";
import { useCallback } from "react";
import type { ActionKind, PhaseId, Role } from "../types";
import { send } from "./net";
import { actsAs, useStore } from "./store";

/** The one hook phases use. Read state, send actions. Never mutate state locally. */
export function useGame() {
  const state = useStore((s) => s.state);
  const meId = useStore((s) => s.meId);
  const me = state?.players.find((p) => p.id === meId);

  const action = useCallback(
    (phase: PhaseId, kind: ActionKind, data?: Record<string, unknown>) =>
      send({ type: "action", phase, kind, data }),
    [],
  );
  /** Merge data into phaseData[phase] (shared with everyone). */
  const patch = useCallback((phase: PhaseId, data: Record<string, unknown>) => action(phase, "patch", data), [action]);
  /** Finish the phase with a 0–100 score; server advances to the next phase. */
  const complete = useCallback((phase: PhaseId, score: number) => action(phase, "complete", { score }), [action]);
  /** Broadcast a transient event (not stored). */
  const emit = useCallback((kind: string, data?: Record<string, unknown>) => send({ type: "emit", kind, data }), []);

  return {
    state,
    plan: state?.plan,
    me,
    isHost: !!me?.isHost,
    send,
    action,
    patch,
    complete,
    emit,
    actsAs: (role: Role) => actsAs(state, me, role),
  };
}

export function usePhaseData<T = Record<string, unknown>>(phase: PhaseId): Partial<T> {
  return (useStore((s) => s.state?.phaseData[phase]) ?? {}) as Partial<T>;
}
