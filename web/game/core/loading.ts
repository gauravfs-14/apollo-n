"use client";
// Phases that fetch their own data after mounting (terrain, etc.) hold the
// loading screen until they are ready, so the player never sees an empty scene.
import { useEffect, useId } from "react";
import { create } from "zustand";

interface Holds {
  holds: Record<string, string>; // id -> what is loading ("Loading lunar terrain")
  set: (id: string, label: string | null) => void;
}

export const useLoadingHolds = create<Holds>((set) => ({
  holds: {},
  set: (id, label) =>
    set((s) => {
      const holds = { ...s.holds };
      if (label) holds[id] = label;
      else delete holds[id];
      return { holds };
    }),
}));

/** Keep the loading screen up (showing `label`) while `active` is true. */
export function useLoadingHold(active: boolean, label: string) {
  const id = useId();
  const set = useLoadingHolds((s) => s.set);
  useEffect(() => {
    set(id, active ? label : null);
    return () => set(id, null);
  }, [id, active, label, set]);
}
