"use client";
import { create } from "zustand";

// Long enough for the real descent loop: GO for landing, the 1202 alarm, the altitude calls.
export const TOTAL = 53; // seconds, whole cinematic
export const DESCENT = 45; // touchdown moment

interface LandingUi {
  t: number;
  skipRequested: boolean;
  ready: boolean;
  tele: { alt: number; vs: number; hs: number; thr: number };
  contact: boolean;
  skip: () => void;
  set: (p: Partial<Omit<LandingUi, "set" | "skip">>) => void;
}
export const useLanding = create<LandingUi>((set) => ({
  t: 0,
  skipRequested: false,
  ready: false,
  tele: { alt: 0, vs: 0, hs: 0, thr: 0 },
  contact: false,
  skip: () => set({ skipRequested: true }),
  set: (p) => set(p),
}));
