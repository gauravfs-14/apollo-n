"use client";
// Cinematic timeline shared by the 3D scene and the HUD (countdown, skip). Captions come from the comms loop.
import { create } from "zustand";

// Countdown from T-10 with ignition at T-8.9 s (as on a Saturn V), then a short ascent:
// the cut to space, two stagings and the translunar burn (calls in game/data/missionComms.ts).
export const T = {
  countStart: 2, // T-10
  ignition: 3.1, // T-8.9: "ignition sequence start"
  liftoff: 12, // T-0
  spaceCut: 24,
  sep1: 30, // first stage separates
  sep2: 36, // second stage separates; GO for translunar injection
  end: 44,
} as const;

interface Clock {
  t: number;
  skipped: boolean;
  set: (t: number) => void;
  skip: () => void;
  reset: () => void;
}

export const useLaunchClock = create<Clock>((set) => ({
  t: 0,
  skipped: false,
  set: (t) => set({ t }),
  skip: () => set({ skipped: true }),
  reset: () => set({ t: 0, skipped: false }),
}));
