"use client";
// Lazy registry: each phase is its own code-split chunk. The runner preloads
// the next phase's code + assets while the current one plays.
import { useGLTF, useTexture } from "@react-three/drei";
import { PHASE_ORDER, type PhaseId, type PhaseModule } from "../types";

const loaders: Record<PhaseId, () => Promise<{ phase: PhaseModule }>> = {
  select: () => import("../phases/select"),
  build: () => import("../phases/build"),
  drop: () => import("../phases/drop"),
  crew: () => import("../phases/crew"),
  board: () => import("../phases/board"),
  checklist: () => import("../phases/checklist"),
  launch: () => import("../phases/launch"),
  cruise: () => import("../phases/cruise"),
  site: () => import("../phases/site"),
  landing: () => import("../phases/landing"),
  surface: () => import("../phases/surface"),
  report: () => import("../phases/report"),
};

const cache = new Map<PhaseId, PhaseModule>();
const pending = new Map<PhaseId, Promise<PhaseModule>>();

export function loadPhase(id: PhaseId): Promise<PhaseModule> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = loaders[id]().then((m) => {
      cache.set(id, m.phase);
      return m.phase;
    });
    pending.set(id, p);
  }
  return p;
}

export function getLoadedPhase(id: PhaseId) {
  return cache.get(id);
}

export function preloadAssets(urls: string[] = []) {
  for (const url of urls) {
    if (/\.(glb|gltf)$/i.test(url)) useGLTF.preload(url);
    else if (/\.(png|jpe?g|webp|ktx2)$/i.test(url)) useTexture.preload(url);
    else fetch(url).catch(() => {});
  }
}

export function preloadNext(id: PhaseId) {
  const next = PHASE_ORDER[PHASE_ORDER.indexOf(id) + 1];
  if (!next) return;
  loadPhase(next).then((m) => preloadAssets(m.preload)).catch(() => {});
}
