"use client";
import { create } from "zustand";

export const BOARD_END = 12;

interface Clock {
  t: number;
  skipped: boolean;
  set: (t: number) => void;
  skip: () => void;
  reset: () => void;
}
export const useBoardClock = create<Clock>((set) => ({
  t: 0,
  skipped: false,
  set: (t) => set({ t }),
  skip: () => set({ skipped: true }),
  reset: () => set({ t: 0, skipped: false }),
}));

export const boardCaption = (t: number) =>
  t < 4.5 ? "Crew walkout. The vehicle stands in the dawn light." : t < 9 ? "Elevator to the top of the tower." : t < 10.3 ? "Ingress. One by one into the capsule." : "Hatch closed. Final checks.";
