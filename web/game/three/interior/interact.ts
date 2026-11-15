// Interaction registry: stations register what can be used; the player rig picks the best candidate each frame.
import * as THREE from "three";
import { create } from "zustand";

export interface Interactable {
  id: string;
  /** World position (updated in place by owners when they move). */
  pos: THREE.Vector3;
  /** Selection radius in metres (how big it is to aim at). */
  r: number;
  /** Max reach from the eye in metres. */
  reach?: number;
  /** Prompt text (without the key), or null/undefined when unusable right now. */
  label: () => string | null | undefined;
  /** Pressed once (E / click). */
  use?: () => void;
  /** Held: called each frame with dt while E / mouse is down on it. */
  hold?: (dt: number) => void;
  /** Hold-style interactions show a different key hint. */
  holdLabel?: boolean;
}

export const registry = new Map<string, Interactable>();
export function register(i: Interactable) {
  registry.set(i.id, i);
  return () => {
    if (registry.get(i.id) === i) registry.delete(i.id);
  };
}

/** What the player is aiming at (HUD reads it ~10 Hz). */
export const useAim = create<{ id: string | null; label: string | null; hold: boolean; dist: number }>(() => ({ id: null, label: null, hold: false, dist: 0 }));

const ro = new THREE.Vector3();
const rd = new THREE.Vector3();
const tmp = new THREE.Vector3();

/** Best interactable along the aim ray (eye origin, unit direction). */
export function pick(origin: THREE.Vector3, dir: THREE.Vector3): Interactable | null {
  ro.copy(origin);
  rd.copy(dir);
  let best: Interactable | null = null;
  let bs = Infinity;
  for (const it of registry.values()) {
    const lab = it.label();
    if (!lab) continue;
    tmp.copy(it.pos).sub(ro);
    const d = tmp.length();
    if (d > (it.reach ?? 2.4)) continue;
    const along = tmp.dot(rd);
    if (along < 0.05) continue;
    const off = Math.sqrt(Math.max(0, d * d - along * along));
    // generous aim cone: object radius plus a slack that grows a little with distance
    const lim = it.r + 0.1 + d * 0.06;
    if (off > lim) continue;
    const score = off / lim + d * 0.05;
    if (score < bs) {
      bs = score;
      best = it;
    }
  }
  return best;
}
