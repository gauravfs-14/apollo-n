"use client";
import { create } from "zustand";
import type { GameState, Player, Role, ServerMsg } from "../types";

export type Quality = "low" | "medium" | "high";

type Listener = (msg: Extract<ServerMsg, { type: "event" } | { type: "pos" }>) => void;

interface Store {
  state: GameState | null;
  meId: string;
  connection: "idle" | "connecting" | "online" | "local" | "lost";
  lastError: string | null;
  quality: Quality;
  showPerf: boolean;
  setState: (s: GameState) => void;
  setConnection: (c: Store["connection"]) => void;
  setError: (e: string | null) => void;
  setQuality: (q: Quality) => void;
  togglePerf: () => void;
}

function loadId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem("apollo.playerId");
  if (!id) {
    id = crypto.randomUUID().slice(0, 8);
    localStorage.setItem("apollo.playerId", id);
  }
  return id;
}

function initialQuality(): Quality {
  if (typeof window === "undefined") return "high";
  const saved = localStorage.getItem("apollo.quality") as Quality | null;
  if (saved) return saved;
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? "high" : cores >= 4 ? "medium" : "low";
}

export const useStore = create<Store>((set) => ({
  state: null,
  meId: loadId(),
  connection: "idle",
  lastError: null,
  quality: initialQuality(),
  showPerf: typeof window !== "undefined" && new URLSearchParams(location.search).has("perf"),
  setState: (state) => set({ state }),
  setConnection: (connection) => set({ connection }),
  setError: (lastError) => set({ lastError }),
  setQuality: (quality) => {
    localStorage.setItem("apollo.quality", quality);
    set({ quality });
  },
  togglePerf: () => set((s) => ({ showPerf: !s.showPerf })),
}));

// Event bus for transient server events (cutscene sync, hurdle progress, remote positions).
const listeners = new Set<Listener>();
export function onServerEvent(fn: Listener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export function emitLocal(msg: Parameters<Listener>[0]) {
  listeners.forEach((fn) => fn(msg));
}

/** Does this player act for `role`? Solo: every role. Multi: own role, plus unclaimed roles for the host. */
export function actsAs(state: GameState | null, me: Player | undefined, role: Role): boolean {
  if (!state || !me) return false;
  if (state.mode === "solo") return true;
  if (me.role === role) return true;
  const claimed = state.players.some((p) => p.role === role && p.connected);
  return !claimed && me.isHost;
}
