"use client";
// Cinematic timeline shared by the 3D scene and the HUD (countdown, captions, skip).
import { create } from "zustand";

export const T = {
  speak: 0.4,
  countStart: 1, // T-10
  ignition: 8, // T-3
  liftoff: 11, // T-0
  spaceCut: 24,
  sep1: 30,
  sep2: 36,
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

export const captionAt = (t: number): string => {
  if (t < T.countStart) return "Mission control: all stations, final poll.";
  if (t < T.ignition) return "Countdown.";
  if (t < T.liftoff) return "Main engine start.";
  if (t < T.liftoff + 1.5) return "Liftoff.";
  if (t < T.spaceCut) return "Clearing the tower. Rolling to the flight path.";
  if (t < T.sep1) return "Going through max-Q. Above the atmosphere.";
  if (t < T.sep2) return "First stage separation. Second stage burning.";
  if (t < T.end - 1) return "Translunar injection. The Moon is ahead.";
  return "On course for the Moon.";
};
