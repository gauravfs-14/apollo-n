"use client";
// Cinematic timeline shared by the 3D scene and the HUD (countdown, skip). Captions come from the comms loop.
import { create } from "zustand";

// Timed to the real Apollo 11 count (PAO tape 15/1): ignition sequence at T-8.9 s,
// liftoff at zero; the ascent leaves room for the staging and TLI calls (game/data/missionComms.ts).
export const T = {
  countStart: 11, // T-10
  ignition: 12.1, // T-8.9: "ignition sequence start"
  liftoff: 21, // T-0
  spaceCut: 35,
  sep1: 46, // "Staging and ignition"
  sep2: 60,
  end: 88, // after "That Saturn gave us a magnificent ride"
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
