// Supply-drop perks: earned from the build score, seeded (no paid randomness).
// The Drop phase writes the chosen id to phaseData.drop.perk. Other phases read it with
//   const perk = usePhaseData<{ perk: PerkId }>("drop").perk;  const fx = perkEffects(perk);
//
// Perk ids and effects (multipliers; 1 = no change):
//   extra_fuel        landing scatter x0.7 (tighter landing spread), +10% hover time     -> fx.landingScatter, fx.hoverTime
//   water_shield      solar storm hurdle: timer x1.5, shield zone x1.3                   -> fx.solarStormTime
//   high_gain_antenna comms hurdle / blackout: signal window x1.5                        -> fx.commsWindow
//   spare_parts       engine fault hurdle: timer x1.5, one pipe pre-connected            -> fx.engineFaultTime
//   better_lidar      landing/site hazard overlay sharper: scan resolution x1.5          -> fx.hazardOverlay
import type { ShipSlot } from "../types";

export type PerkId = "extra_fuel" | "water_shield" | "high_gain_antenna" | "spare_parts" | "better_lidar";
export type Rarity = "common" | "rare" | "legendary";

export interface Perk {
  id: PerkId;
  name: string;
  desc: string;
  /** Plain statement of the gameplay effect, shown on the reveal card. */
  effect: string;
  /** Which ship slot it relates to (for the crate contents illustration). */
  slot: ShipSlot;
  rarity: Rarity;
}

export const PERKS: Record<PerkId, Perk> = {
  extra_fuel: {
    id: "extra_fuel", name: "Reserve fuel tank", slot: "engine", rarity: "rare",
    desc: "A sealed spare propellant tank for the descent stage.",
    effect: "Landing is more accurate: your touchdown scatter is 30% tighter.",
  },
  water_shield: {
    id: "water_shield", name: "Water radiation shield", slot: "power", rarity: "common",
    desc: "A water-filled liner that blocks charged particles, the way real crews plan to shelter.",
    effect: "Solar storms are easier: 50% more time to take cover.",
  },
  high_gain_antenna: {
    id: "high_gain_antenna", name: "High-gain antenna", slot: "comms", rarity: "common",
    desc: "A bigger dish with a tighter beam toward Earth.",
    effect: "Communication blackouts are easier: signal window 50% longer.",
  },
  spare_parts: {
    id: "spare_parts", name: "Spare parts kit", slot: "engine", rarity: "common",
    desc: "Valves, fittings and a pressure regulator for in-flight fixes.",
    effect: "Engine faults are easier: 50% more repair time and one pipe already connected.",
  },
  better_lidar: {
    id: "better_lidar", name: "Precision lidar", slot: "payload", rarity: "legendary",
    desc: "A lidar head that maps boulders and slopes in fine detail.",
    effect: "The hazard overlay is sharper: scan resolution 50% higher.",
  },
};

export interface PerkEffects {
  landingScatter: number;
  hoverTime: number;
  solarStormTime: number;
  commsWindow: number;
  engineFaultTime: number;
  hazardOverlay: number;
}

const NEUTRAL: PerkEffects = { landingScatter: 1, hoverTime: 1, solarStormTime: 1, commsWindow: 1, engineFaultTime: 1, hazardOverlay: 1 };

export function perkEffects(perk: string | undefined | null): PerkEffects {
  switch (perk) {
    case "extra_fuel": return { ...NEUTRAL, landingScatter: 0.7, hoverTime: 1.1 };
    case "water_shield": return { ...NEUTRAL, solarStormTime: 1.5 };
    case "high_gain_antenna": return { ...NEUTRAL, commsWindow: 1.5 };
    case "spare_parts": return { ...NEUTRAL, engineFaultTime: 1.5 };
    case "better_lidar": return { ...NEUTRAL, hazardOverlay: 1.5 };
    default: return NEUTRAL;
  }
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rarity odds improve with build score. Same (score, seed) always gives the same perk. */
export function rollPerk(score: number, seed: number): PerkId {
  const r = mulberry(seed * 31 + Math.round(score))();
  const s = Math.max(0, Math.min(100, score)) / 100;
  const pLegend = 0.05 + 0.3 * s * s;
  const pRare = 0.2 + 0.3 * s;
  const tier: Rarity = r < pLegend ? "legendary" : r < pLegend + pRare ? "rare" : "common";
  const pool = (Object.values(PERKS) as Perk[]).filter((p) => p.rarity === tier);
  const r2 = mulberry(seed * 17 + 3)();
  return pool[Math.floor(r2 * pool.length)].id;
}

export const crateTier = (score: number): Rarity => (score >= 85 ? "legendary" : score >= 55 ? "rare" : "common");
