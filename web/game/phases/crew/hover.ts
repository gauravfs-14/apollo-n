"use client";
// Tiny store shared by the crew HUD (cards) and 3D scene (which astronaut waves / glows).
import { create } from "zustand";
import type { Role } from "../../types";

export const useCrewUi = create<{
  hover: Role | null;
  setHover: (r: Role | null) => void;
  names: Partial<Record<Role, string>>; // names currently shown in the HUD, for the 3D labels
  setNames: (n: Partial<Record<Role, string>>) => void;
}>((set) => ({
  hover: null,
  setHover: (hover) => set({ hover }),
  names: {},
  setNames: (names) => set({ names }),
}));
