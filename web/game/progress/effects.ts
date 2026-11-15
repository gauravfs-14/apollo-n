"use client";
// The one read-only API other phases use to read what the player's upgrades do in play.
//
//   const up = useUpgrades();
//
// Ship upgrades (host's hangar decides, shared with the whole crew through phaseData.select.ship):
//   up.hpMax          ship integrity at the start (100 stock). Already applied to state.hp / state.hpMax by the server.
//   up.fuelMult       descent propellant multiplier (1 stock). LANDING: multiply the fuel load by it.
//   up.hurdleTimeMult cruise hurdle timers multiplier (1 stock). CRUISE: multiply each hurdle's time limit by it.
//   up.startingPerk   perk id chosen with the perk-slot upgrade, else null (the build phase already awards it).
//   up.unlockedParts  premium ship part ids the hangar has unlocked (read by the build phase).
// Suit upgrades (each player's own hangar):
//   up.scanRange      suit scanner range multiplier (1 stock). SURFACE: multiply the scan / find radius by it.
// Helpers: getUpgrades() outside React, useLandingRadar() true when the built ship carries the radar part (LANDING).
import { usePhaseData } from "../core/useGame";
import { useStore } from "../core/store";
import { PERKS, type PerkId } from "../data/perks";
import type { BuildParts } from "../data/parts";
import { getPart } from "../data/parts";
import { useProgress, useProgressStore } from "./store";
import { UPGRADES, type Owned } from "./upgrades";

export interface ShipUpgrades {
  hpMax: number;
  fuelMult: number;
  hurdleTimeMult: number;
  startingPerk: PerkId | null;
  unlockedParts: string[];
}
export interface Upgrades extends ShipUpgrades {
  scanRange: number;
}

export const STOCK_SHIP: ShipUpgrades = { hpMax: 100, fuelMult: 1, hurdleTimeMult: 1, startingPerk: null, unlockedParts: [] };

/** Pure: what a set of owned upgrades does. */
export function upgradeEffects(owned: Owned, perk: PerkId | null): Upgrades {
  const val = (id: string, base: number) => {
    const u = UPGRADES.find((x) => x.id === id)!;
    const n = owned[u.id] ?? 0;
    return n > 0 ? u.tiers[n - 1].value : base;
  };
  return {
    hpMax: val("hull", 100),
    fuelMult: val("fuel", 1),
    hurdleTimeMult: val("hurdle", 1),
    scanRange: val("scanner", 1),
    startingPerk: (owned.perk_slot ?? 0) > 0 && perk && PERKS[perk] ? perk : null,
    unlockedParts: UPGRADES.filter((u) => u.partId && (owned[u.id] ?? 0) > 0).map((u) => u.partId as string),
  };
}

export const shipPart = ({ hpMax, fuelMult, hurdleTimeMult, startingPerk, unlockedParts }: Upgrades): ShipUpgrades => ({ hpMax, fuelMult, hurdleTimeMult, startingPerk, unlockedParts });

/** Snapshot of this browser's hangar (use outside React, e.g. when a mission starts). */
export function getUpgrades(): Upgrades {
  const s = useProgressStore.getState();
  return upgradeEffects(s.owned, s.perk);
}

/** Ship numbers come from the host's hangar (shared at mission start); the suit numbers are always your own. */
export function useUpgrades(): Upgrades {
  const p = useProgress();
  const shared = usePhaseData<{ ship?: ShipUpgrades }>("select").ship;
  const multi = useStore((s) => s.state?.mode === "multi");
  const host = useStore((s) => !!s.state?.players.find((x) => x.id === s.meId)?.isHost);
  const hpMax = useStore((s) => s.state?.hpMax);
  const mine = upgradeEffects(p.owned, p.perk);
  const ship = shared ?? (multi && !host ? STOCK_SHIP : shipPart(mine));
  return { ...ship, hpMax: hpMax ?? ship.hpMax, scanRange: mine.scanRange };
}

/** True when the ship that was built carries the landing radar part. */
export function useLandingRadar(): boolean {
  const parts = (usePhaseData<{ parts: BuildParts }>("build").parts ?? {}) as BuildParts;
  return !!getPart(parts.comms)?.tags?.includes("radar");
}
