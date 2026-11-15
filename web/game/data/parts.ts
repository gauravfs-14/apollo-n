// Ship part catalog + build scoring. Pure data/functions, no React.
// Part ids are "<slot>_<a|b|c>" and match the 3D variants in three/ship/Lander.tsx.
// Hangar (premium) parts are "<slot>_x<a|b|c>": the last letter picks the closest existing 3D variant.
import type { MissionPlan, ShipSlot } from "../types";

export interface ShipPart {
  id: string;
  slot: ShipSlot;
  name: string;
  /** Real-world inspiration, shown as a one-line subtitle. */
  inspiredBy: string;
  desc: string;
  massKg: number;
  /** Electrical power generated (power slot) in watts. */
  powerW?: number;
  /** Electrical power drawn in watts (payload/comms/engine electronics). */
  drawW?: number;
  /** Hours the batteries can run the lander in darkness (power slot). */
  batteryHours?: number;
  /** Delta-v this engine can deliver for a reference 1000 kg lander (m/s). */
  deltaV?: number;
  /** Max slope (deg) the lander can land on without tipping (legs slot). */
  tiltTolerance?: number;
  /** 0..1 radio quality (comms slot). */
  radioQuality?: number;
  /** Capability tags: "drill", "spectrometer", "relay", "camera", "sample". */
  tags?: string[];
  /** Short pros/cons shown on the card. */
  pros: string;
  cons: string;
  /** Hangar part: locked in the build phase until bought (progress/upgrades.ts maps it to its upgrade). */
  premium?: boolean;
}

export const SLOTS: ShipSlot[] = ["engine", "power", "payload", "legs", "comms"];
export const SLOT_LABEL: Record<ShipSlot, string> = {
  engine: "Engine",
  power: "Power",
  payload: "Payload",
  legs: "Landing legs",
  comms: "Radio",
};

export const BASE_MASS_KG = 700; // structure, tanks, cabin, avionics

