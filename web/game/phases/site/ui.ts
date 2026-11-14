"use client";
// Local (per-player) view state for the site phase. Shared facts (probe, score, sim) live in phaseData.site.
import { create } from "zustand";
import type { OverlayMode, OverlaySample } from "../../three/terrain";

interface SiteUi {
  overlay: OverlayMode;
  /** days after the mission date, shifts the Sun around the horizon (view only) */
  sunDay: number;
  hover: (OverlaySample & { x: number; z: number }) | null;
  hint: { x: number; z: number } | null;
  loaded: boolean;
  busy: "score" | "sim" | null;
  error: string | null;
  drops: number;
  flyTo: { x: number; z: number; dist: number; id: number } | null;
  /** camera azimuth (deg, 0 = grid north, clockwise) for the compass */
  camAz: number;
  set: (p: Partial<Omit<SiteUi, "set">>) => void;
}

export const useSiteUi = create<SiteUi>((set) => ({
  overlay: "none",
  sunDay: 0,
  hover: null,
  hint: null,
  loaded: false,
  busy: null,
  error: null,
  drops: 0,
  flyTo: null,
  camAz: 0,
  set: (p) => set(p),
}));
