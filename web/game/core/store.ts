"use client";
import { create } from "zustand";
import type { GameState, Player, Role, ServerMsg } from "../types";
import { setMasterVolume } from "./audio";
import { rolesOf } from "./roles";

export type Quality = "low" | "medium" | "high";
/** User choice in settings: "auto" lets the FPS monitor move between tiers, anything else pins the tier. */
export type QualityMode = "auto" | Quality;

type Listener = (msg: Extract<ServerMsg, { type: "event" } | { type: "pos" }>) => void;

interface Store {
  state: GameState | null;
  meId: string;
  connection: "idle" | "connecting" | "online" | "local" | "lost" | "missing";
  lastError: string | null;
  quality: Quality;
  qualityMode: QualityMode;
  volume: number;
  showPerf: boolean;
  setState: (s: GameState) => void;
  setConnection: (c: Store["connection"]) => void;
  setError: (e: string | null) => void;
  setQuality: (q: Quality) => void;
  setQualityMode: (m: QualityMode) => void;
  setVolume: (v: number) => void;
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

function heuristicQuality(): Quality {
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? "high" : cores >= 4 ? "medium" : "low";
}

/** Saved choice: apollo.qualityMode (settings) or a bare apollo.quality (scripts/shot.mjs pin a tier this way). */
function initialMode(): QualityMode {
  if (typeof window === "undefined") return "auto";
  const m = localStorage.getItem("apollo.qualityMode") ?? localStorage.getItem("apollo.quality");
  return m === "low" || m === "medium" || m === "high" ? m : "auto";
}

function initialQuality(): Quality {
  if (typeof window === "undefined") return "high";
  const m = initialMode();
  return m === "auto" ? heuristicQuality() : m;
}

function initialVolume(): number {
  if (typeof window === "undefined") return 0.8;
  const v = parseFloat(localStorage.getItem("apollo.volume") ?? "");
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
}

export const useStore = create<Store>((set) => ({
  state: null,
  meId: loadId(),
  connection: "idle",
  lastError: null,
  quality: initialQuality(),
  qualityMode: initialMode(),
  volume: initialVolume(),
  showPerf: typeof window !== "undefined" && new URLSearchParams(location.search).has("perf"),
  setState: (state) => set({ state }),
  setConnection: (connection) => set({ connection }),
  setError: (lastError) => set({ lastError }),
  // setQuality is also called by the FPS monitor, so it is not persisted; the user's choice is (setQualityMode).
  setQuality: (quality) => set({ quality }),
  setQualityMode: (qualityMode) => {
    localStorage.setItem("apollo.qualityMode", qualityMode);
    localStorage.removeItem("apollo.quality");
    set(qualityMode === "auto" ? { qualityMode } : { qualityMode, quality: qualityMode });
  },
  setVolume: (volume) => {
    localStorage.setItem("apollo.volume", String(volume));
    setMasterVolume(volume);
    set({ volume });
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

/** Does this player act for `role`? Solo: every role. Multi: any role you hold, plus roles whose holders are all offline for the host. */
export function actsAs(state: GameState | null, me: Player | undefined, role: Role): boolean {
  if (!state || !me) return false;
  if (state.mode === "solo") return true;
  if (rolesOf(me).includes(role)) return true;
  const claimed = state.players.some((p) => rolesOf(p).includes(role) && p.connected);
  return !claimed && me.isHost;
}

// QA hook: scripts/e2e-*.mjs read the live state (plan, phase, players) from here.
if (typeof window !== "undefined") (window as unknown as { __apolloStore: typeof useStore }).__apolloStore = useStore;
