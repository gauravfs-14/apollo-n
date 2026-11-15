"use client";
// Launch clock shared by the 3D scene and the HUD (countdown, skip, flight panel). Captions come from the comms loop.
import { create } from "zustand";
import { newLaunch, type LaunchSim } from "./flight";

// Countdown from T-10 with ignition at T-8.9 s (as on a Saturn V), then the ascent the player flies (flight.ts):
// the cut to space, two stagings and the translunar burn (calls in game/data/missionComms.ts). Fixed marks only:
// what happens after the first stage burns out depends on when the player stages.
export const T = {
  countStart: 2, // T-10
  ignition: 3.1, // T-8.9: "ignition sequence start"
  liftoff: 12, // T-0
  spaceCut: 24,
  s1Burnout: 30, // first stage burns out: stage now
} as const;

interface Clock {
  t: number;
  /** copy of the flight state for the HUD (10 Hz) */
  sim: LaunchSim;
  skipped: boolean;
  set: (t: number, sim?: LaunchSim) => void;
  skip: () => void;
  reset: () => void;
}

export const useLaunchClock = create<Clock>((set) => ({
  t: 0,
  sim: newLaunch(),
  skipped: false,
  set: (t, sim) => set(sim ? { t, sim: { ...sim } } : { t }),
  skip: () => set({ skipped: true }),
  reset: () => set({ t: 0, skipped: false, sim: newLaunch() }),
}));

// QA hook: scripts/flight-launch.mjs reads the flight from here.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __launchClock: typeof useLaunchClock }).__launchClock = useLaunchClock;
