// Shared contracts. Mirrors shared/mission-plan.schema.json and api/app/game/state.py.
// Change these only by agreement: every phase depends on them.

import type { ComponentType } from "react";

export type PhaseId =
  | "select"
  | "build"
  | "drop"
  | "crew"
  | "board"
  | "checklist"
  | "launch"
  | "cruise"
  | "site"
  | "landing"
  | "surface"
  | "report";

// "drop" (the old supply crate) is no longer played; the build phase awards the perk.
export const PHASE_ORDER: PhaseId[] = [
  "select",
  "build",
  "crew",
  "board",
  "checklist",
  "launch",
  "cruise",
  "site",
  "landing",
  "surface",
  "report",
];

export type Role = "commander" | "pilot" | "engineer" | "scientist";
export const ROLES: Role[] = ["commander", "pilot", "engineer", "scientist"];

export type Difficulty = "easy" | "normal" | "hard";
export type ChecklistStyle = "quiz" | "order_steps" | "memory_match" | "switch_panel";
export type HurdleType =
  | "debris_field"
  | "solar_storm"
  | "engine_fault"
  | "nav_correction"
  | "comms_blackout";
export type SurfaceTaskType = "scan" | "collect_sample" | "deploy_relay" | "repair" | "navigate_to";
export type ShipSlot = "engine" | "power" | "payload" | "legs" | "comms";

export interface Fact {
  id: string;
  text: string;
  source_url: string;
  source_name: string;
  verified: boolean;
}

export interface CandidateSite {
  id: string; // e.g. "site_a"; must match a terrain tile in web/public/terrain/<id>/
  name: string;
  lat: number;
  lon: number;
  why: string;
}

export interface ChecklistItem {
  prompt: string;
  answer: string;
  options?: string[]; // quiz only
  fact_id?: string;
}

export interface CruiseHurdle {
  type: HurdleType;
  role: Role;
  difficulty: 1 | 2 | 3;
  story: string;
  fact_id?: string;
}

export interface SurfaceTask {
  id: string;
  role: Role;
  type: SurfaceTaskType;
  title: string;
  hint: string;
  unlocks?: string;
}

export interface MissionPlan {
  id: string; // "apollo-7"
  number: number; // the N in Apollo N
  seed: number;
  difficulty: Difficulty;
  /** Journey level 1..15 this plan was made for (absent for dev/jump plans). */
  level?: number;
  title: string;
  tagline: string;
  goal: { text: string; why: string };
  inspired_by: { name: string; source_url: string; date?: string }; // the real mission/news it is based on
  facts: Fact[];
  destination: {
    body: "moon";
    region: string; // "south_pole"
    region_name: string; // "Lunar South Pole"
    candidate_sites: CandidateSite[];
  };
  ship: {
    slots: ShipSlot[];
    constraints: {
      max_mass_kg: number;
      min_battery_hours: number;
      min_delta_v: number; // m/s
      required_payload: string[];
    };
    rationale: string; // why these constraints, in plain words
  };
  crew: { min: number; max: number; roles: Role[] };
  checklist: { style: ChecklistStyle; items: ChecklistItem[] };
  cruise: CruiseHurdle[];
  surface: { tasks: SurfaceTask[]; final: string };
  voice_lines: { id: string; text: string }[];
}

export interface Player {
  id: string;
  name: string;
  /** Every role this player holds (always set by the server; 4 / players, shared evenly). */
  roles: Role[];
  /** The role they explicitly asked for in the crew phase, if any. Never taken away for balance. */
  picked?: Role;
  /** Primary role (picked, else the first held). Kept for older readers; prefer `roles`. */
  role?: Role;
  /** Gone past the reconnect timeout: not part of the balance until they come back. */
  released?: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface GameState {
  room: string;
  mode: "solo" | "multi";
  plan?: MissionPlan;
  phase: PhaseId;
  players: Player[];
  scores: Partial<Record<PhaseId, number>>;
  phaseData: Partial<Record<PhaseId, Record<string, unknown>>>;
  /** Ship integrity 0..100: mistakes cost HP; at 0 the mission fails. */
  hp?: number;
  /** Hull maximum (100 stock; the reinforced-hull upgrades raise it when the mission starts). hp starts here. */
  hpMax?: number;
  /** Why the mission failed (set when hp reached 0), else absent. */
  failed?: string | null;
  version: number;
}

// ---- Wire messages (WebSocket /ws/rooms/{code}) ----
export type ActionKind = "patch" | "set_plan" | "complete" | "goto" | "reset" | "damage";

export type ClientMsg =
  | { type: "join"; id: string; name: string; rejoin?: boolean }
  | { type: "pick_role"; role: Role | null }
  | { type: "action"; phase: PhaseId; kind: ActionKind; data?: Record<string, unknown> }
  | { type: "emit"; kind: string; data?: Record<string, unknown> }
  | { type: "pos"; x: number; y: number; z: number; rotY: number };

export type ServerMsg =
  | { type: "state"; state: GameState }
  | { type: "event"; kind: string; data?: Record<string, unknown>; from?: string }
  | { type: "pos"; playerId: string; x: number; y: number; z: number; rotY: number }
  | { type: "error"; message: string };

// ---- Phase module contract ----
export interface PhaseModule {
  id: PhaseId;
  /** 3D scene, rendered inside the single shared <Canvas>. Optional for pure-2D phases. */
  Scene?: ComponentType;
  /** 2D overlay rendered above the canvas. */
  Hud: ComponentType;
  /** Asset URLs to warm up while the previous phase is playing. */
  preload?: string[];
  /** Use frameloop="demand" for mostly static scenes (saves battery/GPU). */
  frameloop?: "always" | "demand";
}
