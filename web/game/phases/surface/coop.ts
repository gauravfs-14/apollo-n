"use client";
// Shared-state plumbing for the surface mission. Every shared fact is its own key in phaseData.surface, so two players
// finishing things at the same moment never overwrite each other (patch() merges top-level keys):
//   d_<task>        task done (ms timestamp)          p_<poi>          field note discovered
//   h_<item>_<id>   1 while player <id> carries it    ix_/iz_<item>    where the item lies when nobody carries it
//   co_<task>       1 when the task was done with a partner
// Transient things (a partner holding a cable) go through emit(): `sf_hold` every 0.25 s.
import { send } from "../../core/net";
import { onServerEvent } from "../../core/store";
import type { GameState, Player } from "../../types";
import { rt } from "./store";

export interface Remote {
  x: number;
  y: number;
  z: number;
  rotY: number;
  t: number;
}
/** Latest 10 Hz positions of the other players (filled by Crew). */
export const remotes = new Map<string, Remote>();

export type Surf = Record<string, unknown>;
export const surf = (st: GameState | null | undefined): Surf => (st?.phaseData.surface ?? {}) as Surf;

export function patchSurface(data: Record<string, unknown>) {
  send({ type: "action", phase: "surface", kind: "patch", data });
}

export function doneSet(s: Surf): Set<string> {
  const out = new Set<string>();
  for (const k in s) if (k.startsWith("d_") && s[k]) out.add(k.slice(2));
  const legacy = s.done;
  if (Array.isArray(legacy)) legacy.forEach((i) => out.add(String(i)));
  return out;
}
export function poiSet(s: Surf): Set<string> {
  const out = new Set<string>();
  for (const k in s) if (k.startsWith("p_") && s[k]) out.add(k.slice(2));
  return out;
}

/** Connected players, excluding me. */
export function others(st: GameState | null | undefined, meId: string | undefined): Player[] {
  return (st?.players ?? []).filter((p) => p.id !== meId && p.connected && !p.released);
}

/** Position of another player if we have heard from them in the last 3 s. */
export function posOf(id: string): Remote | null {
  const r = remotes.get(id);
  return r && performance.now() - r.t < 3000 ? r : null;
}

/** Who carries `item` now (connected players whose h_<item>_<id> is 1), me included via the local flag. */
export function holders(st: GameState | null | undefined, item: string, meId: string | undefined, meHolds: boolean): string[] {
  const s = surf(st);
  const out: string[] = [];
  for (const p of st?.players ?? []) {
    if (!p.connected || p.released) continue;
    if (p.id === meId ? meHolds : !!s[`h_${item}_${p.id}`]) out.push(p.id);
  }
  return out;
}

// ---- transient holds ("I am holding the cable post")
const holds = new Map<string, Map<string, number>>();
export function noteHold(slot: string, id: string) {
  let m = holds.get(slot);
  if (!m) holds.set(slot, (m = new Map()));
  m.set(id, performance.now());
}
/** Another player has held `slot` in the last 0.8 s. Returns their id. */
export function otherHolding(slot: string, meId: string | undefined): string | null {
  const m = holds.get(slot);
  if (!m) return null;
  const now = performance.now();
  for (const [id, t] of m) if (id !== meId && now - t < 800) return id;
  return null;
}
export function clearHolds() {
  holds.clear();
}
export function listenHolds() {
  return onServerEvent((m) => {
    if (m.type === "event" && m.kind === "sf_hold") {
      const d = m.data as { slot?: string } | undefined;
      if (d?.slot && m.from) noteHold(d.slot, m.from);
    }
  });
}
export function sendHold(slot: string) {
  send({ type: "emit", kind: "sf_hold", data: { slot } });
}

/** Position and heading of a player: me from the runtime, others from the 10 Hz stream. */
export function coopPos(id: string, meId: string | undefined): { x: number; y: number; z: number; rotY: number } | null {
  if (id === meId) return { x: rt.pos.x, y: rt.pos.y, z: rt.pos.z, rotY: rt.rotY };
  return posOf(id);
}
