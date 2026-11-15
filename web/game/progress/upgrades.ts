// The hangar catalog: everything the player can buy with credits. Pure data, no React.
// Owned upgrades are a level per id (0 = not bought). `upgradeEffects()` in effects.ts turns them into numbers.
import type { PerkId } from "../data/perks";

export type UpgradeId = "hull" | "fuel" | "hurdle" | "scanner" | "perk_slot" | "engine_xc" | "power_xb" | "legs_xb" | "comms_xa" | "comms_xb";
export type UpgradeGroup = "ship" | "parts" | "suit";

export interface Tier {
  cost: number;
  /** Journey level that must be cleared first (0 = none). */
  req: number;
  /** The number this tier sets (meaning depends on the upgrade). */
  value: number;
}

export interface Upgrade {
  id: UpgradeId;
  group: UpgradeGroup;
  name: string;
  /** One line: what it changes in play. */
  effect: string;
  tiers: Tier[];
  /** Format a tier value for display, e.g. "+15 integrity". */
  show: (value: number) => string;
  /** Ship part this unlocks in the build phase (parts group). */
  partId?: string;
}

const pct = (v: number) => `${v > 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`;

export const UPGRADES: Upgrade[] = [
  {
    id: "hull", group: "ship", name: "Reinforced hull", effect: "More ship integrity: mistakes and hard hits cost less of your margin.",
    tiers: [{ cost: 200, req: 2, value: 115 }, { cost: 450, req: 6, value: 130 }, { cost: 800, req: 10, value: 150 }],
    show: (v) => `${v} integrity`,
  },
  {
    id: "fuel", group: "ship", name: "Descent fuel tank", effect: "More propellant for the powered descent.",
    tiers: [{ cost: 150, req: 2, value: 1.1 }, { cost: 300, req: 5, value: 1.2 }, { cost: 550, req: 9, value: 1.35 }],
    show: (v) => `${pct(v)} fuel`,
  },
  {
    id: "hurdle", group: "ship", name: "Damage-control training", effect: "Longer timers on every cruise hurdle.",
    tiers: [{ cost: 150, req: 2, value: 1.1 }, { cost: 300, req: 5, value: 1.2 }, { cost: 500, req: 9, value: 1.3 }],
    show: (v) => `${pct(v)} hurdle time`,
  },
  {
    id: "perk_slot", group: "ship", name: "Starting perk slot", effect: "Choose your mission perk instead of drawing one at random.",
    tiers: [{ cost: 400, req: 3, value: 1 }],
    show: () => "pick your perk",
  },
  {
    id: "scanner", group: "suit", name: "Long-range scanner", effect: "Your suit scanner finds points of interest from farther away.",
    tiers: [{ cost: 120, req: 1, value: 1.25 }, { cost: 260, req: 4, value: 1.5 }, { cost: 450, req: 8, value: 2 }],
    show: (v) => `${v}x scan range`,
  },
  {
    id: "comms_xa", group: "parts", name: "Deep-space transceiver", effect: "Unlocks the best radio part in the build phase (97% signal).",
    tiers: [{ cost: 250, req: 2, value: 1 }], show: () => "new radio part", partId: "comms_xa",
  },
  {
    id: "legs_xb", group: "parts", name: "Wide-stance legs", effect: "Unlocks legs that land on slopes up to 26 degrees.",
    tiers: [{ cost: 300, req: 3, value: 1 }], show: () => "new legs part", partId: "legs_xb",
  },
  {
    id: "comms_xb", group: "parts", name: "Landing radar array", effect: "Unlocks a radar radio part: the lander reads its height and sink rate.",
    tiers: [{ cost: 300, req: 4, value: 1 }], show: () => "new radar part", partId: "comms_xb",
  },
  {
    id: "power_xb", group: "parts", name: "Long-life cell stack", effect: "Unlocks a power part with 140 hours of battery.",
    tiers: [{ cost: 350, req: 5, value: 1 }], show: () => "new power part", partId: "power_xb",
  },
  {
    id: "engine_xc", group: "parts", name: "Vacuum-optimised bell", effect: "Unlocks the highest delta-v engine (3800 m/s).",
    tiers: [{ cost: 400, req: 6, value: 1 }], show: () => "new engine part", partId: "engine_xc",
  },
];

export const upgradeById = (id: UpgradeId) => UPGRADES.find((u) => u.id === id)!;
export const upgradeForPart = (partId: string) => UPGRADES.find((u) => u.partId === partId);
export type Owned = Partial<Record<UpgradeId, number>>;

/** Perks a starting-perk slot can hold (all of them, so the choice is real). */
export const PERK_CHOICES: PerkId[] = ["extra_fuel", "water_shield", "high_gain_antenna", "spare_parts", "better_lidar"];

export const ownedTierCount = (owned: Owned) => Object.values(owned).reduce((a, n) => a + (n ?? 0), 0);
export const totalTierCount = UPGRADES.reduce((a, u) => a + u.tiers.length, 0);
