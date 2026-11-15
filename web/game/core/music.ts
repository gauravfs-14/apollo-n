"use client";
// Which track plays where. Tracks: web/public/audio/music/<id>.mp3
// (Kevin MacLeod, incompetech.com, CC BY 4.0; see assets-src/credits/music.md).
import type { PhaseId } from "../types";
import { playMusic, stopMusic } from "./audio";

export type TrackId =
  | "menu" | "prep" | "prelaunch" | "launch" | "cruise" | "hurdle" | "site" | "landing" | "surface" | "report";

export const PHASE_TRACK: Record<PhaseId, TrackId> = {
  select: "menu",
  build: "prep",
  drop: "prep",
  crew: "prep",
  board: "prelaunch",
  checklist: "prelaunch",
  launch: "launch",
  cruise: "cruise",
  site: "site",
  landing: "landing",
  surface: "surface",
  report: "report",
};

// Per-track mix so stages sit at a similar level under sfx and voice.
const LEVEL: Partial<Record<TrackId, number>> = { launch: 0.3, hurdle: 0.3, landing: 0.3 };

let base: TrackId | null = null;
let override: TrackId | null = null;

function apply() {
  const t = override ?? base;
  if (t) playMusic(`/audio/music/${t}.mp3`, LEVEL[t] ?? 0.35);
  else stopMusic();
}

/** The stage's track (menu, or the current phase). */
export function setBaseMusic(t: TrackId | null) {
  base = t;
  apply();
}

/** Temporarily replace the stage track (e.g. during a cruise hurdle); null restores it. */
export function setMusicOverride(t: TrackId | null) {
  override = t;
  apply();
}