export const PARTS: ShipPart[] = [
  {
    id: "engine_a", slot: "engine", name: "Hydrolox bell", inspiredBy: "RL10-class upper-stage engine",
    desc: "Single high-efficiency bell. Burns liquid hydrogen and oxygen.",
    massKg: 210, deltaV: 2900, drawW: 40, pros: "Very efficient", cons: "Needs cold, tricky fuel",
  },
  {
    id: "engine_b", slot: "engine", name: "Storable cluster", inspiredBy: "Apollo Lunar Module / Orion service engines",
    desc: "Four small thrusters on fuel that stays liquid at room temperature.",
    massKg: 150, deltaV: 2250, drawW: 25, pros: "Light and very reliable", cons: "Less delta-v",
  },
  {
    id: "engine_c", slot: "engine", name: "Methalox big bell", inspiredBy: "Blue Moon / Starship-style methane engines",
    desc: "Wide bell that burns methane and oxygen. The most thrust and range.",
    massKg: 330, deltaV: 3300, drawW: 70, pros: "Most delta-v", cons: "Heavy",
  },
  {
    id: "power_a", slot: "power", name: "Solar wings + battery", inspiredBy: "Chandrayaan-3 / IM-1 solar arrays",
    desc: "Two fold-out arrays and a small battery. Great in sunlight, short on darkness.",
    massKg: 160, powerW: 900, batteryHours: 24, pros: "Lots of power in sun", cons: "Only 24 h of darkness",
  },
  {
    id: "power_b", slot: "power", name: "RTG + battery", inspiredBy: "Chang'e-4 / Apollo ALSEP radioisotope heat",
    desc: "A radioisotope generator that keeps warming and trickling power through the long lunar night.",
    massKg: 230, powerW: 300, batteryHours: 90, pros: "Survives the night", cons: "Heavy, low power",
  },
  {
    id: "power_c", slot: "power", name: "Fuel cell pack", inspiredBy: "Apollo / Space Shuttle fuel cells",
    desc: "Fuel cells with a large battery pack and radiator panels.",
    massKg: 190, powerW: 600, batteryHours: 55, pros: "Balanced power and hours", cons: "Medium weight",
  },
  {
    id: "payload_a", slot: "payload", name: "Ice drill", inspiredBy: "NASA TRIDENT / PRIME-1 drill",
    desc: "A mast with a rotary drill that reaches a metre under the surface.",
    massKg: 130, drawW: 350, tags: ["drill", "sample"], pros: "Reaches buried ice", cons: "Thirsty for power",
  },
  {
    id: "payload_b", slot: "payload", name: "Spectrometer mast", inspiredBy: "LRO / Chandrayaan APXS instruments",
    desc: "A camera and spectrometer head on a telescoping mast. Reads minerals from a distance.",
    massKg: 70, drawW: 120, tags: ["spectrometer", "camera"], pros: "Light, scans a wide area", cons: "Cannot dig",
  },
  {
    id: "payload_c", slot: "payload", name: "Relay satellite", inspiredBy: "Queqiao / Lunar Pathfinder relays",
    desc: "A small satellite released to give far-side and crater-floor crews a radio link.",
    massKg: 90, drawW: 80, tags: ["relay", "camera"], pros: "Keeps radio alive in craters", cons: "No science tools",
  },
  {
    id: "legs_a", slot: "legs", name: "Tripod struts", inspiredBy: "Apollo LM legs",
    desc: "Telescoping struts with crushable honeycomb. The classic.",
    massKg: 90, tiltTolerance: 12, pros: "Balanced", cons: "Average on slopes",
  },
  {
    id: "legs_b", slot: "legs", name: "Wide splayed legs", inspiredBy: "Blue Ghost / Starship HLS stance",
    desc: "Long legs with large footpads that spread the lander's weight.",
    massKg: 125, tiltTolerance: 18, pros: "Lands on steeper slopes", cons: "Heavier",
  },
  {
    id: "legs_c", slot: "legs", name: "Crushable stubs", inspiredBy: "Surveyor / Chang'e short legs",
    desc: "Short thick legs that crumple to absorb a hard landing.",
    massKg: 60, tiltTolerance: 8, pros: "Lightest", cons: "Tips over on slopes",
  },
  {
    id: "comms_a", slot: "comms", name: "High-gain dish", inspiredBy: "Apollo S-band steerable antenna",
    desc: "A steerable dish that talks straight to Earth with a clear signal.",
    massKg: 40, drawW: 60, radioQuality: 0.9, pros: "Clearest signal", cons: "Must point at Earth",
  },
  {
    id: "comms_b", slot: "comms", name: "Phased array", inspiredBy: "Artemis Orion optical/S-band arrays",
    desc: "A flat panel that steers its beam electronically with no moving parts.",
    massKg: 55, drawW: 90, radioQuality: 0.8, tags: ["relay"], pros: "No moving parts, can relay", cons: "A little heavier",
  },
  {
    id: "comms_c", slot: "comms", name: "Whips + small dish", inspiredBy: "Surveyor omni antennas",
    desc: "Simple rods and a tiny dish. Cheap, light, noisy.",
    massKg: 15, drawW: 20, radioQuality: 0.5, pros: "Almost weightless", cons: "Weak signal",
  },
  {
    id: "engine_xc", slot: "engine", name: "Vacuum-optimised bell", inspiredBy: "BE-7 / RL10C extended-nozzle engines",
    desc: "A long vacuum nozzle tuned for the Moon. The most delta-v of any engine.",
    massKg: 280, deltaV: 3800, drawW: 60, pros: "Highest delta-v", cons: "Heavy and power-hungry", premium: true,
  },
  {
    id: "power_xb", slot: "power", name: "Long-life cell stack", inspiredBy: "Gateway / Chang'e-4 battery packs",
    desc: "A large lithium pack with its own heaters. Runs the lander through a long lunar night.",
    massKg: 205, powerW: 520, batteryHours: 140, pros: "140 h of darkness", cons: "Heavy", premium: true,
  },
  {
    id: "legs_xb", slot: "legs", name: "Wide-stance legs", inspiredBy: "Starship HLS / Blue Moon stance",
    desc: "Very long splayed legs with wide footpads and stiff dampers.",
    massKg: 135, tiltTolerance: 26, pros: "Lands on 26 degree slopes", cons: "Heavy", premium: true,
  },
  {
    id: "comms_xa", slot: "comms", name: "Deep-space transceiver", inspiredBy: "Orion S-band / Ka-band terminal",
    desc: "A dual-band terminal that holds a clean link to Earth from any crater.",
    massKg: 45, drawW: 70, radioQuality: 0.97, pros: "Best signal", cons: "Draws power", premium: true,
  },
  {
    id: "comms_xb", slot: "comms", name: "Landing radar array", inspiredBy: "Apollo LM landing radar, Blue Ghost radar altimeter",
    desc: "A radar radio panel. The lander reads its true height and sink rate in the final descent.",
    massKg: 50, drawW: 80, radioQuality: 0.7, tags: ["radar"], pros: "Height and sink rate readout", cons: "Average radio", premium: true,
  },
];

const BY_ID = new Map(PARTS.map((p) => [p.id, p]));
export const getPart = (id: string | undefined) => (id ? BY_ID.get(id) : undefined);
export const partsFor = (slot: ShipSlot) => PARTS.filter((p) => p.slot === slot);
export const defaultBuild = (): Record<ShipSlot, string> => ({
  engine: "engine_a", power: "power_a", payload: "payload_a", legs: "legs_a", comms: "comms_a",
});

export type BuildParts = Partial<Record<ShipSlot, string>>;

