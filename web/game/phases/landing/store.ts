"use client";
import { create } from "zustand";
import type { LandResult } from "./sim";

/** What the HUD shows (10 Hz copy of the flight). Lengths in metres, speeds in m/s, angles in degrees. */
export interface LandHud {
  t: number;
  att: number;
  alt: number;
  vy: number;
  hs: number;
  /** speed along the heading / to the right of it */
  vf: number;
  vr: number;
  thr: number;
  fuelPct: number;
  fuelSec: number;
  leanF: number;
  leanR: number;
  slopeF: number;
  slopeR: number;
  /** target ahead / to the right (m) */
  tgtF: number;
  tgtR: number;
  hover: boolean;
  auto: boolean;
  vt: number;
  contact: boolean;
  down: boolean;
  /** seconds since touchdown */
  since: number;
  result: LandResult | null;
  retries: number;
  assisted: boolean;
}

export interface LandInfo {
  limit: number;
  hoverAvail: boolean;
  autoAvail: boolean;
  vSafe: number;
  vCrash: number;
  fuel0: number;
  retryAllowed: boolean;
  penalty: number;
}

interface LandingUi {
  ready: boolean;
  s: LandHud | null;
  info: LandInfo | null;
  /** crew command to the flying client (autoland from a non-pilot host) */
  request: (k: string) => void;
}
export const useLanding = create<LandingUi>(() => ({ ready: false, s: null, info: null, request: () => {} }));

// QA hook: scripts/flight-landing.mjs
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __landing: typeof useLanding }).__landing = useLanding;

/** Juice flags shared by the scene and the HUD: attempt number of a PERFECT touchdown (the scene already showed its banner). */
export const flags = { perfect: -1 };
