"use client";
// AR overlay state (React side). Positions of the tags are written straight to the DOM from the scene (see ExploreAr),
// so nothing here changes per frame; `open`/`atlas` change on user input only.
import { create } from "zustand";

export interface ArFact {
  text: string;
  source_name?: string;
  source_url?: string;
  via?: string;
}
export interface ArImage {
  url: string;
  title?: string;
  credit?: string;
  page?: string;
}
export type ArKind = "lander" | "flag" | "task" | "nature" | "sky" | "heritage";
export interface ArInfo {
  id: string;
  kind: ArKind;
  title: string;
  blurb: string;
  facts: ArFact[];
  left?: string[];
  image?: ArImage | null;
  agency?: string | null;
  year?: number | null;
  /** env fact set on the API that extends this tag */
  env?: string;
  enriched?: boolean;
}
export interface Site {
  id: string;
  distKm: number;
  bearing: number;
}

interface ArState {
  infos: Record<string, ArInfo>;
  /** one DOM tag each; `info` points into infos (several tags can share one, e.g. boulders) */
  targets: { id: string; info: string }[];
  sites: Site[];
  open: string | null;
  atlas: boolean;
  flag: [number, number, number] | null;
  online: boolean | null; // null = not asked yet, false = API failed (bundled data in use)
  setInfos: (infos: ArInfo[]) => void;
  setTargets: (t: { id: string; info: string }[]) => void;
  merge: (id: string, p: Partial<ArInfo>) => void;
  reset: () => void;
}

export const useAr = create<ArState>((set) => ({
  infos: {},
  targets: [],
  sites: [],
  open: null,
  atlas: false,
  flag: null,
  online: null,
  setTargets: (targets) => set({ targets }),
  setInfos: (list) => set((s) => ({ infos: { ...s.infos, ...Object.fromEntries(list.map((i) => [i.id, i])) } })),
  merge: (id, p) => set((s) => (s.infos[id] ? { infos: { ...s.infos, [id]: { ...s.infos[id], ...p } } } : s)),
  reset: () => set({ infos: {}, targets: [], sites: [], open: null, atlas: false, flag: null, online: null }),
}));

/** DOM nodes of the tags, registered by ArLayer and moved by the scene each frame. */
export const arEls = new Map<string, { root: HTMLElement; sub: HTMLElement }>();
/** id of the tag the player is looking at (read by the HUD for the E hint). */
export const arGaze = { id: null as string | null, pin: null as string | null, until: 0 };