export interface ShipStats {
  massKg: number;
  powerW: number;
  drawW: number;
  batteryHours: number;
  deltaV: number;
  tiltTolerance: number;
  radioQuality: number;
  tags: string[];
  complete: boolean;
}

export function shipStats(parts: BuildParts): ShipStats {
  const p = SLOTS.map((s) => getPart(parts[s]));
  const sum = (f: (x: ShipPart) => number) => p.reduce((a, x) => a + (x ? f(x) : 0), 0);
  const massKg = BASE_MASS_KG + sum((x) => x.massKg);
  const engine = getPart(parts.engine);
  // heavier lander => less delta-v from the same engine (rocket equation, simplified)
  const massFactor = Math.min(1.3, Math.max(0.6, Math.sqrt(1500 / (massKg + 500))));
  return {
    massKg,
    powerW: sum((x) => x.powerW ?? 0),
    drawW: sum((x) => x.drawW ?? 0),
    batteryHours: getPart(parts.power)?.batteryHours ?? 0,
    deltaV: Math.round((engine?.deltaV ?? 0) * massFactor),
    tiltTolerance: getPart(parts.legs)?.tiltTolerance ?? 0,
    radioQuality: getPart(parts.comms)?.radioQuality ?? 0,
    tags: [...new Set(p.flatMap((x) => x?.tags ?? []))],
    complete: SLOTS.every((s) => !!getPart(parts[s])),
  };
}

export interface BuildCheck {
  id: "mass" | "battery" | "delta_v" | "payload" | "power";
  label: string;
  pass: boolean;
  value: number | string;
  target: number | string;
  unit: string;
  /** 0..1, how close to satisfying (1 = satisfied). */
  ratio: number;
  hint: string;
}

export interface BuildEval {
  stats: ShipStats;
  checks: BuildCheck[];
  /** The four mission constraints all pass. */
  allPass: boolean;
  /** 0..100 */
  score: number;
}

type Constraints = MissionPlan["ship"]["constraints"];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Pure scoring: constraints 80 pts (20 each, partial credit), efficiency 20 pts. */
export function evaluateBuild(parts: BuildParts, c: Constraints): BuildEval {
  const s = shipStats(parts);
  const missing = c.required_payload.filter((t) => !s.tags.includes(t));
  const checks: BuildCheck[] = [
    {
      id: "mass", label: "Mass", pass: s.massKg <= c.max_mass_kg, value: Math.round(s.massKg), target: c.max_mass_kg, unit: "kg",
      ratio: clamp01(c.max_mass_kg / s.massKg),
      hint: s.massKg <= c.max_mass_kg ? "Within the weight limit" : `${Math.round(s.massKg - c.max_mass_kg)} kg too heavy: pick lighter parts`,
    },
    {
      id: "battery", label: "Battery", pass: s.batteryHours >= c.min_battery_hours, value: s.batteryHours, target: c.min_battery_hours, unit: "h",
      ratio: clamp01(s.batteryHours / c.min_battery_hours),
      hint: s.batteryHours >= c.min_battery_hours ? "Enough power through the dark" : "Not enough battery hours: change the power source",
    },
    {
      id: "delta_v", label: "Delta-v", pass: s.deltaV >= c.min_delta_v, value: s.deltaV, target: c.min_delta_v, unit: "m/s",
      ratio: clamp01(s.deltaV / c.min_delta_v),
      hint: s.deltaV >= c.min_delta_v ? "Enough fuel to reach and land" : "Not enough push: a stronger engine or a lighter ship",
    },
    {
      id: "payload", label: "Mission tool", pass: missing.length === 0, value: missing.length === 0 ? "ready" : missing.join(", "), target: c.required_payload.join(", ") || "none", unit: "",
      ratio: c.required_payload.length ? 1 - missing.length / c.required_payload.length : 1,
      hint: missing.length === 0 ? "The right instrument is on board" : `Mission needs: ${missing.join(", ")}`,
    },
    {
      id: "power", label: "Power budget", pass: s.powerW >= s.drawW, value: Math.round(s.powerW), target: Math.round(s.drawW), unit: "W",
      ratio: s.drawW ? clamp01(s.powerW / s.drawW) : 1,
      hint: s.powerW >= s.drawW ? "Generation covers consumption" : "Systems draw more power than the generator makes",
    },
  ];
  const main = checks.slice(0, 4);
  let score = 0;
  for (const k of main) score += k.pass ? 20 : 10 * k.ratio;
  if (checks[4].pass) score += 10;
  else score += 10 * checks[4].ratio * 0.5;
  score += 10 * clamp01((c.max_mass_kg - s.massKg) / (0.3 * c.max_mass_kg));
  if (!s.complete) score *= 0.6;
  return { stats: s, checks, allPass: main.every((k) => k.pass), score: Math.round(Math.min(100, Math.max(0, score))) };
}
